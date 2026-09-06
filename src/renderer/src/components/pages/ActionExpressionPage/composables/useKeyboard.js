/**
 * @file useKeyboard.js
 * @description 键盘快捷键逻辑组合函数
 * 负责处理键盘事件监听和快捷键功能
 */

import { onMounted, onUnmounted } from 'vue'

const HOTKEYS_STORAGE_KEY = 'hotkeys-config'
const DEFAULT_HOTKEYS = {
  openSearch: 'Ctrl+F',
  toggleCanvasHover: 'Alt+C',
  togglePartHover: 'Alt+V'
}

/**
 * 规范化按键名称，确保大小写一致
 * 处理流程：
 * 1、去除空白并将单字符转换为大写
 * 2、将方向键、空格和退出键别名映射为统一名称
 */
const normalizeHotkeyKey = (key = '') => {
  // 1、优先处理空值与单字符按键
  if (!key) return ''
  const trimmed = key.trim()
  if (trimmed.length === 1) {
    return trimmed.toUpperCase()
  }
  // 2、统一浏览器事件中的特殊按键名称
  const map = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    ' ': 'Space',
    Spacebar: 'Space',
    Escape: 'Esc',
    Esc: 'Esc'
  }
  return map[trimmed] || trimmed
}

/**
 * 将快捷键字符串解析为结构化对象
 * 处理流程：
 * 1、校验输入并拆分按键片段
 * 2、提取修饰键和主键，缺少主键时返回空值
 */
const parseHotkeyString = (hotkeyString) => {
  // 1、仅接受包含有效片段的快捷键字符串
  if (!hotkeyString || typeof hotkeyString !== 'string') {
    return null
  }
  const tokens = hotkeyString.split('+').map(token => token.trim()).filter(Boolean)
  if (tokens.length === 0) {
    return null
  }
  let ctrl = false
  let alt = false
  let shift = false
  let mainKey = null
  
  // 2、逐段识别修饰键，其余片段按主键规范化
  tokens.forEach(token => {
    const upper = token.toUpperCase()
    if (upper === 'CTRL') {
      ctrl = true
    } else if (upper === 'ALT') {
      alt = true
    } else if (upper === 'SHIFT') {
      shift = true
    } else {
      mainKey = normalizeHotkeyKey(token)
    }
  })
  
  if (!mainKey) {
    return null
  }
  
  return { ctrl, alt, shift, key: mainKey }
}

/**
 * 根据事件判断是否匹配指定快捷键
 * 处理流程：
 * 1、规范事件按键，并同时比较主键和全部修饰键状态
 */
const matchesHotkey = (event, hotkey, normalizedKey) => {
  // 1、严格匹配修饰键，额外按下系统修饰键时不触发
  if (!hotkey) return false
  const keyToCompare = normalizedKey || normalizeHotkeyKey(event.key)
  return (
    keyToCompare === hotkey.key &&
    !!event.ctrlKey === hotkey.ctrl &&
    !!event.altKey === hotkey.alt &&
    !!event.shiftKey === hotkey.shift &&
    !event.metaKey
  )
}

/**
 * 提取可用快捷键配置
 * 处理流程：
 * 1、仅对缺失或空值使用默认配置，保留显式空字符串
 */
const pickHotkeyValue = (value, defaultValue) => {
  // 1、允许用户通过空字符串停用对应快捷键
  return value === undefined || value === null ? defaultValue : value
}

/**
 * 提取页面支持的三项可配置快捷键。
 * 处理流程：
 * 1、逐项保留用户配置，对未配置项应用默认值
 */
const extractHotkeyConfig = (source = {}) => {
  // 1、隔离其他配置字段，仅返回本模块需要的内容
  return {
    openSearch: pickHotkeyValue(source.openSearch, DEFAULT_HOTKEYS.openSearch),
    toggleCanvasHover: pickHotkeyValue(source.toggleCanvasHover, DEFAULT_HOTKEYS.toggleCanvasHover),
    togglePartHover: pickHotkeyValue(source.togglePartHover, DEFAULT_HOTKEYS.togglePartHover)
  }
}

/**
 * 加载本地快捷键配置
 * 处理流程：
 * 1、读取并解析本地配置，失败或不存在时返回默认配置
 */
const loadHotkeysConfig = () => {
  // 1、解析异常只影响配置回退，不阻断键盘监听初始化
  try {
    const stored = localStorage.getItem(HOTKEYS_STORAGE_KEY)
    if (stored) {
      return extractHotkeyConfig(JSON.parse(stored))
    }
  } catch (error) {
    console.warn('⚠️ 加载快捷键配置失败，将使用默认快捷键', error)
  }
  return extractHotkeyConfig()
}

/**
 * 构建已解析的快捷键信息
 * 处理流程：
 * 1、将三项快捷键分别解析为主键和修饰键结构
 */
const buildParsedHotkeys = (config) => ({
  // 1、提前解析，避免每次键盘事件重复处理配置字符串
  openSearch: parseHotkeyString(config.openSearch),
  toggleCanvasHover: parseHotkeyString(config.toggleCanvasHover),
  togglePartHover: parseHotkeyString(config.togglePartHover)
})

let runtimeHotkeys = loadHotkeysConfig()
let parsedHotkeys = buildParsedHotkeys(runtimeHotkeys)

/**
 * 更新运行中的快捷键配置。
 * 处理流程：
 * 1、补齐配置并重新生成已解析的匹配结构
 */
const updateHotkeyRuntimeConfig = (nextConfig) => {
  // 1、同步原始展示配置与事件匹配使用的结构
  runtimeHotkeys = extractHotkeyConfig(nextConfig || {})
  parsedHotkeys = buildParsedHotkeys(runtimeHotkeys)
  console.log('⌨️ 快捷键配置已更新:', runtimeHotkeys)
}

/**
 * 键盘快捷键组合函数
 * 处理流程：
 * 1、读取业务回调并建立键盘及配置变化处理器
 * 2、在挂载和卸载时管理监听，返回可手动调用的入口
 * @param {Object} options - 配置选项
 * @param {Function} options.onSave - 保存快捷键回调 (Ctrl+S)
 * @param {Function} options.onExport - 导出快捷键回调 (Ctrl+E)
 * @param {Function} options.onUndo - 撤销快捷键回调 (Ctrl+Z)
 * @param {Function} options.onRedo - 重做快捷键回调 (Ctrl+Y / Ctrl+Shift+Z)
 * @param {Function} options.onSearch - 搜索快捷键回调 (Ctrl+F)
 * @param {Function} options.onToggleCanvasHover - 切换主画布悬浮预览快捷键回调 (Alt+C)
 * @param {Function} options.onTogglePartHover - 切换部件悬浮预览快捷键回调 (Alt+V)
 * @returns {Object} 键盘快捷键相关的方法
 */
export function useKeyboard(options = {}) {
  // 1、取得页面提供的可选操作回调
  const {
    onSave,
    onExport,
    onUndo,
    onRedo,
    onSearch,
    onToggleCanvasHover,
    onTogglePartHover
  } = options

  /**
   * 处理键盘事件
   * 处理流程：
   * 1、识别输入区域和规范化按键
   * 2、处理固定的保存、导出、撤销和重做快捷键
   * 3、处理可配置的搜索与悬浮预览快捷键
   * @param {KeyboardEvent} event - 键盘事件对象
   */
  const handleKeyDown = async (event) => {
    // 1、检查是否在输入框中，保留其撤销和重做行为
    const isInputElement = ['INPUT', 'TEXTAREA'].includes(event.target.tagName)
    const normalizedKey = normalizeHotkeyKey(event.key)
    
    // 2、先匹配固定快捷键：保存、导出、撤销和重做
    // 保存快捷键
    if (event.ctrlKey && event.key === 's') {
      event.preventDefault()
      if (onSave) {
        await onSave()
      }
      return
    }

    // Ctrl+E: 导出
    if (event.ctrlKey && event.key === 'e') {
      event.preventDefault()
      if (onExport) {
        await onExport()
      }
      return
    }

    // Ctrl+Z: 撤销（避免在输入框中触发）
    if (event.ctrlKey && event.key === 'z' && !event.shiftKey && !isInputElement) {
      event.preventDefault()
      if (onUndo) {
        await onUndo()
      }
      return
    }

    // Ctrl+Y 或 Ctrl+Shift+Z: 重做（避免在输入框中触发）
    if ((event.ctrlKey && event.key === 'y') || 
        (event.ctrlKey && event.shiftKey && event.key === 'z')) {
      if (!isInputElement) {
        event.preventDefault()
        if (onRedo) {
          await onRedo()
        }
      }
      return
    }

    // 3、按运行时配置匹配搜索及两类悬浮预览快捷键
    // 搜索快捷键
    if (matchesHotkey(event, parsedHotkeys.openSearch, normalizedKey)) {
      event.preventDefault()
      if (onSearch) {
        await onSearch()
      }
      return
    }

    // Alt+C: 切换主画布悬浮预览
    if (matchesHotkey(event, parsedHotkeys.toggleCanvasHover, normalizedKey)) {
      event.preventDefault()
      if (onToggleCanvasHover) {
        await onToggleCanvasHover()
      }
      return
    }

    // Alt+V: 切换部件悬浮预览
    if (matchesHotkey(event, parsedHotkeys.togglePartHover, normalizedKey)) {
      event.preventDefault()
      if (onTogglePartHover) {
        await onTogglePartHover()
      }
      return
    }

    // 预留：可以添加更多快捷键
    // ESC: 取消当前操作
    // Ctrl+N: 新建
    // Ctrl+O: 打开
    // Delete: 删除选中项
    // Space: 预览/暂停
    // 方向键: 导航
  }

  /**
   * 接收当前窗口的快捷键配置广播。
   * 处理流程：
   * 1、优先使用事件配置，否则重新读取本地配置
   */
  const handleHotkeysConfigUpdated = (event) => {
    // 1、让修改后的配置立即参与后续按键匹配
    updateHotkeyRuntimeConfig(event?.detail || loadHotkeysConfig())
  }

  /**
   * 同步其他窗口写入的快捷键配置。
   * 处理流程：
   * 1、仅处理快捷键存储项，解析失败时应用默认配置
   */
  const handleStorageChange = (event) => {
    // 1、过滤无关存储变化，更新本窗口的运行时配置
    if (event.key === HOTKEYS_STORAGE_KEY) {
      try {
        updateHotkeyRuntimeConfig(event.newValue ? JSON.parse(event.newValue) : {})
      } catch (error) {
        console.warn('⚠️ 解析storage快捷键配置失败:', error)
        updateHotkeyRuntimeConfig({})
      }
    }
  }

  /**
   * 初始化键盘事件监听
   * 处理流程：
   * 1、注册键盘事件、窗口内配置广播和跨窗口存储事件
   */
  const initKeyboardListener = () => {
    // 1、统一建立操作入口及配置同步入口
    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('hotkeys-config-updated', handleHotkeysConfigUpdated)
    window.addEventListener('storage', handleStorageChange)
    console.log('✅ 键盘事件监听已初始化')
  }

  /**
   * 清理键盘事件监听
   * 处理流程：
   * 1、移除初始化时注册的三类事件监听
   */
  const cleanupKeyboardListener = () => {
    // 1、使用相同回调引用解除监听，避免卸载后继续触发
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('hotkeys-config-updated', handleHotkeysConfigUpdated)
    window.removeEventListener('storage', handleStorageChange)
    console.log('✅ 键盘事件监听已清理')
  }

  // 2、通过生命周期成对注册与移除监听，并暴露手动管理入口
  onMounted(() => {
    initKeyboardListener()
  })

  onUnmounted(() => {
    cleanupKeyboardListener()
  })

  return {
    handleKeyDown,
    initKeyboardListener,
    cleanupKeyboardListener
  }
}
