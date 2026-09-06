/**
 * 画布分隔条调整逻辑
 * 
 * 提供拖拽分隔条调整画布高度比例的功能
 * 处理流程：
 * 1、接收尺寸依赖并初始化拖拽起点。
 * 2、定义鼠标按下、移动和释放的联动处理。
 * 3、返回供分隔条绑定的事件入口。
 */
export function useCanvasDivider(options = {}) {
  // 1、接收画布状态与尺寸刷新函数。
  const {
    canvasHeightRatio,
    updateCanvasDisplaySize,
    contentWrapperRef,
    windowHeight
  } = options

  // ==================== 状态变量 ====================
  
  // 是否正在拖拽分隔条
  let isDraggingDivider = false
  
  // 拖拽开始时的Y坐标
  let dividerDragStartY = 0
  
  // 拖拽开始时的高度比例
  let dividerDragStartRatio = 0

  // 2、定义分隔条完整拖拽过程。

  /**
   * 处理分隔条鼠标按下
   * 处理流程：
   * 1、记录起点与起始高度比例。
   * 2、监听文档移动和释放事件，设置拖拽光标并禁止选文。
   */
  const handleDividerMouseDown = (event) => {
    // 1、阻止原生交互并保存拖拽起点。
    event.preventDefault()
    isDraggingDivider = true
    dividerDragStartY = event.clientY
    dividerDragStartRatio = canvasHeightRatio.value
    
    // 2、将后续移动与释放绑定到文档，覆盖鼠标离开抓手的情况。
    document.addEventListener('mousemove', handleDividerMouseMove)
    document.addEventListener('mouseup', handleDividerMouseUp)
    document.body.style.cursor = 'ns-resize'
    document.body.style.userSelect = 'none'
  }

  /**
   * 处理分隔条鼠标移动
   * 处理流程：
   * 1、仅在拖拽中按内容区高度换算位移比例。
   * 2、限制比例在百分之二十至八十之间并刷新画布。
   */
  const handleDividerMouseMove = (event) => {
    // 1、过滤非拖拽事件并换算相对起点的位移。
    if (!isDraggingDivider) return
    
    const deltaY = event.clientY - dividerDragStartY
    // 基于内容区高度的比例，避免窗口高度变化带来错觉
    const wrapper = contentWrapperRef?.value
    const baseHeight = (wrapper?.clientHeight || windowHeight.value)
    // 抓手方向：下增上减（向下拖动增大比例，向上拖动减小比例）
    const deltaRatio = deltaY / baseHeight
    
    // 2、计算新的比例，限制在 20% 到 80% 之间并刷新尺寸。
    let newRatio = dividerDragStartRatio + deltaRatio
    newRatio = Math.max(0.2, Math.min(0.8, newRatio))
    
    canvasHeightRatio.value = newRatio
    updateCanvasDisplaySize()
  }

  /**
   * 处理分隔条鼠标释放
   * 处理流程：
   * 1、结束拖拽并解绑文档事件。
   * 2、恢复光标与文本选择，记录最终高度比例。
   */
  const handleDividerMouseUp = () => {
    // 1、结束拖拽，清理成对注册的监听器。
    isDraggingDivider = false
    document.removeEventListener('mousemove', handleDividerMouseMove)
    document.removeEventListener('mouseup', handleDividerMouseUp)
    // 2、恢复页面交互样式。
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    
    console.log('✅ 画布高度比例已调整为:', (canvasHeightRatio.value * 100).toFixed(0) + '%')
  }

  // 3、提供视图事件入口。
  return {
    // 方法
    handleDividerMouseDown,
    handleDividerMouseMove,
    handleDividerMouseUp
  }
}
