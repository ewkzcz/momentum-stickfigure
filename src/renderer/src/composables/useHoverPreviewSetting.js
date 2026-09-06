/** 悬浮预览设置：兼容旧版人物配置，分别持久化画布与部件开关并广播变化。 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

export const HOVER_SETTING_STORAGE_KEY = 'stickfigure-hover-setting'
export const STICKFIGURE_CONFIG_STORAGE_KEY = 'stickfigure-config'
export const HOVER_SETTING_EVENT = 'stickfigure-hover-setting-changed'
export const DEFAULT_HOVER_PREVIEW_ENABLED = false

/** 检查浏览器存储环境；处理流程：1、确认窗口和本地存储对象均存在。 */
const hasWindowStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined'

/**
 * 读取悬浮预览设置（支持两个独立状态：canvas 和 part）
 * 处理流程：
 * 1、读取独立设置中的类型字段或旧对象的 enabled 字段。
 * 2、依次尝试调用方提供的旧配置和本地人物配置。
 * 3、均无有效布尔值时返回默认开关状态。
 */
export const readHoverPreviewSetting = (type = 'canvas', options = {}) => {
  // 1、无浏览器存储时直接使用调用方默认值。
  const { fallbackConfig = null, defaultValue = DEFAULT_HOVER_PREVIEW_ENABLED } = options
  if (!hasWindowStorage()) return defaultValue

  const storage = window.localStorage
  
  try {
    const stored = storage.getItem(HOVER_SETTING_STORAGE_KEY)
    if (stored) {
      const parsed = JSON.parse(stored)
      if (parsed && typeof parsed === 'object') {
        // 支持新的对象格式 { canvas: boolean, part: boolean }
        if (parsed[type] !== undefined && typeof parsed[type] === 'boolean') {
          return parsed[type]
        }
        // 兼容对象中的旧 enabled 字段；外层对象判断使纯布尔值不会进入此分支。
        if (typeof parsed === 'boolean' || (parsed.enabled !== undefined && typeof parsed.enabled === 'boolean')) {
          const oldValue = typeof parsed === 'boolean' ? parsed : parsed.enabled
          return oldValue
        }
      }
    }
  } catch (error) {
    console.warn('[HoverSetting] Failed to parse stored setting:', error)
  }

  // 2、优先使用调用方已经读入的旧人物配置。
  if (fallbackConfig) {
    if (type === 'canvas' && typeof fallbackConfig.enableHoverPreview === 'boolean') {
      return fallbackConfig.enableHoverPreview
    }
    if (type === 'part' && typeof fallbackConfig.enablePartHoverPreview === 'boolean') {
      return fallbackConfig.enablePartHoverPreview
    }
  }

  // 3、再从本地人物配置中查找对应类型的开关。
  try {
    const configRaw = storage.getItem(STICKFIGURE_CONFIG_STORAGE_KEY)
    if (configRaw) {
      const config = JSON.parse(configRaw)
      if (config && typeof config === 'object') {
        if (type === 'canvas' && typeof config.enableHoverPreview === 'boolean') {
          return config.enableHoverPreview
        }
        if (type === 'part' && typeof config.enablePartHoverPreview === 'boolean') {
          return config.enablePartHoverPreview
        }
      }
    }
  } catch (error) {
    console.warn('[HoverSetting] Failed to read from stickfigure-config:', error)
  }

  // 4、没有可用保存值时统一回退默认状态。
  return defaultValue
}

/**
 * 写入悬浮预览设置（支持两个独立状态：canvas 和 part）
 * 处理流程：
 * 1、读取现有开关，保留另一类型的状态。
 * 2、更新指定类型，写入独立设置并同步旧人物配置。
 * 3、按选项广播变化，存储不可用时返回内存结果。
 */
export const writeHoverPreviewSetting = (type, enabled, options = {}) => {
  const { source = 'unknown', broadcast = true } = options
  
  if (!hasWindowStorage()) {
    return { [type]: !!enabled, source, updatedAt: Date.now() }
  }

  try {
    // 1、恢复两类开关，兼容旧版共用一个布尔值的写法。
    let settings = { canvas: DEFAULT_HOVER_PREVIEW_ENABLED, part: DEFAULT_HOVER_PREVIEW_ENABLED }
    try {
      const stored = window.localStorage.getItem(HOVER_SETTING_STORAGE_KEY)
      if (stored) {
        const parsed = JSON.parse(stored)
        if (parsed && typeof parsed === 'object') {
          if (parsed.canvas !== undefined) settings.canvas = !!parsed.canvas
          if (parsed.part !== undefined) settings.part = !!parsed.part
        } else if (typeof parsed === 'boolean') {
          // 兼容旧格式：如果是布尔值，同时设置两个状态
          settings.canvas = parsed
          settings.part = parsed
        }
      }
    } catch (error) {
      console.warn('[HoverSetting] Failed to read existing settings:', error)
    }

    // 2、只覆盖本次指定的类型，保留另一类型的状态。
    settings[type] = !!enabled

    // 3、带上来源和更新时间写入独立设置。
    const payload = {
      ...settings,
      source,
      updatedAt: Date.now()
    }
    window.localStorage.setItem(HOVER_SETTING_STORAGE_KEY, JSON.stringify(payload))

    // 4、同步已存在的人物配置，兼容仍读取旧字段的组件。
    try {
      const configRaw = window.localStorage.getItem(STICKFIGURE_CONFIG_STORAGE_KEY)
      if (configRaw) {
        const config = JSON.parse(configRaw)
        if (config && typeof config === 'object') {
          if (type === 'canvas') {
            config.enableHoverPreview = settings.canvas
          }
          if (type === 'part') {
            config.enablePartHoverPreview = settings.part
          }
          window.localStorage.setItem(STICKFIGURE_CONFIG_STORAGE_KEY, JSON.stringify(config))
        }
      }
    } catch (error) {
      console.warn('[HoverSetting] Failed to sync stickfigure-config:', error)
    }

    // 5、按选项广播当前类型与完整开关集合。
    if (broadcast && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(HOVER_SETTING_EVENT, { 
        detail: { type, enabled: settings[type], settings, source, updatedAt: Date.now() }
      }))
    }

    return payload
  } catch (error) {
    console.warn('[HoverSetting] Failed to save hover preference:', error)
    return { [type]: !!enabled, source, updatedAt: Date.now() }
  }
}

/**
 * 悬浮预览设置 composable（支持两个独立状态：canvas 和 part）
 * 处理流程：
 * 1、恢复指定类型的状态并提供设置、切换方法。
 * 2、挂载时订阅外部变化，卸载时解除监听。
 * 3、暴露可写计算属性及原始状态，供不同组件复用。
 * @param {Object} options - 配置选项
 * @param {string} options.type - 设置类型：'canvas' 或 'part'，默认为 'canvas'
 * @param {string} options.source - 来源标识
 * @param {boolean} options.defaultEnabled - 默认启用状态
 */
export const useHoverPreviewSetting = (options = {}) => {
  // 1、每个调用实例管理一个类型，共用同一持久化协议。
  const { 
    type = 'canvas', 
    source = 'component', 
    defaultEnabled = DEFAULT_HOVER_PREVIEW_ENABLED 
  } = options
  
  const state = ref(readHoverPreviewSetting(type, { defaultValue: defaultEnabled }))

  /**
   * 设置当前实例的预览开关。
   * 处理流程：
   * 1、规范布尔值，无变化且未要求强制保存时直接返回。
   * 2、更新响应式状态，按广播或强制保存选项持久化。
   */
  const setHoverPreviewEnabled = (value, setOptions = {}) => {
    // 1、无变化时避免重复保存和广播。
    const normalized = !!value
    const { broadcast = true, source: overrideSource, forcePersist = false } = setOptions

    if (state.value === normalized && !forcePersist) {
      return normalized
    }

    // 2、关闭广播且未强制保存时，仅改变当前实例状态。
    state.value = normalized

    if (broadcast || forcePersist) {
      writeHoverPreviewSetting(type, normalized, {
        source: overrideSource || source,
        broadcast
      })
    }

    return normalized
  }

  /**
   * 切换当前预览开关。
   * 处理流程：
   * 1、反转当前值，并复用设置入口处理保存和广播。
   */
  const toggleHoverPreview = (toggleOptions = {}) => {
    // 1、切换行为沿用显式设置的选项。
    return setHoverPreviewEnabled(!state.value, toggleOptions)
  }

  /**
   * 接收同窗口其他组件广播的设置变化。
   * 处理流程：
   * 1、忽略没有详情的事件。
   * 2、优先应用匹配类型的单值，否则从完整设置中读取当前类型。
   */
  const handleExternalUpdate = (event) => {
    // 1、外部更新只改内存，不再次广播。
    const detail = event?.detail
    if (!detail) return

    // 2、优先使用明确标记了当前类型的事件值。
    if (detail.type === type && detail.enabled !== undefined) {
      const nextValue = !!detail.enabled
      if (state.value !== nextValue) {
        state.value = nextValue
      }
    }
    // 3、其他类型事件也可能携带当前类型的完整状态。
    else if (detail.settings && detail.settings[type] !== undefined) {
      const nextValue = !!detail.settings[type]
      if (state.value !== nextValue) {
        state.value = nextValue
      }
    }
  }

  // 2、监听器随组件生命周期注册和注销。
  onMounted(() => {
    if (typeof window === 'undefined') return
    window.addEventListener(HOVER_SETTING_EVENT, handleExternalUpdate)
  })

  onBeforeUnmount(() => {
    if (typeof window === 'undefined') return
    window.removeEventListener(HOVER_SETTING_EVENT, handleExternalUpdate)
  })

  // 3、计算属性写入走统一设置入口，原始状态供只需观察的调用方使用。
  return {
    hoverPreviewEnabled: computed({
      get: () => state.value,
      set: (value) => setHoverPreviewEnabled(value)
    }),
    rawHoverPreviewEnabled: state,
    setHoverPreviewEnabled,
    toggleHoverPreview
  }
}
