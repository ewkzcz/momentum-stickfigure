<template>
  <div class="generation-log-component">
    <div class="log-layout">
      <!-- 顶部筛选和操作栏 -->
      <div class="log-header">
        <n-space justify="space-between" align="center">
          <n-space>
            <n-select
              v-model:value="filterType"
              :options="typeFilterOptions"
              placeholder="筛选类型"
              style="width: 120px"
              @update:value="handleFilterChange"
            />
            <n-select
              v-model:value="filterStatus"
              :options="statusFilterOptions"
              placeholder="筛选状态"
              style="width: 120px"
              @update:value="handleFilterChange"
            />
            <n-input
              v-model:value="searchKeyword"
              placeholder="搜索提示词..."
              style="width: 200px"
              clearable
              @input="handleSearch"
            >
              <template #prefix>
                <n-icon>
                  <span>🔍</span>
                </n-icon>
              </template>
            </n-input>
            <n-text depth="3" style="font-size: 12px">
              共 {{ filteredLogs.length }} 条记录
            </n-text>
          </n-space>
          <n-space>
            <n-button
              size="small"
              @click="clearAllLogs"
              type="error"
              ghost
            >
              <template #icon>
                <n-icon>
                  <span>🗑️</span>
                </n-icon>
              </template>
              清空日志
            </n-button>
          </n-space>
        </n-space>
      </div>

      <!-- 日志列表 -->
      <div class="log-content">
        <div v-if="filteredLogs.length === 0" class="empty-state">
          <div class="empty-icon">
            <n-icon :size="48">
              <span>📋</span>
            </n-icon>
          </div>
          <n-text depth="3">暂无日志记录</n-text>
        </div>
        
        <div v-else>
          <n-list bordered class="log-list">
              <n-list-item
                v-for="log in currentPageLogs"
                :key="log.id"
                class="log-item"
                :class="{ 'log-item-expanded': expandedLogId === log.id }"
                @click="toggleLogDetails(log.id)"
              >
              <div class="log-item-content">
                <!-- 任务信息头部 -->
                <div class="log-header-info">
                  <n-space justify="space-between" align="center">
                    <n-space align="center">
                      <!-- 快捷操作按钮向左 -->
                      <n-button
                        size="small"
                        type="primary"
                        ghost
                        @click.stop="copyPrompt(log.config.prompt)"
                        class="action-btn copy-btn"
                      >
                        <template #icon>
                          <n-icon>
                            <span>📋</span>
                          </n-icon>
                        </template>
                        复制
                      </n-button>
                      <n-button
                        size="small"
                        type="error"
                        ghost
                        @click.stop="deleteLog(log.id)"
                        class="action-btn delete-btn"
                      >
                        <template #icon>
                          <n-icon>
                            <span>🗑️</span>
                          </n-icon>
                        </template>
                        删除
                      </n-button>
                      <n-tag
                        :type="getTaskTypeColor(log.type)"
                        size="small"
                      >
                        {{ log.type === 'generate' ? '图片生成' : '图片编辑' }}
                      </n-tag>
                      <n-tag
                        :type="getStatusColor(log.status)"
                        size="small"
                      >
                        {{ getStatusText(log.status) }}
                      </n-tag>
                      <n-text depth="3" style="font-size: 12px">
                        {{ formatTime(log.createdAt) }}
                      </n-text>
                      <span class="prompt-summary">
                        {{ getPromptSummary(log.config.prompt) }}
                      </span>
                    </n-space>
                    <n-space>
                      <n-text depth="3" style="font-size: 12px">
                        耗时: {{ formatDuration(log.getDuration()) }}
                      </n-text>
                      <n-button
                        size="tiny"
                        circle
                        @click.stop="toggleLogDetails(log.id)"
                        title="展开/折叠详情"
                      >
                        <template #icon>
                          <n-icon>
                            <span>{{ expandedLogId === log.id ? '▲' : '▼' }}</span>
                          </n-icon>
                        </template>
                      </n-button>
                    </n-space>
                  </n-space>
                </div>

                <!-- 展开的详细信息 -->
                <n-collapse-transition :show="expandedLogId === log.id">
                  <div class="log-details">
                    <!-- 完整提示词 -->
                    <div class="full-prompt">
                      <n-text strong>完整提示词:</n-text>
                      <div class="prompt-text-full">
                        {{ log.config.prompt }}
                      </div>
                    </div>

                    <!-- 配置信息 -->
                    <div v-if="shouldShowConfig(log)" class="config-info">
                      <n-text strong>配置:</n-text>
                      <n-space class="config-tags">
                        <n-tag v-if="(log.config.numImages || 1) > 1" size="small">
                          数量: {{ log.config.numImages || 1 }}
                        </n-tag>
                        <n-tag v-if="log.config.inputImages" size="small">
                          输入图片: {{ log.config.inputImages.length }}
                        </n-tag>
                      </n-space>
                    </div>

                    <!-- 结果展示 -->
                    <div v-if="log.status === 'completed' && log.result" class="result-section">
                      <n-text strong>生成结果:</n-text>
                      <div class="result-images">
                        <div
                          v-for="(image, index) in log.result.slice(0, 6)"
                          :key="index"
                          class="result-image-item"
                        >
                          <img
                            :src="image.url"
                            :alt="image.alt"
                            class="result-thumbnail"
                          />
                        </div>
                        <div v-if="log.result.length > 6" class="more-images">
                          <n-text depth="3">
                            +{{ log.result.length - 6 }} 张
                          </n-text>
                        </div>
                      </div>
                    </div>

                    <!-- 错误信息 -->
                    <div v-if="log.status === 'failed' && log.error" class="error-section">
                      <n-text strong type="error">错误信息:</n-text>
                      <n-text type="error" class="error-text">
                        {{ log.error }}
                      </n-text>
                    </div>

                    <!-- 操作按钮 -->
                    <div class="log-actions">
                      <n-space>
                        <n-button
                          size="small"
                          @click.stop="copyPrompt(log.config.prompt)"
                        >
                          <template #icon>
                            <n-icon>
                              <span>📋</span>
                            </n-icon>
                          </template>
                          复制提示词
                        </n-button>
                        <n-button
                          size="small"
                          type="error"
                          ghost
                          @click.stop="deleteLog(log.id)"
                        >
                          <template #icon>
                            <n-icon>
                              <span>🗑️</span>
                            </n-icon>
                          </template>
                          删除
                        </n-button>
                      </n-space>
                    </div>
                  </div>
                </n-collapse-transition>
              </div>
            </n-list-item>
            </n-list>
          
          <!-- 分页组件 -->
          <div v-if="filteredLogs.length > pageSize" class="log-pagination">
            <n-pagination
              v-model:page="currentPage"
              :page-count="undefined"
              :page-size="pageSize"
              :item-count="filteredLogs.length"
              size="small"
              show-size-picker
              :page-sizes="[10, 20, 50, 100]"
              @update:page="handlePageChange"
              @update:page-size="handlePageSizeChange"
            >
              <template #prefix>
                <span style="font-size: 12px; color: var(--n-text-color-disabled)">
                  显示第 {{ (currentPage - 1) * pageSize + 1 }} - {{ Math.min(currentPage * pageSize, filteredLogs.length) }} 条
                </span>
              </template>
            </n-pagination>
          </div>
        </div>
      </div>
    </div>

  </div>
</template>

<script setup>
/** 生图任务日志：按类型、状态和提示词筛选记录，提供分页、复制与历史清理。 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { useTaskStore, TaskType, TaskStatus } from '../../../../stores/taskStore.js'

// 任务管理
const taskStore = useTaskStore()

// UI组件
const dialog = useDialog()
const message = useMessage()

// 响应式数据
const expandedLogId = ref(null) // 改为单一ID，一次只展开一行

// 筛选和搜索
const filterType = ref('all')
const filterStatus = ref('all')
const searchKeyword = ref('')

// 所有日志
const logs = ref([])

// 分页
const currentPage = ref(1)
const pageSize = ref(20)

// 筛选选项
const typeFilterOptions = [
  { label: '全部类型', value: 'all' },
  { label: '图片生成', value: 'generate' },
  { label: '图片编辑', value: 'edit' }
]

const statusFilterOptions = [
  { label: '全部状态', value: 'all' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '运行中', value: 'running' },
  { label: '等待中', value: 'pending' }
]

/**
 * 筛选任务日志。
 * 处理流程：
 * 1、依次应用类型和状态筛选。
 * 2、按提示词内容执行不区分大小写的包含搜索。
 */
const filteredLogs = computed(() => {
  let filtered = logs.value

  // 1、先筛选任务类型。
  if (filterType.value !== 'all') {
    filtered = filtered.filter(log => log.type === filterType.value)
  }

  // 2、再筛选当前任务状态。
  if (filterStatus.value !== 'all') {
    filtered = filtered.filter(log => log.status === filterStatus.value)
  }

  // 3、对剩余记录的提示词执行搜索。
  if (searchKeyword.value) {
    const keyword = searchKeyword.value.toLowerCase()
    filtered = filtered.filter(log => 
      log.config.prompt.toLowerCase().includes(keyword)
    )
  }

  return filtered
})

/** 计算总页数；处理流程：1、按筛选结果数量和每页容量向上取整。 */
const totalPages = computed(() => {
  // 1、分页基于筛选后的记录集合。
  return Math.ceil(filteredLogs.value.length / pageSize.value)
})

/**
 * 获取当前分页记录。
 * 处理流程：
 * 1、计算页码对应起止下标，截取筛选结果。
 */
const currentPageLogs = computed(() => {
  // 1、界面页码从一开始，数组下标从零开始。
  const start = (currentPage.value - 1) * pageSize.value
  const end = start + pageSize.value
  return filteredLogs.value.slice(start, end)
})

/** 刷新日志列表；处理流程：1、从任务仓库读取按创建时间倒序排列的记录。 */
const refreshLogs = () => {
  // 1、日志与任务记录共用数据源。
  logs.value = taskStore.getAllTasks()
}

/** 处理筛选变化；处理流程：1、重置到第一页，避免旧页码超出筛选范围。 */
const handleFilterChange = () => {
  // 1、筛选后的记录由计算属性自动更新。
  currentPage.value = 1
}

/** 处理搜索提交；处理流程：1、将页码重置为第一页。 */
const handleSearch = () => {
  // 1、搜索文本变化后从首批结果开始展示。
  currentPage.value = 1
}

/** 切换分页；处理流程：1、保存分页组件传入的页码。 */
const handlePageChange = (page) => {
  // 1、分页记录由计算属性重新截取。
  currentPage.value = page
}

/** 修改每页容量；处理流程：1、更新容量并返回第一页。 */
const handlePageSizeChange = (size) => {
  // 1、容量变化后不沿用旧分页起点。
  pageSize.value = size
  currentPage.value = 1
}

/** 获取提示词摘要；处理流程：1、空值返回空文本，超过五十字符时截断并加省略号。 */
const getPromptSummary = (prompt) => {
  // 1、摘要仅用于列表显示，不改变原始提示词。
  if (!prompt) return ''
  const maxLength = 50
  return prompt.length > maxLength 
    ? prompt.substring(0, maxLength) + '...' 
    : prompt
}

/**
 * 判断日志是否需要显示附加配置。
 * 处理流程：
 * 1、图片数量大于一或包含输入图片时显示配置详情。
 */
const shouldShowConfig = (log) => {
  // 1、常规单张文生图不额外占用配置展示区域。
  const numImages = log.config.numImages || 1
  const hasInputImages = log.config.inputImages && log.config.inputImages.length > 0
  
  // 如果数量大于1或有输入图片，则显示配置
  return numImages > 1 || hasInputImages
}

/** 切换日志详情；处理流程：1、再次点击折叠当前行，否则切换到新行。 */
const toggleLogDetails = (logId) => {
  // 1、同一时刻只保存一个展开记录标识。
  if (expandedLogId.value === logId) {
    expandedLogId.value = null
  } else {
    expandedLogId.value = logId
  }
}

/** 获取任务类型颜色；处理流程：1、生成任务使用提示色，其余类型使用警示色。 */
const getTaskTypeColor = (type) => {
  // 1、用颜色辅助区分生成与编辑记录。
  return type === 'generate' ? 'info' : 'warning'
}

/** 获取状态颜色；处理流程：1、按状态查表，未知状态使用默认色。 */
const getStatusColor = (status) => {
  // 1、未知状态仍可正常显示标签。
  const colors = {
    completed: 'success',
    failed: 'error',
    running: 'info',
    pending: 'default'
  }
  return colors[status] || 'default'
}

/** 获取状态中文名；处理流程：1、按状态查表，未知状态保留原始值。 */
const getStatusText = (status) => {
  // 1、保留未映射状态以便定位历史记录。
  const texts = {
    completed: '已完成',
    failed: '失败',
    running: '运行中',
    pending: '等待中'
  }
  return texts[status] || status
}

/** 格式化任务时间；处理流程：1、使用中文区域格式显示本地日期和时间。 */
const formatTime = (timestamp) => {
  // 1、显示使用当前系统时区。
  return new Date(timestamp).toLocaleString('zh-CN')
}

/** 格式化任务耗时；处理流程：1、毫秒向下取整为秒，满一分钟时显示分秒。 */
const formatDuration = (duration) => {
  // 1、只转换展示单位，不修改任务原始毫秒值。
  const seconds = Math.floor(duration / 1000)
  if (seconds < 60) {
    return `${seconds}秒`
  }
  const minutes = Math.floor(seconds / 60)
  return `${minutes}分${seconds % 60}秒`
}


/**
 * 复制任务提示词。
 * 处理流程：
 * 1、拒绝空文本，调用浏览器剪贴板写入。
 * 2、完成后显示确认弹窗，失败时保留错误提示。
 */
const copyPrompt = async (prompt) => {
  // 1、复制完整提示词，不使用列表中的截断摘要。
  if (!prompt) {
    message.warning('提示词为空')
    return
  }
  
  try {
    await navigator.clipboard.writeText(prompt)
    
    // 使用弹窗提示复制成功
    dialog.success({
      title: '复制成功',
      content: '提示词已成功复制到剪贴板',
      positiveText: '确定',
      maskClosable: true
    })
  } catch (error) {
    console.error('复制失败:', error)
    message.error('复制失败')
  }
}


/**
 * 确认后删除单条任务日志。
 * 处理流程：
 * 1、确认后删除对应任务记录并刷新列表。
 * 2、被删除记录正在展开时清除展开状态。
 */
const deleteLog = async (logId) => {
  // 1、记录删除仅在用户确认回调中发生。
  dialog.warning({
    title: '删除确认',
    content: '确定要删除这条日志记录吗？此操作不可撤销。',
    positiveText: '确认删除',
    negativeText: '取消',
    onPositiveClick: () => {
      try {
        const success = taskStore.deleteTask(logId)
        if (success) {
          refreshLogs()
          // 如果删除的是当前展开的日志，关闭展开状态
          if (expandedLogId.value === logId) {
            expandedLogId.value = null
          }
          message.success('日志已删除')
        } else {
          message.error('删除失败')
        }
      } catch (error) {
        console.error('删除日志失败:', error)
        message.error('删除失败')
      }
    }
  })
}

/**
 * 确认后清理非活跃任务日志。
 * 处理流程：
 * 1、用户确认后逐条删除已结束记录，保留等待和运行任务。
 * 2、刷新列表、重置页码并报告实际删除数量。
 */
const clearAllLogs = async () => {
  // 1、批量清理保留活跃任务，与单条删除的选择范围不同。
  dialog.warning({
    title: '清空日志',
    content: '确定要清空所有日志记录吗？此操作不可撤销。',
    positiveText: '确认清空',
    negativeText: '取消',
    onPositiveClick: () => {
      try {
        const allLogs = taskStore.getAllTasks()
        let deletedCount = 0
        
        // 删除所有非活跃任务
        for (const log of allLogs) {
          if (!log.isActive()) {
            if (taskStore.deleteTask(log.id)) {
              deletedCount++
            }
          }
        }
        
        // 刷新日志列表
        refreshLogs()
        
        // 重置分页到第一页
        currentPage.value = 1
        
        // 显示成功消息
        message.success(`已清空 ${deletedCount} 条日志记录`)
      } catch (error) {
        console.error('清空日志失败:', error)
        message.error('清空日志失败: ' + error.message)
      }
    }
  })
}

// 定时刷新
let refreshInterval = null

// 组件挂载时初始化
onMounted(() => {
  refreshLogs()
  
  // 设置定期刷新
  refreshInterval = setInterval(refreshLogs, 5000)
})

// 组件卸载时清理
onUnmounted(() => {
  if (refreshInterval) {
    clearInterval(refreshInterval)
  }
})
</script>

<style scoped src="./GenerationLogComponent.css"></style>
