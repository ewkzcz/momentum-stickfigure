<template>
  <div class="usage-example">
    <div v-for="(line, index) in example.dialog" :key="index" :class="['example-line', `line-${line.role}`]">
      <span class="line-role">{{ ROLE_LABELS[line.role] }}</span>
      <span class="line-text">{{ line.text }}</span>
    </div>
    <n-space v-if="selectable && example.tryPrompts" :size="6" class="try-prompts">
      <n-text depth="3">试试这样说：</n-text>
      <n-tag v-for="prompt in example.tryPrompts" :key="prompt" size="small" checkable :checked="false" @click="emit('pick', prompt)">{{ prompt }}</n-tag>
    </n-space>
  </div>
</template>

<script setup>
/** Skill 使用示例：用一段示意对话展示“用户怎么说、Agent 怎么用 Skill”；可点击示例句子填入输入框。 */
import { computed } from 'vue'
import { NSpace, NText, NTag } from 'naive-ui'
import { USAGE_EXAMPLES } from './skillGuide.js'

const props = defineProps({
  mode: { type: String, required: true },
  selectable: { type: Boolean, default: false }
})
const emit = defineEmits(['pick'])

const ROLE_LABELS = { user: '你', skill: 'Skill', prompt: '提示词', result: '结果', assistant: 'Agent' }
const example = computed(() => USAGE_EXAMPLES[props.mode])
</script>

<style scoped>
.usage-example {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  line-height: 1.6;
}

.example-line {
  display: flex;
  gap: 8px;
}

.line-role {
  flex-shrink: 0;
  width: 44px;
  text-align: right;
  opacity: 0.6;
}

.line-user .line-text {
  font-weight: 600;
}

.line-skill .line-text,
.line-result .line-text {
  opacity: 0.7;
}

.line-prompt .line-text {
  padding-left: 8px;
  border-left: 2px solid #2080f0;
}

.try-prompts {
  margin-top: 6px;
}
</style>
