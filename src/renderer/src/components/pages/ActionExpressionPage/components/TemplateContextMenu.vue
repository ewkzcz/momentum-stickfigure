<!-- 文件说明：模板与预设右键菜单展示；状态、派生配置和业务动作由父页面唯一持有。 -->
<template>
  <!-- 右键菜单 -->
  <div
    v-if="contextMenuVisible"
    :class="[
      'template-context-menu',
      { 'detail-mode': contextMenuItemType === 'template' }
    ]"
    :style="{
      left: contextMenuPosition.x + 'px',
      top: contextMenuPosition.y + 'px'
    }"
    @click.stop
  >
    <template v-if="contextMenuItemType === 'preset'">
      <!-- 删除选项（预设） -->
      <div class="context-menu-item" @click="emit('delete-presets', $event)">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
        </svg>
        <span>删除</span>
      </div>
    </template>

    <template v-else-if="contextMenuItemType === 'template' && contextMenuTemplateDetail">
      <div class="template-detail-popup">
        <div class="template-detail-header">
          <div class="template-detail-title">
            <span class="template-detail-type">{{ templateDetailTypeLabel }}</span>
            {{ contextMenuTemplateDetail.name }}
          </div>
          <button class="template-detail-close" @click="emit('close', $event)" aria-label="关闭">
            ×
          </button>
        </div>

        <div class="template-detail-body">
          <div
            v-if="templateDetailEntries.length"
            class="template-detail-groups"
          >
            <div
              v-for="group in templateDetailEntries"
              :key="group.tabName"
              class="template-detail-group"
            >
              <span class="template-detail-group-name">{{ group.tabName }}</span>
              <span class="template-detail-group-parts">{{ group.selectedParts.join('、') }}</span>
            </div>
          </div>
          <div v-else class="template-detail-empty">
            暂无具体配置
          </div>
        </div>

        <div class="template-detail-actions">
          <button
            class="template-detail-btn primary"
            :disabled="!contextMenuSingleItemId"
            @click="emit('apply', $event)"
          >
            应用
          </button>
          <button
            class="template-detail-btn"
            :disabled="!contextMenuSingleItemId"
            @click="emit('rename', $event)"
          >
            重命名
          </button>
          <button
            class="template-detail-btn danger"
            @click="emit('delete-templates', $event)"
          >
            删除
          </button>
        </div>
      </div>
    </template>
  </div>

  <!-- 点击遮罩层关闭右键菜单 -->
  <div
    v-if="contextMenuVisible"
    class="context-menu-overlay"
    @click="emit('page-click', $event)"
    @contextmenu.prevent="emit('page-click', $event)"
  ></div>
</template>

<script setup>
/** 菜单展示：仅读取父级状态和配置，原始事件同步转发，不创建状态或注册生命周期。 */
defineProps({
  contextMenuVisible: { type: Boolean, required: true },
  contextMenuPosition: { type: Object, required: true },
  contextMenuItemType: { type: String, required: true },
  contextMenuTemplateDetail: { type: Object, default: null },
  templateDetailEntries: { type: Array, required: true },
  templateDetailTypeLabel: { type: String, required: true },
  contextMenuSingleItemId: { type: [String, Number], default: null }
})
const emit = defineEmits([
  'delete-presets', 'close', 'apply', 'rename', 'delete-templates', 'page-click'
])
</script>

<style scoped>
/* 逐项核实原三个样式文件：ActionExpressionPage.css 无直接命中规则；
   以下按 part-panels.css → overrides.css 原顺序保留同值规则。
   多根菜单与遮罩不继承父 scope，不添加包裹节点，也不重载整份页面样式。 */
.template-context-menu {
  position: fixed;
  z-index: 10000;
  background: var(--theme-background);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  min-width: 160px;
  padding: 4px 0;
}
.template-context-menu.detail-mode {
  padding: 0;
  width: 360px;
  max-height: 420px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: linear-gradient(145deg, #121217, #0a0b0f);
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: var(--theme-foreground);
  font-size: 13px;
  transition: background-color 0.2s ease;
}

.context-menu-item:hover {
  background-color: var(--theme-accent);
}

.context-menu-item svg {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}

.context-menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 9999;
  background: transparent;
}

.template-detail-popup {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px 18px 14px;
  max-height: calc(100vh - 24px);
  box-sizing: border-box;
  overflow: hidden;
}

.template-detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.template-detail-title {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 15px;
  font-weight: 600;
  color: var(--theme-foreground);
  line-height: 1.4;
}

.template-detail-type {
  font-size: 12px;
  color: var(--theme-primary);
  letter-spacing: 1px;
}

.template-detail-close {
  border: none;
  background: rgba(255, 255, 255, 0.08);
  color: var(--theme-foreground);
  width: 28px;
  height: 28px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  transition: background 0.2s ease;
}

.template-detail-close:hover {
  background: rgba(255, 255, 255, 0.15);
}

.template-detail-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.template-detail-groups {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-detail-group {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 8px;
  padding: 6px 10px;
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 10px;
  min-height: 32px;
}

.template-detail-group-name {
  font-size: 12px;
  color: var(--theme-primary);
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.template-detail-group-parts {
  font-size: 13px;
  color: var(--theme-foreground);
  line-height: 1.4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.template-detail-empty {
  padding: 16px;
  text-align: center;
  color: var(--theme-foreground-secondary);
  font-size: 13px;
  border: 1px dashed rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.template-detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.template-detail-btn {
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s ease, opacity 0.2s ease;
  background: rgba(255, 255, 255, 0.08);
  color: var(--theme-foreground);
}

.template-detail-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.template-detail-btn.primary {
  background: var(--theme-primary);
  color: #fff;
}

.template-detail-btn.danger {
  background: rgba(255, 86, 86, 0.2);
  color: #ff5656;
}

.template-detail-btn:hover:not(:disabled) {
  opacity: 0.85;
}
</style>
