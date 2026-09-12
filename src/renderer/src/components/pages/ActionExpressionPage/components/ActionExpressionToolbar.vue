<!-- 文件说明：动作表情页顶部工具栏展示；开关状态与业务动作由父页面唯一持有。 -->
<template>
  <div
    class="toolbar"
    @click="emit('toggle-canvas')"
    title="点击空白区域折叠/展开画布"
  >
    <div class="toolbar-left">
      <span class="canvas-toggle-title">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        画布
        <span class="collapse-icon-mini" :class="{ expanded: canvasPanelExpanded }">▼</span>
      </span>
    </div>
    <div class="toolbar-actions" @click.stop>
      <n-tooltip placement="bottom">
        <template #trigger>
          <n-checkbox
            :checked="enableCanvasHover"
            size="small"
            style="margin-right: 8px;"
            @update:checked="emit('update:enableCanvasHover', $event)"
          >
            预览1
          </n-checkbox>
        </template>
        开启鼠标悬浮预览效果（主画布）<br/>快捷键: {{ hotkeyLabels.toggleCanvasHover || '未设置' }}
      </n-tooltip>

      <n-tooltip placement="bottom">
        <template #trigger>
          <n-checkbox
            :checked="enablePresetHover"
            size="small"
            style="margin-right: 8px;"
            @update:checked="emit('update:enablePresetHover', $event)"
          >
            预览2
          </n-checkbox>
        </template>
        开启鼠标悬浮预览效果（预设列表、模板列表）<br/>快捷键: {{ hotkeyLabels.togglePartHover || '未设置' }}
      </n-tooltip>

      <n-tooltip placement="bottom">
        <template #trigger>
          <n-button
            size="small"
            @click="emit('select-psd')"
          >
            上传
          </n-button>
        </template>
        选择PSD文件进行编辑
      </n-tooltip>

      <n-tooltip placement="bottom">
        <template #trigger>
          <n-button
            size="small"
            type="primary"
            @click="emit('open-preview')"
            :disabled="!currentPsdData"
          >
            预览
          </n-button>
        </template>
        在独立窗口中查看预览
      </n-tooltip>

      <n-dropdown
        trigger="click"
        :options="jumpOptions"
        @select="emit('jump-select', $event)"
        :disabled="!currentPsdData"
      >
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button
              size="small"
              type="primary"
              :disabled="!currentPsdData"
              :loading="isSendingToGenerate"
            >
              跳转
            </n-button>
          </template>
          跳转到其他页面并传递图片
        </n-tooltip>
      </n-dropdown>

      <n-dropdown
        trigger="click"
        :options="moreOptions"
        @select="emit('more-select', $event)"
      >
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button size="small">
              更多
            </n-button>
          </template>
          更多功能选项
        </n-tooltip>
      </n-dropdown>
    </div>
  </div>
</template>

<script setup>
/** 顶部工具栏：展示折叠入口与预览开关，不复制父页开关状态。 */
import { NButton, NTooltip, NDropdown, NCheckbox } from 'naive-ui'

defineProps({
  canvasPanelExpanded: { type: Boolean, required: true },
  enableCanvasHover: { type: Boolean, required: true },
  enablePresetHover: { type: Boolean, required: true },
  hotkeyLabels: { type: Object, required: true },
  jumpOptions: { type: Array, required: true },
  moreOptions: { type: Array, required: true },
  currentPsdData: { type: Object, default: null },
  isSendingToGenerate: { type: Boolean, required: true }
})

const emit = defineEmits([
  'toggle-canvas',
  'select-psd',
  'open-preview',
  'jump-select',
  'more-select',
  'update:enableCanvasHover',
  'update:enablePresetHover'
])
</script>

<style scoped>
/* 顶部工具栏样式：保留原规则与窄屏覆盖，仅改变所属组件。 */
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0px 12px; /* 极限压缩上下padding */
  background: var(--theme-background-card);
  border-bottom: 1px solid var(--theme-border);
  flex-shrink: 0;
  flex-wrap: nowrap; /* 防止换行 */
  gap: 2px;
  font-size: 14px; /* 与顶部导航一致 */
  line-height: 14px; /* 字号+2px */
  min-height: 26px; /* 极限压缩高度 */
  height: 26px; /* 固定高度 */
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.canvas-toggle-title {
  display: flex;
  align-items: center;
  gap: 2px;
  font-size: 14px; /* 与顶部导航一致 */
  line-height: 14px; /* 字号+2px */
  font-weight: 500;
  color: var(--theme-foreground);
  cursor: pointer;
  user-select: none;
  padding: 0px 4px; /* 极限压缩上下padding */
  border-radius: 4px;
  transition: background-color 0.2s;
  height: 24px; /* 固定高度适配工具栏 */
}

.canvas-toggle-title:hover {
  background: var(--theme-background-hover);
}

.canvas-toggle-title svg {
  width: 14px;
  height: 14px;
  opacity: 0.7;
  flex-shrink: 0;
}

.collapse-icon-mini {
  display: inline-block;
  font-size: 14px;
  line-height: 14px; /* 字号+2px */
  transition: transform 0.2s;
  margin-left: 2px;
}

.collapse-icon-mini.expanded {
  transform: rotate(180deg);
}

.toolbar-actions {
  display: flex;
  gap: 2px;
  align-items: center;
  flex-wrap: nowrap; /* 防止换行 */
  font-size: 14px; /* 与顶部导航一致 */
  line-height: 14px; /* 字号+2px */
}

/* 工具栏内按钮样式优化 */
.toolbar-actions .n-button {
  font-size: 14px !important; /* 与顶部导航一致 */
  line-height: 14px !important; /* 字号+2px */
}

/* 工具栏内复选框样式优化 */
.toolbar-actions .n-checkbox {
  font-size: 14px !important; /* 与顶部导航一致 */
  line-height: 14px !important; /* 字号+2px */
}

.toolbar-actions .n-checkbox .n-checkbox__label {
  font-size: 14px !important;
  line-height: 14px !important;
  padding-left: 2px !important;
}

@media (max-width: 768px) {
  .toolbar {
    padding: 10px 12px;
  }
}
</style>
