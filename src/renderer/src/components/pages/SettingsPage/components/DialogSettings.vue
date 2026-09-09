<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="140px"
    class="settings-form"
  >
    <!-- 图片保存目录 -->
    <n-form-item label="图片保存目录" path="outputRoot">
      <n-input-group>
        <n-input
          :value="config.outputRoot"
          @update:value="value => emit('update-field', 'outputRoot', value)"
          placeholder="请选择对话框图片保存的根目录"
          readonly
          :style="{ flex: 1 }"
        />
        <n-button
          type="primary"
          @click="emit('select-output-folder')"
          :loading="isSelectingFolder"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          浏览
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          对话框图片将保存到此目录
        </n-text>
      </template>
    </n-form-item>

    <!-- 自动创建日期文件夹 -->
    <n-form-item label="自动创建日期文件夹" path="createDateFolder">
      <n-switch
        :value="config.createDateFolder"
        @update:value="value => emit('update-field', 'createDateFolder', value)"
      >
        <template #checked>
          开启
        </template>
        <template #unchecked>
          关闭
        </template>
      </n-switch>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          开启后，图片将保存到以日期命名的子文件夹中（例如：2024-01-01）
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
/** 对话插件设置表单：展示父级配置并转发字段、目录选择事件。 */
defineProps({
  config: { type: Object, required: true },
  isSelectingFolder: { type: Boolean, default: false }
})

const emit = defineEmits(['update-field', 'select-output-folder'])
</script>

<style scoped>
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
