<template>
  <div class="dialog-frame-canvas">
    <!-- 工具栏 -->
    <div class="canvas-toolbar">
      <!-- 嵌入方式选择器 -->
      <div class="embed-mode-selector" v-if="dialogFrame">
        <label class="embed-label">嵌入方式：</label>
        <select v-model="embedMode" class="embed-select" @change="handleEmbedModeChange">
          <option value="direct">直接嵌入【白色背景】</option>
          <option value="opacity">不透明度嵌入【白色背景】</option>
          <option value="protrude">头部凸出【白色背景】</option>
          <option value="combined">不透明度+凸出【白色背景】</option>
          <option value="opacity-colored">不透明度嵌入【彩色背景】</option>
          <option value="combined-colored">不透明度+凸出【彩色背景】</option>
        </select>
      </div>
      <!-- 不透明度渐变模式选择器 -->
      <div class="opacity-gradient-selector" v-if="dialogFrame && (embedMode === 'opacity' || embedMode === 'combined' || embedMode === 'opacity-colored' || embedMode === 'combined-colored')">
        <label class="embed-label">渐变模式：</label>
        <select v-model="opacityGradientMode" class="embed-select" @change="handleOpacityGradientModeChange">
          <option value="default">默认（1/2-1）</option>
          <option value="fast">快速（1/2-3/4）</option>
          <option value="early">提前（1/3-2/3）</option>
        </select>
      </div>
      <div class="toolbar-divider" v-if="dialogFrame && (activeCharacter || dialogFrame)"></div>
      <div class="toolbar-center" v-if="activeCharacter || dialogFrame">
        <button class="btn btn-small" @click="scaleUp" title="放大">
          放大+
        </button>
        <button class="btn btn-small" @click="scaleDown" title="缩小">
          缩小-
        </button>
        <button class="btn btn-small" @click="rotateLeft" title="逆时针旋转">
          ↺
        </button>
        <button class="btn btn-small" @click="rotateRight" title="顺时针旋转">
          ↻
        </button>
        <button class="btn btn-small" @click="flipHorizontal" title="水平翻转">
          水平翻转
        </button>
      </div>
      <div class="toolbar-right">
        <button
          v-if="activeCharacter || dialogFrame"
          class="btn btn-small"
          @click="handleImageReset"
          :title="activeObjectType === 'frame' ? '重置对话框' : '重置选中人物'"
        >
          重置
        </button>
        <button
          class="btn btn-small btn-primary"
          @click="handleExport"
          :disabled="!dialogFrame"
        >
          导出
        </button>
      </div>
    </div>

    <!-- 画布容器 -->
    <div class="canvas-container" ref="canvasContainer" @wheel.prevent="handleWheel">
      <canvas
        ref="canvas"
        class="main-canvas"
        @mousedown="handleMouseDown"
        @mousemove="handleMouseMove"
        @mouseup="handleMouseUp"
        @mouseleave="handleMouseLeave"
      ></canvas>
    </div>
  </div>
</template>

<script>
/** 对话框合成画布：绘制人物蒙版效果，处理变换手柄、像素命中与透明图片导出。 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { clamp, calculateContainSize } from '../utils/helpers.js'
import { useDialogCanvasRender } from '../composables/useDialogCanvasRender.js'

export default {
  name: 'DialogFrameCanvas',
  props: {
    dialogFrame: {
      type: Object,
      default: null
    },
    characters: {
      type: Array,
      default: () => []
    },
    activeCharacter: {
      type: Object,
      default: null
    },
    activeObjectType: {
      type: String,
      default: 'character'
    }
  },
  emits: ['character-update', 'character-select', 'frame-update', 'frame-select', 'export'],
  /**
   * 连接合成绘制、图片变换和画布生命周期。
   * 处理流程：
   * 1、初始化画布尺寸、合成模式、缓存与拖拽状态
   * 2、定义绘制、像素处理、命中检测及变换操作
   * 3、连接数据和容器主题观察器并在卸载时清理
   */
  setup(props, { emit }) {
    // 1、初始化画布引用与全部交互状态。
    const canvas = ref(null)
    const canvasContainer = ref(null)
    const ctx = ref(null)
    
    // 画布固定尺寸和宽高比
    const canvasWidth = 1920
    const canvasHeight = 1080
    const aspectRatio = canvasWidth / canvasHeight // 16:9
    
    // 缩放级别
    const zoom = ref(1.0)
    
    // 实际显示尺寸（响应式）
    const displayWidth = ref(canvasWidth)
    const displayHeight = ref(canvasHeight)
    
    // 嵌入方式：'direct' | 'opacity' | 'protrude' | 'combined'
    const embedMode = ref('direct')
    
    // 不透明度渐变模式：'default' | 'fast' | 'early'
    const opacityGradientMode = ref('default')
    
    // 激活的对象类型：使用props传入的值
    const activeObjectType = computed(() => props.activeObjectType)
    
    // 拖拽状态
    const isDragging = ref(false)
    const dragStartX = ref(0)
    const dragStartY = ref(0)
    const dragCharacter = ref(null)
    const dragFrame = ref(null)
    const dragInitialTransform = ref(null) // 记录拖拽开始时的初始变换状态

    /**
     * 初始化画布
     * 处理流程：
     * 1、设置固定画布尺寸并创建高质量透明上下文
     * 2、计算显示尺寸并绘制首帧
     */
    const initCanvas = () => {
      // 1、为已挂载的画布设置原始绘制尺寸和上下文。
      if (!canvas.value) return
      
      canvas.value.width = canvasWidth
      canvas.value.height = canvasHeight
      ctx.value = canvas.value.getContext('2d', {
        alpha: true,
        willReadFrequently: false
      })
      
      // 启用最高质量的图像平滑
      ctx.value.imageSmoothingEnabled = true
      ctx.value.imageSmoothingQuality = 'high'
      
      // 2、自适应缩放并执行首次渲染。
      fitToContainer()
      
      // 初次渲染
      render()
    }

    const { loadImage, renderImmediate, render, exportImage } = useDialogCanvasRender({
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
      drawSelectionBox: (character) => drawSelectionBox(character),
      getHandleMetrics: () => getHandleMetrics(),
      getTransformHandles: (...args) => getTransformHandles(...args)
    })

    // 控制手柄基础尺寸（以CSS像素为基准，后续按显示缩放到canvas像素）
    const baseHandleSizeCss = 12
    const baseHandleHitSizeCss = 28
    const baseRotateHandleDistanceCss = 32
    const baseRotateHandleRadiusCss = 14
    const baseRotateHandleHitSizeCss = 30

    /**
     * 计算画布像素与界面显示尺寸的比例。
     * 处理流程：
     * 1、使用有效显示宽度换算比例，无有效宽度时返回一
     */
    const getCanvasPixelScale = () => {
      // 1、将界面尺寸换算为内部画布坐标倍率。
      const dw = displayWidth.value || canvasWidth
      return dw > 0 ? (canvasWidth / dw) : 1
    }

    /**
     * 计算控制手柄的绘制尺寸与命中区域。
     * 处理流程：
     * 1、按显示缩放换算各项尺寸并保留最小操作范围
     */
    const getHandleMetrics = () => {
      // 1、保持手柄在不同显示缩放下具有可操作的尺寸。
      const scale = getCanvasPixelScale()
      return {
        handleSize: Math.max(8, Math.round(baseHandleSizeCss * scale)),
        handleHitSize: Math.max(14, Math.round(baseHandleHitSizeCss * scale)),
        rotateHandleDistance: Math.max(20, Math.round(baseRotateHandleDistanceCss * scale)),
        rotateHandleRadius: Math.max(10, Math.round(baseRotateHandleRadiusCss * scale)),
        rotateHandleHitSize: Math.max(18, Math.round(baseRotateHandleHitSizeCss * scale))
      }
    }

    /**
     * 读取兼容旧变换字段的等比缩放。
     * 处理流程：
     * 1、优先读取统一缩放，否则按有效轴缩放推导并回退默认值
     */
    const getUniformScale = (transform) => {
      // 1、按统一字段、双轴几何平均、单轴值的顺序取缩放。
      if (!transform) return 1
      if (transform.scale != null) return transform.scale
      const sx = transform.scaleX
      const sy = transform.scaleY
      if (sx != null && sy != null && sx > 0 && sy > 0) return Math.sqrt(sx * sy)
      if (sx != null && sx > 0) return sx
      if (sy != null && sy > 0) return sy
      return 1
    }
    const activeHandle = ref(null) // 当前激活的手柄
    const handleDragStart = ref({ 
      x: 0, 
      y: 0, 
      transform: null, 
      centerX: 0, 
      centerY: 0,
      width: 0,
      height: 0
    })

    /**
     * 获取8个缩放手柄 + 1个旋转手柄的位置
     * 处理流程：
     * 1、建立四角和四边中点的局部坐标
     * 2、旋转平移到画布坐标
     * 3、在上边中点外侧补充旋转手柄
     */
    const getTransformHandles = (centerX, centerY, width, height, rotation, rotateDistance) => {
      // 1、建立旋转参数及局部控制点。
      const angle = rotation * Math.PI / 180
      const cos = Math.cos(angle)
      const sin = Math.sin(angle)
      
      // 8个缩放手柄的本地坐标
      const handlePositions = {
        // 四个角
        nw: { x: -width / 2, y: -height / 2 }, // 左上
        ne: { x: width / 2, y: -height / 2 },  // 右上
        sw: { x: -width / 2, y: height / 2 },  // 左下
        se: { x: width / 2, y: height / 2 },   // 右下
        // 四条边中点
        n: { x: 0, y: -height / 2 },           // 上
        s: { x: 0, y: height / 2 },            // 下
        w: { x: -width / 2, y: 0 },            // 左
        e: { x: width / 2, y: 0 }              // 右
      }
      
      // 2、转换为画布坐标。
      const worldHandles = {}
      for (const [key, pos] of Object.entries(handlePositions)) {
        worldHandles[key] = {
          x: centerX + pos.x * cos - pos.y * sin,
          y: centerY + pos.x * sin + pos.y * cos,
          type: key.length === 2 ? 'corner' : 'edge' // 标记类型
        }
      }
      
      // 3、添加旋转手柄（在顶边中心上方）。
      const rotateLocal = { x: 0, y: -height / 2 - rotateDistance }
      worldHandles.rotate = {
        x: centerX + rotateLocal.x * cos - rotateLocal.y * sin,
        y: centerY + rotateLocal.x * sin + rotateLocal.y * cos,
        type: 'rotate'
      }
      
      return worldHandles
    }

    /**
     * 计算点到线段的最短距离。
     * 处理流程：
     * 1、处理线段退化为单点的情况
     * 2、将投影限制在线段内并计算到投影点的距离
     */
    const distancePointToSegment = (px, py, x1, y1, x2, y2) => {
      // 1、读取线段方向并处理零长度情况。
      const dx = x2 - x1
      const dy = y2 - y1
      if (dx === 0 && dy === 0) {
        // 退化为点
        const ddx = px - x1
        const ddy = py - y1
        return Math.sqrt(ddx * ddx + ddy * ddy)
      }
      // 2、将投影参数限制到两个端点之间。
      const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
      const projX = x1 + t * dx
      const projY = y1 + t * dy
      const ddx = px - projX
      const ddy = py - projY
      return Math.sqrt(ddx * ddx + ddy * ddy)
    }

    /**
     * 检测点击是否在手柄上
     * 优先级：旋转手柄 > 缩放手柄
     * 处理流程：
     * 1、优先检测旋转手柄圆形区域及连接线
     * 2、检查缩放手柄矩形区域，均未命中时返回空值
     */
    const getHandleAtPoint = (x, y, handles) => {
      // 1、使用随显示倍率变化的旋转手柄命中范围。
      const { rotateHandleHitSize, handleHitSize } = getHandleMetrics()
      // 优先检测旋转手柄（圆形，使用更大的热区）
      if (handles.rotate) {
        const dx = x - handles.rotate.x
        const dy = y - handles.rotate.y
        const distance = Math.sqrt(dx * dx + dy * dy)
        // 使用更大的热区半径，便于点击
        if (distance <= rotateHandleHitSize) {
          return 'rotate'
        }

        // 额外优化：靠近连接线段（n -> rotate）也视为旋转命中
        if (handles.n) {
          const distToLine = distancePointToSegment(
            x,
            y,
            handles.n.x,
            handles.n.y,
            handles.rotate.x,
            handles.rotate.y
          )
          // 线段宽容度略小于圆形热区
          if (distToLine <= Math.max(rotateHandleHitSize * 0.6, handleHitSize * 0.5)) {
            return 'rotate'
          }
        }
      }
      
      // 2、检测缩放手柄（方块，也增大热区）。
      for (const [key, handle] of Object.entries(handles)) {
        if (key === 'rotate') continue
        
        const dx = Math.abs(x - handle.x)
        const dy = Math.abs(y - handle.y)
        
        // 方块碰撞检测（使用增大的热区）
        if (dx <= handleHitSize / 2 && dy <= handleHitSize / 2) {
          return key
        }
      }
      
      return null
    }

    /**
     * 根据手柄类型获取光标样式
     * 处理流程：
     * 1、旋转手柄使用抓取光标，其余按基础方向返回缩放光标
     */
    const getCursorForHandle = (handleKey, rotation) => {
      // 1、使用手柄基础方向映射光标，当前未随旋转角度调整。
      if (handleKey === 'rotate') return 'grab'
      
      // 角手柄和边手柄的光标映射
      const cursorMap = {
        'nw': 'nw-resize',
        'ne': 'ne-resize',
        'sw': 'sw-resize',
        'se': 'se-resize',
        'n': 'n-resize',
        's': 's-resize',
        'w': 'w-resize',
        'e': 'e-resize'
      }
      
      // 可以根据rotation调整光标方向，这里先使用基础方向
      return cursorMap[handleKey] || 'default'
    }

    /**
     * 绘制选中框和控制手柄。
     * 处理流程：
     * 1、读取图片与变换并计算选框几何信息
     * 2、绘制旋转后的矩形边框
     * 3、计算手柄位置
     * 4、绘制旋转连接线
     * 5、绘制八个缩放手柄
     * 6、绘制旋转手柄
     */
    const drawSelectionBox = async (character) => {
      // 1、读取图片实际尺寸和变换，计算手柄度量。
      const transform = character.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
      const { handleSize, rotateHandleDistance, rotateHandleRadius } = getHandleMetrics()
      
      try {
        // 获取人物图片以计算实际尺寸
        const img = await loadImage(character.imageSrc)
        const fitSize = calculateContainSize(
          img.naturalWidth,
          img.naturalHeight,
          canvasWidth,
          canvasHeight
        )
        const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
        const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
        const width = fitSize.width * sx
        const height = fitSize.height * sy
        const centerX = canvasWidth / 2 + transform.x
        const centerY = canvasHeight / 2 + transform.y
        
        // 2、绘制旋转后的边框。
        ctx.value.save()
        ctx.value.translate(centerX, centerY)
        ctx.value.rotate(transform.rotation * Math.PI / 180)
        
        // 外边框（蓝色）
        ctx.value.strokeStyle = '#2563eb'
        ctx.value.lineWidth = 2
        ctx.value.strokeRect(-width / 2, -height / 2, width, height)
        
        ctx.value.restore()
        
        // 3、获取所有手柄位置。
        const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
        
        // 4、绘制旋转手柄连接线（细虚线）。
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
        
        // 5、绘制8个缩放手柄（白色方块和蓝色边框）。
        ctx.value.fillStyle = '#ffffff'
        ctx.value.strokeStyle = '#2563eb'
        ctx.value.lineWidth = 1.5
        
        for (const [key, handle] of Object.entries(handles)) {
          if (key === 'rotate') continue
          
          // 绘制方块手柄
          ctx.value.fillRect(
            handle.x - handleSize / 2,
            handle.y - handleSize / 2,
            handleSize,
            handleSize
          )
          ctx.value.strokeRect(
            handle.x - handleSize / 2,
            handle.y - handleSize / 2,
            handleSize,
            handleSize
          )
        }
        
        // 6、绘制旋转手柄（圆形，带特殊样式）。
        if (handles.rotate) {
          ctx.value.save()
          
          // 外圆（白色填充）
          ctx.value.fillStyle = '#ffffff'
          ctx.value.strokeStyle = '#10b981'
          ctx.value.lineWidth = 2
          ctx.value.beginPath()
          ctx.value.arc(handles.rotate.x, handles.rotate.y, rotateHandleRadius, 0, Math.PI * 2)
          ctx.value.fill()
          ctx.value.stroke()
          
          // 内部旋转图标（简化版，绘制一个弧形箭头）
          ctx.value.strokeStyle = '#10b981'
          ctx.value.lineWidth = 1.5
          ctx.value.beginPath()
          ctx.value.arc(handles.rotate.x, handles.rotate.y, Math.max(4, rotateHandleRadius - 4), 0, Math.PI * 1.5)
          ctx.value.stroke()
          
          ctx.value.restore()
        }
        
      } catch (error) {
        console.error('绘制选中框失败:', error)
      }
    }

    /**
     * 处理鼠标滚轮（缩放选中的图片）
     * 处理流程：
     * 1、由滚轮方向计算缩放增量
     * 2、更新激活对话框或人物的等比缩放并重新绘制
     */
    const handleWheel = (event) => {
      // 1、根据滚轮方向计算当前对象的缩放增量。
      const delta = event.deltaY > 0 ? -0.1 : 0.1
      
      // 2、更新当前激活对象并重新绘制。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        // 缩放对话框（等比：同步 scaleX/scaleY）
        const t = props.dialogFrame.transform || {}
        const base = t.scale || 1
        const newScale = clamp(base + delta, 0.1, 5)
        const factor = newScale / base
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...t,
            scale: newScale,
            scaleX: (t.scaleX ?? base) * factor,
            scaleY: (t.scaleY ?? base) * factor
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        // 缩放人物
        const currentScale = getUniformScale(props.activeCharacter.transform)
        const newScale = clamp(currentScale + delta, 0.1, 5)
        
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            scale: newScale,
            // 兼容：若之前带scaleX/scaleY，保持等比
            ...(props.activeCharacter.transform.scaleX != null || props.activeCharacter.transform.scaleY != null
              ? {
                  scaleX: newScale,
                  scaleY: newScale
                }
              : {})
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 激活对话框
     * 处理流程：
     * 1、保留空入口，实际选择由素材管理组件通知父组件
     */
    const activateFrame = () => {
      // 1、此入口不修改从父组件派生的激活类型。
      // 不再直接修改activeObjectType，而是通过事件通知父组件
      // activeObjectType现在是computed，从props获取
      // 这里可以触发frame-select事件，但已经在DialogFrameManager中处理
    }

    /**
     * 激活人物
     * 处理流程：
     * 1、保留空入口，由父组件统一维护激活类型
     */
    const activateCharacter = () => {
      // 1、人物选择状态由外部事件更新。
      // 同样，不再直接修改activeObjectType
      // 如果需要切换，应该通过emit通知父组件
    }

    /**
     * 检测点击位置是否在人物的不透明像素上
     * 处理流程：
     * 1、加载人物并计算变换后的尺寸与位置
     * 2、单独绘制人物并读取点击点透明度
     * 3、返回命中结果，读取失败时按未命中处理
     */
    const isPointOnCharacter = async (character, x, y) => {
      // 1、还原人物的实际画布绘制参数。
      try {
        const img = await loadImage(character.imageSrc)
        const transform = character.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        
        // 计算人物的绘制尺寸和位置
        const fitSize = calculateContainSize(
          img.naturalWidth,
          img.naturalHeight,
          canvasWidth,
          canvasHeight
        )
        
        const scale = getUniformScale(transform)
        const drawWidth = fitSize.width * scale
        const drawHeight = fitSize.height * scale
        const centerX = canvasWidth / 2 + transform.x
        const centerY = canvasHeight / 2 + transform.y
        
        // 2、创建临时画布，只绘制这个人物并检测目标像素。
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = canvasWidth
        tempCanvas.height = canvasHeight
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })
        
        // 应用变换并绘制
        tempCtx.save()
        tempCtx.translate(centerX, centerY)
        if (transform.rotation !== 0) {
          tempCtx.rotate(transform.rotation * Math.PI / 180)
        }
        if (transform.flipHorizontal) {
          tempCtx.scale(-1, 1)
        }
        tempCtx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
        tempCtx.restore()
        
        // 获取点击位置的像素
        const imageData = tempCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1)
        const alpha = imageData.data[3]
        
        // 3、透明度大于零时判定为命中。
        return alpha > 0
      } catch (error) {
        console.error('检测人物像素失败:', error)
        return false
      }
    }

    /**
     * 查找点击位置的人物（从上到下遍历，返回最上层的人物）
     * 处理流程：
     * 1、按绘制顺序逆序执行像素命中检测并返回首个匹配人物
     * 2、均未命中时返回空值
     */
    const findCharacterAtPoint = async (x, y) => {
      // 1、从后往前遍历（后绘制的在上层）。
      for (let i = props.characters.length - 1; i >= 0; i--) {
        const character = props.characters[i]
        const isOnCharacter = await isPointOnCharacter(character, x, y)
        if (isOnCharacter) {
          return character
        }
      }
      // 2、没有人物命中目标像素。
      return null
    }

    /**
     * 检测点击位置是否位于对话框不透明像素上
     * 处理流程：
     * 1、读取对话框图片并计算各轴变换后的几何信息
     * 2、绘制到临时画布并读取点击点透明度
     * 3、返回像素命中结果，异常时返回未命中
     */
    const isPointOnFrame = async (x, y) => {
      // 1、确认对话框并计算实际绘制尺寸与中心。
      try {
        if (!props.dialogFrame) return false
        const img = await loadImage(props.dialogFrame.imageSrc)
        const transform = props.dialogFrame.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
        const fitSize = calculateContainSize(
          img.naturalWidth,
          img.naturalHeight,
          canvasWidth,
          canvasHeight
        )
        const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
        const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
        const drawWidth = fitSize.width * sx
        const drawHeight = fitSize.height * sy
        const centerX = canvasWidth / 2 + transform.x
        const centerY = canvasHeight / 2 + transform.y

        // 2、独立绘制对话框以检测目标像素。
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = canvasWidth
        tempCanvas.height = canvasHeight
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true })

        tempCtx.save()
        tempCtx.translate(centerX, centerY)
        if (transform.rotation !== 0) tempCtx.rotate(transform.rotation * Math.PI / 180)
        if (transform.flipHorizontal) tempCtx.scale(-1, 1)
        tempCtx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight)
        tempCtx.restore()

        const imageData = tempCtx.getImageData(Math.floor(x), Math.floor(y), 1, 1)
        const alpha = imageData.data[3]
        // 3、只将非透明像素视为命中。
        return alpha > 0
      } catch (_) {
        return false
      }
    }

    /**
     * 处理鼠标按下
     * 处理流程：
     * 1、转换鼠标位置到画布坐标
     * 2、优先检测当前对象的缩放或旋转手柄并保存起始快照
     * 3、检测人物及对话框像素，激活命中对象并初始化平移拖拽
     */
    const handleMouseDown = async (event) => {
      // 1、根据实际显示尺寸换算画布内部坐标。
      const rect = canvas.value.getBoundingClientRect()
      // 修正坐标转换：从显示坐标转换为画布内部坐标
      const scaleX = canvasWidth / rect.width
      const scaleY = canvasHeight / rect.height
      const x = (event.clientX - rect.left) * scaleX
      const y = (event.clientY - rect.top) * scaleY
      
      // 2、检查是否点击了控制手柄。
      if (activeObjectType.value === 'character' && props.activeCharacter) {
        try {
          const img = await loadImage(props.activeCharacter.imageSrc)
          const fitSize = calculateContainSize(
            img.naturalWidth,
            img.naturalHeight,
            canvasWidth,
            canvasHeight
          )
          
        const transform = props.activeCharacter.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
        const uScale = getUniformScale(transform)
        const width = fitSize.width * uScale
        const height = fitSize.height * uScale
          const centerX = canvasWidth / 2 + transform.x
          const centerY = canvasHeight / 2 + transform.y
          const { rotateHandleDistance } = getHandleMetrics()
          const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
          const clickedHandle = getHandleAtPoint(x, y, handles)
          
          if (clickedHandle) {
            // 点击了手柄
            activeHandle.value = clickedHandle
            handleDragStart.value = {
              x,
              y,
              transform: { ...transform },
              centerX,
              centerY,
              width,
              height,
              target: 'character'
            }
            return
          }
        } catch (error) {
          console.error('检测手柄失败:', error)
        }
      }

      // 对话框手柄检测（当当前激活对象为frame时优先）
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        try {
          const frameImg = await loadImage(props.dialogFrame.imageSrc)
          const fitSize = calculateContainSize(
            frameImg.naturalWidth,
            frameImg.naturalHeight,
            canvasWidth,
            canvasHeight
          )
          const transform = props.dialogFrame.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
          const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
          const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
          const width = fitSize.width * sx
          const height = fitSize.height * sy
          const centerX = canvasWidth / 2 + transform.x
          const centerY = canvasHeight / 2 + transform.y
          const { rotateHandleDistance } = getHandleMetrics()
          const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
          const clickedHandle = getHandleAtPoint(x, y, handles)
          if (clickedHandle) {
            activeHandle.value = clickedHandle
            handleDragStart.value = {
              x,
              y,
              transform: { ...transform },
              centerX,
              centerY,
              width,
              height,
              target: 'frame'
            }
            return
          }
        } catch (_) {}
      }
      
      // 3、优先查找点击位置是否在某个人物上，随后处理对话框和平移。
      const clickedCharacter = await findCharacterAtPoint(x, y)
      
      if (clickedCharacter) {
        // 点击到了人物，激活并开始拖拽该人物
        emit('character-select', clickedCharacter)
        
        // 开始拖拽
        isDragging.value = true
        dragStartX.value = x
        dragStartY.value = y
        dragCharacter.value = clickedCharacter
        dragInitialTransform.value = { ...clickedCharacter.transform }
        return
      }
      
      // 没有点击到人物，根据当前激活的对象类型或对话框命中处理
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        // 拖拽对话框
        isDragging.value = true
        dragStartX.value = x
        dragStartY.value = y
        dragFrame.value = props.dialogFrame
        dragInitialTransform.value = { ...props.dialogFrame.transform }
      } else if (props.dialogFrame) {
        // 如果点击在对话框上，选中并允许拖拽
        const onFrame = await isPointOnFrame(x, y)
        if (onFrame) {
          emit('frame-select')
          isDragging.value = true
          dragStartX.value = x
          dragStartY.value = y
          dragFrame.value = props.dialogFrame
          dragInitialTransform.value = { ...props.dialogFrame.transform }
          return
        }
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        // 拖拽当前激活的人物
        isDragging.value = true
        dragStartX.value = x
        dragStartY.value = y
        dragCharacter.value = props.activeCharacter
        dragInitialTransform.value = { ...props.activeCharacter.transform }
      }
    }

    /**
     * 处理鼠标移动
     * 处理流程：
     * 1、换算当前画布坐标
     * 2、手柄拖拽时计算旋转、等比缩放或对话框轴向拉伸
     * 3、空闲时检测手柄和像素命中以更新光标
     * 4、普通拖拽时按起始快照计算总位移并立即重绘
     */
    const handleMouseMove = async (event) => {
      // 1、将鼠标位置转换为画布内部坐标。
      const rect = canvas.value.getBoundingClientRect()
      // 修正坐标转换：从显示坐标转换为画布内部坐标
      const scaleX = canvasWidth / rect.width
      const scaleY = canvasHeight / rect.height
      const x = (event.clientX - rect.left) * scaleX
      const y = (event.clientY - rect.top) * scaleY
      
      // 2、处理手柄拖拽并仅更新拖拽中的临时对象。
      if (activeHandle.value && handleDragStart.value.transform) {
        const centerX = handleDragStart.value.centerX
        const centerY = handleDragStart.value.centerY
        const rotation = handleDragStart.value.transform.rotation
        const angle = rotation * Math.PI / 180
        
        let newTransform = { ...handleDragStart.value.transform }
        
        if (activeHandle.value === 'rotate') {
          // 旋转手柄
          canvas.value.style.cursor = 'grab'
          
          const startAngle = Math.atan2(
            handleDragStart.value.y - centerY,
            handleDragStart.value.x - centerX
          )
          
          const currentAngle = Math.atan2(
            y - centerY,
            x - centerX
          )
          
          const angleDiff = (currentAngle - startAngle) * 180 / Math.PI
          newTransform.rotation = handleDragStart.value.transform.rotation + angleDiff
          
        } else {
          // 缩放/拉伸手柄
          canvas.value.style.cursor = getCursorForHandle(activeHandle.value, rotation)
          
          // 将鼠标位置转换到本地坐标系（考虑旋转）
          const localX = (x - centerX) * Math.cos(-angle) - (y - centerY) * Math.sin(-angle)
          const localY = (x - centerX) * Math.sin(-angle) + (y - centerY) * Math.cos(-angle)
          
          const startLocalX = (handleDragStart.value.x - centerX) * Math.cos(-angle) - (handleDragStart.value.y - centerY) * Math.sin(-angle)
          const startLocalY = (handleDragStart.value.x - centerX) * Math.sin(-angle) + (handleDragStart.value.y - centerY) * Math.cos(-angle)
          
          const originalWidth = handleDragStart.value.width
          const originalHeight = handleDragStart.value.height
          
          // 判断是角手柄还是边手柄
          const isCornerHandle = activeHandle.value.length === 2 // nw, ne, sw, se
          
          if (isCornerHandle) {
            // 角手柄：等比缩放
            const startDist = Math.sqrt(startLocalX * startLocalX + startLocalY * startLocalY)
            const currentDist = Math.sqrt(localX * localX + localY * localY)
            if (startDist > 0) {
              const ratio = currentDist / startDist
              if (handleDragStart.value.target === 'frame') {
                const startSX = handleDragStart.value.transform.scaleX ?? (handleDragStart.value.transform.scale || 1)
                const startSY = handleDragStart.value.transform.scaleY ?? (handleDragStart.value.transform.scale || 1)
                const sx = clamp(startSX * ratio, 0.1, 10)
                const sy = clamp(startSY * ratio, 0.1, 10)
                newTransform.scaleX = sx
                newTransform.scaleY = sy
                newTransform.scale = Math.sqrt(sx * sy)
              } else {
                const base = handleDragStart.value.transform.scale || 1
                newTransform.scale = clamp(base * ratio, 0.1, 10)
                // 清理可能遗留的非等比字段
                delete newTransform.scaleX
                delete newTransform.scaleY
              }
            }
          } else {
            // 边手柄：对话框支持非等比；人物仍等比
            if (handleDragStart.value.target === 'frame') {
              const startSX = handleDragStart.value.transform.scaleX ?? (handleDragStart.value.transform.scale || 1)
              const startSY = handleDragStart.value.transform.scaleY ?? (handleDragStart.value.transform.scale || 1)
              let sx = startSX
              let sy = startSY
              switch (activeHandle.value) {
                case 'n':
                case 's':
                  if (Math.abs(startLocalY) > 0) {
                    const rY = Math.abs(localY) / Math.abs(startLocalY)
                    sy = clamp(startSY * rY, 0.1, 10)
                  }
                  break
                case 'w':
                case 'e':
                  if (Math.abs(startLocalX) > 0) {
                    const rX = Math.abs(localX) / Math.abs(startLocalX)
                    sx = clamp(startSX * rX, 0.1, 10)
                  }
                  break
              }
              newTransform.scaleX = sx
              newTransform.scaleY = sy
              newTransform.scale = Math.sqrt(sx * sy)
            } else {
              const base = handleDragStart.value.transform.scale || 1
              const r = Math.max(
                Math.abs(localX) / Math.max(1e-6, Math.abs(startLocalX)),
                Math.abs(localY) / Math.max(1e-6, Math.abs(startLocalY))
              )
              newTransform.scale = clamp(base * r, 0.1, 10)
              delete newTransform.scaleX
              delete newTransform.scaleY
            }
          }
        }
        
        // 更新拖拽中的对象（对话框或人物）
        if (handleDragStart.value.target === 'frame' && props.dialogFrame) {
          dragFrame.value = {
            ...props.dialogFrame,
            transform: newTransform
          }
        } else if (props.activeCharacter) {
          dragCharacter.value = {
            ...props.activeCharacter,
            transform: newTransform
          }
        }
        
        renderImmediate()
        return
      }
      
      // 3、如果没有拖拽手柄，检查鼠标是否悬停在手柄或人物上。
      if (!isDragging.value) {
        // 先检查激活人物的手柄
        if (activeObjectType.value === 'character' && props.activeCharacter) {
          try {
            const img = await loadImage(props.activeCharacter.imageSrc)
            const fitSize = calculateContainSize(
              img.naturalWidth,
              img.naturalHeight,
              canvasWidth,
              canvasHeight
            )
            
            const transform = props.activeCharacter.transform || { x: 0, y: 0, scale: 1, rotation: 0 }
            const uScale = getUniformScale(transform)
            const width = fitSize.width * uScale
            const height = fitSize.height * uScale
            const centerX = canvasWidth / 2 + transform.x
            const centerY = canvasHeight / 2 + transform.y
            const { rotateHandleDistance } = getHandleMetrics()
            const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
            const hoveredHandle = getHandleAtPoint(x, y, handles)
            
            if (hoveredHandle) {
              canvas.value.style.cursor = getCursorForHandle(hoveredHandle, transform.rotation)
              return
            }
          } catch (error) {
            // 忽略错误，继续检查
          }
        }
        // 对话框手柄悬停
        if (activeObjectType.value === 'frame' && props.dialogFrame) {
          try {
            const frameImg = await loadImage(props.dialogFrame.imageSrc)
            const fitSize = calculateContainSize(
              frameImg.naturalWidth,
              frameImg.naturalHeight,
              canvasWidth,
              canvasHeight
            )
            const transform = props.dialogFrame.transform || { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 }
            const sx = (transform.scaleX != null ? transform.scaleX : (transform.scale != null ? transform.scale : 1))
            const sy = (transform.scaleY != null ? transform.scaleY : (transform.scale != null ? transform.scale : 1))
            const width = fitSize.width * sx
            const height = fitSize.height * sy
            const centerX = canvasWidth / 2 + transform.x
            const centerY = canvasHeight / 2 + transform.y
            const { rotateHandleDistance } = getHandleMetrics()
            const handles = getTransformHandles(centerX, centerY, width, height, transform.rotation, rotateHandleDistance)
            const hoveredHandle = getHandleAtPoint(x, y, handles)
            if (hoveredHandle) {
              canvas.value.style.cursor = getCursorForHandle(hoveredHandle, transform.rotation)
              return
            }
          } catch (_) {}
        }
        
        // 检查是否悬停在任何人物上
        const hoveredCharacter = await findCharacterAtPoint(x, y)
        if (hoveredCharacter) {
          canvas.value.style.cursor = 'pointer'
          return
        }
        // 检查是否悬停在对话框上
        if (props.dialogFrame) {
          const onFrame = await isPointOnFrame(x, y)
          if (onFrame) {
            canvas.value.style.cursor = 'move'
            return
          }
        }
        
        // 默认光标
        if (activeObjectType.value === 'character' && props.activeCharacter) {
          canvas.value.style.cursor = 'move'
        } else if (activeObjectType.value === 'frame') {
          canvas.value.style.cursor = 'move'
        } else {
          canvas.value.style.cursor = 'default'
        }
      }
      
      // 4、普通拖拽按起始状态与总偏移量更新位置。
      if (!isDragging.value || !dragInitialTransform.value) return
      
      // 计算从初始位置的总偏移量（而不是增量）
      const totalDeltaX = x - dragStartX.value
      const totalDeltaY = y - dragStartY.value
      
      if (dragFrame.value) {
        // 拖拽对话框
        const updatedFrame = {
          ...dragFrame.value,
          transform: {
            ...dragFrame.value.transform,
            x: dragInitialTransform.value.x + totalDeltaX,
            y: dragInitialTransform.value.y + totalDeltaY
          }
        }
        dragFrame.value = updatedFrame
      } else if (dragCharacter.value) {
        // 拖拽人物
        const updatedCharacter = {
          ...dragCharacter.value,
          transform: {
            ...dragCharacter.value.transform,
            x: dragInitialTransform.value.x + totalDeltaX,
            y: dragInitialTransform.value.y + totalDeltaY
          }
        }
        dragCharacter.value = updatedCharacter
      }
      
      // 手动渲染，不触发watch
      renderImmediate()
    }

    /**
     * 处理鼠标释放
     * 处理流程：
     * 1、提交手柄拖拽的最终变换并清理手柄状态
     * 2、提交普通平移拖拽的最终对象并清空临时状态
     */
    const handleMouseUp = () => {
      // 1、处理手柄拖拽结束。
      if (activeHandle.value) {
        if (dragCharacter.value) {
          emit('character-update', dragCharacter.value)
        }
        if (dragFrame.value) {
          emit('frame-update', dragFrame.value)
        }
        activeHandle.value = null
        handleDragStart.value = { x: 0, y: 0, transform: null, centerX: 0, centerY: 0 }
        dragCharacter.value = null
        dragFrame.value = null
        return
      }
      
      // 2、普通拖拽结束时才发射更新事件，随后清理状态。
      if (isDragging.value) {
        if (dragFrame.value) {
          emit('frame-update', dragFrame.value)
        } else if (dragCharacter.value) {
          emit('character-update', dragCharacter.value)
        }
      }
      
      isDragging.value = false
      dragCharacter.value = null
      dragFrame.value = null
      dragInitialTransform.value = null
    }

    /**
     * 处理鼠标离开
     * 处理流程：
     * 1、复用鼠标释放逻辑提交并结束拖拽
     */
    const handleMouseLeave = () => {
      // 1、离开画布时完成当前拖拽。
      handleMouseUp()
    }


    /**
     * 计算画布显示尺寸（保持宽高比，不超出容器）
     * 处理流程：
     * 1、读取容器尺寸并扣除边距
     * 2、按固定宽高比计算最大可用显示尺寸
     * 3、同步响应状态及画布显示样式
     */
    const calculateCanvasSize = () => {
      // 1、确认容器已挂载并读取可用空间。
      if (!canvasContainer.value) return
      
      const container = canvasContainer.value
      const containerWidth = container.clientWidth
      const containerHeight = container.clientHeight
      
      // 留出边距
      const padding = 40
      const availableWidth = containerWidth - padding
      const availableHeight = containerHeight - padding
      
      // 2、根据宽高比计算适合的尺寸。
      let newWidth, newHeight
      
      if (availableWidth / availableHeight > aspectRatio) {
        // 容器更宽，以高度为准
        newHeight = availableHeight
        newWidth = newHeight * aspectRatio
      } else {
        // 容器更高或刚好，以宽度为准
        newWidth = availableWidth
        newHeight = newWidth / aspectRatio
      }
      
      // 3、更新显示尺寸与画布样式。
      displayWidth.value = newWidth
      displayHeight.value = newHeight
      
      // 更新canvas样式
      if (canvas.value) {
        canvas.value.style.width = `${newWidth}px`
        canvas.value.style.height = `${newHeight}px`
      }
    }
    
    /**
     * 自适应容器大小（废弃，使用calculateCanvasSize代替）
     * 处理流程：
     * 1、委托统一尺寸计算函数适配容器
     */
    const fitToContainer = () => {
      // 1、保留旧调用入口并转交显示尺寸计算。
      calculateCanvasSize()
    }

    /**
     * 放大
     * 处理流程：
     * 1、增加当前对话框或人物的缩放并重新绘制
     */
    const scaleUp = () => {
      // 1、按固定步长放大目标，对话框同步维持各轴比例。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const t = props.dialogFrame.transform || {}
        const base = t.scale || 1
        const next = clamp(base + 0.1, 0.1, 5)
        const factor = next / base
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...t,
            scale: next,
            scaleX: (t.scaleX ?? base) * factor,
            scaleY: (t.scaleY ?? base) * factor
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            scale: clamp(props.activeCharacter.transform.scale + 0.1, 0.1, 5)
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 缩小
     * 处理流程：
     * 1、减少当前对话框或人物的缩放并重新绘制
     */
    const scaleDown = () => {
      // 1、按固定步长缩小目标并限制缩放范围。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const t = props.dialogFrame.transform || {}
        const base = t.scale || 1
        const next = clamp(base - 0.1, 0.1, 5)
        const factor = next / base
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...t,
            scale: next,
            scaleX: (t.scaleX ?? base) * factor,
            scaleY: (t.scaleY ?? base) * factor
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            scale: clamp(props.activeCharacter.transform.scale - 0.1, 0.1, 5)
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 逆时针旋转
     * 处理流程：
     * 1、将激活对象角度减少三度并提交重绘
     */
    const rotateLeft = () => {
      // 1、更新对话框或人物的逆时针旋转角度。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...props.dialogFrame.transform,
            rotation: props.dialogFrame.transform.rotation - 3
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            rotation: props.activeCharacter.transform.rotation - 3
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 顺时针旋转
     * 处理流程：
     * 1、将激活对象角度增加三度并提交重绘
     */
    const rotateRight = () => {
      // 1、更新对话框或人物的顺时针旋转角度。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...props.dialogFrame.transform,
            rotation: props.dialogFrame.transform.rotation + 3
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            rotation: props.activeCharacter.transform.rotation + 3
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 水平翻转
     * 处理流程：
     * 1、反转激活对象的水平翻转标记并提交重绘
     */
    const flipHorizontal = () => {
      // 1、切换对话框或人物的水平镜像状态。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            ...props.dialogFrame.transform,
            flipHorizontal: !props.dialogFrame.transform.flipHorizontal
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            ...props.activeCharacter.transform,
            flipHorizontal: !props.activeCharacter.transform.flipHorizontal
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 重置选中对象
     * 处理流程：
     * 1、恢复激活对象的默认变换并提交重绘
     */
    const handleImageReset = () => {
      // 1、清除位移、旋转与镜像并恢复默认缩放。
      if (activeObjectType.value === 'frame' && props.dialogFrame) {
        const updatedFrame = {
          ...props.dialogFrame,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            scaleX: 1,
            scaleY: 1,
            rotation: 0,
            flipHorizontal: false
          }
        }
        emit('frame-update', updatedFrame)
        render()
      } else if (activeObjectType.value === 'character' && props.activeCharacter) {
        const updatedCharacter = {
          ...props.activeCharacter,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            flipHorizontal: false
          }
        }
        emit('character-update', updatedCharacter)
        render()
      }
    }

    /**
     * 处理嵌入模式变化
     * 处理流程：
     * 1、重新绘制以应用当前嵌入模式
     */
    const handleEmbedModeChange = () => {
      // 1、重新渲染画布以应用新的嵌入模式。
      render()
    }

    /**
     * 处理不透明度渐变模式变化
     * 处理流程：
     * 1、重新绘制以应用当前渐变模式
     */
    const handleOpacityGradientModeChange = () => {
      // 1、重新渲染画布以应用新的渐变模式。
      render()
    }

    /**
     * 处理导出按钮点击
     * 处理流程：
     * 1、通知父页面启动目录选择与导出流程
     */
    const handleExport = () => {
      // 1、将导出命令交给父页面协调。
      emit('export')
    }

    /**
     * 监听容器大小变化（使用ResizeObserver）
     */
    let resizeObserver = null
    
    /**
     * 观察容器大小变化并更新画布。
     * 处理流程：
     * 1、确认容器并注册尺寸观察器
     * 2、尺寸变化时重新计算显示尺寸并绘制
     */
    const setupResizeObserver = () => {
      // 1、仅对已挂载的容器建立观察器。
      if (!canvasContainer.value) return
      
      resizeObserver = new ResizeObserver(() => {
        // 2、同步显示大小和画布内容。
        calculateCanvasSize()
        render()
      })
      
      resizeObserver.observe(canvasContainer.value)
    }

    /**
     * 监听主题变化（使用MutationObserver）
     */
    let themeObserver = null
    
    /**
     * 观察主题标记变化并更新透明背景显示。
     * 处理流程：
     * 1、创建触发重绘的属性观察器
     * 2、监听根元素及页面主体的主题相关属性
     */
    const setupThemeObserver = () => {
      // 1、主题变化时由统一绘制入口刷新棋盘格。
      themeObserver = new MutationObserver(() => {
        // 主题变化时重新渲染画布，更新棋盘格颜色
        render()
      })
      
      // 2、监听根元素与页面主体的主题属性变化。
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['class', 'data-theme']
      })
      
      // 同时监听 body 的 class 变化
      themeObserver.observe(document.body, {
        attributes: true,
        attributeFilter: ['class']
      })
    }

    // 3、连接数据变化和生命周期，卸载时释放窗口及属性观察器。
    watch(
      () => [props.dialogFrame, props.characters, props.activeCharacter],
      () => {
        // 拖拽过程中不自动渲染，避免冲突
        if (!isDragging.value) {
          render()
        }
      },
      { deep: true }
    )

    /**
     * 组件挂载
     */
    onMounted(() => {
      initCanvas()
      
      // 使用 nextTick 确保 DOM 已经渲染
      nextTick(() => {
        calculateCanvasSize()
        setupResizeObserver()
        setupThemeObserver()
        render()
      })
      
      // 兼容性：同时监听window resize
      window.addEventListener('resize', calculateCanvasSize)
    })

    /**
     * 组件卸载
     */
    onBeforeUnmount(() => {
      window.removeEventListener('resize', calculateCanvasSize)
      
      // 清理 ResizeObserver
      if (resizeObserver) {
        resizeObserver.disconnect()
        resizeObserver = null
      }
      
      // 清理 ThemeObserver
      if (themeObserver) {
        themeObserver.disconnect()
        themeObserver = null
      }
    })

    return {
      canvas,
      canvasContainer,
      zoom,
      activeObjectType,
      embedMode,
      opacityGradientMode,
      handleEmbedModeChange,
      handleOpacityGradientModeChange,
      handleWheel,
      handleMouseDown,
      handleMouseMove,
      handleMouseUp,
      handleMouseLeave,
      activateFrame,
      activateCharacter,
      scaleUp,
      scaleDown,
      rotateLeft,
      rotateRight,
      flipHorizontal,
      handleImageReset,
      handleExport,
      exportImage,
      render
    }
  }
}
</script>

<style scoped>
.dialog-frame-canvas {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--theme-background);
}

.canvas-toolbar {
  display: flex;
  justify-content: flex-start;
  align-items: center;
  padding: 12px 16px;
  background: var(--theme-background-card);
  border-bottom: 1px solid var(--theme-border);
  gap: 12px;
}

.toolbar-center,
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-label {
  font-size: 13px;
  color: var(--theme-foreground-muted);
  font-weight: 500;
}

.object-type-selector {
  display: flex;
  gap: 4px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  padding: 2px;
  background: var(--theme-background-secondary);
}

.toolbar-divider {
  width: 1px;
  background: var(--theme-border);
  margin: 0 4px;
}

.embed-mode-selector,
.opacity-gradient-selector {
  display: flex;
  align-items: center;
  gap: 8px;
}

.embed-label {
  font-size: 13px;
  color: var(--theme-foreground-muted);
  font-weight: 500;
  white-space: nowrap;
}

.embed-select {
  padding: 4px 8px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background: var(--theme-background);
  color: var(--theme-foreground);
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
  min-width: 120px;
}

.embed-select:hover {
  border-color: var(--theme-primary);
}

.embed-select:focus {
  outline: none;
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.1);
}

.canvas-container {
  flex: 1;
  overflow: hidden; /* 隐藏溢出，画布已自适应容器 */
  background: var(--theme-background-secondary);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  position: relative;
  min-height: 0; /* 确保flex布局正确工作 */
}

.main-canvas {
  display: block;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  cursor: move;
  border: 1px solid var(--theme-border);
  /* 保持宽高比，不变形 */
  object-fit: contain;
  /* Canvas内部使用高质量平滑 */
  image-rendering: auto;
  /* 最大尺寸限制 */
  max-width: 100%;
  max-height: 100%;
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  background: var(--theme-background);
  color: var(--theme-foreground);
}

.btn:hover:not(:disabled) {
  background: var(--theme-background-accent);
  border-color: var(--theme-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--theme-primary);
  border-color: var(--theme-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #3b82f6;
  border-color: #3b82f6;
}

.btn-small {
  padding: 4px 8px;
  font-size: 12px;
}
</style>

