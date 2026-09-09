/**
 * 文件选择处理器：管理文件对话框、图片预览、临时图片保存与目录打开。
 * 处理流程：
 * 1、注册绑定调用窗口的文件选择与保存位置接口。
 * 2、读取图片预览并保存临时图片，转发系统目录打开请求。
 * 3、按原有通道列表清理事件监听。
 */
import { app, BrowserWindow, shell, dialog, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * 注册文件选择、临时图片保存与目录打开接口。
 * 处理流程：
 * 1、提供 PSD、文件夹和通用文件对话框。
 * 2、提供保存位置选择与图片预览数据。
 * 3、保存粘贴图片并提供系统目录打开入口。
 */
export function registerFolderSelectHandler() {
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
      /**
       * 读取单张图片的信息与预览。
       * 处理流程：
       * 1、取得文件元数据。
       * 2、读取字节并按扩展名生成预览，失败时保留空预览。
       * 3、返回完整文件信息。
       */
      const files = filePaths.map(filePath => {
        // 1、读取真实文件元数据。
        const stats = fs.statSync(filePath)
        
        // 2、读取文件并转换为base64（用于预览）。
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
        
        // 3、返回元数据与可用预览。
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
export function unregisterFolderSelectHandler() {
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
