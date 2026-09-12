/** 快捷键设置：管理表单状态、本地持久化、快捷键录制及保存注册。 */
/* global CustomEvent */
import { ref, reactive } from 'vue'
import { createHotkeysBackupSnapshot } from './settingsArchive.js'

/**
 * 创建快捷键设置域。
 * 处理流程：
 * 1、接收页面提示、版本和生图配置依赖，创建快捷键状态与默认值。
 * 2、在页面原有初始化位置读取快捷键配置，提供录制、重置、清空和保存操作。
 * 3、返回页面实际使用的状态、操作及跨域恢复和导入所需符号。
 */
export const useHotkeySettings = ({ message, showSaveRestartTip, SAVE_RESTART_HINT, appVersion, geminiConfig }) => {
  // 1、两个 ref 仅创建初值，无外部副作用；随工厂在原快捷键配置位置初始化。
  const isSavingHotkeys = ref(false)
  const currentEditingHotkey = ref(null)

  const HOTKEYS_STORAGE_KEY = 'hotkeys-config'

  // 快捷键配置默认值
  const DEFAULT_HOTKEYS = {
    toggleMainWindow: 'Alt+Z',
    togglePreviewWindow: 'Alt+X',
    openSearch: 'Ctrl+F',
    toggleCanvasHover: 'Alt+C',
    togglePartHover: 'Alt+V'
  }

  /**
   * 持久化快捷键并通知当前窗口组件。
   * 处理流程：
   * 1、提取受支持的快捷键字段，缺失值转为空字符串。
   * 2、保存后广播配置更新事件，返回规范化结果。
   */
  const persistHotkeysConfig = (config) => {
    // 1、仅保存受支持字段，空字符串用于表示未配置。
    const payload = {
      toggleMainWindow: config?.toggleMainWindow ?? '',
      togglePreviewWindow: config?.togglePreviewWindow ?? '',
      openSearch: config?.openSearch ?? '',
      toggleCanvasHover: config?.toggleCanvasHover ?? '',
      togglePartHover: config?.togglePartHover ?? ''
    }
    // 2、先保存再广播，监听方此时可读取最新值。
    localStorage.setItem(HOTKEYS_STORAGE_KEY, JSON.stringify(payload))
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('hotkeys-config-updated', { detail: payload }))
    }
    return payload
  }

  /**
   * 初始化快捷键表单。
   * 处理流程：
   * 1、解析保存配置，空值或缺失字段使用默认组合键。
   * 2、读取失败时返回完整默认配置。
   */
  const loadInitialHotkeysConfig = () => {
    // 1、此加载路径将空字符串视为缺省值。
    try {
      const savedConfig = localStorage.getItem(HOTKEYS_STORAGE_KEY)
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig)
        console.log('📖 初始化加载快捷键配置:', parsed)
        return {
          toggleMainWindow: parsed.toggleMainWindow || DEFAULT_HOTKEYS.toggleMainWindow,
          togglePreviewWindow: parsed.togglePreviewWindow || DEFAULT_HOTKEYS.togglePreviewWindow,
          openSearch: parsed.openSearch || DEFAULT_HOTKEYS.openSearch,
          toggleCanvasHover: parsed.toggleCanvasHover || DEFAULT_HOTKEYS.toggleCanvasHover,
          togglePartHover: parsed.togglePartHover || DEFAULT_HOTKEYS.togglePartHover
        }
      }
    } catch (error) {
      console.error('初始化加载快捷键配置失败:', error)
    }

    // 2、没有有效保存值时使用预置组合键。
    return {
      toggleMainWindow: DEFAULT_HOTKEYS.toggleMainWindow,
      togglePreviewWindow: DEFAULT_HOTKEYS.togglePreviewWindow,
      openSearch: DEFAULT_HOTKEYS.openSearch,
      toggleCanvasHover: DEFAULT_HOTKEYS.toggleCanvasHover,
      togglePartHover: DEFAULT_HOTKEYS.togglePartHover
    }
  }

  // 2、读取顺序保持在人物配置和悬浮预览之后、高清及对话配置之前。
  const hotkeysConfig = reactive(loadInitialHotkeysConfig())

  // ==================== 快捷键配置管理 ====================

  /**
   * 处理快捷键输入
   * 处理流程：
   * 1、拦截默认按键行为，处理清空、单独修饰键和不支持的 Meta 键。
   * 2、组合修饰键和主键，转换为桌面快捷键字符串。
   * 3、检查其他功能是否占用同一组合，无冲突时写入表单。
   */
  const handleHotkeyInput = (event, configKey) => {
    // 1、按键用于录制快捷键，不继续触发页面默认操作。
    event.preventDefault()
    event.stopPropagation()

    // 按 ESC 清空快捷键
    if (event.key === 'Escape') {
      hotkeysConfig[configKey] = ''
      message.info('已清空快捷键')
      return
    }

    // 忽略单独的修饰键
    if (['Control', 'Alt', 'Shift'].includes(event.key)) {
      return
    }

    // 如果按下了Meta键，提示不支持
    if (event.metaKey) {
      message.warning('不支持Meta键（Win键/Cmd键），请使用 Ctrl、Alt、Shift', {
        duration: 3000
      })
      return
    }

    // 2、按固定顺序组合修饰键，再附加规范化主键。
    const parts = []
    if (event.ctrlKey) parts.push('Ctrl')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')

    // 获取主键（转换为大写）
    let mainKey = event.key
    if (mainKey.length === 1) {
      mainKey = mainKey.toUpperCase()
    } else {
      // 特殊键名处理
      const keyMap = {
        'ArrowUp': 'Up',
        'ArrowDown': 'Down',
        'ArrowLeft': 'Left',
        'ArrowRight': 'Right',
        ' ': 'Space'
      }
      mainKey = keyMap[mainKey] || mainKey
    }

    parts.push(mainKey)

    const hotkeyString = parts.join('+')

    // 3、只比较其他配置项，允许当前项重复录入相同组合。
    const otherKeys = Object.keys(hotkeysConfig).filter(k => k !== configKey)
    const conflict = otherKeys.find(k => hotkeysConfig[k] === hotkeyString)

    if (conflict) {
      const keyNameMap = {
        toggleMainWindow: '主窗口唤醒/最小化',
        togglePreviewWindow: '预览窗口唤醒/最小化',
        openSearch: '打开搜索面板',
        toggleCanvasHover: '切换悬浮预览（主画布）',
        togglePartHover: '切换悬浮预览（部件）'
      }
      message.warning(`快捷键 ${hotkeyString} 已被 "${keyNameMap[conflict]}" 使用`, {
        duration: 3000
      })
      return
    }

    // 4、无冲突时更新表单，注册操作留到保存时执行。
    hotkeysConfig[configKey] = hotkeyString
    console.log(`⌨️ 设置快捷键: ${configKey} = ${hotkeyString}`)
  }

  /**
   * 重置快捷键为默认值
   * 处理流程：
   * 1、存在默认组合时更新对应表单项并提示。
   */
  const resetHotkey = (configKey) => {
    // 1、此处只重置编辑值，不立即重新注册系统快捷键。
    if (DEFAULT_HOTKEYS[configKey]) {
      hotkeysConfig[configKey] = DEFAULT_HOTKEYS[configKey]
      message.success(`已重置为默认值: ${DEFAULT_HOTKEYS[configKey]}`, {
        duration: 2000
      })
    }
  }

  /**
   * 清空快捷键
   * 处理流程：
   * 1、将指定配置项设置为空字符串并提示。
   */
  const clearHotkey = (configKey) => {
    // 1、保存后空值用于表达该功能没有快捷键绑定。
    hotkeysConfig[configKey] = ''
    message.info('已清空快捷键', {
      duration: 2000
    })
  }

  /**
   * 保存快捷键配置
   * 处理流程：
   * 1、提取快捷键值并保存、广播给当前窗口组件。
   * 2、备份配置，通知主进程重新注册全局快捷键。
   * 3、区分保存成功与注册失败，最后恢复保存按钮状态。
   */
  const saveHotkeysConfig = async () => {
    // 1、本地持久化与系统注册分开处理，注册失败不撤销保存值。
    try {
      isSavingHotkeys.value = true

      const configToSave = {
        toggleMainWindow: hotkeysConfig.toggleMainWindow || '',
        togglePreviewWindow: hotkeysConfig.togglePreviewWindow || '',
        openSearch: hotkeysConfig.openSearch || '',
        toggleCanvasHover: hotkeysConfig.toggleCanvasHover || '',
        togglePartHover: hotkeysConfig.togglePartHover || ''
      }

      console.log('💾 保存快捷键配置:', configToSave)

      // 保存到 localStorage 并同步通知其他页面
      persistHotkeysConfig(configToSave)

      // 自动备份配置到用户文档目录
      try {
        const allSettings = createHotkeysBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
        await window.electronAPI.settings.autoBackupSettings(allSettings)
        console.log('💾 配置已自动备份到用户文档目录')
      } catch (backupError) {
        console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
      }

      // 2、请求重新注册并单独提示注册失败的情况。
      if (window.electronAPI?.hotkeys?.updateHotkeys) {
        const result = await window.electronAPI.hotkeys.updateHotkeys(configToSave)
        if (result.success) {
          showSaveRestartTip('快捷键配置保存成功！')
        } else {
          message.warning(`配置已保存，但快捷键注册失败: ${result.error || '未知错误'}。${SAVE_RESTART_HINT}`, {
            duration: 5000
          })
        }
      } else {
        // 如果主进程API不存在，仍然保存配置
        showSaveRestartTip('快捷键配置保存成功！')
        console.warn('⚠️ 主进程快捷键API不存在，配置已保存但可能需要重启应用')
      }
    } catch (error) {
      console.error('保存快捷键配置失败:', error)
      message.error('保存失败: ' + error.message, {
        duration: 5000
      })
    } finally {
      isSavingHotkeys.value = false
    }
  }

  // 3、跨域流程与模板共用唯一响应式配置，不转发域内加载器或存储键。
  return {
    hotkeysConfig,
    isSavingHotkeys,
    currentEditingHotkey,
    DEFAULT_HOTKEYS,
    persistHotkeysConfig,
    handleHotkeyInput,
    resetHotkey,
    clearHotkey,
    saveHotkeysConfig
  }
}
