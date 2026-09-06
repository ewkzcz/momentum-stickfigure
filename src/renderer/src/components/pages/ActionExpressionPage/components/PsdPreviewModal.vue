<template>
  <n-modal 
    v-model:show="isVisible" 
    preset="card" 
    :title="modalTitle"
    size="huge"
    :bordered="false"
    :segmented="segmentedConfig"
    :mask-closable="false"
    style="max-width: 95vw; width: 1400px; max-height: 90vh;"
    @close="handleClose"
  >
    <div class="psd-preview-content">
      <!-- 预览工具栏 -->
      <div class="preview-toolbar">
        <n-space>
          <n-button type="primary" @click="handleCompose" :loading="composing">
            <template #icon>
              <n-icon><span>🎨</span></n-icon>
            </template>
            合成预览
          </n-button>
          <n-button quaternary @click="handleExport" :loading="exporting">
            <template #icon>
              <n-icon><span>💾</span></n-icon>
            </template>
            导出图片
          </n-button>
          <n-button quaternary @click="handleRefresh">
            <template #icon>
              <n-icon><span>🔄</span></n-icon>
            </template>
            刷新预览
          </n-button>
        </n-space>
        
        <!-- 预览信息 -->
        <div class="preview-info">
          <n-space>
            <n-tag size="small" type="info" v-if="dimensions.width">
              尺寸: {{ dimensions.width }}×{{ dimensions.height }}
            </n-tag>
            <n-tag size="small" type="success" v-if="renderTime > 0">
              渲染: {{ renderTime }}ms
            </n-tag>
            <n-tag size="small" type="warning" v-if="layerData.length > 0">
              图层: {{ layerData.length }}
            </n-tag>
          </n-space>
        </div>
      </div>

      <!-- 主要内容区域 -->
      <div class="preview-main">
        <!-- 左侧：图层列表 -->
        <div class="layer-list">
          <n-card title="图层控制" size="small" :bordered="true">
            <div class="layer-controls">
              <n-space vertical>
                <div class="control-section">
                  <n-text class="section-title">快速操作</n-text>
                  <n-space>
                    <n-button size="small" quaternary @click="toggleAllLayers">
                      全选/取消
                    </n-button>
                    <n-button size="small" quaternary @click="invertLayerSelection">
                      反选
                    </n-button>
                  </n-space>
                </div>
                
                <!-- 图层项列表 -->
                <div class="layer-items" v-if="layerData.length > 0">
                  <div 
                    v-for="layer in layerData" 
                    :key="layer.id"
                    class="layer-item"
                    :class="{ 'active': layer.visible }"
                  >
                    <n-checkbox 
                      :checked="layer.visible"
                      @update:checked="(checked) => handleLayerToggle(layer.id, checked)"
                    />
                    <n-icon class="layer-icon">
                      <span>{{ getLayerIcon(layer.type) }}</span>
                    </n-icon>
                    <n-text class="layer-name">{{ layer.name }}</n-text>
                    <n-tag size="tiny" :type="getLayerTagType(layer.type)" class="layer-type">
                      {{ layer.type }}
                    </n-tag>
                  </div>
                </div>
                
                <n-empty 
                  v-else
                  description="暂无图层数据"
                  size="small"
                >
                  <template #icon>
                    <n-icon size="32">
                      <span>📁</span>
                    </n-icon>
                  </template>
                </n-empty>
              </n-space>
            </div>
          </n-card>
        </div>

        <!-- 右侧：预览区域 -->
        <div class="preview-area">
          <n-card title="预览效果" size="small" :bordered="true">
            <div class="preview-container">
              <!-- 预览图片 -->
              <div class="preview-image-container" v-if="previewUrl">
                <img 
                  :src="previewUrl" 
                  :alt="title"
                  class="preview-image"
                  @load="handleImageLoad"
                  @error="handleImageError"
                />
              </div>
              
              <!-- 加载状态 -->
              <div v-else-if="isLoading" class="preview-loading">
                <n-spin size="large" />
                <n-text class="loading-text">正在生成预览...</n-text>
              </div>
              
              <!-- 空状态 -->
              <div v-else class="preview-empty">
                <n-icon size="64" class="empty-icon">
                  <span>🎨</span>
                </n-icon>
                <n-text class="empty-text">点击"合成预览"生成效果图</n-text>
              </div>
            </div>
          </n-card>
        </div>
      </div>

      <!-- 底部操作 -->
      <div class="preview-actions">
        <n-space justify="end">
          <n-button @click="handleClose">关闭</n-button>
          <n-button type="primary" @click="handleConfirm" :disabled="!previewUrl">
            确认使用
          </n-button>
        </n-space>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
/** PSD 预览弹窗：展示图层与预览图，并将图层选择、合成和导出操作交给父组件。 */
import { ref, reactive, computed, watch } from 'vue'
import { useMessage } from 'naive-ui'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    default: 'PSD预览'
  },
  layerData: {
    type: Array,
    default: () => []
  },
  previewUrl: {
    type: String,
    default: ''
  },
  dimensions: {
    type: Object,
    default: () => ({})
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  renderTime: {
    type: Number,
    default: 0
  }
})

const emits = defineEmits(['close', 'layer-toggle', 'compose', 'export'])

const message = useMessage()

// 响应式状态
const isVisible = ref(props.visible)
const composing = ref(false)
const exporting = ref(false)

// 模态框配置
const modalTitle = computed(() => props.title || 'PSD图层预览')

const segmentedConfig = {
  content: true,
  footer: false
}

// 监听外部visible变化
watch(() => props.visible, (newVal) => {
  isVisible.value = newVal
})

// 监听内部isVisible变化
watch(isVisible, (newVal) => {
  if (!newVal) {
    handleClose()
  }
})

/**
 * 请求父组件关闭预览弹窗。
 * 处理流程：
 * 1、发送关闭事件，由父组件更新显示状态。
 */
const handleClose = () => {
  // 1、通知父组件关闭弹窗。
  emits('close')
}

/**
 * 通知父组件修改指定图层的可见状态。
 * 处理流程：
 * 1、转发图层标识及目标勾选状态。
 */
const handleLayerToggle = (layerId, checked) => {
  // 1、将图层选择变化发送给数据持有方。
  emits('layer-toggle', layerId, checked)
}

/**
 * 展示模拟合成等待状态并发出合成请求。
 * 处理流程：
 * 1、进入忙碌状态并等待两秒模拟耗时。
 * 2、发送合成事件并提示完成，此处不执行图像合成，也不等待父组件处理结果。
 * 3、提示当前流程中的异常并清除忙碌状态。
 */
const handleCompose = async () => {
  // 1、显示合成中的状态并执行模拟等待。
  composing.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 2000)) // 模拟合成过程
    // 2、将实际合成操作交给父组件，并立即显示完成提示。
    emits('compose')
    message.success('预览合成完成')
  } catch (error) {
    // 3、提示当前调用中的错误。
    message.error('合成失败')
  } finally {
    // 4、无论当前调用成功与否都解除忙碌状态。
    composing.value = false
  }
}

/**
 * 展示模拟导出等待状态并发出导出请求。
 * 处理流程：
 * 1、进入导出状态并等待一秒模拟耗时。
 * 2、发送导出事件并提示成功，此处不编码图片，也不等待父组件完成文件写入。
 * 3、提示当前流程中的异常并清除导出状态。
 */
const handleExport = async () => {
  // 1、标记正在导出并执行模拟等待。
  exporting.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 1000)) // 模拟导出过程
    // 2、通知父组件执行导出，并立即显示成功提示。
    emits('export')
    message.success('图片导出成功')
  } catch (error) {
    // 3、提示当前调用中的错误。
    message.error('导出失败')
  } finally {
    // 4、结束当前调用的导出状态。
    exporting.value = false
  }
}

/**
 * 通过合成入口刷新预览。
 * 处理流程：
 * 1、显示刷新提示并启动合成流程。
 */
const handleRefresh = () => {
  // 1、提示刷新并复用合成处理。
  message.info('刷新预览中...')
  handleCompose()
}

/**
 * 确认当前预览并关闭弹窗。
 * 处理流程：
 * 1、提示已确认，然后发送关闭事件。
 */
const handleConfirm = () => {
  // 1、给出确认反馈并请求关闭。
  message.success('已确认使用当前预览效果')
  handleClose()
}

/**
 * 在图层全选和全不选之间切换。
 * 处理流程：
 * 1、判断是否所有图层均可见。
 * 2、向父组件逐一发送统一的目标可见状态。
 */
const toggleAllLayers = () => {
  // 1、以当前是否全部可见决定本次切换方向。
  const allVisible = props.layerData.every(layer => layer.visible)
  // 2、全部可见时隐藏全部，否则显示全部。
  props.layerData.forEach(layer => {
    handleLayerToggle(layer.id, !allVisible)
  })
}

/**
 * 反转每个图层的可见状态。
 * 处理流程：
 * 1、遍历图层，向父组件发送各自当前状态的反值。
 */
const invertLayerSelection = () => {
  // 1、逐层请求反选，由父组件负责更新图层数据。
  props.layerData.forEach(layer => {
    handleLayerToggle(layer.id, !layer.visible)
  })
}

/**
 * 获取图层类型对应的展示图标。
 * 处理流程：
 * 1、区分分组、文本和图片类型，其余返回通用图标。
 */
const getLayerIcon = (type) => {
  // 1、按图层类型选择图标。
  switch (type) {
    case 'group':
      return '📁'
    case 'text':
      return '📝'
    case 'image':
      return '🖼️'
    default:
      return '🎨'
  }
}

/**
 * 获取图层类型对应的标签配色类型。
 * 处理流程：
 * 1、映射分组、文本和图片类型，其余返回默认标签类型。
 */
const getLayerTagType = (type) => {
  // 1、返回组件库支持的标签类型。
  switch (type) {
    case 'group':
      return 'info'
    case 'text':
      return 'success'
    case 'image':
      return 'warning'
    default:
      return 'default'
  }
}

/**
 * 记录预览图加载完成。
 * 处理流程：
 * 1、输出图片加载完成日志。
 */
const handleImageLoad = () => {
  // 1、记录预览图片已加载。
  console.log('预览图片加载完成')
}

/**
 * 提示预览图片加载异常。
 * 处理流程：
 * 1、显示图片加载失败消息。
 */
const handleImageError = () => {
  // 1、向用户提示预览图不可用。
  message.error('预览图片加载失败')
}
</script>

<style scoped>
.psd-preview-content {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-lg);
  height: 70vh;
  max-height: 800px;
}

.preview-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: var(--theme-spacing-md);
  border-bottom: 1px solid var(--theme-border);
}

.preview-info {
  flex-shrink: 0;
}

.preview-main {
  display: flex;
  gap: var(--theme-spacing-lg);
  flex: 1;
  min-height: 0;
}

.layer-list {
  width: 320px;
  flex-shrink: 0;
}

.layer-controls {
  max-height: 500px;
  overflow-y: auto;
}

.control-section {
  padding-bottom: var(--theme-spacing-md);
  border-bottom: 1px solid var(--theme-border);
  margin-bottom: var(--theme-spacing-md);
}

.section-title {
  font-size: var(--theme-font-sm);
  font-weight: 600;
  color: var(--theme-foreground);
  margin-bottom: var(--theme-spacing-xs);
}

.layer-items {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}

.layer-item {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-sm);
  border-radius: var(--theme-border-radius);
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.layer-item:hover {
  background: var(--theme-background-accent);
  border-color: var(--theme-border);
}

.layer-item.active {
  background: var(--theme-primary)20;
  border-color: var(--theme-primary);
}

.layer-icon {
  flex-shrink: 0;
}

.layer-name {
  flex: 1;
  font-size: var(--theme-font-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.layer-type {
  flex-shrink: 0;
}

.preview-area {
  flex: 1;
  min-width: 0;
}

.preview-container {
  height: 500px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--theme-background-secondary);
  border-radius: var(--theme-border-radius);
  border: 1px solid var(--theme-border);
  position: relative;
}

.preview-image-container {
  max-width: 100%;
  max-height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image {
  max-width: 100%;
  max-height: 100%;
  border-radius: var(--theme-border-radius);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.preview-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-spacing-md);
}

.loading-text {
  font-size: var(--theme-font-sm);
  color: var(--theme-foreground-secondary);
}

.preview-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-spacing-md);
  color: var(--theme-foreground-muted);
}

.empty-icon {
  opacity: 0.6;
}

.empty-text {
  font-size: var(--theme-font-sm);
}

.preview-actions {
  padding-top: var(--theme-spacing-md);
  border-top: 1px solid var(--theme-border);
}

/* 滚动条样式 */
.layer-controls::-webkit-scrollbar {
  width: 6px;
}

.layer-controls::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 3px;
}

.layer-controls::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 3px;
}

.layer-controls::-webkit-scrollbar-thumb:hover {
  background: var(--theme-border-hover);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .psd-preview-content {
    height: 60vh;
  }
  
  .preview-main {
    flex-direction: column;
    gap: var(--theme-spacing-md);
  }
  
  .layer-list {
    width: 100%;
  }
  
  .layer-controls {
    max-height: 200px;
  }
  
  .preview-container {
    height: 300px;
  }
  
  .preview-toolbar {
    flex-direction: column;
    gap: var(--theme-spacing-md);
    align-items: stretch;
  }
}
</style>
