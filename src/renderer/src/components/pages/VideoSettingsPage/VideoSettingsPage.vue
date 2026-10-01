<template>
  <SettingsShell>
    <n-form :model="form" label-placement="left" label-width="120px" class="settings-form">
      <n-form-item label="中转站地址" required>
        <n-input v-model:value="form.baseUrl" placeholder="请输入中转站地址" />
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">留空时沿用「AI生图设置」中的中转站地址</n-text>
        </template>
      </n-form-item>
      <n-form-item label="API 密钥" required>
        <div class="field-full">
          <n-input v-model:value="form.apiKey" type="password" show-password-on="click" placeholder="请输入 API 密钥" />
          <RelaySignupLink />
        </div>
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">用于调用视频生成服务；留空时沿用「AI生图设置」中的密钥</n-text>
        </template>
      </n-form-item>
      <n-form-item label="视频模型">
        <n-input-group>
          <n-select v-model:value="form.model" :options="modelOptions" filterable tag placeholder="选择或输入模型名称" />
          <n-button :loading="loadingModels" @click="fetchModels">获取模型列表</n-button>
        </n-input-group>
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">{{ form.models?.length ? `已获取 ${form.models.length} 个可用模型` : '点击“获取模型列表”查询当前密钥可用的视频模型' }}</n-text>
        </template>
      </n-form-item>
      <n-form-item label="默认分辨率">
        <n-select v-model:value="form.resolution" :options="VIDEO_RESOLUTION_OPTIONS" />
      </n-form-item>
      <n-form-item label="默认比例">
        <n-select v-model:value="form.aspectRatio" :options="VIDEO_ASPECT_OPTIONS" />
      </n-form-item>
      <n-form-item label="默认时长（秒）">
        <n-input-number v-model:value="form.duration" :min="VIDEO_DURATION_RANGE.min" :max="VIDEO_DURATION_RANGE.max" :precision="0" />
      </n-form-item>
      <n-form-item label="生成音频">
        <n-switch v-model:value="form.generateAudio" />
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">视频保存到「AI生图设置」输出目录下的 videos 文件夹</n-text>
        </template>
      </n-form-item>
    </n-form>
    <div class="save-button-container">
      <n-space>
        <n-button type="primary" size="large" @click="handleSave">保存配置</n-button>
        <n-button size="large" :loading="loadingModels" @click="handleTest">测试连接</n-button>
      </n-space>
    </div>
  </SettingsShell>
</template>

<script setup>
/** AI视频设置页：配置视频生成的中转站地址、API 密钥、模型与默认参数，保存后视频创作台立即使用。 */
import { reactive, ref, computed, onMounted, onActivated } from 'vue'
import {
  useMessage, NForm, NFormItem, NInput, NInputGroup, NInputNumber, NSelect, NSwitch, NButton, NSpace, NText
} from 'naive-ui'
import { normalizeApiBaseUrl } from '@shared/api-url.js'
import { VIDEO_MODEL_OPTIONS, VIDEO_RESOLUTION_OPTIONS, VIDEO_ASPECT_OPTIONS, VIDEO_DURATION_RANGE } from '@shared/video-models.js'
import SettingsShell from '@renderer/components/shared/SettingsShell.vue'
import RelaySignupLink from '@renderer/components/shared/RelaySignupLink.vue'
import { useVideoSettings, resolveVideoConnection } from '@renderer/components/creative/useVideoSettings.js'

const message = useMessage()
const settings = useVideoSettings()
const form = reactive({ ...settings, models: [...(settings.models || [])] })
const loadingModels = ref(false)

const modelOptions = computed(() => {
  const known = new Set(VIDEO_MODEL_OPTIONS.map((item) => item.value))
  return [...VIDEO_MODEL_OPTIONS, ...form.models.filter((id) => !known.has(id)).map((id) => ({ label: id, value: id }))]
})

/** 载入已保存的值；处理流程：1、进入页面时用最新设置覆盖表单。 */
const load = () => Object.assign(form, { ...settings, ...resolveVideoConnection(), models: [...(settings.models || [])] })

/** 校验地址与密钥；处理流程：1、规范地址，2、检查密钥。 */
const validate = () => {
  // 1、与其他设置页使用同一套地址规则。
  try {
    form.baseUrl = normalizeApiBaseUrl(form.baseUrl)
  } catch (error) {
    message.error(error.message)
    return false
  }
  // 2、密钥必填。
  if (!form.apiKey?.trim()) {
    message.error('请输入 API 密钥')
    return false
  }
  return true
}

/** 保存；处理流程：1、校验后写入共享设置（视频创作台立即生效）。 */
const handleSave = () => {
  // 1、写入。
  if (!validate()) return
  Object.assign(settings, { ...form, apiKey: form.apiKey.trim() })
  message.success('AI视频设置已保存')
}

/** 获取模型列表；处理流程：1、请求 /v1/models，2、优先保留标记为视频的模型。 */
const fetchModels = async (silent = false) => {
  // 1、请求。
  if (!validate()) return false
  loadingModels.value = true
  try {
    const result = await window.creativeApi.listModels({ baseUrl: form.baseUrl, apiKey: form.apiKey.trim() })
    if (!result?.success) {
      message.error(result?.message || '获取模型失败')
      return false
    }
    // 2、无类型标记时全部保留。
    const videoModels = result.data.filter((item) => item.types.some((type) => /video/i.test(type)))
    form.models = (videoModels.length ? videoModels : result.data).map((item) => item.id)
    if (silent !== true) message.success(`获取到 ${form.models.length} 个模型，保存后在视频创作台可选`)
    return true
  } finally {
    loadingModels.value = false
  }
}

/** 测试连接；处理流程：1、能获取模型列表即视为连接正常，不产生生成费用。 */
const handleTest = async () => {
  // 1、复用模型列表请求。
  if (await fetchModels(true)) message.success(`连接成功，可用模型 ${form.models.length} 个`)
}

onMounted(load)
onActivated(load)
</script>

<style scoped src="../../shared/settings-form.css"></style>
