/** 生图模型目录与尺寸换算：主进程和渲染进程共用，保证协议判断与尺寸规则一致。 */

export const IMAGE_MODEL_OPTIONS = [
  { label: 'gpt-image-2', value: 'gpt-image-2' },
  { label: 'gpt-image-2.5-flare', value: 'gpt-image-2.5-flare' },
  { label: 'gpt-image-2.5-sunburst', value: 'gpt-image-2.5-sunburst' },
  { label: 'gpt-image-2.5', value: 'gpt-image-2.5' },
  { label: 'seedream-5.0-pro', value: 'seedream-5.0-pro' },
  { label: 'gemini-2.5-flash-image（Gemini 协议）', value: 'gemini-2.5-flash-image' }
]

export const IMAGE_QUALITY_OPTIONS = [
  { label: '自动', value: 'auto' },
  { label: '高', value: 'high' },
  { label: '中', value: 'medium' },
  { label: '低', value: 'low' }
]

export const IMAGE_TIER_OPTIONS = [
  { label: '标准', value: 'standard' },
  { label: '2K', value: '2k' },
  { label: '4K', value: '4k' }
]

export const MAX_IMAGE_COUNT = 10
const MAX_PIXELS = 3840 * 2160
const TIER_LONG_EDGE = { '2k': 2560, '4k': 3840 }
const STANDARD_SIZES = {
  '1:1': [1024, 1024],
  '16:9': [1792, 1024],
  '9:16': [1024, 1792],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '3:2': [1536, 1024],
  '2:3': [1024, 1536],
  '21:9': [1344, 576]
}

/**
 * 判断模型走哪种接口协议。
 * 处理流程：
 * 1、gemini 开头的模型使用 Gemini generateContent，其余按 OpenAI 图像接口处理。
 */
export function resolveImageProtocol(model) {
  // 1、Gemini 模型名以 gemini 开头，其余网关模型统一走 /v1/images。
  return /^gemini/i.test(String(model || '').trim()) ? 'gemini' : 'openai'
}

const roundTo16 = (value) => Math.max(16, Math.round(value / 16) * 16)

/**
 * 将宽高比和清晰度档位换算成 OpenAI 接口的 size。
 * 处理流程：
 * 1、解析比例，无效比例返回 undefined（交由网关自动尺寸）。
 * 2、标准档优先取内置尺寸，其余档按长边缩放并取 16 的倍数。
 * 3、总像素超过 4K 上限时等比缩小。
 */
export function buildOpenAiSize(aspectRatio, tier = 'standard') {
  // 1、仅接受 W:H 形式的比例。
  const match = /^(\d+):(\d+)$/.exec(String(aspectRatio || ''))
  if (!match) return undefined
  const [w, h] = [Number(match[1]), Number(match[2])]
  if (!w || !h) return undefined
  // 2、标准档沿用常用分辨率。
  const preset = STANDARD_SIZES[`${w}:${h}`]
  if (tier === 'standard' && preset) return `${preset[0]}x${preset[1]}`
  const longEdge = TIER_LONG_EDGE[tier] || 1792
  let width = w >= h ? longEdge : (longEdge * w) / h
  let height = w >= h ? (longEdge * h) / w : longEdge
  // 3、控制总像素，避免超过接口上限。
  const pixels = width * height
  if (pixels > MAX_PIXELS) {
    const scale = Math.sqrt(MAX_PIXELS / pixels)
    width *= scale
    height *= scale
  }
  return `${roundTo16(width)}x${roundTo16(height)}`
}
