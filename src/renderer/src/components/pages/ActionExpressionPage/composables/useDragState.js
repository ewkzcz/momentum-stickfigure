/** 拖拽状态容器：集中保存预览引用、鼠标坐标及边界判定游标。 */
import { ref } from 'vue'

/**
 * 拖拽相关的状态（纯状态容器）
 * - 仅定义和导出拖拽所需的响应式状态与部分非响应式游标
 * - 不包含任何副作用或事件监听
 * 处理流程：
 * 1、创建拖拽响应式状态和内部运行游标。
 * 2、提供游标读写及越界计数重置函数。
 * 3、返回状态和操作入口。
 */
export function useDragState() {
  // 1、建立拖拽视觉、鼠标和边界状态。
  const isDragging = ref(false)
  const dragFollowPreview = ref(null)
  const dragFollowCanvas = ref(null)
  const dragSnapshotCanvas = ref(null)

  // 鼠标位置与校准
  const dragMouseX = ref(0)
  const dragMouseY = ref(0)
  const dragCalibration = ref({ dx: 75, dy: 75 })

  // 状态标志
  const hasTriggeredSystemDrag = ref(false)
  const isNearBoundary = ref(false)

  // 过程变量（非响应式）
  let dragStartTime = 0
  let dragStartX = 0
  let dragStartY = 0
  let outsideConsecutiveCount = 0
  let outsideFirstTs = 0

  // 2、封装内部游标访问，避免调用方直接修改闭包变量。
  /**
   * 读取当前拖拽运行游标。
   * 处理流程：
   * 1、返回起点、开始时间与越界计数快照。
   */
  const getDragRuntime = () => ({
    // 1、复制当前游标值供拖拽处理器使用。
    dragStartTime,
    dragStartX,
    dragStartY,
    outsideConsecutiveCount,
    outsideFirstTs
  })

  /**
   * 按提供的字段更新拖拽游标。
   * 处理流程：
   * 1、逐字段检查是否传入，仅覆盖非 undefined 值。
   */
  const setDragRuntime = (payload) => {
    // 1、保留未传入字段，允许将已有值重置为零。
    if (payload.dragStartTime !== undefined) dragStartTime = payload.dragStartTime
    if (payload.dragStartX !== undefined) dragStartX = payload.dragStartX
    if (payload.dragStartY !== undefined) dragStartY = payload.dragStartY
    if (payload.outsideConsecutiveCount !== undefined) outsideConsecutiveCount = payload.outsideConsecutiveCount
    if (payload.outsideFirstTs !== undefined) outsideFirstTs = payload.outsideFirstTs
  }

  /**
   * 重置鼠标越界判定的连续计数。
   * 处理流程：
   * 1、清空越界次数与首次越界时间。
   */
  const resetOutsideCounters = () => {
    // 1、同时重置次数和时间，开始新的越界判定周期。
    outsideConsecutiveCount = 0
    outsideFirstTs = 0
  }

  // 3、导出响应式状态及运行游标访问器。
  return {
    // 响应式状态
    isDragging,
    dragFollowPreview,
    dragFollowCanvas,
    dragSnapshotCanvas,
    dragMouseX,
    dragMouseY,
    dragCalibration,
    hasTriggeredSystemDrag,
    isNearBoundary,

    // 运行时游标
    getDragRuntime,
    setDragRuntime,
    resetOutsideCounters
  }
}

