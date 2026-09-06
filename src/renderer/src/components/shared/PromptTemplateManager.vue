<template>
  <n-modal
    v-model:show="showModal"
    preset="card"
    title="提示词模板库"
    :style="{ width: '600px', maxHeight: '80vh' }"
    :segmented="{
      content: true,
      footer: 'soft'
    }"
    :closable="true"
    :on-after-leave="handleAfterLeave"
  >
    <template #header-extra>
      <n-space size="small">
        <n-tag :bordered="false" type="info" size="small">
          共 {{ templates.length }} 条
        </n-tag>
        <n-tag v-if="favoriteCount > 0" :bordered="false" type="warning" size="small">
          ★ {{ favoriteCount }}
        </n-tag>
      </n-space>
    </template>

    <div class="prompt-template-manager">
      <!-- 操作栏 -->
      <n-space vertical :size="12">
        <n-input
          v-model:value="newTemplateContent"
          type="textarea"
          placeholder="输入新的提示词模板..."
          :rows="3"
          :maxlength="2000"
          show-count
          style="width: 100%;"
          @keydown.ctrl.enter="handleAddTemplate"
        />

        <n-space justify="space-between">
          <n-button
            type="primary"
            @click="handleAddTemplate"
            :disabled="!newTemplateContent.trim()"
            size="small"
          >
            添加模板
          </n-button>

          <n-space size="small">
            <n-button
              size="small"
              @click="handleClearNonFavorites"
              :disabled="templates.length === 0 || templates.every(t => t.isFavorite)"
              secondary
              type="warning"
            >
              清空
            </n-button>
            <n-dropdown :options="moreOptions" @select="handleMoreAction">
              <n-button size="small" secondary>
                更多
                <template #icon>
                  <n-icon>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M12 16a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2m0-6a2 2 0 0 1 2 2a2 2 0 0 1-2 2a2 2 0 0 1-2-2a2 2 0 0 1 2-2Z"/>
                    </svg>
                  </n-icon>
                </template>
              </n-button>
            </n-dropdown>
          </n-space>
        </n-space>

        <!-- 搜索框 -->
        <n-input
          v-model:value="searchKeyword"
          placeholder="搜索模板..."
          clearable
          size="small"
        >
          <template #prefix>
            <n-icon>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path fill="currentColor" d="M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5l-1.5 1.5l-5-5v-.79l-.27-.27A6.516 6.516 0 0 1 9.5 16A6.5 6.5 0 0 1 3 9.5A6.5 6.5 0 0 1 9.5 3m0 2C7 5 5 7 5 9.5S7 14 9.5 14S14 12 14 9.5S12 5 9.5 5Z"/>
              </svg>
            </n-icon>
          </template>
        </n-input>
      </n-space>

      <!-- 模板列表 -->
      <div class="template-list" ref="templateListRef">
        <n-empty
          v-if="filteredTemplates.length === 0"
          description="暂无模板"
          style="margin-top: 40px;"
        >
          <template #icon>
            <span style="font-size: 48px;">📝</span>
          </template>
        </n-empty>

        <TransitionGroup name="list" tag="div">
          <div
            v-for="(template, index) in filteredTemplates"
            :key="template.id"
            class="template-item"
            :class="{
              'template-item--favorite': template.isFavorite,
              'template-item--dragging': draggingId === template.id
            }"
            :draggable="true"
            @dragstart="handleDragStart($event, index)"
            @dragend="handleDragEnd"
            @dragover.prevent="handleDragOver($event, index)"
            @click="handleSelectTemplate(template)"
          >
            <!-- 拖拽手柄 -->
            <div class="drag-handle">
              <n-icon size="16" color="#999">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M9 3h2v2H9V3m4 0h2v2h-2V3M9 7h2v2H9V7m4 0h2v2h-2V7m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2m-4 4h2v2H9v-2m4 0h2v2h-2v-2Z"/>
                </svg>
              </n-icon>
            </div>

            <!-- 内容 -->
            <div class="template-content">
              <n-text class="template-text">{{ template.content }}</n-text>
              <n-text depth="3" class="template-time">
                {{ formatTime(template.createdAt) }}
              </n-text>
            </div>

            <!-- 操作按钮 -->
            <div class="template-actions">
              <n-button
                size="tiny"
                quaternary
                circle
                @click.stop="handleToggleFavorite(template.id)"
                :type="template.isFavorite ? 'warning' : 'default'"
              >
                <template #icon>
                  <n-icon
                    size="18"
                    :color="template.isFavorite ? '#f0a020' : undefined"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path
                        d="M12 3.5l2.18 4.42l4.88.7l-3.52 3.45l.83 4.85L12 14.84l-4.37 2.08l.83-4.85L4.94 8.62l4.88-.7z"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        :fill="template.isFavorite ? 'currentColor' : 'none'"
                      />
                    </svg>
                  </n-icon>
                </template>
              </n-button>

              <n-button
                size="tiny"
                quaternary
                circle
                type="error"
                @click.stop="handleDeleteTemplate(template.id)"
              >
                <template #icon>
                  <n-icon size="16">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                      <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                    </svg>
                  </n-icon>
                </template>
              </n-button>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
/** 提示词模板弹窗：编辑、收藏、搜索、排序及导入导出模板，并响应外部变化。 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import { useMessage, useDialog } from 'naive-ui'

const message = useMessage()
const dialog = useDialog()

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  templateManager: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:show', 'select'])

const showModal = ref(props.show)
const templates = ref([])
const newTemplateContent = ref('')
const searchKeyword = ref('')
const draggingId = ref(null)
const dragOverIndex = ref(-1)
const templateListRef = ref(null)
const templateType = computed(() => props.templateManager?.type || 'image')
let stopTemplateListener = null

const favoriteCount = computed(() => templates.value.filter(t => t.isFavorite).length)

/**
 * 生成搜索后的模板列表。
 * 处理流程：
 * 1、空搜索返回完整列表，否则按内容进行不区分大小写的包含匹配。
 */
const filteredTemplates = computed(() => {
  // 1、筛选不改变底层模板列表和顺序。
  if (!searchKeyword.value.trim()) {
    return templates.value
  }
  const keyword = searchKeyword.value.trim().toLowerCase()
  return templates.value.filter(t => t.content.toLowerCase().includes(keyword))
})

const moreOptions = [
  {
    label: '导出模板',
    key: 'export'
  },
  {
    label: '导入模板',
    key: 'import'
  },
  {
    type: 'divider'
  },
  {
    label: '清空全部',
    key: 'clear-all',
    props: {
      style: { color: 'red' }
    }
  }
]

watch(() => props.show, (newVal) => {
  showModal.value = newVal
  if (newVal) {
    loadTemplates()
  }
})

watch(showModal, (newVal) => {
  emit('update:show', newVal)
})

/**
 * 刷新弹窗模板列表。
 * 处理流程：
 * 1、等待管理器加载全部模板，读取失败时保留当前列表。
 */
const loadTemplates = async () => {
  // 1、将管理器快照同步到界面响应式数组。
  try {
    templates.value = await props.templateManager.getAllTemplates()
  } catch (error) {
    console.error('[PromptTemplateManager] 加载模板失败:', error)
  }
}

/**
 * 添加输入框中的提示词。
 * 处理流程：
 * 1、拒绝空白输入。
 * 2、保存模板后清空输入并刷新列表，异常时显示原因。
 */
const handleAddTemplate = async () => {
  // 1、在调用持久化服务前提示必填内容。
  if (!newTemplateContent.value.trim()) {
    message.warning('请输入提示词内容')
    return
  }

  try {
    // 2、添加完成后再清空输入，避免失败时丢失草稿。
    await props.templateManager.addTemplate(newTemplateContent.value)
    newTemplateContent.value = ''
    await loadTemplates()
    message.success('添加成功')
  } catch (error) {
    message.error(error.message)
  }
}

/**
 * 确认后删除指定模板。
 * 处理流程：
 * 1、显示删除确认框。
 * 2、确认后调用管理器删除，成功时刷新列表并提示。
 */
const handleDeleteTemplate = (id) => {
  // 1、实际删除在确认回调中执行。
  dialog.warning({
    title: '确认删除',
    content: '确认要删除该提示词模板吗？',
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      const success = await props.templateManager.deleteTemplate(id)
      if (success) {
        await loadTemplates()
        message.success('删除成功')
      } else {
        message.error('删除失败')
      }
    }
  })
}

/**
 * 确认后清理未收藏模板。
 * 处理流程：
 * 1、显示清理范围，确认后只保留收藏项。
 * 2、刷新列表并展示实际清理数量。
 */
const handleClearNonFavorites = () => {
  // 1、收藏保护和数量计算由管理器完成。
  dialog.warning({
    title: '确认清理',
    content: '确认要清理所有非收藏的提示词模板吗？',
    positiveText: '清理',
    negativeText: '取消',
    onPositiveClick: async () => {
      const count = await props.templateManager.clearNonFavorites()
      await loadTemplates()
      message.success(`已清理 ${count} 条非收藏模板`)
    }
  })
}

/**
 * 切换指定模板的收藏状态。
 * 处理流程：
 * 1、调用管理器切换，收到布尔结果后更新列表中的记录。
 */
const handleToggleFavorite = async (id) => {
  // 1、模板不存在时不将空结果误写成未收藏。
  try {
    const isFavorite = await props.templateManager.toggleFavorite(id)
    const target = templates.value.find(t => t.id === id)
    if (target && typeof isFavorite === 'boolean') {
      target.isFavorite = isFavorite
    }
  } catch (error) {
    message.error('切换收藏状态失败')
  }
}

/**
 * 选择模板并关闭弹窗。
 * 处理流程：
 * 1、将内容发送给父组件，再更新弹窗显示状态。
 */
const handleSelectTemplate = (template) => {
  // 1、只传递提示词内容，不暴露管理器记录给输入组件。
  emit('select', template.content)
  showModal.value = false
}

/**
 * 开始拖动模板排序。
 * 处理流程：
 * 1、记录拖动模板标识，并将标识写入浏览器拖拽数据。
 */
const handleDragStart = (event, index) => {
  // 1、后续移动用稳定标识重新定位源记录。
  draggingId.value = templates.value[index].id
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', templates.value[index].id)
}

/**
 * 在拖动经过目标位置时预览排序。
 * 处理流程：
 * 1、阻止默认行为并记录目标下标。
 * 2、定位拖动记录，在数组副本中移动后更新界面。
 */
const handleDragOver = (event, index) => {
  // 1、先允许拖放并更新目标高亮。
  event.preventDefault()
  dragOverIndex.value = index

  // 2、这里只调整界面顺序，持久化留到拖动结束。
  if (draggingId.value && draggingId.value !== templates.value[index].id) {
    const fromIndex = templates.value.findIndex(t => t.id === draggingId.value)
    const toIndex = index
    if (fromIndex !== -1 && toIndex !== -1) {
      const temp = [...templates.value]
      const [moved] = temp.splice(fromIndex, 1)
      temp.splice(toIndex, 0, moved)
      templates.value = temp
    }
  }
}

/**
 * 保存拖动后的模板顺序。
 * 处理流程：
 * 1、存在拖动记录时重写顺序字段并同步整个列表。
 * 2、保存完成后清除拖动标识和目标高亮。
 */
const handleDragEnd = async () => {
  // 1、落定后才写入持久化存储，避免每次经过目标都保存。
  if (draggingId.value) {
    templates.value.forEach((template, index) => {
      template.order = index
    })
    await props.templateManager.syncTemplates(templates.value)
  }
  // 2、结束当前拖动交互。
  draggingId.value = null
  dragOverIndex.value = -1
}

/**
 * 分派更多菜单操作。
 * 处理流程：
 * 1、根据菜单键调用导出、导入或清空入口。
 */
const handleMoreAction = async (key) => {
  // 1、各操作独立处理交互与错误提示。
  switch (key) {
    case 'export':
      await handleExport()
      break
    case 'import':
      handleImport()
      break
    case 'clear-all':
      await handleClearAll()
      break
  }
}

/**
 * 将模板列表下载为 JSON 文件。
 * 处理流程：
 * 1、获取序列化模板并创建临时对象地址。
 * 2、触发下载，释放对象地址并提示结果。
 */
const handleExport = async () => {
  try {
    // 1、用管理器的统一格式导出，保留排序和收藏字段。
    const data = await props.templateManager.exportTemplates()
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `prompt-templates-${Date.now()}.json`
    // 2、下载触发后不再保留临时对象地址。
    a.click()
    URL.revokeObjectURL(url)
    message.success('导出成功')
  } catch (error) {
    message.error('导出失败')
  }
}

/**
 * 选择 JSON 文件并合并导入模板。
 * 处理流程：
 * 1、创建仅接受 JSON 的文件选择器。
 * 2、读取选中文件，合并导入后刷新列表并提示结果。
 */
const handleImport = () => {
  // 1、选择器只用于本次导入，不保存到组件状态。
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json'
  /**
   * 处理用户选中的导入文件。
   * 处理流程：
   * 1、忽略取消选择，读取文件后以合并模式导入。
   * 2、成功时刷新列表，格式错误或读取失败时提示。
   */
  input.onchange = async (e) => {
    // 1、保留已有模板，标识排重由管理器负责。
    const file = e.target.files[0]
    if (!file) return

    try {
      const text = await file.text()
      const success = await props.templateManager.importTemplates(text, true)
      if (success) {
        await loadTemplates()
        message.success('导入成功')
      } else {
        message.error('导入失败，文件格式不正确')
      }
    } catch (error) {
      message.error('导入失败')
    }
  }
  input.click()
}

/**
 * 确认后清空全部模板。
 * 处理流程：
 * 1、显示不可恢复提示，用户确认后清空并刷新列表。
 */
const handleClearAll = async () => {
  // 1、批量删除仅在确认回调中执行。
  dialog.error({
    title: '危险操作',
    content: '确认要清空所有提示词模板吗？该操作不可恢复。',
    positiveText: '清空',
    negativeText: '取消',
    onPositiveClick: async () => {
      await props.templateManager.clearAllTemplates()
      await loadTemplates()
      message.success('已清空全部模板')
    }
  })
}

/**
 * 将模板时间转换为相对时间文本。
 * 处理流程：
 * 1、计算当前时间与创建时间的差值。
 * 2、一周内按分钟、小时或天显示，更早记录显示本地日期。
 */
const formatTime = (timestamp) => {
  // 1、以调用时刻计算时间差。
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now - date

  // 2、按从短到长的时间区间选择显示单位。
  if (diff < 60000) {
    return '刚刚'
  } else if (diff < 3600000) {
    return `${Math.floor(diff / 60000)}分钟前`
  } else if (diff < 86400000) {
    return `${Math.floor(diff / 3600000)}小时前`
  } else if (diff < 604800000) {
    return `${Math.floor(diff / 86400000)}天前`
  } else {
    return date.toLocaleDateString('zh-CN')
  }
}

/**
 * 弹窗关闭动画结束后清理输入。
 * 处理流程：
 * 1、重置搜索词和新增模板草稿。
 */
const handleAfterLeave = () => {
  // 1、下次打开时从完整列表和空草稿开始。
  searchKeyword.value = ''
  newTemplateContent.value = ''
}

/**
 * 订阅当前模板类型的外部变化。
 * 处理流程：
 * 1、确认窗口存在并解除旧监听。
 * 2、优先监听专用服务，缺失时监听共享存储的对应键。
 */
const subscribeTemplateChanges = () => {
  // 1、类型改变时先清理旧订阅，避免重复刷新。
  if (typeof window === 'undefined') {
    return
  }

  if (typeof stopTemplateListener === 'function') {
    stopTemplateListener()
    stopTemplateListener = null
  }

  // 2、只响应当前类型，其他类型广播不刷新此弹窗。
  if (window.promptTemplates?.onTemplatesChanged) {
    stopTemplateListener = window.promptTemplates.onTemplatesChanged((payload) => {
      if (payload?.type === templateType.value) {
        loadTemplates()
      }
    })
  } else if (window.storage?.onStorageChanged) {
    stopTemplateListener = window.storage.onStorageChanged((change) => {
      if (change?.key === `prompt-templates-${templateType.value}`) {
        loadTemplates()
      }
    })
  }
}

onMounted(() => {
  subscribeTemplateChanges()
})

watch(templateType, () => {
  subscribeTemplateChanges()
  loadTemplates()
})

onBeforeUnmount(() => {
  if (typeof stopTemplateListener === 'function') {
    stopTemplateListener()
  }
})

loadTemplates()
</script>

<style scoped>
.prompt-template-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
  min-height: 400px;
  max-height: calc(80vh - 120px);
}

.template-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
  min-height: 300px;
}

.template-item {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 12px;
  margin-bottom: 8px;
  background: var(--n-color);
  border: 1px solid var(--n-border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.template-item:hover {
  background: var(--n-color-hover);
  border-color: var(--n-border-color-hover);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.template-item--favorite {
  border-color: rgba(240, 160, 32, 0.6);
  background: linear-gradient(
    135deg,
    rgba(240, 160, 32, 0.2) 0%,
    rgba(240, 160, 32, 0.08) 100%
  );
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.35);
}

.template-item--dragging {
  opacity: 0.5;
  transform: scale(0.98);
}

.drag-handle {
  flex-shrink: 0;
  cursor: grab;
  padding: 4px;
  opacity: 0.4;
  transition: opacity 0.2s;
}

.template-item:hover .drag-handle {
  opacity: 0.8;
}

.drag-handle:active {
  cursor: grabbing;
}

.template-content {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.template-text {
  word-break: break-word;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-time {
  font-size: 11px;
}

.template-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.template-item:hover .template-actions {
  opacity: 1;
}

/* 列表动画 - 优化拖拽时的流畅度 */
.list-move,
.list-enter-active,
.list-leave-active {
  transition: all 0.2s ease;
}

.list-enter-from {
  opacity: 0;
  transform: translateX(-10px);
}

.list-leave-to {
  opacity: 0;
  transform: translateX(10px);
}

.list-leave-active {
  position: absolute;
}

/* 拖拽时禁用过渡动画，避免闪烁 */
.template-item.template-item--dragging {
  transition: none !important;
}

:global(.theme-light) .template-item--favorite {
  border-color: #f0a020;
  background: linear-gradient(135deg, #fffbf0 0%, #ffffff 100%);
  box-shadow: 0 4px 12px rgba(240, 160, 32, 0.15);
}

/* 滚动条样式 */
.template-list::-webkit-scrollbar {
  width: 6px;
}

.template-list::-webkit-scrollbar-track {
  background: transparent;
}

.template-list::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 3px;
}

.template-list::-webkit-scrollbar-thumb:hover {
  background: rgba(0, 0, 0, 0.3);
}
</style>
