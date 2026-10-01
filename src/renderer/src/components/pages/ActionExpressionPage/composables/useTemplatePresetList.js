/**
 * 模板与预设列表交互控制。
 * 职责：管理多选、右键详情、同类型模板排序、删除和重命名，以及保存入口协调。
 * 业务数组和单项选中、编辑引用仍由 useTemplateData、usePresetData 唯一持有。
 * 本模块仅创建原列表的多选集合、菜单及拖动状态，不创建业务数据副本或注册生命周期。
 */
import { ref, reactive, computed, h, nextTick } from 'vue'

/**
 * 接入模板与预设列表的原始依赖。
 * 处理流程：
 * 1、依赖全部初始化后接收原引用，保留保存、应用和绘图调用的原始时序
 * 2、创建列表局部状态并定义原交互流程
 * 3、仅向页面返回仍被使用的原始绑定
 */
export function useTemplatePresetList({
  selectedParts,
  handleSavePresetOriginal,
  templates1,
  templates2,
  templates,
  activeTemplateType,
  editingTemplate1Id,
  editingTemplate2Id,
  currentTab,
  message,
  dialog,
  saveTemplates,
  deleteTemplate,
  confirmDeleteTemplate,
  renameTemplateFunc,
  selectPreset,
  deletePreset,
  applyTemplateById,
  handleSaveTemplateOriginal,
  generateTemplatePreviewBase64,
  renderTemplatePreview,
  isAddingTemplate
}) {
  // 1、保存入口直接使用原部件引用和原数据模块，不改变快照与落盘时序。
  /**
   * 保存包含当前部件选择的预设。
   * 处理流程：
   * 1、创建选择状态快照并交给预设保存模块
   */
  const handleSavePreset = async () => {
    // 1、收集当前的配置信息后等待保存完成
    const configInfo = {
      selectedParts: { ...selectedParts.value }
    }
    await handleSavePresetOriginal(configInfo)
  }

  /**
   * 生成预设名称与主要配置的简短展示。
   * 处理流程：
   * 1、缺少配置时使用原名称
   * 2、提取主要分组选项并拼接展示名称
   */
  const getPresetDisplayName = (preset) => {
    // 1、兼容没有选择配置的预设
    if (!preset.config || !preset.config.selectedParts) {
      return preset.name
    }

    const parts = preset.config.selectedParts
    const configParts = []

    // 2、提取主要配置信息，多选分组仅展示首项
    const keyGroups = ['frontHand', 'backHand', 'expression', 'action']
    keyGroups.forEach(key => {
      if (parts[key]) {
        const value = Array.isArray(parts[key]) ? parts[key][0] : parts[key]
        if (value) {
          configParts.push(value)
        }
      }
    })

    if (configParts.length > 0) {
      const configStr = configParts.join('_')
      return `${preset.name}_${configStr}`
    }

    return preset.name
  }

  /**
   * 生成预设悬浮提示中的完整配置说明。
   * 处理流程：
   * 1、缺少配置时返回原名称
   * 2、格式化每个已选分组并按行拼接
   */
  const getPresetFullDescription = (preset) => {
    // 1、兼容未保存配置明细的预设
    if (!preset.config || !preset.config.selectedParts) {
      return preset.name
    }

    const parts = preset.config.selectedParts
    const descriptions = []

    // 2、把单选与多选值统一转成可读文本
    Object.entries(parts).forEach(([key, value]) => {
      if (value) {
        const displayValue = Array.isArray(value) ? value.join('、') : value
        descriptions.push(`${key}: ${displayValue}`)
      }
    })

    return `${preset.name}\n${descriptions.join('\n')}`
  }

  // 2、多选集合、菜单与拖动状态保持原初始化和原地修改方式。
  // ==================== 多选状态管理 ====================
  const selectedTemplateIds1 = ref(new Set()) // 动作模板多选
  const selectedTemplateIds2 = ref(new Set()) // 表情模板多选
  const selectedPresetIds = ref(new Set()) // 预设多选
  const contextMenuVisible = ref(false)
  const contextMenuPosition = ref({ x: 0, y: 0 })
  const contextMenuTemplateType = ref('') // 'template1' 或 'template2'
  const contextMenuItemType = ref('') // 'preset' 或 'template'
  const contextMenuSingleItemId = ref(null) // 单个项目的ID（用于重命名）
  const templateDragState = reactive({
    draggingId: null,
    draggingType: '',
    overId: null,
    dropPosition: ''
  })
  const contextMenuTemplateDetail = ref(null) // 记录右键详情的模板数据

  // 右键弹窗尺寸预估，用于计算安全位置
  const TEMPLATE_DETAIL_WIDTH = 360
  const TEMPLATE_DETAIL_HEIGHT = 360
  const BASIC_MENU_WIDTH = 200
  const BASIC_MENU_HEIGHT = 120

  // 右键小窗需要展示的配置明细
  const templateDetailEntries = computed(() => {
    if (!contextMenuTemplateDetail.value?.config) return []
    return contextMenuTemplateDetail.value.config.filter(item =>
      item &&
      item.tabName &&
      Array.isArray(item.selectedParts) &&
      item.selectedParts.length > 0
    )
  })

  // 根据类型输出标签文案
  const templateTypeLabelMap = {
    template1: '动作模板',
    template2: '表情模板',
    actionTemplate: '动作模板',
    expressionTemplate: '表情模板'
  }

  const templateDetailTypeLabel = computed(() => {
    if (!contextMenuTemplateDetail.value) return ''
    const typeFromContext = templateTypeLabelMap[contextMenuTemplateType.value]
    if (typeFromContext && typeFromContext.includes('模板')) {
      return typeFromContext.replace('模板', '')
    }
    const fallback = templateTypeLabelMap[contextMenuTemplateDetail.value.templateType] || ''
    return fallback.replace('模板', '')
  })

  const templateDetailTimestamp = ref('')

  const templateDetailSummary = computed(() => {
    if (!contextMenuTemplateDetail.value) return ''
    const count = templateDetailEntries.value.reduce((sum, group) => sum + group.selectedParts.length, 0)
    return count > 0 ? `共 ${count} 项配置` : ''
  })

  /**
   * 计算右键弹窗在窗口内的位置。
   * 处理流程：
   * 1、取得视口尺寸并修正右侧、底部越界
   * 2、保留顶部和左侧边距后返回坐标
   */
  const getContextMenuSafePosition = (clientX, clientY, width = BASIC_MENU_WIDTH, height = BASIC_MENU_HEIGHT) => {
    // 1、根据弹窗预计尺寸约束右侧和底部位置
    const margin = 12
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080
    let x = clientX
    let y = clientY

    if (x + width + margin > viewportWidth) {
      x = viewportWidth - width - margin
    }
    if (y + height + margin > viewportHeight) {
      y = viewportHeight - height - margin
    }

    // 2、窗口较小时仍确保左侧和顶部起点可见
    x = Math.max(margin, x)
    y = Math.max(margin, y)

    return { x, y }
  }

  /**
   * 响应模板卡片单选或多选。
   * 处理流程：
   * 1、选择对应模板类型的多选集合
   * 2、修饰键点击切换集合成员，普通点击直接应用模板
   */
  const handleTemplateCardClick = (event, templateId, templateType) => {
    // 1、动作模板与表情模板使用独立的多选状态
    const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2

    // 2、按修饰键区分多选切换与直接应用
    if (event.ctrlKey || event.metaKey) {
      // Ctrl 或 Cmd 多选
      if (selectedSet.value.has(templateId)) {
        selectedSet.value.delete(templateId)
      } else {
        selectedSet.value.add(templateId)
      }
      // 触发响应式更新
      selectedSet.value = new Set(selectedSet.value)
    } else {
      // 普通点击：应用模板并清空多选
      selectedSet.value.clear()
      applyTemplateById(templateId, templateType)
    }
  }

  /**
   * 展示模板卡片的右键菜单与配置详情。
   * 处理流程：
   * 1、同步右键目标与多选集合
   * 2、保存单项标识和模板详情
   * 3、按已有安全位置计算显示菜单
   */
  const handleTemplateContextMenu = (event, templateId, templateType) => {
    // 1、接管原生右键菜单，确保目标位于当前选中集合
    event.preventDefault()

    const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2
    const templateList = templateType === 'template1' ? templates1.value : templates2.value

    // 如果右键的模板不在选中列表中，清空选中并选中当前模板
    if (!selectedSet.value.has(templateId)) {
      selectedSet.value.clear()
      selectedSet.value.add(templateId)
      selectedSet.value = new Set(selectedSet.value)
    }

    // 2、如果只选中了一个模板，记录其标识用于重命名
    contextMenuSingleItemId.value = selectedSet.value.size === 1 ? templateId : null

    // 记录当前模板详情
    const currentTemplate = templateList.find(item => item.id === templateId) || null
    contextMenuTemplateDetail.value = currentTemplate

    // 3、显示右键菜单，并约束详情浮层位置
    contextMenuPosition.value = getContextMenuSafePosition(
      event.clientX,
      event.clientY,
      TEMPLATE_DETAIL_WIDTH,
      TEMPLATE_DETAIL_HEIGHT
    )
    contextMenuTemplateType.value = templateType
    contextMenuItemType.value = 'template'
    contextMenuVisible.value = true
    templateDetailTimestamp.value = ''
  }

  /**
   * 关闭当前右键菜单。
   * 处理流程：
   * 1、隐藏菜单并释放当前详情对象和项目类型
   */
  const closeContextMenu = () => {
    // 1、清理菜单展示所需的临时上下文
    contextMenuVisible.value = false
    contextMenuItemType.value = ''
    contextMenuTemplateDetail.value = null
  }

  /**
   * 确认后批量删除选中的模板。
   * 处理流程：
   * 1、检查选中集合并确定模板存储类型
   * 2、确认后逐个删除，清空选择并关闭菜单
   */
  const handleBatchDeleteTemplates = async () => {
    // 1、读取右键菜单所属模板类型的选择集合
    const selectedSet = contextMenuTemplateType.value === 'template1'
      ? selectedTemplateIds1
      : selectedTemplateIds2

    if (selectedSet.value.size === 0) {
      message.warning('请先选择要删除的模板')
      return
    }

    const count = selectedSet.value.size
    const typeText = contextMenuTemplateType.value === 'template1' ? '动作' : '表情'
    // 转换为新的类型名
    const targetType = contextMenuTemplateType.value === 'template1' ? 'actionTemplate' : 'expressionTemplate'

    // 2、仅在用户确认后执行批量删除
    dialog.warning({
      title: '确认删除',
      content: `确定要删除选中的 ${count} 个${typeText}模板吗？此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        // 批量删除，传递正确的模板类型
        for (const templateId of selectedSet.value) {
          await deleteTemplate(templateId, targetType)
        }

        // 清空选中状态
        selectedSet.value.clear()
        closeContextMenu()

        message.success(`已删除 ${count} 个${typeText}模板`)
      }
    })
  }

  /**
   * 通过对话框重命名单个模板。
   * 处理流程：
   * 1、获取目标模板并关闭原右键菜单
   * 2、展示名称输入框，支持回车提交和自动聚焦
   * 3、确认时检查空名及重名，保存后恢复原模板类型
   */
  const handleContextMenuRename = () => {
    // 1、仅处理单项模板上下文
    if (!contextMenuSingleItemId.value) return

    // 获取当前模板
    const templateType = contextMenuTemplateType.value
    const targetType = templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
    const isActionTemplate = targetType === 'actionTemplate'
    const currentTemplates = isActionTemplate ? templates1.value : templates2.value
    const template = currentTemplates.find(t => t.id === contextMenuSingleItemId.value)

    if (!template) return

    // 关闭右键菜单
    closeContextMenu()

    // 创建输入框的响应式变量
    let newName = template.name

    // 2、使用对话框收集新名称并提供键盘提交
    const d = dialog.create({
      title: '重命名模板',
      content: () => {
        return h('div', { style: 'padding: 10px 0;' }, [
          h('div', { style: 'margin-bottom: 8px; color: var(--n-text-color); font-size: 14px;' }, '请输入新的模板名称：'),
          h('input', {
            type: 'text',
            value: newName,
            placeholder: '模板名称',
            style: 'width: 100%; padding: 8px 12px; border: 1px solid var(--n-border-color); border-radius: 4px; background: var(--n-color); color: var(--n-text-color); font-size: 14px; outline: none; box-sizing: border-box;',
            onInput: (e) => {
              newName = e.target.value
            },
            onKeyup: (e) => {
              if (e.key === 'Enter') {
                d.positiveClick()
              }
            },
            onVnodeMounted: (vnode) => {
              // 自动聚焦并选中文本
              nextTick(() => {
                vnode.el.focus()
                vnode.el.select()
              })
            }
          })
        ])
      },
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => {
        // 3、校验名称后保存目标类型的数据，再恢复原活动类型
        const trimmedName = newName.trim()

        if (!trimmedName) {
          message.warning('模板名称不能为空')
          return false // 阻止对话框关闭
        }

        // 检查重名
        if (currentTemplates.some(t => t.id !== template.id && t.name === trimmedName)) {
          message.warning('模板名称已存在')
          return false // 阻止对话框关闭
        }

        // 执行重命名
        template.name = trimmedName

        // 保存到存储
        const originalType = activeTemplateType.value
        activeTemplateType.value = targetType
        saveTemplates()
        activeTemplateType.value = originalType

        message.success('模板已重命名')
        console.log('✏️ 重命名模板:', trimmedName)
      }
    })
  }

  /**
   * 响应页面空白处点击并关闭右键菜单。
   * 处理流程：
   * 1、调用统一的菜单关闭方法
   */
  const handlePageClick = () => {
    // 1、结束当前右键菜单交互
    closeContextMenu()
  }

  /**
   * 判断模板是否位于对应类型的多选集合。
   * 处理流程：
   * 1、读取该类型的集合并查询模板标识
   */
  const isTemplateMultiSelected = (templateId, templateType) => {
    // 1、动作与表情模板分别查询，避免标识跨类型混用
    const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2
    return selectedSet.value.has(templateId)
  }

  /**
   * 判断模板是否为当前拖拽来源。
   * 处理流程：
   * 1、比较模板标识与拖拽来源标识
   */
  const isTemplateDragging = (templateId) => templateDragState.draggingId === templateId
  /**
   * 判断模板的指定侧是否应显示插入提示。
   * 处理流程：
   * 1、同时匹配悬停目标与插入方向
   */
  const isTemplateDragOver = (templateId, position) => {
    // 1、目标和方向都一致时显示反馈
    return templateDragState.overId === templateId && templateDragState.dropPosition === position
  }

  /**
   * 将界面模板类型转换为存储类型。
   * 处理流程：
   * 1、动作标签映射到动作模板，其余映射到表情模板
   */
  const templateTypeToInternal = (templateType) => {
    // 1、统一界面与数据模块的类型名称
    return templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
  }

  /**
   * 获取界面类型对应的模板列表。
   * 处理流程：
   * 1、按动作或表情标签返回对应数组
   */
  const getTemplateListByType = (templateType) => {
    // 1、保持两类模板的数据相互独立
    return templateType === 'template1' ? templates1.value : templates2.value
  }

  /**
   * 按当前列表顺序更新模板排序序号。
   * 处理流程：
   * 1、取得目标列表，将数组索引转换为从一开始的序号
   */
  const updateTemplateSortOrderMeta = (templateType) => {
    // 1、把拖拽后的数组顺序写入各模板的排序字段
    const list = getTemplateListByType(templateType)
    list.forEach((template, index) => {
      template.sortOrder = index + 1
    })
  }

  /**
   * 持久化指定类型的模板排序。
   * 处理流程：
   * 1、更新排序序号并临时切换活动类型
   * 2、等待保存完成，无论结果如何都恢复原类型
   */
  const persistTemplateOrder = async (templateType) => {
    // 1、保存前让数据模块指向本次重排的模板集合
    updateTemplateSortOrderMeta(templateType)
    const originalType = activeTemplateType.value
    const targetType = templateTypeToInternal(templateType)
    if (originalType !== targetType) {
      activeTemplateType.value = targetType
    }
    // 2、恢复活动类型的操作由最终清理分支保证执行
    try {
      await saveTemplates()
    } finally {
      if (activeTemplateType.value !== originalType) {
        activeTemplateType.value = originalType
      }
    }
  }

  /**
   * 清空模板拖拽状态。
   * 处理流程：
   * 1、重置来源、类型、目标和插入方向
   */
  const resetTemplateDragState = () => {
    // 1、为下一次拖拽清理全部临时字段
    templateDragState.draggingId = null
    templateDragState.draggingType = ''
    templateDragState.overId = null
    templateDragState.dropPosition = ''
  }

  /**
   * 判断目标类型能否接收当前模板拖拽。
   * 处理流程：
   * 1、要求存在拖拽来源且来源类型与目标一致
   */
  const isTemplateDragAcceptable = (templateType) => {
    // 1、限制模板在同类型列表内重排
    return templateDragState.draggingId && templateDragState.draggingType === templateType
  }

  /**
   * 初始化模板卡片拖拽。
   * 处理流程：
   * 1、记录来源与类型，清除旧目标
   * 2、存在浏览器拖拽载荷时声明移动操作并写入标识
   */
  const handleTemplateDragStart = (event, templateId, templateType) => {
    // 1、建立本次拖拽上下文
    templateDragState.draggingId = templateId
    templateDragState.draggingType = templateType
    templateDragState.overId = null
    templateDragState.dropPosition = ''
    // 2、设置浏览器拖拽载荷与允许的操作类型
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', templateId)
    }
  }

  /**
   * 计算模板卡片前后的插入方向。
   * 处理流程：
   * 1、按鼠标在卡片左右半区的位置更新目标和方向
   */
  const updateTemplateDropPosition = (event, templateId) => {
    // 1、使用卡片局部横向坐标确定插入位置
    const rect = event.currentTarget.getBoundingClientRect()
    const offsetX = event.clientX - rect.left
    templateDragState.overId = templateId
    templateDragState.dropPosition = offsetX < rect.width / 2 ? 'before' : 'after'
  }

  /**
   * 处理拖拽进入模板卡片。
   * 处理流程：
   * 1、类型可接收时更新插入提示
   */
  const handleTemplateDragEnter = (event, templateId, templateType) => {
    // 1、忽略跨类型拖拽
    if (!isTemplateDragAcceptable(templateType)) return
    updateTemplateDropPosition(event, templateId)
  }

  /**
   * 允许模板在同类型卡片上放置。
   * 处理流程：
   * 1、检查类型并阻止浏览器默认行为，再更新插入方向
   */
  const handleTemplateDragOver = (event, templateId, templateType) => {
    // 1、持续同步鼠标位置对应的插入提示
    if (!isTemplateDragAcceptable(templateType)) return
    event.preventDefault()
    updateTemplateDropPosition(event, templateId)
  }

  /**
   * 清理模板卡片的拖拽离开反馈。
   * 处理流程：
   * 1、忽略不可接收类型及卡片内部子元素切换
   * 2、真正离开卡片时清空目标和方向
   */
  const handleTemplateDragLeave = (event, templateId, templateType) => {
    // 1、检查类型与事件关联目标
    if (!isTemplateDragAcceptable(templateType)) return
    const related = event.relatedTarget
    if (related && event.currentTarget.contains(related)) {
      return
    }
    // 2、离开整个卡片才移除插入提示
    templateDragState.overId = null
    templateDragState.dropPosition = ''
  }

  /**
   * 将来源模板插入另一模板的前方或后方。
   * 处理流程：
   * 1、校验来源并从列表移除
   * 2、查找目标，缺失时恢复原位置，否则按方向插入
   */
  const reorderTemplateList = (templateType, targetTemplateId, dropPosition) => {
    // 1、排除无来源、自身放置和来源已经不存在的情况
    if (!templateDragState.draggingId || templateDragState.draggingId === targetTemplateId) {
      return false
    }
    const list = getTemplateListByType(templateType)
    const fromIndex = list.findIndex(t => t.id === templateDragState.draggingId)
    if (fromIndex === -1) {
      return false
    }
    const [item] = list.splice(fromIndex, 1)
    // 2、移除来源后重新查找目标索引，避免偏移计算错误
    const targetIndex = list.findIndex(t => t.id === targetTemplateId)
    if (targetIndex === -1) {
      list.splice(fromIndex, 0, item)
      return false
    }
    let insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex
    if (insertIndex < 0) insertIndex = 0
    if (insertIndex > list.length) insertIndex = list.length
    list.splice(insertIndex, 0, item)
    return true
  }

  /**
   * 将拖动模板移到列表开头或末尾。
   * 处理流程：
   * 1、查找并移除来源模板
   * 2、按边界方向插入，返回是否完成移动
   */
  const moveTemplateToEdge = (templateType, edge) => {
    // 1、来源不存在时不修改列表
    if (!templateDragState.draggingId) return false
    const list = getTemplateListByType(templateType)
    const fromIndex = list.findIndex(t => t.id === templateDragState.draggingId)
    if (fromIndex === -1) return false
    const [item] = list.splice(fromIndex, 1)
    // 2、将来源放到指定边界
    if (edge === 'first') {
      list.unshift(item)
    } else {
      list.push(item)
    }
    return true
  }

  /**
   * 提交模板卡片上的放置操作。
   * 处理流程：
   * 1、校验类型并重排来源模板
   * 2、发生变动时持久化顺序，随后清空拖拽状态
   */
  const handleTemplateDrop = async (event, templateId, templateType) => {
    // 1、使用当前插入方向，缺失方向时默认后插
    if (!isTemplateDragAcceptable(templateType)) return
    event.preventDefault()
    const dropPosition = templateDragState.dropPosition || 'after'
    // 2、仅对完成的移动保存排序
    const changed = reorderTemplateList(templateType, templateId, dropPosition)
    if (changed) {
      await persistTemplateOrder(templateType)
    }
    resetTemplateDragState()
  }

  /**
   * 结束模板拖拽并处理容器边界放置。
   * 处理流程：
   * 1、若仍保留容器首尾目标，则执行边界移动并保存
   * 2、清理本轮拖拽状态
   */
  const handleTemplateDragEnd = async () => {
    // 1、补充处理在容器边缘结束的拖拽
    if (
      templateDragState.draggingId &&
      (templateDragState.dropPosition === 'container-first' || templateDragState.dropPosition === 'container-last')
    ) {
      const templateType = templateDragState.draggingType
      const moveEdge = templateDragState.dropPosition === 'container-first' ? 'first' : 'last'
      const changed = moveTemplateToEdge(templateType, moveEdge)
      if (changed) {
        await persistTemplateOrder(templateType)
      }
    }
    // 2、移除来源及插入反馈
    resetTemplateDragState()
  }

  /**
   * 判断当前标签是否属于正在拖拽的模板类型。
   * 处理流程：
   * 1、检查来源标识，并按类型匹配当前标签
   */
  const isTemplateDragContextActiveOnCurrentTab = () => {
    // 1、仅激活来源模板对应列表的容器事件
    if (!templateDragState.draggingId) return false
    if (templateDragState.draggingType === 'template1') {
      return currentTab.value === 'template1'
    }
    if (templateDragState.draggingType === 'template2') {
      return currentTab.value === 'template2'
    }
    return false
  }

  /**
   * 更新模板列表首尾区域的插入提示。
   * 处理流程：
   * 1、检查活动拖拽并测量容器边界
   * 2、按左右边缘或阈值区域设置首尾插入标记
   */
  const handleTemplateListDragOver = (event) => {
    // 1、仅接收当前模板标签的拖拽
    if (!isTemplateDragContextActiveOnCurrentTab()) return
    event.preventDefault()
    const container = event.currentTarget
    const rect = container.getBoundingClientRect()
    // 2、容器外侧和内部边缘区域均可作为首尾落点
    if (event.clientX <= rect.left) {
      templateDragState.overId = null
      templateDragState.dropPosition = 'container-first'
      return
    }
    if (event.clientX >= rect.right) {
      templateDragState.overId = null
      templateDragState.dropPosition = 'container-last'
      return
    }
    const relativeX = event.clientX - rect.left
    const threshold = Math.min(80, rect.width * 0.25)
    templateDragState.overId = null
    if (relativeX <= threshold) {
      templateDragState.dropPosition = 'container-first'
    } else if (relativeX >= rect.width - threshold) {
      templateDragState.dropPosition = 'container-last'
    } else {
      templateDragState.dropPosition = ''
    }
  }

  /**
   * 处理拖拽离开模板列表。
   * 处理流程：
   * 1、移出左右边界时保留对应首尾插入标记
   * 2、离开其他区域时清理不再有效的插入提示
   */
  const handleTemplateListDragLeave = (event) => {
    // 1、根据离开方向保留边界移动意图
    if (!templateDragState.draggingId) return
    const rect = event.currentTarget.getBoundingClientRect()
    if (event.clientX <= rect.left) {
      templateDragState.overId = null
      templateDragState.dropPosition = 'container-first'
      return
    }
    if (event.clientX >= rect.right) {
      templateDragState.overId = null
      templateDragState.dropPosition = 'container-last'
      return
    }
    // 2、真正离开列表且没有边界意图时清空提示
    if (!event.currentTarget.contains(event.relatedTarget)) {
      if (
        !templateDragState.overId &&
        templateDragState.dropPosition !== 'container-first' &&
        templateDragState.dropPosition !== 'container-last'
      ) {
        templateDragState.dropPosition = ''
      }
    }
  }

  /**
   * 提交模板列表空白区域的放置操作。
   * 处理流程：
   * 1、读取首尾目标并执行对应移动
   * 2、保存变动并结束拖拽上下文
   */
  const handleTemplateListDrop = async (event) => {
    // 1、只处理当前模板类型的容器首尾放置
    if (!isTemplateDragContextActiveOnCurrentTab()) return
    event.preventDefault()
    const dropPosition = templateDragState.dropPosition
    const templateType = templateDragState.draggingType
    let changed = false
    if (dropPosition === 'container-first') {
      changed = moveTemplateToEdge(templateType, 'first')
    } else if (dropPosition === 'container-last') {
      changed = moveTemplateToEdge(templateType, 'last')
    }
    // 2、持久化顺序并清理反馈
    if (changed) {
      await persistTemplateOrder(templateType)
    }
    resetTemplateDragState()
  }

  // ==================== 预设多选管理 ====================
  /**
   * 响应预设卡片的单选和多选。
   * 处理流程：
   * 1、修饰键点击切换多选成员
   * 2、普通点击清空多选并应用当前预设
   */
  const handlePresetCardClick = (event, presetId) => {
    // 1、按修饰键状态分流到多选或直接应用
    if (event.ctrlKey || event.metaKey) {
      // Ctrl 或 Cmd 多选
      if (selectedPresetIds.value.has(presetId)) {
        selectedPresetIds.value.delete(presetId)
      } else {
        selectedPresetIds.value.add(presetId)
      }
      // 触发响应式更新
      selectedPresetIds.value = new Set(selectedPresetIds.value)
    } else {
      // 2、普通点击时选择预设并清空多选
      selectedPresetIds.value.clear()
      selectPreset(presetId)
    }
  }

  /**
   * 打开预设的右键操作菜单。
   * 处理流程：
   * 1、将右键目标纳入当前选中集合
   * 2、定位菜单并清除模板专用上下文
   */
  const handlePresetContextMenu = (event, presetId) => {
    // 1、替代浏览器菜单并同步本次操作的预设集合
    event.preventDefault()

    // 如果右键的预设不在选中列表中，清空选中并选中当前预设
    if (!selectedPresetIds.value.has(presetId)) {
      selectedPresetIds.value.clear()
      selectedPresetIds.value.add(presetId)
      selectedPresetIds.value = new Set(selectedPresetIds.value)
    }

    // 2、定位预设菜单，重置不适用的模板详情字段
    contextMenuPosition.value = getContextMenuSafePosition(
      event.clientX,
      event.clientY,
      BASIC_MENU_WIDTH,
      BASIC_MENU_HEIGHT
    )
    contextMenuItemType.value = 'preset'
    contextMenuTemplateDetail.value = null
    contextMenuTemplateType.value = ''
    contextMenuSingleItemId.value = null
    contextMenuVisible.value = true
  }

  /**
   * 确认后批量删除预设。
   * 处理流程：
   * 1、检查是否存在选中预设并展示确认框
   * 2、确认后逐项删除，清空选择并反馈完成结果
   */
  const handleBatchDeletePresets = async () => {
    // 1、空集合不进入删除流程
    if (selectedPresetIds.value.size === 0) {
      message.warning('请先选择要删除的预设')
      return
    }

    const count = selectedPresetIds.value.size

    dialog.warning({
      title: '确认删除',
      content: `确定要删除选中的 ${count} 个预设吗？此操作不可撤销。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: async () => {
        // 2、依次等待每个预设删除后再清理选中集合
        for (const presetId of selectedPresetIds.value) {
          await deletePreset(presetId)
        }

        // 清空选中状态
        selectedPresetIds.value.clear()
        closeContextMenu()

        message.success(`已删除 ${count} 个预设`)
      }
    })
  }

  /**
   * 从模板详情菜单直接应用当前模板。
   * 处理流程：
   * 1、确认单项模板上下文完整
   * 2、等待应用完成后关闭菜单
   */
  const handleTemplateDetailApply = async () => {
    // 1、缺少标识或类型时跳过
    if (!contextMenuSingleItemId.value || !contextMenuTemplateType.value) {
      return
    }
    // 2、使用菜单记录的类型应用模板
    await applyTemplateById(contextMenuSingleItemId.value, contextMenuTemplateType.value)
    closeContextMenu()
  }

  /**
   * 查询预设是否处于多选状态。
   * 处理流程：
   * 1、检查预设标识是否存在于选中集合
   */
  const isPresetMultiSelected = (presetId) => {
    // 1、按标识读取集合成员状态
    return selectedPresetIds.value.has(presetId)
  }

  /**
   * 将当前配置保存为动作模板。
   * 处理流程：
   * 1、标记正在新增，并调用模板保存流程
   * 2、当前显示动作模板列表时补绘新模板预览
   * 3、延迟解除新增标记，避免监听器重复全量绘制
   */
  const handleSaveTemplate1 = async () => {
    // 1、在保存期间抑制列表监听器的重复绘制
    isAddingTemplate.value = true
    try {
      await handleSaveTemplateOriginal(renderTemplatePreview, 'template1', generateTemplatePreviewBase64)

      // 2、当前处于动作模板标签页时，仅绘制新添加模板
      if (currentTab.value === 'template1') {
        await nextTick()
        // 获取最后一个模板（刚添加的）
        const newTemplate = templates1.value[templates1.value.length - 1]
        if (newTemplate) {
          console.log('🎨 立即渲染新添加的动作模板预览:', newTemplate.name)
          await renderTemplatePreview(newTemplate)
        }
      }
    } finally {
      // 3、稍等一下再解除标记，确保监听器不会被立即触发
      setTimeout(() => {
        isAddingTemplate.value = false
      }, 200)
    }
  }

  /**
   * 将当前配置保存为表情模板。
   * 处理流程：
   * 1、设置新增标记并保存表情配置
   * 2、当前显示表情模板列表时补绘新模板预览
   * 3、延迟清除新增标记
   */
  const handleSaveTemplate2 = async () => {
    // 1、保存与预览期间共用新增标记
    isAddingTemplate.value = true
    try {
      await handleSaveTemplateOriginal(renderTemplatePreview, 'template2', generateTemplatePreviewBase64)

      // 2、当前处于表情模板标签页时，仅绘制新添加模板
      if (currentTab.value === 'template2') {
        await nextTick()
        // 获取最后一个模板（刚添加的）
        const newTemplate = templates2.value[templates2.value.length - 1]
        if (newTemplate) {
          console.log('🎨 立即渲染新添加的表情模板预览:', newTemplate.name)
          await renderTemplatePreview(newTemplate)
        }
      }
    } finally {
      // 3、稍等一下再解除标记，确保监听器不会被立即触发
      setTimeout(() => {
        isAddingTemplate.value = false
      }, 200)
    }
  }

  /**
   * 按模板标识和类型请求删除确认。
   * 处理流程：
   * 1、转换类型后调用模板模块的确认入口
   */
  const confirmDeleteTemplateById = (templateId, templateType) => {
    // 1、直接传递模板类型，不改变当前活动模板类型
    // 转换为新的类型名
    const targetType = templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
    confirmDeleteTemplate(templateId, targetType)
  }

  /**
   * 为指定模板打开重命名对话框。
   * 处理流程：
   * 1、建立单项上下文后调用统一重命名逻辑
   */
  const startEditTemplateNameById = (templateId, templateType) => {
    // 1、通过菜单上下文复用对话框重命名流程
    contextMenuSingleItemId.value = templateId
    contextMenuTemplateType.value = templateType
    handleContextMenuRename()
  }

  /**
   * 在模板名称输入框失焦时提交修改。
   * 处理流程：
   * 1、切换到对应模板类型并读取新名称
   * 2、提交非空名称，失败时恢复原文本
   * 3、清除该类型的编辑标识
   */
  const handleTemplateNameBlur = async (templateId, event, templateType) => {
    // 1、先切换到对应的模板存储类型
    if (templateType === 'template1') {
      activeTemplateType.value = 'actionTemplate'
    } else if (templateType === 'template2') {
      activeTemplateType.value = 'expressionTemplate'
    }

    const newName = event.target.value.trim()

    // 2、非空输入交给数据模块校验与保存
    if (newName && newName !== '') {
      const success = await renameTemplateFunc(templateId, newName)
      if (!success) {
        // 重命名失败，恢复原名称
        const template = templates.value.find(t => t.id === templateId)
        if (template) {
          event.target.value = template.name
        }
      }
    }

    // 3、清除对应类型的编辑状态
    if (templateType === 'template1') {
      editingTemplate1Id.value = null
    } else if (templateType === 'template2') {
      editingTemplate2Id.value = null
    }
  }

  // 3、直接返回原始引用；内部排序辅助函数和多选集合仍由本模块闭包共享。
  return {
    handleSavePreset,
    getPresetDisplayName,
    getPresetFullDescription,
    contextMenuVisible,
    contextMenuPosition,
    contextMenuItemType,
    contextMenuSingleItemId,
    contextMenuTemplateDetail,
    templateDetailEntries,
    templateDetailTypeLabel,
    handleTemplateCardClick,
    handleTemplateContextMenu,
    closeContextMenu,
    handleBatchDeleteTemplates,
    handleContextMenuRename,
    handlePageClick,
    isTemplateMultiSelected,
    isTemplateDragging,
    isTemplateDragOver,
    handleTemplateDragStart,
    handleTemplateDragEnter,
    handleTemplateDragOver,
    handleTemplateDragLeave,
    handleTemplateDrop,
    handleTemplateDragEnd,
    handleTemplateListDragOver,
    handleTemplateListDragLeave,
    handleTemplateListDrop,
    handlePresetCardClick,
    handlePresetContextMenu,
    handleBatchDeletePresets,
    handleTemplateDetailApply,
    isPresetMultiSelected,
    handleSaveTemplate1,
    handleSaveTemplate2,
    startEditTemplateNameById
  }
}
