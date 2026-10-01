<template>
  <div class="script-sidebar">
    <n-space vertical :size="8">
      <n-dropdown trigger="click" :options="typeOptions" @select="(type) => emit('create', type)">
        <n-button type="primary" block>新建项目</n-button>
      </n-dropdown>
      <n-button size="small" block quaternary @click="emit('select-folder')">项目文件夹…</n-button>
      <n-text depth="3" class="folder-path" :title="folder">{{ folder || '默认：文稿/MomentumCreative/scripts' }}</n-text>
    </n-space>
    <div class="project-list">
      <n-empty v-if="!projects.length" description="还没有项目" size="small" />
      <div
        v-for="item in projects"
        :key="item.id"
        :class="['project-item', { active: item.id === currentId }]"
        @click="emit('open', item.id)"
      >
        <div class="project-title">{{ item.title }}</div>
        <n-space justify="space-between" align="center">
          <n-text depth="3" class="project-meta">{{ typeLabel(item.type) }} · {{ formatTime(item.updatedAt) }}</n-text>
          <n-popconfirm @positive-click="emit('remove', item.id)">
            <template #trigger>
              <n-button text size="tiny" @click.stop>删除</n-button>
            </template>
            删除后项目文件将从文件夹中移除，确定删除“{{ item.title }}”？
          </n-popconfirm>
        </n-space>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 剧本项目侧栏：新建（选择作品类型）、切换、删除项目，显示项目文件夹。 */
import { NSpace, NButton, NDropdown, NText, NEmpty, NPopconfirm } from 'naive-ui'
import { PROJECT_TYPES } from '../composables/scriptPrompts.js'

defineProps({
  projects: { type: Array, required: true },
  currentId: { type: String, default: '' },
  folder: { type: String, default: '' }
})
const emit = defineEmits(['create', 'open', 'remove', 'select-folder'])

const typeOptions = PROJECT_TYPES.map((item) => ({ label: item.label, key: item.value }))
/** 类型名称；处理流程：1、查表，未知类型原样显示。 */
const typeLabel = (type) => PROJECT_TYPES.find((item) => item.value === type)?.label || type
/** 时间格式；处理流程：1、显示月-日 时:分。 */
const formatTime = (time) => time ? new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''
</script>

<style scoped>
.script-sidebar {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.folder-path {
  display: block;
  max-width: 100%;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.project-item {
  padding: 8px 10px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  cursor: pointer;
}

.project-item.active {
  border-color: #18a058;
  background: rgba(24, 160, 88, 0.08);
}

.project-title {
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-meta {
  font-size: 11px;
}
</style>
