/** 画布基础状态：集中管理 DOM 引用、PSD 尺寸及显示区域样式。 */
import { ref, computed } from 'vue'

/**
 * Canvas基础状态和样式管理
 * 
 * 提供Canvas元素的引用、尺寸、样式等基础状态
 * 处理流程：
 * 1、创建画布元素引用与原始尺寸。
 * 2、派生宽高比及画布区域高度样式。
 * 3、返回共享状态供渲染和交互逻辑使用。
 */
export function useCanvasState() {
  // 1、建立画布元素引用及原始像素尺寸。
  
  /**
   * Canvas元素引用
   */
  const canvasRef = ref(null)
  
  /**
   * Canvas区域容器引用
   */
  const canvasAreaRef = ref(null)
  
  /**
   * 内容包裹容器引用（用于计算画布区域高度）
   */
  const contentWrapperRef = ref(null)

  // ==================== Canvas尺寸状态 ====================
  
  /**
   * Canvas实际宽度（像素，与PSD一致）
   */
  const canvasWidth = ref(800)
  
  /**
   * Canvas实际高度（像素，与PSD一致）
   */
  const canvasHeight = ref(600)
  
  /**
   * PSD原始宽高比（动态计算）
   * 处理流程：
   * 1、高度为零时返回一，否则计算宽高比。
   */
  const psdAspectRatio = computed(() => {
    // 1、先处理零高度，避免无效宽高比。
    if (canvasHeight.value === 0) return 1
    return canvasWidth.value / canvasHeight.value
  })

  // 2、维护显示尺寸及根据容器高度派生的区域样式。
  
  /**
   * Canvas显示样式（CSS控制的显示尺寸）
   */
  const canvasStyle = ref({
    width: '700px',
    height: '500px'
  })
  
  /**
   * 窗口高度
   */
  const windowHeight = ref(window.innerHeight || 800)
  
  /**
   * 画布高度占比（可拖拽调整，默认30%）
   */
  const canvasHeightRatio = ref(0.3)
  
  /**
   * 画布区域样式（依据比例分配content-wrapper的高度）
   * 处理流程：
   * 1、无容器时返回占位高度。
   * 2、按容器高度与比例计算像素高度，并保持最小高度。
   */
  const canvasAreaStyle = computed(() => {
    // 1、处理容器尚未挂载的情况。
    const wrapper = contentWrapperRef?.value
    if (!wrapper) return { height: '100px', minHeight: '60px' }
    // 2、按内容区高度计算样式，保证至少六十像素。
    const wrapperHeight = wrapper.clientHeight || 0
    const canvasHeightPx = Math.max(60, Math.floor(wrapperHeight * canvasHeightRatio.value))
    return { 
      height: canvasHeightPx + 'px',
      minHeight: '60px'
    }
  })

  // ==================== 渲染状态 ====================
  
  // 3、导出画布引用、尺寸和样式状态。
  
  return {
    // Canvas元素引用
    canvasRef,
    canvasAreaRef,
    contentWrapperRef,
    
    // Canvas尺寸
    canvasWidth,
    canvasHeight,
    psdAspectRatio,
    
    // 显示样式
    canvasStyle,
    windowHeight,
    canvasHeightRatio,
    canvasAreaStyle
  }
}
