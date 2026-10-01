<template>
  <div class="agent-panel">
    <div class="agent-toolbar">
      <n-space align="center" :size="6" class="agent-skills">
        <n-text depth="3">已启用 Skills：</n-text>
        <n-tag v-for="skill in enabledSkills" :key="skill.id" size="small" type="success" :bordered="false">{{ skill.name }}</n-tag>
        <n-text v-if="!enabledSkills.length" depth="3">无</n-text>
        <n-button text type="primary" size="small" @click="router.push({ name: 'settings-creative' })">管理 Skills</n-button>
      </n-space>
      <n-space align="center" :size="12">
        <n-tooltip>
          <template #trigger>
            <n-space align="center" :size="4"><n-switch v-model:value="allowGenerate" size="small" /><n-text>自动生成</n-text></n-space>
          </template>
          关闭后 Agent 只写提示词，不调用生成接口（不消耗生图/视频额度）
        </n-tooltip>
      </n-space>
    </div>

    <ImageParamsBar v-if="mode === 'image'" v-model:ratio="aspectRatio" :disabled="running" />
    <VideoParamsBar v-else :disabled="running" />

    <div ref="timelineRef" class="agent-timeline">
      <div v-if="!timeline.length" class="agent-empty">
        <n-text strong>Agent 增强：用大白话描述需求，Agent 读取你启用的 Skills，写出专业提示词后再{{ mode === 'image' ? '生成图片' : '提交视频任务' }}</n-text>
        <n-text v-if="!enabledSkills.length" depth="3" class="empty-hint">还没有启用 {{ mode === 'image' ? '图片' : '视频' }} 类 Skill，Agent 会按通用经验工作。点右上角“管理 Skills”去安装和启用。</n-text>
        <n-text depth="3" class="empty-hint">交互示意（不是真实结果）：</n-text>
        <SkillUsageExample :mode="mode" selectable @pick="(text) => { draft = text }" />
      </div>
      <div v-for="item in timeline" :key="item.key" :class="['agent-entry', `entry-${item.type}`]">
        <template v-if="item.type === 'images'">
          <div class="agent-images">
            <div v-for="(src, index) in item.images" :key="index" class="agent-image">
              <n-image :src="src" object-fit="contain" width="100%" />
              <n-button size="tiny" @click="saveImage(src)">保存</n-button>
            </div>
          </div>
        </template>
        <template v-else-if="item.type === 'video'">
          <video :src="item.url" controls class="agent-video" />
          <n-button size="tiny" @click="saveVideo(item)">保存到输出目录</n-button>
        </template>
        <template v-else-if="item.type === 'prompt'">
          <n-text depth="3">提交的提示词：</n-text>
          <pre class="agent-text">{{ item.text }}</pre>
        </template>
        <pre v-else class="agent-text">{{ item.text }}</pre>
      </div>
      <n-spin v-if="running" size="small" class="agent-spin" />
    </div>

    <div class="agent-input">
      <n-input
        v-model:value="draft"
        type="textarea"
        :autosize="{ minRows: 3, maxRows: 8 }"
        :placeholder="placeholder"
        :disabled="running"
        @keydown.enter.exact.prevent="handleSend"
      />
      <n-space vertical :size="8">
        <n-button type="primary" :disabled="running || !draft.trim()" @click="handleSend">发送</n-button>
        <n-button v-if="running" @click="stop">停止</n-button>
        <n-button v-else quaternary :disabled="!timeline.length" @click="clear">清空</n-button>
      </n-space>
    </div>
  </div>
</template>

<script setup>
/** 图片/视频创作 Agent 面板：用大白话描述需求，Agent 结合已启用 Skills 写提示词并调用生成。 */
import { ref, computed, watch, nextTick, onActivated, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, NSpace, NText, NTag, NButton, NSwitch, NTooltip, NImage, NInput, NSpin } from 'naive-ui'
import SkillUsageExample from './SkillUsageExample.vue'
import ImageParamsBar from './ImageParamsBar.vue'
import VideoParamsBar from './VideoParamsBar.vue'
import { useAgentRun } from './useAgentRun.js'
import { useCreativeConfig } from './useCreativeConfig.js'

const props = defineProps({ mode: { type: String, required: true } })
const emit = defineEmits(['handoff'])

const HANDOFF_KEY = 'creative-handoff'
const router = useRouter()
const message = useMessage()
const { buildAgentImageConfig, buildAgentVideoConfig, refreshSkills } = useCreativeConfig()
const { timeline, running, enabledSkills, send, stop, clear } = useAgentRun(props.mode, message)
const draft = ref('')
const allowGenerate = ref(true)
const aspectRatio = ref('16:9')
const timelineRef = ref(null)

const placeholder = computed(() => props.mode === 'image'
  ? '用大白话描述想要的图片，例如：画一个在雨夜霓虹街头撑伞的火柴人，做成电影海报（Enter 发送，Shift+Enter 换行）'
  : '描述想要的视频，例如：一个简笔画小人从左边跑进画面，停下来挥手，镜头缓慢推近（Enter 发送）')

/** 发送；处理流程：1、清空输入框并交给运行控制器。 */
const handleSend = () => {
  // 1、运行中忽略回车。
  const text = draft.value.trim()
  if (!text || running.value) return
  draft.value = ''
  send(text, { allowGenerate: allowGenerate.value, aspectRatio: aspectRatio.value })
}

/** 保存图片；处理流程：1、写入 AI 生图输出目录的 agent 子目录。 */
const saveImage = async (dataUrl) => {
  // 1、主进程负责目录授权。
  const result = await window.creativeApi.saveImage({ dataUrl, imageConfig: buildAgentImageConfig() })
  if (result?.success) message.success(`已保存：${result.data.path}`)
  else message.error(`保存失败：${result?.message || '未知错误'}`)
}

/** 保存视频；处理流程：1、复用视频下载通道。 */
const saveVideo = async (item) => {
  // 1、输出目录与 AI 生图设置一致。
  const image = buildAgentImageConfig()
  const result = await window.videoApi.download({ ...buildAgentVideoConfig(), projectRoot: image.projectRoot, outputDir: image.outputDir, logDir: image.logDir, url: item.url, taskId: item.taskId })
  if (result?.success) message.success(`已保存：${result.data.path}`)
  else message.error(`保存失败：${result?.message || '未知错误'}`)
}

/** 接收剧本创作台转来的内容；处理流程：1、读取并清除交接数据，填入输入框。 */
const takeHandoff = () => {
  // 1、只接收发给当前入口的内容。
  try {
    const handoff = JSON.parse(localStorage.getItem(HANDOFF_KEY) || 'null')
    if (handoff?.mode === props.mode && handoff.text) {
      draft.value = handoff.text
      localStorage.removeItem(HANDOFF_KEY)
      // 通知所在页面切换到 Agent 标签。
      emit('handoff')
    }
  } catch { /* 交接数据损坏时忽略 */ }
}

// 新内容出现时滚动到底部。
watch(() => timeline.value.length, async () => {
  await nextTick()
  timelineRef.value?.scrollTo({ top: timelineRef.value.scrollHeight })
})

onMounted(() => { refreshSkills(); takeHandoff() })
onActivated(() => { refreshSkills(); takeHandoff() })
</script>

<style scoped>
.agent-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  gap: 12px;
}

.agent-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.video-params {
  font-size: 12px;
}

.agent-timeline {
  flex: 1;
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  background: var(--theme-background-card);
}

.agent-empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 760px;
  margin: auto;
  padding: 16px;
}

.empty-hint {
  font-size: 12px;
}

.agent-entry {
  max-width: 88%;
}

.entry-user {
  align-self: flex-end;
  padding: 8px 12px;
  border-radius: 10px;
  background: rgba(24, 160, 88, 0.12);
}

.entry-assistant {
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid var(--theme-border);
}

.entry-skill,
.entry-status,
.entry-progress {
  font-size: 12px;
  opacity: 0.7;
}

.entry-error {
  color: #d03050;
}

.entry-prompt {
  padding: 8px 12px;
  border-left: 3px solid #2080f0;
  font-size: 12px;
}

.agent-text {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: inherit;
  line-height: 1.6;
}

.agent-images {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 8px;
}

.agent-image {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.agent-video {
  width: 100%;
  max-height: 50vh;
  border-radius: 8px;
  background: #000;
}

.agent-spin {
  align-self: flex-start;
}

.agent-input {
  display: flex;
  gap: 12px;
  align-items: flex-end;
}
</style>
