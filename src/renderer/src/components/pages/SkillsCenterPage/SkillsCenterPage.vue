<template>
  <div class="skills-page">
    <div class="skills-columns">
      <div class="skills-left">
        <n-card title="文本模型" size="small">
          <template #header-extra><n-text depth="3">剧本创作台与图片/视频 Agent 共用</n-text></template>
          <n-form label-placement="left" label-width="80px" size="small">
            <n-form-item label="接口地址">
              <n-input v-model:value="config.llm.baseUrl" placeholder="https://api.aixoras.com" />
            </n-form-item>
            <n-form-item label="API 密钥">
              <n-input v-model:value="config.llm.apiKey" type="password" show-password-on="click" placeholder="文本模型的 API 密钥（仅保存在本机）" />
            </n-form-item>
            <n-form-item label="模型">
              <n-input v-model:value="config.llm.model" placeholder="例如 gpt-5.5、deepseek-chat，由平台分配" />
            </n-form-item>
            <n-form-item label="协议">
              <n-radio-group v-model:value="config.llm.protocol">
                <n-radio-button value="chat">Chat Completions</n-radio-button>
                <n-radio-button value="responses">Responses</n-radio-button>
              </n-radio-group>
            </n-form-item>
            <n-space>
              <n-button type="primary" @click="handleSaveLlm">保存</n-button>
              <n-button :loading="testing" @click="handleTestLlm">测试连接</n-button>
            </n-space>
          </n-form>
        </n-card>

        <n-card title="Skills 文件夹" size="small">
          <n-input-group>
            <n-input :value="config.skillsRoot" readonly placeholder="默认：文稿/MomentumCreative/skills" />
            <n-button type="primary" @click="handleSelectFolder">选择文件夹</n-button>
            <n-button @click="handleResetFolder">默认</n-button>
          </n-input-group>
          <n-space style="margin-top: 12px;">
            <n-button :loading="installing" @click="handleInstall">安装内置 Skills</n-button>
            <n-button :loading="skillsLoading" @click="refreshSkills">刷新</n-button>
          </n-space>
          <n-alert type="info" :show-icon="false" class="skills-help">
            每个 Skill 是文件夹里的一个子目录，里面有 SKILL.md（兼容 Claude/Codex 的 Agent Skills 格式），可附带 references/、assets/ 参考资料。
            从 GitHub 下载的 Skill 目录直接放进来，点“刷新”后手动启用；分类会按名称和描述自动识别，也可在 SKILL.md 头部写 category: image/video/script。
            内置 Skills 来自开源仓库（MIT，含 LICENSE），安装后默认不启用，已存在的同名目录不会被覆盖。
          </n-alert>
          <n-alert v-if="skillsError" type="error" :show-icon="false" class="skills-help">{{ skillsError }}</n-alert>
        </n-card>

        <n-card title="怎么用" size="small">
          <n-steps vertical size="small" :current="USAGE_STEPS.length + 1">
            <n-step v-for="step in USAGE_STEPS" :key="step.title" :title="step.title" :description="step.text" />
          </n-steps>
          <n-divider style="margin: 12px 0;">交互示例</n-divider>
          <n-tabs v-model:value="exampleMode" type="segment" size="small">
            <n-tab name="image">图片 Agent</n-tab>
            <n-tab name="video">视频 Agent</n-tab>
            <n-tab name="script">剧本创作台</n-tab>
          </n-tabs>
          <SkillUsageExample :mode="exampleMode" class="example-box" />
        </n-card>
      </div>

      <n-card size="small" class="skills-right">
        <n-tabs v-model:value="rightTab" type="line" size="small">
          <n-tab-pane name="installed" :tab="`已安装（启用 ${config.enabledSkills.length} / ${skills.length}）`">
        <n-tabs v-model:value="category" type="segment" size="small">
          <n-tab v-for="item in CATEGORY_TABS" :key="item.value" :name="item.value">{{ item.label }}</n-tab>
        </n-tabs>
        <n-empty v-if="!visibleSkills.length" description="没有 Skill，点击“安装内置 Skills”或把 Skill 目录放进文件夹后刷新" class="skills-empty" />
        <div class="skill-list">
          <div v-for="skill in visibleSkills" :key="skill.id" class="skill-item">
            <div class="skill-main">
              <n-space align="center" :size="6">
                <n-text strong>{{ skill.name }}</n-text>
                <n-tag size="tiny" :bordered="false">{{ CATEGORY_LABELS[skill.category] }}</n-tag>
                <n-tag v-if="skill.builtin" size="tiny" type="info" :bordered="false">内置</n-tag>
                <n-tag v-if="skill.error" size="tiny" type="error" :bordered="false">读取失败</n-tag>
              </n-space>
              <n-text depth="3" class="skill-desc">{{ skill.error || skill.description }}</n-text>
              <n-text v-if="skill.source" depth="3" class="skill-source">来源：{{ skill.source }}</n-text>
            </div>
            <n-space align="center" :size="8" class="skill-actions">
              <n-button size="tiny" quaternary @click="openSkill(skill)">查看</n-button>
              <n-switch :value="config.enabledSkills.includes(skill.id)" :disabled="Boolean(skill.error)" @update:value="(value) => toggleSkill(skill.id, value)" />
            </n-space>
          </div>
        </div>
          </n-tab-pane>
          <n-tab-pane name="discover" tab="获取更多 Skills">
            <SkillGuideCard />
          </n-tab-pane>
        </n-tabs>
      </n-card>
    </div>

    <n-drawer v-model:show="drawer.show" :width="560" placement="right">
      <n-drawer-content :title="drawer.title" closable>
        <pre class="skill-content">{{ drawer.content }}</pre>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<script setup>
/** Skills与模型设置（设置菜单下）：配置文本模型，管理 Skills 文件夹、内置 Skills 安装和逐个启用。 */
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import {
  useMessage, NCard, NForm, NFormItem, NInput, NInputGroup, NRadioGroup, NRadioButton, NButton, NSpace, NText, NAlert,
  NTabs, NTab, NTabPane, NTag, NSwitch, NEmpty, NDrawer, NDrawerContent, NSteps, NStep, NDivider
} from 'naive-ui'
import { useCreativeConfig } from '@renderer/components/creative/useCreativeConfig.js'
import SkillGuideCard from '@renderer/components/creative/SkillGuideCard.vue'
import SkillUsageExample from '@renderer/components/creative/SkillUsageExample.vue'
import { USAGE_STEPS } from '@renderer/components/creative/skillGuide.js'

const CATEGORY_TABS = [
  { label: '全部', value: 'all' },
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
  { label: '剧本', value: 'script' },
  { label: '通用', value: 'general' }
]
const CATEGORY_LABELS = { image: '图片', video: '视频', script: '剧本', general: '通用' }

const message = useMessage()
const { config, skills, skillsError, skillsLoading, saveConfig, refreshSkills, toggleSkill } = useCreativeConfig()
const category = ref('all')
const rightTab = ref('installed')
const exampleMode = ref('image')
const testing = ref(false)
const installing = ref(false)
const drawer = reactive({ show: false, title: '', content: '' })

const visibleSkills = computed(() => category.value === 'all' ? skills.value : skills.value.filter((item) => item.category === category.value))

/** 保存文本模型配置；处理流程：1、写入本地存储并提示。 */
const handleSaveLlm = () => {
  // 1、地址末尾斜杠由主进程规范化。
  if (saveConfig()) message.success('文本模型配置已保存')
  else message.error('保存失败：本地存储不可用')
}

/** 测试连接；处理流程：1、保存后发送一条极短请求，2、展示模型回复或错误。 */
const handleTestLlm = async () => {
  // 1、测试使用当前表单值。
  saveConfig()
  testing.value = true
  try {
    const result = await window.creativeApi.testLlm({ llm: { ...config.llm } })
    // 2、反馈结果。
    if (result?.success) message.success(`连接成功：${result.data.text || '（空回复）'}`)
    else message.error(`连接失败：${result?.message || '未知错误'}`, { duration: 6000 })
  } finally {
    testing.value = false
  }
}

/** 选择 Skills 文件夹；处理流程：1、系统对话框授权，2、保存路径并刷新列表。 */
const handleSelectFolder = async () => {
  // 1、授权用途 skills-root 允许在该目录内读取 Skill。
  const result = await window.fileSystem.selectFolder({ purpose: 'skills-root' })
  if (!result?.success || !result.path) {
    if (!result?.canceled) message.error(`选择失败：${result?.error || '未知错误'}`)
    return
  }
  // 2、换目录后启用列表按新目录重新校验。
  config.skillsRoot = result.path
  saveConfig()
  await refreshSkills()
}

/** 恢复默认文件夹；处理流程：1、清空自定义路径，由主进程使用默认目录。 */
const handleResetFolder = async () => {
  // 1、默认目录无需额外授权。
  config.skillsRoot = ''
  saveConfig()
  await refreshSkills()
}

/** 安装内置 Skills；处理流程：1、写入文件夹，2、提示结果并刷新。 */
const handleInstall = async () => {
  // 1、已存在的同名目录跳过。
  installing.value = true
  try {
    const result = await window.creativeApi.installBuiltinSkills({ skillsRoot: config.skillsRoot || undefined })
    if (!result?.success) {
      message.error(`安装失败：${result?.message || '未知错误'}`)
      return
    }
    // 2、提醒用户需要手动启用。
    message.success(`已安装 ${result.data.installed.length} 个，跳过 ${result.data.skipped.length} 个已存在的；请按需手动启用`)
    await refreshSkills()
  } finally {
    installing.value = false
  }
}

/** 查看 Skill 内容；处理流程：1、读取 SKILL.md 正文并在抽屉中展示。 */
const openSkill = async (skill) => {
  // 1、读取失败时展示错误信息。
  const result = await window.creativeApi.readSkill({ skillsRoot: config.skillsRoot || undefined, id: skill.id })
  Object.assign(drawer, {
    show: true,
    title: skill.name,
    content: result?.success ? `${result.data.content}${skill.references?.length ? `\n\n---\n参考资料：\n${skill.references.join('\n')}` : ''}` : result?.message
  })
}

onMounted(refreshSkills)
onActivated(refreshSkills)
</script>

<style scoped>
.skills-page {
  height: 100%;
  overflow: auto;
  padding: 16px;
  background: var(--theme-background);
}

.skills-columns {
  display: grid;
  grid-template-columns: minmax(340px, 420px) 1fr;
  gap: 16px;
  align-items: start;
}

.skills-left {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.skills-help {
  margin-top: 12px;
  font-size: 12px;
  line-height: 1.6;
}

.example-box {
  margin-top: 10px;
}

.skills-empty {
  padding: 40px 0;
}

.skill-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
}

.skill-item {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
}

.skill-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.skill-desc {
  font-size: 12px;
  line-height: 1.5;
}

.skill-source {
  font-size: 11px;
}

.skill-actions {
  flex-shrink: 0;
}

.skill-content {
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 13px;
  line-height: 1.6;
  font-family: inherit;
}
</style>
