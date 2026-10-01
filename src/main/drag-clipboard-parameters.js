import { assertEnum, assertFileName, assertRecord, assertText } from './ipc-parameter-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'

/** 拖拽参数预算只约束输入；输出目录还须单独完成可信路径授权。 */
export function assertDragImageParameters(base64Data, iconPayload, fileName, config) {
  if (typeof base64Data === 'string' && base64Data.startsWith('data:')) throw new TypeError('拖拽图片参数必须是裸base64')
  assertImageBase64(base64Data)
  if (fileName !== undefined && fileName !== null) {
    assertText(fileName, 255, '文件名')
    if (fileName.trim()) assertFileName(fileName.trim())
  }
  if (config !== undefined && config !== null) {
    assertRecord(config, '拖拽配置')
    if (config.outputRoot !== undefined) assertText(config.outputRoot, 32768, '输出目录')
    if (config.psdBaseName !== undefined) assertText(config.psdBaseName, 255, 'PSD名称')
    for (const key of ['createPsdFolder', 'forceRename']) {
      if (config[key] !== undefined && typeof config[key] !== 'boolean') throw new TypeError(`${key}参数必须是布尔值`)
    }
    if (config.overwriteMode !== undefined) assertEnum(config.overwriteMode, ['rename', 'overwrite'], '重名策略')
  }
  if (iconPayload !== undefined && iconPayload !== null) {
    assertRecord(iconPayload, '拖拽图标')
    if (iconPayload.dataURL !== undefined) {
      if (typeof iconPayload.dataURL !== 'string' || !iconPayload.dataURL.startsWith('data:image/')) throw new TypeError('拖拽图标参数必须是图片dataURL')
      assertImageBase64(iconPayload.dataURL, 4 * 1024 * 1024)
    }
    if (iconPayload.size !== undefined && (!Number.isInteger(iconPayload.size) || iconPayload.size < 1 || iconPayload.size > 1024)) throw new TypeError('拖拽图标尺寸参数无效')
  }
}
