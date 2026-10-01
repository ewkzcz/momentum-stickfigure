<template>
  <div class="stage-pane">
    <div class="stage-actions">
      <n-input v-model:value="instruction" size="small" clearable :disabled="busy" placeholder="额外要求（可选），如：反派更阴险一些、结局改成开放式" />
      <n-button type="primary" size="small" :disabled="busy" @click="handleGenerate">{{ hasText ? '重新生成' : 'AI 生成' }}</n-button>
      <n-button v-if="isMine" size="small" @click="stop">停止</n-button>
      <n-button v-if="stage.key === 'outline'" size="small" :disabled="busy || !hasText" @click="syncEpisodes">按大纲创建分集</n-button>
    </div>
    <n-input
      v-model:value="project.stages[stage.key]"
      type="textarea"
      class="stage-text"
      :placeholder="stage.placeholder"
      :disabled="isMine"
    />
    <n-text depth="3" class="stage-hint">生成时会带上项目设定和上游阶段内容；生成后可以直接修改，修改会自动保存并作为下游阶段的约束。</n-text>
  </div>
</template>

<script setup>
/** 单个创作阶段的编辑面板：AI 生成（流式写入）、手动修改；大纲阶段可一键创建分集。 */
import { ref, computed, inject } from 'vue'
import { useDialog, useMessage, NInput, NButton, NText } from 'naive-ui'
import { STAGES, buildStagePrompt, episodesFromOutline } from '../composables/scriptPrompts.js'

const props = defineProps({ stageKey: { type: String, required: true } })
const { project, generating, generate, stop } = inject('scriptStudio')
const dialog = useDialog()
const message = useMessage()
const instruction = ref('')

const stage = computed(() => STAGES.find((item) => item.key === props.stageKey))
const target = computed(() => `stages.${props.stageKey}`)
const isMine = computed(() => generating.value === target.value)
const busy = computed(() => Boolean(generating.value))
const hasText = computed(() => Boolean(project.value.stages[props.stageKey]?.trim()))

/** 生成；处理流程：1、已有内容时确认覆盖，2、流式生成。 */
const handleGenerate = () => {
  // 1、覆盖前确认，避免误删手写内容。
  const run = () => generate(target.value, buildStagePrompt(project.value, props.stageKey, instruction.value.trim()))
  if (!hasText.value) return run()
  dialog.warning({ title: '重新生成', content: `将覆盖当前“${stage.value.label}”内容，确定吗？`, positiveText: '覆盖', negativeText: '取消', onPositiveClick: run })
}

/** 按大纲创建分集；处理流程：1、解析大纲行，2、已有正文的分集保留正文。 */
const syncEpisodes = () => {
  // 1、解析失败时提示格式。
  const episodes = episodesFromOutline(project.value)
  if (!episodes.length) {
    message.warning('没有识别到“第N集：标题 —— 内容”格式的行')
    return
  }
  project.value.episodes = episodes
  message.success(`已同步 ${episodes.length} 个分集，到“正文”标签中逐集创作`)
}
</script>

<style scoped>
.stage-pane {
  display: flex;
  flex-direction: column;
  gap: 8px;
  height: 100%;
  min-height: 0;
}

.stage-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.stage-text {
  flex: 1;
  min-height: 0;
}

.stage-text :deep(textarea) {
  line-height: 1.7;
}

.stage-hint {
  font-size: 12px;
}
</style>
