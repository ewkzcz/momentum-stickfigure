<template>
  <div class="video-generate">
    <n-card title="视频生成" size="small">
      <n-form label-placement="left" label-width="90px">
        <n-form-item label="提示词">
          <n-input v-model:value="form.prompt" type="textarea" :rows="4" placeholder="描述镜头运动、主体动作、场景氛围和画面风格" :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="参考图 URL">
          <n-input v-model:value="form.referenceText" type="textarea" :rows="2" :placeholder="`可选，每行一个图片地址，最多 ${MAX_VIDEO_REFERENCE_IMAGES} 张（图生视频模型作首帧/尾帧）`" :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="模型">
          <n-select v-model:value="form.model" :options="VIDEO_MODEL_OPTIONS" filterable tag :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="分辨率">
          <n-select v-model:value="form.resolution" :options="VIDEO_RESOLUTION_OPTIONS" :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="比例">
          <n-select v-model:value="form.aspectRatio" :options="VIDEO_ASPECT_OPTIONS" :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="时长（秒）">
          <n-input-number v-model:value="form.duration" :min="VIDEO_DURATION_RANGE.min" :max="VIDEO_DURATION_RANGE.max" :precision="0" :disabled="isBusy" />
        </n-form-item>
        <n-form-item label="生成音频">
          <n-switch v-model:value="form.generateAudio" :disabled="isBusy" />
        </n-form-item>
        <n-space>
          <n-button type="primary" :loading="isBusy" :disabled="isBusy" @click="handleSubmit">{{ isBusy ? '生成中...' : '生成视频' }}</n-button>
          <n-button v-if="isBusy" @click="stopPolling">停止等待</n-button>
        </n-space>
      </n-form>
    </n-card>

    <n-card title="生成结果" size="small" class="video-result">
      <n-empty v-if="task.status === 'idle'" description="暂无视频，提交任务后在这里查看" />
      <template v-else>
        <n-text depth="3">任务 {{ task.taskId || '提交中' }} · 状态 {{ statusText }}</n-text>
        <n-progress v-if="isBusy" type="line" :percentage="task.progress" :indicator-placement="'inside'" processing />
        <n-alert v-if="task.error" type="error" :show-icon="false">{{ task.error }}</n-alert>
        <video v-if="task.url" :src="task.url" controls class="video-player" />
        <n-space v-if="task.url">
          <n-button @click="save">保存到输出目录</n-button>
          <n-text v-if="task.savedPath" depth="3">{{ task.savedPath }}</n-text>
        </n-space>
      </template>
    </n-card>
  </div>
</template>

<script setup>
/** 视频生成面板：收集模型与画面参数，任务提交和轮询由 useVideoTask 负责。 */
import { reactive, computed, watch } from 'vue'
import { useMessage, NCard, NForm, NFormItem, NInput, NSelect, NInputNumber, NSwitch, NButton, NSpace, NText, NProgress, NAlert, NEmpty } from 'naive-ui'
import {
  VIDEO_MODEL_OPTIONS, VIDEO_RESOLUTION_OPTIONS, VIDEO_ASPECT_OPTIONS, VIDEO_DURATION_RANGE, MAX_VIDEO_REFERENCE_IMAGES
} from '@shared/video-models.js'
import { useVideoTask } from '../composables/useVideoTask.js'

const OPTIONS_STORAGE_KEY = 'video-generate-options'
const message = useMessage()
const { task, isBusy, submit, save, stopPolling } = useVideoTask(message)

/** 读取上次使用的参数；处理流程：1、解析本地存储，异常时使用默认值。 */
const loadSavedOptions = () => {
  // 1、存储不可用时页面仍可用。
  try {
    return JSON.parse(localStorage.getItem(OPTIONS_STORAGE_KEY) || '{}')
  } catch {
    return {}
  }
}

const form = reactive({
  prompt: '',
  referenceText: '',
  model: VIDEO_MODEL_OPTIONS[0].value,
  resolution: '720p',
  aspectRatio: '16:9',
  duration: 5,
  generateAudio: false,
  ...loadSavedOptions()
})

// 提示词和参考图每次重新填写，其余参数记住上次选择。
watch(() => [form.model, form.resolution, form.aspectRatio, form.duration, form.generateAudio], () => {
  try {
    const { model, resolution, aspectRatio, duration, generateAudio } = form
    localStorage.setItem(OPTIONS_STORAGE_KEY, JSON.stringify({ model, resolution, aspectRatio, duration, generateAudio }))
  } catch { /* 存储不可用时忽略 */ }
})

const STATUS_LABELS = { queued: '排队中', running: '生成中', completed: '已完成', failed: '失败', unknown: '未知' }
const statusText = computed(() => STATUS_LABELS[task.status] || task.status)

/** 提交任务；处理流程：1、整理参考图地址并限制数量，2、交给任务控制器。 */
const handleSubmit = () => {
  // 1、逐行解析参考图并去重。
  const referenceImages = [...new Set(form.referenceText.split('\n').map((line) => line.trim()).filter(Boolean))]
  if (referenceImages.length > MAX_VIDEO_REFERENCE_IMAGES) {
    message.warning(`参考图最多 ${MAX_VIDEO_REFERENCE_IMAGES} 张`)
    return
  }
  // 2、提交。
  submit({
    prompt: form.prompt,
    model: form.model,
    resolution: form.resolution,
    aspectRatio: form.aspectRatio,
    duration: form.duration,
    generateAudio: form.generateAudio,
    referenceImages
  })
}
</script>

<style scoped>
.video-generate {
  display: grid;
  grid-template-columns: minmax(320px, 1fr) minmax(320px, 1fr);
  gap: 16px;
  padding: 12px;
}

.video-result :deep(.n-card__content) {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.video-player {
  width: 100%;
  max-height: 60vh;
  border-radius: 8px;
  background: #000;
}
</style>
