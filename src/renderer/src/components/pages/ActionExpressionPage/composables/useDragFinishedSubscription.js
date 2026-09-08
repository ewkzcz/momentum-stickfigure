/**
 * 系统拖拽完成事件订阅：集中管理 Electron 事件监听及对应清理。
 *
 * 页面仍在原生命周期位置显式调用 register，避免改变监听注册顺序；
 * 订阅取消函数和 Electron 兜底移除均由本模块持有，页面不再保存资源副本。
 */
export function useDragFinishedSubscription(options = {}) {
  const { electronApi = () => globalThis.window?.electronAPI } = options
  let unsubscribe = null

  /**
   * 注册一次系统拖拽完成监听。
   * 处理流程：
   * 1、读取当前 Electron API 并订阅 drag-finished。
   * 2、保存本次订阅返回的取消函数，供卸载阶段释放。
   */
  const registerDragFinished = (handler) => {
    const api = electronApi()
    if (api?.on) {
      unsubscribe = api.on('drag-finished', handler)
      console.log('✅ 已注册 drag-finished 事件监听')
      return true
    }
    console.warn('⚠️ electronAPI.on 不可用')
    return false
  }

  /**
   * 清理系统拖拽完成监听。
   * 处理流程：
   * 1、先执行订阅方提供的取消函数。
   * 2、按原行为调用 Electron 兜底移除，随后释放本地引用。
   */
  // 页面卸载只发生一次；保留原有取消顺序，释放局部引用避免重复清理。
  const cleanupDragFinished = () => {
    const api = electronApi()
    if (unsubscribe) {
      unsubscribe()
    }
    api?.removeAllListeners?.('drag-finished')
    unsubscribe = null
  }

  return {
    registerDragFinished,
    cleanupDragFinished
  }
}
