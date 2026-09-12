/**
 * 系统链接处理模块：注册与清理系统浏览器打开外部链接的进程通信入口。
 */
import { ipcMain, shell } from 'electron'

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

// 导出职责：供主入口按原生命周期顺序注册与清理系统链接处理器。
export { registerShellHandlers, unregisterShellHandlers }
