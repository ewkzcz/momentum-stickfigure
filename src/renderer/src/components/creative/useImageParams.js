/** 生图参数（全局单例）：直接生成、Agent 增强与 AI生图设置共用，读写同一份 AI 生图配置。 */
import { reactive, watch } from 'vue'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'

const FIELDS = { model: 'gemini-2.5-flash-image', quality: 'auto', imageTier: 'standard', numImages: 1 }

/** 读取已保存配置；处理流程：1、解析失败时返回空对象。 */
function readStored() {
  // 1、兼容旧版存储键。
  try {
    return JSON.parse(localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config') || '{}') || {}
  } catch {
    return {}
  }
}

const stored = readStored()
const imageParams = reactive(Object.fromEntries(Object.entries(FIELDS).map(([key, value]) => [key, stored[key] ?? value])))

// 参数变化立即合并写回配置，不覆盖密钥、目录等其他字段。
watch(imageParams, () => {
  try {
    localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify({ ...readStored(), ...imageParams }))
  } catch { /* 存储不可用时只在内存中生效 */ }
})

/** 从存储重新同步；处理流程：1、设置页保存后调用，保证各处显示一致。 */
export function reloadImageParams() {
  // 1、只同步参数字段。
  const latest = readStored()
  for (const key of Object.keys(FIELDS)) if (latest[key] !== undefined) imageParams[key] = latest[key]
}

/** 取得共享参数；处理流程：1、返回同一个响应式对象。 */
export function useImageParams() {
  // 1、单例。
  return imageParams
}
