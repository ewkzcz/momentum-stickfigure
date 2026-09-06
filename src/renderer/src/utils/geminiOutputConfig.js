/** 生图输出路径工具：解析用户目录设置，并生成跨平台拖拽导出参数。 */
import { loadGeminiImageConfigFromStorage } from '@renderer/config/gemini-image-config.js'

const DEFAULT_OUTPUT_DIR = 'output'

const WINDOWS_ABSOLUTE = /^[A-Za-z]:\\/
const WINDOWS_UNC = /^\\\\/

/**
 * 判断输出设置是否为绝对路径。
 * 处理流程：
 * 1、排除空值，依次识别 POSIX、Windows 盘符和 UNC 路径。
 */
const isAbsolutePath = (path) => {
  // 1、兼容不同系统保存的绝对路径格式。
  if (!path) return false
  if (path.startsWith('/')) return true
  if (WINDOWS_ABSOLUTE.test(path) || WINDOWS_UNC.test(path)) return true
  return false
}

/**
 * 拼接输出根目录与相对目录。
 * 处理流程：
 * 1、任一段为空时返回另一段。
 * 2、裁去连接处的分隔符，再按目标平台拼接。
 */
const joinPaths = (base, sub, platform = 'win32') => {
  // 1、空路径段不额外添加分隔符。
  if (!base) return sub || ''
  if (!sub) return base
  // 2、只规范连接处，保留路径内部结构。
  const separator = platform === 'win32' ? '\\' : '/'
  /** 去除基路径末尾分隔符；处理流程：1、删除末尾连续的斜杠或反斜杠。 */
  const trimTrailing = (value) => value.replace(/[\\/]+$/g, '')
  /** 去除子路径开头分隔符；处理流程：1、删除开头连续的斜杠或反斜杠。 */
  const trimLeading = (value) => value.replace(/^[\\/]+/g, '')
  return `${trimTrailing(base)}${separator}${trimLeading(sub)}`
}

/**
 * 推导默认生图项目目录。
 * 处理流程：
 * 1、读取预加载提供的用户目录和平台。
 * 2、构造图片目录下的项目路径，无用户目录时回退相对路径。
 */
const getDefaultProjectRoot = () => {
  // 1、从桌面环境信息中读取路径基准。
  const homedir = window?.env?.homedir || ''
  const platform = window?.env?.platform || 'win32'
  // 2、默认项目路径使用目标平台的分隔符。
  if (!homedir) return './gemini-image'
  if (platform === 'win32') {
    return `${homedir}\\Pictures\\GeminiImage`
  }
  return `${homedir}/Pictures/GeminiImage`
}

/**
 * 读取生图配置并隔离读取异常。
 * 处理流程：
 * 1、调用统一配置加载器，失败时返回空对象供路径默认值接管。
 */
export const loadGeminiConfig = () => {
  // 1、路径解析不向调用方传播配置读取异常。
  try {
    return loadGeminiImageConfigFromStorage() || {}
  } catch (error) {
    console.warn('[GeminiConfig] Failed to read config:', error)
    return {}
  }
}

/**
 * 解析生图项目根目录。
 * 处理流程：
 * 1、优先使用去除首尾空白后的用户目录，否则使用默认目录。
 */
export const resolveGeminiProjectRoot = (config = {}) => {
  // 1、空白设置按未配置处理。
  const candidate = config.projectRoot?.trim()
  if (candidate) return candidate
  return getDefaultProjectRoot()
}

/**
 * 解析最终输出目录。
 * 处理流程：
 * 1、读取平台和输出设置，空设置使用默认相对目录。
 * 2、绝对路径直接使用，相对路径拼接到项目根目录。
 */
export const resolveGeminiOutputRoot = (config = {}) => {
  // 1、规范空设置并确定路径分隔符所属平台。
  const platform = window?.env?.platform || 'win32'
  const outputSetting = (config.outputDir || DEFAULT_OUTPUT_DIR).trim() || DEFAULT_OUTPUT_DIR
  // 2、绝对输出目录不受项目根目录约束。
  if (isAbsolutePath(outputSetting)) {
    return outputSetting
  }
  const projectRoot = resolveGeminiProjectRoot(config)
  return joinPaths(projectRoot, outputSetting, platform)
}

/**
 * 组装生图结果拖拽导出配置。
 * 处理流程：
 * 1、读取配置并解析最终输出目录。
 * 2、设置重名改名等默认行为，再合并调用方覆盖项。
 */
export const buildGeminiDragConfig = (extra = {}) => {
  // 1、让拖拽导出复用生图设置中的输出位置。
  const config = loadGeminiConfig()
  const outputRoot = resolveGeminiOutputRoot(config)
  // 2、单次操作提供的参数优先于默认导出选项。
  return {
    outputRoot,
    overwriteMode: 'rename',
    createPsdFolder: false,
    ...extra
  }
}
