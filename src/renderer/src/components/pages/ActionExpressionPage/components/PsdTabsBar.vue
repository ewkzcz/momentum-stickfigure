<template>
  <div v-if="psdFiles.length > 0" class="psd-tabs-bar">
    <div class="psd-tabs-container" ref="psdTabsRef" @wheel="handlePsdTabsWheel">
      <div
        v-for="psdFile in psdFiles"
        :key="psdFile.id"
        :class="['psd-tab-item', { active: currentPsdFile?.id === psdFile.id }]"
        @click="emit('select', psdFile)"
      >
        <button class="psd-tab-close" @click.stop="emit('remove', psdFile.id)" title="移除">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
        <span class="psd-tab-name" :title="psdFile.name">{{ getDisplayFileName(psdFile.name) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
/** PSD 文件标签栏：只展示会话列表并传递选择、移除事件，不持有 PSD 数据或渲染状态。 */
import { useTabsScroll } from '../composables/useTabsScroll.js'
import { getDisplayFileName } from '../utils/stringUtils.js'

// 1、沿用父页面唯一维护的文件列表与当前会话引用。
defineProps({
  psdFiles: { type: Array, required: true },
  currentPsdFile: { type: Object, default: null }
})
const emit = defineEmits(['select', 'remove'])

// 2、复用原有滚轮算法，仅将标签容器引用移到实际挂载该容器的组件。
const { psdTabsRef, handlePsdTabsWheel } = useTabsScroll()
</script>

<style scoped>
/* PSD 文件标签栏样式：保留原规则、顺序及响应式覆盖，仅改变所属组件。 */
.psd-tabs-bar {
  background: var(--theme-background);
  flex-shrink: 0;
  padding: 2px 16px 0; /* 顶部 2px */
  position: relative;
}

.psd-tabs-bar::after {
  content: '';
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 2px;
  background: var(--theme-border);
  z-index: 1;
}

.psd-tabs-container {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  overflow-y: hidden;
  position: relative;
  z-index: 2;
}

.psd-tabs-container::-webkit-scrollbar {
  height: 12px;
}

.psd-tabs-container::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 6px;
}

.psd-tabs-container::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 6px;
}

.psd-tabs-container::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

.psd-tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 16px 12px;
  background: var(--theme-background-secondary);
  border: 2px solid transparent;
  border-bottom: none;
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  position: relative;
  min-width: 80px;
  max-width: none; /* 移除最大宽度限制，让文件名完全显示 */
  flex-shrink: 0; /* 防止标签被压缩 */
}

.psd-tab-item:hover {
  background: var(--theme-background-card);
  border-color: var(--theme-border);
  border-bottom: none;
}

.psd-tab-item.active {
  background: var(--theme-background-card);
  border-color: var(--theme-primary);
  border-bottom: 2px solid var(--theme-background-card);
  box-shadow: 0 -2px 4px rgba(0, 0, 0, 0.05);
  z-index: 3;
}

.psd-tab-name {
  flex: 1;
  font-size: 13px;
  color: var(--theme-foreground);
  white-space: nowrap; /* 保持单行显示 */
  /* 移除overflow和text-overflow，让文件名完全显示 */
}

.psd-tab-item.active .psd-tab-name {
  font-weight: 500;
  color: var(--theme-primary);
}

.psd-tab-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  padding: 0;
  background: rgba(255, 77, 79, 0.15);
  border: none;
  border-radius: 3px;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
  margin-right: 4px;
}

.psd-tab-close svg {
  width: 12px;
  height: 12px;
  stroke: #ff4d4f;
  stroke-width: 2;
}

.psd-tab-close:hover {
  background: rgba(255, 77, 79, 0.25);
}

.psd-tab-close:hover svg {
  stroke: #ff3333;
}

.psd-tab-close:active {
  transform: scale(0.9);
}

@media (max-width: 768px) {
  .psd-tabs-bar {
    padding: 8px 10px 0;
  }

  .psd-tabs-container {
    gap: 2px;
  }

  .psd-tab-item {
    min-width: 60px;
    max-width: none; /* 移动端也允许完全显示文件名 */
    padding: 8px 12px;
    gap: 8px;
    flex-shrink: 0;
  }

  .psd-tab-name {
    font-size: 12px;
  }

  .psd-tab-close {
    width: 18px;
    height: 18px;
  }

  .psd-tab-close svg {
    width: 12px;
    height: 12px;
  }
}
</style>
