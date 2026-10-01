<template>
  <div class="episodes-pane">
    <div class="episode-list">
      <n-space :size="6" vertical>
        <n-button size="small" block @click="addEpisode">+ 新增一{{ unit }}</n-button>
      </n-space>
      <n-empty v-if="!project.episodes.length" size="small" description="先在“分集大纲”中生成并点击“按大纲创建分集”，或手动新增" />
      <div
        v-for="(episode, index) in project.episodes"
        :key="index"
        :class="['episode-item', { active: index === current }]"
        @click="current = index"
      >
        <span :class="['dot', { done: episode.content?.trim() }]" />
        <span class="episode-name">第{{ index + 1 }}{{ unit }} {{ episode.title }}</span>
      </div>
    </div>

    <div v-if="episode" class="episode-editor">
      <n-space align="center" :size="8" class="episode-head">
        <n-input v-model:value="episode.title" size="small" placeholder="标题" style="width: 220px;" />
        <n-input v-model:value="instruction" size="small" clearable placeholder="本次写作的额外要求（可选）" style="flex: 1; min-width: 160px;" />
        <n-button type="primary" size="small" :disabled="busy" @click="writeContent">{{ episode.content?.trim() ? '重写本' : '写本' }}{{ unit }}</n-button>
        <n-checkbox v-model:checked="autoSummary" size="small">写完自动摘要</n-checkbox>
        <n-button v-if="busy" size="small" @click="stop">停止</n-button>
        <n-popconfirm @positive-click="removeEpisode">
          <template #trigger><n-button size="small" quaternary :disabled="busy">删除</n-button></template>
          删除第{{ current + 1 }}{{ unit }}？
        </n-popconfirm>
      </n-space>
      <n-text depth="3" class="brief">大纲：{{ outlineLineOf(project, current) || episode.brief || '（无对应大纲行）' }}</n-text>

      <n-tabs v-model:value="tab" type="line" size="small" class="episode-tabs" pane-class="episode-pane">
        <n-tab-pane name="content" tab="正文" display-directive="show">
          <n-input v-model:value="episode.content" type="textarea" class="fill" :disabled="generating === path('content')" placeholder="正文" />
        </n-tab-pane>
        <n-tab-pane name="summary" tab="摘要" display-directive="show">
          <div class="pane-actions"><n-button size="small" :disabled="busy || !episode.content?.trim()" @click="writeSummary">生成摘要</n-button><n-text depth="3" class="hint">摘要会作为后续{{ unit }}的“前情”，保证长篇连贯</n-text></div>
          <n-input v-model:value="episode.summary" type="textarea" class="fill" placeholder="本集摘要与状态变化" />
        </n-tab-pane>
        <n-tab-pane name="review" tab="审稿" display-directive="show">
          <div class="pane-actions"><n-button size="small" :disabled="busy || !episode.content?.trim()" @click="writeReview">AI 审稿</n-button><n-text depth="3" class="hint">对照设定检查一致性、节奏和台词，只提意见不改正文</n-text></div>
          <n-input v-model:value="episode.review" type="textarea" class="fill" placeholder="审稿意见" />
        </n-tab-pane>
        <n-tab-pane name="storyboard" tab="分镜" display-directive="show">
          <div class="pane-actions">
            <n-button size="small" :disabled="busy || !episode.content?.trim()" @click="writeStoryboard">转可拍分镜</n-button>
            <n-button size="small" :disabled="!episode.storyboard?.trim()" @click="handoff('video')">发送到视频创作</n-button>
            <n-button size="small" :disabled="!episode.storyboard?.trim()" @click="handoff('image')">发送到图片创作</n-button>
          </div>
          <n-input v-model:value="episode.storyboard" type="textarea" class="fill" placeholder="分镜表（镜号/时长/景别/运镜/画面/台词/视频提示词）" />
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup>
/** 逐集创作面板：分集列表、正文写作（带前情摘要）、摘要、审稿、转分镜，并可把分镜发送到视频/图片创作。 */
import { ref, computed, inject, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage, NSpace, NButton, NEmpty, NInput, NCheckbox, NPopconfirm, NText, NTabs, NTabPane } from 'naive-ui'
import { unitOf, outlineLineOf, buildEpisodePrompt, buildSummaryPrompt, buildReviewPrompt, buildStoryboardPrompt } from '../composables/scriptPrompts.js'

const { project, generating, generate, stop } = inject('scriptStudio')
const router = useRouter()
const dialog = useDialog()
const message = useMessage()
const current = ref(0)
const tab = ref('content')
const instruction = ref('')
const autoSummary = ref(true)

const unit = computed(() => unitOf(project.value))
const episode = computed(() => project.value.episodes[current.value])
const busy = computed(() => Boolean(generating.value))
/** 字段路径；处理流程：1、拼出 episodes.N.field。 */
const path = (field) => `episodes.${current.value}.${field}`

// 分集数量变化（删除/同步）时保证选中项有效。
watch(() => project.value.episodes.length, (length) => { if (current.value >= length) current.value = Math.max(0, length - 1) })

/** 新增分集；处理流程：1、追加空白分集并选中。 */
const addEpisode = () => {
  // 1、新分集无大纲时可手写标题。
  project.value.episodes.push({ title: '', brief: '', content: '', summary: '', review: '', storyboard: '' })
  current.value = project.value.episodes.length - 1
}

/** 删除当前分集；处理流程：1、移除并修正选中项。 */
const removeEpisode = () => {
  // 1、由确认框触发。
  project.value.episodes.splice(current.value, 1)
}

/** 写正文；处理流程：1、覆盖前确认，2、写完按需生成摘要。 */
const writeContent = () => {
  // 1、正文是主要劳动成果，覆盖必须确认。
  const index = current.value
  const run = async () => {
    tab.value = 'content'
    await generate(`episodes.${index}.content`, buildEpisodePrompt(project.value, index, instruction.value.trim()))
    // 2、摘要供下一集使用。
    if (autoSummary.value && project.value.episodes[index]?.content?.trim()) await generate(`episodes.${index}.summary`, buildSummaryPrompt(project.value, index))
  }
  if (!episode.value.content?.trim()) return run()
  dialog.warning({ title: `重写第${index + 1}${unit.value}`, content: '将覆盖当前正文，确定吗？', positiveText: '覆盖', negativeText: '取消', onPositiveClick: run })
}

const writeSummary = () => generate(path('summary'), buildSummaryPrompt(project.value, current.value))
const writeReview = () => generate(path('review'), buildReviewPrompt(project.value, current.value))
const writeStoryboard = () => generate(path('storyboard'), buildStoryboardPrompt(project.value, current.value))

/** 发送分镜；处理流程：1、写入交接数据，2、跳转到对应创作入口。 */
const handoff = (mode) => {
  // 1、目标页面读取后会清除交接数据。
  const intro = mode === 'video'
    ? '请根据以下分镜表，挑选最关键的一个镜头生成视频（先告诉我你选了哪个镜头）：'
    : '请根据以下分镜表，为最关键的镜头生成一张概念图：'
  try {
    localStorage.setItem('creative-handoff', JSON.stringify({ mode, text: `${intro}\n\n${episode.value.storyboard}` }))
  } catch {
    message.error('发送失败：本地存储不可用')
    return
  }
  // 2、跳转。
  router.push({ name: mode === 'video' ? 'video-studio' : 'generate' })
}
</script>

<style scoped>
.episodes-pane {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.episode-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: auto;
  min-height: 0;
}

.episode-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 8px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.episode-item.active {
  background: rgba(24, 160, 88, 0.12);
}

.episode-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--theme-border);
  flex-shrink: 0;
}

.dot.done {
  background: #18a058;
}

.episode-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
}

.brief {
  font-size: 12px;
}

.episode-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.episode-tabs :deep(.n-tabs-pane-wrapper),
.episode-tabs :deep(.episode-pane) {
  flex: 1;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.pane-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hint {
  font-size: 12px;
}

.fill {
  flex: 1;
  min-height: 0;
}

.fill :deep(textarea) {
  line-height: 1.7;
}
</style>
