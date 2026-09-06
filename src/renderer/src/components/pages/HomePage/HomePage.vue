<template>
  <div
    class="home-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 200 } }"
  >
    <!-- 欢迎区域 -->
    <div
      class="welcome-section motion-gradient"
      v-motion
      :initial="{ opacity: 0, scale: 1.1 }"
      :enter="{ opacity: 1, scale: 1, transition: { duration: 300 } }"
    >
      <div class="welcome-overlay"></div>
      <div
        class="welcome-content"
        v-motion
        :initial="{ opacity: 0, y: 50 }"
        :enter="{ opacity: 1, y: 0, transition: { duration: 250, delay: 100 } }"
      >
        <h1
          class="welcome-title"
          v-motion
          :initial="{ opacity: 0, scale: 0.8 }"
          :enter="{ opacity: 1, scale: 1, transition: { duration: 250, delay: 200 } }"
        >
          欢迎使用时刻简笔画工具箱
        </h1>
        <p
          class="welcome-subtitle"
          v-motion
          :initial="{ opacity: 0, y: 20 }"
          :enter="{ opacity: 1, y: 0, transition: { duration: 200, delay: 300 } }"
        >
        简笔画人物调整插件；纳米香蕉生图插件；多视角排版插件；人物对话插件；幻想框插件；抠图高清插件；视频字幕提取插件；
        </p>
      </div>
    </div>

    <!-- 功能卡片区域 -->
    <div
      class="main-content"
      v-motion
      :initial="{ opacity: 0, y: 60 }"
      :enter="{ opacity: 1, y: 0, transition: { duration: 250, delay: 350 } }"
    >
      <!-- 功能介绍卡片 -->
      <div class="cards-grid">
        <div
          v-for="(card, index) in featureCards"
          :key="card.id"
          class="feature-card motion-card"
          v-motion
          :initial="{ opacity: 0, y: 30 }"
          :enter="{
            opacity: 1,
            y: 0,
            transition: { duration: 200, delay: 400 + index * 50 }
          }"
          :hovered="{ y: -4, scale: 1.02 }"
        >
          <div class="card-icon">{{ card.icon }}</div>
          <h3 class="card-title">{{ card.title }}</h3>
          <p class="card-description">{{ card.description }}</p>
          <button
            class="card-action modern-btn modern-btn--secondary"
            @click="navigateToPage(card.route)"
            v-motion
            :hovered="{ scale: 1.05 }"
            :tapped="{ scale: 0.95 }"
          >
            {{ card.actionText }}
          </button>
        </div>
      </div>

    </div>
  </div>
</template>

<script setup>
/** 首页：展示可用工具入口，并根据当前主题生成主题标签。 */
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useTheme } from '../../../utils/composables/useTheme'

const router = useRouter()
const { currentTheme } = useTheme()

// 主题标签
const themeLabel = computed(() => currentTheme.value === 'dark' ? '深色主题' : '浅色主题')

// 功能卡片数据
const featureCards = [
  {
    id: 'action-expression',
    title: '简笔画人物调整',
    icon: '😊',
    description: '快速调整简笔画人物动作和表情',
    actionText: '开始调整',
    route: '/action-expression'
  },
  {
    id: 'generate',
    title: '纳米香蕉生图',
    icon: '🎨',
    description: '当前最热门的AI图片生成和编辑工具',
    actionText: '开始生图',
    route: '/generate'
  },
  {
    id: 'comic',
    title: '多视角排版',
    icon: '📖',
    description: '快速制作多视角排版',
    actionText: '开始制作',
    route: '/comic'
  },
  {
    id: 'fantasy-frame',
    title: '幻想框',
    icon: '✨',
    description: '为画面添加各种风格的幻想框装饰效果',
    actionText: '开始制作',
    route: '/dialog-frame'
  },
  {
    id: 'character-dialogue',
    title: '人物对话',
    icon: '💬',
    description: '快速为人物添加对话气泡和对话内容',
    actionText: '开始使用',
    route: '/dialog'
  },
  {
    id: 'hd-toolkit',
    title: '抠图高清',
    icon: '🪄',
    description: '专业抠图和图片高清放大处理',
    actionText: '开始使用',
    route: '/hd-toolkit'
  },
  {
    id: 'video-subtitle-ocr',
    title: '视频字幕提取',
    icon: '📝',
    description: '高精度提取视频字幕，支持AI智能纠错',
    actionText: '开始提取',
    route: '/video-subtitle-ocr'
  },
  {
    id: 'settings',
    title: '设置',
    icon: '⚙️',
    description: '配置 API 密钥、导出目录和快捷键',
    actionText: '打开设置',
    route: '/settings'
  }
]

/**
 * 导航到首页功能卡片对应的页面。
 * 处理流程：1、排除首页自身；2、交给路由切换页面。
 */
const navigateToPage = (route) => {
  // 1、避免重复导航到当前首页。
  if (route !== '/home') {
    // 2、打开功能卡片指定的页面。
    router.push(route)
  }
}
</script>

<style scoped src="./HomePage.css"></style>
