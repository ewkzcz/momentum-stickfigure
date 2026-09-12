<!-- 文件说明：普通部件虚拟列表展示；滚动状态、选择、图片预缓存和拖拽业务均由父页面维护。 -->
<template>
  <div v-if="empty" class="empty-state">
    <p>{{ emptyStateText }}</p>
  </div>
  <template v-else>
    <!-- 虚拟滚动占位容器 -->
    <div
      class="parts-virtual-spacer"
      :style="{ height: totalHeight + 'px' }"
    ></div>
    <!-- 虚拟滚动可见内容（绝对定位） -->
    <div
      class="parts-virtual-items"
      :style="{ transform: `translateY(${offsetY}px)` }"
    >
      <div
        v-for="part in visiblePartsList"
        :key="part._absoluteIndex"
        :class="[
          'part-item',
          {
            active: isPartActive(part),
            hidden: part.hidden,
            group: part.isGroup,
            'search-highlighted': highlightedPartPath === part.path
          }
        ]"
        @click="emit('select', part)"
      >
        <div class="part-preview">
          <img
            v-if="part.thumbnail"
            :src="part.thumbnail"
            :alt="part.name"
            loading="lazy"
            decoding="async"
            draggable="true"
            @mouseenter="emit('precache', $event.target, part)"
            @dragstart.stop="emit('drag-start', $event, part)"
            @dragend.stop="emit('drag-end', $event)"
            @click.stop="emit('image-click', part)"
            @mousedown.stop
            style="cursor: grab; user-select: none;"
            :title="`拖拽到剪映或其他软件使用（拖拽时自动命名）`"
          />
          <span v-else class="part-icon">🖼️</span>
        </div>
        <div class="part-info">
          <div class="part-name">
            <span v-if="part.isGroup" class="group-indicator">📁</span>
            {{ part.displayName || part.name }}
            <span v-if="part.isGroup" class="group-text">(图组)</span>
          </div>
        </div>
      </div>
    </div>
  </template>
</template>

<script setup>
/** 仅读取父级派生值，不创建虚拟滚动实例或复制部件状态；原事件同步返回父级。 */
defineProps({
  empty: { type: Boolean, required: true },
  emptyStateText: { type: String, required: true },
  visiblePartsList: { type: Array, required: true },
  totalHeight: { type: Number, required: true },
  offsetY: { type: Number, required: true },
  highlightedPartPath: { type: String, default: null },
  isPartActive: { type: Function, required: true }
})
const emit = defineEmits(['select', 'precache', 'drag-start', 'drag-end', 'image-click'])
</script>

<style scoped>
/* 按原 part-panels.css → overrides.css 顺序保留命中节点的规则。
   多根组件没有额外包裹层；父级仍保留预设、模板共用规则。 */
/* 虚拟滚动占位元素（用于撑开高度，使滚动条正确显示） */
.parts-virtual-spacer {
  grid-column: 1 / -1;
  pointer-events: none;
  /* 高度由 JS 动态设置，包含了所有行的高度 */
}

/* 虚拟滚动可见项容器 */
.parts-virtual-items {
  grid-column: 1 / -1;
  display: grid;
  /* 必须与父容器使用相同的grid配置，确保布局一致 */
  grid-template-columns: repeat(auto-fill, var(--part-item-size, 130px));
  gap: 2px;
  justify-content: space-evenly; /* 与父容器保持一致：均匀分布 */
  position: absolute;
  /* 关键：使用与父容器相同的定位和尺寸，继承padding效果 */
  top: 2px;
  left: 2px;
  right: 2px;
  padding: 0; /* 不需要自己的padding，使用left/right来对齐 */
  box-sizing: border-box;
  /* transform 由 JS 动态设置，用于垂直偏移（只处理行滚动） */
  will-change: transform;
}

.empty-state {
  grid-column: 1 / -1;
  text-align: center;
  padding: 40px 20px;
  color: var(--theme-muted);
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}

.part-item {
  display: flex;
  flex-direction: column;
  padding: 10px;
  background: var(--theme-background);
  border: 2px solid var(--theme-border);
  border-radius: 6px;
  cursor: pointer;
  /* 性能优化：只对需要过渡的属性添加过渡，避免使用 all */
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
  /* 性能优化 */
  contain: layout; /* 隔离布局计算，防止影响其他元素 */
}

.part-item:hover {
  border-color: var(--theme-primary);
  /* transform: translateY(-2px); 已移除 - 防止页面跳动 */
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.part-item.active {
  border-color: var(--theme-primary);
  background: rgba(24, 160, 88, 0.08);
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.1);
}

.part-item.hidden {
  opacity: 0.7;
  transition: opacity 0.2s ease; /* 只对opacity添加过渡 */
}

/* 搜索高亮样式 */
.part-item.search-highlighted {
  border-color: #f0a020 !important;
  background: rgba(240, 160, 32, 0.15) !important;
  box-shadow: 0 0 0 3px rgba(240, 160, 32, 0.2), 0 0 12px rgba(240, 160, 32, 0.4) !important;
  animation: search-pulse 1.5s ease-in-out infinite;
}

@keyframes search-pulse {
  0%, 100% {
    box-shadow: 0 0 0 3px rgba(240, 160, 32, 0.2), 0 0 12px rgba(240, 160, 32, 0.4);
  }
  50% {
    box-shadow: 0 0 0 3px rgba(240, 160, 32, 0.3), 0 0 16px rgba(240, 160, 32, 0.6);
  }
}

.part-preview {
  width: 100%;
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: white;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 8px;
  border: 1px solid var(--theme-border);
  position: relative;
  /* 性能优化 */
  contain: strict; /* 严格隔离，最大化性能提升 */
}

.part-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
  /* 性能优化：图片解码优化 */
  image-rendering: -webkit-optimize-contrast; /* Webkit优化 */
  image-rendering: crisp-edges; /* 清晰边缘 */
}

.part-preview img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.part-icon {
  font-size: 32px;
  opacity: 0.5;
}

.part-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.part-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-foreground);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.group-indicator {
  font-size: 12px;
  margin-right: 4px;
  opacity: 0.8;
}

.group-text {
  font-size: 10px;
  color: var(--theme-primary);
  margin-left: 4px;
  font-weight: 500;
  opacity: 0.7;
}

/* 图层组特殊样式 */
.part-item.group {
  border-style: dashed;
  background: linear-gradient(135deg, var(--theme-background) 0%, rgba(24, 160, 88, 0.03) 100%);
}

.part-item.group:hover {
  border-color: var(--theme-primary);
  background: linear-gradient(135deg, var(--theme-background) 0%, rgba(24, 160, 88, 0.08) 100%);
}

.part-item.group.active {
  background: linear-gradient(135deg, rgba(24, 160, 88, 0.08) 0%, rgba(24, 160, 88, 0.15) 100%);
}

@media (max-width: 800px) {
  .part-item {
    padding: 8px;
  }
}

@media (max-width: 600px) {
  /* 虚拟滚动容器同步定位，不修改gap */
  .parts-virtual-items {
    top: 2px;
    left: 2px;
    right: 2px;
  }

  .part-item {
    padding: 6px;
  }

  .part-name {
    font-size: 12px;
  }
}

@media (max-width: 400px) {
  /* 虚拟滚动容器也需要同步定位 */
  .parts-virtual-items {
    top: 2px;
    left: 2px;
    right: 2px;
  }

  .part-item {
    padding: 5px;
  }

  .part-preview {
    margin-bottom: 6px;
  }
}

.theme-dark .part-preview {
  background: #2a2a2a;
}
</style>
