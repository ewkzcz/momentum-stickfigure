<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="180px"
    class="settings-form"
  >
    <!-- 快捷键说明 -->
    <n-alert type="info" style="margin-bottom: 20px;">
      <template #header>
        快捷键说明
      </template>
      <n-space vertical size="small">
        <n-text>
          💡 支持的修饰键：Ctrl、Alt、Shift
        </n-text>
        <n-text>
          🔧 点击输入框后按下组合键即可设置，按 ESC 清空
        </n-text>
        <n-text depth="3" style="font-size: 12px; color: #f0a020;">
          ⚠️ 注意：修改快捷键后需要点击"保存配置"才能生效
        </n-text>
      </n-space>
    </n-alert>

    <!-- 主窗口快捷键 -->
    <n-form-item label="主窗口唤醒/最小化" path="toggleMainWindow">
      <n-input-group>
        <n-input
          :value="config.toggleMainWindow"
          placeholder="点击后按下快捷键组合"
          readonly
          :style="{ flex: 1 }"
          @keydown="emit('hotkey-input', $event, 'toggleMainWindow')"
          @focus="emit('editing-change', 'toggleMainWindow')"
          @blur="emit('editing-change', null)"
        />
        <n-button
          @click="emit('reset', 'toggleMainWindow')"
          title="重置为默认值（Alt+Z）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
        <n-button
          type="error"
          @click="emit('clear', 'toggleMainWindow')"
          title="清空快捷键"
        >
          清空
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          默认：Alt+Z｜快速显示/隐藏主窗口
        </n-text>
      </template>
    </n-form-item>

    <!-- 预览窗口快捷键 -->
    <n-form-item label="预览窗口唤醒/最小化" path="togglePreviewWindow">
      <n-input-group>
        <n-input
          :value="config.togglePreviewWindow"
          placeholder="点击后按下快捷键组合"
          readonly
          :style="{ flex: 1 }"
          @keydown="emit('hotkey-input', $event, 'togglePreviewWindow')"
          @focus="emit('editing-change', 'togglePreviewWindow')"
          @blur="emit('editing-change', null)"
        />
        <n-button
          @click="emit('reset', 'togglePreviewWindow')"
          title="重置为默认值（Alt+X）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
        <n-button
          type="error"
          @click="emit('clear', 'togglePreviewWindow')"
          title="清空快捷键"
        >
          清空
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          默认：Alt+X｜快速显示/隐藏人物插件独立预览窗口（仅在上传PSD文件后可用）
        </n-text>
      </template>
    </n-form-item>

    <!-- 搜索快捷键 -->
    <n-form-item label="打开搜索面板" path="openSearch">
      <n-input-group>
        <n-input
          :value="config.openSearch"
          placeholder="点击后按下快捷键组合"
          readonly
          :style="{ flex: 1 }"
          @keydown="emit('hotkey-input', $event, 'openSearch')"
          @focus="emit('editing-change', 'openSearch')"
          @blur="emit('editing-change', null)"
        />
        <n-button
          @click="emit('reset', 'openSearch')"
          title="重置为默认值（Ctrl+F）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
        <n-button
          type="error"
          @click="emit('clear', 'openSearch')"
          title="清空快捷键"
        >
          清空
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          默认：Ctrl+F｜打开搜索面板，搜索动作、表情、组合表情等部件
        </n-text>
      </template>
    </n-form-item>

    <!-- 悬浮预览（主画布）切换快捷键 -->
    <n-form-item label="切换悬浮预览（主画布）" path="toggleCanvasHover">
      <n-input-group>
        <n-input
          :value="config.toggleCanvasHover"
          placeholder="点击后按下快捷键组合"
          readonly
          :style="{ flex: 1 }"
          @keydown="emit('hotkey-input', $event, 'toggleCanvasHover')"
          @focus="emit('editing-change', 'toggleCanvasHover')"
          @blur="emit('editing-change', null)"
        />
        <n-button
          @click="emit('reset', 'toggleCanvasHover')"
          title="重置为默认值（Alt+C）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
        <n-button
          type="error"
          @click="emit('clear', 'toggleCanvasHover')"
          title="清空快捷键"
        >
          清空
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          默认：Alt+C｜快速开启/关闭鼠标悬浮预览效果（画布、预设）
        </n-text>
      </template>
    </n-form-item>

    <!-- 悬浮预览（部件）切换快捷键 -->
    <n-form-item label="切换悬浮预览（部件）" path="togglePartHover">
      <n-input-group>
        <n-input
          :value="config.togglePartHover"
          placeholder="点击后按下快捷键组合"
          readonly
          :style="{ flex: 1 }"
          @keydown="emit('hotkey-input', $event, 'togglePartHover')"
          @focus="emit('editing-change', 'togglePartHover')"
          @blur="emit('editing-change', null)"
        />
        <n-button
          @click="emit('reset', 'togglePartHover')"
          title="重置为默认值（Alt+V）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
        <n-button
          type="error"
          @click="emit('clear', 'togglePartHover')"
          title="清空快捷键"
        >
          清空
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          默认：Alt+V｜快速开启/关闭鼠标悬浮预览效果（部件列表、模板）
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
/** 快捷键表单：只读父级配置并转发按键、焦点、重置和清空事件，保存按钮由父级插槽提供。 */
defineProps({
  config: { type: Object, required: true }
})

const emit = defineEmits(['hotkey-input', 'editing-change', 'reset', 'clear'])
</script>

<style scoped>
/* 根表单继承父级作用域及 :deep 规则；普通后代表单项规则需保留，保存按钮沿用父级插槽样式。 */
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
