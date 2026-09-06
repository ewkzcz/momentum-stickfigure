/**
 * 字体服务IPC处理器
 * 将字体服务暴露给渲染进程
 */

import { ipcMain } from 'electron'
import { getSystemFonts } from './font-service.js'

/**
 * 注册字体服务IPC处理器
 * 处理流程：
 * 1、绑定系统字体查询通道。
 * 2、调用字体服务，统一返回字体列表或失败信息。
 */
export function registerFontServiceHandlers() {
  console.log('[IPC] 注册字体服务处理器...')

  // 1、注册系统字体查询入口。
  ipcMain.handle('fonts:get-system-fonts', async () => {
    try {
      console.log('[IPC] 调用: fonts:get-system-fonts')
      // 2、获取字体列表并包装为渲染进程可用的结果。
      const fonts = await getSystemFonts()
      console.log(`[IPC] 成功获取 ${fonts.length} 个系统字体`)
      return {
        success: true,
        fonts: fonts
      }
    } catch (error) {
      console.error('[IPC] fonts:get-system-fonts 失败:', error)
      return {
        success: false,
        error: error.message || '获取系统字体失败',
        fonts: []
      }
    }
  })

  console.log('[IPC] 字体服务处理器注册完成')
}
