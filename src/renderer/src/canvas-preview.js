/** 画布预览窗口入口：独立挂载预览组件，装配字体、样式和组件库。 */
import { createApp } from 'vue'
import CanvasPreviewPage from './components/pages/CanvasPreviewPage/CanvasPreviewPage.vue'
import naive from 'naive-ui'

// 导入字体
import 'vfonts/Lato.css'
import 'vfonts/FiraCode.css'

// 引入样式
import './assets/styles/styles.css'

const app = createApp(CanvasPreviewPage)

/**
 * 记录预览窗口的组件异常。
 * 处理流程：
 * 1、输出生命周期信息和原始异常，便于定位预览失败原因。
 */
app.config.errorHandler = (err, instance, info) => {
  // 1、保留组件库传入的错误上下文。
  console.error('VueError:', info, err)
}

// 生产环境禁用警告
if (import.meta.env.MODE === 'production') {
  app.config.warnHandler = () => {}
}

app.use(naive)
app.mount('#app')
