<template>
  <n-modal 
    v-model:show="isVisible" 
    preset="card" 
    :title="modalTitle"
    size="large"
    :bordered="false"
    :segmented="segmentedConfig"
    :mask-closable="false"
    style="max-width: 90vw; width: 1200px;"
    @close="handleClose"
  >
    <div class="table-edit-content">
      <!-- 工具栏 -->
      <div class="table-toolbar">
        <n-space>
          <n-button type="primary" @click="handleCompose" :loading="composing">
            <template #icon>
              <n-icon><span>🎨</span></n-icon>
            </template>
            开始合成
          </n-button>
          <n-button quaternary @click="handleReset">
            <template #icon>
              <n-icon><span>🔄</span></n-icon>
            </template>
            重置配置
          </n-button>
          <n-button quaternary @click="handlePreview">
            <template #icon>
              <n-icon><span>👁️</span></n-icon>
            </template>
            预览效果
          </n-button>
        </n-space>
      </div>

      <!-- 表格编辑区域 -->
      <div class="table-container">
        <n-data-table
          ref="dataTableRef"
          :columns="tableColumns"
          :data="tableData"
          :pagination="false"
          :bordered="true"
          :single-line="false"
          size="small"
          flex-height
          style="height: 400px"
        />
      </div>

      <!-- 统计信息 -->
      <div class="table-stats">
        <n-card size="small" embedded>
          <n-descriptions :column="4" size="small">
            <n-descriptions-item label="总组合">
              {{ tableData.length }}
            </n-descriptions-item>
            <n-descriptions-item label="已配置">
              {{ configuredCount }}
            </n-descriptions-item>
            <n-descriptions-item label="待配置">
              {{ unconfiguredCount }}
            </n-descriptions-item>
            <n-descriptions-item label="完成度">
              {{ completionRate }}%
            </n-descriptions-item>
          </n-descriptions>
        </n-card>
      </div>

      <!-- 操作区域 -->
      <div class="table-actions">
        <n-space justify="end">
          <n-button @click="handleClose">取消</n-button>
          <n-button type="primary" @click="handleSave" :loading="saving">
            保存配置
          </n-button>
        </n-space>
      </div>
    </div>
  </n-modal>
</template>

<script setup>
/** 组合表格编辑视图：展示配置状态及操作入口，合成和保存仍为模拟流程。 */
import { ref, reactive, computed, watch, h } from 'vue'
import { useMessage } from 'naive-ui'
import { NButton, NTag, NSelect } from 'naive-ui'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  characterItem: {
    type: Object,
    default: null
  },
  embedded: {
    type: Boolean,
    default: false
  }
})

const emits = defineEmits(['close', 'compose', 'save'])

const message = useMessage()

// 响应式状态
const isVisible = ref(props.visible)
const composing = ref(false)
const saving = ref(false)
const dataTableRef = ref(null)

/** 弹窗标题。处理流程：1、按是否嵌入展示相应标题。 */
const modalTitle = computed(() => 
  // 1、采用嵌入模式对应的标题。
  props.embedded ? '嵌入式表格编辑' : '表格编辑模式'
)

const segmentedConfig = {
  content: true,
  footer: false
}

// 监听外部visible变化
watch(() => props.visible, (newVal) => {
  isVisible.value = newVal
})

// 监听内部isVisible变化
watch(isVisible, (newVal) => {
  if (!newVal) {
    handleClose()
  }
})

// 表格数据
const tableData = reactive([
  {
    id: 1,
    combination: '前手1 + 后手1 + 表情1',
    frontHand: '前手1',
    backHand: '后手1',
    expression: '表情1',
    status: '待配置',
    preview: null
  },
  {
    id: 2,
    combination: '前手1 + 后手2 + 表情2',
    frontHand: '前手1',
    backHand: '后手2',
    expression: '表情2',
    status: '已配置',
    preview: null
  },
  {
    id: 3,
    combination: '前手2 + 后手1 + 表情1',
    frontHand: '前手2',
    backHand: '后手1',
    expression: '表情1',
    status: '待配置',
    preview: null
  }
])

// 表格列配置
const tableColumns = [
  {
    title: '序号',
    key: 'id',
    width: 80,
    align: 'center'
  },
  {
    title: '组合名称',
    key: 'combination',
    width: 200,
    ellipsis: {
      tooltip: true
    }
  },
  {
    title: '前手',
    key: 'frontHand',
    width: 120,
    /** 渲染前手标签。处理流程：1、将当前行前手名称放入信息标签。 */
    render: (row, index) => {
      // 1、按前手列颜色呈现名称。
      return h(NTag, {
        size: 'small',
        type: 'info'
      }, { default: () => row.frontHand })
    }
  },
  {
    title: '后手',
    key: 'backHand',
    width: 120,
    /** 渲染后手标签。处理流程：1、将当前行后手名称放入成功标签。 */
    render: (row, index) => {
      // 1、按后手列颜色呈现名称。
      return h(NTag, {
        size: 'small',
        type: 'success'
      }, { default: () => row.backHand })
    }
  },
  {
    title: '表情',
    key: 'expression',
    width: 120,
    /** 渲染表情标签。处理流程：1、将当前行表情名称放入警告标签。 */
    render: (row, index) => {
      // 1、按表情列颜色呈现名称。
      return h(NTag, {
        size: 'small',
        type: 'warning'
      }, { default: () => row.expression })
    }
  },
  {
    title: '状态',
    key: 'status',
    width: 100,
    /** 渲染配置状态。处理流程：1、根据是否已配置选择标签类型并展示状态。 */
    render: (row) => {
      // 1、用完成状态决定标签颜色。
      const isConfigured = row.status === '已配置'
      return h(NTag, {
        size: 'small',
        type: isConfigured ? 'success' : 'default'
      }, { default: () => row.status })
    }
  },
  {
    title: '操作',
    key: 'actions',
    width: 150,
    /** 渲染行操作入口。处理流程：1、创建携带当前行的预览与编辑按钮。 */
    render: (row, index) => {
      // 1、构造当前组合的操作按钮。
      return h('div', {
        style: { display: 'flex', gap: '8px' }
      }, [
        h(NButton, {
          size: 'small',
          quaternary: true,
          onClick: () => handleRowPreview(row)
        }, { default: () => '预览' }),
        h(NButton, {
          size: 'small',
          quaternary: true,
          type: 'primary',
          onClick: () => handleRowEdit(row)
        }, { default: () => '编辑' })
      ])
    }
  }
]

/** 统计已配置数量。处理流程：1、过滤已配置行后读取数量。 */
const configuredCount = computed(() => 
  // 1、统计已完成配置的组合。
  tableData.filter(item => item.status === '已配置').length
)

/** 统计待配置数量。处理流程：1、过滤待配置行后读取数量。 */
const unconfiguredCount = computed(() => 
  // 1、统计仍待配置的组合。
  tableData.filter(item => item.status === '待配置').length
)

/** 计算完成百分比。处理流程：1、空列表返回零，其余按完成数占比取整。 */
const completionRate = computed(() => {
  // 1、处理空列表以避免除零。
  if (tableData.length === 0) return 0
  return Math.round((configuredCount.value / tableData.length) * 100)
})

/** 关闭编辑视图。处理流程：1、通知父组件关闭。 */
const handleClose = () => {
  // 1、交由父组件更新可见状态。
  emits('close')
}

/**
 * 执行当前占位合成流程。
 * 处理流程：
 * 1、标记处理中并等待模拟延时。
 * 2、通知合成完成，最后清除忙碌状态。
 */
const handleCompose = async () => {
  // 1、启动忙碌状态；此处尚未调用实际合成服务。
  composing.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 2000)) // 模拟合成过程
    // 2、完成模拟等待后通知父组件。
    message.success('合成完成')
    emits('compose')
  } catch (error) {
    message.error('合成失败')
  } finally {
    composing.value = false
  }
}

/** 重置组合配置。处理流程：1、清除每行状态和预览，再提示完成。 */
const handleReset = () => {
  // 1、逐行恢复为待配置状态。
  tableData.forEach(item => {
    item.status = '待配置'
    item.preview = null
  })
  message.info('配置已重置')
}

/** 提示整体预览尚未实现。处理流程：1、显示开发中提示。 */
const handlePreview = () => {
  // 1、显示当前功能状态。
  message.info('预览功能开发中...')
}

/**
 * 执行当前占位保存流程。
 * 处理流程：
 * 1、标记保存中并等待模拟延时。
 * 2、向父组件发送表格数据，最后恢复按钮状态。
 */
const handleSave = async () => {
  // 1、此处模拟保存等待，实际持久化由外部处理。
  saving.value = true
  try {
    await new Promise(resolve => setTimeout(resolve, 1000)) // 模拟保存过程
    // 2、将当前表格数据交给父组件。
    message.success('配置保存成功')
    emits('save', tableData)
  } catch (error) {
    message.error('保存失败')
  } finally {
    saving.value = false
  }
}

/** 提示待预览的组合。处理流程：1、显示当前行组合名称。 */
const handleRowPreview = (row) => {
  // 1、展示行级预览的目标名称。
  message.info(`预览组合: ${row.combination}`)
}

/** 提示待编辑的组合。处理流程：1、显示当前行组合名称。 */
const handleRowEdit = (row) => {
  // 1、展示行级编辑的目标名称。
  message.info(`编辑组合: ${row.combination}`)
}
</script>

<style scoped>
.table-edit-content {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-lg);
  padding: var(--theme-spacing-md);
}

.table-toolbar {
  padding-bottom: var(--theme-spacing-md);
  border-bottom: 1px solid var(--theme-border);
}

.table-container {
  flex: 1;
  border: 1px solid var(--theme-border);
  border-radius: var(--theme-border-radius);
  overflow: hidden;
}

.table-stats {
  margin-top: var(--theme-spacing-md);
}

.table-actions {
  padding-top: var(--theme-spacing-md);
  border-top: 1px solid var(--theme-border);
}

/* 深度样式调整 */
:deep(.n-data-table .n-data-table-th) {
  background: var(--theme-background-accent);
  font-weight: 600;
}

:deep(.n-data-table .n-data-table-td) {
  border-color: var(--theme-border);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .table-edit-content {
    padding: var(--theme-spacing-sm);
    gap: var(--theme-spacing-md);
  }
  
  .table-container {
    height: 300px !important;
  }
}
</style>
