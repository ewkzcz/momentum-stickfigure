<!-- 文件说明：动作与表情模板的纯文字列表；状态与业务处理保留在父组件。 -->
<template>
  <div v-if="templates.length === 0" class="empty-state">
    <p>{{ emptyText }}</p>
  </div>
  <div
    v-for="template in templates"
    :key="template.id"
    :class="[
      'part-item', 'template-item', 'template-text-only',
      {
        active: selectedId === template.id,
        'multi-selected': isMultiSelected(template.id, templateType),
        'template-dragging': isDragging(template.id),
        'template-drag-over-before': isDragOver(template.id, 'before'),
        'template-drag-over-after': isDragOver(template.id, 'after')
      }
    ]"
    @click="emit('card-click', $event, template.id, templateType)"
    @contextmenu="emit('context-menu', $event, template.id, templateType)"
    @dragover.prevent="emit('drag-over', $event, template.id, templateType)"
    @dragenter.prevent="emit('drag-enter', $event, template.id, templateType)"
    @dragleave="emit('drag-leave', $event, template.id, templateType)"
    @drop.prevent="emit('drop', $event, template.id, templateType)"
  >
    <div class="template-text-content">
      <span
        class="template-card-drag-handle"
        draggable="true"
        title="拖拽调整模板顺序"
        @dragstart.stop="emit('drag-start', $event, template.id, templateType)"
        @dragend.stop="emit('drag-end', $event)"
        @click.stop
        @contextmenu.stop
      ></span>
      <div
        class="template-card-body"
        @mouseenter="emit('hover-enter', $event, template)"
        @mousemove="emit('hover-move', $event)"
        @mouseleave="emit('hover-leave', $event)"
      >
        <div
          class="template-card-title"
          @dblclick="emit('rename', template.id, templateType)"
          :title="template.description || template.name"
        >{{ template.name }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 模板卡片展示：仅读取父级模板和选择状态，原始交互事件同步转发给父页面。 */
defineProps({
  templates: { type: Array, required: true },
  templateType: { type: String, required: true },
  selectedId: { type: [String, Number], default: null },
  emptyText: { type: String, required: true },
  isMultiSelected: { type: Function, required: true },
  isDragging: { type: Function, required: true },
  isDragOver: { type: Function, required: true }
})
const emit = defineEmits([
  'card-click', 'context-menu', 'drag-over', 'drag-enter', 'drag-leave', 'drop',
  'drag-start', 'drag-end', 'hover-enter', 'hover-move', 'hover-leave', 'rename'
])
</script>

<style scoped>
/* 按父页面 part-panels.css → overrides.css 的原始顺序复制命中列表节点的规则。
   父页面保留共享样式；此多根组件不依赖父作用域属性或额外包裹节点。 */
.template-item.multi-selected {
  outline: 2px solid var(--theme-primary);
  outline-offset: -2px;
}

.template-item.multi-selected::after {
  content: '';
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  background-color: var(--theme-primary);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.template-item.multi-selected::before {
  content: '✓';
  position: absolute;
  top: 8px;
  right: 8px;
  width: 20px;
  height: 20px;
  color: white;
  font-size: 14px;
  font-weight: bold;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1;
  pointer-events: none;
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
  transition: border-color 0.15s ease, box-shadow 0.15s ease, background-color 0.15s ease;
  contain: layout;
}

.part-item:hover {
  border-color: var(--theme-primary);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.08);
}

.part-item.active {
  border-color: var(--theme-primary);
  background: rgba(24, 160, 88, 0.08);
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.1);
}

/* overrides.css 中先出现通用部件响应式规则，再出现模板规则。 */
@media (max-width: 800px) {
  .part-item {
    padding: 8px;
  }
}

@media (max-width: 600px) {
  .part-item {
    padding: 6px;
  }
}

@media (max-width: 400px) {
  .part-item {
    padding: 5px;
  }
}

.template-text-only {
  cursor: pointer;
  transition: background 0.18s ease, border-color 0.18s ease, transform 0.18s ease;
  display: flex !important;
  flex-direction: row !important;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  min-height: 46px;
  height: auto;
  grid-column: span 1;
  width: 100%;
  border-radius: 8px;
  background: var(--theme-background-card);
  border: 1px solid var(--theme-border);
  color: var(--theme-foreground);
  position: relative;
  box-shadow: 0 1px 3px var(--theme-shadow-light, rgba(0, 0, 0, 0.08));
}

.template-text-only .template-text-content {
  width: 100%;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  flex: 1;
}

.template-text-only:hover {
  border-color: var(--theme-border-hover, var(--theme-primary));
  background: var(--theme-background-secondary);
  transform: translateY(-1px);
}

.template-text-only.active {
  background: var(--theme-background-accent, var(--theme-background-secondary));
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 1px var(--theme-primary), 0 6px 12px var(--theme-shadow-light, rgba(0, 0, 0, 0.12));
}

.template-card-drag-handle {
  width: 20px;
  height: 32px;
  border-radius: 6px;
  background: var(--theme-background-secondary);
  border: 1px solid var(--theme-border);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: grab;
  flex-shrink: 0;
  position: relative;
  box-shadow: inset 0 0 0 1px var(--theme-border-light, rgba(0, 0, 0, 0.05));
}

.template-card-drag-handle::after {
  content: '';
  width: 10px;
  height: 20px;
  border-radius: 3px;
  background-image: radial-gradient(circle at 1.5px 1.5px, var(--theme-foreground-secondary) 1.5px, transparent 1.5px);
  background-size: 5px 5px;
  opacity: 0.75;
}

.template-card-drag-handle:active {
  cursor: grabbing;
}

.template-card-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.template-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-foreground);
  line-height: 1.3;
  width: 100%;
  word-break: break-word;
  white-space: normal;
}

.template-card-title:hover {
  color: var(--theme-primary);
}

.template-item.template-dragging {
  opacity: 0.5;
}

.template-item.template-drag-over-before::after,
.template-item.template-drag-over-after::after {
  content: '';
  position: absolute;
  left: 8px;
  right: 8px;
  border-radius: 2px;
  height: 2px;
  background: var(--theme-primary);
  box-shadow: 0 0 6px rgba(79, 158, 255, 0.6);
}

.template-item.template-drag-over-before::after {
  top: 4px;
}

.template-item.template-drag-over-after::after {
  bottom: 4px;
}

@media (max-width: 1200px) {
  .template-text-only {
    grid-column: span 1;
  }
}

@media (max-width: 900px) {
  .template-text-only {
    grid-column: span 2;
  }
}

@media (max-width: 600px) {
  .template-text-only {
    grid-column: span 1;
    padding: 8px 10px;
    min-height: 42px;
  }

  .template-card-title {
    font-size: 12px;
    line-height: 1.4;
  }
}
</style>
