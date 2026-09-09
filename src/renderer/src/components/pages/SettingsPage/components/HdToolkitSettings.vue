<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="160px"
    class="settings-form"
  >
    <!-- Python 解释器路径 -->
    <n-form-item label="Python 解释器路径" path="pythonHome">
      <n-input-group>
        <n-input
          :value="config.pythonHome"
          placeholder="请选择 python.exe 文件路径"
          readonly
          :style="{ flex: 1 }"
          @update:value="value => emit('update-field', 'pythonHome', value)"
        />
        <n-button
          type="primary"
          @click="emit('select-python-path')"
          :loading="isSelectingPython"
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
          Python可执行文件路径，例如：E:\...\hd-remove_bg\python-env\python3\python.exe
        </n-text>
      </template>
    </n-form-item>

    <!-- 去背景模型权重目录 -->
    <n-form-item label="去背景模型权重目录" path="removebgWeightsDir">
      <n-input-group>
        <n-input
          :value="config.removebgWeightsDir"
          placeholder="请选择去背景模型权重目录"
          readonly
          :style="{ flex: 1 }"
          @update:value="value => emit('update-field', 'removebgWeightsDir', value)"
        />
        <n-button
          type="primary"
          @click="emit('select-removebg-weights-path')"
          :loading="isSelectingRemovebgWeights"
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
          例如 weights/removebg
        </n-text>
      </template>
    </n-form-item>

    <!-- 高清模型权重目录 -->
    <n-form-item label="高清模型权重目录" path="highresWeightsDir">
      <n-input-group>
        <n-input
          :value="config.highresWeightsDir"
          placeholder="请选择高清模型权重目录"
          readonly
          :style="{ flex: 1 }"
          @update:value="value => emit('update-field', 'highresWeightsDir', value)"
        />
        <n-button
          type="primary"
          @click="emit('select-highres-weights-path')"
          :loading="isSelectingHighresWeights"
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
          例如 weights/highres
        </n-text>
      </template>
    </n-form-item>

    <!-- 输出图片保存目录 -->
    <n-form-item label="输出图片保存目录" path="outputDir">
      <n-input-group>
        <n-input
          :value="config.outputDir"
          placeholder="请选择输出图片保存目录"
          readonly
          :style="{ flex: 1 }"
          @update:value="value => emit('update-field', 'outputDir', value)"
        />
        <n-button
          type="primary"
          @click="emit('select-output-path')"
          :loading="isSelectingOutput"
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
          处理后的图片将保存到此目录
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
import { defineProps, defineEmits } from 'vue'

defineProps({
  config: { type: Object, required: true },
  isSelectingPython: Boolean,
  isSelectingRemovebgWeights: Boolean,
  isSelectingHighresWeights: Boolean,
  isSelectingOutput: Boolean
})

const emit = defineEmits([
  'update-field',
  'select-python-path',
  'select-removebg-weights-path',
  'select-highres-weights-path',
  'select-output-path'
])
</script>
