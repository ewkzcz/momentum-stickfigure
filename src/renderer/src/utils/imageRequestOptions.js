/** 生图请求参数：把设置中的模型、质量、清晰度和张数整理成主进程可接收的字段。 */
import { resolveImageProtocol, MAX_IMAGE_COUNT } from '@shared/image-models.js'

export const DEFAULT_IMAGE_MODEL = 'gemini-2.5-flash-image'

/**
 * 根据用户配置构造模型相关请求参数。
 * 处理流程：
 * 1、缺省模型沿用旧版 Gemini 模型，保证旧配置行为不变。
 * 2、仅 OpenAI 协议模型附带质量、清晰度和张数，Gemini 协议不发送这些字段。
 */
export function buildImageModelParams(userConfig = {}) {
  // 1、读取并清理模型名。
  const model = String(userConfig.model || '').trim() || DEFAULT_IMAGE_MODEL
  if (resolveImageProtocol(model) !== 'openai') return { model }
  // 2、张数取整并限制在接口允许范围。
  const numImages = Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.floor(Number(userConfig.numImages) || 1)))
  return {
    model,
    quality: userConfig.quality || 'auto',
    imageTier: userConfig.imageTier || 'standard',
    numImages
  }
}
