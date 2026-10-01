/** 画布输出名称：保留原 PNG 命名规则，在各原始读取点通过明确 getter 获取页面引用。 */
import { sanitizeSegment, generateExportFileName } from './stringUtils.js'

/**
 * 根据当前控制模式与选择内容生成 PNG 文件名。
 * 处理流程：
 * 1、读取命名规则，图层树模式使用不含语义的规则
 * 2、处理侧面、背面和后面的专用名称
 * 3、收集去重后的动作名及表情名
 * 4、调用统一命名工具并追加文件扩展名
 */
export function buildCanvasOutputFileName(sources) {
  // 1、读取文件名规则配置，图层树模式提前生成无语义名称
  let fileNamingRule = 'timestamp-semantic' // 默认值
  try {
    const savedConfig = localStorage.getItem('stickfigure-config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      fileNamingRule = config.fileNamingRule || 'timestamp-semantic'
    }
  } catch (error) {
    console.warn('读取文件名规则配置失败:', error)
  }

  // ========== 图层树模式：直接返回纯时间戳或Hash，不处理任何语义 ==========
  if (sources.controlPriority.value === 'layerTree') {
    // 将带语义的规则转换为纯规则
    if (fileNamingRule === 'timestamp-semantic') {
      fileNamingRule = 'timestamp-only'
    } else if (fileNamingRule === 'hash-semantic') {
      fileNamingRule = 'hash-only'
    }

    const baseFileName = generateExportFileName({
      namingRule: fileNamingRule,
      semanticInfo: { actions: [], expressions: [] },
      psdName: ''
    })

    return `${baseFileName}.png`
  }

  // ========== 部件控制模式：正常处理语义信息 ==========
  const psdNameRaw = sources.currentPsdFile.value?.name || 'image'
  const psdBase = sanitizeSegment(psdNameRaw.replace(/\.(psd|PSD)$/,'') || 'image')

  // 2、侧面、背面与后面使用固定方向后缀
  if (sources.showSide.value) {
    return `${psdBase}_侧面.png`
  }
  if (sources.showBack.value) {
    return `${psdBase}_背面.png`
  }
  if (sources.showRear.value) {
    return `${psdBase}_后面.png`
  }

  // 3、收集动作与表情语义，动作名称按首次出现去重
  // 使用与绿色小圆点完全相同的逻辑：遍历所有标签，检查是否有内容
  const actionNames = []

  // 所有可能包含动作信息的key（包括手部动作和动作图组）
  const actionKeys = [
    'frontHandNormal',    // 左手
    'frontHandRight',     // 右手
    'backHand',           // 后手（右手的代理目标）
    'frontLayerBackHand', // 前层后手（右手的代理目标）
    'frontHandBoth',      // 前手双手
    'bothHands',          // 双手（双手的代理目标）
    'action'              // 动作
  ]

  // 用于去重的部件名称集合
  const addedActionParts = new Set()

  // 检查每个动作相关的key（使用与绿色小圆点相同的逻辑）
  actionKeys.forEach(key => {
    const selected = sources.selectedParts.value[key]
    // 只有当 selectedParts 不为 null/undefined 时才计入（与绿色小圆点逻辑一致）
    if (selected !== null && selected !== undefined) {
      // 提取部件名称（不添加前缀，由压缩函数统一处理）
      const names = Array.isArray(selected)
        ? selected.map(p => p?.name).filter(Boolean)
        : [selected?.name].filter(Boolean)

      // 添加到结果中（去重）
      names.forEach(name => {
        if (!addedActionParts.has(name)) {
          actionNames.push(name)
          addedActionParts.add(name)
        }
      })
    }
  })

  // ==================== 收集表情信息 ====================
  const expressionNames = []

  // 遍历所有动态表情标签页（使用与绿色小圆点相同的逻辑）
  if (sources.dynamicExpressionTabs.value && sources.dynamicExpressionTabs.value.length > 0) {
    sources.dynamicExpressionTabs.value.forEach(tab => {
      const expressionKey = tab.key
      const selectedExpression = sources.selectedParts.value[expressionKey]

      // 使用与绿色小圆点相同的逻辑：只检查 selectedParts 是否为 null/undefined
      // 只有当该表情图组有内容（绿色小圆点亮起）时才计入文件名
      if (selectedExpression !== null && selectedExpression !== undefined) {
        // 收集选中的表情名称
        if (Array.isArray(selectedExpression)) {
          selectedExpression.forEach(exp => {
            if (exp?.name) {
              expressionNames.push(exp.name)
            }
          })
        } else if (selectedExpression?.name) {
          expressionNames.push(selectedExpression.name)
        }
      }
    })
  }

  // 4、按选择的规则生成基础文件名并追加 PNG 扩展名
  const semanticInfo = {
    actions: actionNames,
    expressions: expressionNames
  }

  const baseFileName = generateExportFileName({
    namingRule: fileNamingRule,
    semanticInfo,
    psdName: psdBase
  })

  return `${baseFileName}.png`
}
