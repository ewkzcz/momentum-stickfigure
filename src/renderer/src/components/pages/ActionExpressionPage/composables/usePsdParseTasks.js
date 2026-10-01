/** PSD解析取消状态：普通缓存停用保留任务，真正卸载时取消本页所有在途请求。 */
import { onBeforeUnmount } from 'vue'

/**
 * 创建页面独立的解析任务控制器。
 * 处理流程：
 * 1、为每个请求生成唯一标识并订阅批量取消。
 * 2、取消时通知主进程，等待原请求结算，拒绝应用迟到结果。
 * 3、真正卸载时取消所有在途任务，不在缓存停用时取消。
 */
export function usePsdParseTasks() {
  // 1、任务仅归属于当前页面实例，不与重建后的页面共用取消句柄。
  const tasks = new Set()
  let disposed = false
  let sequence = 0
  const instanceId = `${Date.now()}-${Math.random().toString(36).slice(2)}`

  /**
   * 创建明确的取消错误。
   * 处理流程：
   * 1、为调用方提供可与普通解析失败区分的错误名称。
   */
  const cancelled = () => {
    const error = new Error('PSD解析已取消')
    error.name = 'AbortError'
    return error
  }

  /**
   * 执行可取消的真实解析请求。
   * 处理流程：
   * 1、读取文件后再次检查取消，再提交带任务标识的IPC。
   * 2、结算后拒绝迟到结果并释放所有本次订阅。
   */
  const parse = async (file, parseOptions, signal) => {
    // 1、读取也可能异步跨越页面销毁，提交前后均验证任务仍有效。
    if (disposed || signal?.aborted) throw cancelled()
    const taskId = `${instanceId}-${++sequence}`
    let aborted = false
    let submitted = false
    const abort = () => {
      if (aborted) return
      aborted = true
      if (submitted) void window.electronAPI?.invoke('psd-cancel-parse', taskId).catch(error => {
        console.error('取消PSD解析请求失败:', error)
      })
    }
    tasks.add(abort)
    signal?.addEventListener('abort', abort, { once: true })
    try {
      const fileBuffer = await file.arrayBuffer()
      if (disposed || aborted || signal?.aborted) throw cancelled()
      submitted = true
      const result = await window.electronAPI?.invoke('psd-parse-file', { fileBuffer, parseOptions, taskId })
      // 2、成功响应到达前发生取消时，不创建会话或覆盖画布。
      if (disposed || aborted || signal?.aborted) throw cancelled()
      return result
    } finally {
      tasks.delete(abort)
      signal?.removeEventListener('abort', abort)
    }
  }

  onBeforeUnmount(() => {
    // 3、销毁页面即停止任务；不注册onDeactivated，保留缓存切换行为。
    disposed = true
    for (const abort of tasks) abort()
    tasks.clear()
  })

  return { parse }
}
