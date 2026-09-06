/** 画布缩放交互：协调容器尺寸、滚轮模式与自动居中行为。 */
import { ref, nextTick } from 'vue'
import { useMessage } from 'naive-ui'

/**
 * 画布缩放和滚动逻辑
 * 
 * 提供画布的缩放控制、滚动模式切换、自动居中等功能
 * 处理流程：
 * 1、读取画布依赖并初始化缩放与滚动状态。
 * 2、定义尺寸计算、居中及滚轮模式处理。
 * 3、返回共享状态和交互函数。
 */
export function useCanvasScale(options = {}) {
  // 1、接收尺寸状态及渲染依赖。
  const {
    canvasAreaRef,
    canvasHeightRatio,
    canvasStyle,
    psdAspectRatio,
    renderAllLayers
  } = options

  // 初始化 message
  const message = useMessage()

  // ==================== 状态变量 ====================
  
  // 画布缩放比例（鼠标滚轮控制）
  const canvasScale = ref(1.0) // 默认100%，范围：0.1 - 5.0

  // 滚动模式：'region'(区域调整) 或 'scale'(画布缩放)
  const scrollMode = ref('scale') // 默认画布缩放

  // 用户是否手动滚动过画布（用于优化缩放时的居中行为）
  const userHasManuallyScrolled = ref(false)

  // 程序是否正在自动居中滚动（用于区分用户手动滚动和程序自动滚动）
  const isProgrammaticScroll = ref(false)

  // 2、定义画布尺寸与滚动协调逻辑。

  /**
   * 计算并更新Canvas显示尺寸
   * 根据容器尺寸自适应，保持PSD原始宽高比
   * - 区域调整模式：画布整体缩放，可以超出容器（显示滚动条）
   * - 画布缩放模式：直接缩放画布显示尺寸（不重渲染图层）
   * 处理流程：
   * 1、取得容器可用尺寸并扣除内边距。
   * 2、按 PSD 宽高比计算完整容纳的基础尺寸。
   * 3、应用缩放比例并更新显示样式。
   * 4、未手动滚动时安排画布居中。
   */
  const updateCanvasDisplaySize = () => {
    // 1、获取 canvas-area 容器的实际尺寸及可用区域。
    const containerElement = canvasAreaRef.value
    if (!containerElement) {
      console.warn('⚠️ canvas-area容器未找到，使用默认尺寸')
      return
    }
    
    // 获取容器的可用尺寸（clientWidth/Height包含padding，不包含边框/滚动条）
    // 动态读取padding，确保与CSS保持一致，避免硬编码导致的错差
    const styles = window.getComputedStyle(containerElement)
    const padLeft = parseFloat(styles.paddingLeft || '0') || 0
    const padRight = parseFloat(styles.paddingRight || '0') || 0
    const padTop = parseFloat(styles.paddingTop || '0') || 0
    const padBottom = parseFloat(styles.paddingBottom || '0') || 0
    const maxWidth = Math.max(0, Math.round(containerElement.clientWidth - padLeft - padRight))
    const maxHeight = Math.max(0, Math.round(containerElement.clientHeight - padTop - padBottom))
    
    // 2、根据 PSD 原始宽高比和容器尺寸，计算基础显示尺寸。
    // 使用contain模式：确保画布在缩放=1.0时完全显示在容器内
    // 注意：基础尺寸应该固定，不受当前缩放和滚动条影响
    let baseDisplayWidth, baseDisplayHeight
    
    const containerAspectRatio = maxWidth / maxHeight
    
    if (psdAspectRatio.value > containerAspectRatio) {
      // PSD更宽：宽度贴合容器，按比例计算高度且不超过可用高度
      baseDisplayWidth = maxWidth
      baseDisplayHeight = Math.floor(maxWidth / psdAspectRatio.value)
    } else {
      // PSD更高：高度贴合容器，按比例计算宽度且不超过可用宽度
      baseDisplayHeight = maxHeight
      baseDisplayWidth = Math.floor(maxHeight * psdAspectRatio.value)
    }
    
    // 3、根据滚动模式应用缩放并更新样式。
    let displayWidth, displayHeight
    
    if (scrollMode.value === 'region') {
      // 区域调整模式：整个画布缩放（可以超出容器，显示滚动条）
      displayWidth = Math.round(baseDisplayWidth * canvasScale.value)
      displayHeight = Math.round(baseDisplayHeight * canvasScale.value)
    } else {
      // 画布缩放模式：直接放大/缩小整个画布显示尺寸（不重渲染图层）
      displayWidth = Math.round(baseDisplayWidth * canvasScale.value)
      displayHeight = Math.round(baseDisplayHeight * canvasScale.value)
    }
    
    canvasStyle.value = {
      width: `${displayWidth}px`,
      height: `${displayHeight}px`
    }
    
    console.log('🖼️ Canvas显示尺寸更新为:', displayWidth, 'x', displayHeight, `(容器: ${maxWidth}x${maxHeight}px, 基础尺寸: ${baseDisplayWidth}x${baseDisplayHeight}px, 宽高比: ${psdAspectRatio.value.toFixed(2)}, 缩放: ${(canvasScale.value * 100).toFixed(0)}%, 模式: ${scrollMode.value})`)
    
    // 4、缩放模式下，只有在用户没有手动滚动过时，才将滚动条居中显示画布。
    // 这样可以避免用户手动调整滚动位置后，再次缩放时位置被重置的困扰
    if (scrollMode.value === 'scale' && !userHasManuallyScrolled.value) {
      nextTick(() => {
        centerCanvasScroll()
      })
    }
  }

  /**
   * 将画布滚动条居中，使画布显示在视口中央
   * 处理流程：
   * 1、取得容器并标记程序滚动。
   * 2、计算横纵居中位置并更新滚动条。
   * 3、延迟清除标志以覆盖滚动事件派发。
   */
  const centerCanvasScroll = () => {
    // 1、确认容器存在并保护本次自动滚动。
    const containerElement = canvasAreaRef.value
    if (!containerElement) return
    
    // 标记为程序自动滚动，避免触发用户手动滚动标志
    isProgrammaticScroll.value = true
    
    // 2、计算滚动位置：(总内容尺寸 - 可视区域尺寸) / 2。
    const scrollLeft = (containerElement.scrollWidth - containerElement.clientWidth) / 2
    const scrollTop = (containerElement.scrollHeight - containerElement.clientHeight) / 2
    
    containerElement.scrollLeft = scrollLeft
    containerElement.scrollTop = scrollTop
    
    console.log('📍 画布滚动居中:', { scrollLeft, scrollTop })
    
    // 3、延迟重置标志，确保滚动事件处理完成。
    setTimeout(() => {
      isProgrammaticScroll.value = false
    }, 100)
  }

  /**
   * 处理画布区域的滚动事件
   * 当用户手动滚动时，标记该状态，避免后续缩放时自动居中
   * 处理流程：
   * 1、忽略程序触发的滚动。
   * 2、缩放模式下记录用户已经手动调整视口。
   */
  const handleCanvasAreaScroll = () => {
    // 1、如果是程序自动滚动，忽略此事件。
    if (isProgrammaticScroll.value) {
      return
    }
    
    // 2、只在画布缩放模式下才标记用户手动滚动。
    if (scrollMode.value === 'scale') {
      // 标记用户已经手动滚动过
      if (!userHasManuallyScrolled.value) {
        userHasManuallyScrolled.value = true
        console.log('👆 检测到用户手动滚动画布，后续缩放将保持当前滚动位置')
      }
    }
  }

  /**
   * 切换滚动模式（区域调整/画布缩放）
   * 处理流程：
   * 1、切换模式并重置缩放与手动滚动状态。
   * 2、重新计算尺寸、触发重绘并提示新模式。
   */
  const toggleScrollMode = () => {
    // 1、切换模式并恢复默认缩放行为。
    const newMode = scrollMode.value === 'region' ? 'scale' : 'region'
    scrollMode.value = newMode
    
    // 切换模式时重置缩放比例
    canvasScale.value = 1.0
    
    // 重置用户手动滚动标志（切换模式时恢复默认行为）
    userHasManuallyScrolled.value = false
    
    // 2、重新计算画布显示尺寸并请求重绘。
    updateCanvasDisplaySize()
    
    // 重新渲染画布
    if (renderAllLayers) {
      renderAllLayers()
    }
    
    message.success(newMode === 'scale' ? '已切换到画布缩放模式' : '已切换到区域调整模式')
    console.log('🔄 切换滚动模式:', newMode, '(已重置手动滚动标志)')
  }

  /**
   * 处理画布鼠标滚轮缩放
   * 处理流程：
   * 1、阻止默认滚动和冒泡，读取滚轮方向。
   * 2、区域模式调整高度比例并限制范围。
   * 3、缩放模式更新画布显示比例，仅刷新 CSS 尺寸。
   */
  const handleCanvasWheel = async (event) => {
    // 1、阻止默认与冒泡，避免父容器滚动导致的反向缩放或连锁缩小。
    event.preventDefault()
    event.stopPropagation()
    
    console.log('🖱️ 滚轮事件触发:', { 
      deltaY: event.deltaY, 
      当前缩放: canvasScale.value,
      滚动模式: scrollMode.value 
    })
    
    // 计算滚动方向（向上滚动放大，向下滚动缩小）
    const delta = -event.deltaY

    // 2、区域调整：用滚轮调整画布区域高度比例，不改变外层容器以外的布局。
    if (scrollMode.value === 'region') {
      const ratioSpeed = 0.0005 // 高度比例调整速度
      const ratioDelta = delta * ratioSpeed
      const minRatio = 0.2
      const maxRatio = 0.8
      let newRatio = canvasHeightRatio.value + ratioDelta
      newRatio = Math.max(minRatio, Math.min(maxRatio, newRatio))
      
      if (newRatio !== canvasHeightRatio.value) {
        canvasHeightRatio.value = newRatio
        updateCanvasDisplaySize()
      }
      
      console.log('✅ 区域调整已调整区域高度:', (canvasHeightRatio.value * 100).toFixed(0) + '%')
      return
    }

    // 3、画布缩放：只缩放画布显示尺寸，不改变区域高度。
    const zoomSpeed = 0.001 // 缩放速度
    const zoomDelta = delta * zoomSpeed
    let newScale = canvasScale.value + zoomDelta
    newScale = Math.max(0.1, Math.min(5.0, newScale))

    console.log('✅ 缩放检查通过:', {
      缩放比例: `${(newScale * 100).toFixed(0)}%`,
      滚动模式: scrollMode.value
    })

    // 应用新的缩放比例
    canvasScale.value = newScale

    // 更新画布显示尺寸（保持固定宽高比）
    updateCanvasDisplaySize()

    // 画布缩放不再触发重渲染，直接通过CSS显示尺寸缩放
    
    console.log('🔍 画布缩放完成:', (canvasScale.value * 100).toFixed(0) + '%', '模式:', scrollMode.value)
  }

  // 3、导出缩放状态与视图交互入口。
  return {
    // 状态
    canvasScale,
    scrollMode,
    userHasManuallyScrolled,
    isProgrammaticScroll,
    
    // 方法
    handleCanvasWheel,
    toggleScrollMode,
    centerCanvasScroll,
    handleCanvasAreaScroll,
    updateCanvasDisplaySize
  }
}
