/**
 * 主进程入口：管理应用窗口、系统交互、内嵌网页以及各业务模块的进程通信。
 */
import { app, BrowserWindow, shell, dialog, ipcMain, Menu, MenuItem, clipboard, nativeImage } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { createWindowController } from './window-controller.js'
import { createBrowserViewController } from './browser-view-controller.js'
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
import { registerSettingsHandlers, unregisterSettingsHandlers } from './settings-handler.js'
import { registerFileWriteHandler, unregisterFileWriteHandler } from './file-write-handler.js'
import { registerFileOperationHandlers, unregisterFileOperationHandlers } from './file-read-handler.js'
import { registerFolderSelectHandler, unregisterFolderSelectHandler } from './file-selection-handler.js'
import { registerCustomDialogHandlers, unregisterCustomDialogHandlers } from './custom-dialog-handler.js'
// 导入字体服务
import { registerFontServiceHandlers } from './font-service-handler.js'
// 导入抠图高清服务
import { registerHdServiceHandlers, unregisterHdServiceHandlers } from './hd-service.js'
// 导入视频字幕OCR服务
import { registerVideoOcrServiceHandlers, unregisterVideoOcrServiceHandlers } from './video-ocr-service.js'
// 导入模板存储服务
import { registerTemplateStorageHandlers, unregisterTemplateStorageHandlers } from './template-storage-service.js'
import { registerPresetHandlers, unregisterPresetHandlers } from './preset-handler.js'
import { registerPromptTemplateHandlers, unregisterPromptTemplateHandlers } from './prompt-template-service.js'
import fs from 'fs'

// 独立保存免登录版本配置，避免读取旧版的本地数据。
app.setName('momentum-stick-figure-open')
app.setPath('userData', path.join(app.getPath('appData'), 'momentum-stick-figure-open'))
const {
  registerBrowserViewHandlers,
  unregisterBrowserViewHandlers
} = createBrowserViewController({ getPicturesDirectory })

// 窗口引用由唯一控制器保存，入口仅按原顺序调用生命周期方法。
const {
  createWindow,
  registerWindowControlHandlers,
  unregisterWindowControlHandlers,
  registerGlobalHotkeys,
  registerHotkeyHandlers,
  unregisterHotkeyHandlers
} = createWindowController({ mainDirectory: __dirname })


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

// 在Windows上规避GPU驱动异常：禁用硬件加速并使用软件渲染（ANGLE WARP）
try {
  if (process.platform === 'win32') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('use-angle', 'warp')
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-features', 'DirectComposition,Accelerated2dCanvas,CanvasOopRasterization,UseSkiaRenderer')
  }
} catch (_) {}
