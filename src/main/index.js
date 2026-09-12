/**
 * 主进程入口：管理应用窗口、系统交互、内嵌网页以及各业务模块的进程通信。
 */
import { app, BrowserWindow, dialog, Menu, MenuItem } from 'electron'
import { electronApp } from '@electron-toolkit/utils'
import { createWindowController } from './window-controller.js'
import { createBrowserViewController } from './browser-view-controller.js'
import { getPicturesDirectory, registerDragToJianyingHandlers, unregisterDragToJianyingHandlers } from './drag-clipboard-handler.js'
import { registerShellHandlers, unregisterShellHandlers } from './shell-handler.js'
import path from 'path'
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

// 在Windows上规避GPU驱动异常：禁用硬件加速并使用软件渲染（ANGLE WARP）
try {
  if (process.platform === 'win32') {
    app.disableHardwareAcceleration()
    app.commandLine.appendSwitch('use-angle', 'warp')
    app.commandLine.appendSwitch('disable-gpu')
    app.commandLine.appendSwitch('disable-features', 'DirectComposition,Accelerated2dCanvas,CanvasOopRasterization,UseSkiaRenderer')
  }
} catch (_) {}
