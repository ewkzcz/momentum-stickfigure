<template>
  <div class="studio-page">
    <VideoGenerateComponent />
  </div>
</template>

<script setup>
/** AI 视频创作入口：填写提示词与参数提交视频任务，轮询完成后预览并保存。 */
import VideoGenerateComponent from '../GeneratePage/components/VideoGenerateComponent.vue'
</script>

<style scoped>
.studio-page {
  height: 100%;
  overflow: auto;
  padding: 8px 16px 16px;
  background: var(--theme-background);
}
</style>
