/** 人物页快捷键提示：读取原配置并响应配置广播，不持久化配置或注册键盘事件。 */
import { reactive, computed } from 'vue'

/**
 * 创建快捷键展示状态。
 * 处理流程：
 * 1、建立默认提示并读取已有配置。
 * 2、提供配置广播处理器，保留主动清空与未配置的区别。
 * 3、返回展示状态；事件订阅仍由页面在原生命周期位置管理。
 */
export function useHotkeyLabels() {
  // 1、保持原存储键、默认值及初始化顺序。
  const HOTKEYS_STORAGE_KEY = 'hotkeys-config'
  const HOTKEY_LABEL_DEFAULTS = {
    toggleCanvasHover: 'Alt+C',
    togglePartHover: 'Alt+V',
    openSearch: 'Ctrl+F'
  }
  const hotkeyLabels = reactive({
    toggleCanvasHover: HOTKEY_LABEL_DEFAULTS.toggleCanvasHover,
    togglePartHover: HOTKEY_LABEL_DEFAULTS.togglePartHover,
    openSearch: HOTKEY_LABEL_DEFAULTS.openSearch
  })

  /**
   * 更新界面中的快捷键名称。
   * 处理流程：
   * 1、优先读取传入配置，否则读取本地配置。
   * 2、为缺失配置应用默认值并更新显示状态。
   */
  const applyHotkeyLabels = (sourceConfig = null) => {
    // 1、取得配置，并容忍本地存储内容解析失败。
    let config = sourceConfig
    if (!config) {
      try {
        const stored = localStorage.getItem(HOTKEYS_STORAGE_KEY)
        config = stored ? JSON.parse(stored) : null
      } catch (error) {
        console.warn('⚠️ 解析快捷键配置失败，将使用默认展示值', error)
      }
    }

    /** 获取显示值。处理流程：1、缺失或 null 回退默认值，主动清空仍保留。 */
    const resolveValue = (key) => {
      // 1、区分未配置与用户主动清空的快捷键。
      if (!config || config[key] === undefined || config[key] === null) {
        return HOTKEY_LABEL_DEFAULTS[key]
      }
      return config[key]
    }
    // 2、同步三项快捷键的界面展示。
    hotkeyLabels.toggleCanvasHover = resolveValue('toggleCanvasHover')
    hotkeyLabels.togglePartHover = resolveValue('togglePartHover')
    hotkeyLabels.openSearch = resolveValue('openSearch')
  }
  applyHotkeyLabels()

  /** 接收配置广播。处理流程：1、事件未携带配置时重新读取本地配置。 */
  const handleHotkeyLabelUpdate = (event) => {
    // 1、不写回存储，配置数据仍由设置页唯一维护。
    applyHotkeyLabels(event?.detail || null)
  }
  const toggleHoverHotkeyDisplay = computed(() => hotkeyLabels.toggleCanvasHover || '未设置')

  // 3、原页面继续负责订阅及取消订阅。
  return { hotkeyLabels, handleHotkeyLabelUpdate, toggleHoverHotkeyDisplay }
}
