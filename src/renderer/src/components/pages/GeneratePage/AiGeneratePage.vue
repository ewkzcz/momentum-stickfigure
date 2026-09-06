<template>
  <div 
    class="generate-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 500 } }"
  >
    <div class="page-content">
      <!-- 功能选择标签页 -->
      <n-tabs 
        v-model:value="activeTab" 
        type="card" 
        class="generate-tabs"
        @update:value="handleTabChange"
      >
        <n-tab-pane name="generate" tab="谷歌中转" display-directive="show">
          <ImageGenerateComponent ref="imageGenerateRef" @generated="handleGenerated" @edited="handleEdited" />
        </n-tab-pane>
        <n-tab-pane name="log" tab="谷歌日志" display-directive="show">
          <GenerationLogComponent @rerun="handleRerun" />
        </n-tab-pane>
        <n-tab-pane name="doubao" tab="豆包" display-directive="show">
          <div class="doubao-tab-wrapper">
            <DoubaoWebComponent :active="activeTab === 'doubao'" />
          </div>
        </n-tab-pane>
        <n-tab-pane name="jimeng" tab="即梦" display-directive="show">
          <div class="jimeng-tab-wrapper">
            <JiMengComponent :active="activeTab === 'jimeng'" />
          </div>
        </n-tab-pane>
        <n-tab-pane name="baidu-rembg" tab="百度抠图" display-directive="show">
          <div class="baidu-tab-wrapper">
            <BaiduRembgComponent :active="activeTab === 'baidu-rembg'" />
          </div>
        </n-tab-pane>
        <n-tab-pane name="koukoutu" tab="扣扣图" display-directive="show">
          <div class="koukoutu-tab-wrapper">
            <KouKouTuComponent :active="activeTab === 'koukoutu'" />
          </div>
        </n-tab-pane>
        <n-tab-pane name="liblib" tab="LibLib" display-directive="show">
          <div class="liblib-tab-wrapper">
            <LibLibComponent :active="activeTab === 'liblib'" />
          </div>
        </n-tab-pane>
      </n-tabs>
    </div>
  </div>
</template>

<script setup>
/** AI 工具聚合页：管理生成工具与第三方网页的标签切换。 */
import { ref } from 'vue'
import { NTabs, NTabPane } from 'naive-ui'
import ImageGenerateComponent from './components/ImageGenerateComponent.vue'
import GenerationLogComponent from './components/GenerationLogComponent.vue'
import DoubaoWebComponent from './components/DoubaoWebComponent.vue'
import BaiduRembgComponent from './components/BaiduRembgComponent.vue'
import KouKouTuComponent from './components/KouKouTuComponent.vue'
import LibLibComponent from './components/LibLibComponent.vue'
import JiMengComponent from './components/JiMengComponent.vue'


// 响应式数据
const activeTab = ref('generate')
const imageGenerateRef = ref(null) // 子组件引用

/**
 * 切换当前工具标签。
 * 处理流程：1、更新活动标签；2、回到生成工具时恢复默认画幅比例。
 */
const handleTabChange = (value) => {
  // 1、记录用户选中的工具标签。
  activeTab.value = value
  
  // 2、切换回生成工具时，将画幅比例重置为 16:9。
  if (value === 'generate' && imageGenerateRef.value) {
    imageGenerateRef.value.resetAspectRatio()
    console.log('切换回谷歌中转，比例已重置为16:9')
  }
}

/**
 * 接收生成完成事件的预留入口。
 * 处理流程：1、当前未设置额外处理，结果由子组件展示。
 */
const handleGenerated = (result) => {}
/**
 * 接收编辑完成事件的预留入口。
 * 处理流程：1、当前未设置额外处理，结果由子组件展示。
 */
const handleEdited = (result) => {}

/**
 * 从生成日志返回生成工具。
 * 处理流程：1、激活生成标签；当前未应用传入的历史配置。
 */
const handleRerun = (config) => {
  // 1、切换到生成工具供用户重新操作。
  activeTab.value = 'generate'
}

</script>

<style scoped src="./AiGeneratePage.css"></style>
