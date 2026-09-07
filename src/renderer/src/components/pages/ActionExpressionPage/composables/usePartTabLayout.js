/** 部件标签目录与编排：派生完整目录、分组存在性、默认行序，协调运行时拖动与重置。 */
import { computed, ref } from 'vue'
import { normalizeString } from '../utils/stringUtils.js'
import { getCustomGroupNames } from '../utils/psdClassifyUtils.js'

/**
 * 复用页面已有部件和 PSD 引用，仅持有标签排序与拖动状态。
 * 1、在原标签声明位置创建，所有传入 ref 均已初始化且不重新赋值。
 * 2、渲染内容由显式 getter 延迟读取，创建期间不求值 computed，不捕获页面后期声明。
 * 3、选择、渲染、单双击及会话监听仍归页面；会话复用返回的唯一 initialSorted 重置标记。
 */
export function usePartTabLayout({
  currentPsdData,
  frontHandNormalParts,
  frontHandRightParts,
  frontHandBothParts,
  backHandParts,
  frontLayerBackHandParts,
  bothHandsParts,
  upperBodyParts,
  lowerBodyParts,
  actionParts,
  dynamicExpressionTabs,
  dynamicExpressionParts,
  dynamicFrontHandTabs,
  dynamicFrontHandParts,
  dynamicBackHandTabs,
  dynamicBackHandParts,
  dynamicBothHandsTabs,
  dynamicBothHandsParts,
  dynamicUpperBodyParts,
  dynamicLowerBodyParts,
  dynamicActionParts,
  enhancedExpressionTabs,
  combinedExpressionParts,
  getHasRenderedContent,
  message
}) {
  // 标签页配置（手部图层使用代理机制，表情图组动态生成）
  const partTabs = computed(() => {

    // 预设标签页（放在最后面）
    const presetTab = [
      { key: 'presets', label: '预设', isPreset: true }
    ]

    // 模板标签页（动作模板和表情模板，放在预设后面）
    const templateTabs = [
      { key: 'template1', label: '动作模板', isTemplate: true, templateType: 'actionTemplate' },
      { key: 'template2', label: '表情模板', isTemplate: true, templateType: 'expressionTemplate' }
    ]

    const baseTabs = [
      { key: 'frontHandNormal', label: '左手' },
      { key: 'frontHandRight', label: '右手', proxyTargets: ['backHand', 'frontLayerBackHand'] },
      { key: 'frontHandBoth', label: '双手', proxyTargets: ['bothHands'] },
      { key: 'action', label: '动作' }
    ]

    // 动态添加前手标签页
    const frontHandDynamicTabs = dynamicFrontHandTabs.value.map(tab => ({
      key: tab.key,
      label: tab.label,
      groupType: 'frontHand',
      isDynamic: true
    }))

    // 动态添加后手标签页
    const backHandDynamicTabs = dynamicBackHandTabs.value.map(tab => ({
      key: tab.key,
      label: tab.label,
      groupType: 'backHand',
      isDynamic: true
    }))

    // 动态添加双手标签页
    const bothHandsDynamicTabs = dynamicBothHandsTabs.value.map(tab => ({
      key: tab.key,
      label: tab.label,
      groupType: 'bothHands',
      isDynamic: true
    }))

    // 动态添加表情标签页（使用增强后的元信息）
    const expressionTabs = enhancedExpressionTabs.value

    // 组合表情标签（放在所有表情标签的最前面）
    const combinedTab = combinedExpressionParts.value.length > 0
      ? [{ key: 'combinedExpressions', label: '组合表情', isExpression: true, isDynamic: true, isCombinedExpression: true, exprType: 'combined' }]
      : []

    const endTabs = [
      { key: 'upperBody', label: '上身' },
      { key: 'lowerBody', label: '下身' }
    ]

    // 注意：前手、后手、双手的动态标签已禁用，使用代理机制整合到基础标签
    // 注意：动作、上身、下身不支持多实例，始终显示基础标签
    return [
      ...baseTabs,              // 左手、右手、双手、动作等基础标签
      ...frontHandDynamicTabs,  // 已在解析阶段设为空数组
      ...backHandDynamicTabs,   // 已在解析阶段设为空数组
      ...bothHandsDynamicTabs,  // 已在解析阶段设为空数组
      ...combinedTab,           // 组合表情（优先显示在表情标签最前）
      ...expressionTabs,        // 表情标签
      ...endTabs,               // 上身、下身标签
      ...presetTab,             // 预设标签页在最后面
      ...templateTabs           // 动作模板和表情模板标签页在预设后面
    ]
  })

  // 收集所有部件列表（用于反向同步：图层树 → 部件选择）
  const allPartsListsMap = computed(() => {
    const map = {}

    // 静态分组
    map.frontHandNormal = frontHandNormalParts.value || []
    map.frontHandRight = frontHandRightParts.value || []
    map.frontHandBoth = frontHandBothParts.value || []
    map.backHand = backHandParts.value || []
    map.frontLayerBackHand = frontLayerBackHandParts.value || []
    map.bothHands = bothHandsParts.value || []
    map.upperBody = upperBodyParts.value || []
    map.lowerBody = lowerBodyParts.value || []
    map.action = actionParts.value || []

    // 动态分组
    Object.entries(dynamicExpressionParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicFrontHandParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicBackHandParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicBothHandsParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicUpperBodyParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicLowerBodyParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    Object.entries(dynamicActionParts.value || {}).forEach(([key, parts]) => {
      map[key] = parts
    })
    // 组合表情
    map.combinedExpressions = combinedExpressionParts.value || []

    return map
  })

  // 基于PSD是否存在图层组的映射
  const groupExistsMap = computed(() => {
    const rootLayers = currentPsdData.value?.layerHierarchy || []
    /**
     * 判断 PSD 是否存在指定名称的有效图组。
     * 处理流程：
     * 1、规范候选名称后深度遍历图层树，返回是否命中
     */
    const exists = (names) => {
      // 1、以候选名称集合检查原始图层层级
      // 使用normalizeString规范化配置名称（统一中英文标点符号）
      const targets = names.map(n => normalizeString(n))
      /**
       * 深度查找符合候选名称的图组。
       * 处理流程：
       * 1、检查当前节点名称及内容，未命中时递归子节点
       */
      const dfs = (layers) => {
        // 1、在当前层级与后代中寻找有效分组
        for (const layer of layers) {
          // 使用normalizeString规范化图层名称
          const lname = normalizeString(layer.name || '')
          if (targets.includes(lname)) return true
          if (layer.children && layer.children.length > 0) {
            if (dfs(layer.children)) return true
          }
        }
        return false
      }
      return dfs(rootLayers)
    }

    // 获取自定义图组名称配置
    const customGroupNames = getCustomGroupNames()

    // 前手分组存在性检查：只要前手图层组存在且有内容，三个子分组就都可用
    const hasFrontHand = exists(customGroupNames.frontHand)
    const hasBackHand = exists(customGroupNames.backHand)
    const hasBothHands = exists(customGroupNames.bothHands)
    const hasUpperBody = exists(customGroupNames.upperBody)
    const hasLowerBody = exists(customGroupNames.lowerBody)
    const hasAction = exists(customGroupNames.action)

    // 右手标签：前手-右手、后手、前层后手任一存在即可显示
    const hasRightHandContent = (hasFrontHand && frontHandRightParts.value.length > 0) ||
                                 hasBackHand ||
                                 frontLayerBackHandParts.value.length > 0

    // 双手标签：前手内的双手动作 或 独立的双手图层组 任一存在即可显示（代理模式）
    const hasBothHandContent = (hasFrontHand && frontHandBothParts.value.length > 0) ||
                                hasBothHands ||
                                bothHandsParts.value.length > 0

    const result = {
      presets: true, // 预设标签页始终存在
      template1: true, // 动作模板标签页始终存在
      template2: true, // 表情模板标签页始终存在
      frontHandNormal: hasFrontHand && frontHandNormalParts.value.length > 0,
      frontHandRight: hasRightHandContent,
      frontHandBoth: hasBothHandContent,
      backHand: false, // 后手已合并到右手，不再作为独立标签
      frontLayerBackHand: false, // 前层后手已合并到右手，不再作为独立标签
      bothHands: false, // 双手已合并到frontHandBoth，不再作为独立标签
      upperBody: hasUpperBody,
      lowerBody: hasLowerBody,
      action: hasAction
    }

    // 动态添加表情图组的存在性检查
    dynamicExpressionTabs.value.forEach(tab => {
      result[tab.key] = dynamicExpressionParts.value[tab.key]?.length > 0
    })
    // 组合表情存在性
    result['combinedExpressions'] = combinedExpressionParts.value.length > 0

    // 动态添加其他分组的存在性检查（仅前手、后手、双手，已禁用，保留代码兼容性）
    dynamicFrontHandTabs.value.forEach(tab => {
      result[tab.key] = dynamicFrontHandParts.value[tab.key]?.length > 0
    })
    dynamicBackHandTabs.value.forEach(tab => {
      result[tab.key] = dynamicBackHandParts.value[tab.key]?.length > 0
    })
    dynamicBothHandsTabs.value.forEach(tab => {
      result[tab.key] = dynamicBothHandsParts.value[tab.key]?.length > 0
    })
    // 注意：动作、上身、下身不支持动态标签，已移除

    return result
  })

  /**
   * 选择当前 PSD 的默认部件标签。
   * 处理流程：
   * 1、优先返回存在渲染内容的标签
   * 2、回退到存在分组的标签或默认前手标签
   */
  const getFirstDefaultTabKey = () => {
    // 1、按候选顺序优先检查当前可见内容，再回退可用分组
    // 优先选择有渲染内容的标签页（跳过图层结构、控制面板、预设和模板标签页）
    const firstWithContent = partTabs.value.find(tab =>
      !tab.isLayerTree && !tab.isCommonControls && !tab.isPreset && !tab.isTemplate && getHasRenderedContent()[tab.key]
    )
    if (firstWithContent) return firstWithContent.key

    // 选择第一个存在的分组（跳过图层结构、控制面板、预设和模板标签页）
    const firstExisting = partTabs.value.find(tab =>
      !tab.isLayerTree && !tab.isCommonControls && !tab.isPreset && !tab.isTemplate && groupExistsMap.value[tab.key]
    )
    if (firstExisting) return firstExisting.key

    // 默认选中左手
    return 'frontHandNormal'
  }

  // 过滤出可见的标签页：仅当PSD中存在该分组时显示
  //（不存在的分组完全隐藏；存在但无默认可见内容的分组仍显示，但无绿色小圆点）
  const visiblePartTabs = computed(() => {
    return partTabs.value.filter(tab => groupExistsMap.value[tab.key])
  })

  // ==================== 标签管理：拖拽排序、重置 ====================
  // 标签配置状态（运行时状态，不持久化）
  const tabConfig = ref({
    customOrder: null // 自定义排序数组，null表示使用默认排序
  })

  // 标签初始化排序标记（运行时状态，不持久化）
  const initialSorted = ref(false)

  // 标签初始化排序缓存（运行时状态，不持久化）
  const initialTabOrder = ref({
    row1: null,
    row2: null
  })

  /**
   * 恢复标签的默认排序。
   * 处理流程：
   * 1、清除自定义顺序及首次排序缓存
   * 2、根据原有排序状态反馈结果
   */
  const resetTabConfig = () => {
    // 1、清空运行时排序信息，让计算属性重新建立默认顺序
    const hadCustomOrder = tabConfig.value.customOrder !== null

    tabConfig.value = {
      customOrder: null
    }
    // 清除缓存和排序标记，强制重新计算排序
    initialSorted.value = false
    initialTabOrder.value = {
      row1: null,
      row2: null
    }

    // 2、区分实际重置和原本已经使用默认顺序
    if (hadCustomOrder) {
      message.success('标签排序已重置')
    } else {
      message.info('标签已是默认排序')
    }
  }

  /**
   * 保存当前页面的标签自定义顺序。
   * 处理流程：
   * 1、将标签键数组写入运行时配置
   */
  const setCustomOrder = (orderedKeys) => {
    // 1、顺序仅保存在当前页面状态中
    tabConfig.value.customOrder = orderedKeys
  }

  // 拖拽相关状态
  const draggedTabKey = ref(null)
  const dragOverTabKey = ref(null)
  const dropPosition = ref(null) // 'before' 或 'after'

  /**
   * 开始拖动部件标签。
   * 处理流程：
   * 1、记录来源标签并声明移动数据
   * 2、降低来源元素透明度作为拖拽反馈
   */
  const handleTabDragStart = (event, tabKey) => {
    // 1、记录本次标签拖拽来源
    draggedTabKey.value = tabKey
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', tabKey)
    // 2、添加视觉反馈
    event.target.style.opacity = '0.5'
  }

  /**
   * 结束标签拖拽并清理反馈。
   * 处理流程：
   * 1、恢复透明度并清空来源、目标与插入位置
   */
  const handleTabDragEnd = (event) => {
    // 1、成功放置或取消拖拽都执行相同清理
    event.target.style.opacity = '1'
    draggedTabKey.value = null
    dragOverTabKey.value = null
    dropPosition.value = null
  }

  /**
   * 更新标签上的拖拽插入提示。
   * 处理流程：
   * 1、允许移动并记录目标标签
   * 2、按鼠标位于目标左右半区决定前插或后插
   */
  const handleTabDragOver = (event, tabKey) => {
    // 1、允许放置到当前标签
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    dragOverTabKey.value = tabKey

    // 2、计算鼠标相对于目标元素的位置
    const rect = event.currentTarget.getBoundingClientRect()
    const mouseX = event.clientX
    const elementCenterX = rect.left + rect.width / 2

    // 如果鼠标在元素左半部分，插入到之前；否则插入到之后
    dropPosition.value = mouseX < elementCenterX ? 'before' : 'after'
  }

  /**
   * 清除离开标签后的插入提示。
   * 处理流程：
   * 1、清空目标标签和插入位置
   */
  const handleTabDragLeave = () => {
    // 1、保留来源拖拽状态，仅清理悬停反馈
    dragOverTabKey.value = null
    dropPosition.value = null
  }

  /**
   * 将拖动标签插入目标标签前后。
   * 处理流程：
   * 1、校验来源并取得当前顺序
   * 2、移除来源后按插入方向重新插入
   * 3、保存排序并清理目标提示
   */
  const handleTabDrop = (event, targetTabKey) => {
    // 1、忽略无来源和放置回自身的情况
    event.preventDefault()

    if (!draggedTabKey.value || draggedTabKey.value === targetTabKey) {
      return
    }

    // 获取当前所有标签（合并两行）
    const allTabs = [...categorizedTabs.value.row1Tabs, ...categorizedTabs.value.row2Tabs]
    const allKeys = allTabs.map(t => t.key)

    // 如果没有自定义排序，使用当前排序初始化
    const currentOrder = tabConfig.value.customOrder || allKeys

    // 2、先移除来源标签，避免插入后出现重复项
    const newOrder = currentOrder.filter(key => key !== draggedTabKey.value)

    // 找到目标位置
    const targetIndex = newOrder.indexOf(targetTabKey)

    // 根据dropPosition决定插入位置
    if (dropPosition.value === 'before') {
      // 插入到目标之前
      newOrder.splice(targetIndex, 0, draggedTabKey.value)
    } else {
      // 插入到目标之后
      newOrder.splice(targetIndex + 1, 0, draggedTabKey.value)
    }

    // 3、保存新顺序并清理目标提示
    setCustomOrder(newOrder)

    dragOverTabKey.value = null
    dropPosition.value = null
  }

  /**
   * 更新标签行空白区域的拖拽提示。
   * 处理流程：
   * 1、排除由标签自身处理的事件
   * 2、按鼠标位置选择该行开头或末尾
   */
  const handleContainerDragOver = (event, rowType) => {
    // 1、如果拖拽经过的是标签按钮，交给标签自身处理
    if (event.target.classList.contains('part-tab')) {
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'

    // 2、获取容器位置并判断应放在行首还是行尾
    const rect = event.currentTarget.getBoundingClientRect()
    const mouseX = event.clientX
    const containerCenterX = rect.left + rect.width / 2

    // 根据鼠标位置决定插入到最前面还是最后面
    dropPosition.value = mouseX < containerCenterX ? 'first' : 'last'
    dragOverTabKey.value = `container-${rowType}`
  }

  /**
   * 将拖动标签放到指定行的开头或末尾。
   * 处理流程：
   * 1、过滤标签事件并检查拖拽来源
   * 2、移除来源，按目标行边界重新插入
   * 3、保存顺序并清理插入提示
   */
  const handleContainerDrop = (event, rowType) => {
    // 1、如果放置目标是标签按钮，交给标签自身处理
    if (event.target.classList.contains('part-tab')) {
      return
    }

    event.preventDefault()

    if (!draggedTabKey.value) {
      return
    }

    // 获取当前所有标签
    const allTabs = [...categorizedTabs.value.row1Tabs, ...categorizedTabs.value.row2Tabs]
    const allKeys = allTabs.map(t => t.key)

    // 如果没有自定义排序，使用当前排序初始化
    const currentOrder = tabConfig.value.customOrder || allKeys

    // 移除拖拽的标签
    const newOrder = currentOrder.filter(key => key !== draggedTabKey.value)

    // 2、获取对应行的标签，选择行首、行尾或空行落点
    const rowTabs = rowType === 'row1' ? categorizedTabs.value.row1Tabs : categorizedTabs.value.row2Tabs

    if (rowTabs.length === 0) {
      // 如果该行没有标签，直接添加到末尾
      newOrder.push(draggedTabKey.value)
    } else if (dropPosition.value === 'first') {
      // 插入到该行第一个标签之前
      const firstTabKey = rowTabs[0].key
      const firstIndex = newOrder.indexOf(firstTabKey)
      newOrder.splice(firstIndex, 0, draggedTabKey.value)
    } else {
      // 插入到该行最后一个标签之后
      const lastTabKey = rowTabs[rowTabs.length - 1].key
      const lastIndex = newOrder.indexOf(lastTabKey)
      newOrder.splice(lastIndex + 1, 0, draggedTabKey.value)
    }

    // 3、保存新顺序并清理插入提示
    setCustomOrder(newOrder)

    dragOverTabKey.value = null
    dropPosition.value = null
  }

  // 将可见标签页分类为2行
  const categorizedTabs = computed(() => {
    const tabs = visiblePartTabs.value

    // 如果没有标签，返回空数组
    if (tabs.length === 0) {
      return {
        row1Tabs: [],
        row2Tabs: []
      }
    }

    // 如果已经有缓存且缓存中有数据，使用缓存（避免闪烁）
    if (initialSorted.value && initialTabOrder.value.row1 && initialTabOrder.value.row1.length > 0) {
      // 使用缓存的顺序，只应用隐藏和自定义拖拽排序
      let row1Tabs = initialTabOrder.value.row1.filter(tab => tabs.some(t => t.key === tab.key))
      let row2Tabs = initialTabOrder.value.row2.filter(tab => tabs.some(t => t.key === tab.key))

      // 应用自定义排序
      if (tabConfig.value.customOrder && tabConfig.value.customOrder.length > 0) {
        const customOrder = tabConfig.value.customOrder
        /**
         * 按用户顺序重排已缓存的一行标签。
         * 处理流程：
         * 1、有自定义位置的标签优先，未配置标签保持相对顺序
         */
        const sortByCustomOrder = (tabsArray) => {
          // 1、复制数组后排序，避免改变首次排序缓存
          return [...tabsArray].sort((a, b) => {
            const aIndex = customOrder.indexOf(a.key)
            const bIndex = customOrder.indexOf(b.key)

            if (aIndex !== -1 && bIndex !== -1) {
              return aIndex - bIndex
            }
            if (aIndex !== -1) return -1
            if (bIndex !== -1) return 1
            return 0
          })
        }

        row1Tabs = sortByCustomOrder(row1Tabs)
        row2Tabs = sortByCustomOrder(row2Tabs)
      }

      return {
        row1Tabs,
        row2Tabs
      }
    }

    // 首次初始化：进行智能排序
    // 新的分行逻辑：
    // 第1行：动作表情相关标签（手部、动作、表情、组合表情）
    // 第2行：模板、预设、上身下身、控制面板、图层结构

    /**
     * 判断标签是否属于上下身分类。
     * 处理流程：
     * 1、匹配上身或下身标签键
     */
    const isUpperLower = (t) => t.key === 'upperBody' || t.key === 'lowerBody'
    /**
     * 判断标签是否属于手部分类。
     * 处理流程：
     * 1、结合分组类型与固定手部键识别手部标签
     */
    const isHand = (t) => t.groupType === 'frontHand' || t.groupType === 'backHand' || t.groupType === 'bothHands' ||
      ['frontHandNormal','frontHandRight','frontHandBoth','backHand','frontLayerBackHand','bothHands'].includes(t.key)
    /**
     * 判断标签是否属于动作表情区域。
     * 处理流程：
     * 1、合并表情、组合表情、手部和动作的分类条件
     */
    const isActionExpression = (t) => t.isExpression || t.isCombinedExpression || t.key === 'combinedExpressions' || isHand(t) || t.key === 'action'

    const expressions = tabs.filter(t => t.isExpression && t.key !== 'combinedExpressions')
    const combinedExpr = tabs.filter(t => t.key === 'combinedExpressions' || t.isCombinedExpression)
    const handAndAction = tabs.filter(t => isHand(t) || t.key === 'action')
    const presets = tabs.filter(t => t.isPreset)
    const templates = tabs.filter(t => t.isTemplate)
    const uppersLowers = tabs.filter(isUpperLower)
    const specials = tabs.filter(t => t.isCommonControls || t.isLayerTree)
    const alreadyUsed = new Set([...handAndAction, ...combinedExpr, ...expressions, ...presets, ...templates, ...uppersLowers, ...specials].map(t => t.key))
    const others = tabs.filter(t => !alreadyUsed.has(t.key))

    // 第1行：动作表情相关标签
    // 手部标签（左手、右手、双手）始终固定在开头，不参与排序
    const handTabs = handAndAction

    // 其他动作表情标签（组合表情、普通表情）按绿色小圆点排序
    const otherActionExpressionTabs = [...combinedExpr, ...expressions]
    const row1WithContent = otherActionExpressionTabs.filter(t => getHasRenderedContent()[t.key])
    const row1WithoutContent = otherActionExpressionTabs.filter(t => !getHasRenderedContent()[t.key])

    // 拼接：手部标签始终在前 + 有内容的其他标签 + 无内容的其他标签
    let row1Tabs = [...handTabs, ...row1WithContent, ...row1WithoutContent]

    // 第2行：模板 -> 预设 -> 上身下身 -> 其他 -> 控制面板/图层
    let row2Tabs = [...templates, ...presets, ...uppersLowers, ...others, ...specials]

    // 如果有自定义排序，应用自定义排序
    if (tabConfig.value.customOrder && tabConfig.value.customOrder.length > 0) {
      const customOrder = tabConfig.value.customOrder
      /**
       * 对首次生成的标签行应用用户排序。
       * 处理流程：
       * 1、按自定义键位置比较，未配置标签保持相对顺序
       */
      const sortByCustomOrder = (tabsArray) => {
        // 1、复制数组后应用排序，不改变原始分类结果
        return [...tabsArray].sort((a, b) => {
          const aIndex = customOrder.indexOf(a.key)
          const bIndex = customOrder.indexOf(b.key)

          // 如果两个都在自定义排序中，按自定义顺序
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex
          }
          // 如果只有a在自定义排序中，a排前面
          if (aIndex !== -1) return -1
          // 如果只有b在自定义排序中，b排前面
          if (bIndex !== -1) return 1
          // 都不在自定义排序中，保持原顺序
          return 0
        })
      }

      row1Tabs = sortByCustomOrder(row1Tabs)
      row2Tabs = sortByCustomOrder(row2Tabs)
    }

    // 只在有标签时才缓存和标记（避免缓存空数据）
    if (row1Tabs.length > 0 || row2Tabs.length > 0) {
      initialTabOrder.value = {
        row1: row1Tabs,
        row2: row2Tabs
      }
      initialSorted.value = true
    }

    return {
      row1Tabs,  // 第1行：动作表情
      row2Tabs   // 第2行：模板、预设、上身下身等
    }
  })

  return {
    partTabs,
    allPartsListsMap,
    getFirstDefaultTabKey,
    initialSorted,
    resetTabConfig,
    dragOverTabKey,
    dropPosition,
    handleTabDragStart,
    handleTabDragEnd,
    handleTabDragOver,
    handleTabDragLeave,
    handleTabDrop,
    handleContainerDragOver,
    handleContainerDrop,
    categorizedTabs
  }
}
