/**
 * 部件分类逻辑 Composable
 * 
 * 职责：负责PSD图层的部件分类
 * 
 * 包含：
 * - classifyParts - 主分类函数，解析PSD图层结构
 * - 动态检测表情图组
 * - 动态检测其他分组（已禁用）
 * - 各种辅助函数（查找图层组、提取子图层、生成缩略图等）
 */

import { 
  normalizeString
} from '../utils/stringUtils.js'
import { 
  getFrontHandSpecialNames,
  getCustomGroupNames,
  classifyFrontHandParts,
  shouldExcludeNonFrontView
} from '../utils/psdClassifyUtils.js'

/**
 * 分类图层部件（查找图层组并提取其直接子图层）
 * 处理流程：
 * 1、初始化分类结果以及路径搜索、缩略图生成工具。
 * 2、按自定义名称提取固定部件组。
 * 3、扫描表情组并生成可区分同名组的标签。
 * 4、补齐未启用的动态分组，返回分类结果。
 * @param {Object} psdData - PSD数据对象
 * @returns {Promise<Object>} 分类结果对象
 */
export const classifyParts = async (psdData) => {
  // 1、建立统一结果结构，并准备图层查找与预览生成逻辑。
  try {
    const parts = {
      frontHand: [], // 前手原始数据（内部使用）
      frontHandNormal: [], // 前手
      frontHandRight: [], // 前手(右手)
      frontHandBoth: [], // 前手(双手)
      backHand: [],
      frontLayerBackHand: [],
      bothHands: [],
      upperBody: [],
      lowerBody: [],
      action: [],
      expressions: {}, // 动态表情图组存储（key-value对）
      expressionTabs: [] // 动态表情标签页配置
    }
    
    /**
     * 按堆叠顺序查找名称匹配的图层组。
     * 处理流程：
     * 1、构造同名图层的唯一路径映射。
     * 2、倒序递归搜索，并检查祖先可见性、视角和路径前缀。
     * 3、返回首个符合条件的组并记录候选诊断。
     */
    const findGroupByName = (layers, targetNames, parentPath = '', options = {}) => {
      // 1、准备过滤选项与图层路径索引。
      const {
        excludeNonFrontView = true,  // 默认排除侧面/背面
        preferredPathPrefix = null,  // 优先匹配的路径前缀（用于精确定位）
        findAll = false              // 是否查找所有匹配（默认只返回最优）
      } = options
      
      let foundResult = null
      const allMatches = []  // 用于日志记录
      
      /**
       * 为图层对象建立与部件提取一致的唯一路径。
       * 处理流程：
       * 1、正向统计同名图层并记录路径。
       * 2、为子层级使用新的计数表递归建图。
       */
      const buildPathMap = (layers, currentPath = '', pathMap = new Map(), nameCountMap = new Map()) => {
        // 1、同级同名图层通过序号后缀区分。
        for (let i = 0; i < layers.length; i++) {
          const layer = layers[i]
          
          // 处理同名图层：添加索引后缀（与 extractDirectChildren 保持一致）
          let uniqueName = layer.name
          if (nameCountMap.has(layer.name)) {
            const count = nameCountMap.get(layer.name)
            nameCountMap.set(layer.name, count + 1)
            uniqueName = `${layer.name}#${count + 1}`
          } else {
            nameCountMap.set(layer.name, 1)
          }
          
          const layerPath = currentPath ? `${currentPath}/${uniqueName}` : uniqueName
          
          // 记录映射：原始路径 -> 唯一路径
          if (!pathMap.has(layer)) {
            pathMap.set(layer, layerPath)
          }
          
          // 2、递归处理子图层，每一层使用新的同名计数表。
          if (layer.children && layer.children.length > 0) {
            buildPathMap(layer.children, layerPath, pathMap, new Map())
          }
        }
        
        return pathMap
      }
      
      /**
       * 检查目标路径上所有祖先图层的可见性。
       * 处理流程：
       * 1、逐级反查路径索引，祖先缺失或明确隐藏时返回否。
       * 2、全部祖先可见时返回是，不检查目标自身。
       */
      const isPathVisible = (targetPath, pathMap, rootLayers) => {
        // 1、逐级检查祖先，避免选中不可见路径下的同名分组。
        const pathParts = targetPath.split('/').filter(p => p)
        
        // 从根开始，逐级检查每个父级的可见性
        let currentPath = ''
        for (let i = 0; i < pathParts.length - 1; i++) {  // 不检查最后一级（目标本身）
          currentPath = currentPath ? `${currentPath}/${pathParts[i]}` : pathParts[i]
          
          // 在 pathMap 中反查找到对应的图层对象
          let foundLayer = null
          for (const [layer, path] of pathMap.entries()) {
            if (path === currentPath) {
              foundLayer = layer
              break
            }
          }
          
          if (!foundLayer) {
            console.log(`  ⚠️ [路径检查] 找不到父级图层: ${currentPath}`)
            return false
          }
          
          if (foundLayer.visible === false) {
            console.log(`  ⏭️ [路径检查] 父级图层隐藏: ${currentPath}, 导致整个路径不可用`)
            return false
          }
        }
        
        return true
      }
      
      // 先构建路径映射表
      const pathMap = buildPathMap(layers, parentPath)
      
      // 2、按 PSD 堆叠顺序搜索首个满足条件的图层组。
      /**
       * 倒序递归查找满足筛选条件的分组。
       * 处理流程：
       * 1、优先递归子图层，再匹配当前图层名称。
       * 2、过滤视角、祖先可见性与路径前缀，记录首个可用结果。
       */
      const search = (layers, rootLayers) => {
        // 1、从后往前遍历，优先检查上层图层的子组。
        for (let i = layers.length - 1; i >= 0; i--) {
          if (foundResult) break  // 已找到，停止搜索
          
          const layer = layers[i]
          const layerName = normalizeString(layer.name || '')
          const layerPath = pathMap.get(layer) // 使用预先构建的路径
          
          // 先递归搜索子图层（子图层在逻辑上"更上层"）
          if (layer.children && layer.children.length > 0) {
            search(layer.children, rootLayers)
            if (foundResult) break
          }
          
          // 检查当前图层是否精确匹配目标名称
          const matched = targetNames.some(name => {
            const normalizedTarget = normalizeString(name)
            return layerName === normalizedTarget
          })
          
          if (matched) {
            const isVisible = layer.visible !== false
            allMatches.push({ path: layerPath, isVisible, excluded: false, reason: '' })
            
            // 2、检查视角、祖先状态及指定路径前缀。
            if (excludeNonFrontView && shouldExcludeNonFrontView(layerPath)) {
              console.log(`  ⏭️ [z-index搜索] 跳过非正面视角: ${layerPath}`)
              allMatches[allMatches.length - 1].excluded = true
              allMatches[allMatches.length - 1].reason = '非正面视角'
              continue
            }
            
            // 检查整个路径的父级是否都可见
            if (!isPathVisible(layerPath, pathMap, rootLayers)) {
              console.log(`  ⏭️ [z-index搜索] 跳过（父级路径不可用）: ${layerPath}`)
              allMatches[allMatches.length - 1].excluded = true
              allMatches[allMatches.length - 1].reason = '父级隐藏'
              continue
            }
            
            // 如果指定了路径前缀，检查是否匹配
            if (preferredPathPrefix) {
              if (layerPath.startsWith(preferredPathPrefix) || layerPath.includes(`/${preferredPathPrefix}`)) {
                foundResult = { layer, path: layerPath }
                console.log(`✅ [z-index搜索] 找到精确路径前缀"${preferredPathPrefix}": ${layerPath}`)
                break
              } else {
                console.log(`  ⏩ [z-index搜索] 跳过（路径前缀不匹配）: ${layerPath}`)
                allMatches[allMatches.length - 1].excluded = true
                allMatches[allMatches.length - 1].reason = '路径前缀不匹配'
                continue
              }
            }
            
            // 找到第一个符合条件的图层（父级可见 + 非侧面/背面 + 符合路径前缀）
            foundResult = { layer, path: layerPath }
            console.log(`✅ [z-index搜索] 找到可用图层: ${layerPath}`)
            break
          }
        }
      }
      
      search(layers, layers)
      
      // 3、记录匹配候选，返回最终找到的分组。
      if (allMatches.length > 1) {
        console.log(`⚠️ 发现${allMatches.length}个同名图组:`)
        allMatches.forEach(m => {
          const status = m.excluded ? `❌排除(${m.reason})` : (m.path === foundResult?.path ? '✅选中' : '⏭️跳过')
          console.log(`  ${status} ${m.path} [${m.isVisible ? '可见' : '隐藏'}]`)
        })
      }
      
      return foundResult
    }
    
    /**
     * 递归收集名称匹配的分组。
     * 处理流程：
     * 1、规范化名称并按选项过滤非正面视角。
     * 2、记录匹配项及可见性，并继续递归子图层。
     */
    const findAllMatchingGroups = (layers, targetNames, parentPath = '', results = [], options = {}) => {
      // 1、根据调用选项决定是否排除其他视角。
      const {
        excludeNonFrontView = true  // 默认排除侧面/背面
      } = options
      
      for (const layer of layers) {
        // 使用normalizeString规范化图层名称：去除空格、统一标点符号、转小写
        const layerName = normalizeString(layer.name || '')
        const layerPath = parentPath ? `${parentPath}/${layer.name}` : layer.name
        
        // 检查是否精确匹配目标名称
        const matchedName = targetNames.find(name => {
          const normalizedTarget = normalizeString(name)
          return layerName === normalizedTarget
        })
        
        if (matchedName) {
          // 检查是否应该排除（侧面/背面等）
          if (excludeNonFrontView && shouldExcludeNonFrontView(layerPath)) {
            console.log(`  ⏭️ 跳过非正面视角: ${layerPath}`)
          } else {
            // 生成规范化名称：只保留中文、英文、数字，移除所有特殊符号（用于生成唯一key）
            const normalizedKey = layer.name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
            
            // 检查图层可见性（记录状态但不过滤）
            const isVisible = layer.visible !== false
            
            // 添加所有匹配的图层到结果（包括隐藏的图层）
            // 这样用户可以通过页面控制来显示隐藏的表情图层组
            results.push({
              name: layer.name,
              normalizedName: normalizedKey,
              matchedName: matchedName,
              layer,
              path: layerPath,
              isVisible
            })
            
            if (!isVisible) {
              console.log(`  ℹ️  收集隐藏的表情图层组: ${layerPath} (可通过页面显示)`)
            }
          }
        }
        
        // 2、继续递归子图层，将所有匹配结果累积到同一列表。
        if (layer.children && layer.children.length > 0) {
          findAllMatchingGroups(layer.children, targetNames, layerPath, results, options)
        }
      }
      return results
    }
    
    /**
     * 将分组直接子项转换为部件选择数据。
     * 处理流程：
     * 1、检查分组及祖先隐藏状态。
     * 2、构造同名子项的唯一路径并排除无内容项。
     * 3、生成缩略图、尺寸和显示名称，返回部件列表。
     */
    const extractDirectChildren = async (groupLayer, groupPath) => {
      // 1、祖先隐藏状态将影响所有直接子项的初始显示。
      const children = []
      
      if (!groupLayer || !groupLayer.children) {
        return children
      }
      
      // 检查父级图层组的可见性，更全面地处理父图组的可见性
      let parentHidden = groupLayer.hidden || groupLayer.visible === false
      
      // 递归检查父级的父级，如果祖先级图组也被隐藏，那么当前组也应该被视为隐藏
      let currentParent = groupLayer.parent
      while (currentParent && !parentHidden) {
        if (currentParent.hidden || currentParent.visible === false) {
          parentHidden = true
          break
        }
        currentParent = currentParent.parent
      }
      
      // 2、对所有直接子项计数，确保路径与渲染侧一致。
      const nameCountMap = new Map()
      
      for (let i = 0; i < groupLayer.children.length; i++) {
        const child = groupLayer.children[i]
        const childName = child.name
        
        // 处理同名图层：添加索引后缀
        let uniqueName = childName
        if (nameCountMap.has(childName)) {
          const count = nameCountMap.get(childName)
          nameCountMap.set(childName, count + 1)
          uniqueName = `${childName}#${count + 1}`
        } else {
          nameCountMap.set(childName, 1)
        }
        
        const childPath = groupPath ? `${groupPath}/${uniqueName}` : uniqueName
        
        // 检查是否有图像数据（直接图层）
        const hasDirectImageData = !!(child.imageData || child.canvas)
        
        // 检查是否是有内容的图层组（递归检查子项是否有图像数据）
        const hasGroupContent = child.children && child.children.length > 0 && hasContentInGroup(child)
        
        // 如果是直接图层或者是有内容的图层组，就添加到列表中
        if (hasDirectImageData || hasGroupContent) {
          // 3、普通层复用图片，图层组生成合成缩略图与包围尺寸。
          let thumbnail = null
          let width = 0
          let height = 0
          
          if (hasDirectImageData) {
            // 直接图层使用自己的图像数据
            thumbnail = child.imageData || (child.canvas ? child.canvas.toDataURL?.() : null)
            width = child.width || 0
            height = child.height || 0
          } else if (hasGroupContent) {
            // 图层组使用第一个可见子项的缩略图（异步生成合成缩略图）
            thumbnail = await getFirstVisibleChildThumbnail(child)
            
            // 图层组需要计算边界来获取尺寸
            const bounds = calculateGroupBounds(child)
            width = bounds.width
            height = bounds.height
          }
          
          // 处理变体名称：去掉数字后缀（如"前手1" -> "前手"，"动作2" -> "动作"）
          const cleanedName = child.name
            .replace(/^(前手)[\d]+$/, '$1')  // 前手1, 前手2 -> 前手
            .replace(/^(动作)[\d]+$/, '$1')  // 动作1, 动作2 -> 动作
          
          children.push({
            name: cleanedName, // 显示名称去掉数字后缀
            displayName: uniqueName !== childName ? `${cleanedName} (${nameCountMap.get(childName)})` : cleanedName, // 如果有重名，显示序号
            path: childPath, // 使用唯一路径
            layer: child,
            width: width,
            height: height,
            thumbnail: thumbnail,
            // 记录隐藏状态：如果父级隐藏或子级隐藏，都算隐藏
            hidden: parentHidden || child.hidden || child.visible === false,
            // 标记是否为图层组
            isGroup: hasGroupContent && !hasDirectImageData
          })
        }
      }
      
      return children
    }
    
    /**
     * 检查分组后代是否包含可用图片内容。
     * 处理流程：
     * 1、逐项检查图片数据，子分组递归检查，发现内容即返回是。
     */
    const hasContentInGroup = (groupLayer) => {
      // 1、没有子项的组不作为可选部件。
      if (!groupLayer || !groupLayer.children) {
        return false
      }
      
      for (const child of groupLayer.children) {
        // 如果直接子项有图像数据，返回true
        if (child.imageData || child.canvas) {
          return true
        }
        
        // 如果子项是图层组，递归检查
        if (child.children && child.children.length > 0) {
          if (hasContentInGroup(child)) {
            return true
          }
        }
      }
      
      return false
    }
    
    // 缩略图缓存（避免重复生成）
    const thumbnailCache = new Map()
    
    // 图片对象缓存（避免重复加载同一imageData）
    const imageCache = new Map()
    
    /**
     * 异步加载并缓存图片对象。
     * 处理流程：
     * 1、复用已加载图片，否则创建图片并在加载成功后缓存。
     */
    const loadImage = (imageData) => {
      // 1、以图片数据作为缓存键，避免重复解码。
      if (imageCache.has(imageData)) {
        return Promise.resolve(imageCache.get(imageData))
      }
      
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.onload = () => {
          imageCache.set(imageData, img)
          resolve(img)
        }
        img.onerror = () => reject(new Error('图片加载失败'))
        img.src = imageData
      })
    }
    
    /**
     * 为分组生成可见叶子图层的合成缩略图。
     * 处理流程：
     * 1、检查缓存与分组尺寸，准备临时画布。
     * 2、递归收集有尺寸的可见叶子图层。
     * 3、按收集顺序叠加图片并缓存合成结果。
     */
    const getFirstVisibleChildThumbnail = async (groupLayer) => {
      // 1、优先复用已生成的缩略图。
      if (!groupLayer || !groupLayer.children) {
        return null
      }
      
      // 检查缓存
      const cacheKey = groupLayer.name + '_' + (groupLayer.left || 0) + '_' + (groupLayer.top || 0)
      if (thumbnailCache.has(cacheKey)) {
        return thumbnailCache.get(cacheKey)
      }
      
      // 计算图层组的边界
      const bounds = calculateGroupBounds(groupLayer)
      if (bounds.width === 0 || bounds.height === 0) {
        return null
      }
      
      // 创建临时canvas用于合成
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = bounds.width
      tempCanvas.height = bounds.height
      const ctx = tempCanvas.getContext('2d')
      
      // 收集所有需要渲染的图层（递归收集，只收集有实际内容的图层）
      const layersToRender = []
      
      // 2、收集参与缩略图合成的叶子图层。
      /**
       * 收集分组中的有效叶子图层。
       * 处理流程：
       * 1、对子分组倒序递归。
       * 2、过滤隐藏或无尺寸叶子，并记录绘制信息。
       */
      const collectLayers = (layer) => {
        // 1、分组本身不绘制，只递归其子项。
        // 如果是图层组，只递归处理子图层，不渲染图层组本身（严格对齐主画布逻辑）
        if (layer.children && layer.children.length > 0) {
          // 按照PSD顺序遍历（从后往前，因为PSD的children数组是从上到下的）
          for (let i = layer.children.length - 1; i >= 0; i--) {
            collectLayers(layer.children[i])
          }
          return // 图层组本身不渲染，只递归
        }
        
        // 2、只收集可见且具有有效图片尺寸的普通图层。
        // 检查图层可见性（不考虑父级）
        if (layer.hidden || layer.visible === false) {
          return // 普通图层被隐藏，跳过
        }
        
        // 检查是否有图像数据
        if (layer.canvas || layer.imageData) {
          const width = layer.width || (layer.canvas ? layer.canvas.width : 0)
          const height = layer.height || (layer.canvas ? layer.canvas.height : 0)
          
          // 只收集有尺寸的图层（过滤空白图层）
          if (width > 0 && height > 0) {
            layersToRender.push({
              canvas: layer.canvas,
              imageData: layer.imageData,
              left: layer.left || 0,
              top: layer.top || 0,
              width: width,
              height: height,
              opacity: (layer.opacity !== undefined ? layer.opacity : 255) / 255
            })
          }
        }
      }
      
      // 按PSD图层顺序收集（从下到上渲染）
      for (let i = groupLayer.children.length - 1; i >= 0; i--) {
        collectLayers(groupLayer.children[i])
      }
      
      if (layersToRender.length === 0) {
        return null
      }
      
      // 计算图层组的左上角位置
      let minLeft = Infinity
      let minTop = Infinity
      for (const layerInfo of layersToRender) {
        minLeft = Math.min(minLeft, layerInfo.left)
        minTop = Math.min(minTop, layerInfo.top)
      }
      
      // 3、以内容左上角为原点，按收集顺序绘制并缓存缩略图。
      for (const layerInfo of layersToRender) {
        const x = layerInfo.left - minLeft
        const y = layerInfo.top - minTop
        const w = layerInfo.width
        const h = layerInfo.height
        
        try {
          // 设置透明度
          ctx.globalAlpha = layerInfo.opacity
          
          // 优先使用canvas对象（同步绘制）
          if (layerInfo.canvas) {
            ctx.drawImage(layerInfo.canvas, 0, 0, layerInfo.canvas.width, layerInfo.canvas.height, x, y, w, h)
          } else if (layerInfo.imageData) {
            // 异步加载图片（使用缓存，避免重复加载）
            try {
              const img = await loadImage(layerInfo.imageData)
              ctx.drawImage(img, 0, 0, img.width, img.height, x, y, w, h)
            } catch (err) {
              console.warn('图片加载或绘制失败:', err)
            }
          }
          
          ctx.globalAlpha = 1.0
        } catch (error) {
          console.warn('绘制图层失败:', error)
        }
      }
      
      // 返回合成后的dataURL并缓存
      const dataURL = tempCanvas.toDataURL()
      thumbnailCache.set(cacheKey, dataURL)
      return dataURL
    }
    
    /**
     * 计算分组内所有有效尺寸图层的包围盒。
     * 处理流程：
     * 1、递归累积最小左上角与最大右下角。
     * 2、返回包围尺寸，没有有效内容时返回零尺寸。
     */
    const calculateGroupBounds = (groupLayer) => {
      // 1、初始化边界累计值并扫描分组内容。
      if (!groupLayer || !groupLayer.children) {
        return { width: 0, height: 0 }
      }
      
      let minLeft = Infinity
      let minTop = Infinity
      let maxRight = -Infinity
      let maxBottom = -Infinity
      let hasValidBounds = false
      
      /**
       * 将图层及后代的尺寸累积到分组边界。
       * 处理流程：
       * 1、合并当前有效图层矩形，再递归子图层。
       */
      const collectBounds = (layer) => {
        // 1、仅正尺寸内容参与包围盒累计。
        // 如果是直接图层（有图像数据或尺寸信息）
        if (layer.imageData || layer.canvas || (layer.width && layer.height)) {
          const left = layer.left || 0
          const top = layer.top || 0
          const width = layer.width || 0
          const height = layer.height || 0
          
          if (width > 0 && height > 0) {
            minLeft = Math.min(minLeft, left)
            minTop = Math.min(minTop, top)
            maxRight = Math.max(maxRight, left + width)
            maxBottom = Math.max(maxBottom, top + height)
            hasValidBounds = true
          }
        }
        
        // 递归处理子图层
        if (layer.children && layer.children.length > 0) {
          for (const child of layer.children) {
            collectBounds(child)
          }
        }
      }
      
      collectBounds(groupLayer)
      
      // 2、根据累计结果计算非负尺寸。
      if (hasValidBounds) {
        return {
          width: Math.max(0, maxRight - minLeft),
          height: Math.max(0, maxBottom - minTop)
        }
      }
      
      return { width: 0, height: 0 }
    }
    
    // 2、读取用户分组命名规则，提取各固定部件分类。
    const rootLayers = psdData.layerHierarchy || []
    
    // 获取自定义图组名称配置（包含代理规则）
    const customGroupNames = getCustomGroupNames()
    
    // 查找前手图层组（增强：排除侧面/背面视角）
    const frontHandResult = findGroupByName(rootLayers, customGroupNames.frontHand, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (frontHandResult) {
      parts.frontHand = await extractDirectChildren(frontHandResult.layer, frontHandResult.path)
      console.log(`✅ 找到前手图层组: ${frontHandResult.path}, 包含 ${parts.frontHand.length} 个直接子图层`)
      
      // 将前手拆分为三个子分组
      const { normalParts, rightParts, bothParts } = classifyFrontHandParts(parts.frontHand)
      parts.frontHandNormal = normalParts
      parts.frontHandRight = rightParts
      parts.frontHandBoth = bothParts
    }
    
    // 查找后手图层组（增强：排除侧面/背面视角）
    const backHandResult = findGroupByName(rootLayers, customGroupNames.backHand, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (backHandResult) {
      parts.backHand = await extractDirectChildren(backHandResult.layer, backHandResult.path)
      console.log(`🔍 找到后手图层组: ${backHandResult.path}, 包含 ${parts.backHand.length} 个直接子图层`)
      
      // 检查是否为"前层后手"变体（通过原始名称判断）
      const layerNameLower = (backHandResult.layer.name || '').replace(/\s+/g, '').toLowerCase()
      if (layerNameLower.includes('前层') || layerNameLower.includes('frontlayer')) {
        console.log(`  ℹ️  检测到"前层后手"，已代理为"后手"处理`)
        parts.frontLayerBackHand = parts.backHand
      }
    }
    
    // 查找双手图层组（增强：排除侧面/背面视角）
    const bothHandsResult = findGroupByName(rootLayers, customGroupNames.bothHands, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (bothHandsResult) {
      parts.bothHands = await extractDirectChildren(bothHandsResult.layer, bothHandsResult.path)
    }
    
    // 查找上身图层组（增强：排除侧面/背面视角）
    const upperBodyResult = findGroupByName(rootLayers, customGroupNames.upperBody, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (upperBodyResult) {
      parts.upperBody = await extractDirectChildren(upperBodyResult.layer, upperBodyResult.path)
      console.log(`🔍 找到上身图层组: ${upperBodyResult.path}, 包含 ${parts.upperBody.length} 个直接子图层`)
    }
    
    // 查找下身图层组（增强：排除侧面/背面视角）
    const lowerBodyResult = findGroupByName(rootLayers, customGroupNames.lowerBody, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (lowerBodyResult) {
      parts.lowerBody = await extractDirectChildren(lowerBodyResult.layer, lowerBodyResult.path)
      console.log(`🔍 找到下身图层组: ${lowerBodyResult.path}, 包含 ${parts.lowerBody.length} 个直接子图层`)
    }
    
    // 查找动作图层组（增强：排除侧面/背面视角）
    const actionResult = findGroupByName(rootLayers, customGroupNames.action, '', {
      excludeNonFrontView: true  // ✅ 排除侧面/背面
    })
    if (actionResult) {
      parts.action = await extractDirectChildren(actionResult.layer, actionResult.path)
      console.log(`🔍 找到动作图层组: ${actionResult.path}, 包含 ${parts.action.length} 个直接子图层`)
    }
    
    // 3、动态识别表情组，并用路径信息区分同名标签。
    // === 动态检测所有表情图层组 ===
    // 根据用户配置的表情图组名称列表，动态匹配 PSD 图层
    console.log('🔍 开始自动检测表情图层组...')
    
    // 读取表情图组配置（用于在PSD中匹配图层组名称）
    const DEFAULT_EXPRESSION_NAMES = '表情、表情(合并)、表情（合并）、表情1、表情2、任意表情、专属表情、专属表情1、专属表情2、专属表情3、专属表情【灰豆绿色】、专属表情【粉色】、辅助表情、豆豆眼、豆豆眼1、豆豆眼2、豆豆眼表情、豆豆眼表情1、豆豆眼表情2、表情豆豆眼、帅哥眼睛、眼睛女、眼睛男、眉毛、眼睛、嘴、新表情、新新表情、脸 副本、眉毛 副本、嘴 副本、眼睛 副本'
    
    let expressionTemplateNames = [] // 用于匹配PSD图层的模板名称
    let enableFuzzyMatch = true // 是否启用模糊匹配
    
    try {
      const savedConfig = localStorage.getItem('stickfigure-config')
      if (savedConfig) {
        const config = JSON.parse(savedConfig)
        
        // 读取模糊匹配开关
        enableFuzzyMatch = (config && config.enableFuzzyMatch !== undefined) 
          ? config.enableFuzzyMatch 
          : true
        
        // 读取用户配置的表情图组名称
        if (config && config.groupNames && config.groupNames.expression) {
          expressionTemplateNames = config.groupNames.expression
            .split(/[,，、\n]/)
            .map(name => name.trim())
            .filter(name => name.length > 0)
        } else {
          expressionTemplateNames = DEFAULT_EXPRESSION_NAMES
            .split(/[,，、\n]/)
            .map(name => name.trim())
            .filter(name => name.length > 0)
        }
      } else {
        expressionTemplateNames = DEFAULT_EXPRESSION_NAMES
          .split(/[,，、\n]/)
          .map(name => name.trim())
          .filter(name => name.length > 0)
      }
    } catch (error) {
      console.warn('⚠️ 读取表情配置失败，使用默认值:', error)
      expressionTemplateNames = DEFAULT_EXPRESSION_NAMES
        .split(/[,，、\n]/)
        .map(name => name.trim())
        .filter(name => name.length > 0)
      enableFuzzyMatch = true
    }
    
    console.log(`🔍 表情图组匹配模式: ${enableFuzzyMatch ? '模糊匹配' : '精确匹配'}`)
    console.log('📋 表情图组模板名称列表:', expressionTemplateNames)
    console.log('📋 模板数量:', expressionTemplateNames.length)
    
    const expressionGroups = []
    
    // 递归扫描所有图层组，根据配置使用精确匹配或模糊匹配
    // 去重策略：如果父级已经是表情图层组，跳过子级的表情图层组
    const nameCountAtLevel = new Map() // 记录每个层级的同名计数
    
    /**
     * 递归扫描可独立控制的表情图层组。
     * 处理流程：
     * 1、按层级生成唯一路径并匹配配置名称。
     * 2、排除其他视角，复合表情优先识别配置中的子组。
     * 3、记录独立表情组，递归时避免父子重复识别。
     */
    const scanForExpressionGroups = (layers, parentPath = '', depth = 0, parentIsExpression = false) => {
      // 1、为当前层级创建名称计数器，并进行名称匹配。
      const levelKey = parentPath || 'root'
      if (!nameCountAtLevel.has(levelKey)) {
        nameCountAtLevel.set(levelKey, new Map())
      }
      const nameCounter = nameCountAtLevel.get(levelKey)
      
      for (const layer of layers) {
        if (!layer.name) continue
        
        // 处理同名图层：添加索引后缀以确保路径唯一
        let uniqueName = layer.name
        if (nameCounter.has(layer.name)) {
          const count = nameCounter.get(layer.name)
          nameCounter.set(layer.name, count + 1)
          uniqueName = `${layer.name}#${count + 1}`
        } else {
          nameCounter.set(layer.name, 1)
        }
        
        const layerPath = parentPath ? `${parentPath}/${uniqueName}` : uniqueName
        
        // 规范化图层名称（用于匹配）
        const normalizedLayerName = normalizeString(layer.name)
        
        // 生成规范化名称：只保留中文、英文、数字，移除所有特殊符号（用于生成唯一key）
        const normalizedKey = layer.name.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '').toLowerCase()
        
        // 检查图层名是否匹配配置中的任何一个表情图组名称
        let matchedExpressionName = null
        
        if (enableFuzzyMatch) {
          // 模糊匹配模式：子串包含匹配
          // 优先级：精确匹配 > 最长子串匹配
          const exactMatch = expressionTemplateNames.find(template => 
            normalizeString(template) === normalizedLayerName
          )
          
          if (exactMatch) {
            matchedExpressionName = exactMatch
            console.log(`  🎯 [模糊匹配-精确] "${layer.name}" 精确匹配模板 "${exactMatch}"`)
          } else {
            // 查找所有包含匹配的模板
            const fuzzyMatches = expressionTemplateNames.filter(template => {
              const normalizedTemplate = normalizeString(template)
              return normalizedLayerName.includes(normalizedTemplate)
            })
            
            if (fuzzyMatches.length > 0) {
              // 选择最长的匹配（更具体）
              matchedExpressionName = fuzzyMatches.reduce((longest, current) => 
                normalizeString(current).length > normalizeString(longest).length ? current : longest
              )
              console.log(`  🎯 [模糊匹配-子串] "${layer.name}" 匹配模板 "${matchedExpressionName}" (候选: ${fuzzyMatches.join(', ')})`)
            }
          }
        } else {
          // 精确匹配模式
          // 先尝试精确匹配。
          matchedExpressionName = expressionTemplateNames.find(template => 
            normalizeString(template) === normalizedLayerName
          )
          
          if (matchedExpressionName) {
            console.log(`  🎯 [精确匹配-完全] "${layer.name}" 匹配模板 "${matchedExpressionName}"`)
          } else {
            // 如果精确匹配失败，检查是否包含关键词，兼容带编号或额外标记的表情名称。
            const fuzzyMatches = expressionTemplateNames.filter(template => {
              const normalizedTemplate = normalizeString(template)
              return normalizedLayerName.includes(normalizedTemplate)
            })
            
            if (fuzzyMatches.length > 0) {
              // 选择最长的匹配（更具体）
              matchedExpressionName = fuzzyMatches.reduce((longest, current) => 
                normalizeString(current).length > normalizeString(longest).length ? current : longest
              )
              console.log(`  🎯 [精确匹配-包含] "${layer.name}" 包含关键词 "${matchedExpressionName}" (候选: ${fuzzyMatches.join(', ')})`)
            }
          }
        }
        
        // 2、匹配到有效分组后检查视角与复合表情的子组结构。
        if (matchedExpressionName && layer.children && layer.children.length > 0 && !parentIsExpression) {
          // 使用统一的视角过滤函数（排除侧面、背面等视角的表情图层组）
          if (shouldExcludeNonFrontView(layerPath)) {
            console.log(`  ⏭️ 跳过非正面视角的表情: ${layerPath}`)
            // 即使跳过，也要继续扫描子图层
            if (layer.children && layer.children.length > 0) {
              scanForExpressionGroups(layer.children, layerPath, depth + 1, parentIsExpression)
            }
          } else {
            // === 检查子图层中是否有也在表情图组配置列表中的图层（特殊处理） ===
            // 场景1: 表情图组内部包含眉毛、眼睛、嘴三个子图组
            // 场景2: 用户在设置中添加了眉毛、眼睛、嘴等，希望它们被识别为独立的表情图组
            let hasExpressionSubGroups = false
            let hasEyebrow = false
            let hasEye = false
            let hasMouth = false
            const matchedSubGroups = []
            
            if (layer.children && layer.children.length > 0) {
              for (const child of layer.children) {
                if (!child.name || !child.children || child.children.length === 0) continue
                
                const childName = child.name
                const childNormalizedName = normalizeString(childName)
                
                // 检查子图层是否也匹配表情图组模板
                // 注意：子图层只认精确匹配，不使用模糊匹配，避免误判（如"嘟嘴"被识别为"嘴"）
                let matchedExpressionNameInChild = null
                
                // 只使用精确匹配来判断子图层是否是独立的表情图组
                matchedExpressionNameInChild = expressionTemplateNames.find(template => 
                  normalizeString(template) === childNormalizedName
                )
                
                if (matchedExpressionNameInChild) {
                  hasExpressionSubGroups = true
                  matchedSubGroups.push(childName)
                  
                  // 额外检查是否是眉毛、眼睛、嘴（用于判断场景1）
                  if (childName.includes('眉毛') || childName.toLowerCase().includes('eyebrow')) {
                    hasEyebrow = true
                  }
                  if (childName.includes('眼睛') || childName.toLowerCase().includes('eye')) {
                    hasEye = true
                  }
                  if (childName.includes('嘴') || childName.toLowerCase().includes('mouth')) {
                    hasMouth = true
                  }
                  
                  console.log(`    → 发现子图组也在表情配置中: ${childName} (匹配: "${matchedExpressionNameInChild}")`)
                }
              }
            }
            
            // 如果子图层中有配置的表情图组，则不添加父级，而是递归处理子图层
            // 场景1: 同时包含眉毛、眼睛、嘴三个子图组
            // 场景2: 用户自定义配置了子图组名称
            if (hasExpressionSubGroups) {
              if (hasEyebrow && hasEye && hasMouth) {
                console.log(`  🎭 [场景1] 发现复合表情图层组: ${layerPath}，包含眉毛、眼睛、嘴三个子图组，将分别识别为独立表情图组`)
              } else {
                console.log(`  🎭 [场景2] 发现复合表情图层组: ${layerPath}，子图层中有配置的表情图组 [${matchedSubGroups.join(', ')}]，将分别识别为独立表情图组`)
              }
              // 递归扫描子图层，但不标记父级为表情图层组，允许子图组被识别
              if (layer.children && layer.children.length > 0) {
                scanForExpressionGroups(layer.children, layerPath, depth + 1, false)
              }
            } else {
              // 3、记录独立表情图层组，并在递归时抑制嵌套重复。
              // 存储原始路径（用于渲染匹配）和唯一路径（用于key生成）
              const originalPath = parentPath ? `${parentPath}/${layer.name}` : layer.name
              
              // 检查图层可见性状态（用于日志记录）
              const isVisible = layer.visible !== false
              const visibilityNote = !isVisible ? ' [PSD中隐藏]' : ''
              
              expressionGroups.push({
                name: layer.name,
                normalizedName: normalizedKey, // 只包含中英文和数字，用于生成key
                matchedName: matchedExpressionName, // 匹配到的配置名称
                layer,
                path: layerPath,           // 唯一路径（带#后缀）
                originalPath: originalPath, // 原始路径（不带#后缀，用于渲染匹配）
                depth,
                isVisible // 记录可见性状态
              })
              console.log(`  ✨ 发现表情图层组: ${layerPath}${visibilityNote} (原始路径: ${originalPath}, 匹配: "${matchedExpressionName}", Key: ${normalizedKey})`)
              
              // 递归扫描子图层，但标记父级是表情图层组（子级的表情图层组将被跳过）
              if (layer.children && layer.children.length > 0) {
                scanForExpressionGroups(layer.children, layerPath, depth + 1, true)
              }
            }
          }
        } else {
          // 如果当前图层不是表情图层组，继续递归扫描子图层，保持父级状态
          if (layer.children && layer.children.length > 0) {
            scanForExpressionGroups(layer.children, layerPath, depth + 1, parentIsExpression)
          }
        }
      }
    }
    
    scanForExpressionGroups(rootLayers)
    
    console.log(`🔍 扫描到 ${expressionGroups.length} 个表情图层组`)
    
    // 按照名称长度从长到短排序，确保更具体的名称优先匹配
    expressionGroups.sort((a, b) => b.name.length - a.name.length)
    
    // 去重：检查是否有重复添加的情况
    console.log('🔍 扫描到的所有表情图层组：')
    expressionGroups.forEach((g, index) => {
      const visibilityStatus = g.isVisible ? '可见' : 'PSD中隐藏'
      console.log(`  [${index}] ${g.path} (深度: ${g.depth}, 原名: "${g.name}", 匹配: "${g.matchedName}", Key: "${g.normalizedName}", 状态: ${visibilityStatus})`)
    })
    // 动态生成表情图组数据
    parts.expressions = {} // 存储所有动态表情图组
    const tempExpressionTabs = []
    const seenKeys = new Set() // 检测重复的key
    const nameCounter = {} // 记录每个名称出现的次数
    
    for (const group of expressionGroups) {
      // 生成唯一的key（使用规范化的名称 + 路径哈希）
      // 为了确保唯一性，我们使用路径的哈希值
      const pathHash = group.path.split('').reduce((hash, char) => {
        return ((hash << 5) - hash) + char.charCodeAt(0) | 0
      }, 0)
      const key = 'expr_' + group.normalizedName + '_' + Math.abs(pathHash)
      
      // 检查key是否重复（理论上不应该重复了）
      if (seenKeys.has(key)) {
        console.warn(`⚠️ 检测到重复的key: ${key}，原名: "${group.name}"，路径: ${group.path}`)
        console.warn(`   使用备用策略：添加时间戳`)
        const fallbackKey = key + '_' + Date.now()
        seenKeys.add(fallbackKey)
        
        // 提取子图层（使用唯一路径，避免不同tab的子项路径冲突）
        const children = await extractDirectChildren(group.layer, group.path)
        parts.expressions[fallbackKey] = children
        
        // 统计同名分组数量，用于显示标签
        nameCounter[group.normalizedName] = (nameCounter[group.normalizedName] || 0) + 1
        const pathParts = group.path.split('/')
        const parentPath = pathParts.length > 1 ? pathParts[pathParts.length - 2] : group.path
        const displayLabel = nameCounter[group.normalizedName] > 1 
          ? `${group.name} (${parentPath})` 
          : group.name
        
        // 生成标签页配置
        tempExpressionTabs.push({
          key: fallbackKey,
          label: displayLabel,
          layerName: group.name,
          normalizedName: group.normalizedName,
          path: group.path,                     // 唯一路径（带#后缀）
          originalPath: group.originalPath || group.path  // 原始路径（用于渲染匹配）
        })
        
        console.log(`  ✅ [${group.name}] key=${fallbackKey}, 路径=${group.path}, 包含 ${children.length} 个子图层`)
        continue
      }
      seenKeys.add(key)
      
      // 提取子图层（使用唯一路径，避免不同tab的子项路径冲突）
      const children = await extractDirectChildren(group.layer, group.path)
      parts.expressions[key] = children
      
      // 统计同名分组数量，用于显示标签
      nameCounter[group.normalizedName] = (nameCounter[group.normalizedName] || 0) + 1
      
      // 生成标签页配置
      tempExpressionTabs.push({
        key,
        label: group.name, // 初始使用原始名称，稍后会更新
        layerName: group.name,
        normalizedName: group.normalizedName,
        path: group.path,                     // 唯一路径（带#后缀）
        originalPath: group.originalPath || group.path  // 原始路径（用于渲染匹配）
      })
      
      console.log(`  ✅ [${group.name}] key=${key}, 路径=${group.path}, 包含 ${children.length} 个子图层`)
    }
    
    // 后处理：为同名分组添加路径信息，并添加父级路径字段用于排序
    // 先统计每个 normalizedName 对应的完整路径列表
    const nameToTabsMap = new Map()
    tempExpressionTabs.forEach(tab => {
      if (!nameToTabsMap.has(tab.normalizedName)) {
        nameToTabsMap.set(tab.normalizedName, [])
      }
      nameToTabsMap.get(tab.normalizedName).push(tab)
    })
    
    // 为每组同名标签生成区分标签
    nameToTabsMap.forEach((tabsWithSameName, normalizedName) => {
      if (tabsWithSameName.length === 1) {
        // 只有一个同名图组，不需要添加路径区分
        const tab = tabsWithSameName[0]
        const pathParts = tab.path.split('/')
        const parentPath = pathParts.length > 1 ? pathParts[pathParts.length - 2] : ''
        tab.parentPath = parentPath
        // label 保持原样
      } else {
        // 有多个同名图组，需要显示区分信息
        // 策略1：尝试用父级路径区分
        const parentPathGroups = new Map()
        tabsWithSameName.forEach(tab => {
          const pathParts = tab.path.split('/')
          const parentPath = pathParts.length > 1 ? pathParts[pathParts.length - 2] : ''
          tab.parentPath = parentPath
          
          if (!parentPathGroups.has(parentPath)) {
            parentPathGroups.set(parentPath, [])
          }
          parentPathGroups.get(parentPath).push(tab)
        })
        
        // 为每个父级路径组生成标签
        parentPathGroups.forEach((tabs, parentPath) => {
          if (tabs.length === 1) {
            // 这个父级路径下只有一个同名图组，用父级路径就能区分
            tabs[0].label = `${tabs[0].layerName} (${parentPath || '根目录'})`
          } else {
            // 同一个父级路径下有多个同名图组，需要用完整路径或序号区分
            tabs.forEach((tab, index) => {
              const pathParts = tab.path.split('/')
              if (pathParts.length > 2) {
                // 显示更多层级的路径
                const numPartsToShow = Math.min(pathParts.length - 1, 3) // 最多显示3级
                const distinguishingPath = pathParts.slice(pathParts.length - numPartsToShow - 1, pathParts.length - 1).join('/')
                tab.label = `${tab.layerName} (${distinguishingPath})`
              } else {
                // 路径层级不够，用序号区分
                tab.label = `${tab.layerName} (${parentPath || '根目录'}-${index + 1})`
              }
            })
          }
        })
      }
    })
    
    // 排序：优先显示有内容的分组，同一父级路径下的放在一起
    tempExpressionTabs.sort((a, b) => {
      // 检查是否有内容（初始化时有图层）
      const aHasContent = parts.expressions[a.key]?.length > 0
      const bHasContent = parts.expressions[b.key]?.length > 0
      
      // 有内容的排在前面
      if (aHasContent !== bHasContent) {
        return bHasContent ? 1 : -1
      }
      
      // 都有内容或都无内容时，首先按父级路径排序
      if (a.parentPath !== b.parentPath) {
        return a.parentPath.localeCompare(b.parentPath, 'zh-CN')
      }
      // 同一父级路径下，按图层名称排序
      return a.layerName.localeCompare(b.layerName, 'zh-CN')
    })
    
    // 更新动态表情标签页配置
    parts.expressionTabs = tempExpressionTabs
    
    console.log(`🎉 动态表情图组处理完成，共 ${tempExpressionTabs.length} 个标签`)
    console.log('📊 排序后的标签顺序（按父级路径分组）:')
    tempExpressionTabs.forEach((tab, index) => {
      console.log(`  [${index}] ${tab.label}`)
      console.log(`      - key: ${tab.key}`)
      console.log(`      - path: ${tab.path}`)
      console.log(`      - parentPath: ${tab.parentPath || '根目录'}`)
    })
    
    // 检查是否有重复的 key
    const keySet = new Set()
    const duplicateKeys = []
    tempExpressionTabs.forEach(tab => {
      if (keySet.has(tab.key)) {
        duplicateKeys.push(tab.key)
      }
      keySet.add(tab.key)
    })
    if (duplicateKeys.length > 0) {
      console.error('❌ 检测到重复的标签key:', duplicateKeys)
    }
    
    // === 动态检测其他分组（前手、后手、双手、上身、下身、动作）===
    /**
     * 为指定部件类型构造多实例分组数据。
     * 处理流程：
     * 1、收集匹配组，按路径键去重并提取部件。
     * 2、补充同名标签路径并按内容及父级排序。
     * 3、返回部件映射与标签列表，当前固定分组未调用此工具。
     */
    const processDynamicGroup = async (groupType, targetNames, prefix) => {
      // 1、扫描匹配项并为每个有效组生成独立键。
      console.log(`🔍 开始检测${groupType}多实例分组...`)
      const allGroups = findAllMatchingGroups(rootLayers, targetNames)
      
      if (allGroups.length === 0) {
        console.log(`  未找到${groupType}分组`)
        return { parts: {}, tabs: [] }
      }
      
      console.log(`🔍 扫描到 ${allGroups.length} 个${groupType}分组`)
      
      const groupParts = {}
      const groupTabs = []
      const seenKeys = new Set()
      const nameCounter = {}
      
      for (const group of allGroups) {
        // 生成唯一的key（使用规范化的名称 + 路径哈希）
        const pathHash = group.path.split('').reduce((hash, char) => {
          return ((hash << 5) - hash) + char.charCodeAt(0) | 0
        }, 0)
        const key = prefix + group.normalizedName + '_' + Math.abs(pathHash)
        
        // 检查key是否重复
        if (seenKeys.has(key)) {
          console.warn(`⚠️ 检测到重复的key: ${key}，跳过`)
          continue
        }
        seenKeys.add(key)
        
        // 提取子图层
        const children = await extractDirectChildren(group.layer, group.path)
        groupParts[key] = children
        
        // 统计同名分组数量
        nameCounter[group.normalizedName] = (nameCounter[group.normalizedName] || 0) + 1
        
        // 生成标签页配置
        groupTabs.push({
          key,
          label: group.name,
          layerName: group.name,
          normalizedName: group.normalizedName,
          path: group.path,
          groupType // 添加分组类型标识
        })
        
        console.log(`  ✅ [${group.name}] key=${key}, 路径=${group.path}, 包含 ${children.length} 个子图层`)
      }
      
      // 2、为同名分组添加路径信息，并排序。
      groupTabs.forEach(tab => {
        const pathParts = tab.path.split('/')
        const parentPath = pathParts.length > 1 ? pathParts[pathParts.length - 2] : ''
        tab.parentPath = parentPath
        
        if (nameCounter[tab.normalizedName] > 1) {
          tab.label = `${tab.layerName} (${parentPath})`
        }
      })
      
      // 排序：优先显示有内容的分组，同一父级路径下的放在一起
      groupTabs.sort((a, b) => {
        // 检查是否有内容（初始化时有图层）
        const aHasContent = groupParts[a.key]?.length > 0
        const bHasContent = groupParts[b.key]?.length > 0
        
        // 有内容的排在前面
        if (aHasContent !== bHasContent) {
          return bHasContent ? 1 : -1
        }
        
        // 都有内容或都无内容时，首先按父级路径排序
        if (a.parentPath !== b.parentPath) {
          return a.parentPath.localeCompare(b.parentPath, 'zh-CN')
        }
        // 同一父级路径下，按图层名称排序
        return a.layerName.localeCompare(b.layerName, 'zh-CN')
      })
      
      console.log(`🎉 ${groupType}多实例处理完成，共 ${groupTabs.length} 个标签`)
      // 3、返回可供动态标签使用的数据。
      return { parts: groupParts, tabs: groupTabs }
    }
    
    // 处理各个分组
    // 注意：前手、后手、双手已经通过代理机制整合到左手、右手、双手基础标签中，不需要创建动态标签
    // 注意：动作、上身、下身不支持多实例，始终只有一个图组
    // const frontHandDynamic = processDynamicGroup('前手', customGroupNames.frontHand, 'fh_')
    // const backHandDynamic = processDynamicGroup('后手', customGroupNames.backHand, 'bh_')
    // const bothHandsDynamic = processDynamicGroup('双手', customGroupNames.bothHands, 'both_')
    // const upperBodyDynamic = processDynamicGroup('上身', customGroupNames.upperBody, 'ub_')
    // const lowerBodyDynamic = processDynamicGroup('下身', customGroupNames.lowerBody, 'lb_')
    // const actionDynamic = processDynamicGroup('动作', customGroupNames.action, 'act_')
    
    // 4、补齐当前未启用的动态分组字段，保持结果结构统一。
    // 前手、后手、双手、动作、上身、下身不创建动态标签，设为空
    parts.frontHandDynamic = {}
    parts.frontHandDynamicTabs = []
    parts.backHandDynamic = {}
    parts.backHandDynamicTabs = []
    parts.bothHandsDynamic = {}
    parts.bothHandsDynamicTabs = []
    parts.upperBodyDynamic = {}
    parts.upperBodyDynamicTabs = []
    parts.lowerBodyDynamic = {}
    parts.lowerBodyDynamicTabs = []
    parts.actionDynamic = {}
    parts.actionDynamicTabs = []
    
    console.log('🎯 部件分类完成:')
    console.log('  前手(总计):', parts.frontHand.length)
    console.log('    ├─ 前手:', parts.frontHandNormal.length)
    console.log('    ├─ 前手(右手):', parts.frontHandRight.length)
    console.log('    └─ 前手(双手):', parts.frontHandBoth.length)
    console.log('  后手:', parts.backHand.length)
    console.log('  前层后手:', parts.frontLayerBackHand.length)
    console.log('  双手:', parts.bothHands.length)
    console.log('  上身:', parts.upperBody.length)
    console.log('  下身:', parts.lowerBody.length)
    console.log('  动作:', parts.action.length)
    console.log('  动态表情图组:')
    Object.keys(parts.expressions).forEach(key => {
      const tab = parts.expressionTabs.find(t => t.key === key)
      console.log(`    ├─ ${tab?.label || key}:`, parts.expressions[key].length)
    })
    
    return parts
    
  } catch (error) {
    console.error('❌ 分类图层失败:', error)
    return {
      frontHand: [],
      frontHandNormal: [],
      frontHandRight: [],
      frontHandBoth: [],
      backHand: [],
      frontLayerBackHand: [],
      bothHands: [],
      upperBody: [],
      lowerBody: [],
      action: [],
      expressions: {},
      expressionTabs: [],
      frontHandDynamic: {},
      frontHandDynamicTabs: [],
      backHandDynamic: {},
      backHandDynamicTabs: [],
      bothHandsDynamic: {},
      bothHandsDynamicTabs: [],
      upperBodyDynamic: {},
      upperBodyDynamicTabs: [],
      lowerBodyDynamic: {},
      lowerBodyDynamicTabs: [],
      actionDynamic: {},
      actionDynamicTabs: []
    }
  }
}
