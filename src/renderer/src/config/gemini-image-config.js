/**
 * Gemini Image API 前端配置文件
 * 用于配置纳米香蕉（Gemini）生图服务
 */

import { normalizeApiBaseUrl } from '@shared/api-url.js'

const DEFAULT_BASE_URL = ''

export const GEMINI_IMAGE_CONFIG_STORAGE_KEY = 'gemini-image-config'
const LEGACY_FAL_STORAGE_KEY = 'fal-config'

export const DEFAULT_GEMINI_IMAGE_CONFIG = {
  // API配置
  apiKey: '',
  baseUrl: DEFAULT_BASE_URL,
  model: 'gemini-2.5-flash-image',
  timeoutMinutes: 5,
  
  // 路径配置
  outputDir: './output',
  editOutputDir: './output',
  logDir: './logs',
  
  // 默认生成参数
  generateDefaults: {
    num_images: 1
  },
  
  // 默认编辑参数
  editDefaults: {
    num_images: 1
  }
}

/**
 * 读取配置
 * 处理流程：
 * 1、优先读取当前存储键，缺失时尝试旧版键。
 * 2、合并默认字段并统一编辑与生图输出目录。
 * 3、将旧配置迁移到当前键；读取失败时返回默认配置。
 */
export function loadGeminiImageConfigFromStorage() {
  try {
    // 1、当前配置存在时不再读取旧键，避免旧值覆盖新设置。
    const savedModern = localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY)
    const savedLegacy = savedModern ? null : localStorage.getItem(LEGACY_FAL_STORAGE_KEY)
    const saved = savedModern || savedLegacy

    if (saved) {
      // 2、补齐新字段，编辑结果沿用生图输出目录。
      const parsed = JSON.parse(saved)
      const config = { ...DEFAULT_GEMINI_IMAGE_CONFIG, ...parsed }
      if (!config.baseUrl) {
        config.baseUrl = DEFAULT_BASE_URL
      }
      config.editOutputDir = config.outputDir

      // 3、旧版本沿用 fal-config 存储，首次读取时迁移，失败仍返回内存结果。
      if (savedLegacy) {
        try {
          localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(config))
          localStorage.removeItem(LEGACY_FAL_STORAGE_KEY)
          console.log('⚙️ 已自动迁移旧版 fal-config 配置到 gemini-image-config')
        } catch (migrateError) {
          console.warn('⚠️ 迁移旧版配置失败，仍使用内存中的合并结果:', migrateError)
        }
      }

      return config
    }
  } catch (error) {
    console.error('读取Gemini配置失败:', error)
  }
  // 4、无保存值或解析失败时使用默认配置。
  return { ...DEFAULT_GEMINI_IMAGE_CONFIG }
}

/**
 * 保存配置
 * 处理流程：
 * 1、统一输出目录后写入当前配置键。
 * 2、成功写入后移除旧键，并通过布尔值返回结果。
 */
export function saveGeminiImageConfigToStorage(config) {
  try {
    // 1、先写入新配置，避免写入失败时提前丢失旧配置。
    const payload = { ...config, editOutputDir: config.outputDir }
    localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(payload))
    // 2、当前键写入成功后清理旧版存储。
    if (localStorage.getItem(LEGACY_FAL_STORAGE_KEY)) {
      localStorage.removeItem(LEGACY_FAL_STORAGE_KEY)
    }
    return true
  } catch (error) {
    console.error('保存Gemini配置失败:', error)
    return false
  }
}

/**
 * 校验配置有效性
 * 处理流程：
 * 1、检查密钥并使用共享地址规则验证中转站地址。
 * 2、检查模型和超时时间，汇总全部错误供界面展示。
 */
export function validateGeminiImageConfig(config) {
  // 1、收集密钥和中转站地址错误，不在首次错误处中断。
  const errors = []
  
  if (!config.apiKey || config.apiKey.trim() === '') {
    errors.push('API密钥不能为空')
  }
  
  try {
    normalizeApiBaseUrl(config.baseUrl)
  } catch (error) {
    errors.push(error.message)
  }

  // 2、继续检查请求参数，一次返回完整校验结果。
  if (!config.model || config.model.trim() === '') {
    errors.push('模型参数不能为空')
  }
  
  if (config.timeoutMinutes <= 0) {
    errors.push('超时时间必须大于0')
  }
  
  return {
    isValid: errors.length === 0,
    errors
  }
}
