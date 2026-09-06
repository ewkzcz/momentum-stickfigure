/**
 * 统一Storage管理器 - 跨实例localStorage同步
 * 所有应用实例共享同一个数据文件，实现真正的多开数据共享
 */

import { BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import os from 'os'

const ENABLE_REALTIME_MULTI_INSTANCE_SYNC = false

/** 存储管理器：维护字符串键值缓存、共享文件和窗口变更通知。 */
class StorageManager {
  /**
   * 初始化共享存储。
   * 处理流程：
   * 1、准备缓存、共享目录及防抖状态。
   * 2、恢复磁盘数据，并按开关启动文件监听。
   */
  constructor() {
    // 1、初始化缓存、共享路径以及写入和批量操作状态。
    this.storage = new Map()

    // 使用固定的共享路径 - 所有实例都使用这个路径
    // 使用应用名称创建固定的目录，确保所有实例共享
    const appName = 'momentum-stickfigure-open'
    const sharedDataDir = path.join(os.homedir(), '.config', appName)

    // 确保目录存在
    if (!fs.existsSync(sharedDataDir)) {
      fs.mkdirSync(sharedDataDir, { recursive: true })
    }

    // 持久化文件路径 - 固定路径，所有实例共享
    this.storageFilePath = path.join(sharedDataDir, 'shared-storage.json')

    console.log('[StorageManager] 共享数据路径:', this.storageFilePath)

    // 防抖定时器
    this.saveTimer = null
    this.saveDelay = 5000 // 5秒防抖延迟 - 大幅减少文件写入频率

    // 文件监听器
    this.fileWatcher = null
    this.reloadTimer = null
    this.reloadDelay = 3000 // 3秒防抖延迟 - 避免频繁重载

    // 标记是否正在写入（避免监听到自己的写入）
    this.isWriting = false
    this.lastWriteTime = 0
    this.writeProtectionTime = 8000 // 8秒写入保护期 - 防止多实例循环触发

    // 批量操作标记
    this.batchMode = false
    this.batchChanges = []

    // 2、加载持久化数据，再尝试启动可选的文件监听。
    this.loadStorage()

    // 启动文件监听（监听其他实例的修改）
    this.watchStorageFile()

    console.log('[StorageManager] 初始化完成，支持多实例数据共享')
  }

  /**
   * 从文件加载storage（优化版本，移除busy-wait）
   * 处理流程：
   * 1、读取已有 JSON 文件并恢复为 Map。
   * 2、解析失败时清空缓存并记录错误。
   */
  loadStorage() {
    // 1、只读取已存在的存储文件，异常时恢复空缓存。
    try {
      if (fs.existsSync(this.storageFilePath)) {
        const data = fs.readFileSync(this.storageFilePath, 'utf-8')
        const storageData = JSON.parse(data)

        // 将对象转换为Map
        this.storage = new Map(Object.entries(storageData))

        console.log(`[StorageManager] 从文件恢复 ${this.storage.size} 条数据`)
      }
    } catch (error) {
      console.error('[StorageManager] 加载storage失败:', error)
      this.storage = new Map()
    }
  }

  /**
   * 保存storage到文件（防抖）
   * 处理流程：
   * 1、取消旧保存任务，延迟合并连续修改。
   * 2、标记写入时间，将缓存异步保存并释放写入标记。
   */
  saveStorage() {
    // 1、清除之前的定时器。
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    // 2、设置新的定时器，延迟序列化并保存最新缓存。
    this.saveTimer = setTimeout(() => {
      try {
        // 标记正在写入
        this.isWriting = true
        this.lastWriteTime = Date.now()

        // 将Map转换为普通对象
        const storageData = Object.fromEntries(this.storage)

        // 异步写入文件
        fs.writeFile(
          this.storageFilePath,
          JSON.stringify(storageData, null, 2),
          'utf-8',
          (err) => {
            this.isWriting = false
            if (err) {
              console.error('[StorageManager] 保存storage失败:', err)
            }
            // 成功保存时不输出日志，避免日志过多
          }
        )
      } catch (error) {
        this.isWriting = false
        console.error('[StorageManager] 保存storage异常:', error)
      }
    }, this.saveDelay)
  }

  /**
   * 监听文件变化（其他实例的修改）
   * 处理流程：
   * 1、检查实时监听开关并准备存储文件。
   * 2、过滤写入保护期内的事件，对外部修改防抖重载。
   */
  watchStorageFile() {
    // 1、实时同步默认关闭，共享文件仍用于冷启动恢复。
    if (!ENABLE_REALTIME_MULTI_INSTANCE_SYNC) {
      console.log('[StorageManager] 已禁用实时多实例监听，使用共享文件做冷启动同步')
      return
    }

    try {
      // 确保文件存在
      if (!fs.existsSync(this.storageFilePath)) {
        // 创建空文件
        fs.writeFileSync(this.storageFilePath, '{}', 'utf-8')
      }

      // 2、监听文件变化并过滤自身写入。
      this.fileWatcher = fs.watch(this.storageFilePath, (eventType) => {
        // 如果是自己写入的，忽略（使用更长的保护期）
        const timeSinceWrite = Date.now() - this.lastWriteTime
        if (this.isWriting || timeSinceWrite < this.writeProtectionTime) {
          return
        }

        // 防抖重新加载（延迟更长，避免频繁触发）
        if (this.reloadTimer) {
          clearTimeout(this.reloadTimer)
        }

        this.reloadTimer = setTimeout(() => {
          // 静默重新加载，避免日志过多
          this.reloadFromFile()
        }, this.reloadDelay)
      })

      console.log('[StorageManager] 文件监听已启动')
    } catch (error) {
      console.error('[StorageManager] 启动文件监听失败:', error)
    }
  }

  /**
   * 从文件重新加载数据（其他实例修改后，优化版本）
   * 处理流程：
   * 1、读取文件，比较新增、修改及删除的键。
   * 2、替换缓存并向窗口广播差异。
   */
  reloadFromFile() {
    // 1、读取最新快照并计算键值差异。
    try {
      if (!fs.existsSync(this.storageFilePath)) {
        return
      }

      const data = fs.readFileSync(this.storageFilePath, 'utf-8')
      const storageData = JSON.parse(data)

      // 检测变化的键
      const newStorage = new Map(Object.entries(storageData))
      const changedKeys = []

      // 找出新增或修改的键
      for (const [key, value] of newStorage.entries()) {
        if (this.storage.get(key) !== value) {
          changedKeys.push({ key, value, method: 'setItem' })
        }
      }

      // 找出删除的键
      for (const key of this.storage.keys()) {
        if (!newStorage.has(key)) {
          changedKeys.push({ key, value: null, method: 'removeItem' })
        }
      }

      // 2、更新本地存储并广播差异。
      this.storage = newStorage

      // 广播变化给当前实例的所有窗口
      changedKeys.forEach(change => {
        this.broadcastStorageChange(change.method, change.key, change.value)
      })

      // 只在变化较多时输出日志（避免频繁输出）
      if (changedKeys.length > 10) {
        console.log(`[StorageManager] 已从其他实例同步 ${changedKeys.length} 个变化`)
      }
    } catch (error) {
      // 读取失败时静默处理，避免阻塞
      console.warn('[StorageManager] 重新加载失败（可能文件被占用）:', error.message)
    }
  }

  /**
   * 设置storage项
   * 处理流程：
   * 1、将值转为字符串，跳过相同值。
   * 2、批量模式收集变更，否则安排保存并广播。
   * @param {string} key 键
   * @param {any} value 值
   */
  setItem(key, value) {
    try {
      // 1、将值转换为字符串并跳过未变化的数据。
      const stringValue = String(value)

      // 检查值是否真的改变了
      const oldValue = this.storage.get(key)
      if (oldValue === stringValue) {
        return true // 值没有变化，不需要触发更新
      }

      this.storage.set(key, stringValue)

      // 2、批量模式仅收集变化，普通模式继续保存和广播。
      if (this.batchMode) {
        this.batchChanges.push({ method: 'setItem', key, value: stringValue })
        return true
      }

      // 防抖持久化
      this.saveStorage()

      // 广播给所有窗口
      this.broadcastStorageChange('setItem', key, stringValue)

      return true
    } catch (error) {
      console.error('[StorageManager] setItem失败:', error)
      return false
    }
  }

  /**
   * 获取storage项
   * 处理流程：
   * 1、读取缓存值，缺失或空值按现有约定返回 null。
   * @param {string} key 键
   * @returns {string|null} 值
   */
  getItem(key) {
    // 1、返回缓存中的有效字符串或空值标记。
    return this.storage.get(key) || null
  }

  /**
   * 删除storage项
   * 处理流程：
   * 1、跳过不存在的键并删除已有项。
   * 2、安排持久化并广播删除事件。
   * @param {string} key 键
   */
  removeItem(key) {
    // 1、检查键是否存在，避免重复触发变更。
    try {
      if (!this.storage.has(key)) {
        return true // 键不存在，不需要触发更新
      }

      // 2、删除缓存项并同步保存、广播。
      this.storage.delete(key)

      // 防抖持久化
      this.saveStorage()

      // 广播给所有窗口
      this.broadcastStorageChange('removeItem', key, null)

      return true
    } catch (error) {
      console.error('[StorageManager] removeItem失败:', error)
      return false
    }
  }

  /**
   * 清空storage
   * 处理流程：
   * 1、跳过已为空的缓存。
   * 2、清空数据并安排持久化、广播。
   */
  clear() {
    // 1、空集合直接返回成功。
    try {
      if (this.storage.size === 0) {
        return true // 已经是空的，不需要触发更新
      }

      // 2、清空缓存并通知持久化及窗口同步。
      this.storage.clear()

      // 防抖持久化
      this.saveStorage()

      // 广播给所有窗口
      this.broadcastStorageChange('clear', null, null)

      return true
    } catch (error) {
      console.error('[StorageManager] clear失败:', error)
      return false
    }
  }

  /**
   * 获取所有键
   * 处理流程：
   * 1、将缓存键迭代器转换为数组。
   * @returns {string[]} 所有键的数组
   */
  keys() {
    // 1、返回当前键列表快照。
    return Array.from(this.storage.keys())
  }

  /**
   * 获取storage大小
   * 处理流程：
   * 1、返回缓存中的键值项数量。
   * @returns {number} 项目数量
   */
  length() {
    // 1、读取 Map 当前大小。
    return this.storage.size
  }

  /**
   * 获取所有数据（用于初始化同步）
   * 处理流程：
   * 1、将缓存转换为可通过 IPC 传递的普通对象。
   * @returns {Object} 所有数据
   */
  getAllData() {
    // 1、生成初始化窗口所需的键值快照。
    return Object.fromEntries(this.storage)
  }

  /**
   * 广播storage变化给所有窗口
   * 处理流程：
   * 1、获取当前窗口列表。
   * 2、发送变更载荷，忽略关闭窗口的发送失败。
   * @param {string} method 方法名 ('setItem' | 'removeItem' | 'clear')
   * @param {string|null} key 键
   * @param {string|null} value 值
   */
  broadcastStorageChange(method, key, value) {
    // 1、获取窗口快照。
    const windows = BrowserWindow.getAllWindows()

    // 2、逐窗口发送变更信息。
    windows.forEach((window) => {
      try {
        window.webContents.send('storage-changed', {
          method,
          key,
          value
        })
      } catch (error) {
        // 忽略发送失败的错误（窗口可能正在关闭）
      }
    })
  }

  /**
   * 立即保存到文件（用于应用退出时）
   * 处理流程：
   * 1、取消延迟保存任务。
   * 2、同步写入当前缓存并释放写入标记。
   */
  flushSync() {
    // 1、取消防抖任务，避免退出时仍有延迟写入。
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }

    try {
      this.isWriting = true
      // 2、同步落盘，退出前无需等待异步回调。
      const storageData = Object.fromEntries(this.storage)
      fs.writeFileSync(
        this.storageFilePath,
        JSON.stringify(storageData, null, 2),
        'utf-8'
      )
      this.isWriting = false
      console.log('[StorageManager] 已同步保存所有数据到共享文件')
    } catch (error) {
      this.isWriting = false
      console.error('[StorageManager] 同步保存失败:', error)
    }
  }

  /**
   * 开始批量操作（避免频繁写入）
   * 处理流程：
   * 1、开启批量模式并初始化待广播变更列表。
   */
  startBatch() {
    // 1、为本轮批量修改准备状态。
    this.batchMode = true
    this.batchChanges = []
  }

  /**
   * 批量设置多个值（在批量模式下）
   * 处理流程：
   * 1、确认已开启批量模式。
   * 2、逐项规范字符串，只记录发生变化的键。
   * @param {Object} items - 键值对对象
   */
  batchSetItems(items) {
    // 1、要求调用方先开始批量操作。
    if (!this.batchMode) {
      console.warn('[StorageManager] 未启用批量模式，使用 startBatch() 开始')
      return false
    }

    try {
      // 2、更新缓存并积累变更，统一交由结束操作保存。
      for (const [key, value] of Object.entries(items)) {
        const stringValue = String(value)
        const oldValue = this.storage.get(key)

        if (oldValue !== stringValue) {
          this.storage.set(key, stringValue)
          this.batchChanges.push({ method: 'setItem', key, value: stringValue })
        }
      }
      return true
    } catch (error) {
      console.error('[StorageManager] batchSetItems失败:', error)
      return false
    }
  }

  /**
   * 结束批量操作并保存
   * 处理流程：
   * 1、检查并关闭批量模式。
   * 2、有变更时统一保存、广播，清空变更列表。
   */
  endBatch() {
    // 1、结束当前批量状态，非批量调用直接退出。
    if (!this.batchMode) {
      return
    }

    this.batchMode = false

    // 2、如果有变化，统一保存并逐项广播。
    if (this.batchChanges.length > 0) {
      console.log(`[StorageManager] 批量操作: ${this.batchChanges.length} 个变化`)

      // 保存到文件
      this.saveStorage()

      // 广播所有变化
      this.batchChanges.forEach(change => {
        this.broadcastStorageChange(change.method, change.key, change.value)
      })

      this.batchChanges = []
    }
  }

  /**
   * 清理资源
   * 处理流程：
   * 1、关闭文件监听。
   * 2、取消保存和重载定时器。
   */
  cleanup() {
    // 1、释放文件监听句柄。
    if (this.fileWatcher) {
      this.fileWatcher.close()
      this.fileWatcher = null
      console.log('[StorageManager] 文件监听已关闭')
    }

    // 2、取消尚未执行的保存和重载任务。
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
    }

    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
    }
  }
}

// 创建单例
const storageManager = new StorageManager()

// 应用退出时立即保存
app.on('will-quit', () => {
  storageManager.flushSync()
  storageManager.cleanup()
})

export default storageManager
