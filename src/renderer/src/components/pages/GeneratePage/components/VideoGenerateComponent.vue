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
        <n-form-item label="参数">
          <VideoParamsBar :disabled="isBusy" />
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
/** 视频直接生成面板：提示词与参考图在此填写，模型等参数与 Agent 增强、AI视频设置共用。 */
import { reactive, computed } from 'vue'
import { useMessage, NCard, NForm, NFormItem, NInput, NButton, NSpace, NText, NProgress, NAlert, NEmpty } from 'naive-ui'
import { MAX_VIDEO_REFERENCE_IMAGES } from '@shared/video-models.js'
import VideoParamsBar from '@renderer/components/creative/VideoParamsBar.vue'
import { useVideoSettings } from '@renderer/components/creative/useVideoSettings.js'
import { useVideoTask } from '../composables/useVideoTask.js'

const message = useMessage()
const settings = useVideoSettings()
const { task, isBusy, submit, save, stopPolling } = useVideoTask(message)
const form = reactive({ prompt: '', referenceText: '' })

const STATUS_LABELS = { queued: '排队中', running: '生成中', completed: '已完成', failed: '失败', unknown: '未知' }
const statusText = computed(() => STATUS_LABELS[task.status] || task.status)

/** 提交任务；处理流程：1、整理参考图地址并限制数量，2、带上共享参数交给任务控制器。 */
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
    model: settings.model,
    resolution: settings.resolution,
    aspectRatio: settings.aspectRatio,
    duration: settings.duration,
    generateAudio: settings.generateAudio,
    referenceImages
  })
}
</script>

<style scoped>
.video-generate {
  display: grid;
  grid-template-columns: minmax(360px, 1fr) minmax(320px, 1fr);
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
