<template>
  <div class="panel">
    <div class="panel-header" @click="togglePanel">
      <span>排版方式</span>
      <span>{{ collapsed ? '▼' : '▲' }}</span>
    </div>
    <div class="panel-content" v-show="!collapsed">
      <div class="template-selector">
        <select 
          id="template-select"
          v-model="selectedTemplateId"
          @change="onTemplateChange"
          class="template-select"
        >
          <option value="" disabled>选择一种排版方式</option>
          <option 
            v-for="template in templates" 
            :key="template.id"
            :value="template.id"
            :title="template.description"
          >
            {{ template.name }}
          </option>
        </select>
      </div>
    </div>
  </div>
</template>

<script>
/**
 * 排版方式选择下拉框组件
 * 
 * 功能：
 * - 以下拉选择框形式显示可用的视角排版方式
 * - 支持排版方式选择
 * - 显示排版方式详细信息（tooltip）
 */

import { ref, computed, watch } from 'vue'

export default {
  name: 'TemplatePanel',
  props: {
    templates: {
      type: Array,
      required: true
    },
    activeTemplate: {
      type: Object,
      default: null
    }
  },
  emits: ['template-select'],
  /**
   * 管理排版选择状态与选择事件。
   * 处理流程：
   * 1、初始化面板状态并同步外部排版
   * 2、提供展开切换与排版选择操作
   */
  setup(props, { emit }) {
    // 1、初始化选择状态并监听外部排版变化。
    // 面板展开状态
    const collapsed = ref(false)
    
    // 选中的排版方式ID
    const selectedTemplateId = ref('')

    // 监听activeTemplate的变化，同步到selectedTemplateId
    watch(() => props.activeTemplate, (newTemplate) => {
      selectedTemplateId.value = newTemplate ? newTemplate.id : ''
    }, { immediate: true })

    // 定义面板折叠与模板选择操作。
    /**
     * 切换面板展开/收起状态
     * 处理流程：
     * 1、反转当前面板折叠状态
     */
    const togglePanel = () => {
      // 1、切换折叠状态。
      collapsed.value = !collapsed.value
    }

    /**
     * 处理排版方式选择变化
     * 处理流程：
     * 1、按选中编号查找排版
     * 2、将有效排版通知父组件
     */
    const onTemplateChange = () => {
      // 1、查找当前选中的排版定义。
      const selectedTemplate = props.templates.find(
        template => template.id === selectedTemplateId.value
      )
      
      // 2、仅对有效排版发出选择事件。
      if (selectedTemplate) {
        emit('template-select', selectedTemplate)
      }
    }

    // 2、向模板暴露状态与交互方法。
    return {
      collapsed,
      selectedTemplateId,
      togglePanel,
      onTemplateChange
    }
  }
}
</script>

<style scoped>
.panel {
  background: var(--theme-background-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--border-radius-md);
  margin-bottom: var(--spacing-4);
}

.panel-header {
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--theme-background-accent);
  border-bottom: 1px solid var(--theme-border);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 500;
  user-select: none;
  transition: var(--transition-colors);
}

.panel-header:hover {
  background: var(--theme-background-secondary);
}

.panel-content {
  padding: var(--spacing-4);
}

.template-selector {
  padding: 0.5rem 0;
}

.template-select {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  background-color: var(--theme-background);
  color: var(--theme-foreground);
  font-size: 0.9rem;
  transition: all 0.2s ease;
  cursor: pointer;
}

.template-select:focus {
  outline: none;
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px rgba(102, 126, 234, 0.1);
}

.template-select:hover {
  border-color: var(--theme-primary);
  background-color: var(--theme-background-accent);
}

.template-select option {
  padding: 0.5rem;
  background-color: var(--theme-background);
  color: var(--theme-foreground);
  border: none;
}

.template-select option:hover {
  background-color: var(--theme-background-accent);
}

.template-select option:checked {
  background-color: var(--theme-primary);
  color: white;
}
</style>
