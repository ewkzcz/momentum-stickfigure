/** 对话框画布绘制：管理图片缓存、嵌入模式合成、蒙版处理与透明图片导出。 */
import { calculateContainSize, generateExportFileName, calculatePixelBoundingBox } from '../utils/helpers.js'

/**
 * 连接父组件的画布状态，提供原有绘制与导出能力。
 * 处理流程：
 * 1、接收原始属性、响应式引用、尺寸及延迟调用的选框和手柄回调
 * 2、创建唯一图片缓存并定义原有绘制、蒙版处理与导出函数
 * 3、返回父组件使用的绘制入口及图片加载函数
 */
export function useDialogCanvasRender({
  props,
  canvasContainer,
  ctx,
  canvasWidth,
  canvasHeight,
  embedMode,
  opacityGradientMode,
  activeObjectType,
  isDragging,
  dragCharacter,
  dragFrame,
  drawSelectionBox,
  getHandleMetrics,
  getTransformHandles
}) {
    // 1、使用父组件传入的原始引用与延迟回调，不建立额外状态或监听。
    // 2、集中持有图片缓存并保留原有绘制、蒙版和导出流程。
    // 图片缓存
    const imageCache = new Map()

    /**
     * 加载图片
     * 处理流程：
     * 1、命中缓存时直接返回图片
     * 2、否则加载图片并缓存成功结果
     */
    const loadImage = async (src) => {
      // 1、优先复用已经解码的图片。
      if (imageCache.has(src)) {
        return imageCache.get(src)
      }
      
      // 2、加载完成后写入缓存，失败则拒绝本次任务。
      return new Promise((resolve, reject) => {
        const img = new Image()
        img.crossOrigin = 'anonymous'
        img.onload = () => {
          imageCache.set(src, img)
          resolve(img)
        }
        img.onerror = reject
        img.src = src
      })
    }

    /**
     * 立即渲染（拖拽时使用，不触发watch）
     * 处理流程：
     * 1、直接等待内部绘制流程完成
     */
    const renderImmediate = async () => {
      // 1、由拖拽逻辑主动刷新当前画面。
      await renderInternal()
    }

    /**
     * 渲染画布（公开方法）
     * 处理流程：
     * 1、调用内部合成绘制并等待完成
     */
    const render = async () => {
      // 1、为父组件及监听器提供统一绘制入口。
      await renderInternal()
    }

    /**
     * 渲染画布内部实现
     * 处理流程：
     * 1、清空画布、绘制透明背景提示并检查蒙版
     * 2、在独立画布绘制人物和变换后的对话框
     * 3、按嵌入模式组合裁切、渐变、凸出与边框叠加
     * 4、绘制当前对象的选框和控制手柄
     */
    const renderInternal = async () => {
      // 1、恢复背景并在缺少蒙版时显示占位提示。
      if (!ctx.value) return
      
      // 清空画布
      ctx.value.clearRect(0, 0, canvasWidth, canvasHeight)
      
      // 绘制棋盘格背景（表示透明）
      drawCheckerboard()
      
      if (!props.dialogFrame) {
        // 显示提示文字
        drawPlaceholder('请上传对话框图片')
        return
      }
      
      try {
        // 2、加载对话框图片，并准备人物和蒙版的离屏画布。
        const frameImg = await loadImage(props.dialogFrame.imageSrc)
        
        // 使用离屏Canvas进行蒙版合成
        const offscreenCanvas = document.createElement('canvas')
        offscreenCanvas.width = canvasWidth
        offscreenCanvas.height = canvasHeight
        const offscreenCtx = offscreenCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false
        })
        
        // 启用最高质量的图像平滑
        offscreenCtx.imageSmoothingEnabled = true
        offscreenCtx.imageSmoothingQuality = 'high'
        
        // 在离屏Canvas上绘制所有人物
        // 如果正在拖拽，使用拖拽中的临时状态
        const charactersToRender = isDragging.value && dragCharacter.value
          ? props.characters.map(c => c.id === dragCharacter.value.id ? dragCharacter.value : c)
          : props.characters
        
        for (const character of charactersToRender) {
          await drawCharacterToContext(offscreenCtx, character)
        }
        
        // 获取对话框的变换（如果正在拖拽，使用拖拽中的临时状态）
        const frameToRender = isDragging.value && dragFrame.value ? dragFrame.value : props.dialogFrame
        const frameTransform = frameToRender.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0, flipHorizontal: false }
        
        // 创建临时Canvas用于绘制变换后的对话框
        const tempFrameCanvas = document.createElement('canvas')
        tempFrameCanvas.width = canvasWidth
        tempFrameCanvas.height = canvasHeight
        const tempFrameCtx = tempFrameCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false
        })
        
        tempFrameCtx.imageSmoothingEnabled = true
        tempFrameCtx.imageSmoothingQuality = 'high'
        
        // 应用对话框变换并绘制
        drawFrameWithTransform(tempFrameCtx, frameImg, frameTransform)
        
        // 计算对话框的有像素区域边界框
        const boundingBox = calculatePixelBoundingBox(tempFrameCanvas)
        
        // 准备各种蒙版和叠加层
        const alphaMask = createAlphaMask(tempFrameCanvas) // 完整对话框蒙版
        const overlayCanvas = convertWhiteToTransparent(tempFrameCanvas) // 彩色边框叠加层（白色已删除）
        
        // 3、根据不同的嵌入模式应用不同的合成策略。
        if (embedMode.value === 'direct') {
          // ========== 模式1：直接嵌入【白色背景】 ==========
          // 1. 人物被对话框完全裁切
          offscreenCtx.globalCompositeOperation = 'destination-in'
          offscreenCtx.drawImage(alphaMask, 0, 0)
          offscreenCtx.globalCompositeOperation = 'source-over'
          
          // 绘制底层对话框
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制裁切后的人物
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 顶层彩色边框
          ctx.value.drawImage(overlayCanvas, 0, 0)
          
        } else if (embedMode.value === 'opacity') {
          // ========== 模式2：不透明度嵌入【白色背景】 ==========
          // 1. 先将人物裁切到对话框区域
          offscreenCtx.globalCompositeOperation = 'destination-in'
          offscreenCtx.drawImage(alphaMask, 0, 0)
          offscreenCtx.globalCompositeOperation = 'source-over'
          
          // 2. 计算裁切后人物的有像素区域，基于此应用竖向渐变
          // 上半身保持不透明度1，下半身从中间的1渐变到底部的0
          const clippedCharBoundingBox = calculatePixelBoundingBox(offscreenCanvas)
          if (clippedCharBoundingBox) {
            applyVerticalGradientMask(offscreenCanvas, clippedCharBoundingBox, opacityGradientMode.value)
          }
          
          // 绘制底层对话框
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制渐变后的人物
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 顶层彩色边框
          ctx.value.drawImage(overlayCanvas, 0, 0)
          
        } else if (embedMode.value === 'opacity-colored') {
          // ========== 模式2：不透明度嵌入【彩色背景】 ==========
          // 1. 先将人物裁切到对话框区域
          offscreenCtx.globalCompositeOperation = 'destination-in'
          offscreenCtx.drawImage(alphaMask, 0, 0)
          offscreenCtx.globalCompositeOperation = 'source-over'
          
          // 2. 计算裁切后人物的有像素区域，基于此应用竖向渐变
          // 上半身保持不透明度1，下半身从中间的1渐变到底部的0
          const clippedCharBoundingBoxColored = calculatePixelBoundingBox(offscreenCanvas)
          if (clippedCharBoundingBoxColored) {
            applyVerticalGradientMask(offscreenCanvas, clippedCharBoundingBoxColored, opacityGradientMode.value)
          }
          
          // 绘制底层对话框
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制渐变后的人物
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 不叠加删除白色像素的边框，保留完整对话框效果
          
        } else if (embedMode.value === 'protrude') {
          // ========== 模式3：头部凸出【白色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切（和直接嵌入一样）
          if (boundingBox) {
            // 创建混合蒙版：上半部分全透明（保留人物），下半部分是对话框形状（裁切人物）
            const hybridMask = document.createElement('canvas')
            hybridMask.width = canvasWidth
            hybridMask.height = canvasHeight
            const hybridMaskCtx = hybridMask.getContext('2d', { willReadFrequently: true })
            
            // 1. 先绘制完整的对话框蒙版
            hybridMaskCtx.drawImage(alphaMask, 0, 0)
            
            // 2. 清除上半部分（centerY以上），让上半身人物完整显示
            const imageData = hybridMaskCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const data = imageData.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                data[index + 3] = 255 // 设置为完全不透明，保留人物
              }
            }
            
            hybridMaskCtx.putImageData(imageData, 0, 0)
            
            // 3. 应用混合蒙版：上半部分完整，下半部分被裁切
            offscreenCtx.globalCompositeOperation = 'destination-in'
            offscreenCtx.drawImage(hybridMask, 0, 0)
            offscreenCtx.globalCompositeOperation = 'source-over'
          } else {
            // 降级：全部裁切
            offscreenCtx.globalCompositeOperation = 'destination-in'
            offscreenCtx.drawImage(alphaMask, 0, 0)
            offscreenCtx.globalCompositeOperation = 'source-over'
          }
          
          // 绘制底层对话框（完整）
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制处理后的人物（上半部分凸出，下半部分被裁切）
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 顶层彩色边框（只绘制下半部分，避免盖住头部）
          if (boundingBox) {
            const lowerOverlay = createLowerMask(overlayCanvas, boundingBox)
            ctx.value.drawImage(lowerOverlay, 0, 0)
          } else {
            ctx.value.drawImage(overlayCanvas, 0, 0)
          }
          
        } else if (embedMode.value === 'combined') {
          // ========== 模式4：不透明度+凸出【白色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切 + 应用渐变
          if (boundingBox) {
            // 1. 创建混合蒙版：上半部分保留人物，下半部分是对话框形状
            const hybridMask = document.createElement('canvas')
            hybridMask.width = canvasWidth
            hybridMask.height = canvasHeight
            const hybridMaskCtx = hybridMask.getContext('2d', { willReadFrequently: true })
            
            // 先绘制完整的对话框蒙版
            hybridMaskCtx.drawImage(alphaMask, 0, 0)
            
            // 清除上半部分（centerY以上），让上半身人物完整显示
            const imageData = hybridMaskCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const data = imageData.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                data[index + 3] = 255 // 设置为完全不透明，保留人物
              }
            }
            
            hybridMaskCtx.putImageData(imageData, 0, 0)
            
            // 2. 应用混合蒙版
            offscreenCtx.globalCompositeOperation = 'destination-in'
            offscreenCtx.drawImage(hybridMask, 0, 0)
            offscreenCtx.globalCompositeOperation = 'source-over'
            
            // 3. 计算处理后人物的有像素区域，基于此对下半部分应用竖向渐变
            // 上半身保持不透明度1，下半身从中间的1渐变到底部的0
            const clippedCharBoundingBox = calculatePixelBoundingBox(offscreenCanvas)
            if (clippedCharBoundingBox) {
              applyVerticalGradientMask(offscreenCanvas, clippedCharBoundingBox, opacityGradientMode.value)
            }
          }
          
          // 绘制底层对话框
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制处理后的人物
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 顶层彩色边框（只绘制下半部分）
          if (boundingBox) {
            const lowerOverlay = createLowerMask(overlayCanvas, boundingBox)
            ctx.value.drawImage(lowerOverlay, 0, 0)
          } else {
            ctx.value.drawImage(overlayCanvas, 0, 0)
          }
          
        } else if (embedMode.value === 'combined-colored') {
          // ========== 模式4：不透明度+凸出【彩色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切 + 应用渐变
          if (boundingBox) {
            // 1. 创建混合蒙版：上半部分保留人物，下半部分是对话框形状
            const hybridMaskCombined = document.createElement('canvas')
            hybridMaskCombined.width = canvasWidth
            hybridMaskCombined.height = canvasHeight
            const hybridMaskCombinedCtx = hybridMaskCombined.getContext('2d', { willReadFrequently: true })
            
            // 先绘制完整的对话框蒙版
            hybridMaskCombinedCtx.drawImage(alphaMask, 0, 0)
            
            // 清除上半部分（centerY以上），让上半身人物完整显示
            const imageDataCombined = hybridMaskCombinedCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const dataCombined = imageDataCombined.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                dataCombined[index + 3] = 255 // 设置为完全不透明，保留人物
              }
            }
            
            hybridMaskCombinedCtx.putImageData(imageDataCombined, 0, 0)
            
            // 2. 应用混合蒙版
            offscreenCtx.globalCompositeOperation = 'destination-in'
            offscreenCtx.drawImage(hybridMaskCombined, 0, 0)
            offscreenCtx.globalCompositeOperation = 'source-over'
            
            // 3. 计算处理后人物的有像素区域，基于此对下半部分应用竖向渐变
            // 上半身保持不透明度1，下半身从中间的1渐变到底部的0
            const clippedCharBoundingBoxCombined = calculatePixelBoundingBox(offscreenCanvas)
            if (clippedCharBoundingBoxCombined) {
              applyVerticalGradientMask(offscreenCanvas, clippedCharBoundingBoxCombined, opacityGradientMode.value)
            }
          }
          
          // 绘制底层对话框
          ctx.value.drawImage(tempFrameCanvas, 0, 0)
          // 绘制处理后的人物
          ctx.value.drawImage(offscreenCanvas, 0, 0)
          // 不叠加删除白色像素的边框，保留完整对话框效果
        }
        
        // 4、如果有激活的人物，绘制选中框，并按当前目标绘制控制手柄。
        // 如果正在拖拽，使用拖拽中的临时状态
        const activeCharToRender = isDragging.value && dragCharacter.value && props.activeCharacter?.id === dragCharacter.value.id
          ? dragCharacter.value
          : props.activeCharacter
        
        if (activeObjectType.value === 'character' && activeCharToRender) {
          drawSelectionBox(activeCharToRender)
        }

        // 当激活对象为frame时，绘制对话框的蓝色选框与抓手
        if (activeObjectType.value === 'frame') {
          await (async () => {
            const transform = frameTransform
            const { handleSize, rotateHandleDistance, rotateHandleRadius } = getHandleMetrics()
            const fitSize = calculateContainSize(
              frameImg.naturalWidth,
              frameImg.naturalHeight,
              canvasWidth,
              canvasHeight
            )
            const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
            const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
            const width = fitSize.width * sx
            const height = fitSize.height * sy
            const centerX = canvasWidth / 2 + transform.x
            const centerY = canvasHeight / 2 + transform.y
            
            ctx.value.save()
            ctx.value.translate(centerX, centerY)
            ctx.value.rotate(transform.rotation * Math.PI / 180)
            ctx.value.strokeStyle = '#2563eb'
            ctx.value.lineWidth = 2
            ctx.value.strokeRect(-width / 2, -height / 2, width, height)
            ctx.value.restore()
            
            const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
            if (handles.rotate) {
              ctx.value.save()
              ctx.value.strokeStyle = '#6b7280'
              ctx.value.lineWidth = 1
              ctx.value.setLineDash([3, 3])
              ctx.value.beginPath()
              ctx.value.moveTo(handles.n.x, handles.n.y)
              ctx.value.lineTo(handles.rotate.x, handles.rotate.y)
              ctx.value.stroke()
              ctx.value.setLineDash([])
              ctx.value.restore()
            }
            ctx.value.fillStyle = '#ffffff'
            ctx.value.strokeStyle = '#2563eb'
            ctx.value.lineWidth = 1.5
            for (const [key, handle] of Object.entries(handles)) {
              if (key === 'rotate') continue
              ctx.value.fillRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize)
              ctx.value.strokeRect(handle.x - handleSize / 2, handle.y - handleSize / 2, handleSize, handleSize)
            }
            if (handles.rotate) {
              ctx.value.save()
              ctx.value.fillStyle = '#ffffff'
              ctx.value.strokeStyle = '#10b981'
              ctx.value.lineWidth = 2
              ctx.value.beginPath()
              ctx.value.arc(handles.rotate.x, handles.rotate.y, rotateHandleRadius, 0, Math.PI * 2)
              ctx.value.fill()
              ctx.value.stroke()
              ctx.value.strokeStyle = '#10b981'
              ctx.value.lineWidth = 1.5
              ctx.value.beginPath()
              ctx.value.arc(handles.rotate.x, handles.rotate.y, Math.max(4, rotateHandleRadius - 4), 0, Math.PI * 1.5)
              ctx.value.stroke()
              ctx.value.restore()
            }
          })()
        }
        
      } catch (error) {
        console.error('渲染失败:', error)
        drawPlaceholder('图片加载失败')
      }
    }

    /**
     * 绘制棋盘格背景（自适应主题）
     * 处理流程：
     * 1、读取主题标记，必要时按容器背景亮度判断
     * 2、交替绘制当前主题对应的棋盘格颜色
     */
    const drawCheckerboard = () => {
      // 1、确定网格数量并识别当前明暗主题。
      const size = 10 // 缩小棋盘格尺寸，使其更细密
      const rows = Math.ceil(canvasHeight / size)
      const cols = Math.ceil(canvasWidth / size)
      
      // 检测当前主题（多种方式检测，确保准确）
      let isDarkTheme = document.documentElement.classList.contains('dark') || 
                        document.body.classList.contains('dark') ||
                        document.documentElement.getAttribute('data-theme') === 'dark' ||
                        window.matchMedia('(prefers-color-scheme: dark)').matches

      // 兜底：读取容器的实际背景色，判断是否为暗色
      if (!isDarkTheme && canvasContainer.value) {
        try {
          const style = window.getComputedStyle(canvasContainer.value)
          const bg = style.backgroundColor || style.background
          // 简单判断：亮度阈值，小于此认为是暗色
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(bg)
          if (m) {
            const r = parseInt(m[1], 10)
            const g = parseInt(m[2], 10)
            const b = parseInt(m[3], 10)
            const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
            if (luminance < 150) {
              isDarkTheme = true
            }
          }
        } catch (_) {}
      }
      
      // 2、根据主题选择颜色并交替填充网格。
      const color1 = isDarkTheme ? '#3a3a3a' : '#ffffff'
      const color2 = isDarkTheme ? '#2e2e2e' : '#e5e5e5'
      
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          ctx.value.fillStyle = (row + col) % 2 === 0 ? color1 : color2
          ctx.value.fillRect(col * size, row * size, size, size)
        }
      }
    }

    /**
     * 绘制占位符文字
     * 处理流程：
     * 1、设置文字样式并在画布中心显示提示
     */
    const drawPlaceholder = (text) => {
      // 1、居中绘制当前画布状态提示。
      ctx.value.fillStyle = '#999'
      ctx.value.font = '24px sans-serif'
      ctx.value.textAlign = 'center'
      ctx.value.textBaseline = 'middle'
      ctx.value.fillText(text, canvasWidth / 2, canvasHeight / 2)
    }

    /**
     * 保存绘制上下文的预留蒙版入口。
     * 处理流程：
     * 1、保存当前上下文状态
     */
    const createClippingMask = async (frameImg) => {
      // 1、该入口当前只保存上下文，实际蒙版合成由渲染流程完成。
      ctx.value.save()
      
    }

    /**
     * 将图片的白色像素转换为透明像素
     * 处理流程：
     * 1、复制源画布并读取像素
     * 2、将三个颜色通道都达到阈值的像素设为透明
     * 3、写回处理后的像素并返回画布
     */
    const convertWhiteToTransparent = (sourceCanvas, whiteThreshold = 245) => {
      // 1、创建独立副本，避免修改原始对话框。
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = sourceCanvas.width
      tempCanvas.height = sourceCanvas.height
      const tempCtx = tempCanvas.getContext('2d', {
        alpha: true,
        willReadFrequently: true
      })
      
      // 绘制源图像
      tempCtx.drawImage(sourceCanvas, 0, 0)
      
      // 获取图像数据
      const imageData = tempCtx.getImageData(0, 0, tempCanvas.width, tempCanvas.height)
      const data = imageData.data
      
      // 2、遍历所有像素，将白色（或接近白色）转为透明。
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i]
        const g = data[i + 1]
        const b = data[i + 2]
        const a = data[i + 3]
        
        // 如果是白色或接近白色，将alpha设为0
        if (r >= whiteThreshold && g >= whiteThreshold && b >= whiteThreshold) {
          data[i + 3] = 0 // 设置alpha为0（完全透明）
        }
      }
      
      // 3、将处理后的数据放回并返回副本。
      tempCtx.putImageData(imageData, 0, 0)
      
      return tempCanvas
    }

    /**
     * 创建对话框的Alpha蒙版（只保留非透明区域）
     * 处理流程：
     * 1、复制对话框到同尺寸画布以保留原始透明度
     */
    const createAlphaMask = (frameCanvas) => {
      // 1、返回包含原始透明度的独立蒙版画布。
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = frameCanvas.width
      maskCanvas.height = frameCanvas.height
      const maskCtx = maskCanvas.getContext('2d')
      
      maskCtx.drawImage(frameCanvas, 0, 0)
      return maskCanvas
    }

    /**
     * 创建对话框下半部分的蒙版（只保留有像素区域的下半部分）
     * 处理流程：
     * 1、复制完整对话框
     * 2、清除像素边界中心线上方的透明度并返回画布
     */
    const createLowerMask = (frameCanvas, boundingBox) => {
      // 1、创建可修改的对话框副本。
      const maskCanvas = document.createElement('canvas')
      maskCanvas.width = frameCanvas.width
      maskCanvas.height = frameCanvas.height
      const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true })
      
      // 绘制完整对话框
      maskCtx.drawImage(frameCanvas, 0, 0)
      
      // 2、清除上半部分（中心线以上），保留下半部用于叠加。
      const imageData = maskCtx.getImageData(0, 0, maskCanvas.width, maskCanvas.height)
      const data = imageData.data
      
      for (let y = 0; y < boundingBox.centerY; y++) {
        for (let x = 0; x < maskCanvas.width; x++) {
          const index = (y * maskCanvas.width + x) * 4
          data[index + 3] = 0 // 清除alpha
        }
      }
      
      maskCtx.putImageData(imageData, 0, 0)
      return maskCanvas
    }

    /**
     * 对画布应用竖向渐变蒙版（根据模式应用不同的渐变效果）
     * 处理流程：
     * 1、读取像素并根据模式确定渐变起止位置
     * 2、逐行计算透明度并与原透明度相乘
     * 3、将结果写回原画布
     * @param {HTMLCanvasElement} canvas - 画布
     * @param {Object} boundingBox - 边界框
     * @param {string} mode - 渐变模式：'default' | 'fast' | 'early'
     */
    const applyVerticalGradientMask = (canvas, boundingBox, mode = 'default') => {
      // 1、依据人物有像素区域计算渐变范围。
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      
      const topY = boundingBox.top
      const centerY = boundingBox.centerY
      const bottomY = boundingBox.bottom
      const totalHeight = bottomY - topY
      
      let gradientStartY, gradientEndY
      
      if (mode === 'fast') {
        // 模式1：人物中间不透明度为1，从3/4位置直接掉到0
        gradientStartY = centerY
        gradientEndY = topY + totalHeight * 0.75
      } else if (mode === 'early') {
        // 模式2：人物1/3位置不透明度为1，从2/3位置不透明度掉到0
        gradientStartY = topY + totalHeight / 3
        gradientEndY = topY + totalHeight * 2 / 3
      } else {
        // 默认：从centerY到bottom渐变
        gradientStartY = centerY
        gradientEndY = bottomY
      }
      
      const gradientHeight = gradientEndY - gradientStartY
      
      if (gradientHeight <= 0) return
      
      // 2、按行渐隐已有像素，保持原始透明像素不变。
      for (let y = 0; y < canvas.height; y++) {
        let opacity = 1.0
        
        // 应用渐变
        if (y < gradientStartY) {
          opacity = 1.0 // 渐变开始前：完全不透明
        } else if (y >= gradientStartY && y <= gradientEndY) {
          const progress = (y - gradientStartY) / gradientHeight // 0 to 1
          opacity = 1 - progress // 1 to 0
        } else {
          opacity = 0 // 渐变结束后：完全透明
        }
        
        for (let x = 0; x < canvas.width; x++) {
          const index = (y * canvas.width + x) * 4
          if (data[index + 3] > 0) {
            data[index + 3] = data[index + 3] * opacity
          }
        }
      }
      
      // 3、提交原地处理后的像素。
      ctx.putImageData(imageData, 0, 0)
    }

    /**
     * 绘制带变换的对话框
     * 处理流程：
     * 1、计算居中位置及横纵缩放后的适配尺寸
     * 2、应用位移、旋转和翻转后绘制并恢复上下文
     */
    const drawFrameWithTransform = (targetCtx, frameImg, transform) => {
      // 1、按原始宽高比适配画布，再应用各轴缩放。
      const centerX = canvasWidth / 2 + transform.x
      const centerY = canvasHeight / 2 + transform.y
      
      // 等比contain，避免破坏宽高比
      const fitSize = calculateContainSize(
        frameImg.naturalWidth,
        frameImg.naturalHeight,
        canvasWidth,
        canvasHeight
      )
      const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
      const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
      const drawWidth = fitSize.width * sx
      const drawHeight = fitSize.height * sy
      
      // 2、隔离变换状态并完成对话框绘制。
      targetCtx.save()
      
      // 确保高质量渲染
      targetCtx.imageSmoothingEnabled = true
      targetCtx.imageSmoothingQuality = 'high'
      
      targetCtx.translate(centerX, centerY)
      
      if (transform.rotation !== 0) {
        targetCtx.rotate(transform.rotation * Math.PI / 180)
      }
      
      if (transform.flipHorizontal) {
        targetCtx.scale(-1, 1)
      }
      
      // 绘制图片
      targetCtx.drawImage(
        frameImg,
        -drawWidth / 2,
        -drawHeight / 2,
        drawWidth,
        drawHeight
      )
      
      targetCtx.restore()
    }


    /**
     * 绘制人物到指定的上下文（单纯绘制，不应用特效）
     * 处理流程：
     * 1、加载人物图片并计算等比显示尺寸
     * 2、应用人物位置、旋转与翻转并绘制
     * 3、记录单个人物的绘制失败
     */
    const drawCharacterToContext = async (targetCtx, character) => {
      // 1、读取人物图片及变换并计算显示大小。
      try {
        const img = await loadImage(character.imageSrc)
        const transform = character.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        
        // 计算绘制尺寸（contain模式）
        const fitSize = calculateContainSize(
          img.naturalWidth,
          img.naturalHeight,
          canvasWidth,
          canvasHeight
        )
        
        let drawWidth = fitSize.width * transform.scale
        let drawHeight = fitSize.height * transform.scale
        
        // 计算中心位置（允许超出画布边界）
        const centerX = canvasWidth / 2 + transform.x
        const centerY = canvasHeight / 2 + transform.y
        
        // 2、隔离变换上下文并直接绘制人物。
        targetCtx.save()
        
        // 确保高质量渲染
        targetCtx.imageSmoothingEnabled = true
        targetCtx.imageSmoothingQuality = 'high'
        
        targetCtx.translate(centerX, centerY)
        
        if (transform.rotation !== 0) {
          targetCtx.rotate(transform.rotation * Math.PI / 180)
        }
        
        if (transform.flipHorizontal) {
          targetCtx.scale(-1, 1)
        }
        
        // 绘制图片（高质量）
        targetCtx.drawImage(
          img,
          -drawWidth / 2,
          -drawHeight / 2,
          drawWidth,
          drawHeight
        )
        
        targetCtx.restore()
        
      } catch (error) {
        // 3、记录该人物的加载或绘制异常。
        console.error('绘制人物失败:', error)
      }
    }

    /**
     * 导出图片
     * 处理流程：
     * 1、确认上下文及对话框并创建透明导出画布
     * 2、绘制变换后的对话框、蒙版和全部人物
     * 3、应用当前嵌入模式的合成效果
     * 4、生成文件名并保存图片，无桌面写入接口时触发下载
     */
    const exportImage = async (exportPath) => {
      // 1、创建独立导出画布，输出不包含选框或棋盘格。
      if (!ctx.value || !props.dialogFrame) return
      
      try {
        // 创建高质量导出画布
        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = canvasWidth
        exportCanvas.height = canvasHeight
        const exportCtx = exportCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false
        })
        
        // 启用最高质量的图像平滑
        exportCtx.imageSmoothingEnabled = true
        exportCtx.imageSmoothingQuality = 'high'
        
        // 2、加载对话框图片并绘制蒙版及人物图层。
        const frameImg = await loadImage(props.dialogFrame.imageSrc)
        const frameTransform = props.dialogFrame.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        
        // 创建临时Canvas用于绘制变换后的对话框
        const tempFrameCanvas = document.createElement('canvas')
        tempFrameCanvas.width = canvasWidth
        tempFrameCanvas.height = canvasHeight
        const tempFrameCtx = tempFrameCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false
        })
        
        tempFrameCtx.imageSmoothingEnabled = true
        tempFrameCtx.imageSmoothingQuality = 'high'
        
        // 应用对话框变换并绘制
        drawFrameWithTransform(tempFrameCtx, frameImg, frameTransform)
        
        // 计算对话框的有像素区域边界框
        const boundingBox = calculatePixelBoundingBox(tempFrameCanvas)
        
        // 准备各种蒙版和叠加层
        const alphaMask = createAlphaMask(tempFrameCanvas) // 完整对话框蒙版
        const overlayCanvas = convertWhiteToTransparent(tempFrameCanvas) // 彩色边框叠加层（白色已删除）
        
        // 创建离屏Canvas用于处理人物
        const charCanvas = document.createElement('canvas')
        charCanvas.width = canvasWidth
        charCanvas.height = canvasHeight
        const charCtx = charCanvas.getContext('2d', {
          alpha: true,
          willReadFrequently: false
        })
        
        // 启用最高质量的图像平滑
        charCtx.imageSmoothingEnabled = true
        charCtx.imageSmoothingQuality = 'high'
        
        // 在临时画布上绘制所有人物
        for (const character of props.characters) {
          await drawCharacterToContext(charCtx, character)
        }
        
        // 3、根据不同的嵌入模式应用不同的合成策略。
        if (embedMode.value === 'direct') {
          // ========== 模式1：直接嵌入【白色背景】 ==========
          charCtx.globalCompositeOperation = 'destination-in'
          charCtx.drawImage(alphaMask, 0, 0)
          charCtx.globalCompositeOperation = 'source-over'
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          exportCtx.drawImage(overlayCanvas, 0, 0)
          
        } else if (embedMode.value === 'opacity') {
          // ========== 模式2：不透明度嵌入【白色背景】 ==========
          charCtx.globalCompositeOperation = 'destination-in'
          charCtx.drawImage(alphaMask, 0, 0)
          charCtx.globalCompositeOperation = 'source-over'
          
          // 计算裁切后人物的有像素区域，基于此应用渐变
          const clippedCharBoundingBox = calculatePixelBoundingBox(charCanvas)
          if (clippedCharBoundingBox) {
            applyVerticalGradientMask(charCanvas, clippedCharBoundingBox, opacityGradientMode.value)
          }
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          exportCtx.drawImage(overlayCanvas, 0, 0)
          
        } else if (embedMode.value === 'opacity-colored') {
          // ========== 模式2：不透明度嵌入【彩色背景】 ==========
          charCtx.globalCompositeOperation = 'destination-in'
          charCtx.drawImage(alphaMask, 0, 0)
          charCtx.globalCompositeOperation = 'source-over'
          
          // 计算裁切后人物的有像素区域，基于此应用渐变
          const clippedCharBoundingBoxExport = calculatePixelBoundingBox(charCanvas)
          if (clippedCharBoundingBoxExport) {
            applyVerticalGradientMask(charCanvas, clippedCharBoundingBoxExport, opacityGradientMode.value)
          }
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          // 不叠加删除白色像素的边框，保留完整对话框效果
          
        } else if (embedMode.value === 'protrude') {
          // ========== 模式3：头部凸出【白色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切（和直接嵌入一样）
          if (boundingBox) {
            // 创建混合蒙版：上半部分保留人物，下半部分是对话框形状
            const hybridMask = document.createElement('canvas')
            hybridMask.width = canvasWidth
            hybridMask.height = canvasHeight
            const hybridMaskCtx = hybridMask.getContext('2d', { willReadFrequently: true })
            
            hybridMaskCtx.drawImage(alphaMask, 0, 0)
            
            const imageData = hybridMaskCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const data = imageData.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                data[index + 3] = 255
              }
            }
            
            hybridMaskCtx.putImageData(imageData, 0, 0)
            
            charCtx.globalCompositeOperation = 'destination-in'
            charCtx.drawImage(hybridMask, 0, 0)
            charCtx.globalCompositeOperation = 'source-over'
          } else {
            charCtx.globalCompositeOperation = 'destination-in'
            charCtx.drawImage(alphaMask, 0, 0)
            charCtx.globalCompositeOperation = 'source-over'
          }
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          
          if (boundingBox) {
            const lowerOverlay = createLowerMask(overlayCanvas, boundingBox)
            exportCtx.drawImage(lowerOverlay, 0, 0)
          } else {
            exportCtx.drawImage(overlayCanvas, 0, 0)
          }
          
        } else if (embedMode.value === 'combined') {
          // ========== 模式4：不透明度+凸出【白色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切 + 应用渐变
          if (boundingBox) {
            // 1. 创建混合蒙版：上半部分保留人物，下半部分是对话框形状
            const hybridMask = document.createElement('canvas')
            hybridMask.width = canvasWidth
            hybridMask.height = canvasHeight
            const hybridMaskCtx = hybridMask.getContext('2d', { willReadFrequently: true })
            
            hybridMaskCtx.drawImage(alphaMask, 0, 0)
            
            const imageData = hybridMaskCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const data = imageData.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                data[index + 3] = 255
              }
            }
            
            hybridMaskCtx.putImageData(imageData, 0, 0)
            
            // 2. 应用混合蒙版
            charCtx.globalCompositeOperation = 'destination-in'
            charCtx.drawImage(hybridMask, 0, 0)
            charCtx.globalCompositeOperation = 'source-over'
            
            // 3. 计算处理后人物的有像素区域，基于此对下半部分应用竖向渐变
            const clippedCharBoundingBox = calculatePixelBoundingBox(charCanvas)
            if (clippedCharBoundingBox) {
              applyVerticalGradientMask(charCanvas, clippedCharBoundingBox, opacityGradientMode.value)
            }
          }
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          
          if (boundingBox) {
            const lowerOverlay = createLowerMask(overlayCanvas, boundingBox)
            exportCtx.drawImage(lowerOverlay, 0, 0)
          } else {
            exportCtx.drawImage(overlayCanvas, 0, 0)
          }
          
        } else if (embedMode.value === 'combined-colored') {
          // ========== 模式4：不透明度+凸出【彩色背景】 ==========
          // 上半部分：人物完整显示（凸出）
          // 下半部分：人物被对话框裁切 + 应用渐变
          if (boundingBox) {
            // 1. 创建混合蒙版：上半部分保留人物，下半部分是对话框形状
            const hybridMaskCombinedExport = document.createElement('canvas')
            hybridMaskCombinedExport.width = canvasWidth
            hybridMaskCombinedExport.height = canvasHeight
            const hybridMaskCombinedExportCtx = hybridMaskCombinedExport.getContext('2d', { willReadFrequently: true })
            
            hybridMaskCombinedExportCtx.drawImage(alphaMask, 0, 0)
            
            const imageDataCombinedExport = hybridMaskCombinedExportCtx.getImageData(0, 0, canvasWidth, canvasHeight)
            const dataCombinedExport = imageDataCombinedExport.data
            
            for (let y = 0; y < boundingBox.centerY; y++) {
              for (let x = 0; x < canvasWidth; x++) {
                const index = (y * canvasWidth + x) * 4
                dataCombinedExport[index + 3] = 255
              }
            }
            
            hybridMaskCombinedExportCtx.putImageData(imageDataCombinedExport, 0, 0)
            
            // 2. 应用混合蒙版
            charCtx.globalCompositeOperation = 'destination-in'
            charCtx.drawImage(hybridMaskCombinedExport, 0, 0)
            charCtx.globalCompositeOperation = 'source-over'
            
            // 3. 计算处理后人物的有像素区域，基于此对下半部分应用竖向渐变
            const clippedCharBoundingBoxCombinedExport = calculatePixelBoundingBox(charCanvas)
            if (clippedCharBoundingBoxCombinedExport) {
              applyVerticalGradientMask(charCanvas, clippedCharBoundingBoxCombinedExport, opacityGradientMode.value)
            }
          }
          
          exportCtx.drawImage(tempFrameCanvas, 0, 0)
          exportCtx.drawImage(charCanvas, 0, 0)
          // 不叠加删除白色像素的边框，保留完整对话框效果
        }
        
        // 4、生成文件名并保存透明图片。
        const fileName = generateExportFileName('幻想框')
        
        // 导出为最高质量PNG
        const dataUrl = exportCanvas.toDataURL('image/png', 1.0)
        
        if (window.api && window.api.writeFile) {
          const base64Data = dataUrl.split(',')[1]
          const filePath = exportPath.endsWith('\\') || exportPath.endsWith('/') ? 
            `${exportPath}${fileName}` : 
            `${exportPath}\\${fileName}`
          
          await window.api.writeFile(filePath, base64Data)
          console.log('导出成功:', filePath)
        } else {
          // 降级方案：下载
          const link = document.createElement('a')
          link.href = dataUrl
          link.download = fileName
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
        }
        
      } catch (error) {
        console.error('导出失败:', error)
        throw error
      }
    }

    // 3、供父组件继续绘制和命中检测，缓存保留唯一内部归属。
    return { loadImage, renderImmediate, render, exportImage }
}
