/** 文件写入处理器：保存导出字节并管理拖入文件的临时落盘。 */
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'

/**
 * 注册图片写入与拖入文件落盘接口。
 * 处理流程：
 * 1、保存 Base64 文件，重名时查找新的文件名。
 * 2、清理拖入文件名并写入临时目录。
 */
export function registerFileWriteHandler() {
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
export function unregisterFileWriteHandler() {
  // 1、清理两个文件写入通道的事件监听。
  ipcMain.removeAllListeners('write-file')
  ipcMain.removeAllListeners('save-dragged-file')
  console.log('✓ 文件写入处理器已移除')
}
