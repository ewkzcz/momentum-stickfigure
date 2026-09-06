/**
 * PSD 解析与页面初始化：调用桌面解析服务、缓存部件分类并协调首次载入状态。
 */
import { markRaw } from 'vue'

/**
 * PSD 文件解析与处理逻辑（核心）
 * 提供：initPSDService, parsePsdFile, processFile
 * 通过依赖注入接入页面状态与方法，避免循环依赖
 */

// ==================== 表情互斥辅助工具 ====================
/**
 * 通过标签关键词识别表情部位。
 * 处理流程：
 * 1、规范文本并依次匹配眉、眼、嘴关键词，未命中返回空值
 */
const detectExpressionCategoryFromLabel = (text = '') => {
  // 1、使用固定部位优先级兼容中英文图层命名
  const raw = String(text || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (/(眉毛|眉|eyebrow|brow)/i.test(raw) || /(eyebrow|brow)/.test(lower)) return 'eyebrow'
  if (/(眼睛|眼|双眼|瞳|目|eye|pupil)/i.test(raw) || /(eye|pupil)/.test(lower)) return 'eye'
  if (/(嘴巴|嘴|嘴型|口|唇|mouth|lip)/i.test(raw) || /(mouth|lip)/.test(lower)) return 'mouth'
  return null
}

/**
 * 判断图层上下文是否描述完整表情。
 * 处理流程：
 * 1、排除空值并匹配表情或面部关键词
 */
const looksLikeExpressionContext = (text = '') => {
  // 1、为不具备完整三部位组合的图组提供语义判断
  if (!text) return false
  return /(表情|emotion|expression|神态|整脸|五官|脸|面)/i.test(text)
}

/**
 * 获取标签图组的直接父级名称。
 * 处理流程：
 * 1、统一路径分隔符并返回倒数第二个有效路径段
 */
const getGroupParentName = (tab) => {
  // 1、优先使用原始路径，并兼容多种分隔符
  const rawPath = tab?.originalPath || tab?.path || ''
  if (!rawPath) return ''
  const normalized = rawPath.replace(/\\/g, '/').replace(/／/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return ''
}

/**
 * 清理部件名称中的表情修饰和部位后缀。
 * 处理流程：
 * 1、移除前缀、括号说明和后缀，清理结果为空时保留原名称
 */
const extractBaseExpressionName = (name) => {
  // 1、提取眉、眼、嘴之间用于名称关联的共同部分
  if (!name) return ''
  let result = String(name).trim()
  result = result.replace(/^[\s·\-_／／]*(表情[:：\- ]*)/iu, '')
  result = result.replace(/（[^）]*）/g, '')
  result = result.replace(/\([^)]*\)/g, '')
  result = result.replace(/[【】\[\]]/g, '')
  result = result.replace(/(眉毛|眉|眼睛|眼|嘴巴|嘴|口|唇|表情)$/u, '')
  result = result.replace(/[-_/—]+$/u, '')
  result = result.replace(/\s+$/u, '')
  return result || name
}

/**
 * 构建表情分类与独立表情的互斥元信息。
 * 处理流程：
 * 1、按父级和基础名称统计三类部位是否齐全
 * 2、结合组合完整性与命名语义，生成标签类型映射
 */
const buildExpressionMeta = (tabs = [], expressionsMap = {}) => {
  // 1、先建立跨分组的同名部位矩阵
  const metaMap = new Map()
  const parentBaseMatrix = new Map()

  /**
   * 获取父级分组的基础名称矩阵。
   * 处理流程：
   * 1、矩阵不存在时创建映射，再返回该父级的数据容器
   */
  const ensureParentMatrix = (parent) => {
    // 1、让同一父级的不同部位共享组合统计
    if (!parentBaseMatrix.has(parent)) {
      parentBaseMatrix.set(parent, new Map())
    }
    return parentBaseMatrix.get(parent)
  }

  tabs.forEach(tab => {
    const parentName = getGroupParentName(tab)
    if (!parentName) return
    const category = detectExpressionCategoryFromLabel(tab.label || tab.layerName || '')
    if (!category) return
    const partsList = expressionsMap[tab.key] || []
    const baseMap = ensureParentMatrix(parentName)
    partsList.forEach(part => {
      if (!part) return
      const baseName = extractBaseExpressionName(part.displayName || part.name)
      if (!baseName) return
      if (!baseMap.has(baseName)) {
        baseMap.set(baseName, { eyebrow: false, eye: false, mouth: false })
      }
      baseMap.get(baseName)[category] = true
    })
  })

  // 2、用已收集的完整组合信息判断每个标签的互斥类别
  tabs.forEach(tab => {
    const parentName = getGroupParentName(tab)
    const label = tab.label || tab.layerName || ''
    const category = detectExpressionCategoryFromLabel(label)
    const partsList = expressionsMap[tab.key] || []
    const parentMatrix = parentBaseMatrix.get(parentName)
    const contextText = `${label}|${tab.originalPath || ''}|${tab.path || ''}|${parentName}`

    let hasFullCombination = false
    if (category && parentMatrix) {
      for (const part of partsList) {
        if (!part) continue
        const baseName = extractBaseExpressionName(part.displayName || part.name)
        if (!baseName) continue
        const record = parentMatrix.get(baseName)
        if (record && record.eyebrow && record.eye && record.mouth) {
          hasFullCombination = true
          break
        }
      }
    }

    let looksExpression = looksLikeExpressionContext(contextText)
    if (!looksExpression) {
      looksExpression = partsList.some(part => looksLikeExpressionContext(part?.displayName || part?.name || ''))
    }

    let exprType = category
    let isStandalone = false
    if (category && hasFullCombination) {
      exprType = category
    } else if (category && !hasFullCombination && looksExpression) {
      exprType = 'standalone'
      isStandalone = true
    } else if (!category && looksExpression) {
      exprType = 'standalone'
      isStandalone = true
    } else if (!category) {
      exprType = null
    }

    metaMap.set(tab.key, {
      exprType,
      baseCategory: category,
      isStandalone,
      parentName
    })
  })

  return {
    metaMap,
    parentBaseMatrix
  }
}

/**
 * 创建 PSD 解析与文件载入模块。
 * 处理流程：
 * 1、读取页面状态、渲染方法与分类依赖
 * 2、建立可延迟注入的历史保存入口
 * 3、提供服务检查、文件解析和完整载入方法
 * @param {Object} deps 依赖项，包含页面响应式状态与业务方法
 */
export function usePsdParser(deps) {
  // 1、复用页面状态容器，避免产生另一份选中或图层数据
  const {
    // 基础依赖
    message,

    // 文件与当前数据
    psdFiles,
    currentPsdFile,
    currentPsdData,

    // 图层树与控制优先级
    layerTreeData,
    selectedLayersMap,
    controlPriority,

    // 部件分类相关状态（当前显示的数据容器）
    frontHandParts,
    frontHandNormalParts,
    frontHandRightParts,
    frontHandBothParts,
    backHandParts,
    frontLayerBackHandParts,
    bothHandsParts,
    upperBodyParts,
    lowerBodyParts,
    actionParts,

    // 动态分组
    dynamicExpressionParts,
    dynamicExpressionTabs,
    dynamicFrontHandParts,
    dynamicFrontHandTabs,
    dynamicBackHandParts,
    dynamicBackHandTabs,
    dynamicBothHandsParts,
    dynamicBothHandsTabs,
    dynamicUpperBodyParts,
    dynamicUpperBodyTabs,
    dynamicLowerBodyParts,
    dynamicLowerBodyTabs,
    dynamicActionParts,
    dynamicActionTabs,

    // 画布
    canvasWidth,
    canvasHeight,
    updateCanvasDisplaySize,

    // 预设与渲染
    getFirstDefaultTabKey,
    selectedPresetId,
    editingPresetId,
    presets,
    loadPresets,
    renderAllLayers,

    // 业务函数
    classifyParts,
    buildLayerTree,
    syncBackgroundControlFromLayerTree,

    // 工具函数
    generateId,

    // 额外依赖
    psdPartsCache,
    selectedParts,
    userInteracted,
    currentTab
  } = deps

  // 2、由外部在历史模块初始化后注入路径保存方法，避免循环依赖
  /**
   * 历史路径保存的初始化占位。
   * 处理流程：
   * 1、历史模块未就绪时不执行保存，后续由注入函数替换
   */
  let savePsdPathToHistory = () => {}

  /**
   * 注入 PSD 历史路径保存方法。
   * 处理流程：
   * 1、仅接受函数类型，合法时替换当前保存入口
   */
  const setSavePsdPathToHistory = (fn) => {
    // 1、忽略无效依赖，保留当前可调用入口
    if (typeof fn === 'function') {
      savePsdPathToHistory = fn
    }
  }

  /**
   * 初始化 PSD 服务
   * 处理流程：
   * 1、请求桌面服务配置，根据返回状态记录初始化结果
   */
  const initPSDService = async () => {
    // 1、通过配置请求确认 PSD 服务接口状态
    try {
      const config = await window.electronAPI?.invoke('psd-get-config')
      if (config && config.success) {
        console.log('PSD服务初始化成功')
      } else {
        console.warn('PSD服务初始化失败')
      }
    } catch (error) {
      console.error('PSD服务初始化失败:', error)
    }
  }

  /**
   * 解析 PSD 文件
   * 处理流程：
   * 1、读取文件字节并合并默认解析选项，调用桌面解析接口
   * 2、成功时兼容不同数据包装层级，失败时抛出解析错误
   * @param {File} file
   * @param {Object} parseOptions
   * @returns {Promise<Object>}
   */
  const parsePsdFile = async (file, parseOptions = {}) => {
    // 1、保留调用方传入的解析选项覆盖默认值
    try {
      const arrayBuffer = await file.arrayBuffer()
      const result = await window.electronAPI?.invoke('psd-parse-file', {
        fileBuffer: arrayBuffer,
        parseOptions: {
          parseImages: true,
          parseChannelData: false,
          validateFile: true,
          processLayers: true,
          autoDetectComponents: true,
          ...parseOptions
        }
      })

      // 2、区分 IPC 调用成功和内层解析成功，拒绝把失败对象当作 PSD 数据。
      if (result && result.success) {
        if (result.data?.success === false) {
          throw new Error(result.data.error || result.data.message || 'PSD文件解析失败')
        }
        const actualData = result.data?.data || result.data
        console.log('PSD文件解析成功:', result)
        console.log('📦 提取的实际数据:', actualData)
        return actualData
      }
      throw new Error(result?.message || result?.error || 'PSD文件解析失败')
    } catch (error) {
      console.error('解析PSD文件时出错:', error)
      throw error
    }
  }

  /**
   * 处理单个 PSD 文件（核心）
   * 处理流程：
   * 1、记录可用文件路径并解析 PSD
   * 2、创建文件记录，分类部件并缓存结果
   * 3、首个文件初始化图层树、部件列表及表情互斥状态
   * 4、设置画布尺寸，延迟载入预设并校验当前文件后重绘
   * 5、清理进度消息，失败时向调用方传播异常
   * @param {File} file
   * @param {boolean} showMessage
   */
  const processFile = async (file, showMessage = true) => {
    // 1、在解析前记录真实路径，供后续历史恢复使用
    try {
      console.log('📁 开始处理文件:', file.name)
      console.log('📊 文件大小:', (file.size / 1024 / 1024).toFixed(2), 'MB')

      // 尝试获取文件路径（支持多种方式）
      let filePath = file.path || file.webkitRelativePath || null
      console.log('📍 文件路径:', filePath || '(无路径信息)')

      // 保存文件路径到历史记录（如果有path属性）
      if (filePath) {
        console.log('💾 准备保存路径到历史:', filePath)
        savePsdPathToHistory(filePath)
      } else {
        console.warn('⚠️ 文件没有path属性，无法保存到历史记录')
        console.warn('⚠️ 这可能导致无法加载历史、保存历史或导入导出历史功能')
      }

      if (showMessage) {
        message.loading('正在解析PSD文件...', { duration: 0, key: 'parse' })
      }

      const parsedData = await parsePsdFile(file)
      const data = markRaw(parsedData)

      console.log('✅ PSD解析完成')
      console.log('📐 PSD尺寸:', data.width, 'x', data.height)
      console.log('🗂️ 图层结构:', data.layerHierarchy)

      // 2、创建文件记录并缓存分类，后续文件切换可直接复用
      const psdFileData = markRaw({
        id: generateId(),
        name: file.name,
        data: data,
        uploadTime: Date.now(),
        filePath: filePath || null
      })

      // 添加到文件列表
      psdFiles.value.push(psdFileData)

      // 解析并分类图层部件，保存到缓存与当前展示容器
      const parts = await classifyParts(data)
      
      // 缓存分类结果（用于后续切换复用）
      try {
        if (psdPartsCache && psdFileData.id) {
          psdPartsCache.value[psdFileData.id] = parts
        }
      } catch (e) {
        console.warn('⚠️ 更新 psdPartsCache 失败:', e)
      }

      // 3、只有第一个文件才初始化当前视图，其他文件仅加入列表与缓存
      if (!currentPsdFile.value) {
        currentPsdFile.value = psdFileData
        currentPsdData.value = data

        // 构建图层树（保持PSD原始的visible状态）
        layerTreeData.value = buildLayerTree(data)
        
        selectedLayersMap.value = {}

        // 更新当前显示的部件列表
        frontHandParts.value = parts.frontHand
        frontHandNormalParts.value = parts.frontHandNormal
        frontHandRightParts.value = parts.frontHandRight
        frontHandBothParts.value = parts.frontHandBoth
        backHandParts.value = parts.backHand
        frontLayerBackHandParts.value = parts.frontLayerBackHand
        bothHandsParts.value = parts.bothHands
        upperBodyParts.value = parts.upperBody
        lowerBodyParts.value = parts.lowerBody
        actionParts.value = parts.action

        // 动态表情与动态分组
        dynamicExpressionParts.value = parts.expressions || {}
        dynamicExpressionTabs.value = parts.expressionTabs || []
        
        // 同步背景、背面、侧面控制状态，以及表情图组的部件 hidden 属性
        // 确保按钮状态、图层树和部件列表三者保持一致
        syncBackgroundControlFromLayerTree(dynamicExpressionParts.value)

        dynamicFrontHandParts.value = parts.frontHandDynamic || {}
        dynamicFrontHandTabs.value = parts.frontHandDynamicTabs || []
        dynamicBackHandParts.value = parts.backHandDynamic || {}
        dynamicBackHandTabs.value = parts.backHandDynamicTabs || []
        dynamicBothHandsParts.value = parts.bothHandsDynamic || {}
        dynamicBothHandsTabs.value = parts.bothHandsDynamicTabs || []
        dynamicUpperBodyParts.value = parts.upperBodyDynamic || {}
        dynamicUpperBodyTabs.value = parts.upperBodyDynamicTabs || []
        dynamicLowerBodyParts.value = parts.lowerBodyDynamic || {}
        dynamicLowerBodyTabs.value = parts.lowerBodyDynamicTabs || []
        dynamicActionParts.value = parts.actionDynamic || {}
        dynamicActionTabs.value = parts.actionDynamicTabs || []

        // 🔧 首次加载：对眉/眼/嘴各自类别内部做互斥；独立表情与其它表情全局互斥
        if (parts.expressionTabs && parts.expressionTabs.length > 0) {
          const expressionAnalysis = buildExpressionMeta(parts.expressionTabs, parts.expressions || {})
          const metaMap = expressionAnalysis.metaMap
          const typeToVisibleGroup = new Map()
          const categoryFallback = new Map()
          let standaloneVisibleInfo = null

          for (let i = 0; i < parts.expressionTabs.length; i++) {
            const tab = parts.expressionTabs[i]
            const tabKey = tab.key
            const partsList = parts.expressions[tabKey] || []
            const meta = metaMap.get(tab.key) || {}
            const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')

            if (meta.baseCategory && !meta.isStandalone && !categoryFallback.has(meta.baseCategory)) {
              categoryFallback.set(meta.baseCategory, { tab, index: i })
            }

            const visibleLayers = []
            partsList.forEach(part => {
              if (!part || !part.path || !layerTreeData.value) return
              const pathParts = part.path.split('/')
              let layers = layerTreeData.value
              for (let j = 0; j < pathParts.length; j++) {
                const layer = layers.find(l => l.uniqueName === pathParts[j])
                if (!layer) break
                if (j === pathParts.length - 1) {
                  if (layer.userVisible && layer.visible) visibleLayers.push(part)
                } else if (layer.children) {
                  layers = layer.children
                } else {
                  break
                }
              }
            })

            if (visibleLayers.length > 0) {
              console.log(`  ✅ [初始化] 表情组 ${tab.label} (类型: ${exprTypeKey}) 有 ${visibleLayers.length} 个可见图层`)
              if (!typeToVisibleGroup.has(exprTypeKey)) {
                typeToVisibleGroup.set(exprTypeKey, { tab, visibleLayers, index: i })
              } else {
                console.log(`  ⚠️ [初始化] 类型 ${exprTypeKey} 已存在可见表情组，将隐藏: ${tab.label}`)
              }
            }
          }

          // 若眉/眼/嘴未检测到可见组，使用第一个分组作为兜底
          categoryFallback.forEach((info, category) => {
            if (typeToVisibleGroup.has(category)) return
            const tabKey = info.tab.key
            const partsList = parts.expressions[tabKey] || []
            const firstPart = partsList.find(p => !p?.hidden) || partsList[0]
            const fallbackLayers = firstPart ? [firstPart] : []
            typeToVisibleGroup.set(category, { tab: info.tab, visibleLayers: fallbackLayers, index: info.index })
            if (firstPart) {
              console.log(`  🎯 [初始化/${category}] 未找到可见组，默认启用 ${info.tab.label} 的第一个部件`)
            }
          })

          standaloneVisibleInfo = typeToVisibleGroup.get('standalone') || null

          for (let i = 0; i < parts.expressionTabs.length; i++) {
            const tab = parts.expressionTabs[i]
            const tabKey = tab.key
            const partsList = parts.expressions[tabKey] || []
            const meta = metaMap.get(tab.key) || {}
            const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')
            const visibleGroup = standaloneVisibleInfo && exprTypeKey !== 'standalone'
              ? null
              : typeToVisibleGroup.get(exprTypeKey)

            if (visibleGroup && visibleGroup.index === i) {
              const visiblePaths = new Set(visibleGroup.visibleLayers.map(p => p.path))
              partsList.forEach(part => {
                if (part && part.path && !visiblePaths.has(part.path)) {
                  deps.setLayerVisibilityByPath(part.path, false)
                } else if (part && part.path && visiblePaths.has(part.path)) {
                  deps.setLayerVisibilityByPath(part.path, true)
                }
              })
              if (tab.path) {
                deps.setLayerVisibilityByPath(tab.path, true)
              }
            } else {
              partsList.forEach(part => {
                if (part && part.path) {
                  deps.setLayerVisibilityByPath(part.path, false)
                }
              })
            }
          }
        }

        // 4、设置画布原始尺寸，等待状态稳定后载入预设并重绘
        if (data.width && data.height) {
          canvasWidth.value = data.width
          canvasHeight.value = data.height
          console.log('🎯 Canvas像素尺寸设置为:', canvasWidth.value, 'x', canvasHeight.value)
          updateCanvasDisplaySize()
        }

        // 初始化状态与预设
        setTimeout(async () => {
          try {
            // 重置用户交互状态
            if (userInteracted) {
              const baseUserInteracted = {
                frontHandNormal: false,
                frontHandRight: false,
                frontHandBoth: false,
                backHand: false,
                frontLayerBackHand: false,
                bothHands: false,
                upperBody: false,
                lowerBody: false,
                action: false
              }

              dynamicExpressionTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicFrontHandTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicBackHandTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicBothHandsTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicUpperBodyTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicLowerBodyTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })
              dynamicActionTabs.value.forEach(tab => { baseUserInteracted[tab.key] = false })

              userInteracted.value = baseUserInteracted
            }

            // 默认选中标签
            const defaultTabKey = getFirstDefaultTabKey()
            if (currentTab && typeof defaultTabKey === 'string') {
              currentTab.value = defaultTabKey
            }

            // 清空预设状态并加载
            selectedPresetId.value = null
            editingPresetId.value = null
            presets.value = []

            // 安全加载预设后渲染（防抖切换）
            const currentPsdId = psdFileData.id
            await loadPresets()
            if (currentPsdFile.value?.id === currentPsdId) {
              renderAllLayers()
            } else {
              console.warn('⚠️ PSD已切换，忽略过期的预设渲染:', currentPsdId)
            }
          } catch (e) {
            console.warn('⚠️ 初始化首次PSD状态失败:', e)
          }
        }, 100)
      }

      // 5、按调用参数清理当前解析进度消息
      if (showMessage) {
        message.destroyAll()
      }
    } catch (error) {
      console.error('❌ 文件处理失败:', error)
      console.error('错误堆栈:', error.stack)
      if (showMessage) {
        message.destroyAll()
      }
      throw error
    }
  }

  // 3、提供服务、解析、载入及历史依赖注入入口
  return {
    initPSDService,
    parsePsdFile,
    processFile,
    setSavePsdPathToHistory
  }
}
