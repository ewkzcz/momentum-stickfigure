<template>
  <div class="studio-page">
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
/** AI 视频创作入口：默认直接填写参数生成；“Agent 增强”结合视频类 Skills 写提示词并提交任务。 */
import { ref } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import CreativeAgentPanel from '@renderer/components/creative/CreativeAgentPanel.vue'
import VideoGenerateComponent from '../GeneratePage/components/VideoGenerateComponent.vue'

const tab = ref('direct')

</script>

<style scoped src="@renderer/components/creative/studio-page.css"></style>
