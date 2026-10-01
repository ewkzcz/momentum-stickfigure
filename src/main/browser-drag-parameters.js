import { assertRecord, assertText } from './ipc-parameter-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'
import { assertDragImageParameters } from './drag-clipboard-parameters.js'

/** 网页图片与准备接口共享预算；校验完成前不得写盘或调用原生图像接口。 */
export function assertBrowserDragParameters(payload, dataURL = false) {
  assertRecord(payload, '网页拖拽')
  let base64 = payload.base64
  if (dataURL) {
    if (typeof payload.dataURL !== 'string' || !/^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(payload.dataURL)) throw new TypeError('网页拖拽图片参数必须是图片dataURL')
    assertImageBase64(payload.dataURL)
    base64 = payload.dataURL.slice(payload.dataURL.indexOf(',') + 1)
  }
  let fileName = payload.fileName
  // 旧网页入口允许有限数值转名称、false使用默认名；保留这些标量语义。
  if (typeof fileName === 'number' && Number.isFinite(fileName)) fileName = String(fileName)
  if (typeof fileName === 'boolean') fileName = fileName ? 'true' : undefined
  if (typeof fileName === 'string') {
    const name = fileName.trim()
    if (name === '.' || name === '..' || /[\\/]/.test(name)) throw new TypeError('文件名不能包含路径')
  }
  assertDragImageParameters(base64, payload.iconSize === undefined ? null : { size: payload.iconSize }, fileName)
  if (payload.mimeType !== undefined) {
    assertText(payload.mimeType, 128, '图片媒体类型')
    if (payload.mimeType && !/^image\/[a-zA-Z0-9.+-]+$/.test(payload.mimeType)) throw new TypeError('图片媒体类型参数无效')
  }
}
