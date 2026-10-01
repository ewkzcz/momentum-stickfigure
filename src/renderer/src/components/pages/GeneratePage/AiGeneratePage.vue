<template>
  <div
    class="generate-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 500 } }"
  >
    <div class="page-content">
      <aside class="history-column">
        <GenerationHistoryPanel kind="image" />
      </aside>
      <n-tabs
        v-model:value="activeTab"
        type="card"
        class="generate-tabs"
        @update:value="handleTabChange"
      >
        <n-tab-pane name="generate" tab="直接生成" display-directive="show">
          <ImageGenerateComponent ref="imageGenerateRef" />
        </n-tab-pane>
        <n-tab-pane name="agent" tab="Agent 增强" display-directive="show">
          <div class="agent-tab-wrapper">
            <CreativeAgentPanel mode="image" @handoff="activeTab = 'agent'" />
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup>
/** AI 生图页：左侧生成记录，右侧“直接生成”与“Agent 增强”两种方式，参数共用。 */
import { ref } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import ImageGenerateComponent from './components/ImageGenerateComponent.vue'
import CreativeAgentPanel from '@renderer/components/creative/CreativeAgentPanel.vue'
import GenerationHistoryPanel from '@renderer/components/creative/GenerationHistoryPanel.vue'

const activeTab = ref('generate')
const imageGenerateRef = ref(null)

/** 切换标签；处理流程：1、回到直接生成时恢复默认比例。 */
const handleTabChange = (value) => {
  // 1、与原有行为一致。
  if (value === 'generate' && imageGenerateRef.value) imageGenerateRef.value.resetAspectRatio()
}
</script>

<style scoped src="./AiGeneratePage.css"></style>
