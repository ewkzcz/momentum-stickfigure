/**
 * 字符串处理工具函数
 * 提供字符串标准化、文件名清理、ID生成等功能
 */

/**
 * 字符串标准化
 * 去除空格、转换中文标点符号为英文、转换为小写
 * 处理流程：
 * 1、空输入返回空字符串。
 * 2、移除空白、统一标点并转为小写。
 * @param {string} str - 原始字符串
 * @returns {string} 标准化后的字符串
 */
export const normalizeString = (str) => {
  // 1、检查输入是否为空。
  if (!str) return ''
  // 2、依次统一空白、标点及字母大小写。
  return str
    .replace(/\s+/g, '') // 去除所有空格（包括空格、制表符、换行符等）
    .replace(/（/g, '(')  // 中文左括号 → 英文左括号
    .replace(/）/g, ')')  // 中文右括号 → 英文右括号
    .replace(/【/g, '[')  // 中文左方括号 → 英文左方括号
    .replace(/】/g, ']')  // 中文右方括号 → 英文右方括号
    .replace(/「/g, '"')  // 中文左引号 → 英文引号
    .replace(/」/g, '"')  // 中文右引号 → 英文引号
    .replace(/『/g, "'")  // 中文左单引号 → 英文单引号
    .replace(/』/g, "'")  // 中文右单引号 → 英文单引号
    .replace(/，/g, ',')  // 中文逗号 → 英文逗号
    .replace(/。/g, '.')  // 中文句号 → 英文句号
    .replace(/、/g, ',')  // 中文顿号 → 英文逗号
    .replace(/：/g, ':')  // 中文冒号 → 英文冒号
    .replace(/；/g, ';')  // 中文分号 → 英文分号
    .replace(/！/g, '!')  // 中文感叹号 → 英文感叹号
    .replace(/？/g, '?')  // 中文问号 → 英文问号
    .toLowerCase() // 转换为小写（方便匹配）
}

/**
 * 文件名段清理
 * 替换空格和不安全字符为下划线，去除路径分隔符
 * 支持 Windows/macOS/Linux 文件系统的所有非法字符
 * 处理流程：
 * 1、处理空输入。
 * 2、替换非法字符和空白，合并并修剪下划线。
 * @param {string} text - 原始文本
 * @returns {string} 清理后的文件名段
 */
export function sanitizeSegment(text) {
  // 1、空输入不生成文件名片段。
  if (!text) return ''
  // 2、替换空格和不安全字符为下划线，去除路径分隔符。
  // Windows 不允许的字符: \ / : * ? " < > |
  // macOS 不允许的字符: / :
  // 额外过滤控制字符和其他潜在问题字符
  return String(text)
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')  // 过滤非法字符和控制字符
    .replace(/[\s]+/g, '_')                      // 空格替换为下划线
    .replace(/_+/g, '_')                         // 多个下划线合并为一个
    .replace(/^_+|_+$/g, '')                     // 去除首尾下划线
}

/**
 * 清理导出文件名，处理跨平台不支持的字符。
 * 处理流程：
 * 1、空输入直接采用备用名称。
 * 2、清理非法字符及首尾句点、空格，空结果采用备用名称。
 */
export function sanitizeFileName(text, fallback = 'image') {
  // 1、优先处理空输入。
  if (!text) return fallback
  // 2、清理名称片段，并移除 Windows 不允许的首尾句点和空格。
  const sanitized = sanitizeSegment(String(text))
    .replace(/^[. ]+/, '')   // Windows �������� . �����ո�ͷ
    .replace(/[. ]+$/, '')   // Windows �������� . �����ո�β
  return sanitized || fallback
}
/**
 * 获取显示用的文件名。
 * 处理流程：
 * 1、空名称返回空字符串。
 * 2、移除不区分大小写的 PSD 扩展名。
 */
export const getDisplayFileName = (fileName) => {
  // 1、检查文件名。
  if (!fileName) return ''
  // 2、去除 .psd 或 .PSD 后缀。
  return fileName.replace(/\.(psd|PSD)$/i, '')
}

/**
 * 生成唯一ID
 * 格式: psd_时间戳_随机字符串
 * 处理流程：
 * 1、组合固定前缀、当前时间戳与随机字符串。
 * @returns {string} 唯一ID
 */
export const generateId = () => {
  // 1、生成用于本地 PSD 记录的标识。
  return `psd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 生成预设/模板名称
 * 自动递增编号，避免重复
 * 处理流程：
 * 1、从编号一开始构造候选名称。
 * 2、跳过已占用名称并返回首个可用名称。
 * @param {Array} existingPresets - 已存在的预设/模板列表
 * @param {string} prefix - 名称前缀，默认为'预设'
 * @returns {string} 新预设/模板名称
 */
export const generatePresetName = (existingPresets = [], prefix = '预设') => {
  // 1、建立初始候选名称。
  let counter = 1
  let name = `${prefix}${counter}`
  
  // 2、递增编号直至名称不冲突。
  while (existingPresets.some(p => p.name === name)) {
    counter++
    name = `${prefix}${counter}`
  }
  
  return name
}

/**
 * 生成短Hash值（用于文件名）
 * 使用时间戳、随机数和计数器混合生成高随机性的hash字符串
 * @param {number} length - hash长度，默认8位
 * @returns {string} 短hash字符串（小写字母和数字组合）
 */
let hashCounter = 0
/**
 * 生成文件名使用的短随机摘要。
 * 处理流程：
 * 1、混合时间戳、随机数与递增计数器。
 * 2、交织两段编码，并补齐或截断到指定长度。
 */
export const generateShortHash = (length = 8) => {
  // 1、混合多个随机源以降低碰撞率。
  const timestamp = Date.now()
  const random1 = Math.random()
  const random2 = Math.random()
  const counter = hashCounter++
  
  // 混合算法：将时间戳、随机数和计数器进行位运算混合
  const mixed = (timestamp * 9301 + counter * 49297 + random1 * 233280) % 233280
  const hash1 = Math.floor(mixed).toString(36)
  const hash2 = Math.floor(random2 * 0xFFFFFF).toString(36)
  
  // 2、交织两个哈希值以增加随机性，并调整为指定长度。
  let result = ''
  const maxLen = Math.max(hash1.length, hash2.length)
  for (let i = 0; i < maxLen; i++) {
    if (i < hash1.length) result += hash1[i]
    if (i < hash2.length) result += hash2[i]
  }
  
  // 确保足够长度，不足则补充随机字符
  while (result.length < length) {
    result += Math.floor(Math.random() * 36).toString(36)
  }
  
  return result.substring(0, length).toLowerCase()
}

/**
 * 生成时间戳字符串（用于文件名）
 * 处理流程：
 * 1、读取本地年月日并补齐位数。
 * 2、短格式返回日期，完整格式追加时分秒。
 * @param {boolean} short - 是否生成短格式（仅日期YYYYMMDD），默认false（完整时间YYYYMMDDHHmmss）
 * @returns {string} 时间戳字符串
 */
export const generateTimestamp = (short = false) => {
  // 1、读取本地日期组成日期前缀。
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  
  // 2、按格式选择是否追加时间。
  if (short) {
    return `${year}${month}${day}`
  }
  
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  return `${year}${month}${day}${hour}${minute}${second}`
}

/**
 * 压缩语义信息（只保留动作和表情信息）
 * 移除所有标签前缀（如"动作"、"表情"、"双手"等），只保留核心描述
 * 同时过滤文件系统不支持的特殊字符
 * 处理流程：
 * 1、提取动作和表情，定义名称清理规则。
 * 2、清理并连接两类描述，限制长度后过滤文件名字符。
 * @param {Object} semanticInfo - 语义信息对象
 * @param {Array<string>} semanticInfo.actions - 动作名称列表
 * @param {Array<string>} semanticInfo.expressions - 表情名称列表
 * @returns {string} 压缩后的语义字符串（如："双手惊恐"）
 */
export const compressSemanticInfo = (semanticInfo) => {
  // 1、读取语义分类并准备可复用的名称清理逻辑。
  const { actions = [], expressions = [] } = semanticInfo

  /**
   * 移除名称中的分类标签和无意义词汇。
   * 处理流程：
   * 1、去掉前缀、基础词和分隔符。
   * 2、清理文件系统不支持的字符。
   */
  const cleanName = (name) => {
    // 1、移除分类标签及冗余文字。
    const cleaned = name
      // 移除前缀标签
      .replace(/^(动作|表情|双手|左手|右手|上身|下身)[_\s:：-]*/g, '')
      // 移除"基础"词汇（可能出现在开头、中间或结尾）
      .replace(/基础/g, '')
      // 移除多余的分隔符
      .replace(/[_\s:：-]+/g, '')
      .trim()

    // 2、使用 sanitizeSegment 清理文件系统不支持的特殊字符。
    return sanitizeSegment(cleaned)
  }

  // 2、汇总有效语义，限制长度后输出文件名片段。
  const parts = []

  // 添加动作信息
  if (actions.length > 0) {
    const cleanedActions = actions.map(cleanName).filter(Boolean)
    if (cleanedActions.length > 0) {
      parts.push(...cleanedActions)
    }
  }

  // 添加表情信息
  if (expressions.length > 0) {
    const cleanedExpressions = expressions.map(cleanName).filter(Boolean)
    if (cleanedExpressions.length > 0) {
      parts.push(...cleanedExpressions)
    }
  }

  // 如果没有任何信息，返回空字符串
  if (parts.length === 0) {
    return ''
  }

  // 直接连接多个部分（已经去除分隔符），限制总长度
  let result = parts.join('')

  // 如果结果太长，截取前20个字符
  if (result.length > 20) {
    result = result.substring(0, 20)
  }

  // 最后再次清理，确保没有特殊字符遗漏
  return sanitizeSegment(result)
}

/**
 * 根据文件命名规则生成导出文件名
 * 处理流程：
 * 1、读取命名规则及语义信息。
 * 2、按规则生成时间戳或随机摘要，并按需追加描述。
 * 3、补齐空名称并统一清理文件名。
 * @param {Object} options - 配置选项
 * @param {string} options.namingRule - 命名规则: 'timestamp-semantic' | 'hash-semantic' | 'timestamp-only' | 'hash-only'
 * @param {Object} options.semanticInfo - 语义信息（动作和表情）
 * @param {Array<string>} options.semanticInfo.actions - 动作名称列表
 * @param {Array<string>} options.semanticInfo.expressions - 表情名称列表
 * @param {string} options.psdName - PSD文件名（可选，某些命名规则可能需要）
 * @returns {string} 生成的文件名（不含扩展名）
 */
export const generateExportFileName = (options) => {
  // 1、读取规则及可选 PSD 名称。
  const { namingRule, semanticInfo, psdName = '' } = options
  let rawName = ''
  
  // 2、按规则构造文件名；语义为空时依次回退到 PSD 名称或前缀。
  switch (namingRule) {
    case 'timestamp-semantic': {
      // 时间戳加压缩后的动作、表情描述。
      const timestamp = generateTimestamp(false)
      const semantic = compressSemanticInfo(semanticInfo)
      if (semantic) {
        rawName = `${timestamp}${semantic}`
      } else if (psdName) {
        rawName = `${timestamp}${psdName}`
      } else {
        rawName = timestamp
      }
      break
    }
    
    case 'hash-semantic': {
      // 短随机摘要加压缩后的动作、表情描述。
      const hash = generateShortHash(8)
      const semantic = compressSemanticInfo(semanticInfo)
      if (semantic) {
        rawName = `${hash}${semantic}`
      } else if (psdName) {
        rawName = `${hash}${psdName}`
      } else {
        rawName = hash
      }
      break
    }
    
    case 'timestamp-only': {
      // 仅使用完整时间戳。
      rawName = generateTimestamp(false)
      break
    }
    
    case 'hash-only': {
      // 仅使用十六位随机摘要。
      rawName = generateShortHash(16)
      break
    }
    
    default: {
      // 未知规则默认使用时间戳加语义信息。
      const timestamp = generateTimestamp(false)
      const semantic = compressSemanticInfo(semanticInfo)
      if (semantic) {
        rawName = `${timestamp}${semantic}`
      } else if (psdName) {
        rawName = `${timestamp}${psdName}`
      } else {
        rawName = timestamp
      }
      break
    }
  }
  
  // 3、为空名称提供时间戳，并统一执行文件名清理。
  if (!rawName) {
    rawName = generateTimestamp(false)
  }
  
  return sanitizeFileName(rawName, generateTimestamp(false))
}
