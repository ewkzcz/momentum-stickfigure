/**
 * 图层渲染工具函数集
 * 提供图层渲染相关的纯函数工具方法
 */

/**
 * 检查部件是否被选中
 * 处理流程：
 * 1、空选择返回未选中。
 * 2、按单选或多选结构比较部件路径。
 * @param {string} partPath - 部件路径
 * @param {object|array} selectedValue - 选中的值（可能是单个对象或数组）
 * @returns {boolean} 是否被选中
 */
export const isPartSelected = (partPath, selectedValue) => {
  // 1、过滤空选择。
  if (!selectedValue) return false
  // 2、多选逐项比较，单选直接比较路径。
  if (Array.isArray(selectedValue)) {
    return selectedValue.some(p => p.path === partPath)
  }
  return selectedValue.path === partPath
}

/**
 * 检查一个图层路径是否是某个已选中分组项的子项
 * 处理流程：
 * 1、遍历已选中的分组路径。
 * 2、按完整路径或带分隔符的前缀确认父子关系。
 * @param {string} layerPath - 当前图层路径  
 * @param {Set} allGroupPaths - 所有分组的图层路径集合
 * @param {Map} selectedPathsMap - 图层路径到是否选中的映射
 * @returns {boolean} 是否是选中分组项的子项
 */
export const isChildOfSelectedGroupItem = (layerPath, allGroupPaths, selectedPathsMap) => {
  // 1、遍历所有分组，过滤未选中分组。
  for (const groupPath of allGroupPaths) {
    // 如果该分组项被选中
    if (selectedPathsMap.get(groupPath)) {
      // 2、精确匹配：当前图层路径是该分组路径的直接或间接子项。
      if (layerPath.startsWith(groupPath + '/') || layerPath === groupPath) {
        return true
      }
    }
  }
  return false
}

/**
 * 检查一个图层路径是否应该被渲染（基于选中的分组项）
 * 处理流程：
 * 1、直接采用图层自身的分组选中状态。
 * 2、对遗漏收集的表情组按唯一标签路径执行回退匹配。
 * 3、从最近祖先向外查找明确选择，未找到时返回不渲染。
 * @param {string} layerPath - 当前图层路径
 * @param {Set} allGroupPaths - 所有分组的图层路径集合  
 * @param {Map} selectedPathsMap - 图层路径到是否选中的映射
 * @param {object} dynamicExpressionTabs - 动态表情标签（从外部传入）
 * @param {object} userInteracted - 用户交互状态（从外部传入）
 * @param {object} selectedParts - 选中的部件（从外部传入）
 * @returns {object} { shouldRender: boolean, isGroupMember: boolean }
 */
export const shouldLayerBeRendered = (layerPath, allGroupPaths, selectedPathsMap, dynamicExpressionTabs = { value: [] }, userInteracted = { value: {} }, selectedParts = { value: {} }) => {
  // 1、首先检查图层本身是否是分组项。
  if (allGroupPaths.has(layerPath)) {
    const isSelected = selectedPathsMap.get(layerPath)
    return { shouldRender: isSelected || false, isGroupMember: true }
  }
  
  // 2、回退逻辑：当表情分组未被正确收集到 allGroupPaths 时，基于已选中的表情路径进行匹配。
  // 关键修复：使用tab.key精确匹配，确保同名图组互不干扰
  {
    const tabs = dynamicExpressionTabs.value || []
    
    // 精确按tab.key判断：只有当当前图层路径前缀匹配该tab.path时，才使用该tab的选中状态
    for (const tab of tabs) {
      const key = tab.key
      const tabPath = tab.path || '' // 使用唯一带#路径，避免同父路径冲突
      
      // 图层是否属于该tab对应的表情组（使用唯一路径判断）
      const belongsToThisTab = layerPath.startsWith(tabPath + '/') || layerPath === tabPath
      if (!belongsToThisTab) continue
      
      const interacted = (userInteracted.value || {})[key]
      if (!interacted) continue
      
      const selected = (selectedParts.value || {})[key]
      if (!selected) {
        // 用户已操作但取消了选择 → 不渲染
        return { shouldRender: false, isGroupMember: true }
      }
      
      const selectedPath = selected.path || ''
      
      // 检查1：精确路径匹配
      if (selectedPath && selectedPath === layerPath) {
        return { shouldRender: true, isGroupMember: true }
      }
      // 检查2：子路径匹配
      if (selectedPath && layerPath.startsWith(selectedPath + '/')) {
        return { shouldRender: true, isGroupMember: true }
      }
      // 检查3：父路径匹配（选中的是子图层时，需要渲染父组）
      const layerPathWithoutHash = layerPath.split('#')[0]
      const selectedPathWithoutHash = selectedPath.split('#')[0]
      if (selectedPath && selectedPathWithoutHash.startsWith(layerPathWithoutHash + '/')) {
        return { shouldRender: true, isGroupMember: true }
      }
      
      // 属于该tab但不是被选中的路径 → 不渲染
      return { shouldRender: false, isGroupMember: true }
    }
  }
  
  // 3、找到该图层路径的所有祖先分组路径（从最具体到最不具体），采用最近的明确选择。
  const pathParts = layerPath.split('/')
  const ancestorPaths = []
  
  for (let i = pathParts.length - 1; i > 0; i--) {
    const ancestorPath = pathParts.slice(0, i).join('/')
    if (allGroupPaths.has(ancestorPath)) {
      ancestorPaths.push(ancestorPath)
    }
  }
  
  // 如果没有找到任何祖先分组路径，说明是独立图层
  if (ancestorPaths.length === 0) {
    return { shouldRender: false, isGroupMember: false } // 独立图层，不属于任何分组
  }
  
  // 检查最近的（最具体的）被选中的祖先
  // 从最具体的路径开始检查（ancestorPaths[0]是最具体的）
  for (const ancestorPath of ancestorPaths) {
    const isSelected = selectedPathsMap.get(ancestorPath)
    
    // 如果找到一个被明确选中的祖先路径
    if (isSelected === true) {
      return { shouldRender: true, isGroupMember: true }
    } else if (isSelected === false) {
      // 如果找到一个被明确取消选中的祖先路径
      return { shouldRender: false, isGroupMember: true }
    }
  }
  
  // 所有祖先都没有明确的选中状态
  return { shouldRender: false, isGroupMember: true }
}

/**
 * 识别剪切蒙版组
 * 返回一个数组，包含从当前索引开始的所有连续剪切图层的索引
 * 处理流程：
 * 1、校验图层数组和基础图层索引。
 * 2、收集基础图层后连续的剪切图层，遇到缺项或普通图层停止。
 * @param {Array} layers - 图层数组
 * @param {number} startIndex - 起始索引
 * @returns {Array} 剪切图层索引数组
 */
export const findClippingGroup = (layers, startIndex) => {
  // 1、添加防御性检查：确保 layers 是数组且索引有效。
  if (!layers || !Array.isArray(layers)) {
    console.warn('⚠️ findClippingGroup: layers 不是有效数组', layers)
    return []
  }
  
  // 添加防御性检查：确保startIndex是有效的数字
  if (typeof startIndex !== 'number' || startIndex < 0 || startIndex >= layers.length) {
    console.warn('⚠️ findClippingGroup: startIndex 无效', startIndex, 'layers.length:', layers.length)
    return []
  }
  
  const clippingIndices = []
  
  // 2、从 startIndex + 1 开始，向后查找所有剪切到当前图层的图层。
  for (let i = startIndex + 1; i < layers.length; i++) {
    // 添加安全检查：确保当前图层对象存在
    if (!layers[i]) {
      console.warn(`⚠️ findClippingGroup: 图层索引 ${i} 不存在`)
      break
    }
    
    if (layers[i].clipping) {
      clippingIndices.push(i)
    } else {
      // 遇到非剪切图层就停止
      break
    }
  }
  
  return clippingIndices
}

/**
 * 渲染剪切蒙版组
 * 处理流程：
 * 1、绘制基础图层。
 * 2、创建剪切内容画布。
 * 3、绘制连续剪切图层。
 * 4、以基础图层生成遮罩。
 * 5、用遮罩保留剪切内容的不透明交集。
 * 6、将结果叠加到主画布。
 * @param {CanvasRenderingContext2D} ctx - 主画布上下文
 * @param {object} baseLayer - 基础图层（作为遮罩）
 * @param {Array} clippingLayers - 剪切蒙版图层数组（被剪切的内容）
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 * @param {Function} renderLayerToContext - 渲染图层到上下文的函数
 */
export const renderClippingGroup = async (ctx, baseLayer, clippingLayers, canvasWidth, canvasHeight, renderLayerToContext) => {
  // 1、首先正常渲染基础图层到主画布。
  await renderLayerToContext(ctx, baseLayer, canvasWidth, canvasHeight)

  // 2、创建临时画布用于渲染剪切蒙版图层。
  const clippingCanvas = document.createElement('canvas')
  clippingCanvas.width = canvasWidth
  clippingCanvas.height = canvasHeight
  const clippingCtx = clippingCanvas.getContext('2d')

  // 3、渲染所有剪切蒙版图层到临时画布。
  for (const clippingLayer of clippingLayers) {
    await renderLayerToContext(clippingCtx, clippingLayer, canvasWidth, canvasHeight)
  }

  // 4、创建遮罩画布，以基础图层的透明度作为遮罩。
  const maskCanvas = document.createElement('canvas')
  maskCanvas.width = canvasWidth
  maskCanvas.height = canvasHeight
  const maskCtx = maskCanvas.getContext('2d')
  await renderLayerToContext(maskCtx, baseLayer, canvasWidth, canvasHeight)

  // 5、使用 destination-in 混合模式将遮罩应用到剪切图层。
  // 这样剪切图层只在基础图层的不透明区域显示，同时保持原有颜色（包括白色）
  clippingCtx.globalCompositeOperation = 'destination-in'
  clippingCtx.drawImage(maskCanvas, 0, 0)
  clippingCtx.globalCompositeOperation = 'source-over'

  // 6、将裁剪后的剪切图层绘制到主画布。
  ctx.drawImage(clippingCanvas, 0, 0)
}

/**
 * 将灰度值写入alpha通道
 * 处理流程：
 * 1、逐像素读取灰度，按需反转后写入透明通道并将颜色设为白色。
 * @param {Uint8ClampedArray} data - 图像数据
 * @param {boolean} invert - 是否反转
 */
const writeGrayToAlpha = (data, invert = true) => {
  // 1、每四个通道处理一个像素，仅以红色通道代表灰度。
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i]
    const alpha = invert ? (255 - gray) : gray
    data[i] = 255
    data[i + 1] = 255
    data[i + 2] = 255
    data[i + 3] = alpha
  }
}

/**
 * 将PSD图层蒙版转换为整画布alpha遮罩并应用到临时上下文
 * 优化版本：确保像素级精确度，无质量损失
 * 规则：
 * - 使用标准灰度计算公式获取蒙版alpha值
 * - 使用高质量插值方法进行缩放
 * - 像素级精确对齐，避免亚像素偏移
 * - 正确处理 defaultColor 和 bounds
 * 处理流程：
 * 1、检查蒙版图像并异步加载。
 * 2、将灰度转换为透明度，处理反转和近乎全透明的回退。
 * 3、建立整画布遮罩并按蒙版边界放置局部内容。
 * 4、使用透明交集应用遮罩，传播加载或绘制异常。
 * @param {CanvasRenderingContext2D} tempCtx - 临时上下文
 * @param {object} layer - 图层对象
 * @param {number} x - x坐标
 * @param {number} y - y坐标
 * @param {number} width - 宽度
 * @param {number} height - 高度
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 */
export const applyLayerMask = async (tempCtx, layer, x, y, width, height, canvasWidth, canvasHeight) => {
  // 1、无蒙版直接完成，其余等待蒙版图像加载。
  return new Promise((resolve, reject) => {
    try {
      const mask = layer.mask
      if (!mask || !mask.imageData) {
        resolve()
        return
      }

      const maskImg = new Image()
      maskImg.onload = () => {
        try {
          // 计算蒙版位置和尺寸（使用??运算符正确处理0值）
          const maskX = mask.left ?? 0
          const maskY = mask.top ?? 0
          const maskRight = mask.right ?? (maskX + maskImg.width)
          const maskBottom = mask.bottom ?? (maskY + maskImg.height)
          const destW = maskRight - maskX
          const destH = maskBottom - maskY

          // 2、处理蒙版：将灰度转换为透明通道，并检查是否需要反转。
          const srcW = maskImg.width
          const srcH = maskImg.height
          const procCanvas = document.createElement('canvas')
          procCanvas.width = srcW
          procCanvas.height = srcH
          const procCtx = procCanvas.getContext('2d', { 
            willReadFrequently: true,
            alpha: true
          })
          
          procCtx.imageSmoothingEnabled = false
          procCtx.drawImage(maskImg, 0, 0)
          
          const imgData = procCtx.getImageData(0, 0, srcW, srcH)
          const data = imgData.data
          let invert = !!mask.invert
          
          // PSD蒙版已是灰度图，直接使用R通道作为alpha
          for (let i = 0; i < data.length; i += 4) {
            const gray = data[i]
            const alpha = invert ? (255 - gray) : gray
            data[i] = 255
            data[i + 1] = 255
            data[i + 2] = 255
            data[i + 3] = alpha
          }
          procCtx.putImageData(imgData, 0, 0)

          // 检测是否需要自动反转（仅当明确未设置invert且alpha极低时）
          let alphaMin = 255, alphaMax = 0
          for (let i = 3; i < data.length; i += 4) {
            const a = data[i]
            if (a < alphaMin) alphaMin = a
            if (a > alphaMax) alphaMax = a
          }
          
          if (!mask.invert && alphaMax < 8) {
            invert = true
            // 重新从源图获取并反转
            procCtx.imageSmoothingEnabled = false
            procCtx.drawImage(maskImg, 0, 0, srcW, srcH)
            const imgData2 = procCtx.getImageData(0, 0, srcW, srcH)
            writeGrayToAlpha(imgData2.data, true)
            procCtx.putImageData(imgData2, 0, 0)
            // 更新统计
            const sd = imgData2.data
            alphaMin = 255; alphaMax = 0
            for (let i = 3; i < sd.length; i += 4) {
              const a = sd[i]
              if (a < alphaMin) alphaMin = a
              if (a > alphaMax) alphaMax = a
            }
          }

          // 3、构造整画布大小的透明度蒙版，保留边界外的默认透明度。
          const fullMaskCanvas = document.createElement('canvas')
          fullMaskCanvas.width = canvasWidth
          fullMaskCanvas.height = canvasHeight
          const fullMaskCtx = fullMaskCanvas.getContext('2d', { 
            willReadFrequently: true,
            alpha: true
          })
          
          // 计算 defaultAlpha（用于后续判断）
          const defaultAlpha = (mask.defaultColor !== undefined ? mask.defaultColor : 255) / 255
          
          // 先用 defaultAlpha 填充整画布，确保 bounds 外按 PSD 规则处理
          fullMaskCtx.fillStyle = `rgba(255, 255, 255, ${defaultAlpha})`
          fullMaskCtx.fillRect(0, 0, canvasWidth, canvasHeight)

          // 将处理后的局部蒙版精确放置到其边界位置。
          // 如果需要缩放，使用高质量插值
          const needsScaling = (srcW !== destW || srcH !== destH)
          
          if (needsScaling) {
            // 需要缩放时使用高质量插值
            fullMaskCtx.imageSmoothingEnabled = true
            fullMaskCtx.imageSmoothingQuality = 'high'
          } else {
            // 无需缩放时禁用平滑以保持像素精度
            fullMaskCtx.imageSmoothingEnabled = false
          }
          
          // 无缩放时，使用 putImageData 精确像素写入，避免插值产生缝隙
          if (!needsScaling) {
            fullMaskCtx.putImageData(imgData, Math.round(maskX), Math.round(maskY))
          } else {
            // 缩放时使用 copy 且禁用平滑，避免插值边界缝
            const prevDrawOp = fullMaskCtx.globalCompositeOperation
            fullMaskCtx.imageSmoothingEnabled = false
            fullMaskCtx.globalCompositeOperation = 'copy'
            fullMaskCtx.drawImage(procCanvas, 0, 0, srcW, srcH, maskX, maskY, destW, destH)
            fullMaskCtx.globalCompositeOperation = prevDrawOp
          }

          // 4、套用蒙版：以 destination-in 方式与临时绘制内容相交。
          if (alphaMax === 0 && defaultAlpha === 0) {
            // 蒙版整体透明，跳过
          } else {
            tempCtx.imageSmoothingEnabled = false
            const prevOp = tempCtx.globalCompositeOperation
            tempCtx.globalCompositeOperation = 'destination-in'
            tempCtx.drawImage(fullMaskCanvas, 0, 0, canvasWidth, canvasHeight)
            tempCtx.globalCompositeOperation = prevOp
          }

          resolve()
        } catch (err) {
          reject(err)
        }
      }
      maskImg.onerror = () => reject(new Error('蒙版图像加载失败'))
      maskImg.src = mask.imageData
    } catch (error) {
      reject(error)
    }
  })
}

/**
 * 将图层渲染到指定的上下文（不直接影响主 canvas）
 * 处理流程：
 * 1、选取图像源并异步加载，无图像时直接完成。
 * 2、设置坐标、透明度与混合模式。
 * 3、有蒙版时先在临时画布合成，再输出并恢复上下文。
 * @param {CanvasRenderingContext2D} ctx - 上下文
 * @param {object} layer - 图层对象
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 */
export const renderLayerToContext = async (ctx, layer, canvasWidth, canvasHeight) => {
  // 1、读取图层图像或画布编码，等待图像加载完成。
  return new Promise((resolve, reject) => {
    try {
      const imageSource = layer.imageData || (layer.canvas ? layer.canvas.toDataURL?.() : null)
      
      if (!imageSource) {
        console.warn(`⚠️ 图层 ${layer.name} 没有图像源`)
        resolve()
        return
      }
      
      const img = new Image()
      
      img.onload = async () => {
        try {
          // 2、保持原始坐标精度，避免与蒙版位置不匹配，并设置图层绘制属性。
          let x = layer.left || 0
          let y = layer.top || 0
          let width = layer.width || img.width
          let height = layer.height || img.height
          
          ctx.save()
          
          // 设置高质量渲染
          ctx.imageSmoothingEnabled = true
          ctx.imageSmoothingQuality = 'high'
          
          // 设置透明度
          let opacity = (layer.opacity !== undefined ? layer.opacity : 255) / 255
          if (opacity < 0.1 && layer.opacity > 0) {
            opacity = 1.0
          }
          ctx.globalAlpha = opacity
          
          // 设置混合模式
          if (layer.blendMode && layer.blendMode !== 'normal') {
            const blendModeMap = {
              'multiply': 'multiply',
              'screen': 'screen',
              'overlay': 'overlay',
              'darken': 'darken',
              'lighten': 'lighten',
              'color-dodge': 'color-dodge',
              'color-burn': 'color-burn',
              'hard-light': 'hard-light',
              'soft-light': 'soft-light',
              'difference': 'difference',
              'exclusion': 'exclusion'
            }
            const mappedMode = blendModeMap[layer.blendMode] || 'source-over'
            ctx.globalCompositeOperation = mappedMode
          }
          
          // 3、检查是否有图层蒙版，选择临时合成或直接绘制。
          if (layer.mask && !layer.mask.disabled && layer.mask.imageData) {
            
            // 创建临时canvas用于应用蒙版
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = canvasWidth
            tempCanvas.height = canvasHeight
            const tempCtx = tempCanvas.getContext('2d', { 
              alpha: true,
              willReadFrequently: false
            })

            // 先保存透明度和混合模式设置
            const savedAlpha = ctx.globalAlpha
            const savedComposite = ctx.globalCompositeOperation

            // 绘制图层内容到临时canvas（使用高质量设置）
            tempCtx.imageSmoothingEnabled = true
            tempCtx.imageSmoothingQuality = 'high'
            tempCtx.globalAlpha = 1.0
            tempCtx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)

            // 通用：按PSD规则应用图层蒙版（灰度->alpha、考虑defaultColor/invert、整画布套用）
            await applyLayerMask(tempCtx, layer, x, y, width, height, canvasWidth, canvasHeight)

            // 输出到主画布（使用原始设置）
            ctx.globalAlpha = savedAlpha
            ctx.globalCompositeOperation = savedComposite
            ctx.imageSmoothingEnabled = false  // 临时canvas到主canvas不需要平滑
            ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight)
          } else {
            // 无蒙版或蒙版已禁用，直接绘制
            ctx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)
          }
          
          ctx.restore()
          
          resolve()
        } catch (error) {
          console.error(`❌ 渲染图层 ${layer.name} 到上下文失败:`, error)
          ctx.restore()
          reject(error)
        }
      }
      
      img.onerror = (error) => {
        console.error(`❌ 图层 ${layer.name} 图像加载失败:`, error)
        reject(new Error(`图层图像加载失败: ${layer.name}`))
      }
      
      img.src = imageSource
      
    } catch (error) {
      console.error(`❌ 处理图层 ${layer.name} 失败:`, error)
      reject(error)
    }
  })
}

/**
 * 绘制单个图层图像的辅助函数
 * 处理流程：
 * 1、过滤缺失图像的图层并加载图像。
 * 2、设置位置、透明度与混合模式。
 * 3、按需合成蒙版后绘制，恢复上下文并记录异常。
 * @param {CanvasRenderingContext2D} ctx - 上下文
 * @param {object} layer - 图层对象
 */
export const drawLayerImage = async (ctx, layer) => {
  // 1、检查图层图像数据并启动异步加载。
  if (!layer.imageData) {
    return
  }
  
  try {
    const img = new Image()
    
    await new Promise((resolve, reject) => {
      img.onload = async () => {
        ctx.save()
        
        // 2、保持原始坐标精度，避免与蒙版位置不匹配，并设置绘制属性。
        const x = layer.left || 0
        const y = layer.top || 0
        const width = layer.width || img.width
        const height = layer.height || img.height
        
        // 设置高质量渲染
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        
        // 设置透明度
        let opacity = (layer.opacity !== undefined ? layer.opacity : 255) / 255
        if (opacity < 0.1 && layer.opacity > 0) {
          opacity = 1.0
        }
        ctx.globalAlpha = opacity
        
        // 设置混合模式
        if (layer.blendMode && layer.blendMode !== 'normal') {
          const blendModeMap = {
            'multiply': 'multiply',
            'screen': 'screen',
            'overlay': 'overlay',
            'darken': 'darken',
            'lighten': 'lighten',
            'color-dodge': 'color-dodge',
            'color-burn': 'color-burn',
            'hard-light': 'hard-light',
            'soft-light': 'soft-light',
            'difference': 'difference',
            'exclusion': 'exclusion'
          }
          const mappedMode = blendModeMap[layer.blendMode] || 'source-over'
          ctx.globalCompositeOperation = mappedMode
        }
        
        // 3、检查是否有图层蒙版，完成合成后恢复上下文。
        if (layer.mask && !layer.mask.disabled && layer.mask.imageData) {
          const canvasWidth = ctx.canvas.width
          const canvasHeight = ctx.canvas.height

          // 创建临时canvas用于应用蒙版
          const tempCanvas = document.createElement('canvas')
          tempCanvas.width = canvasWidth
          tempCanvas.height = canvasHeight
          const tempCtx = tempCanvas.getContext('2d', {
            alpha: true,
            willReadFrequently: false
          })

          // 在临时canvas上绘制图层内容（使用高质量设置）
          tempCtx.imageSmoothingEnabled = true
          tempCtx.imageSmoothingQuality = 'high'
          tempCtx.globalAlpha = 1.0
          tempCtx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)

          // 按PSD规则应用图层蒙版
          await applyLayerMask(tempCtx, layer, x, y, width, height, canvasWidth, canvasHeight)

          // 将应用了蒙版的内容绘制到主canvas
          ctx.imageSmoothingEnabled = false  // 临时canvas到主canvas不需要平滑
          ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight)
        } else {
          // 无蒙版，直接绘制
          ctx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)
        }

        ctx.restore()
        resolve()
      }
      
      img.onerror = () => {
        console.error(`❌ 图层 ${layer.name} 图像加载失败`)
        reject(new Error(`图像加载失败: ${layer.name}`))
      }
      
      img.src = layer.imageData
    })
  } catch (error) {
    console.error(`❌ 绘制图层 ${layer.name} 失败:`, error)
  }
}
