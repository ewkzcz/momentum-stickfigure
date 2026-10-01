<template>
  <n-form label-placement="left" label-width="96px" size="small" class="settings-form">
    <n-grid :cols="2" :x-gap="16">
      <n-form-item-gi label="剧名">
        <n-input v-model:value="project.title" placeholder="暂定名" />
      </n-form-item-gi>
      <n-form-item-gi label="作品类型">
        <n-select :value="project.type" :options="typeOptions" @update:value="changeType" />
      </n-form-item-gi>
      <n-form-item-gi label="题材">
        <n-input v-model:value="project.genre" placeholder="如：重生复仇 + 甜宠、悬疑刑侦、校园成长" />
      </n-form-item-gi>
      <n-form-item-gi label="目标受众">
        <n-input v-model:value="project.audience" placeholder="如：女频 25-40 岁、男频、全年龄" />
      </n-form-item-gi>
      <n-form-item-gi label="基调">
        <n-input v-model:value="project.tone" placeholder="如：爽燃、甜虐、轻喜剧、暗黑" />
      </n-form-item-gi>
      <n-form-item-gi :label="`${unit}数 / 字数`">
        <n-space :size="8" :wrap="false">
          <n-input-number v-model:value="project.episodeCount" :min="1" :max="300" :precision="0" style="width: 110px;" />
          <n-input-number v-model:value="project.wordsPerEpisode" :min="200" :max="20000" :step="100" :precision="0" style="width: 130px;" />
        </n-space>
      </n-form-item-gi>
    </n-grid>

    <n-form-item label="系统提示词">
      <div class="full-width">
        <n-input v-model:value="project.systemPrompt" type="textarea" :autosize="{ minRows: 8, maxRows: 18 }" placeholder="完整的系统提示词：设定 AI 的编剧身份、风格、格式和规则" />
        <n-space justify="space-between" class="hint-row">
          <n-text depth="3" class="hint">每次生成都会作为系统提示词发送；启用的剧本 Skills 会追加在它后面。</n-text>
          <n-button size="tiny" quaternary @click="resetPrompt">恢复默认</n-button>
        </n-space>
      </div>
    </n-form-item>

    <n-form-item label="补充要求">
      <n-input v-model:value="project.requirements" type="textarea" :autosize="{ minRows: 3, maxRows: 10 }" placeholder="创作灵感、必须出现的情节、禁区、参考作品、平台规范等，会放进每次生成的上下文" />
    </n-form-item>

    <n-form-item label="剧本 Skills">
      <div class="full-width">
        <n-checkbox-group v-model:value="project.skillIds">
          <n-space>
            <n-checkbox v-for="skill in skills" :key="skill.id" :value="skill.id" :label="skill.name" />
          </n-space>
        </n-checkbox-group>
        <n-text v-if="!skills.length" depth="3" class="hint">没有已启用的剧本 Skill，请到「设置 → Skills设置」安装并启用。</n-text>
      </div>
    </n-form-item>
  </n-form>
</template>

<script setup>
/** 剧本项目设定表单：作品类型、题材受众、规模、完整系统提示词、补充要求和本项目使用的 Skills。 */
import { computed, inject } from 'vue'
import { useDialog, NForm, NFormItem, NFormItemGi, NGrid, NInput, NSelect, NInputNumber, NSpace, NText, NButton, NCheckboxGroup, NCheckbox } from 'naive-ui'
import { PROJECT_TYPES, DEFAULT_SYSTEM_PROMPTS, unitOf } from '../composables/scriptPrompts.js'

// 状态由 ScriptStudioPage 通过 provide 提供，本组件直接编辑当前项目。
const { project, scriptSkills: skills } = inject('scriptStudio')

const dialog = useDialog()
const typeOptions = PROJECT_TYPES.map((item) => ({ label: item.label, value: item.value }))
const unit = computed(() => unitOf(project.value))

/** 切换类型；处理流程：1、系统提示词仍是默认值时一并切换，否则询问。 */
const changeType = (type) => {
  // 1、用户改过的提示词不静默覆盖。
  const isDefault = Object.values(DEFAULT_SYSTEM_PROMPTS).includes(project.value.systemPrompt)
  project.value.type = type
  if (isDefault) project.value.systemPrompt = DEFAULT_SYSTEM_PROMPTS[type]
  else {
    dialog.info({
      title: '切换系统提示词？',
      content: '你修改过系统提示词。是否替换为新类型的默认提示词？',
      positiveText: '替换',
      negativeText: '保留',
      onPositiveClick: () => { project.value.systemPrompt = DEFAULT_SYSTEM_PROMPTS[type] }
    })
  }
}

/** 恢复默认提示词；处理流程：1、按当前类型重置。 */
const resetPrompt = () => {
  // 1、恢复操作可撤销（用户可再改）。
  project.value.systemPrompt = DEFAULT_SYSTEM_PROMPTS[project.value.type]
}
</script>

<style scoped>
.settings-form {
  max-width: 980px;
}

.full-width {
  width: 100%;
}

.hint-row {
  margin-top: 4px;
}

.hint {
  font-size: 12px;
}
</style>
