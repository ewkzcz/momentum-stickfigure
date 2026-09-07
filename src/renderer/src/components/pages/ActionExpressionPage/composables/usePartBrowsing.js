/** 当前部件浏览派生：从用户可见图层推导选中、标签内容、代理列表及虚拟列表切片。 */
import { computed, nextTick } from 'vue'

/**
 * 在页面原可见列表位置创建，仅声明惰性派生与选中判断，不注册 watch 或生命周期。
 * 1、部件状态、表情映射与当前标签复用原 ref，图层树多选不参与 selectedParts。
 * 2、图层树会替换占位；目录、预设、模板及用户操作标记稍后声明，getter 只在原读点调用。
 * 3、标签目录只经 partTabs/allPartsListsMap 读取，不调用默认排序；避免和 usePartTabLayout 形成求值环。
 */
export function usePartBrowsing({
  currentTab, currentPsdData, perfLogger, partItemSize, partItemSizeInput,
  frontHandNormalParts, frontHandRightParts, frontHandBothParts, backHandParts,
  frontLayerBackHandParts, bothHandsParts, upperBodyParts, lowerBodyParts, actionParts,
  dynamicExpressionTabs, dynamicExpressionParts, dynamicFrontHandTabs, dynamicFrontHandParts,
  dynamicBackHandTabs, dynamicBackHandParts, dynamicBothHandsTabs, dynamicBothHandsParts,
  combinedExpressionParts, combinedThumbnailsMap, getComboSignature,
  getLayerTreeData, getAllPartsListsMap, getPartTabs, getUserInteracted, getVirtualScroll,
  getPresets, getSelectedPresetId, getTemplates1, getTemplates2, getSelectedTemplate1Id, getSelectedTemplate2Id
}) {
  /**
   * 提交部件尺寸输入值。
   * 处理流程：
   * 1、将输入限制在允许范围，无效数字回退默认值
   * 2、同步实际尺寸与输入框值
   */
  const handleSizeInputConfirm = () => {
    // 1、按现有范围校正输入值
    let value = partItemSizeInput.value
    // 确保值在有效范围内
    if (value < 50) value = 50
    if (value > 400) value = 400
    if (isNaN(value)) value = 85

    // 2、保持输入框与部件尺寸一致
    partItemSize.value = value
    partItemSizeInput.value = value
  }

  // 虚拟滚动的可见部件列表
  const visiblePartsList = computed(() => {
    const allParts = currentPartsList.value
    const { start, end } = getVirtualScroll().getVisibleRange()
    return allParts.slice(start, end).map((part, index) => ({
      ...part,
      _virtualIndex: start + index,
      _absoluteIndex: start + index
    }))
  })

  // 每个分组当前显示的部件（计算属性，从图层树userVisible状态推导）
  const selectedParts = computed(() => {
    const measurement = perfLogger.start('selectedParts:compute', { threshold: 12 })
    let layerNodesVisited = 0
    let matchedPartsCount = 0

    // 收集当前图层树中所有用户设置为可见的图层路径（不包括正面控制的影响）
    const visibleLayerPaths = new Set()
    /**
     * 收集用户主动设为可见的图层路径。
     * 处理流程：
     * 1、递归遍历节点，将用户可见路径加入集合并累计访问量
     */
    const collectVisiblePaths = (layers, currentPath = []) => {
      // 1、沿唯一名称拼接路径，避免通用控制覆盖用户选择状态
      if (!Array.isArray(layers)) return
      for (let layer of layers) {
        layerNodesVisited++
        const fullPath = [...currentPath, layer.uniqueName].join('/')
        // 使用userVisible而不是visible，避免正面控制影响绿色小圆点
        if (layer.userVisible) {
          visibleLayerPaths.add(fullPath)
        }
        if (layer.children && layer.children.length > 0) {
          collectVisiblePaths(layer.children, [...currentPath, layer.uniqueName])
        }
      }
    }
    collectVisiblePaths(getLayerTreeData().value)

    // 从可见路径中匹配部件（支持多选）
    const result = {}
    const allGroups = Object.entries(getAllPartsListsMap().value)
    allGroups.forEach(([groupKey, partsList]) => {
      const matchedParts = []
      for (let part of partsList || []) {
        if (part && part.path && visibleLayerPaths.has(part.path)) {
          matchedParts.push(part)
        }
      }
      matchedPartsCount += matchedParts.length
      // 如果只有一个匹配，保存为单个对象（兼容旧逻辑）
      // 如果有多个匹配，保存为数组
      if (matchedParts.length === 1) {
        result[groupKey] = matchedParts[0]
      } else if (matchedParts.length > 1) {
        result[groupKey] = matchedParts
      } else {
        result[groupKey] = null
      }
    })

    measurement.end({
      nodesVisited: layerNodesVisited,
      groups: allGroups.length,
      matchedParts: matchedPartsCount
    })
    return result
  })

  // 计算当前分组选中的部件
  const selectedPart = computed(() => selectedParts.value[currentTab.value])

  /**
   * 判断部件是否应呈现选中状态。
   * 处理流程：
   * 1、组合表情检查其全部子项是否匹配
   * 2、根据代理来源读取用户选择，未操作时沿用初始可见状态
   */
  const isPartActive = (part) => {
    // 1、组合表情包含的所有子项均匹配时视为激活
    if (part && part.isCombined && Array.isArray(part.items)) {
      return part.items.every(({ groupKey, part: p }) => {
        const sel = selectedParts.value[groupKey]
        return sel && sel.path === p.path
      })
    }

    // 2、根据代理来源确定实际分组，并区分用户操作与默认状态
    const actualGroup = part._sourceGroup || currentTab.value
    const currentSelected = selectedParts.value[actualGroup]
    const hasInteracted = getUserInteracted().value[actualGroup]

    // 如果用户进行过手动操作
    if (hasInteracted) {
      // 只显示用户手动选中的图层
      if (!currentSelected) return false
      if (Array.isArray(currentSelected)) {
        return currentSelected.some(p => p.path === part.path)
      }
      return currentSelected.path === part.path
    }

    // 如果用户没有进行过手动操作，显示默认可见的图层
    return !part.hidden
  }

  // 判断某个图组是否有渲染内容（从图层树visible状态判断）
  const hasRenderedContent = computed(() => {
    const result = {}
    getPartTabs().value.forEach(tab => {
      // 图层结构标签页：不显示绿色小圆点
      if (tab.isLayerTree) {
        result[tab.key] = false
        return
      }

      // 控制面板标签页：始终不显示绿色小圆点
      if (tab.isCommonControls) {
        result[tab.key] = false
        return
      }

      // 预设标签页：有预设且有选中的预设时显示绿色小圆点
      if (tab.isPreset) {
        result[tab.key] = getPresets().value.length > 0 && getSelectedPresetId().value !== null
        return
      }

      // 模板标签页：有对应模板且有选中时显示绿色小圆点
      if (tab.isTemplate) {
        if (tab.key === 'template1') {
          result[tab.key] = getTemplates1().value.length > 0 && getSelectedTemplate1Id().value !== null
        } else if (tab.key === 'template2') {
          result[tab.key] = getTemplates2().value.length > 0 && getSelectedTemplate2Id().value !== null
        }
        return
      }

      // 检查该分组是否有显示的部件（从selectedParts计算属性读取）
      const selected = selectedParts.value[tab.key]
      let mainHasContent = selected !== null && selected !== undefined

      // 检查代理目标是否有内容
      let proxyHasContent = false
      if (tab.proxyTargets && tab.proxyTargets.length > 0) {
        proxyHasContent = tab.proxyTargets.some(proxyTarget => {
          const proxySelected = selectedParts.value[proxyTarget]
          return proxySelected !== null && proxySelected !== undefined
        })
      }

      // 只要主分组或代理目标有内容，就显示绿点
      result[tab.key] = mainHasContent || proxyHasContent
    })
    return result
  })

  // 当前标签页的部件列表（支持代理机制合并）
  const currentPartsList = computed(() => {
    const currentTabKey = currentTab.value

    // 查找当前标签页配置
    const currentTabConfig = getPartTabs().value.find(tab => tab.key === currentTabKey)

    // 获取基础图层列表
    let baseParts = []
    let proxyParts = []

    // 先检查是否是动态表情图组
    if (currentTabConfig?.isExpression && dynamicExpressionParts.value[currentTabKey]) {
      baseParts = dynamicExpressionParts.value[currentTabKey]
    }
    // 组合表情
    else if (currentTabKey === 'combinedExpressions') {
      // 为组合表情注入合成缩略图
      baseParts = (combinedExpressionParts.value || []).map(item => {
        const sig = getComboSignature(item.items || [])
        const thumb = combinedThumbnailsMap.value.get(sig) || item.thumbnail || null
        return { ...item, thumbnail: thumb }
      })
    }
    // 检查是否是动态分组（只检查动态标签，基础标签走 switch）
    // 注意：仅前手、后手、双手支持动态分组（已禁用），动作、上身、下身不支持
    else if (currentTabConfig?.isDynamic) {
      // 动态分组根据 groupType 获取对应数据
      if (currentTabConfig.groupType === 'frontHand' && dynamicFrontHandParts.value[currentTabKey]) {
        baseParts = dynamicFrontHandParts.value[currentTabKey]
      }
      else if (currentTabConfig.groupType === 'backHand' && dynamicBackHandParts.value[currentTabKey]) {
        baseParts = dynamicBackHandParts.value[currentTabKey]
      }
      else if (currentTabConfig.groupType === 'bothHands' && dynamicBothHandsParts.value[currentTabKey]) {
        baseParts = dynamicBothHandsParts.value[currentTabKey]
      }
    }
    else {
      // 否则使用固定的switch分支
      switch (currentTabKey) {
        case 'frontHandNormal':
          baseParts = frontHandNormalParts.value
          break
        case 'frontHandRight':
          // 前手右手 + 后手 + 前层后手 = 右手（代理机制，支持多个数据源）
          baseParts = frontHandRightParts.value.map(part => ({
            ...part,
            displayName: `前手-${part.name}`,
            _sourceGroup: 'frontHandRight'
          }))
          // 合并所有代理目标的部件
          if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
            currentTabConfig.proxyTargets.forEach(proxyTarget => {
              let targetParts = []
              let targetLabel = ''

              switch (proxyTarget) {
                case 'backHand':
                  targetParts = backHandParts.value
                  targetLabel = '后手'
                  break
                case 'frontLayerBackHand':
                  targetParts = frontLayerBackHandParts.value
                  targetLabel = '前层后手'
                  break
              }

              const mappedParts = targetParts.map(part => ({
                ...part,
                displayName: `${targetLabel}-${part.name}`,
                _sourceGroup: proxyTarget
              }))

              proxyParts = proxyParts.concat(mappedParts)
            })
          }
          break
        case 'frontHandBoth':
          // 前手双手 + 双手 = 双手（代理机制）
          baseParts = frontHandBothParts.value.map(part => ({
            ...part,
            displayName: `前手-${part.name}`,
            _sourceGroup: 'frontHandBoth'
          }))
          // 合并所有代理目标的部件
          if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
            currentTabConfig.proxyTargets.forEach(proxyTarget => {
              if (proxyTarget === 'bothHands') {
                const mappedParts = bothHandsParts.value.map(part => ({
                  ...part,
                  displayName: `双手-${part.name}`,
                  _sourceGroup: 'bothHands'
                }))
                proxyParts = proxyParts.concat(mappedParts)
              }
            })
          }
          break
        case 'backHand':
          baseParts = backHandParts.value
          break
        case 'frontLayerBackHand':
          baseParts = frontLayerBackHandParts.value
          break
        case 'bothHands':
          baseParts = bothHandsParts.value
          break
        case 'upperBody':
          baseParts = upperBodyParts.value
          break
        case 'lowerBody':
          baseParts = lowerBodyParts.value
          break
        case 'action':
          baseParts = actionParts.value
          break
        default:
          baseParts = []
      }
    }

    // 合并基础图层和代理图层
    const result = [...baseParts, ...proxyParts]

    // 同步虚拟滚动的总项目数
    nextTick(() => {
      getVirtualScroll().totalItems.value = result.length
    })

    return result
  })

  // 空状态文本
  const emptyStateText = computed(() => {
    if (!currentPsdData.value) {
      return '请先上传PSD文件'
    }

    // 先查找是否是动态表情图组
    const expressionTab = dynamicExpressionTabs.value.find(tab => tab.key === currentTab.value)
    if (expressionTab) {
      return `暂无${expressionTab.label}部件`
    }
    if (currentTab.value === 'combinedExpressions') {
      return '暂无可组合的表情（眉/眼/嘴）'
    }

    // 查找其他动态分组（仅前手、后手、双手，已禁用，保留代码兼容性）
    const allDynamicTabs = [
      ...dynamicFrontHandTabs.value,
      ...dynamicBackHandTabs.value,
      ...dynamicBothHandsTabs.value
      // 注意：动作、上身、下身不支持动态标签，已移除
    ]
    const dynamicTab = allDynamicTabs.find(tab => tab.key === currentTab.value)
    if (dynamicTab) {
      return `暂无${dynamicTab.label}部件`
    }

    // 否则使用固定的映射表
    const tabNames = {
      frontHandNormal: '左手',
      frontHandRight: '右手',
      frontHandBoth: '双手',
      backHand: '右手',
      frontLayerBackHand: '右手',
      bothHands: '双手',
      upperBody: '上身',
      lowerBody: '下身',
      action: '动作'
    }
    return `暂无${tabNames[currentTab.value] || ''}部件`
  })

  return { handleSizeInputConfirm, visiblePartsList, selectedParts, selectedPart, isPartActive, hasRenderedContent, currentPartsList, emptyStateText }
}
