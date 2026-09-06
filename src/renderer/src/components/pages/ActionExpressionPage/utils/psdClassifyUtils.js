/**
 * PSD分类相关的工具函数
 * 包含前手特殊名称配置、自定义图组名称配置、前手分类等功能
 */

import { normalizeString } from './stringUtils.js'

/**
 * 检查路径是否包含侧面/背面等非正面视角关键词
 * 处理流程：
 * 1、检查路径并转换为小写。
 * 2、合并基础与可选严格关键词，执行包含匹配。
 * @param {string} path - 图层路径
 * @param {boolean} strict - 是否严格模式（默认false）
 * @returns {boolean} true表示应该排除
 */
export const shouldExcludeNonFrontView = (path, strict = false) => {
  // 1、空路径不排除，其余路径统一大小写。
  if (!path) return false
  
  const normalizedPath = path.toLowerCase()
  
  // 2、准备基础排除关键词，并按严格模式追加匹配范围。
  const basicExcludeKeywords = [
    '侧面', 'side', 'sideview', 'profile',
    '侧身', 'sidebody',
    '背面', 'back', 'backview', 'rear',
    '背身', 'backbody',
    '背影', 'backside'
  ]
  
  // 严格模式额外关键词（可选）
  const strictExcludeKeywords = strict ? [
    '侧视', 'lateral',
    '侧视图', 'sideprofile',
    '背视', 'rearview',
    '背视图', 'backprofile',
    '左侧', 'leftside',
    '右侧', 'rightside'
  ] : []
  
  const allKeywords = [...basicExcludeKeywords, ...strictExcludeKeywords]
  
  return allKeywords.some(keyword => normalizedPath.includes(keyword))
}

/**
 * 获取前手特殊名称配置
 * 从localStorage读取用户配置的前手特殊名称（双手、右手）
 * 处理流程：
 * 1、读取本地配置，解析失败时继续采用默认名称。
 * 2、按常用分隔符拆分并过滤空名称。
 * 3、返回双手与右手规则；存储读取异常时回退到默认规则。
 * @returns {{ bothNames: string[], rightNames: string[] }} 双手和右手的名称数组
 */
export const getFrontHandSpecialNames = () => {
  // 1、准备与设置页一致的默认值并读取本地配置。
  try {
    // 默认值常量（与SettingsPage保持一致）
    const DEFAULT_BOTH_NAMES = '交叉、合十、抱拳、结印、托脸、戳手指、双手抱臂、敲手'
    const DEFAULT_RIGHT_NAMES = '伏案右、伏案右边、拍胸、拍胸右、拍胸右边、拍胸口、拍胸口右、拍胸口右边、端起、端起右、端起右边、捂嘴右、捂嘴右边、拎东西、扶着头、摸头右、摸头右（2）、举手右、托腮（2）、擦汗、拳胸、吃东西动作、后手举起、单手结印、擦泪、比枪'
    
    const savedConfig = localStorage.getItem('stickfigure-config')
    let config = null
    
    if (savedConfig) {
      try {
        config = JSON.parse(savedConfig)
      } catch (parseError) {
        console.error('❌ 解析配置失败:', parseError)
        config = null
      }
    }
    
    // 2、解析双手名称（支持逗号、顿号、换行分隔），如果未配置则使用默认值。
    const bothNamesStr = (config && config.frontHandBothNames) ? config.frontHandBothNames : DEFAULT_BOTH_NAMES
    const bothNames = bothNamesStr
      .split(/[,，、\n]/)
      .map(name => name.trim())
      .filter(name => name.length > 0)
    
    // 解析右手名称（支持逗号、顿号、换行分隔），如果未配置则使用默认值
    const rightNamesStr = (config && config.frontHandRightNames) ? config.frontHandRightNames : DEFAULT_RIGHT_NAMES
    const rightNames = rightNamesStr
      .split(/[,，、\n]/)
      .map(name => name.trim())
      .filter(name => name.length > 0)
    
    console.log('📋 前手特殊名称配置:')
    console.log('  双手:', bothNames)
    console.log('  右手:', rightNames)
    
    // 3、返回解析后的规则；异常分支使用相同格式的默认数组。
    return { bothNames, rightNames }
  } catch (error) {
    console.error('❌ 获取前手特殊名称配置失败:', error)
    // 发生错误时返回默认值
    const DEFAULT_BOTH_NAMES = '交叉、合十、抱拳、结印、托脸、戳手指、双手抱臂、敲手'
    const DEFAULT_RIGHT_NAMES = '伏案右、伏案右边、拍胸、拍胸右、拍胸右边、拍胸口、拍胸口右、拍胸口右边、端起、端起右、端起右边、捂嘴右、捂嘴右边、拎东西、扶着头、摸头右、摸头右（2）、举手右、托腮（2）、擦汗、拳胸、吃东西动作、后手举起、单手结印、擦泪、比枪'
    
    const bothNames = DEFAULT_BOTH_NAMES.split(/[,，、\n]/).map(name => name.trim()).filter(name => name.length > 0)
    const rightNames = DEFAULT_RIGHT_NAMES.split(/[,，、\n]/).map(name => name.trim()).filter(name => name.length > 0)
    
    return { bothNames, rightNames }
  }
}

/**
 * 获取自定义图组名称配置
 * 从localStorage读取用户配置的图组名称变体
 * 处理流程：
 * 1、准备默认图组名称并读取本地覆盖配置。
 * 2、逐组拆分名称，其中表情直接保留全部配置变体。
 * 3、返回分类规则，读取异常时返回内置规则。
 * @returns {Object} 各图组的名称数组配置对象
 */
export const getCustomGroupNames = () => {
  // 1、建立默认规则并尝试解析本地覆盖值。
  try {
    // 默认值常量（与SettingsPage保持一致）
    const DEFAULT_GROUP_NAMES = {
      frontHand: '前手、紧袖口1、古代长袖1、现代长袖1、长紧袖口1、上手、上手 副本、后手前置',
      backHand: '后手、前层后手、紧袖口2、古代长袖2、现代长袖2、长紧袖口2、下手、下手 副本、后手后置',
      bothHands: '双手、前手（双手）、前手(双手)',
      upperBody: '上身、上半身',
      lowerBody: '下身、下半身',
      action: '动作、手部',
      // 表情图组统一配置（包含所有表情变体）
      expression: '表情、表情(合并)、表情（合并）、表情1、表情2、专属表情、专属表情1、专属表情2、专属表情3、专属表情【灰豆绿色】、专属表情【粉色】、辅助表情、豆豆眼、豆豆眼1、豆豆眼2、豆豆眼表情、豆豆眼表情1、豆豆眼表情2、表情豆豆眼、帅哥眼睛、眼睛女、眼睛男、眉毛、眼睛、嘴、新表情、新新表情、脸 副本、眉毛 副本、嘴 副本、眼睛 副本、定制表情、定制表情1、定制表情2'
    }
    
    const savedConfig = localStorage.getItem('stickfigure-config')
    let config = null
    
    if (savedConfig) {
      try {
        config = JSON.parse(savedConfig)
      } catch (parseError) {
        console.error('❌ 解析配置失败:', parseError)
        config = null
      }
    }
    
    // 2、解析基础图组的名称数组。
    const result = {}
    Object.keys(DEFAULT_GROUP_NAMES).forEach(key => {
      if (key === 'expression') {
        // 表情配置：直接使用配置中的所有表情名称，不做复杂的智能分配
        const namesStr = (config && config.groupNames && config.groupNames.expression) 
          ? config.groupNames.expression 
          : DEFAULT_GROUP_NAMES.expression
        
        // 解析所有表情变体名称
        result.expression = namesStr
          .split(/[,，、\n]/)
          .map(name => name.trim())
          .filter(name => name.length > 0)
      } else {
        // 其他图组正常解析
        const namesStr = (config && config.groupNames && config.groupNames[key]) 
          ? config.groupNames[key] 
          : DEFAULT_GROUP_NAMES[key]
        
        result[key] = namesStr
          .split(/[,，、\n]/)
          .map(name => name.trim())
          .filter(name => name.length > 0)
      }
    })
    
    console.log('📋 自定义图组名称配置:')
    console.log('  前手变体:', result.frontHand)
    console.log('  后手变体:', result.backHand)
    console.log('  双手变体:', result.bothHands)
    console.log('  动作变体:', result.action)
    console.log('  表情变体:', result.expression)
    console.log('  上身变体:', result.upperBody)
    console.log('  下身变体:', result.lowerBody)
    
    // 3、返回可直接用于分类匹配的名称数组。
    return result
  } catch (error) {
    console.error('❌ 获取自定义图组名称配置失败:', error)
    // 发生错误时返回默认值
    const DEFAULT_EXPRESSION_NAMES = '表情、表情(合并)、表情（合并）、表情1、表情2、任意表情、专属表情、专属表情1、专属表情2、专属表情3、专属表情【灰豆绿色】、专属表情【粉色】、辅助表情、豆豆眼、豆豆眼1、豆豆眼2、豆豆眼表情、豆豆眼表情1、豆豆眼表情2、表情豆豆眼、帅哥眼睛、眼睛女、眼睛男、眉毛、眼睛、嘴、新表情、新新表情、脸 副本、眉毛 副本、嘴 副本、眼睛 副本'
    return {
      frontHand: ['前手', '紧袖口1', '古代长袖1', '现代长袖1', '长紧袖口1'],
      backHand: ['后手', '前层后手', '紧袖口2', '古代长袖2', '现代长袖2', '长紧袖口2'],
      bothHands: ['双手', '前手（双手）', '前手(双手)'],
      upperBody: ['上身', '上半身'],
      lowerBody: ['下身', '下半身'],
      action: ['动作'],
      expression: DEFAULT_EXPRESSION_NAMES.split(/[,，、\n]/).map(n => n.trim()).filter(n => n.length > 0)
    }
  }
}

/**
 * 分类前手图层（根据配置拆分为正常、右手、双手三个子组）
 * 处理流程：
 * 1、读取特殊名称并初始化三个结果集合。
 * 2、标准化图层名，依次匹配双手、右手，剩余归入正常组。
 * 3、返回保持遍历顺序的分类结果。
 * @param {Array} allFrontHandParts - 所有前手图层数据
 * @returns {{ normalParts: Array, rightParts: Array, bothParts: Array }} 分类后的三个数组
 */
export const classifyFrontHandParts = (allFrontHandParts) => {
  // 1、读取分类规则，准备结果集合。
  const { bothNames, rightNames } = getFrontHandSpecialNames()
  
  const normalParts = []
  const rightParts = []
  const bothParts = []
  
  // 2、双手优先于右手匹配，避免同名片段重复归类。
  for (const part of allFrontHandParts) {
    const partName = part.name || ''
    // 规范化图层名称：去除空格并转换标点符号
    const normalizedPartName = normalizeString(partName)
    
    // 检查是否为双手（包含匹配，支持"双手-01"、"双手1"等带编号的图层）
    const isBothHands = bothNames.some(name => {
      const normalizedName = normalizeString(name)
      return normalizedPartName.includes(normalizedName)
    })
    
    if (isBothHands) {
      bothParts.push(part)
      console.log(`  ✅ [双手] ${partName}`)
      continue
    }
    
    // 检查是否为右手（包含匹配，支持"右手-01"、"右手1"等带编号的图层）
    const isRightHand = rightNames.some(name => {
      const normalizedName = normalizeString(name)
      return normalizedPartName.includes(normalizedName)
    })
    
    if (isRightHand) {
      rightParts.push(part)
      console.log(`  ✅ [右手] ${partName}`)
      continue
    }
    
    // 其他归为正常
    normalParts.push(part)
    console.log(`  ✅ [正常] ${partName}`)
  }
  
  console.log(`🎯 前手分类完成: 正常${normalParts.length}个, 右手${rightParts.length}个, 双手${bothParts.length}个`)
  
  // 3、返回三个互斥分类。
  return { normalParts, rightParts, bothParts }
}
