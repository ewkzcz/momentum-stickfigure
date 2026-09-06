<template>
  <div class="layer-panel">
    <n-card title="图层结构" size="small" :bordered="true">
      <template #header-extra>
        <div class="layer-controls">
          <n-button size="small" quaternary @click="$emit('expand-all')">
            <template #icon>
              <n-icon><span>🔽</span></n-icon>
            </template>
            展开
          </n-button>
          <n-button size="small" quaternary @click="$emit('collapse-all')">
            <template #icon>
              <n-icon><span>🔼</span></n-icon>
            </template>
            收起
          </n-button>
        </div>
      </template>
      
      <div class="layer-tree" v-if="layers.length > 0">
        <div 
          v-for="layer in layers" 
          :key="layer.id" 
          class="layer-item"
          :class="{ 
            'selected': selectedLayer?.id === layer.id,
            'group': layer.type === 'group'
          }"
          @click="$emit('layer-select', layer)"
        >
          <n-icon class="layer-icon">
            <span>{{ getLayerIcon(layer.type) }}</span>
          </n-icon>
          <n-text class="layer-name" :depth="layer.type === 'group' ? 1 : 2">
            {{ layer.name }}
          </n-text>
          <n-tag
            v-if="layer.type === 'group'"
            size="tiny"
            type="info"
            class="layer-tag"
          >
            组
          </n-tag>
          <div 
            class="layer-visibility" 
            :class="{ 'visible': layer.visible, 'hidden': !layer.visible }"
            :title="layer.visible ? '图层可见' : '图层隐藏'"
          >
            <n-icon size="12">
              <span>{{ layer.visible ? '👁️' : '🙈' }}</span>
            </n-icon>
          </div>
        </div>
      </div>
      
      <n-empty 
        v-else
        description="暂无图层数据"
        class="layer-empty"
      >
        <template #icon>
          <n-icon size="48">
            <span>📁</span>
          </n-icon>
        </template>
      </n-empty>
    </n-card>
  </div>
</template>

<script setup>
/** 图层列表面板：展示图层类型与选择状态，向父组件发送操作事件。 */
defineProps({
  layers: {
    type: Array,
    default: () => []
  },
  selectedLayer: {
    type: Object,
    default: null
  }
})

defineEmits(['layer-select', 'expand-all', 'collapse-all'])

/**
 * 选择图层类型对应的显示图标。
 * 处理流程：
 * 1、匹配分组、文本和图像类型，未知类型返回通用图标。
 */
const getLayerIcon = (type) => {
  // 1、按类型返回图标，默认分支覆盖其他 PSD 图层类型。
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
</script>

<style scoped>
.layer-panel {
  width: 320px;
  min-width: 280px;
}

.layer-controls {
  display: flex;
  gap: var(--theme-spacing-xs);
}

.layer-tree {
  max-height: 500px;
  overflow-y: auto;
  padding-right: var(--theme-spacing-xs);
}

.layer-item {
  display: flex;
  align-items: center;
  gap: var(--theme-spacing-sm);
  padding: var(--theme-spacing-sm) var(--theme-spacing-md);
  border-radius: var(--theme-border-radius);
  cursor: pointer;
  transition: all 0.2s ease;
  margin-bottom: var(--theme-spacing-xs);
  border: 1px solid transparent;
}

.layer-item:hover {
  background: var(--theme-background-accent);
  border-color: var(--theme-border);
}

.layer-item.selected {
  background: var(--theme-primary);
  color: white;
  border-color: var(--theme-primary);
}

.layer-item.selected .layer-name,
.layer-item.selected .layer-icon {
  color: white;
}

.layer-item.group {
  font-weight: 500;
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

.layer-tag {
  flex-shrink: 0;
}

.layer-visibility {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  transition: all 0.2s ease;
}

.layer-visibility.visible {
  opacity: 1;
}

.layer-visibility.hidden {
  opacity: 0.4;
}

.layer-empty {
  padding: var(--theme-spacing-xl) var(--theme-spacing-lg);
}

/* 滚动条样式 */
.layer-tree::-webkit-scrollbar {
  width: 6px;
}

.layer-tree::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 3px;
}

.layer-tree::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 3px;
}

.layer-tree::-webkit-scrollbar-thumb:hover {
  background: var(--theme-border-hover);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .layer-panel {
    width: 100%;
    min-width: auto;
  }
  
  .layer-tree {
    max-height: 300px;
  }
}
</style>
