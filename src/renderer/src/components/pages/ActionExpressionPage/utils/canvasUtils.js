/**
 * Canvas工具函数集
 * 提供Canvas相关的纯函数工具方法
 */

/**
 * 获取画布Base64数据
 * 处理流程：
 * 1、检查画布是否存在。
 * 2、导出 PNG 数据，无法读取时返回空值。
 * @param {HTMLCanvasElement} canvas - Canvas元素
 * @returns {string|null} Base64数据或null
 */
export const getCanvasBase64 = (canvas) => {
  // 1、过滤尚未挂载的画布。
  if (!canvas) return null
  
  try {
    // 2、读取 PNG 编码；跨域污染等异常由下方捕获。
    return canvas.toDataURL('image/png')
  } catch (error) {
    console.error('获取画布数据失败:', error)
    return null
  }
}

/**
 * 在给定矩形区域内抽样若干点，判断是否存在非透明像素
 * 处理流程：
 * 1、校验矩形并将采样范围限制在画布内。
 * 2、遍历采样网格，发现任一非零通道即返回命中。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {Object} rect - 矩形区域 {x, y, w, h}
 * @returns {boolean} 是否存在可见像素
 */
export const regionHasVisiblePixel = (ctx, rect) => {
  // 1、计算有效采样边界和步长。
  const { x, y, w, h } = rect
  if (w <= 0 || h <= 0) return false
  const sampleCount = 6 // 6x6 网格
  const stepX = Math.max(1, Math.floor(w / (sampleCount - 1)))
  const stepY = Math.max(1, Math.floor(h / (sampleCount - 1)))
  const startX = Math.max(0, Math.min(ctx.canvas.width - 1, Math.floor(x)))
  const startY = Math.max(0, Math.min(ctx.canvas.height - 1, Math.floor(y)))
  const endX = Math.max(0, Math.min(ctx.canvas.width - 1, Math.floor(x + w - 1)))
  const endY = Math.max(0, Math.min(ctx.canvas.height - 1, Math.floor(y + h - 1)))
  // 2、按网格检查像素通道，全未命中时返回 false。
  for (let sx = startX; sx <= endX; sx += stepX) {
    for (let sy = startY; sy <= endY; sy += stepY) {
      const imageData = ctx.getImageData(sx, sy, 1, 1)
      const d = imageData.data
      if (d[3] !== 0 || d[0] !== 0 || d[1] !== 0 || d[2] !== 0) return true
    }
  }
  return false
}

/**
 * 裁剪图片的空白像素（不降低质量，只移除周围的透明区域）
 * 处理流程：
 * 1、读取像素并扫描非透明内容的包围盒。
 * 2、空画布保持原样，有内容则绘制到裁剪画布。
 * @param {HTMLCanvasElement} canvas - 源Canvas
 * @returns {HTMLCanvasElement} 裁剪后的Canvas
 */
export const trimWhitespace = (canvas) => {
  // 1、读取像素，确定非透明内容边界。
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  
  let top = canvas.height, bottom = 0, left = canvas.width, right = 0
  
  // 扫描像素找到内容边界。
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < left) left = x
        if (x > right) right = x
        if (y < top) top = y
        if (y > bottom) bottom = y
      }
    }
  }
  
  // 2、如果没有内容，返回原画布；否则按边界创建裁剪结果。
  if (top > bottom || left > right) {
    return canvas
  }
  
  // 创建裁剪后的canvas
  const width = right - left + 1
  const height = bottom - top + 1
  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = width
  trimmedCanvas.height = height
  
  const trimmedCtx = trimmedCanvas.getContext('2d')
  trimmedCtx.drawImage(canvas, left, top, width, height, 0, 0, width, height)
  
  return trimmedCanvas
}

/**
 * 裁剪图片的水平方向空白像素（保持原始高度，只移除左右的透明区域）
 * 采用对称剪切策略：确保主体在剪切后的图片中居中，保持对称性
 * 处理流程：
 * 1、扫描水平方向的非透明内容范围。
 * 2、以原图中心对称扩展边界并限制在画布范围内。
 * 3、保留原始高度，将裁剪区域绘制到新画布。
 * @param {HTMLCanvasElement} canvas - 源Canvas
 * @returns {HTMLCanvasElement} 裁剪后的Canvas
 */
export const trimWhitespaceHorizontal = (canvas) => {
  // 1、读取像素并扫描水平方向边界，空内容直接返回原图。
  const ctx = canvas.getContext('2d')
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data
  
  let left = canvas.width, right = 0
  
  // 扫描像素找到水平方向内容边界（保持完整高度）
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      const alpha = data[(y * canvas.width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < left) left = x
        if (x > right) right = x
      }
    }
  }
  
  // 如果没有内容，返回原canvas
  if (left > right) {
    return canvas
  }
  
  // 2、【对称剪切策略】以原图中心为基准，确保主体居中。
  const centerX = canvas.width / 2
  const leftDistance = centerX - left  // 主体左边到中心的距离
  const rightDistance = right - centerX  // 主体右边到中心的距离
  const maxDistance = Math.max(leftDistance, rightDistance)  // 取最大偏移距离
  
  // 对称扩展剪切范围
  let newLeft = centerX - maxDistance
  let newRight = centerX + maxDistance
  
  // 边界检查：确保不超出画布范围
  newLeft = Math.max(0, Math.floor(newLeft))
  newRight = Math.min(canvas.width - 1, Math.ceil(newRight))
  
  // 3、创建裁剪后的画布（保持原始高度）。
  const width = newRight - newLeft + 1
  const height = canvas.height  // 保持原始高度
  const trimmedCanvas = document.createElement('canvas')
  trimmedCanvas.width = width
  trimmedCanvas.height = height
  
  const trimmedCtx = trimmedCanvas.getContext('2d')
  // 从顶部开始，裁剪水平方向，保持完整高度
  trimmedCtx.drawImage(canvas, newLeft, 0, width, height, 0, 0, width, height)
  
  return trimmedCanvas
}

/**
 * 绘制拖拽预览图
 * 处理流程：
 * 1、读取目标尺寸并清空旧预览。
 * 2、建立圆角裁剪区域。
 * 3、等比缩放源图，底部对齐绘制并恢复上下文。
 * @param {HTMLCanvasElement} canvas - 目标Canvas（预览Canvas）
 * @param {HTMLCanvasElement} sourceCanvas - 源Canvas
 */
export const drawDragPreview = (canvas, sourceCanvas) => {
  // 1、获取目标上下文和尺寸，清除上一次预览。
  const ctx = canvas.getContext('2d')
  const canvasWidth = Number(canvas.width) || 170
  const canvasHeight = Number(canvas.height) || 150

  // 清除画布
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // 2、添加圆角裁切。
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(5, 5, canvasWidth - 10, canvasHeight - 10, 12)
  ctx.clip()

  // 3、等比缩放适配并按底部边距定位图像。
  const padding = 8
  const contentW = Math.max(1, canvasWidth - padding * 2)
  const contentH = Math.max(1, canvasHeight - padding * 2)
  const scale = Math.min(contentW / sourceCanvas.width, contentH / sourceCanvas.height)
  const destW = Math.max(1, Math.round(sourceCanvas.width * scale))
  const destH = Math.max(1, Math.round(sourceCanvas.height * scale))
  const dx = Math.round((canvasWidth - destW) / 2)
  const dy = Math.round(canvasHeight - padding - destH)

  ctx.drawImage(sourceCanvas, dx, dy, destW, destH)
  ctx.restore()
}
