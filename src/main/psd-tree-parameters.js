import { assertRecord, assertText, assertEnum } from './ipc-parameter-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'
import { PSD_RESOURCE_LIMITS } from './psd-api/psd-resource-budget.mjs'

function dimension(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError(`${label}尺寸参数无效`)
}

export function assertPsdTree(data, options = {}, render = false) {
  assertRecord(data, 'PSD数据')
  assertRecord(options, 'PSD选项')
  if (render) {
    for (const record of [data, options]) for (const key of ['width', 'height']) if (record[key] !== undefined) dimension(record[key], key)
    const width = options.width ?? 800, height = options.height ?? 600
    if (width * height > PSD_RESOURCE_LIMITS.documentPixels) throw new TypeError('PSD画布参数超过像素预算')
    if (options.format !== undefined) assertEnum(options.format, ['png', 'jpg', 'jpeg', 'webp'], '输出格式')
    if (options.background !== undefined) assertText(options.background, 256, '画布背景')
    if (options.quality !== undefined && (typeof options.quality !== 'number' || !Number.isFinite(options.quality) || options.quality < 0 || options.quality > 1)) throw new TypeError('图像质量参数无效')
  }
  if (!Array.isArray(data.layerHierarchy)) throw new TypeError('PSD图层树参数必须是数组')
  const stack = [{ children: data.layerHierarchy, depth: 1 }], seen = new Set()
  let count = 0, bytes = 0
  while (stack.length) {
    const { children, depth } = stack.pop()
    if (!Array.isArray(children) || depth > PSD_RESOURCE_LIMITS.depth || children.length + count > PSD_RESOURCE_LIMITS.layers) throw new TypeError('PSD图层树参数超过预算')
    for (const layer of children) {
      assertRecord(layer, 'PSD图层')
      if (seen.has(layer)) throw new TypeError('PSD图层树参数不允许重复或循环节点')
      seen.add(layer)
      if (++count > PSD_RESOURCE_LIMITS.layers) throw new TypeError('PSD图层树参数超过预算')
      if (layer.name !== undefined) assertText(layer.name, 32768, '图层名称')
      for (const key of ['width', 'height', 'left', 'top', 'opacity']) if (layer[key] !== undefined && (typeof layer[key] !== 'number' || !Number.isFinite(layer[key]))) throw new TypeError('PSD图层数字参数无效')
      if (render && layer.imageData !== undefined) {
        bytes += assertImageBase64(layer.imageData)
        if (bytes > PSD_RESOURCE_LIMITS.outputBytes) throw new TypeError('PSD图层图像参数超过预算')
      }
      if (layer.children !== undefined) stack.push({ children: layer.children, depth: depth + 1 })
    }
  }
}
