/** 幻想框辅助工具：提供几何适配、像素边界分析和导出命名。 */

/**
 * 生成唯一ID
 * 处理流程：1、组合时间戳与随机片段生成本地标识。
 * @returns {string} 唯一ID
 */
export function generateUniqueId() {
  // 1、生成用于区分画布元素的本地标识。
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 限制数值范围
 * 处理流程：1、依次应用下限和上限。
 * @param {number} value - 值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number} 限制后的值
 */
export function clamp(value, min, max) {
  // 1、将输入限制在给定闭区间。
  return Math.min(Math.max(value, min), max)
}

/**
 * 生成导出文件名
 * 处理流程：1、转换时间戳中的特殊字符；2、拼接前缀与 PNG 扩展名。
 * @param {string} prefix - 文件名前缀
 * @returns {string} 文件名
 */
export function generateExportFileName(prefix = '幻想框') {
  // 1、移除文件名不适合使用的时间分隔符。
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0]
  // 2、按统一格式生成导出名称。
  return `${prefix}_${timestamp}.png`
}

/**
 * 计算图片在容器内的适配尺寸（contain模式）
 * 处理流程：1、比较图像与容器比例；2、按受限方向缩放；3、计算居中位置。
 * @param {number} imgWidth - 图片宽度
 * @param {number} imgHeight - 图片高度
 * @param {number} containerWidth - 容器宽度
 * @param {number} containerHeight - 容器高度
 * @returns {Object} 适配后的尺寸和位置
 */
export function calculateContainSize(imgWidth, imgHeight, containerWidth, containerHeight) {
  // 1、计算图像和容器的宽高比。
  const imgAspectRatio = imgWidth / imgHeight
  const containerAspectRatio = containerWidth / containerHeight
  
  let drawWidth, drawHeight
  
  // 2、以较先触及容器边界的方向为基准，保证完整显示。
  if (imgAspectRatio > containerAspectRatio) {
    drawWidth = containerWidth
    drawHeight = drawWidth / imgAspectRatio
  } else {
    drawHeight = containerHeight
    drawWidth = drawHeight * imgAspectRatio
  }
  
  // 3、返回等比缩放尺寸与居中偏移。
  return {
    width: drawWidth,
    height: drawHeight,
    x: (containerWidth - drawWidth) / 2,
    y: (containerHeight - drawHeight) / 2
  }
}

/**
 * 计算图片在容器内的适配尺寸（cover模式）
 * 处理流程：1、比较图像与容器比例；2、按覆盖方向缩放；3、计算居中位置。
 * @param {number} imgWidth - 图片宽度
 * @param {number} imgHeight - 图片高度
 * @param {number} containerWidth - 容器宽度
 * @param {number} containerHeight - 容器高度
 * @returns {Object} 适配后的尺寸和位置
 */
export function calculateCoverSize(imgWidth, imgHeight, containerWidth, containerHeight) {
  // 1、计算图像和容器的宽高比。
  const imgAspectRatio = imgWidth / imgHeight
  const containerAspectRatio = containerWidth / containerHeight
  
  let drawWidth, drawHeight
  
  if (imgAspectRatio > containerAspectRatio) {
    // 2、宽图以高度为基准，窄图以宽度为基准，保证覆盖容器。
    drawHeight = containerHeight
    drawWidth = drawHeight * imgAspectRatio
  } else {
    drawWidth = containerWidth
    drawHeight = drawWidth / imgAspectRatio
  }
  
  // 3、返回尺寸及居中偏移，超出容器的部分由调用方裁切。
  return {
    width: drawWidth,
    height: drawHeight,
    x: (containerWidth - drawWidth) / 2,
    y: (containerHeight - drawHeight) / 2
  }
}

/**
 * 检测点是否在矩形内
 * 处理流程：1、分别比较横纵坐标与矩形边界。
 * @param {number} x - 点的x坐标
 * @param {number} y - 点的y坐标
 * @param {Object} rect - 矩形对象 {x, y, width, height}
 * @returns {boolean} 是否在矩形内
 */
export function isPointInRect(x, y, rect) {
  // 1、包含边界的点也视为命中矩形。
  return x >= rect.x && x <= rect.x + rect.width &&
         y >= rect.y && y <= rect.y + rect.height
}

/**
 * 计算画布上有像素区域的边界框（bounding box）
 * 处理流程：1、读取像素数据；2、扫描非透明像素；3、为空时返回空值，否则输出闭合边界。
 * @param {HTMLCanvasElement} canvas - 画布元素
 * @returns {Object|null} 边界框对象 {top, bottom, left, right, height, width, centerY} 或 null（如果没有像素）
 */
export function calculatePixelBoundingBox(canvas) {
  // 1、读取完整画布并初始化边界极值。
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const width = canvas.width
  const height = canvas.height
  const imageData = ctx.getImageData(0, 0, width, height)
  const data = imageData.data
  
  let minX = width
  let minY = height
  let maxX = 0
  let maxY = 0
  let hasPixel = false
  
  // 2、遍历 alpha 大于零的像素，累计最小包围区域。
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4
      const alpha = data[index + 3]
      
      // 如果像素不透明（alpha > 0）
      if (alpha > 0) {
        hasPixel = true
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x)
        maxY = Math.max(maxY, y)
      }
    }
  }
  
  // 3、区分空画布；有内容时将闭合像素坐标转换为尺寸。
  if (!hasPixel) {
    return null
  }
  
  return {
    top: minY,
    bottom: maxY,
    left: minX,
    right: maxX,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    centerY: (minY + maxY) / 2
  }
}

/**
 * 处理对话框图片：裁剪空白像素，居中并扩展画布
 * 处理流程：1、绘制原图；2、分析内容边界；3、裁剪透明边缘；4、扩展并居中；5、输出 PNG。
 * @param {Image} img - 原始图片对象
 * @returns {Promise<string>} 处理后的图片 DataURL
 */
export async function processDialogFrameImage(img) {
  return new Promise((resolve) => {
    // 1、创建临时画布，绘制原始图片。
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = img.width
    tempCanvas.height = img.height
    const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
    tempCtx.drawImage(img, 0, 0)
    
    // 2、计算非透明区域，空图像直接返回原尺寸结果。
    const boundingBox = calculatePixelBoundingBox(tempCanvas)
    
    // 如果没有像素，返回原图
    if (!boundingBox) {
      resolve(tempCanvas.toDataURL('image/png'))
      return
    }
    
    // 3、按内容边界裁剪透明边缘。
    const croppedCanvas = document.createElement('canvas')
    croppedCanvas.width = boundingBox.width
    croppedCanvas.height = boundingBox.height
    const croppedCtx = croppedCanvas.getContext('2d')
    croppedCtx.drawImage(
      tempCanvas,
      boundingBox.left, boundingBox.top, boundingBox.width, boundingBox.height,
      0, 0, boundingBox.width, boundingBox.height
    )
    
    // 4、扩展为内容尺寸的 1.5 倍，并居中绘制裁剪结果。
    const expandedCanvas = document.createElement('canvas')
    expandedCanvas.width = boundingBox.width * 1.5
    expandedCanvas.height = boundingBox.height * 1.5
    const expandedCtx = expandedCanvas.getContext('2d')
    
    // 在扩展画布上居中绘制裁剪后的内容
    const offsetX = (expandedCanvas.width - boundingBox.width) / 2
    const offsetY = (expandedCanvas.height - boundingBox.height) / 2
    expandedCtx.drawImage(croppedCanvas, offsetX, offsetY)
    
    // 5、将结果编码为透明 PNG 数据地址。
    resolve(expandedCanvas.toDataURL('image/png'))
  })
}
