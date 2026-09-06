<template>
  <div class="component-panel">
    <n-card title="组件映射" size="small" :bordered="true">
      <template #header-extra>
        <div class="component-controls">
          <n-button size="small" type="primary" @click="$emit('auto-detect')">
            <template #icon>
              <n-icon><span>🤖</span></n-icon>
            </template>
            自动检测
          </n-button>
          <n-dropdown trigger="click" :options="batchOptions" @select="handleBatchAction">
            <n-button size="small" quaternary>
              <template #icon>
                <n-icon><span>⚙️</span></n-icon>
              </template>
              批量操作
            </n-button>
          </n-dropdown>
        </div>
      </template>
      
      <div class="component-mappings">
        <!-- 前手映射 -->
        <div class="mapping-group">
          <n-form-item label="前手图层" size="small">
            <n-select
              v-model:value="localMapping.frontHand"
              :options="frontHandSelectOptions"
              placeholder="选择前手图层"
              clearable
              @update:value="handleMappingChange('frontHand', $event)"
            />
          </n-form-item>
          <div class="mapping-info">
            <n-text depth="3" class="info-text">
              可选: {{ frontHandOptions.length }} 个图层
            </n-text>
          </div>
        </div>

        <!-- 后手映射 -->
        <div class="mapping-group">
          <n-form-item label="后手图层" size="small">
            <n-select
              v-model:value="localMapping.backHand"
              :options="backHandSelectOptions"
              placeholder="选择后手图层"
              clearable
              @update:value="handleMappingChange('backHand', $event)"
            />
          </n-form-item>
          <div class="mapping-info">
            <n-text depth="3" class="info-text">
              可选: {{ backHandOptions.length }} 个图层
            </n-text>
          </div>
        </div>

        <!-- 表情映射 -->
        <div class="mapping-group">
          <n-form-item label="表情图层" size="small">
            <n-select
              v-model:value="localMapping.expression"
              :options="expressionSelectOptions"
              placeholder="选择表情图层"
              clearable
              @update:value="handleMappingChange('expression', $event)"
            />
          </n-form-item>
          <div class="mapping-info">
            <n-text depth="3" class="info-text">
              可选: {{ expressionOptions.length }} 个图层
            </n-text>
          </div>
        </div>

        <!-- 映射统计 -->
        <div class="mapping-stats">
          <n-divider />
          <n-space>
            <n-tag size="small" :type="getMappingStatusType('frontHand')">
              前手: {{ localMapping.frontHand ? '已配置' : '未配置' }}
            </n-tag>
            <n-tag size="small" :type="getMappingStatusType('backHand')">
              后手: {{ localMapping.backHand ? '已配置' : '未配置' }}
            </n-tag>
            <n-tag size="small" :type="getMappingStatusType('expression')">
              表情: {{ localMapping.expression ? '已配置' : '未配置' }}
            </n-tag>
          </n-space>
        </div>

        <!-- 操作按钮 -->
        <div class="mapping-actions">
          <n-space>
            <n-button 
              type="primary" 
              @click="$emit('export')"
              :disabled="!hasValidMapping"
            >
              <template #icon>
                <n-icon><span>💾</span></n-icon>
              </template>
              导出配置
            </n-button>
            <n-button quaternary @click="$emit('clear-selection')">
              <template #icon>
                <n-icon><span>🗑️</span></n-icon>
              </template>
              清空选择
            </n-button>
          </n-space>
        </div>
      </div>
    </n-card>
  </div>
</template>

<script setup>
/** 部件映射面板：同步图层映射，提供批量选择和导出操作入口。 */
import { ref, reactive, computed, watch, h } from 'vue'

const props = defineProps({
  componentMapping: {
    type: Object,
    required: true
  },
  frontHandOptions: {
    type: Array,
    default: () => []
  },
  backHandOptions: {
    type: Array,
    default: () => []
  },
  expressionOptions: {
    type: Array,
    default: () => []
  }
})

const emits = defineEmits([
  'mapping-change', 
  'auto-detect', 
  'toggle-all', 
  'invert-selection', 
  'clear-selection', 
  'export'
])

// 本地映射状态
const localMapping = reactive({
  frontHand: '',
  backHand: '',
  expression: ''
})

// 同步外部映射状态
watch(() => props.componentMapping, (newMapping) => {
  Object.assign(localMapping, newMapping)
}, { immediate: true, deep: true })

/** 前手下拉选项。处理流程：1、将名称和图层索引映射为选项标签与值。 */
const frontHandSelectOptions = computed(() => 
  // 1、保留原始选项顺序。
  props.frontHandOptions.map(option => ({
    label: option.name,
    value: option.index
  }))
)

/** 后手下拉选项。处理流程：1、将名称和图层索引映射为选项标签与值。 */
const backHandSelectOptions = computed(() => 
  // 1、保留原始选项顺序。
  props.backHandOptions.map(option => ({
    label: option.name,
    value: option.index
  }))
)

/** 表情下拉选项。处理流程：1、将名称和图层索引映射为选项标签与值。 */
const expressionSelectOptions = computed(() => 
  // 1、保留原始选项顺序。
  props.expressionOptions.map(option => ({
    label: option.name,
    value: option.index
  }))
)

// 批量操作选项
const batchOptions = [
  {
    label: '切换所有图层',
    key: 'toggle-all',
    icon: () => h('span', { style: 'margin-right: 8px' }, '🔄')
  },
  {
    label: '反选图层',
    key: 'invert-selection',
    icon: () => h('span', { style: 'margin-right: 8px' }, '🔀')
  },
  {
    label: '清空选择',
    key: 'clear-selection',
    icon: () => h('span', { style: 'margin-right: 8px' }, '🗑️')
  }
]

/** 判断是否已配置任一映射。处理流程：1、返回首个有效映射值供界面判定。 */
const hasValidMapping = computed(() => {
  // 1、检查前手、后手和表情映射。
  return localMapping.frontHand || localMapping.backHand || localMapping.expression
})

/**
 * 处理部件映射变更。
 * 处理流程：
 * 1、同步本地映射。
 * 2、通知父组件对应分类和值。
 */
const handleMappingChange = (type, value) => {
  // 1、立即更新本地控件状态。
  localMapping[type] = value
  // 2、向父组件提交变更。
  emits('mapping-change', type, value)
}

/** 获取映射状态样式。处理流程：1、已映射返回成功类型，否则返回默认类型。 */
const getMappingStatusType = (type) => {
  // 1、以当前分类是否有值决定状态类型。
  return localMapping[type] ? 'success' : 'default'
}

/**
 * 转发批量操作菜单事件。
 * 处理流程：
 * 1、按菜单键派发全选切换、反选或清空事件。
 */
const handleBatchAction = (key) => {
  // 1、将已知菜单键映射到父组件事件。
  switch (key) {
    case 'toggle-all':
      emits('toggle-all')
      break
    case 'invert-selection':
      emits('invert-selection')
      break
    case 'clear-selection':
      emits('clear-selection')
      break
  }
}
</script>

<style scoped>
.component-panel {
  min-height: 300px;
}

.component-controls {
  display: flex;
  gap: var(--theme-spacing-xs);
}

.component-mappings {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-lg);
}

.mapping-group {
  display: flex;
  flex-direction: column;
  gap: var(--theme-spacing-xs);
}

.mapping-info {
  padding-left: var(--theme-spacing-sm);
}

.info-text {
  font-size: var(--theme-font-xs);
}

.mapping-stats {
  margin-top: var(--theme-spacing-md);
}

.mapping-actions {
  margin-top: var(--theme-spacing-lg);
}

/* 表单项样式调整 */
:deep(.n-form-item .n-form-item-label) {
  font-size: var(--theme-font-sm);
  font-weight: 500;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .component-controls {
    flex-wrap: wrap;
  }
  
  .mapping-actions {
    margin-top: var(--theme-spacing-md);
  }
  
  .mapping-actions .n-space {
    justify-content: stretch;
  }
}
</style>
