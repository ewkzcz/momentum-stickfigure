<template>
  <div class="doubao-web-container">
    <div class="doubao-toolbar">
      <div class="doubao-title">
        <span class="doubao-icon">🤖</span>
        <span class="doubao-name">豆包 AI</span>
      </div>
      <div class="doubao-actions">
        <n-button 
          size="small" 
          @click="reloadWebview"
          quaternary
          title="刷新页面"
        >
          🔄 刷新
        </n-button>
        <n-button 
          size="small" 
          @click="openInBrowser"
          quaternary
          title="在默认浏览器中打开"
        >
          🌐 外部打开
        </n-button>
      </div>
    </div>
    
    <div ref="webviewWrapper" class="webview-wrapper">
      <!-- 只有在非 BrowserView 模式下才真正创建 webview 元素 -->
      <webview
        v-if="!useBrowserView"
        ref="webviewRef"
        :src="doubaoUrl"
        class="doubao-webview"
        allowpopups="true"
        partition="persist:doubao"
      ></webview>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <n-spin size="large">
          <template #description>
            <span class="loading-text">正在加载豆包官网...</span>
          </template>
        </n-spin>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 豆包网页容器：管理嵌入视图的生命周期、尺寸和原生主题，并提供刷新与外部打开。 */
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick, onActivated, onDeactivated } from 'vue'
import { NButton, NSpin, useMessage } from 'naive-ui'
import { useTheme } from '@renderer/utils/composables/useTheme'

const message = useMessage()
const props = defineProps({ active: { type: Boolean, default: true } })
const { currentTheme } = useTheme()

// 豆包官网地址
const doubaoUrl = ref('https://www.doubao.com/chat')
const isLoading = ref(true)
const useBrowserView = ref(true) // 默认启用 BrowserView 嵌入，更稳定
const webviewRef = ref(null)
const webviewWrapper = ref(null)

// 记录 BrowserView 打开状态与监听器，便于关闭与清理
const isBVOpen = ref(false)
let bvBoundsObserver = null
const isDarkMode = computed(() => currentTheme.value === 'dark')

/**
 * 更新豆包桌面视图的位置和尺寸。
 * 处理流程：
 * 1、读取容器矩形，有效时按豆包分区提交整数边界。
 */
const applyBVBounds = () => {
  // 1、尚未布局时跳过更新，保留已有桌面视图尺寸。
  try {
    const wrapper = webviewWrapper.value
    if (!wrapper || !window.electronAPI?.browserView?.setBounds) return
    const rect = wrapper.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 50)) return
    const bounds = { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
    window.electronAPI.browserView.setBounds(doubaoUrl.value, bounds, { partition: 'persist:doubao' })
  } catch (e) {
    console.warn('applyBVBounds 失败:', e)
  }
}

/**
 * 等待豆包容器可用于嵌入。
 * 处理流程：
 * 1、定次检查容器尺寸，间隔重试，成功或超限后返回结果。
 */
async function waitForWrapperReady(maxRetries = 10) {
  // 1、避免页签切换期间使用未完成布局的容器。
  let retries = 0
  while (retries < maxRetries) {
    const wrapper = webviewWrapper.value
    if (wrapper) {
      const rect = wrapper.getBoundingClientRect()
      if (rect.width > 0 && rect.height > 50) return true
    }
    await new Promise(r => setTimeout(r, 100))
    retries++
  }
  return false
}

/**
 * 打开豆包桌面视图并同步主题。
 * 处理流程：
 * 1、检查激活状态、可用接口和重复打开标志，等待容器就绪。
 * 2、打开独立分区视图并应用当前原生主题。
 * 3、注册尺寸观察器，标记打开成功并移除遮罩。
 */
async function openBrowserView() {
  // 1、非活动页签不打开桌面视图，避免覆盖其他工具。
  if (!props.active) return
  if (!useBrowserView.value || !window.electronAPI?.browserView?.open || isBVOpen.value === true) return
  const ready = await waitForWrapperReady(20)
  if (!ready) return
  const wrapper = webviewWrapper.value
  try {
    await window.electronAPI.browserView.open(
      doubaoUrl.value,
      undefined,
      {
        partition: 'persist:doubao',
        enableDevTools: false,
        theme: isDarkMode.value ? 'dark' : 'light',
        nativeTheme: true
      }
    )
    // 2、先定位视图，再向主进程同步主题配置。
    applyBVBounds()
    await window.electronAPI.invoke('browserview:applyTheme', {
      partition: 'persist:doubao',
      url: doubaoUrl.value,
      scheme: isDarkMode.value ? 'dark' : 'light',
      nativeTheme: true
    })
    // 3、主题请求完成后建立尺寸监听并标记初始化完成。
    window.addEventListener('resize', applyBVBounds)
    if (bvBoundsObserver) { try { bvBoundsObserver.disconnect() } catch {} }
    bvBoundsObserver = new ResizeObserver(() => applyBVBounds())
    bvBoundsObserver.observe(wrapper)
    isBVOpen.value = true
    // 打开成功后取消遮罩
    isLoading.value = false
  } catch (e) {
    console.error('打开 BrowserView 失败:', e)
  }
}

/**
 * 关闭豆包视图并清理尺寸监听。
 * 处理流程：
 * 1、关闭已打开的对应分区视图。
 * 2、无论关闭结果如何都解除窗口与容器监听并重置状态。
 */
function closeBrowserView() {
  // 1、页签停用和组件卸载共用此入口。
  try {
    if (isBVOpen.value && window.electronAPI?.browserView?.close) {
      window.electronAPI.browserView.close(doubaoUrl.value, { partition: 'persist:doubao' })
    }
  } catch (e) {
    console.warn('关闭 BrowserView 失败:', e)
  } finally {
    window.removeEventListener('resize', applyBVBounds)
    if (bvBoundsObserver) { try { bvBoundsObserver.disconnect() } catch {} }
    bvBoundsObserver = null
    isBVOpen.value = false
  }
}

/**
 * 注入浏览器原生主题到 webview
 * 处理流程：
 * 1、读取当前主题，构造页面颜色方案和滚动条样式。
 * 2、构造维护主题属性的脚本，分别注入样式和脚本并记录失败。
 */
const injectTheme = () => {
  // 1、此路径仅操作 webview 元素，桌面视图主题由主进程处理。
  try {
    const webview = webviewRef.value
    if (!webview) return

    const darkMode = isDarkMode.value
    console.log(`[豆包主题] 应用浏览器原生${darkMode ? '暗色' : '亮色'}主题`)

    // 设置浏览器原生 color-scheme
    const css = `
      /* 强制浏览器原生主题 */
      :root, html, body { 
        color-scheme: ${darkMode ? 'dark' : 'light'} !important; 
      }
      
      /* 确保页面铺满容器 */
      html, body { 
        height: 100% !important; 
        min-height: 100% !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      
      /* 优化滚动条样式 */
      ::-webkit-scrollbar { 
        width: 8px; 
        height: 8px; 
      }
      ::-webkit-scrollbar-thumb { 
        border-radius: 4px; 
        background: ${darkMode ? '#555' : '#c1c1c1'}; 
      }
      ::-webkit-scrollbar-track { 
        background: ${darkMode ? '#2a2a2a' : '#f1f1f1'}; 
      }
    `

    // 强制设置主题并监控变化
    const script = `
      (function() {
        try {
          const isDark = ${darkMode};
          const scheme = isDark ? 'dark' : 'light';
          
          // 设置浏览器原生主题属性
          document.documentElement.style.colorScheme = scheme;
          document.documentElement.setAttribute('data-theme', scheme);
          document.body.setAttribute('data-theme', scheme);
          
          // 监控并阻止主题被篡改
          const observer = new MutationObserver(() => {
            if (document.documentElement.style.colorScheme !== scheme) {
              document.documentElement.style.colorScheme = scheme;
            }
            if (document.documentElement.getAttribute('data-theme') !== scheme) {
              document.documentElement.setAttribute('data-theme', scheme);
            }
          });
          
          observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme', 'style']
          });
          
          console.log('[豆包] 已应用并锁定浏览器原生主题: ' + scheme);
        } catch (e) {
          console.error('[豆包主题] 设置失败:', e);
        }
      })();
    `

    // 2、样式和脚本独立提交，分别保留注入失败日志。
    webview.insertCSS(css).catch(err => {
      console.error('[Webview] CSS 注入失败:', err)
    })
    webview.executeJavaScript(script).catch(err => {
      console.error('[Webview] 主题脚本注入失败:', err)
    })
  } catch (error) {
    console.error('注入主题失败:', error)
  }
}

/**
 * 重新加载网页
 * 处理流程：
 * 1、桌面视图刷新后重新请求应用当前原生主题。
 * 2、webview 模式调用元素刷新方法并显示加载遮罩。
 */
const reloadWebview = async () => {
  // 1、优先走当前桌面嵌入模式的刷新入口。
  try {
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:reload', { partition: 'persist:doubao', url: doubaoUrl.value })
      // 刷新后重新应用浏览器原生主题
      await window.electronAPI.invoke('browserview:applyTheme', { 
        partition: 'persist:doubao', 
        url: doubaoUrl.value, 
        scheme: isDarkMode.value ? 'dark' : 'light',
        nativeTheme: true
      })
      message.info('正在刷新豆包页面...')
      return
    }
    if (webviewRef.value) {
      isLoading.value = true
      webviewRef.value.reload()
      message.info('正在刷新页面...')
    }
  } catch (error) {
    console.error('刷新页面失败:', error)
    message.error('刷新页面失败')
  }
}

/**
 * 在外部浏览器中打开
 * 处理流程：
 * 1、使用系统默认浏览器接口，缺失时通过新窗口打开网址。
 */
const openInBrowser = async () => {
  // 1、外部打开使用固定站点地址，不依赖嵌入页面当前导航位置。
  try {
    if (window.electronAPI?.shell?.openExternal) {
      await window.electronAPI.shell.openExternal(doubaoUrl.value)
      message.success('已在默认浏览器中打开')
    } else {
      // 备用方案
      window.open(doubaoUrl.value, '_blank')
    }
  } catch (error) {
    console.error('打开外部浏览器失败:', error)
    message.error('打开外部浏览器失败')
  }
}

/**
 * 设置 webview 尺寸
 * 处理流程：
 * 1、下一动画帧读取容器矩形。
 * 2、有效时同步样式和属性，无效时延迟重试。
 */
const resizeWebview = () => {
  // 1、此方法只处理备用 webview 模式的元素布局。
  const wrapper = webviewWrapper.value
  const webview = webviewRef.value
  if (!wrapper || !webview) return

  try {
    // 等待下一帧再获取尺寸，确保CSS布局完成
    requestAnimationFrame(() => {
      const rect = wrapper.getBoundingClientRect()
      console.log('Wrapper尺寸:', rect.width, 'x', rect.height)
      
      // 确保有有效的尺寸，且高度足够大
      if (rect.width > 0 && rect.height > 50) {
        // 强制设置webview的尺寸
        webview.style.setProperty('width', rect.width + 'px', 'important')
        webview.style.setProperty('height', rect.height + 'px', 'important')
        
        // 同时设置webview的HTML属性
        webview.setAttribute('width', Math.floor(rect.width))
        webview.setAttribute('height', Math.floor(rect.height))
        
        // 确保webview占满整个容器
        webview.style.setProperty('position', 'absolute', 'important')
        webview.style.setProperty('top', '0', 'important')
        webview.style.setProperty('left', '0', 'important')
        webview.style.setProperty('right', '0', 'important')
        webview.style.setProperty('bottom', '0', 'important')
        
        console.log('✅ webview尺寸已设置:', Math.floor(rect.width), 'x', Math.floor(rect.height))
      } else {
        console.warn('⚠️ Wrapper尺寸无效 (' + rect.width + 'x' + rect.height + ')，稍后重试')
        // 如果尺寸无效，等待一段时间后重试
        setTimeout(resizeWebview, 300)
      }
    })
  } catch (error) {
    console.error('设置webview尺寸失败:', error)
  }
}

onMounted(async () => {
  // 设置浏览器原生主题（不会触发打开）
  if (window.electronAPI?.theme?.setPreferredColorScheme) {
    try {
      await window.electronAPI.theme.setPreferredColorScheme(isDarkMode.value ? 'dark' : 'light')
    } catch {}
  }
  // 初始化尺寸（webview模式下）
  nextTick(() => {
    resizeWebview()
    setTimeout(resizeWebview, 100)
    setTimeout(resizeWebview, 300)
  })
  // 首次仅当 active 为 true 时才打开
  if (props.active && useBrowserView.value) {
    await openBrowserView()
  }
})

// watch active：切换页签时按需开关 BrowserView
watch(() => props.active, async (val) => {
  if (!useBrowserView.value) return
  if (val) {
    isLoading.value = true
    await openBrowserView()
  } else {
    closeBrowserView()
  }
})

onActivated(async () => {
  // 仅当本标签处于激活状态时才打开
  if (props.active && useBrowserView.value) {
    await openBrowserView()
  }
})

onDeactivated(() => {
  // 路由切走时关闭，避免覆盖其他页面
  if (useBrowserView.value) {
    closeBrowserView()
  }
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', resizeWebview)
  closeBrowserView()
})

/**
 * 将应用主题变化同步到豆包网页。
 * 处理流程：
 * 1、计算明暗方案，并尝试更新全局浏览器原生主题。
 * 2、延迟三百毫秒后按承载方式注入页面主题或通知主进程更新豆包视图。
 */
watch(isDarkMode, async (newValue) => {
  // 1、把应用的布尔主题状态转换为浏览器主题方案。
  const scheme = newValue ? 'dark' : 'light'
  console.log(`[主题] 检测到主题变化，同步浏览器原生${scheme === 'dark' ? '暗色' : '亮色'}主题`)
  
  // 2、先同步全局原生主题，接口失败时记录错误并继续后续处理。
  if (window.electronAPI?.theme?.setPreferredColorScheme) {
    try {
      await window.electronAPI.theme.setPreferredColorScheme(scheme)
      console.log(`[豆包主题] 已同步全局浏览器原生主题: ${scheme}`)
    } catch (error) {
      console.error('[豆包主题] 同步失败:', error)
    }
  }
  
  // 3、延迟同步当前网页，分别适配网页标签和独立网页视图。
  setTimeout(async () => {
    // 对于 webview 模式，重新注入主题
    if (!useBrowserView.value) {
      injectTheme()
    }
    
    // 对于 BrowserView 模式，通知主进程应用原生主题
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:applyTheme', { 
        partition: 'persist:doubao', 
        url: doubaoUrl.value, 
        scheme: scheme,
        nativeTheme: true
      })
    }
  }, 300)
})
</script>

<style scoped>
.doubao-web-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  flex: 1;
  background: var(--n-color);
  overflow: hidden;
  box-sizing: border-box;
}

.doubao-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 16px;
  background: var(--n-color);
  border-bottom: 1px solid var(--n-border-color);
  flex-shrink: 0;
  min-height: 40px;
}

.doubao-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
  user-select: none;
}

.doubao-icon {
  font-size: 18px;
  line-height: 1;
}

.doubao-name {
  letter-spacing: 0.3px;
}

.doubao-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

.webview-wrapper {
  flex: 1;
  width: 100%;
  height: 100%;
  min-height: 400px;
  overflow: hidden;
  background: var(--n-color);
  position: relative;
}

.doubao-webview {
  border: none;
  display: block;
  background: transparent;
  width: 100% !important;
  height: 100% !important;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
}

.loading-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.95);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.loading-text {
  margin-top: 12px;
  color: #666;
  font-size: 14px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .doubao-toolbar {
    padding: 6px 12px;
  }
  
  .doubao-title {
    font-size: 14px;
  }
  
  .doubao-icon {
    font-size: 16px;
  }
}
</style>
