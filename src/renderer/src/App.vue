<script setup>
/** 应用根组件：提供中文界面、主题和消息容器，并区分欢迎页与主布局。 */
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { darkTheme, lightTheme, zhCN } from 'naive-ui'
import { useTheme } from './utils/composables/useTheme'
import LayoutShell from './components/LayoutShell/LayoutShell.vue'
// 主题管理
const { currentTheme, getNaiveThemeOverrides } = useTheme()

/**
 * 选择组件库主题。
 * 处理流程：
 * 1、根据共享主题名称返回深色或浅色主题对象。
 */
const naiveTheme = computed(() => {
  // 1、将应用主题状态映射为组件库主题。
  return currentTheme.value === 'dark' ? darkTheme : lightTheme
})

/**
 * 获取应用定制的组件颜色。
 * 处理流程：
 * 1、从主题管理器读取当前主题的覆盖配置。
 */
const themeOverrides = computed(() => {
  // 1、复用主题管理器的缓存和颜色映射。
  return getNaiveThemeOverrides()
})

// 路由相关
const route = useRoute()

/**
 * 判断当前页面是否使用主布局。
 * 处理流程：
 * 1、仅欢迎页使用独立布局，其余路由显示工具导航。
 */
const needsLayout = computed(() => {
  // 1、按路由选择布局，此判断不承担登录校验。
  return route.path !== '/login'
})

</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :locale="zhCN"
    :theme-overrides="themeOverrides"
  >
    <n-dialog-provider>
      <n-notification-provider>
        <n-message-provider>
          <!-- 欢迎页面 -->
          <router-view v-if="!needsLayout" />
          
          <!-- 主布局（带侧边栏） -->
          <div
            v-else
            class="app-layout theme-transition"
            v-motion
            :initial="{ opacity: 0 }"
            :enter="{ opacity: 1, transition: { duration: 500 } }"
          >
            <!-- 主内容区域 -->
            <div
              class="app-main theme-transition"
              v-motion
              :initial="{ opacity: 0, y: 20 }"
              :enter="{ opacity: 1, y: 0, transition: { duration: 400, delay: 100 } }"
            >
              <LayoutShell />
            </div>
          </div>
          

        </n-message-provider>
      </n-notification-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>

<style>
/* 全局样式重置 */
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
    'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
    sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* 应用布局 */
.app-layout {
  display: flex;
  height: 100vh;
  overflow: hidden;
}

.app-main {
  flex: 1;
  overflow: hidden;
  background: var(--theme-background);
}

/* 主题相关的全局样式 */
.theme-light {
  color-scheme: light;
}

.theme-dark {
  color-scheme: dark;
}

/* 滚动条样式 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 4px;
  transition: background 0.2s ease;
}

::-webkit-scrollbar-thumb:hover {
  background: var(--theme-border-hover);
}

/* 选中文本样式 */
::selection {
  background: var(--theme-selection-background);
  color: var(--theme-selection-text);
}

::-moz-selection {
  background: var(--theme-selection-background);
  color: var(--theme-selection-text);
}

/* 输入框选中文本样式 */
input::selection,
textarea::selection {
  background: var(--theme-selection-background) !important;
  color: var(--theme-selection-text) !important;
}

input::-moz-selection,
textarea::-moz-selection {
  background: var(--theme-selection-background) !important;
  color: var(--theme-selection-text) !important;
}

/* Naive UI 输入框特定样式 */
.n-input input::selection,
.n-input textarea::selection {
  background: var(--theme-selection-background) !important;
  color: var(--theme-selection-text) !important;
}

.n-input input::-moz-selection,
.n-input textarea::-moz-selection {
  background: var(--theme-selection-background) !important;
  color: var(--theme-selection-text) !important;
}

/* 全局暗色主题强制覆盖 - 确保所有 NaiveUI 组件正确应用暗色主题 */
.theme-dark .n-input__input-el,
.theme-dark .n-input__textarea-el {
  background-color: var(--theme-input-background) !important;
  color: var(--theme-input-text) !important;
  border-color: var(--theme-input-border) !important;
}

.theme-dark .n-input__input-el::placeholder,
.theme-dark .n-input__textarea-el::placeholder {
  color: var(--theme-input-text-placeholder) !important;
}

.theme-dark .n-input:not(.n-input--disabled):hover .n-input__input-el,
.theme-dark .n-input:not(.n-input--disabled):hover .n-input__textarea-el {
  border-color: var(--theme-input-border-hover) !important;
  background-color: var(--theme-input-background) !important;
}

.theme-dark .n-input--focus .n-input__input-el,
.theme-dark .n-input--focus .n-input__textarea-el {
  background-color: var(--theme-input-background) !important;
  border-color: var(--theme-input-border-focus) !important;
  color: var(--theme-input-text) !important;
}

.theme-dark .n-card {
  background-color: var(--theme-background-card) !important;
  border-color: var(--theme-border) !important;
  color: var(--theme-foreground) !important;
}

.theme-dark .n-card__header {
  border-bottom-color: var(--theme-border) !important;
}

.theme-dark .n-card__title {
  color: var(--theme-foreground) !important;
}

.theme-dark .n-modal {
  background-color: var(--theme-background-card) !important;
}

.theme-dark .n-dialog {
  background-color: var(--theme-background-card) !important;
  color: var(--theme-foreground) !important;
}

.theme-dark .n-dialog__title {
  color: var(--theme-foreground) !important;
}

.theme-dark .n-dialog__content {
  color: var(--theme-foreground-secondary) !important;
}

.theme-dark .n-form-item-label__text {
  color: var(--theme-foreground-secondary) !important;
}

.theme-dark .n-button {
  color: var(--theme-foreground) !important;
}

.theme-dark .n-button--primary-type {
  color: #ffffff !important;
}

/* ==================== Tooltip 主题样式 ==================== */
/* 白天模式下的tooltip */
.theme-light .n-tooltip__content {
  background-color: white !important;
  color: #2a2a2a !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
}

.theme-light .n-tooltip__arrow {
  background-color: white !important;
}

/* 黑夜模式下的tooltip */
.theme-dark .n-tooltip__content {
  background-color: #2a2a2a !important;
  color: #e5e5e5 !important;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5) !important;
}

.theme-dark .n-tooltip__arrow {
  background-color: #2a2a2a !important;
}
</style>
