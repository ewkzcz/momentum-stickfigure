<template>
  <div class="studio-page video-studio">
    <aside class="history-column">
      <GenerationHistoryPanel kind="video" />
    </aside>
    <n-tabs v-model:value="tab" type="line" class="studio-tabs" pane-class="studio-pane">
      <n-tab-pane name="direct" tab="直接生成" display-directive="show">
        <VideoGenerateComponent />
      </n-tab-pane>
      <n-tab-pane name="agent" tab="Agent 增强" display-directive="show">
        <CreativeAgentPanel mode="video" @handoff="tab = 'agent'" />
      </n-tab-pane>
    </n-tabs>
  </div>
</template>

<script setup>
/** 视频创作台：左侧生成记录，右侧“直接生成”与“Agent 增强”，参数与 AI视频设置共用。 */
import { ref } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import CreativeAgentPanel from '@renderer/components/creative/CreativeAgentPanel.vue'
import GenerationHistoryPanel from '@renderer/components/creative/GenerationHistoryPanel.vue'
import VideoGenerateComponent from '../GeneratePage/components/VideoGenerateComponent.vue'

const tab = ref('direct')
</script>

<style scoped src="@renderer/components/creative/studio-page.css"></style>
<style scoped>
.video-studio {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 16px;
  padding-top: 16px;
}

.history-column {
  min-height: 0;
  overflow: hidden;
}
</style>
