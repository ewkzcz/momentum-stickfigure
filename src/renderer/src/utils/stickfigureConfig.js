/** 人物工具配置：读取本地导出偏好，并为拖拽到剪映提供一致的输出参数。 */
const DEFAULT_STICKFIGURE_CONFIG = {
  outputRoot: '',
  overwriteMode: 'rename',
  duplicateFileHandling: 'addIndex',
  createPsdFolder: true,
  enableFuzzyMatch: true
}

/**
 * 读取人物工具的持久化配置。
 * 处理流程：
 * 1、无浏览器存储时返回默认配置副本。
 * 2、解析保存值并覆盖默认字段，读取失败时回退默认值。
 */
export function loadStickfigureConfig() {
  // 1、兼容无浏览器环境，避免读取不存在的存储对象。
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return { ...DEFAULT_STICKFIGURE_CONFIG }
  }

  try {
    // 2、用保存值覆盖默认字段，缺少的新字段仍采用默认值。
    const saved = localStorage.getItem('stickfigure-config')
    if (!saved) {
      return { ...DEFAULT_STICKFIGURE_CONFIG }
    }

    const parsed = JSON.parse(saved)
    return {
      ...DEFAULT_STICKFIGURE_CONFIG,
      ...parsed
    }
  } catch (error) {
    console.warn('[StickfigureConfig] Failed to parse config:', error)
    return { ...DEFAULT_STICKFIGURE_CONFIG }
  }
}

/**
 * 组装拖拽到剪映时传给主进程的导出配置。
 * 处理流程：
 * 1、读取配置并补齐旧配置的 PSD 子目录选项。
 * 2、合并调用方覆盖项，允许单次拖拽调整导出行为。
 */
export function buildStickfigureDragConfig(extra = {}) {
  // 1、恢复用户偏好，并兼容尚未保存子目录选项的配置。
  const config = loadStickfigureConfig()

  // 旧配置可能未显式设置是否创建 PSD 子目录。
  if (config.createPsdFolder === undefined) {
    config.createPsdFolder = true
  }

  // 2、调用方参数具有最高优先级。
  return {
    ...config,
    ...extra
  }
}
