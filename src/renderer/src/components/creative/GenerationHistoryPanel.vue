<template>
  <div class="history-panel">
    <div class="history-head">
      <n-text strong class="history-title">生成记录</n-text>
      <n-tag size="small" :bordered="false">{{ records.length }}</n-tag>
    </div>
    <n-input v-model:value="query.keyword" size="small" clearable placeholder="搜索名称或提示词" @keyup.enter="refresh" @clear="refresh">
      <template #suffix><n-button text size="tiny" @click="refresh">搜索</n-button></template>
    </n-input>
    <n-space :size="6" align="center" class="history-filters">
      <n-radio-group v-model:value="query.mode" size="small">
        <n-radio-button value="">全部</n-radio-button>
        <n-radio-button value="direct">直接生成</n-radio-button>
        <n-radio-button value="agent">Agent</n-radio-button>
      </n-radio-group>
      <n-checkbox v-model:checked="query.favoriteOnly" size="small">只看收藏</n-checkbox>
    </n-space>
    <n-space :size="6">
      <n-button size="tiny" :disabled="!records.length" @click="toggleSelectAll">{{ allSelected ? '取消全选' : '全选' }}</n-button>
      <n-popconfirm :disabled="!selected.size" @positive-click="remove([...selected])">
        <template #trigger><n-button size="tiny" type="error" secondary :disabled="!selected.size">删除{{ selected.size ? `（${selected.size}）` : '' }}</n-button></template>
        删除选中的 {{ selected.size }} 条记录及其图片，确定吗？
      </n-popconfirm>
    </n-space>

    <div class="history-list">
      <n-empty v-if="!records.length" size="small" :description="loading ? '读取中…' : '暂无生成记录'" class="history-empty" />
      <div
        v-for="item in records"
        :key="item.id"
        :class="['history-item', { pinned: item.pinned, checked: selected.has(item.id) }]"
        @click="openDetail(item)"
      >
        <n-checkbox :checked="selected.has(item.id)" @click.stop @update:checked="toggleSelect(item.id)" />
        <div class="history-thumb">
          <img v-if="item.media[0]?.thumb" :src="item.media[0].thumb" alt="" />
          <span v-else>{{ kind === 'video' ? '🎬' : '🖼️' }}</span>
        </div>
        <div class="history-info">
          <n-input
            v-if="editingId === item.id"
            v-model:value="editingTitle"
            size="tiny"
            autofocus
            maxlength="100"
            @click.stop
            @keyup.enter="commitRename(item)"
            @blur="commitRename(item)"
          />
          <div v-else class="history-name" :title="item.title">{{ item.title }}</div>
          <div class="history-meta">
            <n-tag size="tiny" :bordered="false" :type="item.mode === 'agent' ? 'info' : 'default'">{{ item.mode === 'agent' ? 'Agent' : '直接' }}</n-tag>
            <span>{{ formatTime(item.createdAt) }}</span>
          </div>
        </div>
        <div class="history-actions" @click.stop>
          <n-button text size="tiny" :title="item.pinned ? '取消置顶' : '置顶'" :class="{ on: item.pinned }" @click="update(item.id, { pinned: !item.pinned })">📌</n-button>
          <n-button text size="tiny" :title="item.favorite ? '取消收藏' : '收藏'" :class="{ on: item.favorite }" @click="update(item.id, { favorite: !item.favorite })">{{ item.favorite ? '★' : '☆' }}</n-button>
          <n-button text size="tiny" title="重命名" @click="startRename(item)">✎</n-button>
          <n-popconfirm @positive-click="remove([item.id])">
            <template #trigger><n-button text size="tiny" title="删除">🗑</n-button></template>
            删除这条记录？
          </n-popconfirm>
        </div>
      </div>
    </div>

    <n-modal v-model:show="detail.show" preset="card" :title="detail.record?.title" style="width: min(960px, 92vw);">
      <div v-if="detail.record" class="history-detail">
        <div class="detail-media">
          <template v-for="(item, index) in detail.media" :key="index">
            <video v-if="item?.type === 'video'" :src="item.url" controls class="detail-video" />
            <img v-else-if="item?.url" :src="item.url" alt="" class="detail-image" />
          </template>
          <n-spin v-if="detail.loading" size="small" />
        </div>
        <div v-if="detail.record.input" class="detail-block">
          <n-text strong>你的需求</n-text>
          <pre>{{ detail.record.input }}</pre>
        </div>
        <div v-if="detail.record.prompt" class="detail-block">
          <n-space justify="space-between" align="center">
            <n-text strong>提示词</n-text>
            <n-button size="tiny" @click="copyPrompt">复制提示词</n-button>
          </n-space>
          <pre>{{ detail.record.prompt }}</pre>
        </div>
        <div v-if="detail.record.reply" class="detail-block">
          <n-text strong>Agent 回复</n-text>
          <pre>{{ detail.record.reply }}</pre>
        </div>
        <n-text depth="3" class="detail-params">{{ paramsText(detail.record) }}</n-text>
      </div>
    </n-modal>
  </div>
</template>

<script setup>
/** 生成记录面板：搜索筛选、全选与批量删除、收藏、置顶、重命名，点击查看原图/视频与提示词。 */
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import {
  useMessage, NText, NTag, NInput, NButton, NSpace, NRadioGroup, NRadioButton, NCheckbox, NPopconfirm, NEmpty, NModal, NSpin
} from 'naive-ui'
import { useGenerationHistory } from './useGenerationHistory.js'

const props = defineProps({ kind: { type: String, required: true } })
const message = useMessage()
const { query, records, selected, loading, refresh, update, remove, toggleSelect, toggleSelectAll, readMedia } = useGenerationHistory(props.kind, message)
const editingId = ref('')
const editingTitle = ref('')
const detail = reactive({ show: false, record: null, media: [], loading: false })

const allSelected = computed(() => records.value.length > 0 && selected.value.size === records.value.length)

/** 时间格式；处理流程：1、显示月-日 时:分。 */
const formatTime = (time) => new Date(time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })

/** 参数摘要；处理流程：1、拼接非空参数。 */
const paramsText = (record) => Object.entries(record.params || {}).filter(([, value]) => value !== '' && value !== undefined && value !== null).map(([key, value]) => `${key}: ${value}`).join(' · ')

/** 开始重命名；处理流程：1、进入行内编辑。 */
const startRename = (item) => {
  // 1、带入原名称。
  editingId.value = item.id
  editingTitle.value = item.title
}

/** 提交重命名；处理流程：1、名称有变化才提交，2、退出编辑。 */
const commitRename = async (item) => {
  // 1、回车与失焦都会触发，只处理一次。
  if (editingId.value !== item.id) return
  const title = editingTitle.value.trim()
  editingId.value = ''
  if (title && title !== item.title) await update(item.id, { title })
}

/** 打开详情；处理流程：1、显示记录，2、按序号读取原图或视频地址。 */
const openDetail = async (item) => {
  // 1、先显示文字信息。
  if (editingId.value) return
  Object.assign(detail, { show: true, record: item, media: [], loading: true })
  // 2、读取媒体。
  try {
    detail.media = await Promise.all(item.media.map((_, index) => readMedia(item.id, index)))
  } finally {
    detail.loading = false
  }
}

/** 复制提示词；处理流程：1、写入剪贴板并提示。 */
const copyPrompt = async () => {
  // 1、剪贴板不可用时提示失败。
  try {
    await navigator.clipboard.writeText(detail.record.prompt)
    message.success('提示词已复制')
  } catch {
    message.error('复制失败')
  }
}

onMounted(refresh)
onActivated(refresh)
</script>

<style scoped>
.history-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
  padding: 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-background-card);
}

.history-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.history-title {
  font-size: 15px;
}

.history-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.history-empty {
  margin: auto;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: pointer;
}

.history-item:hover,
.history-item.checked {
  border-color: var(--theme-border);
  background: rgba(127, 127, 127, 0.08);
}

.history-item.pinned {
  border-left: 3px solid #f0a020;
}

.history-thumb {
  width: 56px;
  height: 40px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border-radius: 4px;
  background: rgba(127, 127, 127, 0.15);
}

.history-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.history-info {
  flex: 1;
  min-width: 0;
}

.history-name {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.history-meta {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 2px;
  font-size: 11px;
  opacity: 0.7;
}

.history-actions {
  display: flex;
  gap: 2px;
  flex-shrink: 0;
}

.history-actions :deep(.n-button) {
  opacity: 0.45;
}

.history-actions :deep(.n-button.on),
.history-item:hover .history-actions :deep(.n-button) {
  opacity: 1;
}

.history-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 72vh;
  overflow: auto;
}

.detail-media {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.detail-image,
.detail-video {
  max-width: 100%;
  max-height: 48vh;
  border-radius: 6px;
}

.detail-block pre {
  margin: 6px 0 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  font-size: 13px;
  line-height: 1.6;
}

.detail-params {
  font-size: 12px;
}
</style>
