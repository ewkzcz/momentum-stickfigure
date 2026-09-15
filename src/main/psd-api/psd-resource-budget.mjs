/** PSD资源策略：先检查头与无图像元数据，再允许原解析算法分配图像。 */
import { readPsd } from 'ag-psd'

// 16GiB验收机上的保守上限；两份指定素材约2.1MP、最多187节点。
// 累计128MP约512MiB RGBA，不包含第三方库临时副本，不能视作RSS硬限制。
export const PSD_RESOURCE_LIMITS = Object.freeze({
  documentPixels: 32 * 1024 * 1024,
  decodedPixels: 128 * 1024 * 1024,
  layers: 8192,
  depth: 128,
  outputBytes: 128 * 1024 * 1024
})

function limit(message) {
  const error = new Error(`PSD资源限制：${message}`)
  error.name = 'ResourceLimitError'
  throw error
}

function pixels(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 0 || height < 0) limit('无效图像尺寸')
  const count = width * height
  if (!Number.isSafeInteger(count)) limit('像素数量超过限制')
  return count
}

/** 只读元数据检查，未修改输入缓冲区或原图层树。 */
export function preflightPsdResources(input, parseImages) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
  if (bytes.byteLength < 26) throw new Error('PSD文件头不完整')
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (header.getUint32(0) !== 0x38425053) throw new Error('PSD文件签名无效')
  const documentPixels = pixels(header.getUint32(18), header.getUint32(14))
  if (documentPixels > PSD_RESOURCE_LIMITS.documentPixels) limit('文档像素超过限制')
  const metadata = readPsd(bytes, { skipLayerImageData: true, skipCompositeImageData: true, skipThumbnail: true, logMissingFeatures: false, throwForMissingFeatures: false })
  const stack = (metadata.children || []).map(layer => ({ layer, depth: 1 }))
  let layers = 0, decodedPixels = documentPixels
  while (stack.length) {
    const { layer, depth } = stack.pop()
    if (++layers > PSD_RESOURCE_LIMITS.layers) limit('图层数量超过限制')
    if (depth > PSD_RESOURCE_LIMITS.depth) limit('图层嵌套超过限制')
    if (parseImages) {
      for (const rectangle of [layer, layer.mask, layer.realMask]) {
        if (!rectangle) continue
        const width = Math.max(0, (rectangle.right || 0) - (rectangle.left || 0))
        const height = Math.max(0, (rectangle.bottom || 0) - (rectangle.top || 0))
        decodedPixels += pixels(width, height)
        if (decodedPixels > PSD_RESOURCE_LIMITS.decodedPixels) limit('累计图层像素超过限制')
      }
    }
    for (const child of layer.children || []) stack.push({ layer: child, depth: depth + 1 })
  }
  return { layers, documentPixels, decodedPixels }
}

/** 在跨线程复制前累计输出规模，不先建立巨大的JSON字符串。 */
export function assertPsdOutputBudget(result) {
  let bytes = 0
  const stack = [result]
  while (stack.length) {
    const value = stack.pop()
    if (typeof value === 'string') bytes += Buffer.byteLength(value, 'utf8')
    else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) bytes += value.byteLength
    else if (value && typeof value === 'object') {
      for (const [key, child] of Object.entries(value)) { bytes += Buffer.byteLength(key, 'utf8') + 8; stack.push(child) }
    } else bytes += 8
    if (bytes > PSD_RESOURCE_LIMITS.outputBytes) limit('解析输出超过限制')
  }
  return bytes
}
