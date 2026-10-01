/**
 * AI 视频设置（全局单例）：连接信息（中转站地址、API 密钥）与生成参数。
 * AI视频设置页、直接生成与 Agent 增强共用；未单独配置连接时沿用 AI 生图设置的地址和密钥。
 */
import { reactive, watch } from 'vue'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'

export const VIDEO_CONFIG_STORAGE_KEY = 'video-generate-config'
const LEGACY_OPTIONS_KEY = 'video-generate-options'
const DEFAULTS = { baseUrl: '', apiKey: '', model: 'seedance-2.0-fast', resolution: '720p', aspectRatio: '16:9', duration: 5, generateAudio: false }

/** 读取 JSON；处理流程：1、解析失败返回空对象。 */
function readJson(key) {
  // 1、隐私模式下存储可能不可用。
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {}
  } catch {
    return {}
  }
}

/** 读取已保存的视频配置；处理流程：1、合并默认值与旧版参数键，2、连接信息缺失时沿用生图设置。 */
function readStored() {
  // 1、旧版只保存了参数。
  const saved = { ...DEFAULTS, ...readJson(LEGACY_OPTIONS_KEY), ...readJson(VIDEO_CONFIG_STORAGE_KEY) }
  // 2、沿用生图的地址和密钥。
  if (!saved.apiKey || !saved.baseUrl) {
    const image = readJson(GEMINI_IMAGE_CONFIG_STORAGE_KEY)
    if (!saved.apiKey) saved.apiKey = image.apiKey || ''
    if (!saved.baseUrl) saved.baseUrl = image.baseUrl || ''
  }
  return saved
}

const videoSettings = reactive(readStored())

// 任何修改立即保存。
watch(videoSettings, () => {
  try {
    localStorage.setItem(VIDEO_CONFIG_STORAGE_KEY, JSON.stringify({ ...videoSettings }))
  } catch { /* 存储不可用时只在内存中生效 */ }
})

/**
 * 解析视频接口连接信息。
 * 处理流程：
 * 1、优先使用 AI 视频设置中填写的地址和密钥。
 * 2、未填写的项实时读取 AI 生图设置作为回退（用户刚改生图设置也能立即生效）。
 */
export function resolveVideoConnection() {
  // 1、视频设置。
  const image = readJson(GEMINI_IMAGE_CONFIG_STORAGE_KEY)
  // 2、回退。
  return {
    baseUrl: videoSettings.baseUrl || image.baseUrl || '',
    apiKey: videoSettings.apiKey || image.apiKey || ''
  }
}

/** 取得共享设置；处理流程：1、返回同一个响应式对象。 */
export function useVideoSettings() {
  // 1、单例。
  return videoSettings
}
