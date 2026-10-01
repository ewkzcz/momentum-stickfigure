/** 视频生成模型目录与可选参数：主进程校验和渲染进程表单共用。 */

// 前五个是 Aixoras 网关实际开通的模型名（/v1/models 返回）；后面是文档示例中的完整路径写法，兼容其他分组。
export const VIDEO_MODEL_OPTIONS = [
  { label: 'seedance-2.0-fast（快速）', value: 'seedance-2.0-fast' },
  { label: 'seedance-2.0', value: 'seedance-2.0' },
  { label: 'seedance-2.0-mini', value: 'seedance-2.0-mini' },
  { label: 'seedance-2.5', value: 'seedance-2.5' },
  { label: 'seedance-2.5-s', value: 'seedance-2.5-s' },
  { label: 'seedance-2.0 文生视频（文档路径）', value: 'bytedance/seedance-2.0/text-to-video' },
  { label: 'seedance-2.0 图生视频（文档路径）', value: 'bytedance/seedance-2.0/image-to-video' },
  { label: 'minimax-h3', value: 'minimax-h3' },
  { label: 'grok-imagine-video', value: 'grok-imagine-video' }
]

export const VIDEO_RESOLUTION_OPTIONS = [
  { label: '480p', value: '480p' },
  { label: '720p', value: '720p' },
  { label: '1080p', value: '1080p' }
]

export const VIDEO_ASPECT_OPTIONS = [
  { label: '横屏 16:9', value: '16:9' },
  { label: '竖屏 9:16', value: '9:16' },
  { label: '方形 1:1', value: '1:1' },
  { label: '标准横屏 4:3', value: '4:3' },
  { label: '标准竖屏 3:4', value: '3:4' },
  { label: '宽银幕 21:9', value: '21:9' }
]

export const VIDEO_DURATION_RANGE = { min: 4, max: 15 }
export const MAX_VIDEO_REFERENCE_IMAGES = 9
