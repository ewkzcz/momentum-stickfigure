<template>
  <div class="layout-shell">
    <!-- 顶部导航栏 --> 
    <div
      class="app-header"
      v-motion
      :initial="{ y: -100, opacity: 0 }"
      :enter="{ y: 0, opacity: 1, transition: { duration: 300 } }"
    >
      <!-- 一级导航菜单 -->
      <nav class="primary-nav">
        <div
          v-for="menu in menuOptions"
          :key="menu.key"
          class="nav-item-wrapper"
        >
          <div
            :class="[
              'nav-item',
              { 
                'active': isMenuActive(menu),
                'has-children': menu.children && menu.children.length > 0
              }
            ]"
            @click="handleNavClick(menu)"
          >
            <span class="nav-icon">{{ getMenuIcon(menu) }}</span>
            <span class="nav-label">{{ menu.label }}</span>
            <span v-if="menu.children && menu.children.length > 0" class="nav-arrow">▼</span>
          </div>

          <!-- 二级菜单（下拉）- 使用 CSS hover 控制显示 -->
          <div
            v-if="menu.children && menu.children.length > 0"
            class="submenu-dropdown"
          >
            <div
              v-for="child in menu.children"
              :key="child.key"
              :class="['submenu-item', { 'active': currentRoute === child.key }]"
              @click="handleSubMenuClick(child)"
            >
              <span class="submenu-icon">{{ getMenuIcon(child) }}</span>
              <span class="submenu-label">{{ child.label }}</span>
            </div>
          </div>
        </div>
      </nav>

      <!-- 右侧操作区 -->
      <div class="header-actions">
        <n-button 
          size="small" 
          @click="toggleAlwaysOnTop"
          :type="isAlwaysOnTop ? 'primary' : 'default'"
          :quaternary="!isAlwaysOnTop"
          style="margin-right: 8px;"
        >
          {{ isAlwaysOnTop ? '已置顶' : '未置顶' }}
        </n-button>
        <n-button 
          size="small" 
          @click="toggleWindowMode"
          :type="windowMode === 'plugin' ? 'primary' : 'default'"
          :quaternary="windowMode !== 'plugin'"
          style="margin-right: 8px;"
          :title="windowMode === 'software' ? '点击切换到插件模式' : '点击切换到软件模式'"
        >
          {{ windowMode === 'software' ? '切换到插件' : '切换到软件' }}
        </n-button>
        <!-- 人物调整插件快捷按钮 -->
        <button
          class="action-button plugin-shortcut"
          @click="navigateToActionExpression"
          title="打开人物调整插件"
        >
          <span class="action-icon">🎭</span>
        </button>
        <!-- 主题切换按钮 -->
        <button
          class="action-button theme-toggle"
          @click="handleThemeToggle"
          :title="currentTheme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          :disabled="isLoading"
        >
          <span class="action-icon">{{ currentTheme === 'dark' ? '☀️' : '🌙' }}</span>
        </button>
      </div>
    </div>

    <!-- 主内容区域 -->
    <div class="main-content">
      <RouterView v-slot="{ Component, route }">
        <keep-alive v-if="route.meta.keepAlive !== false">
          <component :is="Component" />
        </keep-alive>
        <component :is="Component" v-else />
      </RouterView>
    </div>
  </div>
</template>

<script setup>
/** 主界面框架：维护工具导航、主题切换和桌面窗口状态，承载缓存页面。 */
import { RouterView } from 'vue-router'
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useTheme } from '../../utils/composables/useTheme'
import { useMessage } from 'naive-ui'

const message = useMessage()
// 路由相关
const router = useRouter()
const route = useRoute()

// 主题相关
const { currentTheme, isLoading, toggleTheme } = useTheme()

// 置顶与窗口模式
const isAlwaysOnTop = ref(false)
const windowMode = ref('software')

/**
 * 从主进程读取窗口置顶状态。
 * 处理流程：
 * 1、请求实际窗口状态，仅在成功响应时更新按钮状态。
 */
const getAlwaysOnTopState = async () => {
  // 1、以桌面窗口实际状态为准，读取失败时保持界面现值。
  try {
    const result = await window.electronAPI?.windowGetAlwaysOnTop()
    if (result && result.success) {
      isAlwaysOnTop.value = result.alwaysOnTop
    }
  } catch (e) {
    console.warn('获取置顶状态失败:', e)
  }
}

/**
 * 切换窗口置顶。
 * 处理流程：
 * 1、反转当前状态并请求主进程设置。
 * 2、确认成功后更新界面并提示结果，失败时保留原状态。
 */
const toggleAlwaysOnTop = async () => {
  // 1、先执行桌面操作，再更新界面，避免显示未生效的状态。
  try {
    const newState = !isAlwaysOnTop.value
    const result = await window.electronAPI?.windowSetAlwaysOnTop(newState)
    if (result && result.success) {
      isAlwaysOnTop.value = newState
      message.success(newState ? '窗口已置顶' : '已取消置顶')
    } else {
      message.error('设置窗口置顶失败')
    }
  } catch (error) {
    console.error('切换窗口置顶失败:', error)
    message.error('切换窗口置顶失败')
  }
}

/**
 * 切换软件窗口与插件窗口模式。
 * 处理流程：
 * 1、根据当前模式确定目标并调用主进程。
 * 2、成功时更新模式状态，失败时展示错误。
 */
const toggleWindowMode = async () => {
  // 1、窗口尺寸等具体行为由主进程实现。
  try {
    const newMode = windowMode.value === 'software' ? 'plugin' : 'software'
    const result = await window.electronAPI?.windowSetMode(newMode)
    if (result && result.success) {
      windowMode.value = newMode
      message.success(newMode === 'plugin' ? '已切换到插件模式' : '已切换到软件模式')
    } else {
      message.error('切换窗口模式失败')
    }
  } catch (error) {
    console.error('切换窗口模式失败:', error)
    message.error('切换窗口模式失败')
  }
}

// 图标映射
const iconMap = {
  'home': '🏠',
  'tools': '🔧',
  'action-expression': '🎭',
  'comic': '📚',
  'dialog': '💬',
  'dialog-frame': '🖼️',
  'generation': '🤖',
  'generate': '🍌',
  'hd-toolkit': '🪄',
  'video-subtitle-ocr': '📝',
  'settings': '⚙️',
  'settings-stickfigure': '🎨',
  'settings-hotkeys': '⌨️',
  'settings-gemini': '🍌',
  'settings-hd-toolkit': '✨',
  'settings-dialog': '💬',
  'settings-about': 'ℹ️',
  'settings-tutorial': '📖',
  'settings-qq-group': '💬',
}

/**
 * 获取菜单图标。
 * 处理流程：
 * 1、按菜单键查找图标，未配置时使用默认图标。
 */
const getMenuIcon = (menu) => {
  // 1、图标缺失不影响菜单导航。
  return iconMap[menu.key] || '📄'
}

/**
 * 读取导航高亮使用的路由标识。
 * 处理流程：
 * 1、返回当前路由名称，无名称时回退首页标识。
 */
const currentRoute = computed(() => {
  // 1、菜单使用路由名称而非 URL 路径匹配。
  return route.name || 'home'
})

/**
 * 判断当前菜单是否应高亮。
 * 处理流程：
 * 1、先比较当前菜单键，再检查直接子菜单中是否有匹配项。
 */
const isMenuActive = (menu) => {
  // 1、子菜单被选中时，其一级菜单也保持高亮。
  if (currentRoute.value === menu.key) return true
  if (menu.children) {
    return menu.children.some(child => child.key === currentRoute.value)
  }
  return false
}

// 菜单配置
const menuOptions = [
  {
    label: '首页',
    key: 'home'
  },
  {
    label: '工具',
    key: 'tools',
    children: [
      {
        label: '人物调整插件',
        key: 'action-expression'
      },
      {
        label: '多视角排版插件',
        key: 'comic'
      },
      {
        label: '人物对话插件',
        key: 'dialog'
      },
      {
        label: '幻想框插件',
        key: 'dialog-frame'
      },
      {
        label: '字幕提取插件',
        key: 'video-subtitle-ocr'
      }
    ]
  },
  {
    label: 'AI',
    key: 'generation',
    children: [
      {
        label: '图像处理插件',
        key: 'image-processing'
      },
      {
        label: 'AI生图插件',
        key: 'generate'
      },
      {
        label: '抠图高清插件',
        key: 'hd-toolkit'
      }
    ]
  },
  {
    label: '设置',
    key: 'settings',
    children: [
      {
        label: '人物插件设置',
        key: 'settings-stickfigure'
      },
      {
        label: '快捷键设置',
        key: 'settings-hotkeys'
      },
      {
        label: '纳米香蕉生图设置',
        key: 'settings-gemini'
      },
      {
        label: '抠图高清设置',
        key: 'settings-hd-toolkit'
      },
      {
        label: '对话插件设置',
        key: 'settings-dialog'
      },
      {
        label: '应用与配置',
        key: 'settings-about'
      },
      { label: '教程与帮助', key: 'settings-tutorial' },
      { label: 'QQ官方群', key: 'settings-qq-group' },
    ]
  }
]

/**
 * 处理一级导航点击。
 * 处理流程：
 * 1、有子菜单时进入首个子项，否则进入当前菜单对应路由。
 */
const handleNavClick = (menu) => {
  // 1、菜单分组提供默认入口，不单独渲染分组页面。
  if (menu.children && menu.children.length > 0) {
    // 有子菜单：跳转到第一个子菜单
    const firstChild = menu.children[0]
    router.push({ name: firstChild.key })
  } else {
    // 无子菜单：直接跳转
    router.push({ name: menu.key })
  }
}

/**
 * 处理二级菜单点击。
 * 处理流程：
 * 1、按子菜单键跳转到同名路由。
 */
const handleSubMenuClick = (child) => {
  // 1、具体工具由路由组件承载。
  router.push({ name: child.key })
}

/**
 * 打开人物调整工具。
 * 处理流程：
 * 1、导航到人物调整的固定命名路由。
 */
const navigateToActionExpression = () => {
  // 1、供导航栏快捷入口复用。
  router.push({ name: 'action-expression' })
}

/**
 * 切换主界面主题并同步预览窗口。
 * 处理流程：
 * 1、等待主题管理器完成主题切换。
 * 2、通知独立预览窗口，未打开或同步失败时只记录日志。
 */
const handleThemeToggle = async () => {
  // 1、先更新共享主题状态和本地配置。
  await toggleTheme()
  
  // 2、同步预览窗口失败不回退主界面已经生效的主题。
  try {
    await window.electronAPI?.invoke('canvas-preview-sync-theme', currentTheme.value)
  } catch (error) {
    console.log('同步主题到预览窗口失败（可能窗口未打开）:', error)
  }
}

// 监听路由变化，同步置顶状态
watch(() => route.path, async () => {
  // 重新获取置顶状态，确保按钮状态与实际一致
  await getAlwaysOnTopState()
})

// 初始化
onMounted(() => {
  getAlwaysOnTopState()
})
</script>

<style scoped src="./LayoutShell.css"></style>
