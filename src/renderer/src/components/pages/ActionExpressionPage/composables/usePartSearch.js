/** 部件搜索定位与确认：持有搜索展示状态，按原时机切换标签、滚动、高亮及调用选择入口。 */
import { ref, computed, nextTick } from 'vue'

/**
 * 在页面原搜索位置创建，不注册监听或生命周期。
 * 1、已就绪的状态复用原 ref；晚声明列表、标签、预设以及晚赋值渲染入口逐项延迟读取。
 * 2、创建期间仅声明空状态与惰性 computed，不调用 getter，不复制部件或选择状态。
 * 3、搜索输入及单双击识别仍由搜索弹窗负责；此处只保留原数据投影和确认流程。
 */
export function usePartSearch({
  currentPsdData, currentTab, partsListRef, partItemSize, message,
  actionParts, upperBodyParts, lowerBodyParts, dynamicExpressionTabs, dynamicExpressionParts,
  frontHandNormalParts, frontHandRightParts, backHandParts, frontLayerBackHandParts,
  frontHandBothParts, bothHandsParts,
  getPresets, getPartTabs, getSelectedPresetId, getRenderAllLayers, getSelectPart, getCurrentPartsList
}) {
  // 搜索对话框显示状态
  const showSearchModal = ref(false)
  // 高亮显示的部件路径
  const highlightedPartPath = ref(null)
  // 标记是否是搜索触发的标签切换（避免触发不必要的UI交互）
  const isSearchTriggeredSwitch = ref(false)
  // 搜索对话框组件引用
  const searchModalRef = ref(null)

  /**
   * 打开部件搜索对话框。
   * 处理流程：
   * 1、检查 PSD 是否已经载入
   * 2、已打开时重置窗口位置，否则显示搜索框
   */
  const openSearchModal = () => {
    // 1、搜索依赖当前 PSD 的部件列表
    if (!currentPsdData.value) {
      message.warning('请先上传PSD文件')
      return
    }

    // 2、如果对话框已经打开，重置位置到可见区域
    if (showSearchModal.value && searchModalRef.value) {
      searchModalRef.value.resetPosition()
      console.log('🔍 对话框已打开，重置位置到可见区域')
    } else {
      // 否则打开对话框（会自动触发位置重置）
      showSearchModal.value = true
    }
  }

  // 所有部件数据（用于搜索）
  const allPartsForSearch = computed(() => {
    const parts = {
      action: actionParts.value,
      upperBody: upperBodyParts.value,
      lowerBody: lowerBodyParts.value,
      presets: getPresets().value
    }

    // 添加所有表情图组
    dynamicExpressionTabs.value.forEach(tab => {
      parts[tab.key] = dynamicExpressionParts.value[tab.key] || []
    })

    return parts
  })

  // 手部部件数据（用于搜索动作时的代理支持）
  const handPartsForSearch = computed(() => {
    return {
      frontHandNormal: frontHandNormalParts.value,
      frontHandRight: [
        ...frontHandRightParts.value,
        ...backHandParts.value,
        ...frontLayerBackHandParts.value
      ],
      frontHandBoth: [
        ...frontHandBothParts.value,
        ...bothHandsParts.value
      ]
    }
  })

  // 原始手部部件数据（用于搜索时准确判断 part 的来源）
  const originalHandPartsForSearch = computed(() => {
    return {
      frontHandNormal: frontHandNormalParts.value,
      frontHandRight: frontHandRightParts.value,
      backHand: backHandParts.value,
      frontLayerBackHand: frontLayerBackHandParts.value,
      frontHandBoth: frontHandBothParts.value,
      bothHands: bothHandsParts.value
    }
  })

  /**
   * 定位搜索结果对应的预设或部件。
   * 处理流程：
   * 1、校验目标标签并处理预设分支
   * 2、标记搜索切换，等待标签视图更新
   * 3、高亮并滚动到目标部件，延时清除高亮
   */
  const handleSearchResult = async (result) => {
    // 1、忽略空结果和不能显示部件的特殊标签
    if (!result) return

    console.log('🔍 搜索结果:', result)

    // 确保不会切换到通用控制或图层结构
    const tabKey = result.tabKey
    const tabConfig = getPartTabs().value.find(tab => tab.key === tabKey)

    if (tabConfig?.isCommonControls || tabConfig?.isLayerTree) {
      console.warn('⚠️ 搜索结果指向特殊标签页，已忽略')
      message.warning('搜索结果无法显示')
      return
    }

    // 预设特殊处理
    if (tabKey === 'presets') {
      currentTab.value = 'presets'
      await nextTick()
      // 选中预设
      if (result.part.id) {
        getSelectedPresetId().value = result.part.id
        await getRenderAllLayers()()
      }
      message.success(`已定位到预设：${result.part.displayName || result.part.name}`)
      return
    }

    // 2、设置搜索触发标志，防止触发不必要的界面交互
    isSearchTriggeredSwitch.value = true

    // 直接设置标签页（不触发handleTabClick，避免触发区域展开）
    currentTab.value = tabKey

    // 等待DOM更新
    await nextTick()

    // 重置搜索标志（在nextTick之后，确保watch已执行）
    setTimeout(() => {
      isSearchTriggeredSwitch.value = false
    }, 100)

    // 3、高亮显示目标部件，并滚动到列表中的对应位置
    if (result.part.path) {
      highlightedPartPath.value = result.part.path
    }

    // 滚动到目标部件位置
    await scrollToPartInList(result.part)

    // 9秒后取消高亮（延长到3倍）
    setTimeout(() => {
      highlightedPartPath.value = null
    }, 9000)

    message.success(`已定位到：${result.tabLabel} - ${result.part.displayName || result.part.name}`)
  }

  /**
   * 确认搜索结果并应用部件，对话框的关闭由子组件处理。
   * 处理流程：
   * 1、定位搜索结果并等待视图更新
   * 2、延迟应用部件，让高亮和滚动先完成
   */
  const handleSearchResultConfirm = async (result) => {
    // 1、先完成标签切换与结果定位
    if (!result) return

    console.log('🔍 搜索结果确认应用:', result)

    // 先执行定位逻辑（切换标签页、高亮、滚动到目标位置）
    await handleSearchResult(result)

    // 等待DOM更新后应用部件
    await nextTick()

    // 2、延迟一小段时间确保高亮和滚动完成
    setTimeout(async () => {
      // 应用部件（实际修改图层显示状态）
      await getSelectPart()(result.part)
      message.success(`已应用：${result.part.displayName || result.part.name}`)
    }, 200)
  }

  /**
   * 滚动到目标部件在列表中的位置。
   * 处理流程：
   * 1、等待列表更新并查找目标索引
   * 2、根据部件高度估算滚动距离并保留顶部余量
   */
  const scrollToPartInList = async (targetPart) => {
    // 1、检查列表容器并取得当前目标索引
    if (!partsListRef.value || !targetPart) return

    await nextTick()

    // 获取当前部件列表
    const partsList = getCurrentPartsList().value
    const targetIndex = partsList.findIndex(p => p.path === targetPart.path)

    if (targetIndex === -1) {
      console.warn('未在当前列表中找到目标部件')
      return
    }

    // 2、计算目标部件的位置并应用滚动偏移
    const itemHeight = partItemSize.value + 16 // 部件高度 + gap
    const targetScrollTop = targetIndex * itemHeight

    // 滚动到目标位置（留一些余量）
    partsListRef.value.scrollTop = Math.max(0, targetScrollTop - 100)
  }

  return {
    showSearchModal, highlightedPartPath, isSearchTriggeredSwitch, searchModalRef,
    openSearchModal, allPartsForSearch, handPartsForSearch, originalHandPartsForSearch,
    handleSearchResultConfirm
  }
}
