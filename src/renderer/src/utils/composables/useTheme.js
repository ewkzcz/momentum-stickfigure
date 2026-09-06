/** 主题管理：共享明暗模式状态，将主题色映射为 CSS 变量和组件库覆盖配置。 */
import { ref, watch, onMounted } from 'vue'
// 极简风格主题配置 - 白昼与黑夜（柔和版）
export const THEME_CONFIG = {
  light: {
    name: 'light',
    label: '白昼',
    colors: {
      // 主色调 - 柔和蓝
      primary: '#4a7dff',
      primaryHover: '#3d6ee6',
      primaryPressed: '#2f5fcc',
      
      // 背景色系 - 柔和白
      background: '#f8f8f8',
      backgroundSecondary: '#f2f2f2',
      backgroundCard: '#fafafa',
      backgroundAccent: '#eeeeee',
      
      // 前景色系 - 柔和黑
      foreground: '#2a2a2a',
      foregroundSecondary: '#5a5a5a',
      foregroundMuted: '#8a8a8a',
      
      // 边框色系 - 极简灰
      border: '#e0e0e0',
      borderLight: '#ebebeb',
      borderHover: '#d0d0d0',
      
      // 状态色 - 柔和明快
      success: '#2ecc71',
      warning: '#f39c12',
      error: '#e74c3c',
      info: '#4a7dff',
      
      // 侧边栏专用色
      sidebar: '#fafafa',
      sidebarForeground: '#2a2a2a',
      sidebarAccent: '#eeeeee',
      sidebarBorder: '#e0e0e0',
      
      // 输入框专用色
      inputBackground: '#fafafa',
      inputText: '#2a2a2a',
      inputTextPlaceholder: '#8a8a8a',
      inputBorder: '#e0e0e0',
      inputBorderHover: '#d0d0d0',
      inputBorderFocus: '#4a7dff',
      
      // 文本选中色
      selectionBackground: '#4a7dff',
      selectionText: '#ffffff',
      
      // 阴影 - 轻柔
      shadowLight: 'rgba(0, 0, 0, 0.04)',
      shadowMedium: 'rgba(0, 0, 0, 0.08)',
      
      // DialogPage 专用增强色
      dialogBgElevated: '#ffffff',
      dialogBgCard: '#f6f8fa',
      dialogBgPanel: '#eff1f3',
      dialogBgHover: '#e8eaed',
      dialogBgActive: '#e0e3e7',
      dialogBorderDefault: '#d0d4da',
      dialogBorderStrong: '#b8bec6',
      dialogShadowSm: '0 2px 8px rgba(0, 0, 0, 0.08)',
      dialogShadowMd: '0 4px 16px rgba(0, 0, 0, 0.12)',
    }
  },
  dark: {
    name: 'dark',
    label: '黑夜',
    colors: {
      // 主色调 - 柔和蓝光
      primary: '#6b9eff',
      primaryHover: '#8ab3ff',
      primaryPressed: '#5589e6',
      
      // 背景色系 - 深灰黑
      background: '#0f0f0f',
      backgroundSecondary: '#1a1a1a',
      backgroundCard: '#1f1f1f',
      backgroundAccent: '#252525',
      
      // 前景色系 - 柔和白
      foreground: '#e8e8e8',
      foregroundSecondary: '#b8b8b8',
      foregroundMuted: '#888888',
      
      // 边框色系 - 深灰
      border: '#2a2a2a',
      borderLight: '#232323',
      borderHover: '#363636',
      
      // 状态色 - 柔和高对比
      success: '#27ae60',
      warning: '#e67e22',
      error: '#e74c3c',
      info: '#6b9eff',
      
      // 侧边栏专用色
      sidebar: '#0f0f0f',
      sidebarForeground: '#e8e8e8',
      sidebarAccent: '#232323',
      sidebarBorder: '#2a2a2a',
      
      // 输入框专用色
      inputBackground: '#1f1f1f',
      inputText: '#e8e8e8',
      inputTextPlaceholder: '#888888',
      inputBorder: '#2a2a2a',
      inputBorderHover: '#363636',
      inputBorderFocus: '#6b9eff',
      
      // 文本选中色
      selectionBackground: '#6b9eff',
      selectionText: '#0f0f0f',
      
      // 阴影 - 深邃
      shadowLight: 'rgba(0, 0, 0, 0.3)',
      shadowMedium: 'rgba(0, 0, 0, 0.5)',
      
      // DialogPage 专用增强色
      dialogBgElevated: '#161616',
      dialogBgCard: '#1e1e1e',
      dialogBgPanel: '#242424',
      dialogBgHover: '#2a2a2a',
      dialogBgActive: '#323232',
      dialogBorderDefault: '#343434',
      dialogBorderStrong: '#424242',
      dialogShadowSm: '0 2px 8px rgba(0, 0, 0, 0.4)',
      dialogShadowMd: '0 4px 16px rgba(0, 0, 0, 0.5)',
    }
  }
}

// 主题状态
const currentTheme = ref('dark') // 默认深色主题
const isLoading = ref(false)

/**
 * 生成 Naive UI 主题覆盖配置。
 * 处理流程：
 * 1、将应用色表映射为通用颜色及各组件的状态颜色。
 * 2、提示框按明暗模式单独选择背景、文字和阴影。
 */
const createNaiveThemeOverrides = (themeColors, themeName = 'dark') => ({
  // 1、统一通用颜色，再对菜单、按钮、卡片等组件分别覆盖。
  common: {
    primaryColor: themeColors.primary,
    primaryColorHover: themeColors.primaryHover,
    primaryColorPressed: themeColors.primaryPressed,
    primaryColorSuppl: themeColors.primary,
    
    baseColor: themeColors.background,
    bodyColor: themeColors.background,
    cardColor: themeColors.backgroundCard,
    modalColor: themeColors.backgroundCard,
    popoverColor: themeColors.backgroundCard,
    
    textColorBase: themeColors.foreground,
    textColor1: themeColors.foreground,
    textColor2: themeColors.foregroundSecondary,
    textColor3: themeColors.foregroundMuted,
    
    borderColor: themeColors.border,
    dividerColor: themeColors.border,
    
    successColor: themeColors.success,
    warningColor: themeColors.warning,
    errorColor: themeColors.error,
    infoColor: themeColors.info
  },
  Menu: {
    itemColor: 'transparent',
    itemColorHover: themeColors.sidebarAccent,
    itemColorActive: themeColors.primary,
    itemColorActiveHover: themeColors.primaryHover,
    
    itemIconColor: themeColors.sidebarForeground,
    itemIconColorHover: themeColors.primary,
    itemIconColorActive: '#ffffff',
    itemIconColorActiveHover: '#ffffff',
    
    itemTextColor: themeColors.sidebarForeground,
    itemTextColorHover: themeColors.primary,
    itemTextColorActive: '#ffffff',
    itemTextColorActiveHover: '#ffffff',
    
    itemHeight: '56px',
    itemPadding: '0 12px',
    itemMargin: '4px 8px',
    borderRadius: '8px'
  },
  Button: {
    textColor: themeColors.foreground,
    textColorPrimary: '#ffffff',
    borderHoverPrimary: `1px solid ${themeColors.primaryHover}`,
    borderPressedPrimary: `1px solid ${themeColors.primaryPressed}`,
    borderHover: `1px solid ${themeColors.primary}`,
    borderPressed: `1px solid ${themeColors.primary}`,
    textColorHover: themeColors.primary,
    textColorPressed: themeColors.primary
  },
  Card: {
    color: themeColors.backgroundCard,
    borderColor: themeColors.border,
    borderColorModal: themeColors.border
  },
  Tooltip: {
    color: themeName === 'light' ? 'white' : '#2a2a2a',
    textColor: themeName === 'light' ? '#2a2a2a' : '#e5e5e5',
    boxShadow: themeName === 'light' ? '0 4px 12px rgba(0, 0, 0, 0.15)' : '0 4px 12px rgba(0, 0, 0, 0.5)'
  },
  Input: {
    // 背景色配置
    color: themeColors.inputBackground,
    colorFocus: themeColors.inputBackground,
    colorHover: themeColors.inputBackground,
    colorDisabled: themeColors.backgroundSecondary,
    
    // 文字颜色配置
    textColor: themeColors.inputText,
    textColorFocus: themeColors.inputText,
    textColorDisabled: themeColors.foregroundMuted,
    
    // 占位符颜色
    placeholderColor: themeColors.inputTextPlaceholder,
    placeholderColorFocus: themeColors.inputTextPlaceholder,
    placeholderColorDisabled: themeColors.foregroundMuted,
    
    // 边框配置
    border: `1px solid ${themeColors.inputBorder}`,
    borderHover: `1px solid ${themeColors.inputBorderHover}`,
    borderFocus: `1px solid ${themeColors.inputBorderFocus}`,
    borderDisabled: `1px solid ${themeColors.borderLight}`,
    borderError: `1px solid ${themeColors.error}`,
    
    // 光标和焦点
    caretColor: themeColors.primary,
    boxShadowFocus: `0 0 0 2px ${themeColors.primary}20`,
    
    // 清除按钮和图标
    clearColor: themeColors.foregroundMuted,
    clearColorHover: themeColors.foregroundSecondary,
    clearColorPressed: themeColors.foregroundSecondary,
    iconColor: themeColors.foregroundMuted,
    iconColorHover: themeColors.foregroundSecondary,
    iconColorPressed: themeColors.foregroundSecondary,
    iconColorDisabled: themeColors.foregroundMuted,
    
    // 后缀和计数器
    suffixTextColor: themeColors.foregroundSecondary,
    countTextColor: themeColors.foregroundMuted,
    countTextColorError: themeColors.error,
    
    // 文本域样式
    textColorTextarea: themeColors.inputText,
    colorTextarea: themeColors.inputBackground,
    borderTextarea: `1px solid ${themeColors.inputBorder}`,
    borderHoverTextarea: `1px solid ${themeColors.inputBorderHover}`,
    borderFocusTextarea: `1px solid ${themeColors.inputBorderFocus}`,
    borderDisabledTextarea: `1px solid ${themeColors.borderLight}`,
    boxShadowFocusTextarea: `0 0 0 2px ${themeColors.primary}20`
  }
})

/**
 * 将主题色写入页面根节点。
 * 处理流程：
 * 1、将驼峰色名转换为连字符 CSS 变量名，逐项写入根节点。
 */
const applyCSSVariables = (themeColors) => {
  // 1、所有使用主题变量的页面共享根节点配置。
  const root = document.documentElement
  
  // 应用主题色彩变量
  Object.entries(themeColors).forEach(([key, value]) => {
    const cssVarName = `--theme-${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`
    root.style.setProperty(cssVarName, value)
  })
}

/**
 * 提供主题查询、切换和持久化接口。
 * 处理流程：
 * 1、建立组件实例的覆盖配置缓存和帧调度状态。
 * 2、监听共享主题变化，合并帧内样式更新。
 * 3、挂载时恢复保存的主题，对外暴露共享状态和操作。
 */
export const useTheme = () => {
  // 1、主题状态在模块内共享，缓存和帧句柄属于当前调用实例。
  let themeOverridesCache = null
  let themeOverridesName = null
  let themeApplyRaf = null

  /**
   * 立即应用指定主题。
   * 处理流程：
   * 1、写入颜色变量并替换页面主题类名。
   * 2、清除组件库覆盖缓存，确保后续读取使用新主题。
   */
  const applyTheme = (themeName) => {
    // 1、原生样式变量和主题类名一起更新。
    const config = getThemeConfig(themeName)
    applyCSSVariables(config.colors)

    document.body.className = document.body.className.replace(/theme-\w+/g, '')
    document.body.classList.add(`theme-${themeName}`)

    // 2、主题改变后旧覆盖对象不可继续复用。
    themeOverridesCache = null
    themeOverridesName = null
  }

  /**
   * 安排下一帧应用主题。
   * 处理流程：
   * 1、不支持动画帧时直接应用。
   * 2、取消尚未执行的帧，只保留本次最新主题请求。
   */
  const scheduleApplyTheme = (themeName) => {
    // 1、没有帧调度接口时保留同步执行路径。
    if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
      applyTheme(themeName)
      return
    }

    // 2、同一实例的连续切换只执行最后一次样式更新。
    if (themeApplyRaf !== null) {
      cancelAnimationFrame(themeApplyRaf)
    }
    themeApplyRaf = requestAnimationFrame(() => {
      applyTheme(themeName)
      themeApplyRaf = null
    })
  }

  /**
   * 查询主题配置。
   * 处理流程：
   * 1、使用指定或当前主题名称查表，未知名称回退深色配置。
   */
  const getThemeConfig = (themeName = currentTheme.value) => {
    // 1、为非法主题名称提供稳定默认值。
    return THEME_CONFIG[themeName] || THEME_CONFIG.dark
  }
  
  /**
   * 查询当前主题的组件库覆盖配置。
   * 处理流程：
   * 1、主题名称未变且缓存存在时直接复用。
   * 2、否则重新生成覆盖对象并记录缓存所属主题。
   */
  const getNaiveThemeOverrides = () => {
    // 1、避免同一主题的重复渲染创建新的配置对象。
    const themeName = currentTheme.value
    if (themeOverridesCache && themeOverridesName === themeName) {
      return themeOverridesCache
    }
    // 2、缓存仅在主题名称与生成时一致时有效。
    const config = getThemeConfig(themeName)
    themeOverridesCache = createNaiveThemeOverrides(config.colors, themeName)
    themeOverridesName = themeName
    return themeOverridesCache
  }
  
  /**
   * 在深色和浅色主题间切换。
   * 处理流程：
   * 1、设置加载标志，反转共享主题并保存偏好。
   * 2、稍后解除加载状态，样式更新由主题监听器负责。
   */
  const toggleTheme = async () => {
    // 1、共享状态更新会通知所有使用主题的组件。
    isLoading.value = true
    try {
      currentTheme.value = currentTheme.value === 'dark' ? 'light' : 'dark'
      localStorage.setItem('theme', currentTheme.value)
    } finally {
      // 2、短暂保留加载标志，让切换控件呈现反馈。
      setTimeout(() => {
        isLoading.value = false
      }, 200)
    }
  }
  
  /**
   * 设置指定主题。
   * 处理流程：
   * 1、仅接受配置表中的主题，更新共享状态并持久化。
   */
  const setTheme = (themeName) => {
    // 1、忽略未知名称，避免写入无效主题偏好。
    if (THEME_CONFIG[themeName]) {
      currentTheme.value = themeName
      localStorage.setItem('theme', themeName)
    }
  }
  
  // 2、监听共享主题，通过动画帧合并样式更新。
  watch(currentTheme, (newTheme) => {
    scheduleApplyTheme(newTheme)
  }, { immediate: true })
  
  // 3、挂载时恢复有效的保存值并立即应用初始主题。
  onMounted(() => {
    // 从 localStorage 读取保存的主题
    const savedTheme = localStorage.getItem('theme')
    if (savedTheme && THEME_CONFIG[savedTheme]) {
      currentTheme.value = savedTheme
    }
    
    // 应用初始主题
    applyTheme(currentTheme.value)
  })
  
  return {
    // 状态
    currentTheme: currentTheme,
    isLoading,
    
    // 方法
    getThemeConfig,
    getNaiveThemeOverrides,
    toggleTheme,
    setTheme,
    
    // 计算属性
    themeLabel: () => getThemeConfig().label
  }
}
