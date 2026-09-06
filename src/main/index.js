/**
 * 主进程入口：管理应用窗口、系统交互、内嵌网页以及各业务模块的进程通信。
 */
import { app, BrowserWindow, BrowserView, shell, dialog, ipcMain, Menu, MenuItem, clipboard, nativeImage, nativeTheme, session, globalShortcut } from 'electron'
import { electronApp, is } from '@electron-toolkit/utils'
import path from 'path'
import os from 'os'
// 放开第三方存储分区隔离，提升第三方登录/跨域站点兼容性（如豆包站）
app.commandLine.appendSwitch('disable-features', 'ThirdPartyStoragePartitioning')

// 解决 Windows 下 Electron 中文乱码问题
if (process.platform === 'win32') {
  // 在 Electron 中使用 chcp 命令设置控制台代码页为 UTF-8
  try {
    const { spawn } = require('child_process')
    spawn('chcp', ['65001'], { stdio: 'ignore', shell: true })
  } catch (error) {
    console.warn('设置控制台编码失败:', error.message)
  }
  
  // 设置环境变量以支持 UTF-8
  process.env.PYTHONIOENCODING = 'utf-8'
  process.env.LC_ALL = 'zh_CN.UTF-8'
}

// 导入 gemini 服务
import { registerFalApiHandlers, unregisterFalApiHandlers } from './gemini-image-api/gemini-image-ipc.js'
// 导入 PSD 服务
import { registerPSDApiHandlers, unregisterPSDApiHandlers } from './psd-service.js'
// 导入Storage服务
import { registerStorageHandlers, unregisterStorageHandlers } from './storage-handler.js'
// 导入字体服务
import { registerFontServiceHandlers } from './font-service-handler.js'
// 导入快捷键存储
import { getHotkeysConfig, saveHotkeysConfig } from './hotkeys-storage.js'
// 导入抠图高清服务
import { registerHdServiceHandlers, unregisterHdServiceHandlers } from './hd-service.js'
// 导入视频字幕OCR服务
import { registerVideoOcrServiceHandlers, unregisterVideoOcrServiceHandlers } from './video-ocr-service.js'
// 导入模板存储服务
import { registerTemplateStorageHandlers, unregisterTemplateStorageHandlers } from './template-storage-service.js'
import { registerPromptTemplateHandlers, unregisterPromptTemplateHandlers } from './prompt-template-service.js'
import fs from 'fs'

// 独立保存免登录版本配置，避免读取旧版的本地数据。
app.setName('momentum-stick-figure-open')
app.setPath('userData', path.join(app.getPath('appData'), 'momentum-stick-figure-open'))
const globalBrowserViews = new Map()

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
      preload: path.join(__dirname, '../preload/index.mjs'),
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
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (is.dev) mainWindow.webContents.openDevTools()

}


/**
 * 应用就绪后初始化系统与业务入口。
 * 处理流程：
 * 1、设置应用标识并隐藏系统菜单。
 * 2、注册业务服务和系统交互处理器。
 * 3、创建主窗口，绑定重新激活行为并注册快捷键。
 */
app.whenReady().then(async () => {
  // 1、初始化系统识别信息与菜单外观。
  electronApp.setAppUserModelId('com.momentum.stickfigure.open')
  Menu.setApplicationMenu(null)

  // 2、注册存储、模型处理以及文件和窗口交互服务。
  // 注册存储服务处理器。
  registerStorageHandlers()

  // 注册字体服务IPC处理器
  registerFontServiceHandlers()
  
  // 注册文件夹选择处理器
  registerFolderSelectHandler()
  
  // 注册文件写入处理器
  registerFileWriteHandler()
  
  // 注册文件操作处理器
  registerFileOperationHandlers()
  
  // 注册自定义对话框处理器
  registerCustomDialogHandlers()
  
  // 注册 Fal.ai IPC 处理器
  registerFalApiHandlers()
  
  // 注册 PSD API IPC 处理器
  registerPSDApiHandlers()

  // 注册模板存储 IPC 处理器
  registerTemplateStorageHandlers()
  registerPromptTemplateHandlers()

  // 注册抠图高清 IPC 处理器
  registerHdServiceHandlers()
  
  // 注册视频字幕OCR IPC 处理器
  registerVideoOcrServiceHandlers()
  
  
  // 注册窗口控制处理器
  registerWindowControlHandlers()
  
  // 注册全局快捷键处理器
  registerHotkeyHandlers()
  
  // 注册 BrowserView 处理器（用于稳定嵌入第三方网页，如豆包）
  registerBrowserViewHandlers()
  
  // 注册Shell处理器
  registerShellHandlers()
  
  // 注册拖拽到剪映相关处理器
  registerDragToJianyingHandlers()
  
  // 注册预设处理器
  registerPresetHandlers()
  
  // 注册设置导入导出处理器
  registerSettingsHandlers()

  // 3、创建主窗口，并在窗口就绪后注册全局快捷键。
  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
  
  // 注册全局快捷键（在窗口创建完成后）
  registerGlobalHotkeys()
})

/**
 * 按平台约定处理全部窗口关闭。
 * 处理流程：
 * 1、非 macOS 平台退出应用，macOS 保留进程响应激活。
 */
app.on('window-all-closed', () => {
  // 1、遵循各平台的窗口关闭行为。
  if (process.platform !== 'darwin') app.quit()
})

/**
 * 应用即将退出时清理业务入口。
 * 处理流程：
 * 1、在窗口完成卸载后调用各模块清理方法。
 * 2、清理窗口、快捷键、网页视图和配置交互监听。
 */
app.on('will-quit', () => {
  // 1、窗口已完成卸载，先清理数据存储与业务处理入口。
  unregisterStorageHandlers()
  unregisterFolderSelectHandler()
  unregisterFileWriteHandler()
  unregisterFileOperationHandlers()
  unregisterCustomDialogHandlers()
  unregisterFalApiHandlers()
  unregisterPSDApiHandlers()
  unregisterTemplateStorageHandlers()
  unregisterPromptTemplateHandlers()
  unregisterHdServiceHandlers()
  unregisterVideoOcrServiceHandlers()
  // 2、清理窗口及系统交互相关的模块监听。
  unregisterWindowControlHandlers()
  unregisterHotkeyHandlers()
  unregisterBrowserViewHandlers()
  unregisterShellHandlers()
  unregisterDragToJianyingHandlers()
  unregisterPresetHandlers()
  unregisterSettingsHandlers()
  

})


/**
 * 注册文件选择、临时图片保存与目录打开接口。
 * 处理流程：
 * 1、提供 PSD、文件夹和通用文件对话框。
 * 2、提供保存位置选择与图片预览数据。
 * 3、保存粘贴图片并提供系统目录打开入口。
 */
function registerFolderSelectHandler() {
  // 1、选择对话框绑定到发起请求的窗口。
  /**
   * 选择一个或多个 PSD 文件。
   * 处理流程：
   * 1、取得调用窗口并显示 PSD 文件筛选对话框。
   * 2、返回所选路径或明确的取消、失败状态。
   */
  ipcMain.handle('select-psd-files', async (event) => {
    try {
      // 1、取得发送请求的窗口，并显示文件选择对话框。
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        title: '选择PSD文件',
        filters: [
          { name: 'PSD文件', extensions: ['psd'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      // 2、将取消选择与正常选择区分返回。
      if (result.canceled) {
        return { success: false, canceled: true, filePaths: [] }
      }
      
      console.log('选择的PSD文件:', result.filePaths)
      
      return { 
        success: true, 
        filePaths: result.filePaths,
        canceled: false 
      }
    } catch (error) {
      console.error('选择PSD文件失败:', error)
      return { success: false, error: error.message, filePaths: [] }
    }
  })
  
  /**
   * 选择项目根目录。
   * 处理流程：
   * 1、显示绑定到调用窗口的目录选择器。
   * 2、返回首个目录路径或取消、失败状态。
   */
  ipcMain.handle('select-folder', async (event) => {
    try {
      // 1、取得调用窗口并显示目录选择器。
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory'],
        title: '选择项目根路径',
        message: '请选择用于存储项目文件的根目录'
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      // 2、取首个已选目录作为项目根路径。
      const folderPath = result.filePaths[0]
      console.log('选择的文件夹:', folderPath)
      
      return { 
        success: true, 
        path: folderPath,
        canceled: false 
      }
    } catch (error) {
      console.error('文件夹选择失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })

  /**
   * 根据页面选项显示通用文件选择器。
   * 处理流程：
   * 1、合并标题、筛选条件与多选设置。
   * 2、显示对话框并返回路径列表及单文件快捷字段。
   */
  ipcMain.handle('select-file', async (event, options = {}) => {
    try {
      // 1、从调用参数构造文件选择选项。
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        properties: ['openFile'],
        title: options.title || '选择文件',
        defaultPath: options.defaultPath,
        filters: Array.isArray(options.filters) ? options.filters : undefined,
        message: options.message
      }
      if (options.multiple) {
        dialogOptions.properties = ['openFile', 'multiSelections']
      }
      // 2、等待系统对话框，分别返回选择或取消状态。
      const result = await dialog.showOpenDialog(window, dialogOptions)
      if (result.canceled) {
        return { success: false, canceled: true, paths: [] }
      }
      const paths = result.filePaths
      console.log('选择的文件:', paths)
      return {
        success: true,
        canceled: false,
        paths,
        path: options.multiple ? null : paths[0]
      }
    } catch (error) {
      console.error('文件选择失败:', error)
      return {
        success: false,
        error: error.message,
        canceled: false,
        paths: []
      }
    }
  })
  
  // 2、提供保存对话框，以及带图片预览的选择接口。
  /**
   * 选择文件保存位置。
   * 处理流程：
   * 1、整理调用参数并显示系统保存对话框。
   * 2、返回保存路径，此入口不写入文件内容。
   */
  ipcMain.handle('show-save-dialog', async (event, options = {}) => {
    try {
      // 1、绑定调用窗口，保留默认位置与文件筛选条件。
      const window = BrowserWindow.fromWebContents(event.sender)
      const dialogOptions = {
        title: options.title || '保存文件',
        defaultPath: options.defaultPath,
        filters: Array.isArray(options.filters) ? options.filters : undefined,
        message: options.message
      }
      const result = await dialog.showSaveDialog(window, dialogOptions)
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      // 2、把所选路径交给页面后续保存流程。
      const filePath = result.filePath
      console.log('保存文件路径:', filePath)
      return {
        success: true,
        canceled: false,
        filePath: filePath
      }
    } catch (error) {
      console.error('显示保存对话框失败:', error)
      return {
        success: false,
        error: error.message,
        canceled: false
      }
    }
  })
  
  /**
   * 选择图片并生成文件信息与预览。
   * 处理流程：
   * 1、显示图片多选对话框。
   * 2、逐张读取文件元数据和编码预览。
   * 3、返回文件列表，单张预览失败时保留该文件信息。
   */
  ipcMain.handle('select-image-files', async (event) => {
    try {
      // 1、取得调用窗口并按支持的图片格式筛选。
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile', 'multiSelections'],
        title: '选择图片文件',
        filters: [
          { name: '图片', extensions: ['jpg', 'jpeg', 'png'] }
        ]
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      const filePaths = result.filePaths
      console.log('选择的图片文件:', filePaths)
      
      // 2、收集文件路径、名称和大小，并尝试生成预览地址。
      const files = filePaths.map(filePath => {
        const stats = fs.statSync(filePath)
        
        // 读取文件并转换为base64（用于预览）
        let previewUrl = null
        try {
          const imageData = fs.readFileSync(filePath)
          const ext = path.extname(filePath).toLowerCase()
          let mimeType = 'image/png'
          
          if (ext === '.jpg' || ext === '.jpeg') {
            mimeType = 'image/jpeg'
          } else if (ext === '.png') {
            mimeType = 'image/png'
          }
          
          const base64 = imageData.toString('base64')
          previewUrl = `data:${mimeType};base64,${base64}`
        } catch (error) {
          console.warn('生成预览失败:', filePath, error)
        }
        
        return {
          path: filePath,
          name: path.basename(filePath),
          size: stats.size,
          previewUrl: previewUrl
        }
      })
      
      // 3、返回所选图片列表，预览失败的项目保留空预览。
      return { 
        success: true, 
        files: files,
        canceled: false 
      }
    } catch (error) {
      console.error('图片文件选择失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })
  
  // 3、保存粘贴功能的临时图片，并提供打开文件夹的入口。
  /**
   * 将粘贴图片写入应用临时目录。
   * 处理流程：
   * 1、验证图片内容并创建临时目录。
   * 2、确定文件名，解码图片并保存。
   * 3、返回临时路径或错误信息。
   */
  ipcMain.handle('save-temp-image', async (event, base64Data, fileName) => {
    try {
      // 1、图片内容为空时直接返回错误。
      if (!base64Data) {
        return { success: false, error: '图片数据为空' }
      }
      
      // 创建临时目录
      const tempDir = path.join(app.getPath('temp'), 'momentum-stickfigure-paste')
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true })
      }
      
      // 2、生成临时文件路径，解码后写入图片。
      const tempFilePath = path.join(tempDir, fileName || `pasted_${Date.now()}.png`)
      
      // 将base64转换为buffer并保存
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(tempFilePath, buffer)
      
      // 3、向页面返回后续处理所需的本地路径。
      console.log('临时图片已保存:', tempFilePath)
      
      return {
        success: true,
        path: tempFilePath
      }
    } catch (error) {
      console.error('保存临时图片失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })
  
  /**
   * 调用系统文件管理器打开目录。
   * 处理流程：
   * 1、检查目录路径并调用系统接口。
   * 2、将接口返回的错误文本转换为失败结果。
   */
  ipcMain.handle('open-folder', async (event, folderPath) => {
    try {
      // 1、排除空路径，再提交系统目录打开请求。
      if (!folderPath) {
        return { success: false, error: '文件夹路径为空' }
      }
      
      console.log('打开文件夹:', folderPath)
      
      // 使用shell.openPath打开文件夹
      const result = await shell.openPath(folderPath)
      
      // 2、系统接口返回非空文本表示打开失败。
      if (result) {
        // 保留系统提供的错误信息。
        console.error('打开文件夹失败:', result)
        return { success: false, error: result }
      }
      
      return { success: true }
    } catch (error) {
      console.error('打开文件夹失败:', error)
      return { success: false, error: error.message }
    }
  })
  
  console.log('✓ 文件夹选择处理器已注册')
  console.log('✓ 图片文件选择处理器已注册')
  console.log('✓ 文件选择处理器已注册')
  console.log('✓ 打开文件夹处理器已注册')
}

/**
 * 清理文件选择相关通道的事件监听。
 * 处理流程：
 * 1、按现有通道列表移除监听器并记录日志。
 */
function unregisterFolderSelectHandler() {
  // 1、移除文件选择和目录打开通道上的事件监听。
  ipcMain.removeAllListeners('select-psd-files')
  ipcMain.removeAllListeners('select-folder')
  ipcMain.removeAllListeners('select-file')
  ipcMain.removeAllListeners('select-image-files')
  ipcMain.removeAllListeners('open-folder')
  console.log('✓ PSD文件选择处理器已移除')
  console.log('✓ 文件夹选择处理器已移除')
  console.log('✓ 文件选择处理器已移除')
  console.log('✓ 图片文件选择处理器已移除')
}

/**
 * 注册图片写入与拖入文件落盘接口。
 * 处理流程：
 * 1、保存 Base64 文件，重名时查找新的文件名。
 * 2、清理拖入文件名并写入临时目录。
 */
function registerFileWriteHandler() {
  // 1、为导出文件确保目录存在，并避免覆盖同名结果。
  /**
   * 将页面提交的编码文件写入目标目录。
   * 处理流程：
   * 1、确保父目录存在。
   * 2、目标重名时添加递增序号。
   * 3、解码并写入文件，返回实际保存路径。
   */
  ipcMain.handle('write-file', async (event, filePath, base64Data) => {
    try {
      console.log('写入文件:', filePath)
      
      // 1、确保文件的父目录存在。
      const dirPath = path.dirname(filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
        console.log('创建目录:', dirPath)
      }
      
      // 2、如果文件已存在，查找带递增序号的可用文件名。
      let finalFilePath = filePath
      if (fs.existsSync(finalFilePath)) {
        const ext = path.extname(filePath)
        const baseName = path.basename(filePath, ext)
        const dir = path.dirname(filePath)
        let counter = 1
        
        // 循环查找可用的文件名
        while (fs.existsSync(finalFilePath)) {
          const newFileName = `${baseName}_${counter}${ext}`
          finalFilePath = path.join(dir, newFileName)
          counter++
        }
        
        console.log(`文件重命名：${path.basename(filePath)} -> ${path.basename(finalFilePath)}`)
      }
      
      // 3、将编码内容转换为字节并写入实际目标路径。
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(finalFilePath, buffer)
      
      console.log('文件写入成功:', finalFilePath)
      return { 
        success: true, 
        filePath: finalFilePath 
      }
    } catch (error) {
      console.error('文件写入失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })

  // 2、保存拖拽文件到临时目录并返回路径。
  /**
   * 把拖入页面的文件字节保存到临时目录。
   * 处理流程：
   * 1、确保拖入文件临时目录存在。
   * 2、清理文件名，按现有规则覆盖同名临时文件。
   * 3、保存字节并返回路径和原始名称。
   */
  ipcMain.handle('save-dragged-file', async (event, fileName, arrayBuffer) => {
    try {
      console.log('保存拖拽文件到临时目录:', fileName)

      // 1、定位应用使用的拖入文件临时目录。
      const tempDir = app.getPath('temp')
      const appTempDir = path.join(tempDir, 'momentum-stickfigure', 'dragged-files')

      // 确保临时目录存在
      if (!fs.existsSync(appTempDir)) {
        fs.mkdirSync(appTempDir, { recursive: true })
      }

      // 2、保留原始文件名含义，替换路径不允许的字符。
      const ext = path.extname(fileName)
      const rawBaseName = path.basename(fileName, ext)
      const sanitizedBaseName = rawBaseName
        ? rawBaseName.replace(/[<>:"/\\|?*]/g, '_')
        : 'dragged'
      const sanitizedExt = ext || ''
      const sanitizedFileName = `${sanitizedBaseName}${sanitizedExt}`
      const filePath = path.join(appTempDir, sanitizedFileName)

      // 如果已存在同名文件则覆盖
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath)
          console.log('已删除旧的临时文件，准备覆盖:', filePath)
        } catch (removeError) {
          console.warn('删除旧临时文件失败，将直接覆盖:', removeError.message)
        }
      }

      // 3、将传入字节转换为缓冲区并写入临时文件。
      const buffer = Buffer.from(arrayBuffer)
      fs.writeFileSync(filePath, buffer)

      console.log('拖拽文件已保存到:', filePath)
      return {
        success: true,
        filePath: filePath,
        originalName: fileName
      }
    } catch (error) {
      console.error('保存拖拽文件失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  console.log('✓ 文件写入处理器已注册')
}

/**
 * 清理文件写入相关事件监听。
 * 处理流程：
 * 1、移除写入文件与保存拖入文件通道上的监听器。
 */
function unregisterFileWriteHandler() {
  // 1、清理两个文件写入通道的事件监听。
  ipcMain.removeAllListeners('write-file')
  ipcMain.removeAllListeners('save-dragged-file')
  console.log('✓ 文件写入处理器已移除')
}

/**
 * 注册本地文件存在性检查与读取接口。
 * 处理流程：
 * 1、查询路径存在性，异常时返回否定结果。
 * 2、读取文件字节，文件缺失或读取失败时返回空值。
 */
function registerFileOperationHandlers() {
  // 1、检查文件是否存在。
  /**
   * 检查本地路径是否存在。
   * 处理流程：
   * 1、查询文件系统并返回布尔值，异常时返回否。
   */
  ipcMain.handle('check-file-exists', async (event, filePath) => {
    try {
      // 1、将路径检查结果直接返回页面。
      const exists = fs.existsSync(filePath)
      console.log('检查文件存在:', filePath, exists)
      return exists
    } catch (error) {
      console.error('检查文件失败:', error)
      return false
    }
  })
  
  // 2、读取文件内容并保留失败时的空值约定。
  /**
   * 读取本地文件原始字节。
   * 处理流程：
   * 1、检查路径是否存在。
   * 2、读取并返回缓冲区，缺失或异常时返回空值。
   */
  ipcMain.handle('read-file', async (event, filePath) => {
    try {
      // 1、确认路径存在，避免无效文件读取。
      console.log('读取文件:', filePath)
      if (!fs.existsSync(filePath)) {
        console.error('文件不存在:', filePath)
        return null
      }
      // 2、保留文件原始字节供页面按用途解析。
      const buffer = fs.readFileSync(filePath)
      console.log('文件读取成功:', filePath)
      return buffer
    } catch (error) {
      console.error('读取文件失败:', error)
      return null
    }
  })
  
  console.log('✓ 文件操作处理器已注册')
}

/**
 * 清理文件检查与读取的事件监听。
 * 处理流程：
 * 1、移除两个文件操作通道的监听器。
 */
function unregisterFileOperationHandlers() {
  // 1、按通道清理文件操作监听。
  ipcMain.removeAllListeners('check-file-exists')
  ipcMain.removeAllListeners('read-file')
  console.log('✓ 文件操作处理器已移除')
}

/**
 * 注册自定义对话框图片的本地管理接口。
 * 处理流程：
 * 1、准备图片目录并注册保存入口。
 * 2、扫描支持的图片并按修改时间排序。
 * 3、提供单张图片删除入口。
 */
function registerCustomDialogHandlers() {
  // 1、使用应用数据目录集中保存自定义对话框图片。
  const customDialogDir = path.join(app.getPath('userData'), 'custom-dialogs')
  
  // 确保目录存在
  if (!fs.existsSync(customDialogDir)) {
    fs.mkdirSync(customDialogDir, { recursive: true })
    console.log('创建自定义对话框目录:', customDialogDir)
  }
  
  // 保存自定义对话框图片
  ipcMain.handle('save-custom-dialog', async (event, fileName, base64Data) => {
    try {
      // 生成唯一文件名（时间戳 + 原文件名）
      const timestamp = Date.now()
      const ext = path.extname(fileName)
      const baseName = path.basename(fileName, ext)
      const uniqueFileName = `${timestamp}_${baseName}${ext}`
      const filePath = path.join(customDialogDir, uniqueFileName)
      
      // 将base64转为buffer并保存
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(filePath, buffer)
      
      console.log('自定义对话框保存成功:', filePath)
      return { 
        success: true, 
        fileName: uniqueFileName,
        filePath 
      }
    } catch (error) {
      console.error('保存自定义对话框失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  // 2、扫描自定义对话框目录并生成页面预览数据。
  ipcMain.handle('scan-custom-dialogs', async (event) => {
    try {
      if (!fs.existsSync(customDialogDir)) {
        return { success: true, dialogs: [] }
      }
      
      const files = fs.readdirSync(customDialogDir)
      const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp', '.gif']
      const dialogs = []
      
      for (const file of files) {
        const ext = path.extname(file).toLowerCase()
        if (imageExtensions.includes(ext)) {
          const filePath = path.join(customDialogDir, file)
          const buffer = fs.readFileSync(filePath)
          const base64 = buffer.toString('base64')
          const dataURL = `data:image/${ext.slice(1)};base64,${base64}`
          
          dialogs.push({
            fileName: file,
            filePath,
            dataURL,
            timestamp: fs.statSync(filePath).mtimeMs
          })
        }
      }
      
      // 按时间倒序排列（最新的在前面）
      dialogs.sort((a, b) => b.timestamp - a.timestamp)
      
      console.log(`扫描到 ${dialogs.length} 个自定义对话框`)
      return { success: true, dialogs }
    } catch (error) {
      console.error('扫描自定义对话框失败:', error)
      return { 
        success: false, 
        error: error.message,
        dialogs: []
      }
    }
  })
  
  // 3、删除指定自定义对话框图片。
  ipcMain.handle('delete-custom-dialog', async (event, fileName) => {
    try {
      const filePath = path.join(customDialogDir, fileName)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath)
        console.log('删除自定义对话框:', filePath)
        return { success: true }
      }
      return { success: false, error: '文件不存在' }
    } catch (error) {
      console.error('删除自定义对话框失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  console.log('✓ 自定义对话框处理器已注册')
}

/**
 * 清理自定义对话框图片的事件监听。
 * 处理流程：
 * 1、移除保存、扫描和删除通道的监听器。
 */
function unregisterCustomDialogHandlers() {
  // 1、清理图片管理的三个事件通道。
  ipcMain.removeAllListeners('save-custom-dialog')
  ipcMain.removeAllListeners('scan-custom-dialogs')
  ipcMain.removeAllListeners('delete-custom-dialog')
  console.log('✓ 自定义对话框处理器已移除')
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
          preload: path.join(__dirname, '../preload/index.mjs'),
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
        await canvasPreviewWindow.loadFile(path.join(__dirname, '../renderer/canvas-preview.html'))
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
              nodeBuffer = Buffer.from(buffer.buffer)
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
                preload: path.join(__dirname, '../preload/index.mjs'),
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
              await canvasPreviewWindow.loadFile(path.join(__dirname, '../renderer/canvas-preview.html'))
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
          :root, html { 
            color-scheme: ${scheme} !important; 
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

// 崩溃监控：将崩溃原因落盘，便于排查（通常 renderer/gpu/native crash 无法在控制台看到）
try {
  /**
   * 保存子进程崩溃诊断记录。
   * 处理流程：
   * 1、创建日志目录并追加带时间与标签的故障详情。
   */
  const crashLog = (tag, info) => {
    // 1、尽量保存崩溃信息，日志异常不再向外传播。
    try {
      const logDir = path.join(app.getPath('userData'), 'logs')
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true })
      const file = path.join(logDir, 'drag-crash.log')
      const msg = `[${new Date().toISOString()}][${tag}] ${JSON.stringify(info)}\n`
      fs.appendFileSync(file, msg)
    } catch (_) {}
  }
  app.on('child-process-gone', (_e, details) => crashLog('child-process-gone', details))
  app.on('render-process-gone', (_e, contents, details) => crashLog('render-process-gone', details))
  app.on('gpu-process-crashed', (_e, killed) => crashLog('gpu-process-crashed', { killed }))
} catch (_) {}

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

/**
 * 注册系统浏览器打开外部链接的入口。
 * 处理流程：
 * 1、验证地址格式及协议。
 * 2、调用系统打开链接，并返回执行结果。
 */
function registerShellHandlers() {
  // 1、注册入口，在调用系统浏览器前验证地址。
  ipcMain.handle('shell-open-external', async (event, url) => {
    try {
      if (!url || typeof url !== 'string') {
        return { success: false, error: 'URL无效' }
      }
      
      // 验证URL格式
      try {
        new URL(url)
      } catch (e) {
        return { success: false, error: 'URL格式不正确' }
      }
      
      // 只允许http和https协议
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return { success: false, error: '只支持HTTP和HTTPS协议' }
      }
      
      // 2、等待系统处理链接打开请求。
      await shell.openExternal(url)
      console.log('✅ 已打开外部链接:', url)
      return { success: true }
    } catch (error) {
      console.error('打开外部链接失败:', error)
      return { success: false, error: error.message }
    }
  })
  
  console.log('✓ Shell处理器已注册')
}

/**
 * 清理外部链接打开通道的事件监听。
 * 处理流程：
 * 1、移除系统链接通道监听器。
 */
function unregisterShellHandlers() {
  // 1、清理外部链接打开通道。
  ipcMain.removeAllListeners('shell-open-external')
  console.log('✓ Shell处理器已移除')
}

// ==================== 拖拽到剪映功能处理器 ====================

/**
 * 获取系统图片目录（兼容 Windows/Mac/Linux）
 * 处理流程：
 * 1、根据平台返回用户主目录下的 Pictures 路径。
 */
function getPicturesDirectory() {
  // 1、按照各平台的用户目录约定构造图片目录。
  const platform = process.platform
  
  if (platform === 'win32') {
    // Windows: 使用 C:\Users\用户名\Pictures
    return path.join(os.homedir(), 'Pictures')
  } else if (platform === 'darwin') {
    // macOS: 使用 /Users/用户名/Pictures
    return path.join(os.homedir(), 'Pictures')
  } else {
    // Linux: 使用 /home/用户名/Pictures
    return path.join(os.homedir(), 'Pictures')
  }
}

/**
 * 注册拖拽到剪映相关处理器
 * 处理流程：
 * 1、提供图片保存与剪贴板复制入口。
 * 2、提供发起窗口的边界查询。
 * 3、根据输出配置保存图片并发起系统拖拽。
 */
function registerDragToJianyingHandlers() {
  // 1、保存图片并复制路径到剪贴板，同时提供通用文本复制。
  /**
   * 保存画布图片并复制其路径。
   * 处理流程：
   * 1、根据用户设置确定输出目录。
   * 2、生成名称并按重名策略避免覆盖。
   * 3、写入图片、复制路径并返回保存结果。
   */
  ipcMain.handle('save-drag-image-and-copy', async (event, base64Data, iconPayload, stickfigureConfig) => {
    try {
      console.log('📁 保存拖拽图片...')
      
      // 1、读取配置，决定保存目录。
      const config = stickfigureConfig || {}
      let appDir
      
      if (config.outputRoot && config.outputRoot.trim()) {
        // 使用用户配置的路径
        appDir = config.outputRoot
      } else {
        // 使用默认路径
        const picturesDir = getPicturesDirectory()
        appDir = path.join(picturesDir, 'MomentumStickFigure')
      }
      
      if (!fs.existsSync(appDir)) {
        fs.mkdirSync(appDir, { recursive: true })
        console.log('✅ 创建应用目录:', appDir)
      }
      
      // 2、生成带时间戳的名称，并根据配置处理重名。
      const timestamp = Date.now()
      const fileName = `stickfigure_${timestamp}.png`
      let filePath = path.join(appDir, fileName)
      
      // 根据配置决定是否覆盖同名文件
      // 如果设置了 forceRename 标志（图层树模式），强制使用重命名模式
      const shouldRename = config.forceRename || config.overwriteMode === 'rename'
      
      if (shouldRename && fs.existsSync(filePath)) {
        // 不覆盖模式：自动添加序号或时间戳
        const ext = path.extname(fileName)
        const baseName = path.basename(fileName, ext)
        let counter = 1
        
        // 如果是强制重命名（图层树模式），添加额外的时间戳标记
        if (config.forceRename) {
          const extraTimestamp = Date.now()
          filePath = path.join(appDir, `${baseName}_${extraTimestamp}${ext}`)
          console.log(`🌳 图层树模式强制重命名：${fileName} -> ${path.basename(filePath)}`)
        }
        
        // 如果文件名仍然存在，继续添加序号
        while (fs.existsSync(filePath)) {
          const newFileName = `${baseName}_${counter}${ext}`
          filePath = path.join(appDir, newFileName)
          counter++
        }
        
        if (!config.forceRename) {
          console.log(`文件重命名：${fileName} -> ${path.basename(filePath)}`)
        }
      }
      
      // 3、将图片解码写入文件，随后复制输出路径。
      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(filePath, buffer)
      
      console.log('✅ 图片保存成功:', filePath)
      
      // 复制路径到剪贴板
      clipboard.writeText(filePath)
      console.log('✅ 路径已复制到剪贴板')
      
      return { 
        success: true, 
        filePath: filePath 
      }
    } catch (error) {
      console.error('❌ 保存图片失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  /**
   * 将文本写入系统剪贴板。
   * 处理流程：
   * 1、写入文本并返回成功状态，异常时返回错误消息。
   */
  ipcMain.handle('copy-to-clipboard', async (event, text) => {
    try {
      // 1、由主进程访问系统剪贴板。
      clipboard.writeText(text)
      console.log('✅ 已复制到剪贴板:', text)
      return { success: true }
    } catch (error) {
      console.error('❌ 复制到剪贴板失败:', error)
      return { success: false, error: error.message }
    }
  })
  
  // 2、获取发起请求窗口的边界。
  /**
   * 查询发起请求窗口的位置与尺寸。
   * 处理流程：
   * 1、通过页面找到所属窗口，返回边界或缺失提示。
   */
  ipcMain.handle('get-window-bounds', async (event) => {
    try {
      // 1、使用调用页面的窗口，避免读取其他窗口的边界。
      const window = BrowserWindow.fromWebContents(event.sender)
      if (window) {
        const bounds = window.getBounds()
        return { success: true, bounds: bounds }
      }
      return { success: false, error: '窗口不存在' }
    } catch (error) {
      console.error('❌ 获取窗口边界失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 3、按照输出目录、PSD 分组和重名策略保存图片，再启动系统拖拽。
  /**
   * 按导出设置保存画布图片并启动系统拖拽。
   * 处理流程：
   * 1、定位调用窗口并选择输出根目录。
   * 2、按需创建 PSD 专属目录，清理平台不兼容的名称。
   * 3、处理文件重名并写入图片字节。
   * 4、准备图标和结束通知，调用系统拖拽接口。
   */
  ipcMain.handle('create-temp-file-and-start-drag', async (event, base64Data, iconPayload, fileNameSuggestion, stickfigureConfig) => {
    try {
      // 1、取得调用窗口，并按用户设置选择图片保存目录。
      const window = BrowserWindow.fromWebContents(event.sender)
      if (!window) return { success: false, error: '窗口不存在' }

      // 读取配置，决定保存目录
      const config = stickfigureConfig || {}
      let appDir
      
      if (config.outputRoot && config.outputRoot.trim()) {
        // 使用用户配置的路径
        appDir = config.outputRoot
      } else {
        // 使用默认路径
        const picturesDir = getPicturesDirectory()
        appDir = path.join(picturesDir, 'MomentumStickFigure')
      }
      
      if (!fs.existsSync(appDir)) fs.mkdirSync(appDir, { recursive: true })

      const timestamp = Date.now()
      const fileName = (fileNameSuggestion && String(fileNameSuggestion).trim()) || `stickfigure_${timestamp}.png`
      
      console.log('📋 文件保存配置:', {
        createPsdFolder: config.createPsdFolder,
        fileName: fileName,
        outputRoot: config.outputRoot
      })
      
      // 2、根据配置决定是否为 PSD 创建文件夹，并清理目录名称。
      let targetDir = appDir
      if (config.createPsdFolder && fileName) {
        console.log('✅ createPsdFolder 为 true，准备创建PSD文件夹')
        
        // 优先使用传递过来的PSD原始名称，避免路径截断问题
        let psdFolderName = null
        if (config.psdBaseName && config.psdBaseName.trim()) {
          console.log('📌 使用传递的PSD原始名称:', config.psdBaseName)
          psdFolderName = config.psdBaseName.trim()
        } else {
          // 回退方案：从文件名中提取PSD名称（第一个下划线之前的部分）
          console.log('⚠️ 未传递PSD原始名称，使用回退方案从文件名提取')
          const firstUnderscoreIndex = fileName.indexOf('_')
          if (firstUnderscoreIndex > 0) {
            psdFolderName = fileName.substring(0, firstUnderscoreIndex)
          }
        }
        
        if (psdFolderName) {
          // 清理文件夹名称，移除Windows/Linux/macOS不允许的字符
          // 不允许的字符: \ / : * ? " < > |
          psdFolderName = psdFolderName
            .replace(/[\\/:*?"<>|]/g, '_')  // 替换非法字符为下划线
            .replace(/[\s]+/g, '_')         // 替换空格为下划线
            .replace(/_+/g, '_')            // 合并多个下划线为一个
            .replace(/^_+|_+$/g, '')        // 去除首尾下划线
            .replace(/\.+$/g, '')           // 去除尾部的点号（Windows不允许）
          
          // 检查Windows保留名称（不区分大小写）
          const reservedNames = ['CON', 'PRN', 'AUX', 'NUL', 'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9', 'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9']
          if (reservedNames.includes(psdFolderName.toUpperCase())) {
            psdFolderName = `psd_${psdFolderName}`
          }
          
          // 如果清理后的名称为空，使用默认名称
          if (!psdFolderName || psdFolderName.trim() === '') {
            psdFolderName = 'default_psd'
          }
          
          // 限制文件夹名称长度（防止路径过长）
          if (psdFolderName.length > 100) {
            psdFolderName = psdFolderName.substring(0, 100)
          }
          
          targetDir = path.join(appDir, psdFolderName)
          
          // 创建PSD专属文件夹
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true })
            console.log(`📁 为PSD创建文件夹：${psdFolderName}`)
          } else {
            console.log(`📁 PSD文件夹已存在：${psdFolderName}`)
          }
          console.log(`📁 最终保存目录：${targetDir}`)
        } else {
          console.log(`⚠️ 文件名中没有下划线，无法提取PSD名称: ${fileName}`)
        }
      } else {
        console.log(`ℹ️ createPsdFolder=${config.createPsdFolder}，不创建PSD文件夹，直接保存到根目录`)
      }
      
      // 3、根据配置决定是否覆盖同名文件，写入最终选定路径。
      // 如果设置了 forceRename 标志（图层树模式），强制使用重命名模式
      let finalFilePath = path.join(targetDir, fileName)
      const shouldRename = config.forceRename || config.overwriteMode === 'rename'
      
      if (shouldRename && fs.existsSync(finalFilePath)) {
        // 不覆盖模式：自动添加序号或时间戳
        const ext = path.extname(fileName)
        const baseName = path.basename(fileName, ext)
        let counter = 1
        
        // 如果是强制重命名（图层树模式），优先使用时间戳
        if (config.forceRename) {
          finalFilePath = path.join(targetDir, `${baseName}_${timestamp}${ext}`)
          console.log(`🌳 图层树模式强制重命名：${fileName} -> ${path.basename(finalFilePath)}`)
        }
        
        // 如果带时间戳的文件名仍然存在，继续添加序号
        while (fs.existsSync(finalFilePath)) {
          const newFileName = `${baseName}_${timestamp}_${counter}${ext}`
          finalFilePath = path.join(targetDir, newFileName)
          counter++
        }
        
        if (!config.forceRename) {
          console.log(`文件重命名：${fileName} -> ${path.basename(finalFilePath)}`)
        }
      }

      const buffer = Buffer.from(base64Data, 'base64')
      fs.writeFileSync(finalFilePath, buffer)

      // 4、准备拖拽图标，并在窗口重新聚焦时通知页面收尾。
      let dragIcon = null
      try {
        if (iconPayload?.dataURL) {
          dragIcon = nativeImage.createFromDataURL(iconPayload.dataURL)
          if (iconPayload.size && Number(iconPayload.size) > 0) {
            dragIcon = dragIcon.resize({ width: Number(iconPayload.size), height: Number(iconPayload.size) })
          }
        }
      } catch (e) {
        console.warn('⚠️ 构建拖拽图标失败，使用默认图标', e)
      }

      /**
       * 在窗口重新获得焦点时通知拖拽结束。
       * 处理流程：
       * 1、发送文件路径并移除本次焦点监听。
       */
      const handleFocus = () => {
        // 1、结束本次拖拽通知，避免焦点变化重复发送。
        window.webContents.send('drag-finished', { filePath: finalFilePath })
        window.removeListener('focus', handleFocus)
      }
      window.once('focus', handleFocus)

      window.webContents.startDrag({
        file: finalFilePath,
        icon: dragIcon || undefined
      })

      return { success: true, filePath: finalFilePath }
    } catch (error) {
      console.error('❌ 启动系统拖拽失败:', error)
      return { success: false, error: error.message }
    }
  })
  
  console.log('✓ 拖拽到剪映处理器已注册')
}

/**
 * 清理拖拽到剪映处理器
 * 处理流程：
 * 1、移除图片保存、剪贴板、窗口边界和拖拽通道监听。
 */
function unregisterDragToJianyingHandlers() {
  // 1、按通道清理拖拽辅助功能的事件监听。
  ipcMain.removeAllListeners('save-drag-image-and-copy')
  ipcMain.removeAllListeners('copy-to-clipboard')
  ipcMain.removeAllListeners('get-window-bounds')
  ipcMain.removeAllListeners('create-temp-file-and-start-drag')
  console.log('✓ 拖拽到剪映处理器已移除')
}

/**
 * 注册预设文件导入导出接口。
 * 处理流程：
 * 1、选择导出位置。
 * 2、选择并读取导入文件。
 * 3、确保父目录存在后保存预设文本。
 */
function registerPresetHandlers() {
  // 1、选择预设导出位置，文件内容由后续保存入口写入。
  ipcMain.handle('preset-export', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showSaveDialog(window, {
        title: '导出预设',
        defaultPath: `momentum-stickfigure-preset_${Date.now()}.json`,
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      const filePath = result.filePath
      console.log('导出预设到:', filePath)
      
      return { 
        success: true, 
        filePath: filePath,
        canceled: false 
      }
    } catch (error) {
      console.error('导出预设失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })
  
  // 2、选择预设文件并返回原始文本。
  ipcMain.handle('preset-import', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        title: '导入预设',
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      const filePath = result.filePaths[0]
      console.log('导入预设从:', filePath)
      
      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8')
      
      return { 
        success: true, 
        filePath: filePath,
        content: content,
        canceled: false 
      }
    } catch (error) {
      console.error('导入预设失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })
  
  // 3、保存预设数据到文件。
  ipcMain.handle('preset-save-file', async (event, filePath, content) => {
    try {
      console.log('保存预设到:', filePath)
      
      // 确保目录存在
      const dirPath = path.dirname(filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      
      // 写入文件（UTF-8编码）
      fs.writeFileSync(filePath, content, 'utf-8')
      
      console.log('预设保存成功:', filePath)
      return { 
        success: true, 
        filePath: filePath 
      }
    } catch (error) {
      console.error('保存预设失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  console.log('✓ 预设处理器已注册')
}

/**
 * 清理预设导入导出的事件监听。
 * 处理流程：
 * 1、移除导出、导入和保存通道的监听器。
 */
function unregisterPresetHandlers() {
  // 1、清理预设文件管理通道。
  ipcMain.removeAllListeners('preset-export')
  ipcMain.removeAllListeners('preset-import')
  ipcMain.removeAllListeners('preset-save-file')
  console.log('✓ 预设处理器已移除')
}

// ==================== 设置导入导出处理器 ====================

/**
 * 获取用户文档目录下的配置备份路径
 * 处理流程：
 * 1、定位用户文档目录。
 * 2、返回应用专用的设置备份路径。
 */
function getSettingsBackupPath() {
  // 1、根据平台定位用户主目录下的文档路径。
  const platform = process.platform
  let documentsDir
  
  if (platform === 'win32') {
    // Windows: C:\Users\用户名\Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  } else if (platform === 'darwin') {
    // macOS: /Users/用户名/Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  } else {
    // Linux: /home/用户名/Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  }
  
  // 2、组合应用配置目录路径，此处仅返回路径，不创建目录。
  const appConfigDir = path.join(documentsDir, 'MomentumStickFigure', 'Settings')
  
  return appConfigDir
}

/**
 * 注册设置导入导出处理器
 * 处理流程：
 * 1、提供设置文件导出与导入入口。
 * 2、自动备份并保留最近五份归档及最新副本。
 * 3、从最新副本读取待恢复的设置。
 */
function registerSettingsHandlers() {
  // 1、通过系统对话框选择文件，导出或导入 JSON 设置。
  ipcMain.handle('settings-export', async (event, settings) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showSaveDialog(window, {
        title: '导出配置',
        defaultPath: `momentum-stickfigure-settings_${Date.now()}.json`,
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      const filePath = result.filePath
      console.log('导出设置到:', filePath)
      
      // 确保目录存在
      const dirPath = path.dirname(filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }
      
      // 写入文件（格式化JSON，便于阅读）
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')
      
      console.log('✅ 设置导出成功:', filePath)
      return { 
        success: true, 
        filePath: filePath,
        canceled: false 
      }
    } catch (error) {
      console.error('❌ 导出设置失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })
  
  // 导入设置
  ipcMain.handle('settings-import', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      
      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        title: '导入配置',
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })
      
      if (result.canceled) {
        return { success: false, canceled: true }
      }
      
      const filePath = result.filePaths[0]
      console.log('导入设置从:', filePath)
      
      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8')
      const settings = JSON.parse(content)
      
      console.log('✅ 设置导入成功:', filePath)
      return { 
        success: true, 
        filePath: filePath,
        settings: settings,
        canceled: false 
      }
    } catch (error) {
      console.error('❌ 导入设置失败:', error)
      return { 
        success: false, 
        error: error.message,
        canceled: false 
      }
    }
  })
  
  // 2、自动备份设置到用户文档目录，并轮换历史配置备份。
  ipcMain.handle('settings-auto-backup', async (event, settings) => {
    try {
      const backupDir = getSettingsBackupPath()
      
      // 确保备份目录存在
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
        console.log('✅ 创建配置备份目录:', backupDir)
      }
      
      // 生成备份文件名（保留最近5个备份）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const backupFileName = `settings-backup_${timestamp}.json`
      const backupFilePath = path.join(backupDir, backupFileName)
      
      // 写入备份文件
      fs.writeFileSync(backupFilePath, JSON.stringify(settings, null, 2), 'utf-8')
      
      console.log('✅ 配置已自动备份到:', backupFilePath)
      
      // 清理旧备份（只保留最近5个）
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('settings-backup_') && file.endsWith('.json'))
        .sort()
        .reverse()
      
      if (backupFiles.length > 5) {
        const filesToDelete = backupFiles.slice(5)
        filesToDelete.forEach(file => {
          const fileToDelete = path.join(backupDir, file)
          try {
            fs.unlinkSync(fileToDelete)
            console.log('🗑️ 删除旧备份:', file)
          } catch (err) {
            console.warn('⚠️ 删除旧备份失败:', file, err)
          }
        })
      }
      
      // 同时保存一个latest.json作为最新备份
      const latestBackupPath = path.join(backupDir, 'settings-latest.json')
      fs.writeFileSync(latestBackupPath, JSON.stringify(settings, null, 2), 'utf-8')
      
      return { 
        success: true, 
        backupPath: backupFilePath 
      }
    } catch (error) {
      console.error('❌ 自动备份设置失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  // 3、从用户文档目录读取最新设置副本。
  ipcMain.handle('settings-restore', async (event) => {
    try {
      const backupDir = getSettingsBackupPath()
      const latestBackupPath = path.join(backupDir, 'settings-latest.json')
      
      if (!fs.existsSync(latestBackupPath)) {
        return { 
          success: false, 
          error: '未找到备份文件' 
        }
      }
      
      // 读取最新备份
      const content = fs.readFileSync(latestBackupPath, 'utf-8')
      const settings = JSON.parse(content)
      
      console.log('✅ 从备份恢复设置:', latestBackupPath)
      return { 
        success: true, 
        settings: settings,
        backupPath: latestBackupPath
      }
    } catch (error) {
      console.error('❌ 恢复设置失败:', error)
      return { 
        success: false, 
        error: error.message 
      }
    }
  })
  
  console.log('✓ 设置导入导出处理器已注册')
}

/**
 * 清理设置导入导出处理器
 * 处理流程：
 * 1、移除导出、导入、自动备份和恢复通道监听。
 */
function unregisterSettingsHandlers() {
  // 1、清理设置文件管理的四个事件通道。
  ipcMain.removeAllListeners('settings-export')
  ipcMain.removeAllListeners('settings-import')
  ipcMain.removeAllListeners('settings-auto-backup')
  ipcMain.removeAllListeners('settings-restore')
  console.log('✓ 设置导入导出处理器已移除')
}

// 在Windows上规避GPU驱动异常：禁用硬件加速并使用软件渲染（ANGLE WARP）
try {
  if (process.platform === 'win32') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('use-angle', 'warp')
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-features', 'DirectComposition,Accelerated2dCanvas,CanvasOopRasterization,UseSkiaRenderer')
  }
} catch (_) {}
