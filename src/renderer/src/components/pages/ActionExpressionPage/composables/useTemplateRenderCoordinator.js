/**
 * 模板应用与预览绘制编排：复用主画布算法，独占模板画布引用与绘制标记。
 * 页面在原应用函数位置创建；这里只建立函数和空状态，不读取业务数据、不调用依赖。
 * 已就绪的引用直接共享；后初始化或会替换的依赖由逐项 getter 在原使用点读取。
 * 模板数据、PSD、图层树与部件选择仍归原模块所有；只保留原预览生成时的图层备份。
 * 列表监听、悬浮预览、生命周期及渲染回调赋值仍由页面按原顺序组装。
 */
import { ref, nextTick } from 'vue'

export function useTemplateRenderCoordinator({
  currentPsdData,
  allPartsListsMap,
  dynamicExpressionTabs,
  selectedParts,
  currentTab,
  message,
  canvasRef,
  getCustomGroupNames,
  buildUniquePathMap,
  trimWhitespace,
  getActiveTemplateType,
  getLayerTreeData,
  getRenderAllLayers,
  getSelectPart,
  getApplyTemplate,
  getTemplatePreviewReader,
  getTemplates1,
  getTemplates2,
  getSetLayerVisibilityByPath
}) {
  // 1、只创建唯一一份空状态；没有 computed、watch、依赖 getter 或绘制的提前执行。
  const renderTemplatesPreviewsRef = ref(null)
  const templateCanvasRefs = ref({}) // 存储每个模板的canvas引用
  const isRenderingTemplatePreview = ref(false) // 标志位：是否正在渲染模板预览
  const isRenderingTemplate = ref(false) // 标志位：是否正在渲染模板（用于控制画布过渡动画）
  const canvasOpacity = ref(1) // 画布不透明度（用于渲染模板时的过渡动画）

  /**
   * 应用模板配置到当前PSD
   * 处理流程：
   * 1、验证数据，无跳转模式委托静默应用并管理画布过渡
   * 2、建立标准手部及动态表情标签的映射
   * 3、逐项匹配和应用部件，收集缺失信息
   * 4、重绘画布并按需提示缺失项，异常时恢复画布状态
   * @param {Array} config - 模板配置数组 [{tabName, selectedParts}]
   * @param {Boolean} noJump - 是否禁止标签页跳转（默认false）
   * @param {Boolean} showMissingAlert - 是否显示缺失部件警告弹窗（默认false）
   */
  const applyTemplateConfig = async (config, noJump = false, showMissingAlert = false) => {
    // 1、检查配置，并对无跳转应用使用独立的过渡流程
    if (!config || !Array.isArray(config) || !currentPsdData.value) {
      console.warn('⚠️ 无法应用模板：配置或PSD数据为空')
      return
    }

    console.log('📋 开始应用模板配置:', config, '禁止跳转:', noJump, '显示缺失警告:', showMissingAlert)

    try {
      if (noJump) {
        // 🎬 开始应用：隐藏主画布，添加过渡动画
        isRenderingTemplate.value = true
        canvasOpacity.value = 0 // 完全隐藏画布

        // 等待过渡动画开始
        await new Promise(resolve => setTimeout(resolve, 50))

        // 使用静默应用，不跳转标签页
        // 🔧 传入模板类型，只清空对应类型的图层
        const result = await applyTemplateConfigSilent(config, true, getActiveTemplateType().value, showMissingAlert)
        await getRenderAllLayers()()

        // 🎬 应用完成：恢复主画布不透明度，带有过渡动画
        await new Promise(resolve => setTimeout(resolve, 50))
        canvasOpacity.value = 1 // 恢复到100%不透明度

        // 等待过渡动画完成后清除渲染标志
        await new Promise(resolve => setTimeout(resolve, 300))
        isRenderingTemplate.value = false

        console.log('✅ 模板应用完成（无跳转）')
        return result
      }

      // 2、建立模板显示名称到当前 PSD 实际分组的映射
      const tabNameToKey = {}

      /**
       * 检测当前 PSD 实际使用的手部分组键。
       * 处理流程：
       * 1、按标准键和备用键顺序查找非空部件列表，未匹配则保留标准键
       */
      const detectHandGroupKey = (standardKey, alternatives) => {
        // 1、检查哪个分组键在当前 PSD 中实际存在
        for (const key of [standardKey, ...alternatives]) {
          if (allPartsListsMap.value[key] && allPartsListsMap.value[key].length > 0) {
            return key
          }
        }
        return standardKey // 兜底返回标准key
      }

      // 标准标签映射（使用智能检测）
      const standardMap = {
        '前手': detectHandGroupKey('frontHandNormal', ['frontHand']),
        '左手': detectHandGroupKey('frontHandNormal', ['frontHand']),
        '右手': detectHandGroupKey('frontHandRight', ['rightHand']),
        '双手': detectHandGroupKey('frontHandBoth', ['bothHands']),  // 🔧 关键：智能匹配双手
        '后手': detectHandGroupKey('backHand', []),
        '前层后手': detectHandGroupKey('frontLayerBackHand', []),
        '动作': 'action'
        // 注意：移除了上身和下身，模板不再管理这些
      }

      // 添加标准映射
      Object.assign(tabNameToKey, standardMap)

      console.log('🔍 当前PSD的手部标签映射:', {
        '双手': standardMap['双手'],
        '前手': standardMap['前手'],
        '右手': standardMap['右手']
      })

      // 添加动态表情标签映射
      if (dynamicExpressionTabs?.value) {
        for (const tab of dynamicExpressionTabs.value) {
          tabNameToKey[tab.label] = tab.key
        }
      }

      // 记录模板中配置的groupKey，用于后续只应用这些分组
      const configuredGroups = new Set()
      // 收集缺失的部件信息
      const missingItems = [] // [{ tabName, missingParts: [] }]

      // 3、逐组匹配名称并应用未选中的部件，同时收集缺失项
      for (const item of config) {
        const { tabName, selectedParts: partNames } = item

        if (!tabName || !partNames || partNames.length === 0) {
          continue
        }

        // 查找对应的groupKey
        const groupKey = tabNameToKey[tabName]
        if (!groupKey) {
          console.warn(`⚠️ 未找到标签"${tabName}"的groupKey映射`)
          missingItems.push({
            tabName,
            missingParts: partNames,
            reason: '未找到对应的标签分组'
          })
          continue
        }

        configuredGroups.add(groupKey)

        // 查找对应的部件列表
        const partsList = allPartsListsMap.value[groupKey]
        if (!partsList || partsList.length === 0) {
          console.warn(`⚠️ groupKey"${groupKey}"没有可用的部件列表`)
          missingItems.push({
            tabName,
            missingParts: partNames,
            reason: '该标签下没有可用的部件'
          })
          continue
        }

        // 应用所有匹配的部件（支持多选）
        const missingParts = []
        for (const partName of partNames) {
          const targetPart = partsList.find(p =>
            p.name === partName ||
            p.displayName === partName ||
            (p.displayName || p.name).includes(partName) ||
            partName.includes(p.displayName || p.name)
          )

          if (targetPart) {
            // 检查该部件是否已选中
            const currentSelected = selectedParts.value[groupKey]
            const isAlreadySelected = Array.isArray(currentSelected)
              ? currentSelected.some(p => p.path === targetPart.path)
              : (currentSelected && currentSelected.path === targetPart.path)

            if (!isAlreadySelected) {
              // 切换到对应的标签页
              currentTab.value = groupKey
              // 应用部件选择
              await getSelectPart()(targetPart)
              console.log(`✅ 应用部件选择: ${tabName} -> ${targetPart.displayName || targetPart.name}`)
            } else {
              console.log(`ℹ️ 部件已选中，跳过: ${tabName} -> ${targetPart.displayName || targetPart.name}`)
            }
          } else {
            console.log(`⚠️ 未找到匹配的部件: ${tabName} -> ${partName}`)
            missingParts.push(partName)
          }
        }

        // 记录该标签下缺失的部件
        if (missingParts.length > 0) {
          missingItems.push({
            tabName,
            missingParts,
            reason: '部件不存在'
          })
        }
      }

      // 4、重绘当前选择，并按调用参数显示缺失部件提示
      console.log(`📋 模板应用完成，配置了 ${configuredGroups.size} 个分组，其他分组保持原状`)

      // 重新渲染画布
      await getRenderAllLayers()()

      // 如果需要显示缺失警告，且有缺失项，则显示气泡提示
      if (showMissingAlert && missingItems.length > 0) {
        // 判断是动作模板还是表情模板
        const isActionTemplate = getActiveTemplateType().value === 'actionTemplate' || getActiveTemplateType().value === 'template1'
        const templateTypeName = isActionTemplate ? '动作' : '表情'

        // 构建简洁的缺失信息文本
        const missingTexts = missingItems.map(item => {
          return `【${item.tabName}】${item.missingParts.join('、')}`
        })

        // 显示气泡提示
        message.warning(`模板已部分应用，缺少${templateTypeName}：${missingTexts.join('；')}`, {
          duration: 5000
        })

        console.warn(`⚠️ 模板应用时发现 ${missingItems.length} 个缺失项`)
      }

      console.log('✅ 模板应用完成')
      return { success: true, missingItems }
    } catch (error) {
      console.error('❌ 应用模板配置失败:', error)
      // 确保在错误情况下也恢复画布状态
      if (noJump && isRenderingTemplate.value) {
        canvasOpacity.value = 1
        isRenderingTemplate.value = false
      }
      throw error
    }
  }

  /**
   * 生成模板预览图的 base64 数据
   * 通过主画布渲染逻辑来确保剪切蒙版、图层蒙版等复杂逻辑的正确性
   * 处理流程：
   * 1、备份图层树，并按动作或表情模板筛选可见图层
   * 2、等待主画布绘制稳定后复制图像
   * 3、裁剪缩放并导出 JPEG 数据地址
   * 4、无论生成结果如何，都恢复原始图层树与主画布
   * @param {String} templateType - 模板类型 'actionTemplate' 或 'expressionTemplate'
   * @returns {Promise<String>} 图片数据地址，缺少数据或生成失败时返回空值
   */
  const generateTemplatePreviewBase64 = async (templateType) => {
    // 1、验证 PSD 并备份图层树，临时应用模板类型对应的可见性
    try {
      if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
        console.warn('⚠️ 当前没有加载PSD数据，跳过预览图生成')
        return null
      }

      const typeName = templateType === 'actionTemplate' ? '动作' : '表情'
      console.log(`📸 开始生成${typeName}模板预览图（使用主画布渲染）...`)

      // 🔧 保存当前状态
      const originalLayerTreeData = JSON.parse(JSON.stringify(getLayerTreeData().value))

      try {
        // 获取系统配置的表情图组名称列表
        const customGroupNames = getCustomGroupNames()
        const expressionNames = customGroupNames.expression || []

        /**
         * 判断路径是否属于配置的表情分组。
         * 处理流程：
         * 1、遍历表情名称，检查路径中是否包含该名称
         */
        const isExpressionLayer = (layerPath) => {
          // 1、复用用户配置的表情组名识别路径
          return expressionNames.some(exprName =>
            layerPath && (layerPath.includes(exprName) || layerPath.includes(`/${exprName}/`))
          )
        }

        // 构建路径映射
        const pathMap = buildUniquePathMap(currentPsdData.value.layerHierarchy)

        /**
         * 为当前模板预览临时筛选可见图层。
         * 处理流程：
         * 1、递归处理分组，叶子节点按路径判定是否属于表情
         * 2、隐藏当前模板类型不需要的叶子，保留其他节点原有状态
         */
        const setLayerVisibility = (layers) => {
          // 1、逐层遍历到可绘制节点，并查找其原始路径
          for (const layer of layers) {
            if (layer.children && layer.children.length > 0) {
              setLayerVisibility(layer.children)
            } else {
              // 找到对应的原始图层
              const originalLayer = currentPsdData.value.layerHierarchy
              const fullPath = pathMap.get(layer)
              if (!fullPath) continue

              const isExpression = isExpressionLayer(fullPath)

              // 2、根据模板类型决定图层可见性
              if (templateType === 'actionTemplate') {
                // 动作模板：隐藏表情图层，保留其他所有可见图层
                if (isExpression) {
                  layer.visible = false
                  layer.userVisible = false
                }
                // 非表情图层保持原状
              } else if (templateType === 'expressionTemplate') {
                // 表情模板：只显示表情图层，隐藏其他图层
                if (!isExpression) {
                  layer.visible = false
                  layer.userVisible = false
                }
                // 表情图层保持原状
              }
            }
          }
        }

        // 应用可见性设置
        setLayerVisibility(getLayerTreeData().value)

        // 2、调用主画布渲染逻辑，等待蒙版等绘制完成后复制图像
        await nextTick()
        await getRenderAllLayers()()

        // 🔧 等待渲染完全完成（多次 nextTick + 额外延迟）
        await nextTick()
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 100)) // 等待100ms确保渲染完成

        // 🔧 再次确认画布已经稳定
        await nextTick()

        // 从主画布拷贝图像
        const mainCanvas = canvasRef.value
        if (!mainCanvas) {
          console.warn('⚠️ 主画布未初始化，跳过预览图生成')
          return null
        }

        console.log(`📸 主画布尺寸: ${mainCanvas.width} x ${mainCanvas.height}，准备拷贝图像...`)

        // 创建临时 canvas
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = mainCanvas.width
        tempCanvas.height = mainCanvas.height
        const tempCtx = tempCanvas.getContext('2d', { alpha: true })

        if (!tempCtx) {
          console.warn('⚠️ 无法创建临时Canvas上下文')
          return null
        }

        // 设置高质量渲染
        tempCtx.imageSmoothingEnabled = true
        tempCtx.imageSmoothingQuality = 'high'

        // 清空画布
        tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height)

        // 从主画布拷贝图像
        tempCtx.drawImage(mainCanvas, 0, 0)

        // 3、裁剪空白并限制预览尺寸，再编码为 JPEG
        const trimmed = trimWhitespace(tempCanvas)

        // 🔧 限制图片尺寸以减小base64大小
        let finalCanvas = trimmed
        const maxWidth = 800
        const maxHeight = 800

        if (trimmed.width > maxWidth || trimmed.height > maxHeight) {
          const scale = Math.min(maxWidth / trimmed.width, maxHeight / trimmed.height)
          const scaledWidth = Math.floor(trimmed.width * scale)
          const scaledHeight = Math.floor(trimmed.height * scale)

          const scaledCanvas = document.createElement('canvas')
          scaledCanvas.width = scaledWidth
          scaledCanvas.height = scaledHeight
          const scaledCtx = scaledCanvas.getContext('2d', { alpha: true })

          if (scaledCtx) {
            scaledCtx.imageSmoothingEnabled = true
            scaledCtx.imageSmoothingQuality = 'high'
            scaledCtx.drawImage(trimmed, 0, 0, scaledWidth, scaledHeight)
            finalCanvas = scaledCanvas
            console.log(`📐 图片已缩放: ${trimmed.width}x${trimmed.height} -> ${scaledWidth}x${scaledHeight}`)
          }
        }

        // 🔧 使用JPEG格式和适当的质量来减小文件大小
        // 对于模板预览，0.8的质量已经足够好，同时能显著减小文件大小
        const base64 = finalCanvas.toDataURL('image/jpeg', 0.8)

        console.log(`✅ ${typeName}模板预览图生成完成，尺寸: ${finalCanvas.width}x${finalCanvas.height}，base64 长度: ${base64.length} (${(base64.length / 1024 / 1024).toFixed(2)}MB)`)

        // 🔧 验证base64数据有效性
        if (!base64 || !base64.startsWith('data:image/')) {
          console.error('❌ 生成的base64数据无效')
          return null
        }

        // 🔧 警告：如果数据太大（超过5MB），可能会导致存储问题
        if (base64.length > 5 * 1024 * 1024) {
          console.warn(`⚠️ base64数据过大 (${(base64.length / 1024 / 1024).toFixed(2)}MB)，可能会导致存储失败`)
        }

        return base64

      } finally {
        // 4、恢复原始图层树并重新绘制主画布
        getLayerTreeData().value = originalLayerTreeData

        // 重新渲染主画布以恢复原始显示
        await nextTick()
        await getRenderAllLayers()()

        // 等待恢复渲染完成
        await nextTick()
        await nextTick()
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    } catch (error) {
      console.error('❌ 生成预览图失败:', error)
      // 返回 null 而不是抛出错误，让程序继续执行
      return null
    }
  }

  /**
   * 按界面模板类型应用指定模板。
   * 处理流程：
   * 1、将界面类型映射到活动存储类型
   * 2、等待模板应用完成
   */
  const applyTemplateById = async (templateId, templateType) => {
    // 1、先切换到对应的模板存储类型
    if (templateType === 'template1') {
      getActiveTemplateType().value = 'actionTemplate'
    } else if (templateType === 'template2') {
      getActiveTemplateType().value = 'expressionTemplate'
    }

    // 2、在对应集合中查找并应用模板
    await getApplyTemplate()(templateId)
  }

  /**
   * 设置模板canvas的ref
   * 处理流程：
   * 1、挂载时缓存画布，卸载时删除引用
   */
  const setTemplateCanvasRef = (templateId, el) => {
    // 1、按模板标识维护画布引用表
    if (el) {
      templateCanvasRefs.value[templateId] = el
    } else {
      delete templateCanvasRefs.value[templateId]
    }
  }

  /**
   * 渲染单个模板的预览图（使用 base64 预览图）
   * 处理流程：
   * 1、校验模板、PSD 和目标画布
   * 2、读取已有预览数据，加载后按原始图片尺寸绘制
   * 3、缺少预览时跳过，加载失败时记录错误
   * @param {Object} template - 模板对象
   * @param {Boolean} skipTransition - 是否跳过过渡动画（批量渲染时使用）
   */
  const renderTemplatePreview = async (template, skipTransition = false) => {
    // 1、模板画布依赖视图挂载后才能绘制
    if (!template || !currentPsdData.value) return

    const canvas = templateCanvasRefs.value[template.id]
    if (!canvas) {
      console.warn('⚠️ 模板canvas未找到:', template.id)
      return
    }

    try {
      // 2、读取模板自身类型对应的预览数据并绘制
      const previewBase64 = await getTemplatePreviewReader()(template.id, template.templateType)
      if (previewBase64) {
        // 加载 base64 图片并渲染到 canvas
        const img = new Image()
        await new Promise((resolve, reject) => {
          img.onload = () => {
            // 设置canvas为图片尺寸
            canvas.width = img.width
            canvas.height = img.height

        const ctx = canvas.getContext('2d', { alpha: true })
            if (!ctx) {
              reject(new Error('无法获取Canvas 2D上下文'))
              return
            }

        // 设置高质量渲染
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'

        // 清空画布
        ctx.clearRect(0, 0, canvas.width, canvas.height)

            // 绘制图片
            ctx.drawImage(img, 0, 0)

            console.log('✅ 模板预览渲染完成（使用base64）:', template.name)
            resolve()
          }
          img.onerror = (error) => {
            console.warn('⚠️ 加载base64预览图失败:', error)
            reject(error)
          }
          img.src = previewBase64
        })
        return
      }

      // 3、没有已有预览时直接跳过，避免占用主画布重新生成
      console.log('⏭️ 跳过模板预览渲染（无base64预览图）:', template.name)

    } catch (error) {
      console.error('❌ 渲染模板预览失败:', template.id, error)
    }
  }

  /**
   * 静默应用模板配置（不触发标签页跳转）
   * 处理流程：
   * 1、校验配置并建立当前 PSD 的分组映射
   * 2、匹配目标部件并收集缺失项
   * 3、按模板类型与预览模式清理受影响分组
   * 4、显示配置中的图层，更新选择并按需提示缺失项
   * @param {Array} config - 模板配置
   * @param {Boolean} isForPreview - 是否用于预览渲染
   * @param {String} templateType - 模板类型（'actionTemplate' 或 'expressionTemplate'）
   * @param {Boolean} showMissingAlert - 是否显示缺失部件警告弹窗（默认false）
   * @returns {Object} 返回应用结果 { success: boolean, missingItems: Array }
   */
  const applyTemplateConfigSilent = async (config, isForPreview = false, templateType = null, showMissingAlert = false) => {
    // 1、保证数据可用后建立标签与实际分组的映射
    if (!config || !Array.isArray(config) || !currentPsdData.value) {
      return { success: false, missingItems: [] }
    }

    // 标签名称到groupKey的映射
    const tabNameToKey = {}

    /**
     * 为静默应用选择实际存在的手部分组键。
     * 处理流程：
     * 1、依次检查标准与备用分组，返回首个包含部件的键
     */
    const detectHandGroupKey = (standardKey, alternatives) => {
      // 1、没有可用候选时保留标准键以便报告缺失
      for (const key of [standardKey, ...alternatives]) {
        if (allPartsListsMap.value[key] && allPartsListsMap.value[key].length > 0) {
          return key
        }
      }
      return standardKey // 兜底返回标准key
    }

    // 标准标签映射（使用智能检测）
    const standardMap = {
      '前手': detectHandGroupKey('frontHandNormal', ['frontHand']),
      '左手': detectHandGroupKey('frontHandNormal', ['frontHand']),
      '右手': detectHandGroupKey('frontHandRight', ['rightHand']),
      '双手': detectHandGroupKey('frontHandBoth', ['bothHands']),  // 🔧 关键：智能匹配双手
      '后手': detectHandGroupKey('backHand', []),
      '前层后手': detectHandGroupKey('frontLayerBackHand', []),
      '动作': 'action'
      // 注意：移除了上身和下身，模板不再管理这些
    }

    Object.assign(tabNameToKey, standardMap)

    // 添加动态表情标签映射
    if (dynamicExpressionTabs?.value) {
      for (const tab of dynamicExpressionTabs.value) {
        tabNameToKey[tab.label] = tab.key
      }
    }

    // 2、收集成功匹配的配置，同时保留缺失原因用于提示
    const configToApply = new Map() // groupKey -> [parts]
    // 收集缺失的部件信息
    const missingItems = [] // [{ tabName, missingParts: [] }]

    for (const item of config) {
      const { tabName, selectedParts: partNames } = item

      if (!tabName || !partNames || partNames.length === 0) {
        continue
      }

      const groupKey = tabNameToKey[tabName]
      if (!groupKey) {
        console.warn(`⚠️ 未找到标签"${tabName}"的groupKey映射`)
        missingItems.push({
          tabName,
          missingParts: partNames,
          reason: '未找到对应的标签分组'
        })
        continue
      }

      const partsList = allPartsListsMap.value[groupKey]
      if (!partsList || partsList.length === 0) {
        console.warn(`⚠️ groupKey"${groupKey}"没有可用的部件列表`)
        missingItems.push({
          tabName,
          missingParts: partNames,
          reason: '该标签下没有可用的部件'
        })
        continue
      }

      const parts = []
      const missingParts = []

      for (const partName of partNames) {
        const targetPart = partsList.find(p =>
          p.name === partName ||
          p.displayName === partName ||
          (p.displayName || p.name).includes(partName) ||
          partName.includes(p.displayName || p.name)
        )

        if (targetPart) {
          parts.push(targetPart)
        } else {
          missingParts.push(partName)
        }
      }

      if (parts.length > 0) {
        configToApply.set(groupKey, parts)
      }

      // 记录该标签下缺失的部件
      if (missingParts.length > 0) {
        missingItems.push({
          tabName,
          missingParts,
          reason: '部件不存在'
        })
      }
    }

    // 总是排除的标签列表（不受模板影响，保持当前状态）
    const excludedKeys = ['upperBody', 'lowerBody']

    // 定义动作相关和表情相关的groupKey
    const actionGroupKeys = ['frontHandNormal', 'frontHandRight', 'frontHandBoth', 'bothHands',
                             'backHand', 'frontLayerBackHand', 'action', 'handParts']

    // 判断是动作模板还是表情模板
    const isActionTemplate = templateType === 'actionTemplate' || templateType === 'template1' ||
                             getActiveTemplateType().value === 'actionTemplate' || getActiveTemplateType().value === 'template1'
    const isExpressionTemplate = templateType === 'expressionTemplate' || templateType === 'template2' ||
                                 getActiveTemplateType().value === 'expressionTemplate' || getActiveTemplateType().value === 'template2'

    // 3、根据模板类型和使用场景决定清空策略，上身与下身保持原状
    if (isForPreview) {
      // 预览模式：根据模板类型清空对应的标签（避免堆叠）
      let groupKeysToClear = []

      if (isActionTemplate) {
        // 动作模板：只清空动作相关的标签，保留表情
        groupKeysToClear = actionGroupKeys
      } else if (isExpressionTemplate) {
        // 表情模板：只清空表情相关的标签，保留动作
        groupKeysToClear = Object.keys(allPartsListsMap.value).filter(key =>
          !excludedKeys.includes(key) && !actionGroupKeys.includes(key)
        )
      } else {
        // 未知类型：清空所有（兼容旧逻辑）
        groupKeysToClear = Object.keys(allPartsListsMap.value).filter(key =>
          !excludedKeys.includes(key)
        )
      }

      // 清空指定的标签
      for (const groupKey of groupKeysToClear) {
        const partsList = allPartsListsMap.value[groupKey]

        // 隐藏该分组的所有图层
        if (partsList && Array.isArray(partsList)) {
          for (const part of partsList) {
            if (part && part.path) {
              getSetLayerVisibilityByPath()(part.path, false)
            }
          }
        }

        // 清空selectedParts
        if (Array.isArray(selectedParts.value[groupKey])) {
          selectedParts.value[groupKey] = []
        } else {
          selectedParts.value[groupKey] = null
        }
      }
    } else {
      // 应用模式：只清空模板中配置的分组（保持其他部分不变）
      for (const [groupKey, parts] of configToApply.entries()) {
        // 跳过排除的标签
        if (excludedKeys.includes(groupKey)) {
          continue
        }

        // 隐藏该分组的所有图层
        const partsList = allPartsListsMap.value[groupKey]
        if (partsList && Array.isArray(partsList)) {
          for (const part of partsList) {
            if (part && part.path) {
              getSetLayerVisibilityByPath()(part.path, false)
            }
          }
        }

        // 清空该分组的selectedParts
        if (Array.isArray(selectedParts.value[groupKey])) {
          selectedParts.value[groupKey] = []
        } else {
          selectedParts.value[groupKey] = null
        }
      }
    }

    // 4、显示模板配置中指定的图层，并同步选择与缺失提示
    for (const [groupKey, parts] of configToApply.entries()) {
      // 跳过排除的标签
      if (excludedKeys.includes(groupKey)) {
        continue
      }

      for (const part of parts) {
        if (part && part.path) {
          getSetLayerVisibilityByPath()(part.path, true)
        }
      }

      // 更新selectedParts（用于UI显示选中状态）
      const isMultiSelect = Array.isArray(selectedParts.value[groupKey])
      if (isMultiSelect) {
        selectedParts.value[groupKey] = parts
      } else {
        selectedParts.value[groupKey] = parts[0] || null
      }
    }

    // 如果需要显示缺失警告，且有缺失项，则显示气泡提示
    if (showMissingAlert && missingItems.length > 0) {
      // 判断是动作模板还是表情模板
      const isActionTemplate = templateType === 'actionTemplate' || templateType === 'template1' ||
                               getActiveTemplateType().value === 'actionTemplate' || getActiveTemplateType().value === 'template1'
      const templateTypeName = isActionTemplate ? '动作' : '表情'

      // 构建简洁的缺失信息文本
      const missingTexts = missingItems.map(item => {
        return `【${item.tabName}】${item.missingParts.join('、')}`
      })

      // 显示气泡提示
      message.warning(`模板已部分应用，缺少${templateTypeName}：${missingTexts.join('；')}`, {
        duration: 5000
      })

      console.warn(`⚠️ 模板应用时发现 ${missingItems.length} 个缺失项`)
    }

    return { success: true, missingItems }
  }

  /**
   * 渲染指定模板列表的预览图（直接使用 Base64 数据）
   * 处理流程：
   * 1、由显式参数或当前标签确定目标模板列表
   * 2、等待画布挂载后依次绘制各模板预览
   * @param {'template1' | 'template2' | null} targetType - 目标模板类型；为空时根据当前标签判断
   */
  const renderAllTemplatesPreviews = async (targetType = null) => {
    // 1、没有目标类型或目标列表为空时跳过
    let templateType = targetType
    if (!templateType) {
      if (currentTab.value === 'template1') templateType = 'template1'
      if (currentTab.value === 'template2') templateType = 'template2'
    }

    if (!templateType) return

    const targetTemplates = templateType === 'template1' ? getTemplates1().value : getTemplates2().value
    if (!targetTemplates || targetTemplates.length === 0) return

    await nextTick()

    // 2、依次等待单项预览绘制，避免同时处理全部图片
    for (const template of targetTemplates) {
      await renderTemplatePreview(template, true)
    }
  }

  // 2、仅返回页面组装所需入口和同一份标记；静默应用与画布引用表保持模块内部所有。
  return {
    applyTemplateConfig,
    generateTemplatePreviewBase64,
    applyTemplateById,
    setTemplateCanvasRef,
    renderTemplatePreview,
    renderAllTemplatesPreviews,
    renderTemplatesPreviewsRef,
    isRenderingTemplatePreview,
    isRenderingTemplate,
    canvasOpacity
  }
}
