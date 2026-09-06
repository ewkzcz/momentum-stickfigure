/**
 * LocalStorage同步代理
 * 在渲染进程初始化时，将localStorage操作代理到主进程的Storage管理器
 * 实现多窗口localStorage同步
 */

/** 本地存储同步代理：将窗口内写入转发到主进程，并接收其他窗口的变更。 */
export class LocalStorageSyncProxy {
  /**
   * 初始化代理状态。
   * 处理流程：
   * 1、建立初始化标志、订阅句柄和原生存储方法的占位字段。
   */
  constructor() {
    // 1、实际方法绑定和订阅在异步初始化时建立。
    this.initialized = false
    this.storageChangeUnsubscribe = null
    this.isRemoteUpdate = false // 标记是否是远程更新，避免循环触发
    this.originalSetItem = null
    this.originalRemoveItem = null
    this.originalClear = null
  }

  /**
   * 初始化localStorage代理
   * 将localStorage的操作代理到主进程
   * 处理流程：
   * 1、避免重复初始化，并保存原生存储方法。
   * 2、读取主进程数据，通过原生方法恢复窗口内存储。
   * 3、订阅跨窗口变更并安装本地写入代理。
   */
  async init() {
    // 1、已完成初始化的实例不重复订阅或覆盖原生方法。
    if (this.initialized) {
      console.warn('[LocalStorageSync] 已经初始化过，跳过')
      return
    }

    try {
      console.log('[LocalStorageSync] 开始初始化...')

      // 2、保存绑定到原存储对象的方法，后续同步不会再次触发代理。
      this.originalSetItem = localStorage.setItem.bind(localStorage)
      this.originalRemoveItem = localStorage.removeItem.bind(localStorage)
      this.originalClear = localStorage.clear.bind(localStorage)

      // 3、读取主进程维护的完整配置快照。
      const result = await window.electronAPI?.storage?.getAllData()

      if (result && result.success && result.data) {
        // 4、快照读取成功后才清空窗口存储，不触发反向同步。
        this.isRemoteUpdate = true
        this.originalClear()

        // 5、通过原生方法恢复快照，再解除远端更新标志。
        Object.entries(result.data).forEach(([key, value]) => {
          this.originalSetItem(key, value)
        })
        this.isRemoteUpdate = false

        console.log(`[LocalStorageSync] 同步了 ${Object.keys(result.data).length} 条数据`)
      }

      // 6、订阅单条或批量变更，使用原生方法避免跨窗口循环广播。
      this.storageChangeUnsubscribe = window.electronAPI?.storage?.onStorageChanged((data) => {
        // 1、将单条变更和批量变更统一为列表。
        const changes = Array.isArray(data?.changes) && data.batch
          ? data.changes
          : [data]

        this.isRemoteUpdate = true

        // 2、逐条应用写入、删除或清空操作。
        changes.forEach((change) => {
          if (!change) return
          if (change.method === 'setItem' && change.key && change.value !== undefined) {
            this.originalSetItem(change.key, change.value)
          } else if (change.method === 'removeItem' && change.key) {
            this.originalRemoveItem(change.key)
          } else if (change.method === 'clear') {
            this.originalClear()
          }
        })

        this.isRemoteUpdate = false
      })

      // 7、快照和订阅就绪后再代理本地写入，并标记初始化完成。
      this.proxyLocalStorage()

      this.initialized = true
      console.log('[LocalStorageSync] 初始化完成')
    } catch (error) {
      console.error('[LocalStorageSync] 初始化失败:', error)
    }
  }

  /**
   * 代理localStorage的原生方法
   * 处理流程：
   * 1、分别包装写入、删除和清空操作。
   * 2、各操作先更新本地，再将非远端变更异步同步到主进程。
   */
  proxyLocalStorage() {
    // 1、安装键值写入代理。
    /**
     * 写入本地键值并同步到主进程。
     * 处理流程：
     * 1、立即更新窗口存储。
     * 2、跳过远端变更，否则异步持久化并记录失败。
     */
    localStorage.setItem = (key, value) => {
      // 1、先保持同步存储接口的本地可见性。
      this.originalSetItem(key, value)

      // 2、远端变更不再次回传，避免同步循环。
      if (this.isRemoteUpdate) {
        return
      }

      // 3、异步通知主进程，失败通过日志报告。
      window.electronAPI?.storage?.setItem(key, value).catch((error) => {
        console.error('[LocalStorageSync] setItem同步失败:', error)
      })
    }

    // 2、安装键值删除代理。
    /**
     * 删除本地键值并同步到主进程。
     * 处理流程：
     * 1、立即删除窗口存储中的键。
     * 2、仅将本地发起的删除异步同步到主进程。
     */
    localStorage.removeItem = (key) => {
      // 1、先从当前窗口移除键值。
      this.originalRemoveItem(key)

      // 2、跳过主进程广播回来的删除操作。
      if (this.isRemoteUpdate) {
        return
      }

      // 3、将本地删除异步转交主进程。
      window.electronAPI?.storage?.removeItem(key).catch((error) => {
        console.error('[LocalStorageSync] removeItem同步失败:', error)
      })
    }

    // 3、安装存储清空代理。
    /**
     * 清空窗口存储并同步到主进程。
     * 处理流程：
     * 1、调用保存的原生清空方法。
     * 2、仅在本地发起清空时通知主进程。
     */
    localStorage.clear = () => {
      // 1、立即清空当前窗口可见的存储。
      this.originalClear()

      // 2、远端清空不反向广播。
      if (this.isRemoteUpdate) {
        return
      }

      // 3、将本地清空请求异步转交主进程。
      window.electronAPI?.storage?.clear().catch((error) => {
        console.error('[LocalStorageSync] clear同步失败:', error)
      })
    }

    console.log('[LocalStorageSync] localStorage代理已设置')
  }

  /**
   * 清理资源
   * 处理流程：
   * 1、注销存储变更监听并释放句柄。
   * 2、重置初始化标志；此方法不恢复已代理的存储方法。
   */
  cleanup() {
    // 1、解除事件订阅，避免已退出窗口继续接收变化。
    if (this.storageChangeUnsubscribe) {
      this.storageChangeUnsubscribe()
      this.storageChangeUnsubscribe = null
    }
    // 2、仅重置初始化状态，原生方法引用继续保存在实例中。
    this.initialized = false
    console.log('[LocalStorageSync] 资源已清理')
  }
}

// 创建全局实例
const localStorageSync = new LocalStorageSyncProxy()

export default localStorageSync
