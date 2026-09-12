/**
 * 窗口控制模块：管理主窗口、画布预览窗口以及窗口控制和全局快捷键通信。
 */
import { app, BrowserWindow, shell, ipcMain, nativeTheme, globalShortcut } from 'electron'
import { is } from '@electron-toolkit/utils'
import path from 'path'
// 导入快捷键存储
import { getHotkeysConfig, saveHotkeysConfig } from './hotkeys-storage.js'

/**
 * 创建窗口控制器，集中保存主窗口和预览窗口引用。
 * 处理流程：
 * 1、在控制器内部保存唯一的主窗口和预览窗口引用。
 * 2、使用入口传入的目录解析预加载脚本和页面路径。
 * 3、返回窗口创建、窗口控制和快捷键注册清理函数，由入口按原顺序调用。
 */
export function createWindowController({ mainDirectory }) {
  // 全局窗口引用
  let mainWindow = null

  /**
   * 创建并初始化应用主窗口。
   * 处理流程：
   * 1、创建窗口并配置会话请求和响应规则。
   * 2、绑定显示、关闭、还原以及外部导航事件。
   * 3、注册主题与内嵌页面权限桥接。
   * 4、根据运行环境加载页面。
   */
  function createWindow() {
    // 1、创建隐藏窗口，等待页面就绪后显示。
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(mainDirectory, '../preload/index.mjs'),
        sandbox: false,
        nodeIntegration: false,
        contextIsolation: true,
        enableRemoteModule: false,
        webSecurity: false, // 允许跨域请求
        devTools: true,
        webviewTag: true // 启用 webview 标签
      }
    })


    // 处理 OPTIONS 预检请求（CORS 预检）
    mainWindow.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      // 如果是 OPTIONS 请求（CORS 预检），直接通过
      if (details.method === 'OPTIONS') {
        callback({})
        return
      }
      callback({})
    })

    // 设置 Content Security Policy 和 CORS 头 (通过 HTTP 头设置，支持所有指令包括 frame-ancestors)
    mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      const responseHeaders = { ...details.responseHeaders || {} }

      // 添加 CORS 头，允许视频播放
      const url = details.url
      const isVideo = url && (
        url.includes('.mp4') ||
        url.includes('.webm') ||
        url.includes('.ogg') ||
        url.includes('.mov') ||
        url.includes('video') ||
        (details.responseHeaders && details.responseHeaders['content-type']?.some(type => type.includes('video/')))
      )

      if (isVideo || details.method === 'OPTIONS') {
        // 为视频文件添加 CORS 头
        responseHeaders['Access-Control-Allow-Origin'] = ['*']
        responseHeaders['Access-Control-Allow-Methods'] = ['GET', 'HEAD', 'OPTIONS', 'POST']
        responseHeaders['Access-Control-Allow-Headers'] = ['Range', 'Content-Type', 'Accept', 'Origin', 'X-Requested-With']
        responseHeaders['Access-Control-Expose-Headers'] = ['Content-Length', 'Content-Range', 'Accept-Ranges']
        responseHeaders['Access-Control-Max-Age'] = ['86400'] // 24小时

        // 如果是 OPTIONS 请求，返回 204 状态码
        if (details.method === 'OPTIONS') {
          callback({
            responseHeaders,
            statusCode: 204
          })
          return
        }
      }

      // 设置 Content Security Policy
      responseHeaders['Content-Security-Policy'] = [
        is.dev
          ? "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http://localhost:* ws://localhost:*; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:*; style-src 'self' 'unsafe-inline' http://localhost:*; img-src 'self' data: blob: https: http://localhost:*; font-src 'self' data:; connect-src 'self' https: http://localhost:* ws://localhost:*; frame-src 'self' https:; media-src * data: blob: https: http:; frame-ancestors 'none';"
          : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'self' https:; media-src * data: blob: https: http:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"
      ]

      callback({ responseHeaders })
    })

    // 2、维护窗口生命周期，同时照管独立预览窗口。
    mainWindow.on('ready-to-show', () => {
      mainWindow.show()
    })

    // 监听主窗口关闭事件，同时关闭预览窗口
    mainWindow.on('close', () => {
      console.log('[主窗口] 正在关闭，同时关闭预览窗口...')
      if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
        try {
          canvasPreviewWindow.close()
          canvasPreviewWindow = null
          console.log('[主窗口] ✅ 预览窗口已关闭')
        } catch (error) {
          console.error('[主窗口] 关闭预览窗口失败:', error)
        }
      }
    })


    // 监听窗口从最大化还原事件
    // 当用户点击系统原生的"还原"按钮时，确保窗口回到合理的默认位置（居中显示）
    mainWindow.on('unmaximize', () => {
      const { screen } = require('electron')
      const primaryDisplay = screen.getPrimaryDisplay()
      const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

      // 计算默认窗口尺寸和位置（宽度0.6倍，高度0.8倍，居中显示）
      const defaultWidth = Math.floor(screenWidth * 0.6)
      const defaultHeight = Math.floor(screenHeight * 0.8)
      const defaultX = Math.floor((screenWidth - defaultWidth) / 2)
      const defaultY = Math.floor((screenHeight - defaultHeight) / 2)

      // 设置窗口为默认尺寸和位置（居中显示）
      mainWindow.setBounds({
        x: defaultX,
        y: defaultY,
        width: defaultWidth,
        height: defaultHeight
      }, true)  // 使用动画

      console.log('[窗口] 从最大化还原到默认位置:', `${defaultWidth}x${defaultHeight}，位置: (${defaultX}, ${defaultY})`)
    })

    mainWindow.webContents.setWindowOpenHandler((details) => {
      shell.openExternal(details.url)
      return { action: 'deny' }
    })

    // 3、主题桥接：允许渲染层或预加载调整系统首选颜色方案供外部网页检测。
    ipcMain.removeHandler('theme:setPreferredColorScheme')
    ipcMain.handle('theme:setPreferredColorScheme', (_event, scheme) => {
      try {
        if (scheme === 'dark' || scheme === 'light') {
          nativeTheme.themeSource = scheme
          return { success: true }
        }
        nativeTheme.themeSource = 'system'
        return { success: true }
      } catch (e) {
        return { success: false, error: e?.message }
      }
    })

    // 处理 webview 权限请求
    mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
      const allowedPermissions = ['media', 'geolocation', 'notifications', 'fullscreen']
      if (allowedPermissions.includes(permission)) {
        callback(true)
      } else {
        callback(false)
      }
    })

    // 监听 webview 附加事件，为每个 webview 设置权限
    app.on('web-contents-created', (event, contents) => {
      if (contents.getType() === 'webview') {
        console.log('[Webview] 新的 webview 已创建')

        // 允许 webview 导航
        contents.setWindowOpenHandler((details) => {
          shell.openExternal(details.url)
          return { action: 'deny' }
        })

        // 设置 webview 权限
        contents.session.setPermissionRequestHandler((webContents, permission, callback) => {
          const allowedPermissions = ['media', 'notifications', 'geolocation', 'fullscreen']
          callback(allowedPermissions.includes(permission))
        })

      }
    })

    // 4、开发环境加载开发服务，打包环境加载本地入口。
    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      mainWindow.loadFile(path.join(mainDirectory, '../renderer/index.html'))
    }

    if (is.dev) mainWindow.webContents.openDevTools()

  }

  // 注册窗口控制处理器
  // ==================== 画布预览窗口管理 ====================
  let canvasPreviewWindow = null

  /**
   * 注册预览窗口和应用窗口控制接口。
   * 处理流程：
   * 1、提供预览窗口创建与关闭入口。
   * 2、同步画布、主题、文件名与视图重置消息。
   * 3、管理窗口置顶状态和显示模式。
   */
  function registerWindowControlHandlers() {
    // 1、创建或复用独立预览窗口，并提供关闭入口。
    ipcMain.handle('canvas-preview-create', async (event) => {
      try {
        // 如果窗口已存在，直接显示并聚焦
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          canvasPreviewWindow.show()
          canvasPreviewWindow.focus()
          return { success: true, existed: true }
        }

        // 创建新的预览窗口
        canvasPreviewWindow = new BrowserWindow({
          width: 800,
          height: 600,
          title: '预览图',
          alwaysOnTop: true,
          autoHideMenuBar: true,
          backgroundColor: '#1a1a1a',
          webPreferences: {
            preload: path.join(mainDirectory, '../preload/index.mjs'),
            sandbox: false,
            nodeIntegration: false,
            contextIsolation: true,
            enableRemoteModule: false,
            webSecurity: false,
            devTools: true
          }
        })

        // 设置最高的置顶层级（screen-saver-level），确保始终在所有窗口之上
        canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')

        // 开发者工具策略

        // 监听窗口关闭事件
        canvasPreviewWindow.on('closed', () => {
          canvasPreviewWindow = null
          console.log('[预览窗口] 窗口已关闭')
        })

        // 监听窗口失去焦点事件，确保保持在最上层
        canvasPreviewWindow.on('blur', () => {
          if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed() && canvasPreviewWindow.isAlwaysOnTop()) {
            // 立即重新设置为最高层级
            canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')
          }
        })

        // 监听窗口显示事件，确保保持在最上层
        canvasPreviewWindow.on('show', () => {
          if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed() && canvasPreviewWindow.isAlwaysOnTop()) {
            canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')
          }
        })

        // 加载预览页面
        if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
          await canvasPreviewWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/canvas-preview.html`)
        } else {
          await canvasPreviewWindow.loadFile(path.join(mainDirectory, '../renderer/canvas-preview.html'))
        }

        console.log('[预览窗口] 创建成功')
        return { success: true, existed: false }
      } catch (error) {
        console.error('[预览窗口] 创建失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 关闭画布预览窗口
    ipcMain.handle('canvas-preview-close', async () => {
      try {
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          canvasPreviewWindow.close()
          canvasPreviewWindow = null
        }
        return { success: true }
      } catch (error) {
        console.error('[预览窗口] 关闭失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 2、兼容图片数据格式，转发画布及其他预览状态。
    ipcMain.handle('canvas-preview-update', async (event, imagePayload) => {
      try {
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          let payloadToSend = imagePayload

          // 兼容老版本字符串，同时支持新格式的二进制缓冲
          if (imagePayload && typeof imagePayload === 'object' && imagePayload.buffer) {
            const { buffer, width, height, mimeType, dataUrl } = imagePayload

            if (buffer) {
              let nodeBuffer = null
              if (Buffer.isBuffer(buffer)) {
                nodeBuffer = buffer
              } else if (buffer instanceof ArrayBuffer) {
                nodeBuffer = Buffer.from(new Uint8Array(buffer))
              } else if (ArrayBuffer.isView(buffer)) {
                nodeBuffer = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength)
              }

              if (nodeBuffer) {
                payloadToSend = {
                  buffer: nodeBuffer,
                  width,
                  height,
                  mimeType: mimeType || 'image/png'
                }
              } else if (dataUrl) {
                // 兜底为 dataUrl
                payloadToSend = {
                  dataUrl,
                  width,
                  height,
                  mimeType: mimeType || 'image/png'
                }
              }
            }
          } else if (typeof imagePayload === 'string') {
            payloadToSend = {
              dataUrl: imagePayload,
              mimeType: 'image/png'
            }
          }

          canvasPreviewWindow.webContents.send('canvas-update', payloadToSend)

          // 画布更新时强制保持最高置顶层级
          if (canvasPreviewWindow.isAlwaysOnTop()) {
            canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')
          }

          return { success: true }
        }
        return { success: false, error: '预览窗口不存在' }
      } catch (error) {
        console.error('[预览窗口] 更新失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 同步主题到预览窗口
    ipcMain.handle('canvas-preview-sync-theme', async (event, theme) => {
      try {
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          canvasPreviewWindow.webContents.send('theme-update', theme)
          return { success: true }
        }
        return { success: false, error: '预览窗口不存在' }
      } catch (error) {
        console.error('[预览窗口] 主题同步失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 更新预览窗口文件名
    ipcMain.handle('canvas-preview-update-filename', async (event, fileName) => {
      try {
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          canvasPreviewWindow.webContents.send('canvas-filename-update', fileName)
          return { success: true }
        }
        return { success: false, error: '预览窗口不存在' }
      } catch (error) {
        console.error('[预览窗口] 文件名同步失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 重置预览窗口视图状态（切换PSD时调用）
    ipcMain.handle('canvas-preview-reset-viewport', async () => {
      try {
        if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
          canvasPreviewWindow.webContents.send('canvas-viewport-reset')
          console.log('[预览窗口] 已发送视图重置命令')
          return { success: true }
        }
        return { success: false, error: '预览窗口不存在' }
      } catch (error) {
        console.error('[预览窗口] 视图重置失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 3、控制窗口置顶状态以及插件、软件两种窗口尺寸模式。
    ipcMain.handle('window-set-always-on-top', async (event, flag) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (window) {
          // 判断是否是预览窗口
          const isPreviewWindow = window === canvasPreviewWindow

          if (isPreviewWindow && flag) {
            // 预览窗口置顶时使用最高的层级（screen-saver）
            window.setAlwaysOnTop(true, 'screen-saver')
            console.log('[预览窗口] 设置最高优先级置顶（screen-saver）')
          } else {
            // 其他窗口或取消置顶使用默认层级
            window.setAlwaysOnTop(flag)
            console.log('窗口置顶状态:', flag)
          }

          return { success: true, alwaysOnTop: flag }
        }
        return { success: false, error: '窗口不存在' }
      } catch (error) {
        console.error('设置窗口置顶失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 获取窗口置顶状态
    ipcMain.handle('window-get-always-on-top', async (event) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (window) {
          const isAlwaysOnTop = window.isAlwaysOnTop()
          return { success: true, alwaysOnTop: isAlwaysOnTop }
        }
        return { success: false, error: '窗口不存在' }
      } catch (error) {
        console.error('获取窗口置顶状态失败:', error)
        return { success: false, error: error.message }
      }
    })

    // 设置窗口大小和位置（插件模式/软件模式）
    ipcMain.handle('window-set-mode', async (event, mode) => {
      try {
        const window = BrowserWindow.fromWebContents(event.sender)
        if (!window) {
          return { success: false, error: '窗口不存在' }
        }

        const { screen } = require('electron')
        const primaryDisplay = screen.getPrimaryDisplay()
        const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize

        // 计算默认窗口尺寸和位置（宽度0.6倍，高度0.8倍，居中显示）
        const defaultWidth = Math.floor(screenWidth * 0.6)
        const defaultHeight = Math.floor(screenHeight * 0.8)
        const defaultX = Math.floor((screenWidth - defaultWidth) / 2)
        const defaultY = Math.floor((screenHeight - defaultHeight) / 2)

        if (mode === 'plugin') {
          // 插件模式：宽度为屏幕的30%，高度95%，靠左显示并垂直居中
          // 先取消最大化状态，确保可以设置边界
          if (window.isMaximized()) {
            // 如果当前是最大化状态，先还原到默认位置
            window.unmaximize()
            // 短暂延迟，让unmaximize生效
            await new Promise(resolve => setTimeout(resolve, 100))
          }

          const windowWidth = Math.floor(screenWidth * 0.3)
          const windowHeight = Math.floor(screenHeight * 0.95)
          const x = 0  // 靠左显示
          const y = Math.floor((screenHeight - windowHeight) / 2)  // 垂直居中

          // 使用 setBounds 设置窗口位置和大小
          window.setBounds({
            x: x,
            y: y,
            width: windowWidth,
            height: windowHeight
          }, true)  // animate 参数设为 true

          console.log(`设置为插件模式: ${windowWidth}x${windowHeight}，位置: (${x}, ${y})`)
        } else if (mode === 'software') {
          // 软件模式：先设置为默认尺寸和位置，然后最大化
          // 这样当用户点击系统原生的"还原"按钮时，窗口会还原到居中的默认位置
          if (window.isMaximized()) {
            window.unmaximize()
          }

          // 先设置默认位置和尺寸（这将成为"还原"时的状态）
          window.setBounds({
            x: defaultX,
            y: defaultY,
            width: defaultWidth,
            height: defaultHeight
          }, false)  // 不使用动画，快速设置

          // 延迟一下再最大化，确保上面的设置生效
          setTimeout(() => {
            window.maximize()
          }, 50)

          console.log('设置为软件模式（最大化）')
          console.log(`还原位置: ${defaultWidth}x${defaultHeight}，位置: (${defaultX}, ${defaultY})`)
        }

        return { success: true, mode: mode }
      } catch (error) {
        console.error('设置窗口模式失败:', error)
        return { success: false, error: error.message }
      }
    })

    console.log('✓ 窗口控制处理器已注册')
  }

  /**
   * 关闭画布预览并清理窗口控制监听。
   * 处理流程：
   * 1、关闭存活的预览窗口并释放引用。
   * 2、移除预览与窗口控制通道的事件监听。
   */
  function unregisterWindowControlHandlers() {
    // 1、清理画布预览窗口。
    if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
      canvasPreviewWindow.close()
      canvasPreviewWindow = null
    }

    // 2、移除预览同步与窗口控制监听。
    ipcMain.removeAllListeners('canvas-preview-create')
    ipcMain.removeAllListeners('canvas-preview-close')
    ipcMain.removeAllListeners('canvas-preview-update')
    ipcMain.removeAllListeners('canvas-preview-update-filename')
    ipcMain.removeAllListeners('canvas-preview-sync-theme')
    ipcMain.removeAllListeners('canvas-preview-reset-viewport')
    ipcMain.removeAllListeners('window-set-always-on-top')
    ipcMain.removeAllListeners('window-get-always-on-top')
    ipcMain.removeAllListeners('window-set-mode')
    console.log('✓ 窗口控制处理器已移除')
  }

  // ==================== 全局快捷键管理 ====================

  /**
   * 注册全局快捷键
   * 处理流程：
   * 1、注销旧快捷键并读取本次配置。
   * 2、注册主窗口显示切换。
   * 3、注册预览窗口切换，必要时创建预览窗口。
   */
  function registerGlobalHotkeys(hotkeysConfig = null) {
    try {
      // 1、先注销所有已注册的快捷键，再获取本次配置。
      globalShortcut.unregisterAll()

      // 如果没有传入配置，尝试从存储中加载
      if (!hotkeysConfig) {
        hotkeysConfig = getHotkeysConfig()
      }

      console.log('[快捷键] 准备注册全局快捷键:', hotkeysConfig)

      // 2、注册主窗口快捷键。
      if (hotkeysConfig.toggleMainWindow) {
        const success = globalShortcut.register(hotkeysConfig.toggleMainWindow, () => {
          console.log(`[快捷键] 触发主窗口切换: ${hotkeysConfig.toggleMainWindow}`)
          if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isVisible() && mainWindow.isFocused()) {
              mainWindow.minimize()
              console.log('[快捷键] 主窗口已最小化')
            } else {
              mainWindow.restore()
              mainWindow.show()
              mainWindow.focus()
              console.log('[快捷键] 主窗口已唤醒')
            }
          }
        })

        if (success) {
          console.log(`[快捷键] ✅ 主窗口快捷键注册成功: ${hotkeysConfig.toggleMainWindow}`)
        } else {
          console.error(`[快捷键] ❌ 主窗口快捷键注册失败: ${hotkeysConfig.toggleMainWindow}`)
        }
      }

      // 3、注册预览窗口快捷键，兼容窗口尚未创建的情况。
      if (hotkeysConfig.togglePreviewWindow) {
        const success = globalShortcut.register(hotkeysConfig.togglePreviewWindow, async () => {
          console.log(`[快捷键] 触发预览窗口切换: ${hotkeysConfig.togglePreviewWindow}`)

          if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed()) {
            // 窗口已存在，执行切换逻辑
            if (canvasPreviewWindow.isVisible() && canvasPreviewWindow.isFocused()) {
              canvasPreviewWindow.minimize()
              console.log('[快捷键] 预览窗口已最小化')
            } else {
              canvasPreviewWindow.restore()
              canvasPreviewWindow.show()
              canvasPreviewWindow.focus()
              console.log('[快捷键] 预览窗口已唤醒')
            }
          } else {
            // 窗口不存在，自动创建并打开
            console.log('[快捷键] 预览窗口不存在，正在创建...')
            try {
              canvasPreviewWindow = new BrowserWindow({
                width: 800,
                height: 600,
                title: '预览图',
                alwaysOnTop: true,
                autoHideMenuBar: true,
                backgroundColor: '#1a1a1a',
                webPreferences: {
                  preload: path.join(mainDirectory, '../preload/index.mjs'),
                  sandbox: false,
                  nodeIntegration: false,
                  contextIsolation: true,
                  enableRemoteModule: false,
                  webSecurity: false,
                  devTools: true
                }
              })

              // 开发者工具策略

              // 监听窗口关闭事件
              canvasPreviewWindow.on('closed', () => {
                canvasPreviewWindow = null
                console.log('[快捷键] 预览窗口已关闭')
              })

              // 监听窗口失去焦点事件，确保保持在最上层
              canvasPreviewWindow.on('blur', () => {
                if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed() && canvasPreviewWindow.isAlwaysOnTop()) {
                  canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')
                }
              })

              // 监听窗口显示事件，确保保持在最上层
              canvasPreviewWindow.on('show', () => {
                if (canvasPreviewWindow && !canvasPreviewWindow.isDestroyed() && canvasPreviewWindow.isAlwaysOnTop()) {
                  canvasPreviewWindow.setAlwaysOnTop(true, 'screen-saver')
                }
              })

              // 加载预览页面
              if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
                await canvasPreviewWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/canvas-preview.html`)
              } else {
                await canvasPreviewWindow.loadFile(path.join(mainDirectory, '../renderer/canvas-preview.html'))
              }

              console.log('[快捷键] 预览窗口创建成功')
            } catch (error) {
              console.error('[快捷键] 创建预览窗口失败:', error)
            }
          }
        })

        if (success) {
          console.log(`[快捷键] ✅ 预览窗口快捷键注册成功: ${hotkeysConfig.togglePreviewWindow}`)
        } else {
          console.error(`[快捷键] ❌ 预览窗口快捷键注册失败: ${hotkeysConfig.togglePreviewWindow}`)
        }
      }
    } catch (error) {
      console.error('[快捷键] 注册全局快捷键失败:', error)
    }
  }

  /**
   * 注册快捷键相关的 IPC 处理器
   * 处理流程：
   * 1、接收新配置，保存后重新注册全局快捷键。
   */
  function registerHotkeyHandlers() {
    // 1、更新快捷键配置并立即应用。
    ipcMain.handle('hotkeys-update', async (event, hotkeysConfig) => {
      try {
        console.log('[快捷键] 收到更新请求:', hotkeysConfig)

        // 保存配置到存储
        saveHotkeysConfig(hotkeysConfig)

        // 重新注册全局快捷键
        registerGlobalHotkeys(hotkeysConfig)

        return { success: true }
      } catch (error) {
        console.error('[快捷键] 更新失败:', error)
        return { success: false, error: error.message }
      }
    })

    console.log('✓ 快捷键处理器已注册')
  }

  /**
   * 注销快捷键处理器
   * 处理流程：
   * 1、注销系统快捷键。
   * 2、移除配置更新通道的事件监听。
   */
  function unregisterHotkeyHandlers() {
    // 1、注销所有全局快捷键。
    globalShortcut.unregisterAll()

    // 2、移除进程通信监听器。
    ipcMain.removeAllListeners('hotkeys-update')

    console.log('✓ 快捷键处理器已移除')
  }

  return {
    createWindow,
    registerWindowControlHandlers,
    unregisterWindowControlHandlers,
    registerGlobalHotkeys,
    registerHotkeyHandlers,
    unregisterHotkeyHandlers
  }
}
