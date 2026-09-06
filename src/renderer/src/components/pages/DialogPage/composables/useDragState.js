/** 对话图片拖拽状态：集中维护浮层位置、系统接管标记和越界计数。 */
import { ref } from 'vue'

/**
 * 对话框插件拖拽状态管理
 * 管理拖拽过程中的各种状态
 * 处理流程：1、创建响应式展示状态；2、创建运行时计数；3、提供读写与重置接口。
 */
export function useDragState() {
  // 1、初始化拖拽状态、预览引用和鼠标位置。
  // 是否正在拖拽
  const isDragging = ref(false)
  
  // 拖拽跟随预览DOM元素
  const dragFollowPreview = ref(null)
  
  // 拖拽跟随预览的canvas
  const dragFollowCanvas = ref(null)
  
  // 当前鼠标位置
  const dragMouseX = ref(0)
  const dragMouseY = ref(0)
  
  // 拖拽校准偏移
  const dragCalibration = ref({ dx: 0, dy: 0 })
  
  // 是否已触发系统拖拽
  const hasTriggeredSystemDrag = ref(false)
  
  // 是否接近窗口边界
  const isNearBoundary = ref(false)
  
  // 2、独立保存无需触发界面更新的拖拽时序和越界计数。
  let dragRuntime = {
    dragStartTime: 0,
    dragStartX: 0,
    dragStartY: 0,
    outsideConsecutiveCount: 0,
    outsideFirstTs: 0
  }
  
  /**
   * 读取当前拖拽运行时信息。
   * 处理流程：1、返回当前运行时对象。
   */
  const getDragRuntime = () => dragRuntime
  
  /**
   * 合并更新拖拽运行时信息。
   * 处理流程：1、保留未指定字段并覆盖传入字段。
   */
  const setDragRuntime = (updates) => {
    // 1、仅覆盖本次变化的运行时字段。
    dragRuntime = { ...dragRuntime, ...updates }
  }
  
  /**
   * 清空连续越界记录。
   * 处理流程：1、归零次数与首次越界时间。
   */
  const resetOutsideCounters = () => {
    // 1、避免上一轮越界记录影响下一轮拖拽。
    dragRuntime.outsideConsecutiveCount = 0
    dragRuntime.outsideFirstTs = 0
  }
  
  // 3、向事件处理模块暴露展示状态与运行时操作。
  return {
    isDragging,
    dragFollowPreview,
    dragFollowCanvas,
    dragMouseX,
    dragMouseY,
    dragCalibration,
    hasTriggeredSystemDrag,
    isNearBoundary,
    getDragRuntime,
    setDragRuntime,
    resetOutsideCounters
  }
}
