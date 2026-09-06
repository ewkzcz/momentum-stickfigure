<template>
  <div 
    class="canvas-editor" 
    ref="canvasEditor"
  >
    <!-- 工具栏 -->
    <CanvasToolbar
      :zoom="zoom"
      :active-image="activeImage"
      :export-disabled="layers.length === 0"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @zoom-reset="resetZoom"
      @image-transform="handleImageTransform"
      @image-reset="handleImageReset"
      @image-flip-horizontal="handleImageFlipHorizontal"
      @export-all="$emit('export-all')"
      @export-batch="$emit('export-batch')"
    />

    <!-- 画布容器 -->
    <div class="canvas-container" ref="canvasContainer">
      <CanvasRenderer
        ref="canvasRenderer"
        :template="template"
        :layers="layers"
        :active-layer="activeLayer"
        :zoom="zoom"
        :active-image="activeImage"
        @layer-select="handleLayerSelect"
        @image-transform="handleImageTransform"
        @image-activate="handleImageActivate"
      />
    </div>

    <!-- 图片变换控制器（逻辑组件，不渲染UI） -->
    <ImageTransformController
      ref="transformController"
      :layers="layers"
      :active-image="activeImage"
      @layer-update="handleLayerUpdate"
      @image-select="handleImageSelect"
      @image-deselect="handleImageDeselect"
    />
  </div>
</template>

<script>
/**
 * 画布编辑器组件
 * 
 * 功能：
 * - 作为容器组件，整合所有子组件
 * - 管理画布状态（缩放、网格显示等）
 * - 管理图片激活状态和变换
 * - 处理组件间通信
 * - 提供导出功能
 */

import { ref, onMounted, onBeforeUnmount, computed, toRef, watch, nextTick } from 'vue'
import { clamp } from '../utils/helpers.js'
import { generateExportFileName } from '../utils/export-helpers.js'
import CanvasToolbar from './CanvasToolbar.vue'
import CanvasRenderer from './CanvasRenderer.vue'
import ImageTransformController from './ImageTransformController.vue'

export default {
  name: 'CanvasEditor',
  components: {
    CanvasToolbar,
    CanvasRenderer,
    ImageTransformController
  },
  props: {
    template: {
      type: Object,
      default: null
    },
    layers: {
      type: Array,
      default: () => []
    },
    activeLayer: {
      type: Object,
      default: null
    },
    activeImage: {
      type: Object,
      default: null
    }
  },
  emits: ['layer-update', 'layer-select', 'image-activate', 'export-all', 'export-batch'],
  /**
   * 协调画布子组件、图片操作与导出接口。
   * 处理流程：
   * 1、初始化组件引用和画布缩放状态
   * 2、定义事件转发、图片变换和独立画布导出
   * 3、连接焦点与生命周期并暴露编辑接口
   */
  setup(props, { emit }) {
    // 1、建立画布组件引用及共享的显示状态。
    // 组件引用
    const canvasEditor = ref(null)
    const canvasContainer = ref(null)
    const canvasRenderer = ref(null)
    const transformController = ref(null)
    
    // 画布状态
    const canvasWidth = 1920
    const canvasHeight = 1080
    const zoom = ref(1.0)
    
    // 响应式props引用
    const activeImage = toRef(props, 'activeImage')

    // 2、定义子组件事件转发、变换和独立画布导出操作。
    /**
     * 处理图层选择
     * 处理流程：
     * 1、转发选中图层
     * @param {Object} layer - 选中的图层
     */
    const handleLayerSelect = (layer) => {
      // 1、通知父组件切换选中图层。
      emit('layer-select', layer)
    }

    /**
     * 处理图片激活
     * 处理流程：
     * 1、携带画布来源转发图片激活信息
     * @param {Object|null} imageInfo - 图片信息或null（取消激活）
     */
    const handleImageActivate = (imageInfo) => {
      // 1、标记事件来自画布并通知父组件。
      emit('image-activate', imageInfo, 'canvas')
    }

    /**
     * 处理图层更新
     * 处理流程：
     * 1、转发更新后的图层数据
     * @param {Object} updatedLayer - 更新的图层
     */
    const handleLayerUpdate = (updatedLayer) => {
      // 1、提交子组件产生的图层更新。
      emit('layer-update', updatedLayer)
    }

    /**
     * 处理图片取消选择
     * 处理流程：
     * 1、发送空图片以取消激活
     */
    const handleImageDeselect = () => {
      // 1、清除父组件中的画布图片选择。
      emit('image-activate', null, 'canvas')
    }

    /**
     * 设置画布焦点
     * 处理流程：
     * 1、画布容器挂载后调用聚焦接口
     */
    const focusCanvas = () => {
      // 1、将键盘焦点移动到画布容器。
      if (canvasEditor.value) {
        canvasEditor.value.focus()
      }
    }

    /**
     * 处理图片变换
     * 处理流程：
     * 1、将变换参数交给已挂载的控制器
     * @param {Object} transformOptions - 变换选项
     */
    const handleImageTransform = (transformOptions) => {
      // 1、委托图片控制器执行变换。
      if (transformController.value) {
        transformController.value.applyTransform(transformOptions)
      }
    }

    /**
     * 处理图片变换重置
     * 处理流程：
     * 1、请求控制器恢复当前图片默认变换
     */
    const handleImageReset = () => {
      // 1、通过控制器统一重置变换数据。
      if (transformController.value) {
        transformController.value.resetTransform()
      }
    }

    /**
     * 处理图片水平翻转
     * 处理流程：
     * 1、向控制器发送水平翻转操作
     */
    const handleImageFlipHorizontal = () => {
      // 1、构造水平翻转指令并交给控制器。
      if (transformController.value) {
        transformController.value.applyTransform({
          type: 'flip',
          value: 'horizontal'
        })
      }
    }


    /**
     * 放大画布
     * 处理流程：
     * 1、增加缩放值并限制允许范围
     */
    const zoomIn = () => {
      // 1、按固定步长提高显示倍率。
      zoom.value = clamp(zoom.value + 0.1, 0.1, 3)
    }

    /**
     * 缩小画布
     * 处理流程：
     * 1、减少缩放值并限制允许范围
     */
    const zoomOut = () => {
      // 1、按固定步长降低显示倍率。
      zoom.value = clamp(zoom.value - 0.1, 0.1, 3)
    }

    /**
     * 重置缩放
     * 处理流程：
     * 1、恢复原始显示倍率
     */
    const resetZoom = () => {
      // 1、恢复百分之百缩放。
      zoom.value = 1.0
    }


    /**
     * 导出整体图片（纯净版，无UI辅助元素）
     * 处理流程：
     * 1、确认渲染器并创建透明导出画布
     * 2、绘制全部可见图层并生成文件名
     * 3、保存图片，桌面写入失败时使用浏览器下载
     * @param {string} exportPath - 导出路径
     */
    const exportAll = async (exportPath) => {
      // 1、为导出创建独立画布，避免带入界面辅助元素。
      if (!canvasRenderer.value) return
      
      try {
        // 创建纯净的导出画布
        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = canvasWidth
        exportCanvas.height = canvasHeight
        const exportCtx = exportCanvas.getContext('2d')
        
        // 清除画布，设置透明背景
        exportCtx.clearRect(0, 0, canvasWidth, canvasHeight)
        
        // 2、绘制所有可见图层（保留5px黑色边框，无网格和选中边框）。
        for (const layer of props.layers) {
          if (layer.visible) {
            await drawCleanLayer(exportCtx, layer)
          }
        }
        
        // 生成文件名
        const templateName = props.template?.name || '漫画模板'
        const fileInfo = generateExportFileName({
          presetName: templateName,
          variantName: '完整画面',
          exportPath: exportPath
        })
        
        // 导出为PNG格式
        const dataUrl = exportCanvas.toDataURL('image/png', 1.0)
        
        // 3、使用Electron的IPC保存文件，失败时回退到下载。
        if (window.api && window.api.writeFile) {
          try {
            // 提取base64数据
            const base64Data = dataUrl.split(',')[1]
            // 构建完整文件路径
            const filePath = exportPath ? 
              exportPath.endsWith('\\') || exportPath.endsWith('/') ? 
                `${exportPath}${fileInfo.fileName}` : 
                `${exportPath}\\${fileInfo.fileName}` : 
              fileInfo.fileName
            
            // 使用IPC写入文件（只传递两个参数）
            await window.api.writeFile(filePath, base64Data)
            console.log(`完整画面导出成功: ${filePath}`)
          } catch (error) {
            console.error('文件保存失败，使用下载方式:', error)
            // 降级到下载方式
            downloadImage(dataUrl, fileInfo.fileName)
          }
        } else {
          // 使用下载方式
          downloadImage(dataUrl, fileInfo.fileName)
        }
        
      } catch (error) {
        console.error('整体导出失败:', error)
        throw new Error(`整体导出失败: ${error.message}`)
      }
    }

    /**
     * 导出单个图层（使用多边形裁剪）
     * 处理流程：
     * 1、验证图层并创建透明导出画布
     * 2、在多边形裁剪区域内绘制图层
     * 3、生成文件名并写入文件，必要时改用下载
     * @param {Object} layer - 要导出的图层
     * @param {string} exportPath - 导出路径
     */
    const exportSingle = async (layer, exportPath) => {
      // 1、确认渲染器和多边形数据完整。
      if (!canvasRenderer.value || !layer.polygon) {
        console.warn('无法导出图层：缺少画布渲染器或多边形数据')
        return
      }
      
      try {
        // 创建新的导出画布
        const exportCanvas = document.createElement('canvas')
        exportCanvas.width = canvasWidth
        exportCanvas.height = canvasHeight
        const exportCtx = exportCanvas.getContext('2d')
        
        // 清除画布，设置透明背景
        exportCtx.clearRect(0, 0, canvasWidth, canvasHeight)
        
        // 2、创建多边形裁剪路径并绘制图层内容。
        exportCtx.beginPath()
        const points = layer.polygon
        if (points.length >= 3) {
          // 移动到第一个点
          exportCtx.moveTo(points[0].x, points[0].y)
          
          // 连接所有顶点
          for (let i = 1; i < points.length; i++) {
            exportCtx.lineTo(points[i].x, points[i].y)
          }
          
          // 闭合路径
          exportCtx.closePath()
          
          // 应用裁剪区域
          exportCtx.clip()
          
          // 在裁剪区域内绘制该图层的纯净内容（保留5px黑色边框）
          await drawCleanLayer(exportCtx, layer, true) // true表示保留边框
        }
        
        // 3、生成文件名并保存导出结果。
        const templateName = props.template?.name || '漫画模板'
        const fileInfo = generateExportFileName({
          presetName: templateName,
          variantName: layer.name,
          exportPath: exportPath
        })
        
        // 导出为PNG格式
        const dataUrl = exportCanvas.toDataURL('image/png', 1.0)
        
        // 使用Electron的IPC保存文件
        if (window.api && window.api.writeFile) {
          try {
            // 提取base64数据
            const base64Data = dataUrl.split(',')[1]
            // 构建完整文件路径
            const filePath = exportPath ? 
              exportPath.endsWith('\\') || exportPath.endsWith('/') ? 
                `${exportPath}${fileInfo.fileName}` : 
                `${exportPath}\\${fileInfo.fileName}` : 
              fileInfo.fileName
            
            // 使用IPC写入文件（只传递两个参数）
            await window.api.writeFile(filePath, base64Data)
            console.log(`图层 "${layer.name}" 导出成功: ${filePath}`)
          } catch (error) {
            console.error('文件保存失败，使用下载方式:', error)
            // 降级到下载方式
            downloadImage(dataUrl, fileInfo.fileName)
          }
        } else {
          // 使用下载方式
          downloadImage(dataUrl, fileInfo.fileName)
        }
        
      } catch (error) {
        console.error('图层导出失败:', error)
        throw new Error(`图层 "${layer.name}" 导出失败: ${error.message}`)
      }
    }
    
    /**
     * 下载图像（降级方案）
     * 处理流程：
     * 1、创建带文件名的临时下载链接
     * 2、触发下载并移除链接
     * @param {string} dataUrl - 图像数据URL
     * @param {string} fileName - 文件名
     */
    const downloadImage = (dataUrl, fileName) => {
      // 1、为图片数据创建下载入口。
      const link = document.createElement('a')
      link.href = dataUrl
      link.download = fileName
      document.body.appendChild(link)
      // 2、触发保存后清理临时节点。
      link.click()
      document.body.removeChild(link)
      console.log(`图层导出成功（下载方式）: ${fileName}`)
    }

    /**
     * 绘制纯净图层（无网格和蓝色选中边框，保留5px黑色边框）
     * 处理流程：
     * 1、检查多边形并建立裁剪区域
     * 2、按背景、人物顺序绘制图片
     * 3、根据导出选项绘制黑色边框
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} layer - 图层对象
     * @param {boolean} drawBorder - 是否绘制5px黑色多边形边框（默认true）
     */
    const drawCleanLayer = async (ctx, layer, drawBorder = true) => {
      // 1、将图层内容限制到有效多边形内部。
      if (!layer.polygon || layer.polygon.length < 3) return
      
      ctx.save()
      
      // 创建裁剪路径
      ctx.beginPath()
      ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
      for (let i = 1; i < layer.polygon.length; i++) {
        ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
      }
      ctx.closePath()
      ctx.clip()
      
      // 2、先绘制背景图片，再叠加人物图片。
      if (layer.backgroundImage) {
        await drawCleanImage(ctx, layer.backgroundImage, layer, 'background')
      }
      
      // 绘制所有人物图片
      if (layer.characterImages && layer.characterImages.length > 0) {
        for (const character of layer.characterImages) {
          await drawCleanCharacterImage(ctx, character, layer)
        }
      }
      
      ctx.restore()
      
      // 3、绘制多边形边框（如果需要）。
      if (drawBorder) {
        ctx.save()
        // 使用深色边框，在浅色和深色主题下都有良好的可见性
        ctx.strokeStyle = '#000000'
        ctx.lineWidth = 5
        ctx.beginPath()
        ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
        for (let i = 1; i < layer.polygon.length; i++) {
          ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.restore()
      }
    }

    /**
     * 绘制纯净的人物角色图片
     * 处理流程：
     * 1、加载人物图片
     * 2、计算边界及保持完整显示的图片尺寸
     * 3、应用缩放、位移、旋转和翻转并绘制
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} character - 人物对象
     * @param {Object} layer - 图层对象
     */
    const drawCleanCharacterImage = async (ctx, character, layer) => {
      // 1、创建图片对象并等待加载完成。
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = character.imageSrc
      })
      
      // 2、计算多边形边界框与人物适配尺寸。
      const bounds = calculatePolygonBounds(layer.polygon)
      
      // 获取人物的变换信息
      const transform = character.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      
      // 计算图片宽高比和多边形宽高比
      const imgAspectRatio = img.naturalWidth / img.naturalHeight
      const boundsAspectRatio = bounds.width / bounds.height
      
      let drawWidth, drawHeight
      
      // 人物图片：使用 object-fit: contain 的逻辑
      if (imgAspectRatio > boundsAspectRatio) {
        drawWidth = bounds.width
        drawHeight = drawWidth / imgAspectRatio
      } else {
        drawHeight = bounds.height
        drawWidth = drawHeight * imgAspectRatio
      }
      
      // 3、应用缩放、位置及方向变换后绘制图片。
      drawWidth *= transform.scale
      drawHeight *= transform.scale
      
      // 计算绘制位置（居中对齐，再加上用户的平移变换）
      const drawX = bounds.centerX - drawWidth / 2 + transform.x
      const drawY = bounds.centerY - drawHeight / 2 + transform.y
      
      // 应用变换（旋转和翻转）
      ctx.save()
      ctx.translate(bounds.centerX + transform.x, bounds.centerY + transform.y)
      if (transform.rotation !== 0) {
        ctx.rotate(transform.rotation * Math.PI / 180) // 转换为弧度
      }
      
      // 应用翻转变换
      const scaleX = transform.flipHorizontal ? -1 : 1
      ctx.scale(scaleX, 1)
      
      // 计算考虑翻转后的绘制位置
      const flipDrawX = transform.flipHorizontal ? -(drawX - bounds.centerX - transform.x) - drawWidth : (drawX - bounds.centerX - transform.x)
      const flipDrawY = drawY - bounds.centerY - transform.y
      
      // 绘制图片
      ctx.drawImage(img, flipDrawX, flipDrawY, drawWidth, drawHeight)
      
      ctx.restore()
    }

    /**
     * 绘制纯净图片（保持宽高比）
     * 处理流程：
     * 1、加载图片并读取多边形边界
     * 2、按人物完整显示或背景填满策略计算尺寸
     * 3、应用图片变换并完成绘制
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {string} imageSrc - 图片源
     * @param {Object} layer - 图层对象
     * @param {string} type - 图片类型 (background/character)
     */
    const drawCleanImage = async (ctx, imageSrc, layer, type) => {
      // 1、创建图片对象并读取边界和变换数据。
      const img = new Image()
      img.crossOrigin = 'anonymous'
      
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = imageSrc
      })
      
      // 计算多边形边界框
      const bounds = calculatePolygonBounds(layer.polygon)
      
      // 获取对应类型的变换信息
      const transformKey = type === 'background' ? 'backgroundTransform' : 'characterTransform'
      const transform = layer[transformKey] || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      
      // 计算图片宽高比和多边形宽高比
      const imgAspectRatio = img.naturalWidth / img.naturalHeight
      const boundsAspectRatio = bounds.width / bounds.height
      
      let drawWidth, drawHeight
      
      // 2、根据图片类型选择尺寸适配策略。
      if (type === 'character') {
        // 人物图片：使用 object-fit: contain 的逻辑
        if (imgAspectRatio > boundsAspectRatio) {
          drawWidth = bounds.width
          drawHeight = drawWidth / imgAspectRatio
        } else {
          drawHeight = bounds.height
          drawWidth = drawHeight * imgAspectRatio
        }
      } else {
        // 背景图片：使用 object-fit: cover 的逻辑
        if (imgAspectRatio > boundsAspectRatio) {
          drawHeight = bounds.height
          drawWidth = drawHeight * imgAspectRatio
        } else {
          drawWidth = bounds.width
          drawHeight = drawWidth / imgAspectRatio
        }
      }
      
      // 3、应用缩放、位移、旋转与翻转后绘制。
      drawWidth *= transform.scale
      drawHeight *= transform.scale
      
      // 计算绘制位置（居中对齐，再加上用户的平移变换）
      const drawX = bounds.centerX - drawWidth / 2 + transform.x
      const drawY = bounds.centerY - drawHeight / 2 + transform.y
      
      // 应用变换（旋转和翻转）
      ctx.save()
      ctx.translate(bounds.centerX + transform.x, bounds.centerY + transform.y)
      if (transform.rotation !== 0) {
        ctx.rotate(transform.rotation * Math.PI / 180) // 转换为弧度
      }
      
      // 应用翻转变换
      const scaleX = transform.flipHorizontal ? -1 : 1
      ctx.scale(scaleX, 1)
      
      // 计算考虑翻转后的绘制位置
      const flipDrawX = transform.flipHorizontal ? -(drawX - bounds.centerX - transform.x) - drawWidth : (drawX - bounds.centerX - transform.x)
      const flipDrawY = drawY - bounds.centerY - transform.y
      
      // 绘制图片
      ctx.drawImage(img, flipDrawX, flipDrawY, drawWidth, drawHeight)
      
      ctx.restore()
    }

    /**
     * 计算多边形边界框
     * 处理流程：
     * 1、空多边形返回零尺寸边界
     * 2、遍历顶点计算极值并返回边界与中心
     * @param {Array} polygon - 多边形顶点数组
     * @returns {Object} 边界框信息
     */
    const calculatePolygonBounds = (polygon) => {
      // 1、为缺失或空顶点集合返回空边界。
      if (!polygon || polygon.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0, centerX: 0, centerY: 0 }
      }
      
      // 2、从首个顶点开始统计边界。
      let minX = polygon[0].x
      let minY = polygon[0].y
      let maxX = polygon[0].x
      let maxY = polygon[0].y
      
      for (const point of polygon) {
        if (point.x < minX) minX = point.x
        if (point.x > maxX) maxX = point.x
        if (point.y < minY) minY = point.y
        if (point.y > maxY) maxY = point.y
      }
      
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
      }
    }

    /**
     * 自适应缩放到容器大小
     * 处理流程：
     * 1、测量容器可用空间并计算两个方向的适配倍率
     * 2、预留显示余量并限制最终缩放范围
     */
    const fitToContainer = () => {
      // 1、按扣除内边距后的容器尺寸计算适配比例。
      if (!canvasContainer.value) return
      
      const containerRect = canvasContainer.value.getBoundingClientRect()
      const containerWidth = containerRect.width - 20 // 减去padding
      const containerHeight = containerRect.height - 20 // 减去padding
      
      const scaleX = containerWidth / canvasWidth
      const scaleY = containerHeight / canvasHeight
      const optimalScale = Math.min(scaleX, scaleY)
      
      // 2、预留一成余量，将缩放限制在0.3至1.2之间。
      zoom.value = Math.max(Math.min(optimalScale * 0.9, 1.2), 0.3)
    }

    /**
     * 窗口大小变化处理函数
     * 处理流程：
     * 1、保留当前缩放，不在窗口变化时调整画布
     */
    const handleResize = () => {
      // 1、窗口大小变化时不自动改变缩放。
    }


    // 3、连接焦点同步和窗口监听，卸载时释放事件。
    watch(() => activeImage.value, (newActiveImage) => {
      if (newActiveImage) {
        // 当有图片被激活时，确保画布获得焦点
        nextTick(() => {
          focusCanvas()
        })
      }
    })

    // 组件挂载
    onMounted(() => {
      // 初始化画布
      nextTick(() => {
        focusCanvas()
      })
      
      // 监听窗口大小变化
      window.addEventListener('resize', handleResize)
    })

    // 组件销毁前清理
    onBeforeUnmount(() => {
      window.removeEventListener('resize', handleResize)
    })

    /**
     * 清除画布渲染器的图片缓存
     * 处理流程：
     * 1、渲染器可用时转发指定图片或全部缓存清理请求
     * @param {string} imageSrc - 图片源（可选）
     */
    const clearImageCache = (imageSrc = null) => {
      // 1、委托渲染器清理缓存。
      if (canvasRenderer.value && canvasRenderer.value.clearImageCache) {
        canvasRenderer.value.clearImageCache(imageSrc)
      }
    }

    /**
     * 强制重新渲染画布
     * 处理流程：
     * 1、渲染器可用时调用并返回绘制任务
     */
    const render = () => {
      // 1、由渲染器统一处理立即绘制和并发请求。
      if (canvasRenderer.value && canvasRenderer.value.render) {
        return canvasRenderer.value.render()
      }
    }

    return {
      // 组件引用
      canvasEditor,
      canvasContainer,
      canvasRenderer,
      transformController,
      
      // 状态
      canvasWidth,
      canvasHeight,
      zoom,
      activeImage,
      
      // 事件处理函数
      handleLayerSelect,
      handleLayerUpdate,
      handleImageActivate,
      handleImageDeselect,
      handleImageTransform,
      handleImageReset,
      handleImageFlipHorizontal,
      
      // 工具函数
      zoomIn,
      zoomOut,
      resetZoom,
      fitToContainer,
      focusCanvas,
      clearImageCache,
      render,
      
      // 导出函数
      exportAll,
      exportSingle,
      downloadImage,
      drawCleanLayer,
      drawCleanImage,
      calculatePolygonBounds
    }
  }
}
</script>

<style scoped>
.canvas-editor {
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  outline: none; /* 移除聚焦时的轮廓 */
}

.canvas-container {
  flex: 1;
  overflow: hidden;
  background: var(--theme-background-secondary);
  position: relative;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding: 5px;
  min-height: 0;
  outline: none; /* 移除聚焦时的轮廓 */
}

</style>
