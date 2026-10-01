<template>
  <div class="params-bar">
    <label class="param">
      <span class="param-label">模型</span>
      <n-select v-model:value="params.model" :options="IMAGE_MODEL_OPTIONS" filterable tag size="small" :disabled="disabled" class="param-model" />
    </label>
    <template v-if="isOpenAi">
      <label class="param">
        <span class="param-label">质量</span>
        <n-select v-model:value="params.quality" :options="IMAGE_QUALITY_OPTIONS" size="small" :disabled="disabled" class="param-short" />
      </label>
      <label class="param">
        <span class="param-label">清晰度</span>
        <n-select v-model:value="params.imageTier" :options="IMAGE_TIER_OPTIONS" size="small" :disabled="disabled" class="param-short" />
      </label>
      <label class="param">
        <span class="param-label">张数</span>
        <n-input-number v-model:value="params.numImages" :min="1" :max="MAX_IMAGE_COUNT" :precision="0" size="small" :disabled="disabled" class="param-count" />
      </label>
    </template>
    <label v-if="ratio !== undefined" class="param">
      <span class="param-label">比例</span>
      <n-select :value="ratio" :options="IMAGE_RATIO_OPTIONS" size="small" :disabled="disabled" class="param-short" @update:value="(value) => emit('update:ratio', value)" />
    </label>
  </div>
</template>

<script setup>
/** 生图参数栏：直接生成与 Agent 增强共用，模型/质量/清晰度/张数写入共享配置，比例由调用方管理。 */
import { computed } from 'vue'
import { NSelect, NInputNumber } from 'naive-ui'
import { IMAGE_MODEL_OPTIONS, IMAGE_QUALITY_OPTIONS, IMAGE_TIER_OPTIONS, IMAGE_RATIO_OPTIONS, MAX_IMAGE_COUNT, resolveImageProtocol } from '@shared/image-models.js'
import { useImageParams } from './useImageParams.js'

defineProps({
  ratio: { type: String, default: undefined },
  disabled: { type: Boolean, default: false }
})
const emit = defineEmits(['update:ratio'])
const params = useImageParams()
const isOpenAi = computed(() => resolveImageProtocol(params.model) === 'openai')
</script>

<style scoped src="./params-bar.css"></style>
