<template>
  <div class="canvas-renderer">
    <div 
      class="canvas-wrapper"
      :style="{ transform: `scale(${zoom})` }"
    >
      <canvas 
        ref="canvas"
        :width="canvasWidth"
        :height="canvasHeight"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @wheel="handleWheel"
      ></canvas>
    </div>
  </div>
</template>

<script>
/**
 * 画布渲染器组件
 * 
 * 功能：
 * - 渲染视角格子模板和图层
 * - 处理基础的鼠标交互
 * - 绘制网格和图层边框
 * - 管理图片缓存
 */

import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { isPointInPolygon } from '../utils/helpers.js'

export default {
  name: 'CanvasRenderer',
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
    zoom: {
      type: Number,
      default: 1.0
    },
    activeImage: {
      type: Object,
      default: null
    }
  },
  emits: ['layer-select', 'image-transform', 'image-activate'],
  /**
   * 组织画布绘制、图片缓存及鼠标交互。
   * 处理流程：
   * 1、初始化画布、缓存与渲染调度状态
   * 2、定义图层绘制及图片拖拽操作
   * 3、连接属性监听与生命周期并暴露画布接口
   */
  setup(props, { emit }) {
    // 1、初始化画布与缓存，后续操作共用同一渲染队列。
    // 画布相关
    const canvas = ref(null)
    const canvasWidth = 1920
    const canvasHeight = 1080
    
    // 图片缓存
    const imageCache = new Map()
    let isRendering = false
    let renderPending = false
    let renderScheduled = false
    let renderRafId = null

    // 2、定义画布初始化、绘制调度和图片操作。
    /**
     * 初始化画布
     * 处理流程：
     * 1、取得画布上下文并启用高质量平滑
     * 2、调度首次绘制
     */
    const initCanvas = () => {
      // 1、确认画布已挂载并配置绘制质量。
      if (!canvas.value) return
      
      const ctx = canvas.value.getContext('2d')
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      
      // 2、将首次绘制加入动画帧。
      scheduleRender()
    }

    /**
     * 渲染画布内容
     * 处理流程：
     * 1、确认画布并清空上一帧
     * 2、顺序绘制可见图层
     * 3、依据主题及激活状态绘制界面边框
     */
    const renderInternal = async () => {
      // 1、取得上下文并清除旧画面。
      if (!canvas.value) return
      
      const ctx = canvas.value.getContext('2d')
      
      // 清除画布
      ctx.clearRect(0, 0, canvasWidth, canvasHeight)
      
      // 2、绘制可见图层。
      for (const layer of props.layers) {
        if (layer.visible) {
          await drawLayer(ctx, layer)
        }
      }
      
      // 3、绘制所有图层的前端显示边框（根据主题和激活状态）。
      const isDarkTheme = document.documentElement.classList.contains('theme-dark')
      for (const layer of props.layers) {
        if (!layer.polygon) continue
        
        const isActive = props.activeLayer && props.activeLayer.id === layer.id
        
        ctx.save()
        if (isActive) {
          // 激活区域：绘制双层边框效果
          // 第1层：外发光（宽边，半透明蓝）
          ctx.strokeStyle = 'rgba(79, 158, 255, 0.4)'
          ctx.lineWidth = 16
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
          for (let i = 1; i < layer.polygon.length; i++) {
            ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
          }
          ctx.closePath()
          ctx.stroke()
          
          // 第2层：内实线（鲜明蓝色）
          ctx.strokeStyle = '#4f9eff'
          ctx.lineWidth = 8
          ctx.beginPath()
          ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
          for (let i = 1; i < layer.polygon.length; i++) {
            ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
          }
          ctx.closePath()
          ctx.stroke()
        } else {
          // 未激活区域：根据主题显示白色/黑色
          ctx.strokeStyle = isDarkTheme ? '#ffffff' : '#333333'
          ctx.lineWidth = 3
          ctx.setLineDash([])
          ctx.beginPath()
          ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
          for (let i = 1; i < layer.polygon.length; i++) {
            ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
          }
          ctx.closePath()
          ctx.stroke()
        }
        ctx.restore()
      }
    }

    /**
     * 使用 requestAnimationFrame 调度渲染，避免在高频交互时重复执行
     * 处理流程：
     * 1、合并尚未执行的动画帧请求
     * 2、绘制忙碌时标记补帧，否则执行绘制
     * 3、释放绘制状态并处理待补帧
     */
    const scheduleRender = () => {
      // 1、每个动画帧只保留一个待执行请求。
      if (renderScheduled) return
      renderScheduled = true
      renderRafId = requestAnimationFrame(async () => {
        // 2、避免异步图片绘制与新帧并行。
        renderScheduled = false
        if (isRendering) {
          renderPending = true
          return
        }
        isRendering = true
        try {
          await renderInternal()
        } finally {
          // 3、当前帧完成后补上交互期间积累的变化。
          isRendering = false
          if (renderPending) {
            renderPending = false
            scheduleRender()
          }
        }
      })
    }

    /**
     * 立即渲染画布（必要时由父组件直接调用）
     * 处理流程：
     * 1、绘制忙碌时记录补帧请求
     * 2、取消已排队帧并立即绘制
     * 3、恢复状态并调度待处理帧
     */
    const render = async () => {
      // 1、正在绘制时由当前任务完成后补帧。
      if (isRendering) {
        renderPending = true
        return
      }
      // 2、取消延迟请求，改为直接绘制。
      if (renderScheduled) {
        cancelAnimationFrame(renderRafId)
        renderScheduled = false
      }
      isRendering = true
      try {
        await renderInternal()
      } finally {
        // 3、释放绘制锁并处理期间到达的新请求。
        isRendering = false
        if (renderPending) {
          renderPending = false
          scheduleRender()
        }
      }
    }

    /**
     * 绘制图层
     * 处理流程：
     * 1、验证多边形并创建裁剪区域
     * 2、绘制背景及人物图片
     * 3、恢复上下文并绘制黑色边框
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} layer - 图层对象
     */
    const drawLayer = async (ctx, layer) => {
      // 1、仅绘制有效多边形，并限制内容到视角内部。
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
      
      // 2、依次绘制背景图片和人物图片。
      if (layer.backgroundImage) {
        await drawImage(ctx, layer.backgroundImage, layer, 'background')
      }
      
      // 绘制所有人物图片
      if (layer.characterImages && layer.characterImages.length > 0) {
        for (const character of layer.characterImages) {
          await drawCharacterImage(ctx, character, layer)
        }
      }
      
      ctx.restore()
      
      // 3、绘制多边形边框（导出时保持黑色）。
      ctx.save()
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

    /**
     * 清除图片缓存
     * 处理流程：
     * 1、按指定图片删除缓存，未指定时清空全部缓存
     * @param {string} imageSrc - 图片源（可选，如果不提供则清除所有缓存）
     */
    const clearImageCache = (imageSrc = null) => {
      // 1、依据传入图片源选择清理范围。
      if (imageSrc) {
        imageCache.delete(imageSrc)
      } else {
        imageCache.clear()
      }
    }

    /**
     * 绘制人物角色图片
     * 处理流程：
     * 1、检查图片源并复用或加载图片缓存
     * 2、计算视角边界及当前拖拽变换
     * 3、以完整显示方式计算尺寸并绘制人物
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} character - 人物对象
     * @param {Object} layer - 图层对象
     */
    const drawCharacterImage = async (ctx, character, layer) => {
      // 1、加载有效人物图片，失败结果不写入缓存。
      if (!character.imageSrc) {
        console.warn(`人物图片源为空`)
        return
      }

      let img = imageCache.get(character.imageSrc)
      
      if (!img) {
        img = new Image()
        img.crossOrigin = 'anonymous'
        
        try {
          await new Promise((resolve, reject) => {
            img.onload = () => {
              resolve()
            }
            img.onerror = (error) => {
              console.error(`✗ 人物图片加载失败`, error)
              reject(new Error(`人物图片加载失败`))
            }
            // 添加超时处理
            setTimeout(() => reject(new Error('人物图片加载超时')), 10000)
            img.src = character.imageSrc
          })
          
          // 只有成功加载的图片才缓存
          imageCache.set(character.imageSrc, img)
        } catch (error) {
          console.error('❌ 人物图片加载错误:', error)
          // 加载失败时不缓存，下次可以重试
          return
        }
      }
      
      // 2、计算多边形边界框并取得实际或临时变换。
      const bounds = calculatePolygonBounds(layer.polygon)
      
      // 获取人物的变换信息 - 优先使用临时拖拽状态
      let transform = character.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      
      // 如果正在拖拽且是当前激活的人物，使用临时变换状态
      if (isDraggingImage.value && tempImageTransform.value && 
          props.activeImage && props.activeImage.layer === layer && 
          props.activeImage.type === 'character' && 
          props.activeImage.characterId === character.id) {
        transform = tempImageTransform.value
      }
      
      // 3、计算图片宽高比和多边形宽高比，按完整显示方式绘制。
      const imgAspectRatio = img.naturalWidth / img.naturalHeight
      const boundsAspectRatio = bounds.width / bounds.height
      
      let drawWidth, drawHeight
      
      // 人物图片：使用 object-fit: contain 的逻辑，完整显示图片
      if (imgAspectRatio > boundsAspectRatio) {
        drawWidth = bounds.width
        drawHeight = drawWidth / imgAspectRatio
      } else {
        drawHeight = bounds.height
        drawWidth = drawHeight * imgAspectRatio
      }
      
      ctx.save()
      ctx.translate(bounds.centerX + transform.x, bounds.centerY + transform.y)
      ctx.rotate(transform.rotation * Math.PI / 180)
      
      // 应用翻转变换
      const scaleX = transform.flipHorizontal ? -transform.scale : transform.scale
      ctx.scale(scaleX, transform.scale)
      
      // 绘制图片（保持宽高比，居中显示）
      try {
        ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      } catch (error) {
        console.error(`❌ 绘制人物图片失败:`, error)
      }
      
      ctx.restore()
    }

    /**
     * 绘制图片（保持宽高比）
     * 处理流程：
     * 1、检查图片源并复用或加载缓存
     * 2、取得多边形边界及背景变换
     * 3、按填满视角方式计算尺寸并绘制
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {string} imageSrc - 图片源
     * @param {Object} layer - 图层对象
     * @param {string} type - 图片类型 (background/character)
     */
    const drawImage = async (ctx, imageSrc, layer, type) => {
      // 1、加载有效图片并缓存成功结果。
      if (!imageSrc) {
        console.warn(`${type} 图片源为空`)
        return
      }

      let img = imageCache.get(imageSrc)
      
      if (!img) {
        img = new Image()
        img.crossOrigin = 'anonymous'
        
        try {
          await new Promise((resolve, reject) => {
            img.onload = () => {
              resolve()
            }
            img.onerror = (error) => {
              console.error(`✗ 图片加载失败: ${type}`, error)
              reject(new Error(`图片加载失败: ${type}`))
            }
            // 添加超时处理
            setTimeout(() => reject(new Error('图片加载超时')), 10000)
            img.src = imageSrc
          })
          
          // 只有成功加载的图片才缓存
          imageCache.set(imageSrc, img)
        } catch (error) {
          console.error('❌ 图片加载错误:', error)
          // 加载失败时不缓存，下次可以重试
          return
        }
      }
      
      // 2、计算多边形边界框并取得背景变换。
      const bounds = calculatePolygonBounds(layer.polygon)
      
      // 获取背景图片的变换信息 - 优先使用临时拖拽状态
      let transform = layer.backgroundTransform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      
      // 如果正在拖拽且是当前激活的背景图片，使用临时变换状态
      if (isDraggingImage.value && tempImageTransform.value && 
          props.activeImage && props.activeImage.layer === layer && 
          props.activeImage.type === 'background') {
        transform = tempImageTransform.value
      }
      
      // 3、计算宽高比并以填满视角的方式绘制。
      const imgAspectRatio = img.naturalWidth / img.naturalHeight
      const boundsAspectRatio = bounds.width / bounds.height
      
      let drawWidth, drawHeight
      
      // 背景图片：使用 object-fit: cover 的逻辑，保持宽高比且100%填充
      if (imgAspectRatio > boundsAspectRatio) {
        // 图片更宽，以高度为基准
        drawHeight = bounds.height
        drawWidth = drawHeight * imgAspectRatio
      } else {
        // 图片更高，以宽度为基准
        drawWidth = bounds.width
        drawHeight = drawWidth / imgAspectRatio
      }
      
      ctx.save()
      ctx.translate(bounds.centerX + transform.x, bounds.centerY + transform.y)
      ctx.rotate(transform.rotation * Math.PI / 180)
      
      // 应用翻转变换
      const scaleX = transform.flipHorizontal ? -transform.scale : transform.scale
      ctx.scale(scaleX, transform.scale)
      
      // 绘制图片（保持宽高比，居中显示）
      try {
        ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
      } catch (error) {
        console.error(`❌ 绘制${type}图片失败:`, error)
      }
      
      ctx.restore()
    }

    /**
     * 计算多边形边界框
     * 处理流程：
     * 1、遍历顶点取得坐标极值
     * 2、返回边界尺寸与中心位置
     * @param {Array} polygon - 多边形顶点数组
     * @returns {Object} 边界框信息
     */
    const calculatePolygonBounds = (polygon) => {
      // 1、累计顶点在两个方向上的边界。
      let minX = Infinity, minY = Infinity
      let maxX = -Infinity, maxY = -Infinity
      
      for (const point of polygon) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
      
      // 2、将极值转换成边界框与中心坐标。
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
     * 绘制图层边框
     * 处理流程：
     * 1、确认多边形并设置边框样式
     * 2、连接顶点描边后恢复上下文
     * @param {CanvasRenderingContext2D} ctx - 画布上下文
     * @param {Object} layer - 图层对象
     */
    const drawLayerBorder = (ctx, layer) => {
      // 1、为有效图层设置独立描边样式。
      if (!layer.polygon) return
      
      ctx.save()
      // 使用鲜明的蓝色实线，在白昼/黑夜主题下都清晰可见
      ctx.strokeStyle = '#4f9eff'
      ctx.lineWidth = 5
      ctx.setLineDash([]) // 实线，不使用虚线
      
      // 2、沿多边形路径闭合描边。
      ctx.beginPath()
      ctx.moveTo(layer.polygon[0].x, layer.polygon[0].y)
      for (let i = 1; i < layer.polygon.length; i++) {
        ctx.lineTo(layer.polygon[i].x, layer.polygon[i].y)
      }
      ctx.closePath()
      ctx.stroke()
      
      ctx.restore()
    }


    /**
     * 检查点击位置的图层
     * 处理流程：
     * 1、从顶层向下查找包含点击点的可见多边形
     * 2、返回命中图层，未命中时返回空值
     * @param {number} x - 点击位置x
     * @param {number} y - 点击位置y
     * @returns {Object|null} 点击的图层信息
     */
    const getClickedLayer = (x, y) => {
      // 1、从上到下遍历图层并返回首个命中项。
      for (let i = props.layers.length - 1; i >= 0; i--) {
        const layer = props.layers[i]
        if (layer.visible && layer.polygon && isPointInPolygon({ x, y }, layer.polygon)) {
          return layer
        }
      }
      
      // 2、所有可见图层均未命中。
      return null
    }

    // 拖拽状态
    const isDraggingImage = ref(false)
    const dragStartPos = ref({ x: 0, y: 0 })
    const initialImageTransform = ref(null)
    const tempImageTransform = ref(null) // 临时拖拽位置，用于实时渲染

    /**
     * 处理鼠标按下事件
     * 处理流程：
     * 1、将屏幕位置转换为画布坐标
     * 2、存在激活图片时保存初始变换并开始拖拽
     * 3、否则查找点击图层并发出选择事件
     * @param {MouseEvent} event - 鼠标事件
     */
    const handleMouseDown = (event) => {
      // 1、按画布实际显示尺寸换算点击位置。
      const rect = canvas.value.getBoundingClientRect()
      // 正确的坐标转换：从屏幕坐标转换到画布坐标
      const x = (event.clientX - rect.left) * (canvasWidth / rect.width)
      const y = (event.clientY - rect.top) * (canvasHeight / rect.height)
      
      // 2、如果有激活的图片，在画布任意位置都可以开始拖拽。
      if (props.activeImage) {
        // 开始拖拽激活的图片
        isDraggingImage.value = true
        dragStartPos.value = { x, y }
        
        // 记录图片的初始变换状态
        if (props.activeImage.type === 'background') {
          // 背景图片
          initialImageTransform.value = props.activeImage.layer.backgroundTransform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        } else {
          // 人物图片 - 从characterImages数组中找到对应的character
          const characterImages = props.activeImage.layer.characterImages || []
          const character = characterImages.find(c => c.id === props.activeImage.characterId)
          initialImageTransform.value = character?.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        }
        
        // 设置鼠标样式
        canvas.value.style.cursor = 'grabbing'
        
        // 阻止默认行为
        event.preventDefault()
        return
      }
      
      // 3、如果没有激活图片，检查图层选择。
      const clickedLayer = getClickedLayer(x, y)
      
      if (clickedLayer) {
        emit('layer-select', clickedLayer)
      }
    }

    /**
     * 处理鼠标移动事件
     * 处理流程：
     * 1、换算当前画布坐标
     * 2、拖拽时更新临时变换并调度绘制
     * 3、空闲时按激活图片和命中图层更新鼠标样式
     * @param {MouseEvent} event - 鼠标事件
     */
    const handleMouseMove = (event) => {
      // 1、将当前鼠标位置换算到原始画布。
      const rect = canvas.value.getBoundingClientRect()
      // 正确的坐标转换：从屏幕坐标转换到画布坐标
      const x = (event.clientX - rect.left) * (canvasWidth / rect.width)
      const y = (event.clientY - rect.top) * (canvasHeight / rect.height)
      
      // 2、处理拖拽激活的图片。
      if (isDraggingImage.value && props.activeImage && initialImageTransform.value) {
        // 计算从拖拽起点到当前位置的偏移量
        const deltaX = x - dragStartPos.value.x
        const deltaY = y - dragStartPos.value.y
        
        // 使用初始位置 + 偏移量作为新的绝对位置
        const newX = initialImageTransform.value.x + deltaX
        const newY = initialImageTransform.value.y + deltaY
        
        // 更新临时变换状态，用于实时渲染，不触发事件链
        tempImageTransform.value = {
          ...initialImageTransform.value,
          x: newX,
          y: newY
        }
        
        // 使用调度的方式重新渲染，避免高频重复绘制
        scheduleRender()
        
        return
      }
      
      // 3、更新鼠标样式。
      if (isDraggingImage.value) {
        canvas.value.style.cursor = 'grabbing'
      } else if (props.activeImage) {
        // 有激活图片时，显示可拖拽样式
        canvas.value.style.cursor = 'grab'
      } else {
        // 没有激活图片时，根据图层显示样式
        const clickedLayer = getClickedLayer(x, y)
        canvas.value.style.cursor = clickedLayer ? 'pointer' : 'crosshair'
      }
    }

    /**
     * 处理鼠标释放事件
     * 处理流程：
     * 1、结束有效拖拽并提交最终图片位置
     * 2、清空临时状态并恢复鼠标样式
     */
    const handleMouseUp = () => {
      // 1、结束拖拽并提交位置。
      if (isDraggingImage.value) {
        // 拖拽结束，提交最终位置
        if (tempImageTransform.value) {
          emit('image-transform', {
            type: 'position',
            value: { x: tempImageTransform.value.x, y: tempImageTransform.value.y },
            relative: false,
            target: props.activeImage
          })
          scheduleRender()
        }
        
        // 2、清理拖拽状态并恢复鼠标样式。
        isDraggingImage.value = false
        dragStartPos.value = { x: 0, y: 0 }
        initialImageTransform.value = null
        tempImageTransform.value = null
        
        // 恢复鼠标样式
        if (props.activeImage) {
          canvas.value.style.cursor = 'grab'
        } else {
          canvas.value.style.cursor = 'crosshair'
        }
      }
    }

    /**
     * 处理鼠标滚轮事件
     * 处理流程：
     * 1、阻止页面滚动并向激活图片发送相对缩放事件
     * @param {WheelEvent} event - 滚轮事件
     */
    const handleWheel = (event) => {
      // 1、将滚轮方向转换为当前图片的缩放倍率。
      event.preventDefault()
      
      if (props.activeImage) {
        // 如果有激活的图片，进行缩放
        const scaleDelta = event.deltaY > 0 ? 0.9 : 1.1
        emit('image-transform', {
          type: 'scale',
          value: scaleDelta,
          relative: true
        })
      }
    }

    // 3、连接属性变化与生命周期，统一安排绘制及帧清理。
    watch([() => props.template, () => props.layers, () => props.activeLayer, () => props.activeImage], () => {
      nextTick(() => {
        scheduleRender()
      })
    }, { deep: true })

    // 组件挂载
    onMounted(() => {
      initCanvas()
    })

    onBeforeUnmount(() => {
      if (renderScheduled && renderRafId !== null) {
        cancelAnimationFrame(renderRafId)
      }
    })

    return {
      canvas,
      canvasWidth,
      canvasHeight,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleWheel,
      render,
      clearImageCache,
      
      // 拖拽相关
      isDraggingImage,
      dragStartPos,
      initialImageTransform,
      tempImageTransform
    }
  }
}
</script>

<style scoped>
.canvas-renderer {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 20px;
}

.canvas-wrapper {
  display: inline-block;
  margin: 0;
  transform-origin: center center;
  transition: transform 0.1s ease;
  max-width: 100%;
  max-height: 100%;
}

canvas {
  border: 1px solid var(--theme-border);
  background: var(--theme-background);
  cursor: crosshair;
  display: block;
  max-width: 100%;
  height: auto;
}

canvas:hover {
  cursor: grab;
}

canvas:active {
  cursor: grabbing;
}
</style>
