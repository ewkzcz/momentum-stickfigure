<template>
  <div class="params-bar">
    <label class="param">
      <span class="param-label">模型</span>
      <n-select v-model:value="settings.model" :options="modelOptions" filterable tag size="small" :disabled="disabled" class="param-model" />
    </label>
    <label class="param">
      <span class="param-label">分辨率</span>
      <n-select v-model:value="settings.resolution" :options="VIDEO_RESOLUTION_OPTIONS" size="small" :disabled="disabled" class="param-short" />
    </label>
    <label class="param">
      <span class="param-label">比例</span>
      <n-select v-model:value="settings.aspectRatio" :options="VIDEO_ASPECT_OPTIONS" size="small" :disabled="disabled" class="param-short" />
    </label>
    <label class="param">
      <span class="param-label">时长</span>
      <n-input-number v-model:value="settings.duration" :min="VIDEO_DURATION_RANGE.min" :max="VIDEO_DURATION_RANGE.max" :precision="0" size="small" :disabled="disabled" class="param-count">
        <template #suffix>秒</template>
      </n-input-number>
    </label>
    <label class="param">
      <span class="param-label">音频</span>
      <n-switch v-model:value="settings.generateAudio" size="small" :disabled="disabled" />
    </label>
  </div>
</template>

<script setup>
/** 视频参数栏：直接生成、Agent 增强与 AI视频设置共用同一份视频配置。 */
import { computed } from 'vue'
import { NSelect, NInputNumber, NSwitch } from 'naive-ui'
import { VIDEO_MODEL_OPTIONS, VIDEO_RESOLUTION_OPTIONS, VIDEO_ASPECT_OPTIONS, VIDEO_DURATION_RANGE } from '@shared/video-models.js'
import { useVideoSettings } from './useVideoSettings.js'

defineProps({ disabled: { type: Boolean, default: false } })
const settings = useVideoSettings()
// 内置模型 + AI视频设置中从接口拉取到的模型。
const modelOptions = computed(() => {
  const known = new Set(VIDEO_MODEL_OPTIONS.map((item) => item.value))
  return [...VIDEO_MODEL_OPTIONS, ...(settings.models || []).filter((id) => !known.has(id)).map((id) => ({ label: id, value: id }))]
})
</script>

<style scoped src="./params-bar.css"></style>
