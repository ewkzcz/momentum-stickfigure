<template>
  <SettingsShell>
    <n-form :model="form" label-placement="left" label-width="120px" class="settings-form">
      <n-form-item label="接口地址" required>
        <n-input v-model:value="form.baseUrl" placeholder="请输入中转站地址" />
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">兼容 OpenAI 接口的服务地址，例如 https://gateway.example.com</n-text>
        </template>
      </n-form-item>
      <n-form-item label="API 密钥" required>
        <div class="field-full">
          <n-input v-model:value="form.apiKey" type="password" show-password-on="click" placeholder="请输入 API 密钥" />
          <RelaySignupLink />
        </div>
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">剧本创作台与 AI 绘图、视频创作台的 Agent 增强使用此密钥</n-text>
        </template>
      </n-form-item>
      <n-form-item label="模型" required>
        <n-input v-model:value="form.model" placeholder="请输入文本模型名称，例如 gpt-5.5、deepseek-chat" />
      </n-form-item>
      <n-form-item label="接口协议">
        <n-radio-group v-model:value="form.protocol">
          <n-radio-button value="chat">Chat Completions</n-radio-button>
          <n-radio-button value="responses">Responses</n-radio-button>
        </n-radio-group>
        <template #feedback>
          <n-text depth="3" style="font-size: 12px;">Chat Completions 对应 /v1/chat/completions，Responses 对应 /v1/responses</n-text>
        </template>
      </n-form-item>
    </n-form>
    <div class="save-button-container">
      <n-space>
        <n-button type="primary" size="large" @click="handleSave">保存配置</n-button>
        <n-button size="large" :loading="testing" @click="handleTest">测试连接</n-button>
      </n-space>
    </div>
  </SettingsShell>
</template>

<script setup>
/** 文本模型设置页：配置剧本创作台与 Agent 增强使用的文本模型（地址、密钥、模型、协议）。 */
import { reactive, ref, onActivated, onMounted } from 'vue'
import { useMessage, NForm, NFormItem, NInput, NText, NRadioGroup, NRadioButton, NButton, NSpace } from 'naive-ui'
import { normalizeApiBaseUrl } from '@shared/api-url.js'
import SettingsShell from '@renderer/components/shared/SettingsShell.vue'
import RelaySignupLink from '@renderer/components/shared/RelaySignupLink.vue'
import { useCreativeConfig } from '@renderer/components/creative/useCreativeConfig.js'

const message = useMessage()
const { config, saveConfig } = useCreativeConfig()
const form = reactive({ ...config.llm })
const testing = ref(false)

/** 载入已保存的值；处理流程：1、进入页面时用最新配置覆盖表单。 */
const load = () => Object.assign(form, config.llm)

/** 校验并写入；处理流程：1、规范地址并检查必填，2、写入共享配置。 */
const apply = () => {
  // 1、校验。
  try {
    form.baseUrl = normalizeApiBaseUrl(form.baseUrl)
  } catch (error) {
    message.error(error.message)
    return false
  }
  if (!form.apiKey.trim() || !form.model.trim()) {
    message.error('请填写 API 密钥和模型')
    return false
  }
  // 2、写入。
  Object.assign(config.llm, { ...form, apiKey: form.apiKey.trim(), model: form.model.trim() })
  return saveConfig()
}

/** 保存；处理流程：1、写入并提示。 */
const handleSave = () => {
  // 1、存储不可用时提示失败。
  if (apply()) message.success('文本模型设置已保存')
}

/** 测试连接；处理流程：1、保存后发送一条极短请求并展示结果。 */
const handleTest = async () => {
  // 1、先保存当前填写。
  if (!apply()) return
  testing.value = true
  try {
    const result = await window.creativeApi.testLlm({ llm: { ...config.llm } })
    if (result?.success) message.success(`连接成功：${result.data.text || '（空回复）'}`)
    else message.error(`连接失败：${result?.message || '未知错误'}`, { duration: 6000 })
  } finally {
    testing.value = false
  }
}

onMounted(load)
onActivated(load)
</script>

<style scoped src="../../shared/settings-form.css"></style>
