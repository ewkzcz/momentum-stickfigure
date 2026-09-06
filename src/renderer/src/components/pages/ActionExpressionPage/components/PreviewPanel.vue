<template>
  <div class="preview-panel">
    <n-card title="预览面板" size="small" :bordered="true">
      <template #header-extra>
        <div class="preview-controls">
          <n-button size="small" type="primary" @click="$emit('render')" :loading="isRendering">
            <template #icon>
              <n-icon><span>🎨</span></n-icon>
            </template>
            渲染预览
          </n-button>
          <n-button size="small" quaternary @click="$emit('reset')">
            <template #icon>
              <n-icon><span>🔄</span></n-icon>
            </template>
            重置
          </n-button>
        </div>
      </template>
      
      <div class="preview-content">
        <!-- 画布容器 -->
        <div class="canvas-container">
          <canvas 
            ref="canvasRef"
            class="preview-canvas"
            :width="canvasSize.width"
            :height="canvasSize.height"
          />
          
          <!-- 空状态 -->
          <div v-if="!hasContent" class="canvas-placeholder">
            <n-icon size="64" class="placeholder-icon">
              <span>🎭</span>
            </n-icon>
            <n-text class="placeholder-text">
              请上传PSD文件开始预览
            </n-text>
          </div>
        </div>
        
        <!-- 预览信息 -->
        <div class="preview-info">
          <n-text depth="3" class="info-text">
            {{ previewInfo }}
          </n-text>
          
          <!-- 渲染统计 -->
          <div v-if="renderStats.layerCount > 0" class="render-stats">
            <n-space>
              <n-tag size="small" type="info">
                图层: {{ renderStats.layerCount }}
              </n-tag>
              <n-tag size="small" type="success" v-if="renderStats.renderTime">
                耗时: {{ renderStats.renderTime }}ms
              </n-tag>
            </n-space>
          </div>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup>
/** 预览面板：维护画布、渲染状态与统计，并向父组件暴露控制接口。 */
import { ref, reactive, computed, onMounted } from 'vue'

const props = defineProps({
  previewInfo: {
    type: String,
    default: '选择图层查看预览'
  }
})

defineEmits(['render', 'reset'])

const canvasRef = ref(null)
const isRendering = ref(false)

// 画布尺寸
const canvasSize = reactive({
  width: 400,
  height: 400
})

// 渲染统计
const renderStats = reactive({
  layerCount: 0,
  renderTime: 0
})

/**
 * 判断预览是否已有图层内容。
 * 处理流程：
 * 1、检查渲染统计中的图层数量是否大于零。
 */
const hasContent = computed(() => {
  // 1、由图层数量派生空态标志。
  return renderStats.layerCount > 0
})

/**
 * 获取画布元素供父组件绘制。
 * 处理流程：
 * 1、返回当前画布引用。
 */
const getCanvas = () => {
  // 1、返回实际画布，未挂载时为空。
  return canvasRef.value
}

/**
 * 清空画布及渲染统计。
 * 处理流程：
 * 1、画布已挂载时擦除完整区域。
 * 2、将图层数量与渲染耗时归零。
 */
const clearCanvas = () => {
  // 1、清除已挂载画布的像素。
  if (canvasRef.value) {
    const ctx = canvasRef.value.getContext('2d')
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height)
  }
  // 2、同步重置统计，恢复预览空态。
  renderStats.layerCount = 0
  renderStats.renderTime = 0
}

/**
 * 更新渲染统计。
 * 处理流程：
 * 1、将传入统计字段合并到响应式对象。
 */
const updateRenderStats = (stats) => {
  // 1、保留对象引用以维持界面响应。
  Object.assign(renderStats, stats)
}

/**
 * 设置预览渲染状态。
 * 处理流程：
 * 1、写入调用方传入的忙碌标志。
 */
const setRenderingState = (state) => {
  // 1、更新界面使用的渲染标志。
  isRendering.value = state
}

/**
 * 挂载后初始化预览背景。
 * 处理流程：
 * 1、画布存在时填充默认背景区域。
 */
onMounted(() => {
  // 1、取得画布上下文并绘制默认背景。
  if (canvasRef.value) {
    const ctx = canvasRef.value.getContext('2d')
    // 设置默认背景
    ctx.fillStyle = 'var(--theme-background-secondary)'
    ctx.fillRect(0, 0, canvasSize.width, canvasSize.height)
  }
})

// 暴露方法给父组件
defineExpose({
  getCanvas,
  clearCanvas,
  updateRenderStats,
  setRenderingState
})
</script>

<style scoped>
.preview-panel {
  flex: 1;
  min-height: 400px;
}

.preview-controls {
  display: flex;
  gap: var(--theme-spacing-xs);
}

.preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-lg);
}

.canvas-container {
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  background: var(--theme-background-secondary);
  border-radius: var(--theme-border-radius);
  border: 1px solid var(--theme-border);
  padding: var(--theme-spacing-lg);
  min-height: 440px;
}

.preview-canvas {
  border-radius: var(--theme-border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  background: white;
}

.canvas-placeholder {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-spacing-md);
  color: var(--theme-foreground-muted);
}

.placeholder-icon {
  opacity: 0.6;
}

.placeholder-text {
  font-size: var(--theme-font-sm);
}

.preview-info {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-md);
  background: var(--theme-background-accent);
  border-radius: var(--theme-border-radius);
  border: 1px solid var(--theme-border);
}

.info-text {
  font-size: var(--theme-font-sm);
  line-height: 1.5;
}

.render-stats {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

/* 深色主题适配 */
.theme-dark .preview-canvas {
  background: var(--theme-background-card);
}

.theme-dark .canvas-container {
  background: var(--theme-background-card);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .canvas-container {
    padding: var(--theme-spacing-md);
    min-height: 300px;
  }
  
  .preview-canvas {
    max-width: 100%;
    height: auto;
  }
  
  .preview-controls {
    flex-wrap: wrap;
  }
}
</style>
