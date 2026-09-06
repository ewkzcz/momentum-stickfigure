/**
 * 预加载桥接：向渲染进程暴露环境信息、业务调用和可取消的消息订阅。
 */
import { contextBridge, ipcRenderer } from 'electron'

// 暴露环境信息
const os = require('os')
const { pathToFileURL } = require('url')
contextBridge.exposeInMainWorld('env', {
  platform: process.platform,
  homedir: os.homedir(),
  /**
   * 将本地文件路径转换为页面可用地址。
   * 处理流程：
   * 1、优先使用标准路径转换接口。
   * 2、转换异常时根据平台手动拼接文件地址。
   */
  pathToFileURL: (filePath) => {
    // 1、由标准接口处理路径编码与平台差异。
    try {
      return pathToFileURL(filePath).href
    } catch (error) {
      console.error('路径转换失败:', error)
      // 2、降级处理：手动转换路径分隔符与文件地址前缀。
      let fileUrl = filePath.replace(/\\/g, '/')
      if (process.platform === 'win32') {
        // Windows: file:///C:/path/to/file.mp4
        if (!fileUrl.startsWith('/')) {
          fileUrl = '/' + fileUrl
        }
        return `file:///${fileUrl}`
      } else {
        // Unix/Linux/Mac: file:///path/to/file.mp4
        return `file://${fileUrl}`
      }
    }
  }
})

// 暴露文件系统 API
contextBridge.exposeInMainWorld('fileSystem', {
  /**
   * 选择文件夹。
   * 处理流程：
   * 1、调用主进程文件夹对话框并返回选择结果。
   */
  selectFolder: async () => {
    // 1、等待主进程返回选择或取消状态。
    return await ipcRenderer.invoke('select-folder')
  },
  /**
   * 选择图片文件。
   * 处理流程：
   * 1、调用图片选择接口并返回文件与预览数据。
   */
  selectImageFiles: async () => {
    // 1、将图片选择工作交给主进程。
    return await ipcRenderer.invoke('select-image-files')
  },
  /**
   * 按指定选项选择文件。
   * 处理流程：
   * 1、转发筛选和多选选项，返回对话框结果。
   */
  selectFile: async (options = {}) => {
    // 1、保持调用方对话框选项原样传递。
    return await ipcRenderer.invoke('select-file', options)
  },
  /**
   * 使用系统文件管理器打开目录。
   * 处理流程：
   * 1、转发目录路径并返回打开结果。
   */
  openFolder: async (folderPath) => {
    // 1、交由主进程调用系统目录打开接口。
    return await ipcRenderer.invoke('open-folder', folderPath)
  },
  /**
   * 保存粘贴功能使用的临时图片。
   * 处理流程：
   * 1、转发编码数据与建议名称并返回落盘路径。
   */
  saveTempImage: async (base64Data, fileName) => {
    // 1、等待主进程完成图片写入。
    return await ipcRenderer.invoke('save-temp-image', base64Data, fileName)
  }
})

// 暴露自定义对话框 API
contextBridge.exposeInMainWorld('customDialog', {
  /**
   * 保存自定义对话框图片。
   * 处理流程：
   * 1、提交名称和图片内容并返回保存结果。
   */
  save: async (fileName, base64Data) => {
    // 1、通过主进程写入图片目录。
    return await ipcRenderer.invoke('save-custom-dialog', fileName, base64Data)
  },
  /**
   * 获取已保存的自定义对话框图片。
   * 处理流程：
   * 1、请求主进程扫描目录并返回图片列表。
   */
  scan: async () => {
    // 1、等待目录扫描和预览数据生成。
    return await ipcRenderer.invoke('scan-custom-dialogs')
  },
  /**
   * 删除自定义对话框图片。
   * 处理流程：
   * 1、按文件名请求主进程删除图片。
   */
  delete: async (fileName) => {
    // 1、返回删除操作结果。
    return await ipcRenderer.invoke('delete-custom-dialog', fileName)
  }
})

// 暴露文件操作 API 
contextBridge.exposeInMainWorld('api', {
  /**
   * 将编码后的文件内容写入指定位置。
   * 处理流程：
   * 1、转发路径和数据并返回实际保存位置。
   */
  writeFile: async (filePath, base64Data) => {
    // 1、由主进程处理目录创建与同名文件。
    return await ipcRenderer.invoke('write-file', filePath, base64Data)
  }
})

// 提示词模板共享 API
contextBridge.exposeInMainWorld('promptTemplates', {
  /**
   * 获取指定类型的提示词模板。
   * 处理流程：
   * 1、转发模板类型并返回共享模板列表。
   */
  getTemplates: async (type = 'image') => {
    // 1、从主进程读取各窗口共享的模板。
    return await ipcRenderer.invoke('prompt-templates:get', type)
  },
  /**
   * 保存指定类型的提示词模板。
   * 处理流程：
   * 1、将类型与模板列表组合后提交保存。
   */
  saveTemplates: async (type = 'image', templates = []) => {
    // 1、使用主进程约定的对象结构提交更新。
    return await ipcRenderer.invoke('prompt-templates:save', { type, templates })
  },
  /**
   * 订阅跨窗口提示词模板更新。
   * 处理流程：
   * 1、包装回调并过滤无效的回调参数。
   * 2、注册监听，返回仅移除本次订阅的函数。
   */
  onTemplatesChanged: (callback) => {
    // 1、隐藏进程事件对象，仅向页面传递模板变更数据。
    /**
     * 将模板变更转交有效的页面回调。
     * 处理流程：
     * 1、确认回调可调用后传入业务载荷。
     */
    const subscription = (_event, payload) => {
      // 1、忽略无效回调，避免事件派发时抛出类型错误。
      if (typeof callback === 'function') {
        callback(payload)
      }
    }
    // 2、保留包装函数引用，以便准确取消本次订阅。
    ipcRenderer.on('prompt-templates-updated', subscription)
    return () => ipcRenderer.removeListener('prompt-templates-updated', subscription)
  }
})

// 暴露 Fal.ai API
contextBridge.exposeInMainWorld('falApi', {
  /**
   * 提交图片生成任务。
   * 处理流程：
   * 1、转发生成选项并返回任务结果。
   */
  generateImage: async (options) => {
    // 1、保持图片生成参数原样传递。
    return await ipcRenderer.invoke('fal-generate-image', options)
  },
  
  /**
   * 提交图片编辑任务。
   * 处理流程：
   * 1、转发编辑选项并返回任务结果。
   */
  editImage: async (options) => {
    // 1、等待主进程处理图片编辑。
    return await ipcRenderer.invoke('fal-edit-image', options)
  },
  
  /**
   * 获取图片服务的合并配置。
   * 处理流程：
   * 1、提交调用方配置并返回主进程合并结果。
   */
  getConfig: async (userConfig = {}) => {
    // 1、由主进程应用服务配置规则。
    return await ipcRenderer.invoke('fal-get-config', userConfig)
  },
  
  /**
   * 检查单张图片是否符合要求。
   * 处理流程：
   * 1、转发图片路径并返回检查结果。
   */
  validateImage: async (imagePath) => {
    // 1、调用主进程的图片验证入口。
    return await ipcRenderer.invoke('fal-validate-image', imagePath)
  },
  
  /**
   * 批量检查图片是否符合要求。
   * 处理流程：
   * 1、提交图片路径列表并返回检查结果。
   */
  validateImages: async (imagePaths) => {
    // 1、让主进程统一处理批量文件检查。
    return await ipcRenderer.invoke('fal-validate-images', imagePaths)
  },
  
  /**
   * 准备图片服务所需目录。
   * 处理流程：
   * 1、转发目录配置并返回创建结果。
   */
  createDirectories: async (config = {}) => {
    // 1、由主进程根据配置创建目录。
    return await ipcRenderer.invoke('fal-create-directories', config)
  }
})

// 暴露抠图高清 API
contextBridge.exposeInMainWorld('hdToolkit', {
  /**
   * 获取高清工具的初始配置与模型列表。
   * 处理流程：
   * 1、请求主进程返回初始化数据。
   */
  getInitialData: async () => {
    // 1、读取工具初始化数据。
    return await ipcRenderer.invoke('hd:get-initial-data')
  },
  /**
   * 保存高清工具配置。
   * 处理流程：
   * 1、提交配置并返回合并后的保存结果。
   */
  saveConfig: async (config) => {
    // 1、由主进程完成配置持久化。
    return await ipcRenderer.invoke('hd:save-config', config)
  },
  /**
   * 提交本地去背景任务。
   * 处理流程：
   * 1、转发任务参数并等待处理结果。
   */
  runRemovebg: async (options) => {
    // 1、调用主进程的 Python 去背景流程。
    return await ipcRenderer.invoke('hd:run-removebg', options)
  },
  /**
   * 提交本地高清放大任务。
   * 处理流程：
   * 1、转发任务参数并等待处理结果。
   */
  runHighres: async (options) => {
    // 1、调用主进程的 Python 高清流程。
    return await ipcRenderer.invoke('hd:run-highres', options)
  },
  /**
   * 获取本地图片的预览数据。
   * 处理流程：
   * 1、传入图片路径并返回编码后的预览地址。
   */
  getImagePreview: async (imagePath) => {
    // 1、由主进程读取图片文件。
    return await ipcRenderer.invoke('hd:get-image-preview', imagePath)
  }
})

// 暴露 PSD API
contextBridge.exposeInMainWorld('psdApi', {
  /**
   * 解析 PSD 文件。
   * 处理流程：
   * 1、转发解析选项并返回文档结构。
   */
  parseFile: async (options) => {
    // 1、将文件解析交给主进程服务。
    return await ipcRenderer.invoke('psd-parse-file', options)
  },
  
  /**
   * 渲染 PSD 图层。
   * 处理流程：
   * 1、转发图层渲染选项并返回结果。
   */
  renderLayers: async (options) => {
    // 1、等待图层渲染任务完成。
    return await ipcRenderer.invoke('psd-render-layers', options)
  },
  
  /**
   * 检测 PSD 图层中的组件。
   * 处理流程：
   * 1、转发检测选项并返回组件信息。
   */
  detectComponents: async (options) => {
    // 1、调用主进程的组件检测服务。
    return await ipcRenderer.invoke('psd-detect-components', options)
  },
  
  /**
   * 查询 PSD 文件信息。
   * 处理流程：
   * 1、提交查询选项并返回文件元数据。
   */
  getInfo: async (options) => {
    // 1、请求主进程读取 PSD 信息。
    return await ipcRenderer.invoke('psd-get-info', options)
  },
  
  /**
   * 验证 PSD 文件。
   * 处理流程：
   * 1、提交验证选项并返回可用性检查结果。
   */
  validateFile: async (options) => {
    // 1、请求主进程执行文件检查。
    return await ipcRenderer.invoke('psd-validate-file', options)
  },
  
  /**
   * 查询 PSD 服务配置。
   * 处理流程：
   * 1、转发选项并返回服务配置。
   */
  getConfig: async (options = {}) => {
    // 1、读取主进程维护的 PSD 配置。
    return await ipcRenderer.invoke('psd-get-config', options)
  }
})

// 暴露给渲染进程的 Electron API
contextBridge.exposeInMainWorld('electronAPI', {
  /**
   * 发起通用进程通信调用。
   * 处理流程：
   * 1、原样转发通道和参数并返回请求结果。
   */
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  /**
   * 订阅指定通道的业务消息。
   * 处理流程：
   * 1、包装回调以隐藏进程事件对象。
   * 2、注册监听并返回取消本次订阅的函数。
   */
  on: (channel, func) => {
    // 1、仅把业务参数交给页面回调。
    /**
     * 将进程业务参数转发到页面。
     * 处理流程：
     * 1、剔除事件对象后调用业务回调。
     */
    const subscription = (_event, ...args) => func(...args)
    // 2、使用同一包装函数引用完成注册和注销。
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  /**
   * 清理指定通道的全部页面监听。
   * 处理流程：
   * 1、按通道移除现有监听器。
   */
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Storage管理 API（多窗口共享localStorage）
  storage: {
    /**
     * 保存共享存储项。
     * 处理流程：
     * 1、向主进程提交键和值。
     */
    setItem: (key, value) => ipcRenderer.invoke('storage:setItem', key, value),
    /**
     * 读取共享存储项。
     * 处理流程：
     * 1、按键请求主进程返回保存值。
     */
    getItem: (key) => ipcRenderer.invoke('storage:getItem', key),
    /**
     * 删除共享存储项。
     * 处理流程：
     * 1、按键请求主进程移除保存值。
     */
    removeItem: (key) => ipcRenderer.invoke('storage:removeItem', key),
    /**
     * 清空共享存储。
     * 处理流程：
     * 1、调用主进程的存储清空入口。
     */
    clear: () => ipcRenderer.invoke('storage:clear'),
    /**
     * 查询共享存储中的全部键。
     * 处理流程：
     * 1、返回主进程维护的键列表。
     */
    keys: () => ipcRenderer.invoke('storage:keys'),
    /**
     * 查询共享存储项数量。
     * 处理流程：
     * 1、请求主进程返回存储计数。
     */
    length: () => ipcRenderer.invoke('storage:length'),
    /**
     * 读取完整共享存储数据。
     * 处理流程：
     * 1、请求主进程返回全部数据。
     */
    getAllData: () => ipcRenderer.invoke('storage:getAllData'),
    /**
     * 订阅共享存储变化。
     * 处理流程：
     * 1、包装业务回调并注册变更监听。
     * 2、返回仅清理本次订阅的函数。
     */
    onStorageChanged: (callback) => {
      // 1、隐藏进程事件对象，仅转发存储变更数据。
      /**
       * 转发共享存储变更载荷。
       * 处理流程：
       * 1、把业务数据交给页面回调。
       */
      const subscription = (_event, data) => callback(data)
      ipcRenderer.on('storage-changed', subscription)
      // 2、保留订阅函数引用，精确取消本次监听。
      return () => ipcRenderer.removeListener('storage-changed', subscription)
    },
  },

  /**
   * 打开文件夹选择器。
   * 处理流程：
   * 1、请求主进程显示对话框并返回选择结果。
   */
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  
  /**
   * 打开 PSD 文件选择器。
   * 处理流程：
   * 1、请求主进程返回所选 PSD 路径。
   */
  selectPsdFiles: () => ipcRenderer.invoke('select-psd-files'),
  
  /**
   * 请求主进程写入文件。
   * 处理流程：
   * 1、原样转发目标路径和编码内容。
   */
  writeFile: (filePath, content) => ipcRenderer.invoke('write-file', filePath, content),
  
  /**
   * 检查本地文件是否存在。
   * 处理流程：
   * 1、转发路径并返回存在性检查结果。
   */
  checkFileExists: (filePath) => ipcRenderer.invoke('check-file-exists', filePath),
  /**
   * 读取本地文件内容。
   * 处理流程：
   * 1、转发路径并返回文件字节或空值。
   */
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),

  /**
   * 保存拖入页面的文件。
   * 处理流程：
   * 1、转发文件名和字节数据并返回临时路径。
   */
  saveDraggedFile: (fileName, arrayBuffer) => ipcRenderer.invoke('save-dragged-file', fileName, arrayBuffer),
  
  // Fal.ai API
  /**
   * 调用图片生成接口。
   * 处理流程：
   * 1、转发生成选项并返回结果。
   */
  falGenerate: (options) => ipcRenderer.invoke('fal-generate-image', options),
  /**
   * 调用图片编辑接口。
   * 处理流程：
   * 1、转发编辑选项并返回结果。
   */
  falEdit: (options) => ipcRenderer.invoke('fal-edit-image', options),
  /**
   * 查询图片服务配置。
   * 处理流程：
   * 1、请求主进程返回当前配置。
   */
  falGetConfig: () => ipcRenderer.invoke('fal-get-config'),
  /**
   * 查询图片任务历史。
   * 处理流程：
   * 1、调用历史查询通道并返回结果。
   */
  falGetHistory: () => ipcRenderer.invoke('fal-get-history'),
  /**
   * 验证图片服务配置。
   * 处理流程：
   * 1、转发配置并返回校验结果。
   */
  falValidateConfig: (config) => ipcRenderer.invoke('fal-validate-config', config),
  
  // PSD API
  /**
   * 解析 PSD 文档。
   * 处理流程：
   * 1、将解析选项转发到 PSD 服务。
   */
  psdParseFile: (options) => ipcRenderer.invoke('psd-parse-file', options),
  /**
   * 渲染 PSD 图层。
   * 处理流程：
   * 1、转发渲染选项并返回结果。
   */
  psdRenderLayers: (options) => ipcRenderer.invoke('psd-render-layers', options),
  /**
   * 检测 PSD 组件。
   * 处理流程：
   * 1、转发检测选项并返回组件数据。
   */
  psdDetectComponents: (options) => ipcRenderer.invoke('psd-detect-components', options),
  /**
   * 查询 PSD 文件元数据。
   * 处理流程：
   * 1、转发查询选项并返回文件信息。
   */
  psdGetInfo: (options) => ipcRenderer.invoke('psd-get-info', options),
  /**
   * 验证 PSD 文件可用性。
   * 处理流程：
   * 1、转发验证选项并返回检查结果。
   */
  psdValidateFile: (options) => ipcRenderer.invoke('psd-validate-file', options),
  /**
   * 获取 PSD 服务配置。
   * 处理流程：
   * 1、转发配置选项并返回合并结果。
   */
  psdGetConfig: (options) => ipcRenderer.invoke('psd-get-config', options),
  
  // 窗口控制 API
  /**
   * 设置当前窗口置顶状态。
   * 处理流程：
   * 1、转发置顶开关到主进程。
   */
  windowSetAlwaysOnTop: (flag) => ipcRenderer.invoke('window-set-always-on-top', flag),
  /**
   * 查询当前窗口置顶状态。
   * 处理流程：
   * 1、请求主进程读取调用窗口的状态。
   */
  windowGetAlwaysOnTop: () => ipcRenderer.invoke('window-get-always-on-top'),
  /**
   * 切换窗口显示模式。
   * 处理流程：
   * 1、转发插件或软件模式到窗口控制入口。
   */
  windowSetMode: (mode) => ipcRenderer.invoke('window-set-mode', mode),
  
  // 拖拽到剪映 API
  /**
   * 保存拖拽图片并复制路径。
   * 处理流程：
   * 1、转发图片和输出配置，返回保存结果。
   */
  saveDragImageAndCopy: (base64Data, iconPayload, stickfigureConfig) => ipcRenderer.invoke('save-drag-image-and-copy', base64Data, iconPayload, stickfigureConfig),
  /**
   * 保存图片并发起系统拖拽。
   * 处理流程：
   * 1、转发图片、图标、名称和输出设置。
   */
  createTempFileAndStartDrag: (base64Data, iconPayload, fileNameSuggestion, stickfigureConfig) => ipcRenderer.invoke('create-temp-file-and-start-drag', base64Data, iconPayload, fileNameSuggestion, stickfigureConfig),
  /**
   * 复制文本到系统剪贴板。
   * 处理流程：
   * 1、将文本提交到主进程剪贴板入口。
   */
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  /**
   * 查询当前窗口边界。
   * 处理流程：
   * 1、请求主进程返回调用窗口的位置与尺寸。
   */
  getWindowBounds: () => ipcRenderer.invoke('get-window-bounds'),
  
  // Shell API
  shell: {
    /**
     * 使用系统浏览器打开链接。
     * 处理流程：
     * 1、转发链接供主进程验证并打开。
     */
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  },
  
  // Theme API
  theme: {
    /**
     * 设置系统首选颜色方案。
     * 处理流程：
     * 1、转发主题选项供主进程同步原生主题。
     */
    setPreferredColorScheme: (scheme) => ipcRenderer.invoke('theme:setPreferredColorScheme', scheme)
  },
  
  // BrowserView 控制 API（用于稳定嵌入豆包官网等）
  browserView: {
    /**
     * 打开内嵌网页视图。
     * 处理流程：
     * 1、组合地址、边界和附加选项提交创建请求。
     */
    open: (url, bounds, opts = {}) => ipcRenderer.invoke('browserview:open', { url, bounds, ...opts }),
    /**
     * 关闭内嵌网页视图。
     * 处理流程：
     * 1、按地址和分区选项请求主进程关闭视图。
     */
    close: (url, opts = {}) => ipcRenderer.invoke('browserview:close', { url, ...opts }),
    /**
     * 设置内嵌网页边界。
     * 处理流程：
     * 1、提交视图定位选项与新的边界。
     */
    setBounds: (url, bounds, opts = {}) => ipcRenderer.invoke('browserview:setBounds', { url, bounds, ...opts }),
    /**
     * 同步内嵌网页主题。
     * 处理流程：
     * 1、组合地址、主题和选项并调用主进程。
     */
    applyTheme: (url, scheme, opts = {}) => ipcRenderer.invoke('browserview:applyTheme', { url, scheme, ...opts })
  },
  
  // 预设 API
  preset: {
    /**
     * 选择预设导出位置。
     * 处理流程：
     * 1、调用保存对话框并返回目标路径。
     */
    export: () => ipcRenderer.invoke('preset-export'),
    /**
     * 选择并读取预设文件。
     * 处理流程：
     * 1、调用导入入口并返回文件内容。
     */
    import: () => ipcRenderer.invoke('preset-import'),
    /**
     * 保存预设文本。
     * 处理流程：
     * 1、将目标路径和内容提交主进程写入。
     */
    saveFile: (filePath, content) => ipcRenderer.invoke('preset-save-file', filePath, content)
  },
  
  // 设置导入导出 API
  settings: {
    /**
     * 导出应用设置。
     * 处理流程：
     * 1、提交设置，由主进程选择文件并保存。
     */
    exportSettings: (settings) => ipcRenderer.invoke('settings-export', settings),
    /**
     * 导入应用设置。
     * 处理流程：
     * 1、调用导入入口并返回解析后的设置。
     */
    importSettings: () => ipcRenderer.invoke('settings-import'),
    /**
     * 自动备份应用设置。
     * 处理流程：
     * 1、将设置提交主进程执行备份轮换。
     */
    autoBackupSettings: (settings) => ipcRenderer.invoke('settings-auto-backup', settings),
    /**
     * 读取最近的设置备份。
     * 处理流程：
     * 1、请求主进程读取最新副本并返回设置。
     */
    restoreSettings: () => ipcRenderer.invoke('settings-restore')
  },
  
  // 快捷键 API
  hotkeys: {
    /**
     * 更新应用全局快捷键。
     * 处理流程：
     * 1、提交快捷键配置供主进程保存并注册。
     */
    updateHotkeys: (hotkeysConfig) => ipcRenderer.invoke('hotkeys-update', hotkeysConfig)
  },
  
  // 系统字体 API
  fonts: {
    /**
     * 查询可用系统字体。
     * 处理流程：
     * 1、请求主进程返回字体列表。
     */
    getSystemFonts: () => ipcRenderer.invoke('fonts:get-system-fonts')
  }
})

// 暴露视频字幕OCR API
contextBridge.exposeInMainWorld('videoOcr', {
  /**
   * 检查字幕识别环境。
   * 处理流程：
   * 1、提交 Python 路径并返回依赖检查结果。
   */
  checkEnvironment: (pythonHome) => ipcRenderer.invoke('video-ocr:check-environment', pythonHome),
  /**
   * 清理字幕识别环境。
   * 处理流程：
   * 1、转发 Python 路径并等待清理结果。
   */
  cleanEnvironment: (pythonHome) => ipcRenderer.invoke('video-ocr:clean-environment', pythonHome),
  /**
   * 安装字幕识别环境。
   * 处理流程：
   * 1、提交 Python 路径和镜像选项并等待安装结果。
   */
  installEnvironment: (pythonHome, useMirror) => ipcRenderer.invoke('video-ocr:install-environment', pythonHome, useMirror),
  /**
   * 提交视频字幕提取任务。
   * 处理流程：
   * 1、转发任务配置并返回字幕输出结果。
   */
  processVideo: (payload) => ipcRenderer.invoke('video-ocr:process-video', payload),
  /**
   * 订阅字幕任务和环境操作进度。
   * 处理流程：
   * 1、包装回调并监听进度通道。
   * 2、返回取消本次进度订阅的函数。
   */
  onProgress: (callback) => {
    // 1、仅将进度数据发送给页面回调。
    /**
     * 转发字幕服务进度载荷。
     * 处理流程：
     * 1、调用页面回调传递进度信息。
     */
    const subscription = (_event, data) => callback(data)
    ipcRenderer.on('video-ocr:progress', subscription)
    // 2、使用注册时的函数引用解除本次订阅。
    return () => ipcRenderer.removeListener('video-ocr:progress', subscription)
  }
})
