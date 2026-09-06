/**
 * 工具函数集合
 *
 * 提供应用中常用的辅助函数
 */

/**
 * 生成唯一ID
 * 处理流程：1、拼接时间戳与随机片段，生成本地元素标识。
 * @returns {string} 唯一标识符
 */
export function generateUniqueId() {
  // 1、将时间和随机数编码为紧凑的本地标识。
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}

/**
 * 深拷贝对象
 * 处理流程：1、直接返回基础值；2、复制日期；3、递归复制数组；4、递归复制对象自有属性。
 * @param {any} obj - 要拷贝的对象
 * @returns {any} 拷贝后的对象
 */
export function deepClone(obj) {
  // 1、基础值和空值无需递归复制。
  if (obj === null || typeof obj !== "object") {
    return obj
  }

  // 2、保留日期的时间值。
  if (obj instanceof Date) {
    return new Date(obj.getTime())
  }

  // 3、递归复制数组元素。
  if (obj instanceof Array) {
    return obj.map((item) => deepClone(item))
  }

  // 4、仅复制对象自身的可枚举属性。
  if (typeof obj === "object") {
    const clonedObj = {}
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key])
      }
    }
    return clonedObj
  }
}

/**
 * 防抖函数
 * 处理流程：1、保存共享定时器；2、返回每次调用都会重置等待时间的包装函数。
 * @param {Function} func - 要防抖的函数
 * @param {number} wait - 等待时间（毫秒）
 * @returns {Function} 防抖后的函数
 */
export function debounce(func, wait) {
  // 1、让后续调用共享同一个等待任务。
  let timeout
  /**
   * 延后执行最近一次调用。
   * 处理流程：1、定义到期回调；2、取消旧任务并重新计时。
   */
  return function executedFunction(...args) {
    // 1、到期后清理定时器并执行本次参数。
    /**
     * 执行防抖任务。
     * 处理流程：1、清理等待状态并调用原函数。
     */
    const later = () => {
      // 1、清理定时器后执行实际任务。
      clearTimeout(timeout)
      func(...args)
    }
    // 2、连续调用仅保留最后一次等待任务。
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * 节流函数
 * 处理流程：1、保存节流状态；2、返回在指定间隔内最多执行一次的包装函数。
 * @param {Function} func - 要节流的函数
 * @param {number} limit - 时间间隔（毫秒）
 * @returns {Function} 节流后的函数
 */
export function throttle(func, limit) {
  // 1、保存调用间隔内的执行状态。
  let inThrottle
  /**
   * 按间隔执行原函数并保留调用上下文。
   * 处理流程：1、空闲时执行；2、等待间隔结束后恢复可执行状态。
   */
  return function executedFunction(...args) {
    // 1、忽略当前节流窗口内的重复调用。
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      // 2、间隔结束后允许下一次调用。
      setTimeout(() => (inThrottle = false), limit)
    }
  }
}

/**
 * 格式化文件大小
 * 处理流程：1、处理零字节；2、选择单位；3、保留两位小数输出。
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的文件大小
 */
export function formatFileSize(bytes) {
  // 1、零字节单独处理，避免对零取对数。
  if (bytes === 0) return "0 Bytes"

  // 2、按 1024 进制计算单位档位。
  const k = 1024
  const sizes = ["Bytes", "KB", "MB", "GB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  // 3、移除多余的小数尾零并附加单位。
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
}

/**
 * 检查点是否在多边形内部
 * 处理流程：1、读取目标坐标；2、逐边统计射线交点；3、返回奇偶判断结果。
 * @param {Object} point - 点坐标 {x, y}
 * @param {Array} polygon - 多边形顶点数组
 * @returns {boolean} 是否在多边形内部
 */
export function isPointInPolygon(point, polygon) {
  // 1、初始化目标点和交点奇偶状态。
  const x = point.x
  const y = point.y
  let inside = false

  // 2、从最后一条边开始闭合遍历，遇到射线交点时翻转状态。
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x
    const yi = polygon[i].y
    const xj = polygon[j].x
    const yj = polygon[j].y

    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }

  // 3、交点数为奇数时，目标点位于多边形内部。
  return inside
}

/**
 * 计算两点之间的距离
 * 处理流程：1、计算坐标差；2、按欧氏距离公式返回长度。
 * @param {Object} point1 - 第一个点 {x, y}
 * @param {Object} point2 - 第二个点 {x, y}
 * @returns {number} 距离值
 */
export function calculateDistance(point1, point2) {
  // 1、计算两个方向的坐标差。
  const dx = point2.x - point1.x
  const dy = point2.y - point1.y
  // 2、根据勾股定理计算两点距离。
  return Math.sqrt(dx * dx + dy * dy)
}

/**
 * 限制数值在指定范围内
 * 处理流程：1、依次应用下限与上限。
 * @param {number} value - 要限制的值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 限制后的值
 */
export function clamp(value, min, max) {
  // 1、将值约束在闭区间内。
  return Math.min(Math.max(value, min), max)
}

/**
 * 将角度转换为弧度
 * 处理流程：1、按半周角对应圆周率换算。
 * @param {number} degrees - 角度值
 * @returns {number} 弧度值
 */
export function degreesToRadians(degrees) {
  // 1、将角度值换算为弧度。
  return degrees * (Math.PI / 180)
}

/**
 * 将弧度转换为角度
 * 处理流程：1、按圆周率对应半周角换算。
 * @param {number} radians - 弧度值
 * @returns {number} 角度值
 */
export function radiansToDegrees(radians) {
  // 1、将弧度值换算为角度。
  return radians * (180 / Math.PI)
}
