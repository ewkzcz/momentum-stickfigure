<!-- 文件说明：部件标签两行展示与重置入口；排序/点击业务仍由父页面唯一持有。 -->
<template>
  <div class="parts-tabs-container">
    <!-- 第1行：动作表情相关标签 -->
    <div
      class="parts-tabs parts-tabs-row-1"
      :ref="node => emit('row1-ref', node)"
      @wheel="emit('wheel', $event)"
      @dragover="emit('container-dragover', $event, 'row1')"
      @drop="emit('container-drop', $event, 'row1')"
    >
      <button
        v-for="tab in row1Tabs"
        :key="tab.key"
        :class="[
          'part-tab',
          {
            active: currentTab === tab.key,
            'has-rendered': hasRenderedContent[tab.key],
            'drag-over-before': dragOverTabKey === tab.key && dropPosition === 'before',
            'drag-over-after': dragOverTabKey === tab.key && dropPosition === 'after'
          }
        ]"
        draggable="true"
        @click="emit('tab-click', tab.key)"
        @dragstart="emit('tab-dragstart', $event, tab.key)"
        @dragend="emit('tab-dragend', $event)"
        @dragover="emit('tab-dragover', $event, tab.key)"
        @dragleave="emit('tab-dragleave')"
        @drop="emit('tab-drop', $event, tab.key)"
        :title="`双击可便捷取消分组内所有图层显示\n拖拽可调整顺序`"
      >
        {{ tab.label }}
      </button>
    </div>

    <!-- 第2行：模板、预设、上身下身 + 工具栏 -->
    <div
      class="parts-tabs parts-tabs-row-2"
      :ref="node => emit('row2-ref', node)"
      @wheel="emit('wheel', $event)"
      @dragover="emit('container-dragover', $event, 'row2')"
      @drop="emit('container-drop', $event, 'row2')"
    >
      <button
        v-for="tab in row2Tabs"
        :key="tab.key"
        :class="[
          'part-tab',
          {
            active: currentTab === tab.key,
            'has-rendered': hasRenderedContent[tab.key],
            'drag-over-before': dragOverTabKey === tab.key && dropPosition === 'before',
            'drag-over-after': dragOverTabKey === tab.key && dropPosition === 'after'
          }
        ]"
        draggable="true"
        @click="emit('tab-click', tab.key)"
        @dragstart="emit('tab-dragstart', $event, tab.key)"
        @dragend="emit('tab-dragend', $event)"
        @dragover="emit('tab-dragover', $event, tab.key)"
        @dragleave="emit('tab-dragleave')"
        @drop="emit('tab-drop', $event, tab.key)"
        :title="`双击可便捷取消分组内所有图层显示\n拖拽可调整顺序`"
      >
        {{ tab.label }}
      </button>

      <!-- 工具栏（重置和提示）放在第2行末尾 -->
      <div class="tab-management-toolbar-inline">
        <n-tooltip placement="bottom">
          <template #trigger>
            <button class="tab-reset-btn" @click="emit('reset')" title="重置标签排序">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                <path d="M21 3v5h-5"/>
                <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                <path d="M3 21v-5h5"/>
              </svg>
            </button>
          </template>
          重置标签排序
        </n-tooltip>

        <span class="tab-hint">提示：拖拽标签可排序</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 部件标签栏：挂载和卸载时直接回传节点，不另建 ref 或后置同步监听。 */
import { NTooltip } from 'naive-ui'

defineProps({
  row1Tabs: { type: Array, required: true },
  row2Tabs: { type: Array, required: true },
  currentTab: { type: String, default: '' },
  hasRenderedContent: { type: Object, required: true },
  dragOverTabKey: { type: String, default: null },
  dropPosition: { type: String, default: null }
})

const emit = defineEmits([
  'wheel',
  'container-dragover',
  'container-drop',
  'tab-click',
  'tab-dragstart',
  'tab-dragend',
  'tab-dragover',
  'tab-dragleave',
  'tab-drop',
  'reset',
  'row1-ref',
  'row2-ref'
])
</script>

<style scoped>
/* 部件标签与重置工具样式：保留原选择器与响应式覆盖。 */
.parts-tabs-container {
  display: flex;
  flex-direction: column;
  background: var(--theme-background-secondary);
  border-bottom: 1px solid var(--theme-border);
  flex-shrink: 0;
}

.tab-management-toolbar-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 0 8px;
}

.tab-reset-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--theme-muted);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.tab-reset-btn:hover {
  background: var(--theme-background-secondary);
  color: var(--theme-primary);
}

.tab-reset-btn svg {
  width: 16px;
  height: 16px;
}

.tab-hint {
  font-size: 11px;
  color: var(--theme-muted);
  font-style: italic;
  white-space: nowrap;
  flex-shrink: 0;
}

.parts-tabs {
  display: flex;
  background: var(--theme-background-secondary);
  gap: 2px;
  overflow-x: auto;
  overflow-y: hidden;
  scroll-behavior: smooth;
  flex-shrink: 0;
  align-items: center; /* 标签与指示元素垂直居中 */
  min-height: 30px; /* 更紧凑，仅略高于文字 */
}

.parts-tabs-row-1 {
  border-bottom: 1px solid var(--theme-border-light, rgba(0, 0, 0, 0.05));
}

.parts-tabs:empty {
  display: none;
}

.parts-tabs::-webkit-scrollbar {
  height: 12px;
}

.parts-tabs::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 6px;
}

.parts-tabs::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 6px;
}

.parts-tabs::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

.part-tab {
  padding: 6px 16px 6px 8px; /* 右侧为指示圆点预留空间 */
  background: transparent;
  border: none;
  font-size: 15px; /* 标签字号 */
  line-height: 1.2; /* 更紧凑的行高 */
  font-weight: 500;
  color: var(--theme-muted);
  cursor: default; /* 默认光标 */
  transition: all 0.2s ease;
  position: relative;
  white-space: nowrap;
}

.part-tab:hover {
  color: var(--theme-foreground);
  background: rgba(0, 0, 0, 0.02);
}

.part-tab.drag-over-before {
  background: rgba(79, 158, 255, 0.1);
  border-left: 3px solid var(--theme-primary);
  box-shadow: -2px 0 8px rgba(79, 158, 255, 0.3);
}

.part-tab.drag-over-after {
  background: rgba(79, 158, 255, 0.1);
  border-right: 3px solid var(--theme-primary);
  box-shadow: 2px 0 8px rgba(79, 158, 255, 0.3);
}

.part-tab.active {
  color: var(--theme-primary);
  background: var(--theme-background-card);
}

.part-tab.active::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--theme-primary);
}

.part-tab.has-rendered::before {
  content: '';
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  width: 6px;
  height: 6px;
  background: #52c41a;
  border-radius: 50%;
  box-shadow: 0 0 4px rgba(82, 196, 26, 0.6);
  animation: pulse-dot 2s ease-in-out infinite;
}

.part-tab.active.has-rendered::before {
  background: #52c41a;
  box-shadow: 0 0 6px rgba(82, 196, 26, 0.8), 0 0 2px rgba(24, 160, 88, 0.4);
}

@keyframes pulse-dot {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(1.1);
  }
}

.theme-dark .part-tab:hover {
  background: rgba(255, 255, 255, 0.05);
}

@media (max-width: 400px) {
  .part-tab {
    padding: 10px 12px;
    font-size: 13px;
  }
}
</style>
