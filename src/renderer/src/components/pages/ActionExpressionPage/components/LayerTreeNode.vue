<template>
  <div class="layer-tree-node">
    <div 
      :class="['layer-item', { 
        'is-group': layer.type === 'group',
        'is-selected': isSelected
      }]"
      :style="{ 
        paddingLeft: (depth * 12 + 4) + 'px'
      }"
      @click="handleLayerClick"
    >
      <!-- 图组/图层图标 -->
      <span class="layer-type-icon">
        <svg v-if="layer.type === 'group'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path v-if="isExpanded" d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <path v-else d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/>
          <polyline points="13 2 13 9 20 9"/>
        </svg>
      </span>
      
      <!-- 展开/收起按钮 (仅组) -->
      <button 
        v-if="layer.type === 'group'" 
        class="expand-button"
        @click.stop="toggleExpand"
        :title="isExpanded ? '收起' : '展开'"
      >
        {{ isExpanded ? '−' : '+' }}
      </button>
      <span v-else class="expand-button-placeholder"></span>
      
      <!-- 图层名称 -->
      <span class="layer-name">
        {{ layer.name }}
      </span>
      
      <!-- 可见性复选框（所有图层都有） -->
      <input 
        type="checkbox"
        class="visibility-checkbox"
        :checked="layer.visible"
        @change="toggleVisibility"
        @click.stop
        :title="layer.visible ? '可见' : '隐藏'"
      />
    </div>
    
    <!-- 子图层 -->
    <div v-if="layer.type === 'group' && isExpanded && layer.children && layer.children.length > 0" class="layer-children">
      <LayerTreeNode
        v-for="child in layer.children"
        :key="child.uniqueName || child.name"
        :layer="child"
        :selected-layers="selectedLayers"
        :depth="depth + 1"
        :parent-path="fullPath"
        :expand-signal="expandSignal"
        :all-layers-list="allLayersList"
        @toggle-visibility="$emit('toggle-visibility', $event)"
        @layer-select="$emit('layer-select', $event)"
        @batch-toggle-visibility="$emit('batch-toggle-visibility', $event)"
        @restore-initial-state="$emit('restore-initial-state', $event)"
      />
    </div>
  </div>
</template>

<script setup>
/** 递归图层节点：维护展开状态，并区分单击选择、双击切换与三击恢复。 */
import { ref, computed, watch } from 'vue'

const props = defineProps({
  layer: {
    type: Object,
    required: true
  },
  selectedLayers: {
    type: Set,
    default: () => new Set()
  },
  depth: {
    type: Number,
    default: 0
  },
  parentPath: {
    type: String,
    default: ''
  },
  expandSignal: {
    type: Object,
    default: () => ({ action: '', timestamp: 0 })
  },
  allLayersList: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['toggle-visibility', 'layer-select', 'batch-toggle-visibility', 'restore-initial-state'])

// 默认折叠状态
const isExpanded = ref(false)

// 点击计数器和定时器
let clickCount = 0
let clickTimer = null

// 监听展开/折叠信号
watch(() => props.expandSignal, (signal) => {
  if (signal.timestamp > 0) {
    if (signal.action === 'expand-all') {
      // 递归展开所有层
      isExpanded.value = true
    } else if (signal.action === 'expand-first-level') {
      // 只展开第一层（depth === 0）
      if (props.depth === 0) {
        isExpanded.value = true
      }
    } else if (signal.action === 'expand') {
      isExpanded.value = true
    } else if (signal.action === 'collapse') {
      isExpanded.value = false
    }
  }
}, { deep: true })

/**
 * 计算当前图层的完整路径，使用唯一名称区分同名图层。
 * 处理流程：
 * 1、优先选择唯一名称，再按是否存在父路径拼接。
 */
const fullPath = computed(() => {
  // 1、优先采用解析阶段生成的唯一名称。
  const layerName = props.layer.uniqueName || props.layer.name
  return props.parentPath ? `${props.parentPath}/${layerName}` : layerName
})

/** 判断当前图层是否被选中。处理流程：1、检查选择集合是否含完整路径。 */
const isSelected = computed(() => {
  // 1、以完整路径判定选中状态。
  return props.selectedLayers.has(fullPath.value)
})

/** 切换节点展开状态。处理流程：1、反转本节点的展开标志。 */
const toggleExpand = () => {
  // 1、仅改变当前节点的展开状态。
  isExpanded.value = !isExpanded.value
}

/**
 * 处理图层点击，区分选择、展开和初始状态恢复。
 * 处理流程：
 * 1、阻止冒泡，排除复选框及展开按钮点击。
 * 2、保存修饰键并累加短时间内的点击次数。
 * 3、延迟按单击、双击或三击派发对应操作并清零计数。
 */
const handleLayerClick = (event) => {
  // 1、阻止事件冒泡并过滤已有独立处理的控件。
  event.stopPropagation()
  
  // 如果点击的是复选框或展开按钮，不触发选择
  if (event.target.classList.contains('visibility-checkbox') || 
      event.target.classList.contains('expand-button')) {
    return
  }
  
  // 2、保存事件的键盘状态（因为 setTimeout 后 event 对象可能失效）并累计点击。
  const ctrlKey = event.ctrlKey || event.metaKey
  const shiftKey = event.shiftKey
  
  // 处理多击检测
  clickCount++
  
  if (clickTimer) {
    clearTimeout(clickTimer)
  }
  
  // 3、等多击窗口结束后执行单一操作。
  clickTimer = setTimeout(() => {
    if (clickCount === 1) {
      // 单击：选中图层
      emit('layer-select', {
        layerPath: fullPath.value,
        ctrlKey: ctrlKey, // macOS使用cmd键
        shiftKey: shiftKey
      })
    } else if (clickCount === 2) {
      // 双击：图组折叠/展开，图层显示/隐藏
      if (props.layer.type === 'group') {
        // 图组：折叠/展开
        toggleExpand()
      } else {
        // 图层：显示/隐藏
        const newVisible = !props.layer.visible
        emit('toggle-visibility', { layerPath: fullPath.value, visible: newVisible })
      }
    } else if (clickCount >= 3) {
      // 三击：仅图组支持全部隐藏/恢复初始状态
      if (props.layer.type === 'group') {
        emit('restore-initial-state', { layerPath: fullPath.value })
      }
    }
    
    clickCount = 0
  }, 300) // 300ms 内的点击算作多次点击
}

/**
 * 提交复选框对应的可见性变更。
 * 处理流程：
 * 1、读取勾选值，连同完整路径发送给父组件。
 */
const toggleVisibility = (event) => {
  // 1、由父组件统一更新图层可见性。
  const newVisible = event.target.checked
  console.log(`🔄 图层 ${props.layer.name} (路径: ${fullPath.value}) 可见性切换: ${props.layer.visible} → ${newVisible}`)
  emit('toggle-visibility', { layerPath: fullPath.value, visible: newVisible })
}
</script>

<style scoped>
.layer-tree-node {
  display: flex;
  flex-direction: column;
}

.layer-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  user-select: none;
  min-height: 32px;
}

.layer-item:hover {
  background: var(--theme-background-secondary);
}

/* 选中状态样式 - 类似PSD */
.layer-item.is-selected {
  background: #0078d4 !important;
  color: white;
}

.layer-item.is-selected .layer-name {
  color: white;
}

.layer-item.is-selected .expand-button {
  color: white;
  border-color: rgba(255, 255, 255, 0.5);
}

.layer-item.is-selected .layer-type-icon svg {
  stroke: white !important;
  fill: rgba(255, 255, 255, 0.2) !important;
}

.layer-item.is-group {
  font-weight: 500;
}

/* 图组/图层图标 */
.layer-type-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}

.layer-type-icon svg {
  width: 16px;
  height: 16px;
  stroke-width: 2;
}

/* 图组文件夹图标 - 黄色 */
.layer-item.is-group .layer-type-icon svg {
  stroke: #facc15;
  fill: rgba(250, 204, 21, 0.1);
}

/* 图层文件图标 - 蓝色 */
.layer-item:not(.is-group) .layer-type-icon svg {
  stroke: #60a5fa;
  fill: rgba(96, 165, 250, 0.1);
}

/* 展开/收起按钮 */
.expand-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: transparent;
  border: 1px solid var(--theme-border);
  border-radius: 2px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1;
  color: var(--theme-muted);
  flex-shrink: 0;
  transition: all 0.15s ease;
}

.expand-button:hover {
  background: var(--theme-background-secondary);
  border-color: var(--theme-primary);
  color: var(--theme-primary);
}

.expand-button-placeholder {
  width: 16px;
  flex-shrink: 0;
}

.visibility-checkbox {
  width: 16px;
  height: 16px;
  cursor: pointer;
  flex-shrink: 0;
  margin: 0;
}

.layer-name {
  flex: 1;
  font-size: 14px;
  color: var(--theme-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.3;
  cursor: pointer;
}

.layer-children {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

/* 深色模式适配 */
.theme-dark .layer-item:hover {
  background: rgba(255, 255, 255, 0.05);
}

.theme-dark .layer-item.is-selected {
  background: #0078d4 !important;
  color: white;
}
</style>
