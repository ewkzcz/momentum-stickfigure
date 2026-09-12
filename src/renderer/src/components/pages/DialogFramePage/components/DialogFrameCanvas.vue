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
/**
 * 父组件保留画布布局、共享拖拽状态与生命周期，绘制和交互分别由组合函数实现。
 * 处理流程：先建立父级唯一状态，再通过延迟闭包连接绘制与交互，最后注册原有观察器。
 */
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useDialogCanvasRender } from '../composables/useDialogCanvasRender.js'
import { useDialogCanvasInteraction } from '../composables/useDialogCanvasInteraction.js'

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

    // 2、注入原有引用和绘制入口；上方延迟闭包在实际绘制时调用此处返回的交互函数。
    const {
      drawSelectionBox,
      getHandleMetrics,
      getTransformHandles,
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
      handleImageReset
    } = useDialogCanvasInteraction({
      props,
      emit,
      canvas,
      ctx,
      canvasWidth,
      canvasHeight,
      displayWidth,
      activeObjectType,
      isDragging,
      dragStartX,
      dragStartY,
      dragCharacter,
      dragFrame,
      dragInitialTransform,
      loadImage,
      render,
      renderImmediate
    })

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
     * 2、监听根元素及页面主体的主题相关属性变化
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
