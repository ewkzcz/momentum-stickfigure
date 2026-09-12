/** 内嵌网页控制器：唯一管理网页视图、主题同步及网页图片拖拽状态。 */
import { app, BrowserWindow, BrowserView, ipcMain, nativeImage, nativeTheme, session } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * 创建唯一网页控制器并复用入口的系统图片目录策略。
 * 处理流程：
 * 1、在原初始化时机创建视图索引和拖拽状态。
 * 2、提供原注册和注销入口，不改变主题脚本、IPC或释放行为。
 */
export function createBrowserViewController({ getPicturesDirectory }) {
  const globalBrowserViews = new Map()

  // ==================== BrowserView 嵌入处理器 ====================
  let __doubaoDragging = false // 防止并发/重复 startDrag 造成崩溃
  let __dragHostWindow = null // 隐藏的拖拽宿主窗口

  // 兼容层：新增/移除/设置 BrowserView（兼容新旧 API）
  const __autoResizeHandlers = new WeakMap()
  /**
   * 使用当前 Electron 可用接口挂载网页视图。
   * 处理流程：
   * 1、按兼容顺序选择添加视图接口。
   */
  function addView(win, view) {
    // 1、兼容多视图、内容子视图和旧版单视图接口。
    try {
      if (typeof win.addBrowserView === 'function') return win.addBrowserView(view)
      if (win.contentView && typeof win.contentView.addChildView === 'function') return win.contentView.addChildView(view)
      if (typeof win.setBrowserView === 'function') return win.setBrowserView(view)
    } catch (_) {}
  }
  /**
   * 使用当前 Electron 可用接口移除网页视图。
   * 处理流程：
   * 1、按兼容顺序选择移除视图接口。
   */
  function removeView(win, view) {
    // 1、与挂载逻辑对应，兼容不同版本的窗口接口。
    try {
      if (typeof win.removeBrowserView === 'function') return win.removeBrowserView(view)
      if (win.contentView && typeof win.contentView.removeChildView === 'function') return win.contentView.removeChildView(view)
      if (typeof win.setBrowserView === 'function') return win.setBrowserView(null)
    } catch (_) {}
  }
  /**
   * 更新网页视图边界。
   * 处理流程：
   * 1、接口可用时设置边界，忽略兼容性异常。
   */
  function setViewBounds(view, bounds) {
    // 1、仅在视图支持边界设置时调用。
    try { if (typeof view.setBounds === 'function') return view.setBounds(bounds) } catch (_) {}
  }
  /**
   * 让内嵌视图跟随宿主窗口调整尺寸。
   * 处理流程：
   * 1、优先使用视图原生自动缩放接口。
   * 2、原生接口不可用时注册一次窗口尺寸监听。
   */
  function setViewAutoResize(win, view, opts = { width: true, height: true }) {
    // 1、原生接口可用时直接应用调用方的缩放选项。
    try {
      if (typeof view.setAutoResize === 'function') {
        view.setAutoResize(opts)
        return
      }
    } catch (_) {}
    // 2、降级为窗口尺寸变化时手动同步。
    try {
      /**
       * 将宿主内容区域尺寸同步到内嵌视图。
       * 处理流程：
       * 1、读取内容边界并更新视图宽高。
       */
      const handler = () => {
        // 1、使用内容区尺寸，避免包含系统窗口边框。
        try {
          const b = win.getContentBounds()
          setViewBounds(view, { x: 0, y: 0, width: b.width, height: b.height })
        } catch (_) {}
      }
      if (!__autoResizeHandlers.has(view)) {
        __autoResizeHandlers.set(view, handler)
        win.on('resize', handler)
      }
    } catch (_) {}
  }

  /**
   * 获取用于发起系统拖拽的隐藏宿主窗口。
   * 处理流程：
   * 1、复用仍存活的宿主，否则创建隐藏窗口。
   * 2、创建失败时返回空值。
   */
  function ensureDragHostWindow() {
    // 1、复用隐藏窗口，避免每次拖拽都创建新宿主。
    try {
      if (__dragHostWindow && !__dragHostWindow.isDestroyed()) return __dragHostWindow
      __dragHostWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        frame: false,
        transparent: true,
        focusable: false,
        resizable: false,
        skipTaskbar: true,
        webPreferences: {
          sandbox: false,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
          devTools: true
        }
      })
      return __dragHostWindow
    } catch (_) {
      return null
    }
  }

  /**
   * 将拖拽诊断信息追加到应用日志。
   * 处理流程：
   * 1、确保日志目录存在，按时间和标签写入一条记录。
   */
  function writeDiag(tag, payload) {
    // 1、日志失败不影响拖拽业务继续执行。
    try {
      const logDir = path.join(app.getPath('userData'), 'logs')
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
      const file = path.join(logDir, 'drag-diag.log')
      const line = `[${new Date().toISOString()}][${tag}] ${JSON.stringify(payload)}\n`
      fs.appendFileSync(file, line)
    } catch (_) {}
  }

  /**
   * 注册内嵌网页和网页图片拖拽接口。
   * 处理流程：
   * 1、准备主题同步、所属窗口查找及会话兼容逻辑。
   * 2、注册视图创建、关闭、边界、主题与刷新入口。
   * 3、注册图片落盘及系统拖拽入口。
   */
  function registerBrowserViewHandlers() {
    // 1、准备视图主题同步和宿主窗口定位能力。
    /**
     * 将应用主题同步到内嵌网页。
     * 处理流程：
     * 1、同步系统主题与视图背景。
     * 2、按选项注入主题样式和脚本。
     */
    const applyThemeToView = async (view, scheme, useNativeInjection) => {
      // 1、先验证视图引用，再同步原生主题与背景。
      try {
        if (!view || !view.webContents) return

        // 同步系统级主题。
        try { nativeTheme.themeSource = (scheme === 'dark' || scheme === 'light') ? scheme : 'system' } catch (_) {}

        // 设置视图背景色，避免页面空白时出现主题不一致的闪烁。
        try {
          view.setBackgroundColor(scheme === 'dark' ? '#1a1a1a' : '#ffffff')
        } catch (_) {}

        // 2、如果启用了原生主题模式，则注入样式和脚本覆盖网站自身主题。
        if (useNativeInjection) {
          const darkMode = scheme === 'dark'

          const css = `
          :root, html {\u0020
            color-scheme: ${scheme} !important;\u0020
          }
          ::-webkit-scrollbar { width: 8px; height: 8px; }
          ::-webkit-scrollbar-thumb { border-radius: 4px; background: ${darkMode ? '#555' : '#c1c1c1'}; }
          ::-webkit-scrollbar-track { background: ${darkMode ? '#2a2a2a' : '#f1f1f1'}; }
        `

          const script = `
          (function() {
            try {
              const isDark = ${darkMode};
              const scheme = isDark ? 'dark' : 'light';
              const oppositeScheme = isDark ? 'light' : 'dark';

              // 清理localStorage中可能的主题设置
              try {
                Object.keys(localStorage)
                  .filter(k => k.toLowerCase().includes('theme') || k.toLowerCase().includes('color'))
                  .forEach(k => localStorage.removeItem(k));
                localStorage.setItem('doubao-theme-preference', scheme);
              } catch (e) {}

              // 强制class
              document.documentElement.classList.add(scheme);
              document.documentElement.classList.remove(oppositeScheme);
              if (document.body) {
                document.body.classList.add(scheme);
                document.body.classList.remove(oppositeScheme);
              }
\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020\u0020
              // 强制属性和样式
              document.documentElement.setAttribute('data-theme', scheme);
              document.documentElement.style.colorScheme = scheme;

              // 使用MutationObserver监控并阻止主题被网站脚本篡改
              if (!window.__appThemeObserver) {
                const observer = new MutationObserver(() => {
                  if (document.documentElement.getAttribute('data-theme') !== scheme) {
                    document.documentElement.setAttribute('data-theme', scheme);
                  }
                  if (document.documentElement.style.colorScheme !== scheme) {
                    document.documentElement.style.colorScheme = scheme;
                  }
                });
                observer.observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ['data-theme', 'style', 'class']
                });
                window.__appThemeObserver = observer;
              }
              console.log('[Momentum] Injected and locked browser theme: ' + scheme);
            } catch (e) {
              console.error('[Momentum] Theme injection script failed:', e);
            }
          })();
        `

          // 确保在注入前webContents是可用的
          if (!view.webContents.isDestroyed()) {
            await view.webContents.insertCSS(css)
            await view.webContents.executeJavaScript(script)
          }
        }
      } catch (e) {
        console.warn('applyThemeToView failed:', e?.message)
      }
    }

    /**
     * 发起内嵌网页主题同步。
     * 处理流程：
     * 1、调用异步主题应用函数并忽略同步调用异常。
     */
    const scheduleApplyTheme = (view, scheme, useNative) => {
      // 1、交由主题函数处理异步同步过程。
      try { applyThemeToView(view, scheme, useNative) } catch (_) {}
    }

    /**
     * 根据页面内容定位可用的宿主窗口。
     * 处理流程：
     * 1、优先查询所属窗口与 Electron 映射。
     * 2、查找失败时使用焦点窗口或首个窗口。
     */
    const getOwningWindowForWebContents = (wc) => {
      // 1、优先使用页面与窗口之间的直接关联。
      try {
        if (wc && typeof wc.getOwnerBrowserWindow === 'function') {
          const win = wc.getOwnerBrowserWindow()
          if (win) return win
        }
      } catch (_) {}
      try {
        const viaFrom = BrowserWindow.fromWebContents(wc)
        if (viaFrom) return viaFrom
      } catch (_) {}
      try {
        // 2、兼容无法反查宿主的页面，使用当前焦点窗口兜底。
        const focused = BrowserWindow.getFocusedWindow()
        if (focused) return focused
      } catch (_) {}
      const all = BrowserWindow.getAllWindows()
      return all && all.length > 0 ? all[0] : null
    }

    // 放宽 CSP：为第三方站点允许 media/worker/socket/子帧等
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      try {
        const headers = details.responseHeaders || {}
        const cspKey = Object.keys(headers).find(k => k.toLowerCase() === 'content-security-policy')
        if (cspKey) {
          const val = Array.isArray(headers[cspKey]) ? headers[cspKey][0] : headers[cspKey]
          // 追加 connect-src / img-src / media-src 的放宽，保持其它指令不变
          const extra = " connect-src * blob: data: ws: wss:; img-src * data: blob:; media-src * data: blob:; worker-src * blob: data:;"
          headers[cspKey] = [String(val || '').replace(/;\s*$/,'') + ';' + extra]
        }
        callback({ responseHeaders: headers })
      } catch (_) {
        callback({ responseHeaders: details.responseHeaders })
      }
    })

    // 2、创建、显示并管理内嵌网页视图。
    /**
     * 为调用窗口打开指定分区的内嵌网页。
     * 处理流程：
     * 1、定位宿主并清理相同分区与地址的旧视图。
     * 2、创建视图、设置边界和浏览器兼容信息，再加载地址。
     * 3、缓存视图记录，在导航和页面就绪后同步主题。
     */
    ipcMain.handle('browserview:open', async (event, { url, partition = 'persist:doubao', bounds, enableDevTools = false, theme, nativeTheme: useNative } = {}) => {
      try {
        // 1、每个视图通过分区和地址共同定位。
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) return { success: false, error: '窗口不存在' }

        // 如果已有同分区的视图，先移除
        const key = partition + ':' + (url || '')
        const existing = globalBrowserViews.get(key)
        if (existing) {
          try { removeView(window, existing.view) } catch (_) {}
          try { existing.view.destroy() } catch (_) {}
          globalBrowserViews.delete(key)
        }

        // 2、创建隔离的网页视图并挂载到调用窗口。
        const view = new BrowserView({
          webPreferences: {
            partition,
            preload: undefined,
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true,
            devTools: enableDevTools,
            webSecurity: false
          }
        })


        addView(window, view)

        // 边界：默认铺满除顶部工具栏外区域，由渲染层传入
        const winBounds = window.getContentBounds()
        const finalBounds = bounds || { x: 0, y: winBounds.y || 0, width: winBounds.width, height: winBounds.height }
        setViewBounds(view, finalBounds)
        setViewAutoResize(window, view, { width: true, height: true })

        // 伪装 UA，移除 Electron 标识，避免站点降级能力
        try {
          const rawUA = view.webContents.getUserAgent()
          const sanitized = rawUA.replace(/ Electron\/.+? /, ' ').trim()
          view.webContents.setUserAgent(sanitized)
        } catch (_) {}

        if (url) await view.webContents.loadURL(url)

        // 3、保存视图引用，并在网页生命周期内重新应用主题。
        const record = { view, window, useNative }
        globalBrowserViews.set(key, record)

        if (theme) scheduleApplyTheme(view, theme, useNative)

        /**
         * 在网页导航或就绪后重新应用当前主题。
         * 处理流程：
         * 1、优先使用指定主题，否则读取系统主题后发起同步。
         */
        const reapply = () => scheduleApplyTheme(view, theme || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'), record.useNative)
        view.webContents.on('dom-ready', () => setTimeout(reapply, 50))
        view.webContents.on('did-finish-load', () => setTimeout(reapply, 0))
        view.webContents.on('did-navigate', () => setTimeout(reapply, 100))
        view.webContents.on('did-navigate-in-page', () => setTimeout(reapply, 100))
        for (let i = 1; i <= 3; i++) setTimeout(reapply, i * 300)

        return { success: true }
      } catch (error) {
        console.error('BrowserView 打开失败:', error)
        return { success: false, error: error.message }
      }
    })

    /**
     * 关闭并销毁指定内嵌网页视图。
     * 处理流程：
     * 1、根据分区与地址查询记录。
     * 2、从窗口移除视图，销毁并删除缓存引用。
     */
    ipcMain.handle('browserview:close', async (event, { partition = 'persist:doubao', url } = {}) => {
      try {
        // 1、使用与打开入口一致的键定位视图。
        const key = partition + ':' + (url || '')
        const record = globalBrowserViews.get(key)
        if (record) {
          // 2、释放窗口挂载和视图引用。
          try { removeView(record.window, record.view) } catch (_) {}
          try { record.view.destroy() } catch (_) {}
          globalBrowserViews.delete(key)
        }
        return { success: true }
      } catch (error) {
        console.error('BrowserView 关闭失败:', error)
        return { success: false, error: error.message }
      }
    })

    /**
     * 更新指定内嵌视图的显示区域。
     * 处理流程：
     * 1、定位视图，存在新边界时调用兼容接口更新。
     */
    ipcMain.handle('browserview:setBounds', async (event, { partition = 'persist:doubao', url, bounds } = {}) => {
      try {
        // 1、仅更新已创建视图的边界。
        const key = partition + ':' + (url || '')
        const record = globalBrowserViews.get(key)
        if (!record) return { success: false, error: '视图不存在' }
        if (bounds) setViewBounds(record.view, bounds)
        return { success: true }
      } catch (error) {
        console.error('BrowserView setBounds 失败:', error)
        return { success: false, error: error.message }
      }
    })

    /**
     * 更新指定内嵌网页的主题模式。
     * 处理流程：
     * 1、保存主题注入选项并发起主题同步。
     */
    ipcMain.handle('browserview:applyTheme', async (event, { partition = 'persist:doubao', url, scheme, nativeTheme: useNative } = {}) => {
      try {
        // 1、未指定颜色方案时使用系统当前主题。
        const key = partition + ':' + (url || '')
        const record = globalBrowserViews.get(key)
        if (!record) return { success: false, error: '视图不存在' }

        record.useNative = useNative
        scheduleApplyTheme(record.view, scheme || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light'), record.useNative)

        return { success: true }
      } catch (error) {
        console.error('BrowserView 应用主题失败:', error)
        return { success: false, error: error.message }
      }
    })

    /**
     * 刷新内嵌网页并重新同步主题。
     * 处理流程：
     * 1、定位视图并优先忽略缓存刷新。
     * 2、延迟重新应用当前系统主题。
     */
    ipcMain.handle('browserview:reload', async (event, { partition = 'persist:doubao', url } = {}) => {
      try {
        // 1、视图不存在时返回明确错误。
        const key = partition + ':' + (url || '')
        const record = globalBrowserViews.get(key)
        if (!record) return { success: false, error: '视图不存在' }
        try { record.view.webContents.reloadIgnoringCache() } catch (_) { record.view.webContents.reload() }

        // 2、页面刷新后分次同步主题，覆盖不同的加载时机。
        const scheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
        setTimeout(() => scheduleApplyTheme(record.view, scheme, record.useNative), 150)
        setTimeout(() => scheduleApplyTheme(record.view, scheme, record.useNative), 400)

        return { success: true }
      } catch (error) {
        console.error('BrowserView 刷新失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 3、接收豆包视图内发起的拖拽，生成文件并触发系统拖拽。
    /**
     * 保存内嵌网页图片并立即发起系统拖拽。
     * 处理流程：
     * 1、验证宿主和图片数据，保存图片到应用图片目录。
     * 2、从图片生成拖拽图标，失败时使用可用的替代图标。
     * 3、调用宿主页面的系统拖拽接口并返回文件路径。
     */
    ipcMain.handle('doubao:drag-start', async (event, payload) => {
      try {
        // 1、取得有效宿主并将网页图片解码落盘。
        const window = getOwningWindowForWebContents(event.sender)
        if (!window) return { success: false, error: '窗口不存在' }
        const { dataURL, fileName, mimeType, iconSize } = payload || {}
        if (!dataURL) return { success: false, error: '数据为空' }

        // 写临时文件
        const base64 = String(dataURL).replace(/^data:[^;]+;base64,/, '')
        const buffer = Buffer.from(base64, 'base64')
        const ext = (mimeType && mimeType.includes('jpeg')) ? '.jpg' : '.png'
        const name = (fileName && String(fileName).trim()) || `doubao_${Date.now()}${ext}`
        // 保存到与纳米香蕉一致的根目录（Pictures/MomentumStickFigure）
        const picturesDir = getPicturesDirectory ? getPicturesDirectory() : app.getPath('pictures')
        const targetDir = path.join(picturesDir, 'MomentumStickFigure')
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
        const finalPath = path.join(targetDir, name)
        fs.writeFileSync(finalPath, buffer)

        // 2、构建拖拽图标，优先使用网页图片内容。
        let dragIcon = null
        try {
          const image = nativeImage.createFromDataURL(dataURL)
          const size = Number(iconSize) > 0 ? Number(iconSize) : 96
          dragIcon = image.isEmpty() ? null : image.resize({ width: size, height: size })
        } catch (_) {}
        if (!dragIcon) dragIcon = nativeImage.createFromPath(finalPath)
        if (!dragIcon || dragIcon.isEmpty()) dragIcon = nativeImage.createEmpty()

        // 3、触发系统拖拽，同时提供单文件路径与文件数组。
        window.webContents.startDrag({ file: finalPath, files: [finalPath], icon: dragIcon })
        return { success: true, path: finalPath }
      } catch (error) {
        console.error('doubao:drag-start 失败:', error)
        return { success: false, error: error.message }
      }
    })

    /**
     * 异步准备内嵌网页的拖拽图片文件。
     * 处理流程：
     * 1、检查编码内容并确定文件名与图片目录。
     * 2、写入图片并返回路径及媒体类型。
     */
    ipcMain.handle('doubao:prepare-file-async', async (_event, payload) => {
      try {
        // 1、将网页图片准备为后续同步拖拽可直接使用的文件。
        const { base64, fileName, mimeType } = payload || {}
        if (!base64) return { success: false, error: 'base64 empty' }
        const ext = (mimeType && /jpe?g/i.test(mimeType)) ? '.jpg' : '.png'
        const safeName = (fileName && String(fileName).trim()) || `doubao_${Date.now()}${ext}`
        const picturesDir = getPicturesDirectory ? getPicturesDirectory() : app.getPath('pictures')
        const targetDir = path.join(picturesDir, 'MomentumStickFigure')
        if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
        const finalPath = path.join(targetDir, safeName)
        // 2、写入图片字节并返回本地文件定位信息。
        const buffer = Buffer.from(base64, 'base64')
        fs.writeFileSync(finalPath, buffer)
        return { success: true, path: finalPath, mime: mimeType || 'image/png' }
      } catch (e) {
        return { success: false, error: e?.message }
      }
    })

    /**
     * 在拖拽事件调用栈内同步启动系统拖拽。
     * 处理流程：
     * 1、验证原宿主、并发状态和隐藏拖拽宿主。
     * 2、记录诊断信息并按平台准备图标。
     * 3、发起拖拽，通过同步返回值反馈结果并复位状态。
     */
    ipcMain.on('doubao:start-drag-sync', (event, { filePath, iconPath }) => {
      try {
        // 1、禁止宿主已销毁或已有拖拽进行时重复启动。
        const owner = getOwningWindowForWebContents(event.sender)
        if (!owner || owner.isDestroyed() || !owner.webContents || owner.webContents.isDestroyed()) {
          event.returnValue = { success: false, error: 'owner window not found or destroyed' }
          return
        }

        if (__doubaoDragging) {
          event.returnValue = { success: false, error: 'drag in progress' }
          return
        }

        const host = ensureDragHostWindow()
        if (!host || host.isDestroyed()) {
          event.returnValue = { success: false, error: 'drag host unavailable' }
          return
        }

        // 2、用本次诊断标识关联文件信息与后续拖拽事件。
        const diagId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        let fileStat = null
        try { fileStat = fs.statSync(filePath) } catch (_) {}
        writeDiag('drag.begin', { diagId, platform: process.platform, filePath, fileSize: fileStat?.size || 0, ownerId: owner.id, hostId: host.id })

        // 安全图标（Windows 强制空图标）
        let icon = nativeImage.createEmpty()
        if (process.platform !== 'win32') {
          try {
            const fromFile = nativeImage.createFromPath(filePath)
            if (fromFile && !fromFile.isEmpty()) icon = fromFile.resize({ width: 96, height: 96, quality: 'best' })
          } catch (_) { icon = nativeImage.createEmpty() }
        }

        // 3、由隐藏窗口承担系统拖拽，结束或异常后允许下次操作。
        if (host.webContents && !host.webContents.isDestroyed()) {
          try {
            __doubaoDragging = true
            if (process.platform === 'win32') {
              host.webContents.startDrag({ file: filePath, files: [filePath], icon: nativeImage.createEmpty() })
            } else {
              host.webContents.startDrag({ file: filePath, files: [filePath], icon })
            }

            writeDiag('drag.startDrag.called', { diagId })
            setTimeout(() => { __doubaoDragging = false; writeDiag('drag.reset', { diagId, by: 'timeout-host' }) }, 2000)

            event.returnValue = { success: true }
          } catch (dragErr) {
            __doubaoDragging = false
            writeDiag('drag.error', { diagId, error: dragErr?.message })
            event.returnValue = { success: false, error: dragErr.message }
          }
        } else {
          event.returnValue = { success: false, error: 'host webContents destroyed' }
        }
      } catch (error) {
        writeDiag('drag.exception', { error: error?.message })
        event.returnValue = { success: false, error: error.message }
      }
    })

    console.log('✓ BrowserView 处理器已注册')
  }

  /**
   * 移除视图基础处理器并销毁仍存活的内嵌视图。
   * 处理流程：
   * 1、移除打开、关闭和边界设置处理器。
   * 2、卸载并销毁缓存视图，清空索引。
   */
  function unregisterBrowserViewHandlers() {
    // 1、移除基础视图控制处理器。
    ipcMain.removeHandler('browserview:open')
    ipcMain.removeHandler('browserview:close')
    ipcMain.removeHandler('browserview:setBounds')
    // 2、清理所有残留视图并释放缓存引用。
    for (const { view, window } of globalBrowserViews.values()) {
      try { removeView(window, view) } catch (_) {}
      try { view?.destroy() } catch (_) {}
    }
    globalBrowserViews.clear()
    console.log('✓ BrowserView 处理器已移除')
  }

  return { registerBrowserViewHandlers, unregisterBrowserViewHandlers }
}
