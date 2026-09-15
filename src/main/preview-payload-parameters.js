import { assertBinaryPayload, assertRecord, assertText } from './ipc-parameter-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'

function assertDataUrl(value) {
  if (typeof value !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(value)) throw new TypeError('预览图片参数必须是图片dataURL')
  assertImageBase64(value)
}

/** 保留二进制视图字节范围和旧dataURL格式，在窗口转发前拒绝无界载荷。 */
export function assertPreviewPayload(payload) {
  if (typeof payload === 'string') { assertDataUrl(payload); return }
  assertRecord(payload, '预览画布')
  if (payload.buffer !== undefined && payload.buffer !== null) {
    if (!(payload.buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(payload.buffer)) throw new TypeError('预览二进制参数无效')
    assertBinaryPayload(payload.buffer, 64 * 1024 * 1024)
  } else if (payload.dataUrl === undefined) throw new TypeError('预览图片参数缺失')
  if (payload.dataUrl !== undefined) assertDataUrl(payload.dataUrl)
  for (const key of ['width', 'height']) {
    if (payload[key] !== undefined && (!Number.isSafeInteger(payload[key]) || payload[key] < 1 || payload[key] > 32 * 1024 * 1024)) throw new TypeError(`预览${key}参数无效`)
  }
  if (payload.width !== undefined && payload.height !== undefined && payload.width * payload.height > 32 * 1024 * 1024) throw new TypeError('预览画布参数超过像素预算')
  if (payload.mimeType !== undefined) {
    assertText(payload.mimeType, 128, '预览媒体类型')
    if (payload.mimeType && !/^image\/[a-zA-Z0-9.+-]+$/.test(payload.mimeType)) throw new TypeError('预览媒体类型参数无效')
  }
}
