/**
 * 拖拽配置常量
 * 用于控制拖拽行为的各种阈值和参数
 */

/**
 * 拖拽跟随预览的水平偏移量（像素）
 * @type {number}
 */
export const FOLLOW_OFFSET_X = 0

/**
 * 拖拽跟随预览的垂直偏移量（像素）
 * @type {number}
 */
export const FOLLOW_OFFSET_Y = 0

/**
 * 鼠标在窗口外的连续检测次数阈值
 * 达到此次数后触发系统拖拽
 * @type {number}
 */
export const OUTSIDE_COUNT_THRESHOLD = 1

/**
 * 鼠标在窗口外的持续时间阈值（毫秒）
 * 超过此时间后触发系统拖拽
 * @type {number}
 */
export const OUTSIDE_DURATION_MS = 20

/**
 * 窗口边界的安全边距（像素）
 * 用于判断鼠标是否接近或超出窗口边界
 * @type {number}
 */
export const OUTSIDE_SAFE_MARGIN = 10

/**
 * 最小拖拽时间（毫秒）
 * 防止误触发拖拽操作的保护时间
 * @type {number}
 */
export const MIN_DRAG_TIME_MS = 200

