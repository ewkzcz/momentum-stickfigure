/** 表情分析与组合缩略图：复用页面的原始 PSD 和部件引用，不管理解析、图层或会话状态。 */
import { computed, ref, watch } from 'vue'

/**
 * 分析表情分类并生成眉、眼、嘴的组合缩略图。
 * 处理流程：
 * 1、使用已初始化的原始引用建立派生列表与缩略图缓存，按原位置注册监听
 * 2、返回页面、搜索和会话仍使用的同名计算属性与辅助函数
 */
export function useExpressionAnalysis({ dynamicExpressionTabs, dynamicExpressionParts, currentPsdData, trimWhitespace }) {
  // 1、依赖由页面直接传入；不复制 PSD 或部件状态，也不依赖图层树的早期占位。
  // ==================== 组合表情构建（眉/眼/嘴合并） ====================
  /**
   * 根据部位关键词识别眉毛、眼睛或嘴巴分类。
   * 处理流程：
   * 1、规范输入并按眉、眼、嘴的顺序匹配中英文关键词
   */
  const detectExpressionCategoryFromLabel = (text = '') => {
    // 1、空文本不分类，其余按固定优先级匹配
    const raw = String(text || '').trim()
    if (!raw) return null
    const lower = raw.toLowerCase()
    if (/(眉毛|眉|eyebrow|brow)/i.test(raw) || /(eyebrow|brow)/.test(lower)) return 'eyebrow'
    if (/(眼睛|眼|双眼|瞳|目|eye|pupil)/i.test(raw) || /(eye|pupil)/.test(lower)) return 'eye'
    if (/(嘴巴|嘴|嘴型|口|唇|mouth|lip)/i.test(raw) || /(mouth|lip)/.test(lower)) return 'mouth'
    return null
  }

  /**
   * 判断分组上下文是否描述表情。
   * 处理流程：
   * 1、排除空值并匹配表情或面部相关关键词
   */
  const looksLikeExpressionContext = (text = '') => {
    // 1、以中英文表情词及面部词判定上下文
    if (!text) return false
    return /(表情|emotion|expression|神态|整脸|五官|脸|面)/i.test(text)
  }

  /**
   * 获取分组路径中的直接父级名称。
   * 处理流程：
   * 1、统一路径分隔符并移除空段，返回倒数第二段
   */
  const getGroupParentName = (tab) => {
    // 1、优先使用原始路径，兼容反斜杠与全角斜杠
    const rawPath = tab?.originalPath || tab?.path || ''
    if (!rawPath) return ''
    const normalized = rawPath.replace(/\\/g, '/').replace(/／/g, '/')
    const parts = normalized.split('/').filter(Boolean)
    if (parts.length >= 2) return parts[parts.length - 2]
    return ''
  }

  /**
   * 从子项名称提取用于组合匹配的基础表情名。
   * 处理流程：
   * 1、清理表情前缀、括号说明和部位后缀，清空时保留原名称
   */
  const extractBaseExpressionName = (name) => {
    // 1、逐类剥离命名修饰，保留主体名称
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
   * 分析表情分组，区分组合通道和独立表情。
   * 处理流程：
   * 1、按父级和基础名称统计眉、眼、嘴通道
   * 2、结合完整组合与上下文生成每个标签的互斥元信息
   */
  const buildExpressionMeta = (tabs = [], expressionsMap = {}) => {
    // 1、建立父级下各基础表情名的通道矩阵
    const metaMap = new Map()
    const parentBaseMatrix = new Map()

    /**
     * 获取并按需创建父级表情矩阵。
     * 处理流程：
     * 1、缺失时初始化映射，再返回该父级的矩阵
     */
    const ensureParentMatrix = (parent) => {
      // 1、为每个父级复用同一份通道统计
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

    // 2、用通道是否完整和分组语义确定标签类型
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
        looksExpression = partsList.some(part =>
          looksLikeExpressionContext(part?.displayName || part?.name || '')
        )
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

  // 当前PSD的表情元信息分析结果
  const expressionAnalysis = computed(() => {
    return buildExpressionMeta(dynamicExpressionTabs.value || [], dynamicExpressionParts.value || {})
  })

  // tabKey -> 元数据（包含 exprType/baseCategory/isStandalone 等）
  const expressionTabMetaMap = computed(() => {
    const meta = expressionAnalysis.value.metaMap
    const plain = {}
    meta.forEach((value, key) => {
      plain[key] = value
    })
    return plain
  })

  // 父级 -> 基础名称 -> { eyebrow/eye/mouth }，用于组合检测
  const expressionParentBaseMatrix = computed(() => expressionAnalysis.value.parentBaseMatrix)

  // 组合表情的部件列表
  const combinedExpressionParts = computed(() => {
    const byParent = new Map()
    /**
     * 获取父分组下的眉、眼、嘴部件容器。
     * 处理流程：
     * 1、缺失时建立三类映射，并返回可复用的父级容器
     */
    const ensureParent = (parent) => {
      // 1、每个父分组独立积累组合所需的部位
      if (!byParent.has(parent)) {
        byParent.set(parent, {
          eyebrow: new Map(),
          eye: new Map(),
          mouth: new Map()
        })
      }
      return byParent.get(parent)
    }
    /**
     * 追加同名基础表情的部件记录。
     * 处理流程：
     * 1、初始化该名称的数组并追加当前部件
     */
    const pushTo = (map, base, payload) => {
      // 1、保留同名部件的原始收集顺序
      if (!map.has(base)) map.set(base, [])
      map.get(base).push(payload)
    }

    ;(dynamicExpressionTabs.value || []).forEach(tab => {
      const meta = expressionTabMetaMap.value[tab.key]
      const category = meta?.baseCategory
      if (!category || meta?.isStandalone) return
      const parentName = meta?.parentName || getGroupParentName(tab)
      if (!parentName) return
      const store = ensureParent(parentName)
      const list = (dynamicExpressionParts.value || {})[tab.key] || []
      const localCount = new Map()
      list.forEach(part => {
        if (!part || !part.path) return
        const base = extractBaseExpressionName(part.displayName || part.name)
        const idx = (localCount.get(base) || 0) + 1
        localCount.set(base, idx)
        const entry = { groupKey: tab.key, part, baseName: base, variantIndex: idx, parentName }
        if (category === 'eyebrow') pushTo(store.eyebrow, base, entry)
        else if (category === 'eye') pushTo(store.eye, base, entry)
        else if (category === 'mouth') pushTo(store.mouth, base, entry)
      })
    })

    const eligibleParents = Array.from(byParent.keys()).filter(parent => {
      const matrix = expressionParentBaseMatrix.value.get(parent)
      if (!matrix) return false
      for (const [, flags] of matrix.entries()) {
        if (flags.eyebrow && flags.eye && flags.mouth) {
          return true
        }
      }
      return false
    })

    const parentFirstIndex = new Map()
    ;(dynamicExpressionTabs.value || []).forEach((tab, idx) => {
      const parent = getGroupParentName(tab)
      if (!parent) return
      if (!parentFirstIndex.has(parent)) parentFirstIndex.set(parent, idx)
    })
    const selectedParents = eligibleParents.slice().sort((a, b) => {
      const ia = parentFirstIndex.has(a) ? parentFirstIndex.get(a) : Number.MAX_SAFE_INTEGER
      const ib = parentFirstIndex.has(b) ? parentFirstIndex.get(b) : Number.MAX_SAFE_INTEGER
      if (ia !== ib) return ia - ib
      return a.localeCompare(b, 'zh-CN')
    })

    const result = []
    selectedParents.forEach((parent, idx) => {
      const store = byParent.get(parent)
      if (!store) return
      const baseSet = new Set([
        ...Array.from(store.eyebrow.keys()),
        ...Array.from(store.eye.keys()),
        ...Array.from(store.mouth.keys())
      ])
      const bases = Array.from(baseSet).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
      bases.forEach(base => {
        const eyebrowEntry = (store.eyebrow.get(base) || [])[0]
        const eyeEntry = (store.eye.get(base) || [])[0]
        const mouthEntry = (store.mouth.get(base) || [])[0]
        if (!eyebrowEntry || !eyeEntry || !mouthEntry) return
        const items = [eyebrowEntry, eyeEntry, mouthEntry].map(it => ({ groupKey: it.groupKey, part: it.part }))
        const prefix = idx === 0 ? '表情' : `表情${idx}`
        const displayName = `${prefix}_[${base}]`
        const thumb = mouthEntry.part?.thumbnail || eyeEntry.part?.thumbnail || eyebrowEntry.part?.thumbnail || null
        result.push({
          name: `${parent}:${base}|` + items.map(x => `${x.groupKey}:${x.part.path}`).join(','),
          displayName,
          isCombined: true,
          items,
          thumbnail: thumb
        })
      })
    })

    const parentOrder = new Map(selectedParents.map((p, i) => [p, i]))
    result.sort((a, b) => {
      const pa = a.name.split(':')[0]
      const pb = b.name.split(':')[0]
      const oa = parentOrder.get(pa) ?? 9999
      const ob = parentOrder.get(pb) ?? 9999
      if (oa !== ob) return oa - ob
      const ba = a.displayName.match(/_\[(.*)\]$/)?.[1] || ''
      const bb = b.displayName.match(/_\[(.*)\]$/)?.[1] || ''
      return ba.localeCompare(bb, 'zh-CN', { numeric: true })
    })

    return result
  })

  // 将动态表情标签增强为携带互斥信息的结构，方便界面与逻辑直接使用
  const enhancedExpressionTabs = computed(() => {
    return (dynamicExpressionTabs.value || []).map(tab => {
      const meta = expressionTabMetaMap.value[tab.key] || {}
      return {
        ...tab,
        isExpression: true,
        isDynamic: true,
        exprType: meta.exprType ?? null,
        baseCategory: meta.baseCategory ?? null,
        isStandaloneExpression: !!meta.isStandalone,
        parentExpressionName: meta.parentName || getGroupParentName(tab)
      }
    })
  })

  // =============== 组合表情缩略图生成（遵循PSD全局z-index） ===============
  const combinedThumbnailsMap = ref(new Map()) // key: signature(paths)| value: dataURL
  const combinedImageCache = new Map() // imageData -> HTMLImageElement

  /**
   * 加载并缓存组合缩略图所需的图片。
   * 处理流程：
   * 1、命中缓存时直接返回图片
   * 2、未命中时等待图片加载成功，再写入缓存
   */
  const loadImageCached = (imageData) => {
    // 1、复用已解码的图片，减少重复加载
    if (combinedImageCache.has(imageData)) return Promise.resolve(combinedImageCache.get(imageData))
    // 2、仅缓存成功加载的图片，错误通过承诺传递
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => { combinedImageCache.set(imageData, img); resolve(img) }
      img.onerror = reject
      img.src = imageData
    })
  }

  /**
   * 生成与部件顺序无关的组合缩略图缓存键。
   * 处理流程：
   * 1、收集有效路径，排序后拼接为签名
   */
  const getComboSignature = (items) => items.map(i => i.part?.path).filter(Boolean).sort().join('|')

  /**
   * 为 PSD 图层对象建立唯一路径映射。
   * 处理流程：
   * 1、为同级重名图层补充序号
   * 2、保存完整路径并递归处理子图层
   */
  const buildUniquePathMap = (layers, currentPath = '', pathMap = new Map()) => {
    // 1、每个层级独立统计重名图层
    const nameCount = new Map()
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      let uniqueName = layer.name
      if (nameCount.has(layer.name)) {
        const c = nameCount.get(layer.name)
        nameCount.set(layer.name, c + 1)
        uniqueName = `${layer.name}#${c + 1}`
      } else {
        nameCount.set(layer.name, 1)
      }
      // 2、将当前路径传给子层级，保持图层对象到路径的稳定映射
      const layerPath = currentPath ? `${currentPath}/${uniqueName}` : uniqueName
      if (!pathMap.has(layer)) pathMap.set(layer, layerPath)
      if (layer.children && layer.children.length > 0) {
        buildUniquePathMap(layer.children, layerPath, pathMap)
      }
    }
    return pathMap
  }

  /**
   * 按 PSD 原始坐标生成组合表情缩略图。
   * 处理流程：
   * 1、建立路径映射并收集所选分组的叶子图层
   * 2、按原始画布尺寸和图层顺序绘制图片
   * 3、裁掉透明留白并返回图片数据地址
   */
  const generateCombinedThumbnail = async (items) => {
    // 1、过滤缺失数据，准备选中分组与路径映射
    if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) return null
    const rootLayers = currentPsdData.value.layerHierarchy
    const selectedGroupPaths = new Set(items.map(i => i.part?.path).filter(Boolean))
    if (selectedGroupPaths.size === 0) return null

    const pathMap = buildUniquePathMap(rootLayers)
    const leaves = []

    /**
     * 递归收集组合表情使用的叶子图层。
     * 处理流程：
     * 1、保持原始顺序递归分组
     * 2、保留属于选中路径且尺寸有效的叶子及其绘制参数
     */
    const collectLeaves = (layers) => {
      // 1、从底到顶遍历，确保绘制顺序为底层先、上层后
      for (let i = 0; i < layers.length; i++) {
        const layer = layers[i]
        if (layer.children && layer.children.length > 0) {
          collectLeaves(layer.children)
        } else {
          const fullPath = pathMap.get(layer)
          // 2、只收集路径属于选中组且尺寸有效的叶子图层
          const belongs = Array.from(selectedGroupPaths).some(p => fullPath && fullPath.startsWith(p))
          if (!belongs) continue
          const width = layer.width || (layer.canvas ? layer.canvas.width : 0)
          const height = layer.height || (layer.canvas ? layer.canvas.height : 0)
          if (!width || !height) continue
          leaves.push({
            canvas: layer.canvas || null,
            imageData: layer.imageData || null,
            left: layer.left || 0,
            top: layer.top || 0,
            width,
            height,
            opacity: (layer.opacity !== undefined ? layer.opacity : 255) / 255
          })
        }
      }
    }

    collectLeaves(rootLayers)
    if (leaves.length === 0) return null

    // 2、先以原始 PSD 尺寸堆叠，保持绝对坐标与透明度
    const fullW = Math.max(1, currentPsdData.value.width || 0)
    const fullH = Math.max(1, currentPsdData.value.height || 0)
    const cvs = document.createElement('canvas')
    cvs.width = fullW
    cvs.height = fullH
    const ctx = cvs.getContext('2d')

    for (const lf of leaves) {
      try {
        ctx.globalAlpha = lf.opacity
        const x = lf.left
        const y = lf.top
        if (lf.canvas) {
          ctx.drawImage(lf.canvas, 0, 0, lf.canvas.width, lf.canvas.height, x, y, lf.width, lf.height)
        } else if (lf.imageData) {
          const img = await loadImageCached(lf.imageData)
          ctx.drawImage(img, 0, 0, img.width, img.height, x, y, lf.width, lf.height)
        }
        ctx.globalAlpha = 1
      } catch (e) {
        console.warn('组合缩略图绘制失败:', e)
      }
    }

    // 3、渲染完成后再进行裁剪，避免位置信息丢失
    const trimmed = trimWhitespace(cvs)
    return trimmed.toDataURL()
  }

  // 监听组合数据，异步生成缩略图
  watch(combinedExpressionParts, async (list) => {
    if (!Array.isArray(list)) return
    for (const combo of list) {
      const sig = getComboSignature(combo.items || [])
      if (!combinedThumbnailsMap.value.has(sig)) {
        const dataURL = await generateCombinedThumbnail(combo.items || [])
        if (dataURL) {
          combinedThumbnailsMap.value.set(sig, dataURL)
        }
      }
    }
  }, { immediate: true })

  // 2、保持模板绑定和外部调用名称兼容，内部缓存与派生结果仍只有一份。
  return {
    buildExpressionMeta,
    expressionTabMetaMap,
    combinedExpressionParts,
    enhancedExpressionTabs,
    combinedThumbnailsMap,
    getComboSignature,
    buildUniquePathMap
  }
}
