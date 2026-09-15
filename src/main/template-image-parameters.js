import { assertRecord, assertText } from './ipc-parameter-policy.js'
import { assertTemplateSegment, assertTemplateType } from './template-storage-paths.js'

// 图片接口预算不改变旧磁盘格式；解码前限制单图64MiB、单批128MiB及一万项。
const MAX_IMAGE_BYTES = 64 * 1024 * 1024
const MAX_BATCH_BYTES = 128 * 1024 * 1024

export function assertImageBase64(value, maximum = MAX_IMAGE_BYTES) {
  if (typeof value !== 'string' || value.length > Math.ceil(maximum / 3) * 4 + 128) throw new TypeError('base64图片参数超过容量或类型无效')
  const content = value.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, '')
  if (!content || content.length % 4 === 1 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new TypeError('base64图片参数无效')
  const padding = content.endsWith('==') ? 2 : content.endsWith('=') ? 1 : 0
  if (padding && content.length % 4 !== 0) throw new TypeError('base64图片填充参数无效')
  const bytes = Math.floor(content.length * 3 / 4) - padding
  if (bytes > maximum) throw new TypeError('base64图片参数超过容量限制')
  return bytes
}

function list(value) {
  if (!Array.isArray(value) || value.length > 10000) throw new TypeError('模板列表参数无效')
}
function id(value) {
  assertText(value, 251, '模板ID')
  assertTemplateSegment(value)
}

export function assertTemplateImagePayload(kind, payload) {
  assertRecord(payload, '模板图片')
  if (['save', 'batch-save', 'cleanup'].includes(kind)) assertTemplateType(payload.templateType)
  if (kind === 'save') { id(payload.templateId); assertImageBase64(payload.base64Data) }
  if (kind === 'path') assertText(payload.relativePath, 32768, '模板相对路径')
  if (kind === 'batch-save') {
    list(payload.imagePreviews)
    let bytes = 0
    for (const item of payload.imagePreviews) {
      assertRecord(item, '模板图片项')
      id(item.id)
      bytes += assertImageBase64(item.base64_data)
      if (bytes > MAX_BATCH_BYTES) throw new TypeError('模板批量图片参数超过容量限制')
    }
  }
  if (kind === 'batch-path') {
    list(payload.filePathsData)
    for (const item of payload.filePathsData) {
      assertRecord(item, '模板路径项')
      if (item.id !== undefined) id(item.id)
      assertText(item.file_path, 32768, '模板相对路径')
    }
  }
  if (kind === 'cleanup') {
    // 清理必须显式传入数组，缺失值不能隐式变为空数组删除所有图片。
    list(payload.validTemplateIds)
    for (const value of payload.validTemplateIds) id(value)
  }
}
