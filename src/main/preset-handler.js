/** 预设文件处理器：管理预设导入导出位置选择和文本文件保存。 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * 注册预设文件导入导出接口。
 * 处理流程：
 * 1、选择导出位置。
 * 2、选择并读取导入文件。
 * 3、确保父目录存在后保存预设文本。
 */
export function registerPresetHandlers() {
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
export function unregisterPresetHandlers() {
  // 1、清理预设文件管理通道。
  ipcMain.removeAllListeners('preset-export')
  ipcMain.removeAllListeners('preset-import')
  ipcMain.removeAllListeners('preset-save-file')
  console.log('✓ 预设处理器已移除')
}
