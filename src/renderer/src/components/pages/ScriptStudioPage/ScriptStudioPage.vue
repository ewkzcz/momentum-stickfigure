<template>
  <div class="script-studio">
    <aside class="studio-sidebar">
      <ScriptSidebar
        :projects="projects"
        :current-id="project?.id || ''"
        :folder="config.projectsRoot"
        @create="createProject"
        @open="openProject"
        @remove="removeProject"
        @select-folder="selectFolder"
      />
    </aside>

    <main class="studio-main">
      <template v-if="project">
        <div class="studio-header">
          <n-space align="center" :size="10">
            <n-text strong class="studio-title">{{ project.title }}</n-text>
            <n-tag size="small" :bordered="false">{{ typeLabel }}</n-tag>
            <n-text depth="3" class="save-state">{{ saveState }}</n-text>
          </n-space>
          <n-space :size="8">
            <n-text v-if="!llmReady" type="warning" class="save-state">未配置文本模型</n-text>
            <n-button size="small" :loading="saving" @click="save">保存</n-button>
            <n-button size="small" @click="exportMarkdown">导出 Markdown</n-button>
          </n-space>
        </div>
        <n-tabs v-model:value="tab" type="line" class="studio-tabs" pane-class="studio-pane" animated>
          <n-tab-pane name="settings" tab="① 项目设定" display-directive="show">
            <ScriptSettingsForm />
          </n-tab-pane>
          <n-tab-pane v-for="(stage, index) in STAGES" :key="stage.key" :name="stage.key" :tab="`${CIRCLED[index + 2]} ${stage.label}`" display-directive="show">
            <ScriptStagePane :stage-key="stage.key" />
          </n-tab-pane>
          <n-tab-pane name="episodes" :tab="`${CIRCLED[STAGES.length + 2]} 正文`" display-directive="show">
            <ScriptEpisodesPane />
          </n-tab-pane>
        </n-tabs>
      </template>
      <n-empty v-else class="studio-empty" description="新建或打开一个剧本项目开始创作">
        <template #extra>
          <n-text depth="3" class="empty-tip">流程：项目设定（含完整系统提示词）→ 故事梗概 → 人物小传 → 世界观与场景 → 分集大纲 → 逐集正文（自动摘要、审稿、转分镜）</n-text>
        </template>
      </n-empty>
    </main>
  </div>
</template>

<script setup>
/** 剧本创作台：层级式创作小说/剧本，项目保存在用户授权的文件夹，生成时注入系统提示词与启用的剧本 Skills。 */
import { ref, computed, provide, onMounted, onActivated } from 'vue'
import { useMessage, NSpace, NText, NTag, NButton, NTabs, NTabPane, NEmpty } from 'naive-ui'
import { useCreativeConfig } from '@renderer/components/creative/useCreativeConfig.js'
import ScriptSidebar from './components/ScriptSidebar.vue'
import ScriptSettingsForm from './components/ScriptSettingsForm.vue'
import ScriptStagePane from './components/ScriptStagePane.vue'
import ScriptEpisodesPane from './components/ScriptEpisodesPane.vue'
import { useScriptStudio } from './composables/useScriptStudio.js'
import { STAGES, PROJECT_TYPES, buildMarkdownExport } from './composables/scriptPrompts.js'

const CIRCLED = ['⓪', '①', '②', '③', '④', '⑤', '⑥', '⑦']
const message = useMessage()
const studio = useScriptStudio(message)
const { config, projects, project, dirty, saving, refreshProjects, createProject, openProject, removeProject, save, selectFolder } = studio
const { refreshSkills } = useCreativeConfig()
const tab = ref('settings')
provide('scriptStudio', studio)

const typeLabel = computed(() => PROJECT_TYPES.find((item) => item.value === project.value?.type)?.label || '')
const llmReady = computed(() => Boolean(config.llm.apiKey && config.llm.model))
const saveState = computed(() => {
  if (studio.generating.value) return '生成中…'
  if (saving.value) return '保存中…'
  return dirty.value ? '有未保存的修改' : '已保存'
})

/** 导出；处理流程：1、先保存，2、写入项目文件夹 exports 子目录。 */
const exportMarkdown = async () => {
  // 1、导出内容与磁盘一致。
  await save()
  const result = await window.creativeApi.exportScript({ projectsRoot: config.projectsRoot || undefined, title: project.value.title, markdown: buildMarkdownExport(project.value) })
  // 2、提示路径。
  if (result?.success) message.success(`已导出：${result.data.path}`, { duration: 5000 })
  else message.error(`导出失败：${result?.message || '未知错误'}`)
}

onMounted(() => { refreshProjects(); refreshSkills() })
onActivated(refreshSkills)
</script>

<style scoped>
.script-studio {
  display: grid;
  grid-template-columns: 240px 1fr;
  gap: 16px;
  height: 100%;
  padding: 16px;
  overflow: hidden;
  background: var(--theme-background);
}

.studio-sidebar {
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  padding-right: 16px;
  border-right: 1px solid var(--theme-border);
}

.studio-main {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}

.studio-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-bottom: 4px;
}

.studio-title {
  font-size: 16px;
}

.save-state {
  font-size: 12px;
}

.studio-tabs {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.studio-tabs :deep(.n-tabs-pane-wrapper),
.studio-tabs :deep(.studio-pane) {
  flex: 1;
  min-height: 0;
  height: 100%;
  overflow: auto;
}

.studio-empty {
  margin: auto;
}

.empty-tip {
  font-size: 12px;
  max-width: 520px;
  display: block;
  text-align: center;
}
</style>
