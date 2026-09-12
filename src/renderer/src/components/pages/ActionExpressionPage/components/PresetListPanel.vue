<!-- 文件说明：预设卡片展示与原始事件转发，数据、编辑状态和拖拽业务由父页面唯一维护。 -->
<template>
  <div v-if="presets.length === 0" class="empty-state">
    <p>暂无预设，点击"预设"按钮创建预设</p>
  </div>
  <div
    v-for="preset in presets"
    :key="preset.id"
    :class="[
      'part-item',
      'preset-item',
      {
        active: selectedPresetId === preset.id,
        'multi-selected': isPresetMultiSelected(preset.id)
      }
    ]"
    @click="emit('card-click', $event, preset.id)"
    @contextmenu="emit('context-menu', $event, preset.id)"
    @dblclick.stop="emit('deselect', $event)"
  >
    <div
      class="part-preview"
      @mouseenter="emit('hover-enter', $event, preset)"
      @mousemove="emit('hover-move', $event)"
      @mouseleave="emit('hover-leave', $event)"
    >
      <img
        v-if="preset.base64Image"
        :src="preset.base64Image"
        :alt="preset.name"
        loading="lazy"
        draggable="true"
        @mouseenter="emit('precache', $event.target, { name: preset.name, displayName: preset.name })"
        @dragstart.stop="emit('drag-start', $event, { name: preset.name, displayName: preset.name })"
        @dragend.stop="emit('drag-end', $event)"
        @click.stop="emit('image-click', preset.id)"
        @mousedown.stop
        style="cursor: grab; user-select: none;"
        :title="`拖拽到剪映或其他软件使用（拖拽时自动命名）`"
      />
      <span v-else class="part-icon">🖼️</span>
    </div>
    <div class="part-info">
      <div class="part-name">
        <input
          v-if="editingPresetId === preset.id"
          type="text"
          class="preset-name-input"
          :value="preset.name"
          @click.stop
          @blur="emit('name-blur', preset.id, $event)"
          @keyup.enter="emit('name-blur', preset.id, $event)"
        />
        <span
          v-else
          @dblclick.stop="emit('rename', preset.id)"
          :title="getPresetFullDescription(preset)"
        >
          {{ getPresetDisplayName(preset) }}
        </span>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 只读接入父页面状态；所有事件同步转发，不复制状态、不改变事件修饰符。 */
defineProps({
  presets: { type: Array, required: true },
  selectedPresetId: { type: [String, Number], default: null },
  editingPresetId: { type: [String, Number], default: null },
  isPresetMultiSelected: { type: Function, required: true },
  getPresetFullDescription: { type: Function, required: true },
  getPresetDisplayName: { type: Function, required: true }
})
const emit = defineEmits([
  'card-click', 'context-menu', 'deselect', 'hover-enter', 'hover-move', 'hover-leave',
  'precache', 'drag-start', 'drag-end', 'image-click', 'name-blur', 'rename'
])
</script>

<style scoped>
/* 按 part-panels.css → overrides.css 原顺序保留命中卡片节点的规则。
   多根组件不增加包裹节点，也不依赖父页面的 scope 属性。 */
.preset-item.multi-selected {
  outline: 2px solid var(--theme-primary);
  outline-offset: -2px;
}

.preset-item.multi-selected::after {
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

.preset-item.multi-selected::before {
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

@media (max-width: 800px) {
  .part-item {
    padding: 8px;
  }
}

@media (max-width: 600px) {
  .part-item {
    padding: 6px;
  }

  .part-name {
    font-size: 12px;
  }
}

@media (max-width: 400px) {
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

/* 预设名称输入框 */
.preset-name-input {
  flex: 1;
  padding: 4px 8px;
  background: var(--theme-background);
  border: 1px solid #18a058;
  border-radius: 4px;
  color: var(--theme-foreground);
  font-size: 14px;
  font-weight: 500;
  outline: none;
}

.preset-name-input:focus {
  border-color: #18a058;
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.2);
}

/* 预设和模板项的名称完整显示（支持换行） */
.preset-item .part-name,
.template-item .part-name {
  white-space: normal;
  word-break: break-word;
  line-height: 1.4;
  min-height: auto;
  overflow: visible;
  text-overflow: clip;
}

/* 暗色主题 */
.theme-dark .preset-name-input {
  background: #2a2a2a;
}
</style>
