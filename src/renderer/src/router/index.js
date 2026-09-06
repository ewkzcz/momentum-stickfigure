/** 页面路由：声明欢迎页、创作工具和设置入口，通过哈希路由支持本地应用加载。 */
import { createRouter, createWebHashHistory } from 'vue-router'

// 直接导入组件 - 解决打包后动态导入路径问题
import LoginPage from '../components/pages/LoginPage/LoginPage.vue'
import HomePage from '../components/pages/HomePage/HomePage.vue'
import ImageProcessingPage from '../components/pages/GeneratePage/GeneratePage.vue'
import AiGeneratePage from '../components/pages/GeneratePage/AiGeneratePage.vue'
import ComicPage from '../components/pages/ComicPage/ComicPage.vue'
import ActionExpressionPage from '../components/pages/ActionExpressionPage/ActionExpressionPage.vue'
import DialogPage from '../components/pages/DialogPage/DialogPage.vue'
import DialogFramePage from '../components/pages/DialogFramePage/DialogFramePage.vue'
import SettingsPage from '../components/pages/SettingsPage/SettingsPage.vue'
import HdToolkitPage from '../components/pages/HdToolkitPage/HdToolkitPage.vue'
import VideoSubtitleOcrPage from '../components/pages/VideoSubtitleOcrPage/VideoSubtitleOcrPage.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { 
      path: '/login', 
      name: 'login', 
      component: LoginPage,
    },
    { 
      path: '/', 
      redirect: '/login' 
    },
    { 
      path: '/home', 
      name: 'home', 
      component: HomePage,
      meta: { keepAlive: true }
    },
    { 
      path: '/image-processing', 
      name: 'image-processing', 
      component: ImageProcessingPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/generate', 
      name: 'generate', 
      component: AiGeneratePage,
      meta: { keepAlive: true }
    },
    { 
      path: '/hd-toolkit', 
      name: 'hd-toolkit', 
      component: HdToolkitPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/video-subtitle-ocr', 
      name: 'video-subtitle-ocr', 
      component: VideoSubtitleOcrPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/comic', 
      name: 'comic', 
      component: ComicPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/action-expression', 
      name: 'action-expression', 
      component: ActionExpressionPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/dialog', 
      name: 'dialog', 
      component: DialogPage,
      meta: { keepAlive: true }
    },
    { 
      path: '/dialog-frame', 
      name: 'dialog-frame', 
      component: DialogFramePage,
      meta: { keepAlive: true }
    },
    // 设置页面 - 重定向到第一个子页面
    { 
      path: '/settings', 
      redirect: '/settings/stickfigure'
    },
    // 设置子页面
    { 
      path: '/settings/stickfigure', 
      name: 'settings-stickfigure', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'stickfigure' }
    },
    { 
      path: '/settings/hotkeys', 
      name: 'settings-hotkeys', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'hotkeys' }
    },
    { 
      path: '/settings/gemini', 
      name: 'settings-gemini', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'gemini' }
    },
    { 
      path: '/settings/hd-toolkit', 
      name: 'settings-hd-toolkit', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'hd-toolkit' }
    },
    { 
      path: '/settings/dialog', 
      name: 'settings-dialog', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'dialog' }
    },
    { 
      path: '/settings/about', 
      name: 'settings-about', 
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'about' }
    },
    {
      path: '/settings/tutorial',
      name: 'settings-tutorial',
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'tutorial' }
    },
    {
      path: '/settings/qq-group',
      name: 'settings-qq-group',
      component: SettingsPage,
      meta: { keepAlive: true, settingsTab: 'qq-group' }
    }
  ]
})

export default router
