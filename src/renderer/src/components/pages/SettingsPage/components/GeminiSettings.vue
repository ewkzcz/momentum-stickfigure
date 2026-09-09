<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="120px"
    class="settings-form"
  >
    <n-form-item label="中转站地址" path="baseUrl" required>
      <n-input
        :value="config.baseUrl"
        @update:value="value => emit('update-field', 'baseUrl', value)"
        placeholder="请输入中转站地址"
      />
    </n-form-item>

    <n-form-item label="API 密钥" path="apiKey" required>
      <n-input
        :value="config.apiKey"
        @update:value="value => emit('update-field', 'apiKey', value)"
        type="password"
        placeholder="请输入 API 密钥"
        show-password-on="click"
      />
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          用于调用纳米香蕉生图服务的API密钥
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="保存根目录" path="projectRoot">
      <n-input-group>
        <n-input
          :value="config.projectRoot"
          @update:value="value => emit('update-field', 'projectRoot', value)"
          placeholder="请选择项目文件存储的绝对路径"
          readonly
          :style="{ flex: 1 }"
        />
        <n-button
          type="primary"
          @click="emit('select-project-root')"
          :loading="isSelectingFolder"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          选择文件夹
        </n-button>
        <n-button
          @click="emit('reset-project-root')"
          title="重置为默认路径"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          必须是绝对路径，用于存储所有生成文件和日志的根目录。点击"重置"恢复
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="图片保存路径" path="outputDir">
      <n-input
        :value="config.outputDir"
        @update:value="value => emit('update-field', 'outputDir', value)"
        placeholder="图片保存路径"
      />
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          相对于项目根路径，用于保存生成和编辑的图片，例如：output
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="日志路径" path="logDir">
      <n-input
        :value="config.logDir"
        @update:value="value => emit('update-field', 'logDir', value)"
        placeholder="日志文件路径"
      />
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          相对于项目根路径，例如：logs
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
/** Gemini 生图设置表单：展示父级配置并转发输入、路径与重置事件。 */
defineProps({
  config: { type: Object, required: true },
  isSelectingFolder: { type: Boolean, default: false }
})

const emit = defineEmits(['update-field', 'select-project-root', 'reset-project-root'])
</script>

<style scoped>
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}

</style>
