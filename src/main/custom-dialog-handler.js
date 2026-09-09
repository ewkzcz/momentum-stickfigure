/**
 * 自定义对话框图片管理：注册保存、扫描、删除接口并清理事件监听。
 */
import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'

/**
 * 注册自定义对话框图片的本地管理接口。
 * 处理流程：
 * 1、准备图片目录并注册保存入口。
 * 2、扫描支持的图片并按修改时间排序。
 * 3、提供单张图片删除入口。
 */
export function registerCustomDialogHandlers() {
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
export function unregisterCustomDialogHandlers() {
  // 1、清理图片管理的三个事件通道。
  ipcMain.removeAllListeners('save-custom-dialog')
  ipcMain.removeAllListeners('scan-custom-dialogs')
  ipcMain.removeAllListeners('delete-custom-dialog')
  console.log('✓ 自定义对话框处理器已移除')
}
