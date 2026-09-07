/** 预览订阅调度：保持原防抖、PSD 切换重试及订阅顺序，输出协议仍由输出模块负责。 */
import { watch } from 'vue'

/** 建立预览日志与注册入口。处理流程：1、在原晚声明位置创建日志；2、显式注册时才创建定时器。 */
export function usePreviewSyncSubscriptions(perfLogger) {
  /**
   * 采样记录独立预览同步的触发原因。
   * 处理流程：
   * 1、合并原因与附加数据，并按采样频率输出事件
   */
  const logPreviewSyncTrigger = (reason, meta = {}) => {
    // 1、为同步耗时排查保留触发来源
    perfLogger.logEvent('preview-sync:trigger', { reason, ...meta }, { sampleEvery: 4 })
  }

  /** 注册预览订阅。处理流程：1、接入已完成初始化的原引用；2、按原顺序监听选择及 PSD 变化。 */
  const registerPreviewSyncWatches = ({ selectedParts, currentTab, currentPsdData, isRenderingTemplatePreview, isRendering, canvasRef, syncCanvasToPreview }) => {
    // 1、两个定时器只在本域持有；原页面没有卸载清理，此处也不新增 dispose 或停止行为。
    let syncDebounceTimer = null
    let psdSwitchSyncTimer = null // PSD切换时的同步定时器

    /**
     * 合并高频画布变化并延迟同步预览。
     * 处理流程：
     * 1、重置防抖定时器，仅保留最后一次常规请求
     * 2、让 PSD 切换同步优先，画布渲染中时延迟重试
     * 3、确认画布尺寸有效后发起异步同步
     */
    const debouncedSyncCanvas = () => {
      // 1、用新定时器覆盖尚未执行的常规同步
      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer)
      }
      syncDebounceTimer = setTimeout(async () => {
        // 2、如果 PSD 切换同步正在等待，取消常规同步避免重复
        if (psdSwitchSyncTimer) {
          perfLogger.logEvent('preview-sync:skip', { reason: 'psd-switch-pending' }, { sampleEvery: 2 })
          console.log('[预览同步] PSD切换同步优先，跳过常规同步')
          return
        }

        // 简化等待逻辑：只等待一次，如果正在渲染就延迟50ms重试
        if (isRendering.value) {
          perfLogger.logEvent('preview-sync:defer', { reason: 'canvas-rendering' }, { sampleEvery: 2 })
          console.log('[预览同步] 检测到渲染中，延迟50ms重试')
          syncDebounceTimer = setTimeout(() => {
            debouncedSyncCanvas()
          }, 50)
          return
        }

        // 3、确保画布尺寸有效再异步同步
        if (canvasRef.value && canvasRef.value.width > 0 && canvasRef.value.height > 0) {
          syncCanvasToPreview() // 不await，让它异步执行
        } else {
          console.warn('[预览同步] Canvas无效，跳过同步')
        }
      }, 100) // 减少到100ms防抖，更快响应（配合JPEG压缩，足够快）
    }

    // 2、监听可能导致画布更新的状态变化，保留原 deep 选项和回调顺序。
    watch([selectedParts, currentTab], () => {
      // 如果是模板预览渲染中，不同步到预览窗口
      if (isRenderingTemplatePreview.value) {
        return
      }
      logPreviewSyncTrigger('selection-change', { tab: currentTab.value })
      debouncedSyncCanvas()
    }, { deep: true })

    // 监听PSD数据变化（切换文件时）- 需要等渲染完成后再同步
    watch(currentPsdData, () => {
      // 清除之前的PSD切换同步定时器
      if (psdSwitchSyncTimer) {
        clearTimeout(psdSwitchSyncTimer)
      }

      // 清除常规同步定时器，避免重复同步
      if (syncDebounceTimer) {
        clearTimeout(syncDebounceTimer)
        syncDebounceTimer = null
      }

      logPreviewSyncTrigger('psd-switch', { psdId: currentPsdData.value?.id })

      // 延迟同步，确保画布已渲染（优化：减少等待时间，使用更智能的重试机制）
      psdSwitchSyncTimer = setTimeout(async () => {
        // 简化等待逻辑：最多重试3次，每次间隔100ms
        let retryCount = 0
        /**
         * 等待 PSD 切换渲染并尝试同步预览。
         * 处理流程：
         * 1、渲染未完成时最多延迟重试三次
         * 2、同步有效画布并释放切换同步标记
         */
        const trySync = async () => {
          // 1、在限定次数内让当前渲染先完成
          if (isRendering.value && retryCount < 3) {
            retryCount++
            console.log(`[预览同步] PSD切换：渲染中，第${retryCount}次重试`)
            setTimeout(trySync, 100)
            return
          }

          // 2、提交有效画布并恢复常规同步资格
          if (canvasRef.value && canvasRef.value.width > 0 && canvasRef.value.height > 0) {
            syncCanvasToPreview() // 不await，异步执行
            console.log('📂 [预览窗口] PSD文件切换，已触发画布同步')
          }

          // 清除定时器标记，允许后续的常规同步
          psdSwitchSyncTimer = null
        }

        trySync()
      }, 200) // 减少到200ms，配合重试机制更快响应
    }, { deep: false })
  }

  return { logPreviewSyncTrigger, registerPreviewSyncWatches }
}
