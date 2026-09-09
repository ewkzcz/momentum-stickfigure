<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="140px"
    class="settings-form"
  >
    <n-alert type="info" style="margin-bottom: 20px;">
      <template #header>
        前手特殊图层说明
      </template>
      <n-text>
        配置前手中的特殊动作图层名称，用于识别双手动作和右手动作。多个名称用顿号、逗号或换行分隔。
      </n-text>
    </n-alert>

    <n-form-item label="前手-双手名称" path="frontHandBothNames">
      <n-input-group>
        <n-input
          :value="config.frontHandBothNames"
          @update:value="value => emit('update-field', 'frontHandBothNames', value)"
          type="textarea"
          placeholder="请输入前手-双手的特殊名称"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-both-names')"
          title="重置为默认值"
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
          前手中的双手动作名称，如：交叉、合十、抱拳、结印、托脸、戳手指、双手抱臂、敲手。请注意中英文标点符号和空格！
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="前手-右手名称" path="frontHandRightNames">
      <n-input-group>
        <n-input
          :value="config.frontHandRightNames"
          @update:value="value => emit('update-field', 'frontHandRightNames', value)"
          type="textarea"
          placeholder="请输入前手-右手的特殊名称"
          :autosize="{ minRows: 3, maxRows: 5 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-right-names')"
          title="重置为默认值"
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
          前手中的右手动作名称，如：伏案右、拍胸、端起、捂嘴右、拎东西、扶着头、摸头右（2）、举手右、托腮（2）、擦汗、拳胸、吃东西动作、后手举起、单手结印、擦泪、比枪等。请注意中英文标点符号和空格！
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
/** 前手特殊图层表单：只展示父级配置并转发输入和重置事件，保存内容由父级插槽提供。 */
defineProps({
  config: { type: Object, required: true }
})

const emit = defineEmits(['update-field', 'reset-both-names', 'reset-right-names'])
</script>

<style scoped>
/* 根表单继承父级作用域，父级 :deep 规则继续生效；普通后代规则需在此保留。 */
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
