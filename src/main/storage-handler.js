/**
 * Storage服务IPC处理器
 * 将Storage管理器暴露给渲染进程
 */

import { ipcMain } from 'electron'
import storageManager from './storage-manager.js'

/**
 * 注册Storage服务IPC处理器
 * 处理流程：
 * 1、注册键值读写和清空处理器。
 * 2、注册键列表、数量与初始化快照查询，统一返回成功或错误结果。
 */
export function registerStorageHandlers() {
  console.log('[IPC] 注册Storage服务处理器...')

  // 1、注册设置存储项的入口。
  ipcMain.handle('storage:setItem', async (event, key, value) => {
    try {
      const success = storageManager.setItem(key, value)
      return { success }
    } catch (error) {
      console.error('[IPC] storage:setItem 失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 2、注册读取存储项的入口。
  ipcMain.handle('storage:getItem', async (event, key) => {
    try {
      const value = storageManager.getItem(key)
      return { success: true, value }
    } catch (error) {
      console.error('[IPC] storage:getItem 失败:', error)
      return { success: false, value: null, error: error.message }
    }
  })

  // 3、注册删除存储项的入口。
  ipcMain.handle('storage:removeItem', async (event, key) => {
    try {
      const success = storageManager.removeItem(key)
      return { success }
    } catch (error) {
      console.error('[IPC] storage:removeItem 失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 4、注册清空存储的入口。
  ipcMain.handle('storage:clear', async () => {
    try {
      const success = storageManager.clear()
      return { success }
    } catch (error) {
      console.error('[IPC] storage:clear 失败:', error)
      return { success: false, error: error.message }
    }
  })

  // 5、注册键列表查询。
  ipcMain.handle('storage:keys', async () => {
    try {
      const keys = storageManager.keys()
      return { success: true, keys }
    } catch (error) {
      console.error('[IPC] storage:keys 失败:', error)
      return { success: false, keys: [], error: error.message }
    }
  })

  // 6、注册存储项数量查询。
  ipcMain.handle('storage:length', async () => {
    try {
      const length = storageManager.length()
      return { success: true, length }
    } catch (error) {
      console.error('[IPC] storage:length 失败:', error)
      return { success: false, length: 0, error: error.message }
    }
  })

  // 7、注册全量数据查询，供窗口初始化同步。
  ipcMain.handle('storage:getAllData', async () => {
    try {
      const data = storageManager.getAllData()
      return { success: true, data }
    } catch (error) {
      console.error('[IPC] storage:getAllData 失败:', error)
      return { success: false, data: {}, error: error.message }
    }
  })

  console.log('[IPC] Storage服务处理器注册完成')
}

/**
 * 注销Storage服务IPC处理器
 * 处理流程：
 * 1、移除本模块注册的全部存储 IPC 处理器。
 */
export function unregisterStorageHandlers() {
  // 1、解除各个存储通道的处理器绑定。
  console.log('[IPC] 注销Storage服务处理器...')

  ipcMain.removeHandler('storage:setItem')
  ipcMain.removeHandler('storage:getItem')
  ipcMain.removeHandler('storage:removeItem')
  ipcMain.removeHandler('storage:clear')
  ipcMain.removeHandler('storage:keys')
  ipcMain.removeHandler('storage:length')
  ipcMain.removeHandler('storage:getAllData')

  console.log('[IPC] Storage服务处理器注销完成')
}
