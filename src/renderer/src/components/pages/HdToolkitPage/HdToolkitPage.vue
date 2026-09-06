<template>
  <div class="hd-toolkit-page">
    <n-tabs
      v-model:value="activeTab"
      type="card"
      class="hd-toolkit-main-tabs"
    >
      <n-tab-pane name="remove" tab="抠图" display-directive="show" />
      <n-tab-pane name="highres" tab="高清" display-directive="show" />
    </n-tabs>
    <div class="hd-toolkit-scroll">
      <HdToolkitComponent v-model="activeTab" hide-tabs class="hd-toolkit-component" />
    </div>
  </div>
</template>

<script setup>
/** 抠图高清入口页：通过标签向工具组件传入当前处理模式。 */
import { ref } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import HdToolkitComponent from '../GeneratePage/components/HdToolkitComponent.vue'

const activeTab = ref('remove')
</script>

<style scoped src="./HdToolkitPage.css"></style>
