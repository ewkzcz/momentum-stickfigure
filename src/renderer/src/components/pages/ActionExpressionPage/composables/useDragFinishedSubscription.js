/**
 * 系统拖拽完成事件订阅：集中管理 Electron 事件监听及对应清理。
 *
 * 页面仍在原生命周期位置显式调用 register，避免改变监听注册顺序；
 * 订阅取消函数由本模块持有，卸载只释放自身订阅，不清空共享通道。
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
   * 2、释放本地引用，不影响共享通道上的其他消费者。
   */
  // 取消函数由预加载返回；仅清理本模块拥有的监听。
  const cleanupDragFinished = () => {
    if (unsubscribe) {
      unsubscribe()
    }
    unsubscribe = null
  }

  return {
    registerDragFinished,
    cleanupDragFinished
  }
}
