<template>
  <div class="layer-tree-panel panel">
    <div class="panel-header">
      <div class="header-buttons">
        <button class="action-btn-small" @click.stop="expandAll" title="展开所有图层">展开</button>
        <button class="action-btn-small" @click.stop="collapseAll" title="折叠所有图层">折叠</button>
        <span class="layer-help-text">双击: 折叠/展开 | 三击: 全部隐藏/恢复初始状态</span>
      </div>
    </div>
    <div class="panel-content">
      <div class="layer-tree-content" @click="handleBackgroundClick">
        <div v-if="!layerData || layerData.length === 0" class="empty-state">
          <p>暂无图层数据</p>
        </div>
        <div v-else class="layer-list">
          <LayerTreeNode
            v-for="layer in layerData"
            :key="layer.uniqueName || layer.name"
            :layer="layer"
            :selected-layers="selectedLayersSet"
            :depth="0"
            :expand-signal="expandSignal"
            :all-layers-list="allLayersList"
            @toggle-visibility="handleToggleVisibility"
            @layer-select="handleLayerSelect"
            @batch-toggle-visibility="handleBatchToggleVisibility"
            @restore-initial-state="handleRestoreInitialState"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 图层树面板：管理递归展开信号、单选多选与连续范围选择。 */
import { ref, computed } from 'vue'
import LayerTreeNode from './LayerTreeNode.vue'

const props = defineProps({
  layerData: {
    type: Array,
    default: () => []
  },
  selectedLayers: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:visibility', 'update:selection', 'batch-toggle-visibility', 'restore-initial-state'])

// 展开/折叠信号
const expandSignal = ref({ action: '', timestamp: 0 })

// 图层选中状态管理
const selectedLayersSet = ref(new Set())
const lastSelectedLayer = ref(null) // 用于Shift范围选择

/** 全部展开图层树。处理流程：1、发送带新时间戳的递归展开信号。 */
const expandAll = () => {
  // 1、以时间戳保证重复操作仍触发节点监听。
  expandSignal.value = { action: 'expand-all', timestamp: Date.now() }
}

/** 全部折叠图层树。处理流程：1、发送带新时间戳的折叠信号。 */
const collapseAll = () => {
  // 1、通知所有递归节点关闭展开状态。
  expandSignal.value = { action: 'collapse', timestamp: Date.now() }
}

/**
 * 将图层树按深度优先顺序展开，用于连续范围选择。
 * 处理流程：
 * 1、为当前层生成唯一路径并收集节点。
 * 2、递归追加子图组的扁平结果。
 */
const getAllLayersFlat = (layers, parentPath = '') => {
  // 1、先添加父节点，确保列表顺序与树形视图一致。
  let result = []
  layers.forEach(layer => {
    const layerName = layer.uniqueName || layer.name
    const fullPath = parentPath ? `${parentPath}/${layerName}` : layerName
    result.push({ path: fullPath, layer })
    // 2、有子节点的图组递归追加其后代。
    if (layer.type === 'group' && layer.children && layer.children.length > 0) {
      result = result.concat(getAllLayersFlat(layer.children, fullPath))
    }
  })
  return result
}

/** 计算图层扁平列表。处理流程：1、随输入树变化重新执行递归展开。 */
const allLayersList = computed(() => {
  // 1、派生用于范围选择的完整节点顺序。
  return getAllLayersFlat(props.layerData)
})

/**
 * 根据修饰键处理图层选择。
 * 处理流程：
 * 1、优先处理范围选择，再处理多选切换或普通单选。
 * 2、替换集合引用，触发界面重新渲染。
 */
const handleLayerSelect = ({ layerPath, ctrlKey, shiftKey }) => {
  // 1、根据修饰键决定选区更新方式。
  if (shiftKey && lastSelectedLayer.value) {
    // Shift + 点击：范围选择
    const allLayers = allLayersList.value
    const startIndex = allLayers.findIndex(l => l.path === lastSelectedLayer.value)
    const endIndex = allLayers.findIndex(l => l.path === layerPath)
    
    if (startIndex !== -1 && endIndex !== -1) {
      const start = Math.min(startIndex, endIndex)
      const end = Math.max(startIndex, endIndex)
      
      // 选中范围内的所有图层
      for (let i = start; i <= end; i++) {
        selectedLayersSet.value.add(allLayers[i].path)
      }
    }
  } else if (ctrlKey) {
    // Ctrl + 点击：切换选中状态（多选）
    if (selectedLayersSet.value.has(layerPath)) {
      selectedLayersSet.value.delete(layerPath)
    } else {
      selectedLayersSet.value.add(layerPath)
    }
    lastSelectedLayer.value = layerPath
  } else {
    // 普通点击：单选
    selectedLayersSet.value.clear()
    selectedLayersSet.value.add(layerPath)
    lastSelectedLayer.value = layerPath
  }
  
  // 2、触发更新以响应式渲染。
  selectedLayersSet.value = new Set(selectedLayersSet.value)
  
  console.log('🎯 当前选中的图层:', Array.from(selectedLayersSet.value))
}

/**
 * 点击树形背景时清空选择。
 * 处理流程：
 * 1、确认事件来自背景区域。
 * 2、清除选择与范围锚点，并更新集合引用。
 */
const handleBackgroundClick = (event) => {
  // 1、确保点击的是背景，而不是图层项。
  if (event.target.classList.contains('layer-tree-content') || 
      event.target.classList.contains('layer-list')) {
    // 2、同步清空选择集合和范围选择锚点。
    selectedLayersSet.value.clear()
    lastSelectedLayer.value = null
    selectedLayersSet.value = new Set(selectedLayersSet.value)
  }
}

/** 转发单图层可见性变更。处理流程：1、原样发送载荷给父组件。 */
const handleToggleVisibility = (payload) => {
  // 1、保持子节点提交的路径与可见性不变。
  emit('update:visibility', payload)
}

/** 转发批量可见性操作。处理流程：1、原样派发批量事件。 */
const handleBatchToggleVisibility = (payload) => {
  // 1、由父组件执行批量状态更新。
  emit('batch-toggle-visibility', payload)
}

/** 转发恢复初始状态操作。处理流程：1、原样派发恢复事件。 */
const handleRestoreInitialState = (payload) => {
  // 1、由父组件读取并恢复初始可见性。
  emit('restore-initial-state', payload)
}
</script>

<style scoped>
/* 图层面板 - 完全对齐通用控制区域样式 */
.layer-tree-panel {
  display: flex;
  flex-direction: column;
  background: var(--theme-background-card);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}

/* 面板头部 - 只包含展开/折叠按钮 */
.panel-header {
  padding: 12px 16px;
  background: var(--theme-background-accent);
  border-bottom: 1px solid var(--theme-border);
  display: flex;
  justify-content: flex-start;
  align-items: center;
  font-weight: 500;
  user-select: none;
  flex-shrink: 0;
  font-size: 14px;
  color: var(--theme-foreground);
}

/* 按钮容器 */
.header-buttons {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* 帮助文字 */
.layer-help-text {
  margin-left: 4px;
  font-size: 12px;
  color: var(--theme-muted);
  font-weight: normal;
  white-space: nowrap;
}

/* 按钮样式 */
.action-btn-small {
  padding: 4px 12px;
  font-size: 13px;
  font-weight: 500;
  color: white;
  background: var(--theme-primary);
  border: 1px solid var(--theme-primary);
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  margin: 0;
}

.action-btn-small:hover {
  background: var(--theme-primary-hover);
  border-color: var(--theme-primary-hover);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

.action-btn-small:active {
  transform: translateY(0);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
}

/* 面板内容 - 对齐通用控制 */
.panel-content {
  padding: 16px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.layer-tree-content {
  max-height: 1200px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 0;
  font-size: 14px;
}

.layer-tree-content::-webkit-scrollbar {
  width: 5px;
}

.layer-tree-content::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 3px;
}

.layer-tree-content::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 3px;
}

.layer-tree-content::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

.empty-state {
  text-align: center;
  padding: 30px 10px;
  color: var(--theme-muted);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.layer-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* 取消该组件的响应式缩放，保持与“通用控制”完全一致 */
</style>
