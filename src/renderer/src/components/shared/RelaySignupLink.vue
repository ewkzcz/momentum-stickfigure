<template>
  <div class="relay-signup">
    <n-button size="tiny" secondary type="primary" @click="openSignup">对接中转站</n-button>
    <n-text depth="3" class="relay-hint">没有可用的中转站时可在此注册；本软件仅提供接口对接能力，服务由第三方提供。</n-text>
  </div>
</template>

<script setup>
/** 对接中转站按钮：放在填写 API 密钥的位置下方，点击后用系统浏览器打开中转站注册页。 */
import { useMessage, NButton, NText } from 'naive-ui'
import { RELAY_SIGNUP_URL } from '@renderer/config/relay-service.js'

const message = useMessage()

/** 打开注册页；处理流程：1、交给主进程用系统浏览器打开，失败时提示。 */
const openSignup = async () => {
  // 1、主进程只允许 http/https 链接。
  try {
    await window.electronAPI.shell.openExternal(RELAY_SIGNUP_URL)
  } catch (error) {
    message.error(`打开失败：${error.message}`)
  }
}
</script>

<style scoped>
.relay-signup {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
}

.relay-hint {
  font-size: 12px;
}
</style>
