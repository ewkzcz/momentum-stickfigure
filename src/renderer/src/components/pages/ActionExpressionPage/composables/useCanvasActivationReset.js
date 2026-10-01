/**
 * 页面重新激活时恢复画布布局。
 * 保留原有的两阶段模式切换，确保缓存页面重新显示后尺寸和渲染状态一致。
 */
export function useCanvasActivationReset({
  nextTick,
  scrollMode,
  canvasScale,
  userHasManuallyScrolled,
  updateCanvasDisplaySize,
  renderAllLayers
}) {
  const resetCanvasOnActivated = () => {
    nextTick(() => {
      const currentMode = scrollMode.value
      const restoreMode = currentMode === 'scale' ? 'scale' : 'region'
      const temporaryMode = currentMode === 'scale' ? 'region' : 'scale'

      scrollMode.value = temporaryMode
      canvasScale.value = 1.0
      userHasManuallyScrolled.value = false
      updateCanvasDisplaySize()

      nextTick(() => {
        scrollMode.value = restoreMode
        canvasScale.value = 1.0
        userHasManuallyScrolled.value = false
        updateCanvasDisplaySize()
        renderAllLayers()
      })
    })
  }

  return { resetCanvasOnActivated }
}
