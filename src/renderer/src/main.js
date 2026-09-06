/** 渲染入口：装配路由、状态和界面插件，并在本地配置恢复后挂载应用。 */
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { MotionPlugin } from '@vueuse/motion'
import localStorageSync from './utils/localStorageSync'

// 导入 Naive UI
import naive from 'naive-ui'
// 通用字体
import 'vfonts/Lato.css'
// 等宽字体
import 'vfonts/FiraCode.css'

// 引入样式文件
import './assets/styles/styles.css'      // 全局样式（唯一入口）
import './assets/styles/motion-v.css'    // 动画效果

// ==================== 开发者工具已开放 ====================
console.log('[开发] 开发者工具已开放，可使用F12或右键菜单')


const pinia = createPinia()
const app = createApp(App)

// 注意：webview标签的支持已在vite配置中通过compilerOptions设置
// 不需要在运行时配置 compilerOptions（运行时版本的Vue不支持）

/**
 * 记录组件运行异常。
 * 处理流程：
 * 1、尝试附带组件名称和生命周期信息输出异常。
 * 2、读取组件信息失败时保留原始异常输出。
 */
app.config.errorHandler = (err, instance, info) => {
  // 1、优先提供组件上下文，异常格式化失败时使用简化输出。
  try {
    const name = instance?.type?.name || instance?.type || 'AnonymousComponent'
    console.error('VueError:', info, 'in', name, err)
  } catch (_) {
    console.error('VueError:', err)
  }
}
// 生产环境禁用警告处理器
if (import.meta.env.MODE === 'production') {
  app.config.warnHandler = () => {}
} else {
  /**
   * 记录开发环境组件警告。
   * 处理流程：
   * 1、输出组件名称、警告和调用轨迹，失败时只输出警告。
   */
  app.config.warnHandler = (msg, instance, trace) => {
    // 1、收集组件上下文并保留降级日志出口。
    try {
      const name = instance?.type?.name || instance?.type || 'AnonymousComponent'
      console.warn('VueWarn:', msg, 'in', name, trace)
    } catch (_) {
      console.warn('VueWarn:', msg)
    }
  }
}

app.use(pinia)
app.use(router)
app.use(naive)                    // 挂载 Naive UI
app.use(MotionPlugin)             // 启用动画插件

/**
 * 恢复本地配置并挂载应用。
 * 处理流程：
 * 1、等待磁盘配置同步到浏览器存储，避免组件读到旧配置。
 * 2、完成同步后挂载；同步失败时仍挂载，保证界面可进入。
 */
async function startApp() {
  try {
    console.log('[应用启动] 开始初始化localStorage同步...')

    // 1、等待本地配置恢复完成后再创建页面组件。
    await localStorageSync.init()

    console.log('[应用启动] localStorage同步完成，挂载应用...')

    // 2、挂载主界面，组件此时可以读取同步后的配置。
    app.mount('#app')

    console.log('[应用启动] 应用挂载完成')
  } catch (error) {
    console.error('[应用启动] 启动失败:', error)

    // 3、同步失败时保留进入界面的降级路径。
    app.mount('#app')
  }
}

// 启动应用
startApp()
