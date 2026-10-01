/** 等待主进程确认取消完成，期间禁止重复请求；运行状态仍由原任务finally释放。 */
import { ref } from 'vue'

export function useProcessCancellation(getService, message) {
  const cancelling = ref(false)
  const cancel = async () => {
    if (cancelling.value) return
    cancelling.value = true
    try {
      const service = getService()
      if (!service?.cancel) throw new Error('当前服务不支持取消')
      const result = await service.cancel()
      if (!result?.success) throw new Error(result?.message || '取消失败')
    } catch (error) {
      message.error(error.message || '取消失败')
    } finally {
      cancelling.value = false
    }
  }
  return { cancelling, cancel }
}
