<template>
  <div class="upload-section">
    <n-upload
      ref="uploadRef"
      :show-file-list="false"
      accept=".psd"
      :custom-request="handleCustomRequest"
      @change="handleChange"
    >
      <n-upload-dragger>
        <div class="upload-content">
          <n-icon size="48" class="upload-icon">
            <span>📁</span>
          </n-icon>
          <n-text class="upload-title">
            拖拽PSD文件或点击选择
          </n-text>
          <n-text depth="3" class="upload-subtitle">
            支持PSD格式文件，自动解析图层结构
          </n-text>
        </div>
      </n-upload-dragger>
    </n-upload>
    
    <!-- 上传提示 -->
    <div class="upload-hints">
      <n-text depth="3" class="hint-text">
        💡 建议上传包含明确命名的图层文件，如"前手"、"后手"、"表情"等
      </n-text>
    </div>
  </div>
</template>

<script setup>
/** PSD 上传入口：校验本地文件并把有效文件交给父组件解析。 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'

const message = useMessage()
const uploadRef = ref(null)

const emits = defineEmits(['file-selected'])

/**
 * 处理上传控件的自定义文件请求。
 * 处理流程：
 * 1、检查 PSD 扩展名。
 * 2、限制文件大小不超过三百兆字节。
 * 3、发送文件事件并完成控件状态，异常时标记失败。
 */
const handleCustomRequest = ({ file, onFinish, onError }) => {
  try {
    // 1、验证文件类型。
    if (!file.name.toLowerCase().endsWith('.psd')) {
      message.error('请选择PSD文件')
      onError()
      return
    }
    
    // 2、验证文件大小（300MB 限制）。
    if (file.file.size > 300 * 1024 * 1024) {
      message.error('文件大小不能超过300MB')
      onError()
      return
    }
    
    // 3、发送文件选择事件并通知上传控件完成。
    emits('file-selected', file.file)
    onFinish()
    
  } catch (error) {
    console.error('文件处理失败:', error)
    message.error('文件处理失败，请重试')
    onError()
  }
}

/**
 * 记录上传列表变化。
 * 处理流程：
 * 1、输出变更文件及当前列表供排查上传状态。
 */
const handleChange = ({ file, fileList }) => {
  // 1、记录上传控件传入的变化信息。
  console.log('文件变更:', file, fileList)
}
</script>

<style scoped>
.upload-section {
  margin-bottom: var(--theme-spacing-xl);
}

.upload-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--theme-spacing-md);
  padding: var(--theme-spacing-xl);
}

.upload-icon {
  opacity: 0.7;
  color: var(--theme-foreground-secondary);
}

.upload-title {
  font-size: var(--theme-font-lg);
  font-weight: 500;
}

.upload-subtitle {
  font-size: var(--theme-font-sm);
  text-align: center;
}

.upload-hints {
  margin-top: var(--theme-spacing-lg);
  padding: var(--theme-spacing-md);
  background: var(--theme-background-secondary);
  border-radius: var(--theme-border-radius);
  border: 1px solid var(--theme-border);
}

.hint-text {
  display: block;
  font-size: var(--theme-font-sm);
  line-height: 1.5;
}

/* 深色模式适配 */
.theme-dark .upload-hints {
  background: var(--theme-background-accent);
}

/* 响应式设计 */
@media (max-width: 768px) {
  .upload-content {
    padding: var(--theme-spacing-lg);
  }
}
</style>
