<template>
  <div class="skill-guide">
    <n-tabs v-model:value="category" type="segment" size="small">
      <n-tab v-for="item in CATEGORY_TABS" :key="item.value" :name="item.value">{{ item.label }}</n-tab>
    </n-tabs>
    <div class="guide-list">
      <div v-for="item in visible" :key="item.repo" class="guide-item">
        <div class="guide-main">
          <n-space align="center" :size="6">
            <n-text strong>{{ item.name }}</n-text>
            <n-tag v-if="item.builtin" size="tiny" type="info" :bordered="false">已内置</n-tag>
            <n-tag size="tiny" :bordered="false">{{ item.license }}</n-tag>
            <n-text v-if="item.stars" depth="3" class="guide-meta">★ {{ item.stars }}</n-text>
          </n-space>
          <n-text depth="3" class="guide-note">{{ item.note }}</n-text>
          <n-text depth="3" class="guide-meta">仓库：github.com/{{ item.repo }} · 放入目录：{{ item.folder }}</n-text>
        </div>
        <n-button size="tiny" @click="openRepo(item.repo)">打开 GitHub</n-button>
      </div>
    </div>
    <n-text depth="3" class="guide-meta">许可证“未声明”的仓库仅供个人学习使用，请勿二次分发其内容。</n-text>
  </div>
</template>

<script setup>
/** 获取更多 Skills：列出成熟的开源 Skill 仓库，点击在系统浏览器中打开，下载后放进 Skills 文件夹。 */
import { ref, computed } from 'vue'
import { useMessage, NTabs, NTab, NSpace, NText, NTag, NButton } from 'naive-ui'
import { RECOMMENDED_SKILLS } from './skillGuide.js'

const CATEGORY_TABS = [
  { label: '图片', value: 'image' },
  { label: '视频', value: 'video' },
  { label: '剧本', value: 'script' },
  { label: '通用', value: 'general' }
]
const message = useMessage()
const category = ref('image')
const visible = computed(() => RECOMMENDED_SKILLS.filter((item) => item.category === category.value))

/** 打开仓库；处理流程：1、交给主进程用系统浏览器打开（仅允许 https）。 */
const openRepo = async (repo) => {
  // 1、失败时提示。
  try {
    await window.electronAPI.shell.openExternal(`https://github.com/${repo}`)
  } catch (error) {
    message.error(`打开失败：${error.message}`)
  }
}
</script>

<style scoped>
.skill-guide {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.guide-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.guide-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
}

.guide-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.guide-note {
  font-size: 12px;
}

.guide-meta {
  font-size: 11px;
}
</style>
