<template>
  <div class="settings-page">
    <div class="page-content">
      <div class="settings-tab-content">
        <div class="settings-content">
          <slot />
        </div>
      </div>
    </div>
    <footer class="open-source-footer">
      <span class="open-source-description">
        如果这个项目对你有帮助，欢迎 Star ⭐ 支持，也欢迎二次开发、提交 Issue 或 PR 一起改进。
        <a
          class="open-source-link"
          :href="OPEN_SOURCE_URL"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开 GitHub 开源仓库"
          title="打开 GitHub 开源仓库"
          @click="openRepository"
        ><span aria-hidden="true">↗</span></a>
      </span>
    </footer>
  </div>
</template>

<script setup>
/** 设置子页面外壳：与设置页相同的布局、滚动区域和底部开源说明，供独立路由的设置子页面使用。 */
import { useMessage } from 'naive-ui'

const OPEN_SOURCE_URL = 'https://github.com/ewkzcz/momentum-stickfigure'
const message = useMessage()

/** 打开开源仓库；处理流程：1、用系统浏览器打开，失败时提示。 */
const openRepository = async (event) => {
  // 1、与设置页底部链接行为一致。
  if (!window.electronAPI?.shell?.openExternal) return
  event.preventDefault()
  try {
    const result = await window.electronAPI.shell.openExternal(OPEN_SOURCE_URL)
    if (!result?.success) message.error('打开开源仓库失败，请稍后重试')
  } catch {
    message.error('打开开源仓库失败，请稍后重试')
  }
}
</script>

<style scoped src="../pages/SettingsPage/SettingsPage.css"></style>
