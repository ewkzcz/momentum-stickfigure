/** 文件读取处理器：保留本地存在性检查、原始字节读取及失败返回约定。 */
import { ipcMain } from 'electron'
import fs from 'fs'

/**
 * 注册本地文件存在性检查与读取接口。
 * 处理流程：
 * 1、查询路径存在性，异常时返回否定结果。
 * 2、读取文件字节，文件缺失或读取失败时返回空值。
 */
export function registerFileOperationHandlers() {
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
export function unregisterFileOperationHandlers() {
  // 1、按通道清理文件操作监听。
  ipcMain.removeAllListeners('check-file-exists')
  ipcMain.removeAllListeners('read-file')
  console.log('✓ 文件操作处理器已移除')
}
