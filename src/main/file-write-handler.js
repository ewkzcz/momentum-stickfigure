/** 文件写入处理器：保存导出字节并管理拖入文件的临时落盘。 */
import { app, ipcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { isTrustedIpcSender } from './ipc-sender-policy.js'
import { assertText, assertBinaryPayload } from './ipc-parameter-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'
import { assertOwnedFilePath, writeOwnedFile, grantSelectedReads } from './file-access-policy.js'
import { writeExportFile } from './export-write-policy.js'

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
    if (!isTrustedIpcSender(event)) return { success: false, error: '未授权的文件操作来源' }
    try {
      assertText(filePath, 32768, '文件路径')
      // 通用写文件使用裸Base64；空串保留历史空文件导出契约。
      if (base64Data !== '') {
        if (typeof base64Data === 'string' && base64Data.startsWith('data:')) throw new TypeError('文件数据参数必须是裸base64')
        assertImageBase64(base64Data, 128 * 1024 * 1024)
      }
      console.log('写入文件:', filePath)

      // 授权检查先于创建目录；独占写入保留重名编号且不覆盖现有文件。
      const buffer = Buffer.from(base64Data, 'base64')
      const finalFilePath = writeExportFile(event.sender, filePath, buffer)

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
    if (!isTrustedIpcSender(event)) return { success: false, error: '未授权的文件操作来源' }
    try {
      assertText(fileName, 255, '拖拽文件名')
      assertBinaryPayload(arrayBuffer)
      console.log('保存拖拽文件到临时目录:', fileName)

      // 1、定位应用使用的拖入文件临时目录。
      const tempDir = app.getPath('temp')
      const appTempDir = assertOwnedFilePath(tempDir, ['momentum-stickfigure', 'dragged-files'])

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
      const filePath = assertOwnedFilePath(tempDir, ['momentum-stickfigure', 'dragged-files', sanitizedFileName])

      // 合法同名文件保持覆盖；不删除链接后绕过目标身份检查。

      // 3、将传入字节转换为缓冲区并写入临时文件。
      const buffer = ArrayBuffer.isView(arrayBuffer)
        ? Buffer.from(arrayBuffer.buffer, arrayBuffer.byteOffset, arrayBuffer.byteLength)
        : Buffer.from(arrayBuffer)
      writeOwnedFile(filePath, buffer)
      grantSelectedReads(event.sender, [filePath])

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
  ipcMain.removeHandler('write-file')
  ipcMain.removeHandler('save-dragged-file')
  console.log('✓ 文件写入处理器已移除')
}
