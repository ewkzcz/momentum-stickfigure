<template>
  <div class="jimeng-web-container">
    <div class="jimeng-toolbar">
      <div class="jimeng-title">
        <span class="jimeng-icon">✨</span>
        <span class="jimeng-name">即梦 AI</span>
      </div>
      <div class="jimeng-actions">
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
        :src="jimengUrl"
        class="jimeng-webview"
        allowpopups="true"
        partition="persist:jimeng"
      ></webview>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <n-spin size="large">
          <template #description>
            <span class="loading-text">正在加载即梦官网...</span>
          </template>
        </n-spin>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 即梦网页容器：按页签生命周期管理独立桌面视图，并同步布局与原生主题。 */
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick, onActivated, onDeactivated } from 'vue'
import { NButton, NSpin, useMessage } from 'naive-ui'
import { useTheme } from '@renderer/utils/composables/useTheme'

const message = useMessage()
const props = defineProps({ active: { type: Boolean, default: true } })
const { currentTheme } = useTheme()

// 即梦官网地址
const jimengUrl = ref('https://jimeng.jianying.com/ai-tool/home')
const isLoading = ref(true)
const useBrowserView = ref(true) // 默认启用 BrowserView 嵌入，更稳定
const webviewRef = ref(null)
const webviewWrapper = ref(null)

// 记录 BrowserView 打开状态与监听器，便于关闭与清理
const isBVOpen = ref(false)
let bvBoundsObserver = null
const isDarkMode = computed(() => currentTheme.value === 'dark')

/**
 * 同步即梦视图边界。
 * 处理流程：
 * 1、检查容器有效尺寸，将整数边界提交给即梦站点分区。
 */
const applyBVBounds = () => {
  // 1、隐藏或未布局的容器不更新桌面视图边界。
  try {
    const wrapper = webviewWrapper.value
    if (!wrapper || !window.electronAPI?.browserView?.setBounds) return
    const rect = wrapper.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 50)) return
    const bounds = { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
    window.electronAPI.browserView.setBounds(jimengUrl.value, bounds, { partition: 'persist:jimeng' })
  } catch (e) {
    console.warn('applyBVBounds 失败:', e)
  }
}

/**
 * 等待即梦容器布局完成。
 * 处理流程：
 * 1、间隔检查容器尺寸，成功时提前返回，超出次数时报告未就绪。
 */
async function waitForWrapperReady(maxRetries = 10) {
  // 1、为页签激活后的布局变化预留有限等待时间。
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
 * 打开即梦桌面视图。
 * 处理流程：
 * 1、检查页签、桥接接口和打开状态，并等待有效容器。
 * 2、使用独立站点分区打开网页，提交当前位置和主题。
 * 3、观察窗口及容器尺寸，完成后取消加载遮罩。
 */
async function openBrowserView() {
  // 1、阻止未激活页签或已打开视图重复执行初始化。
  if (!props.active) return
  if (!useBrowserView.value || !window.electronAPI?.browserView?.open || isBVOpen.value === true) return
  const ready = await waitForWrapperReady(20)
  if (!ready) return
  const wrapper = webviewWrapper.value
  try {
    await window.electronAPI.browserView.open(
      jimengUrl.value,
      undefined,
      {
        partition: 'persist:jimeng',
        enableDevTools: false,
        theme: isDarkMode.value ? 'dark' : 'light',
        nativeTheme: true
      }
    )
    // 2、先定位视图再同步主题，随后安装尺寸监听。
    applyBVBounds()
    await window.electronAPI.invoke('browserview:applyTheme', {
      partition: 'persist:jimeng',
      url: jimengUrl.value,
      scheme: isDarkMode.value ? 'dark' : 'light',
      nativeTheme: true
    })
    // 3、窗口变化和内部容器变化都需要同步到原生视图。
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
 * 关闭即梦视图并释放布局监听。
 * 处理流程：
 * 1、按地址和分区关闭已打开视图。
 * 2、无论关闭结果如何都移除监听并重置打开状态。
 */
function closeBrowserView() {
  // 1、保持关闭入口可被路由停用和组件卸载重复调用。
  try {
    if (isBVOpen.value && window.electronAPI?.browserView?.close) {
      window.electronAPI.browserView.close(jimengUrl.value, { partition: 'persist:jimeng' })
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
 * 1、按当前主题构造颜色方案、布局及滚动条样式。
 * 2、注入样式和维护主题属性的脚本，分别记录失败。
 */
const injectTheme = () => {
  // 1、仅在备用 webview 元素存在时执行页面注入。
  try {
    const webview = webviewRef.value
    if (!webview) return

    const darkMode = isDarkMode.value
    console.log(`[即梦主题] 应用浏览器原生${darkMode ? '暗色' : '亮色'}主题`)

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
          
          console.log('[即梦] 已应用并锁定浏览器原生主题: ' + scheme);
        } catch (e) {
          console.error('[即梦主题] 设置失败:', e);
        }
      })();
    `

    // 2、分别提交样式和脚本，保留各自的错误来源。
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
 * 1、桌面视图经主进程刷新并重新应用主题。
 * 2、备用 webview 通过元素刷新，同时显示加载状态。
 */
const reloadWebview = async () => {
  // 1、按当前模式选择刷新目标，避免同时刷新两个页面实例。
  try {
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:reload', { partition: 'persist:jimeng', url: jimengUrl.value })
      // 刷新后重新应用浏览器原生主题
      await window.electronAPI.invoke('browserview:applyTheme', { 
        partition: 'persist:jimeng', 
        url: jimengUrl.value, 
        scheme: isDarkMode.value ? 'dark' : 'light',
        nativeTheme: true
      })
      message.info('正在刷新即梦页面...')
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
 * 1、优先通过系统接口打开站点，接口缺失时使用新窗口。
 */
const openInBrowser = async () => {
  // 1、外部打开不会切换或关闭当前工具页签。
  try {
    if (window.electronAPI?.shell?.openExternal) {
      await window.electronAPI.shell.openExternal(jimengUrl.value)
      message.success('已在默认浏览器中打开')
    } else {
      // 备用方案
      window.open(jimengUrl.value, '_blank')
    }
  } catch (error) {
    console.error('打开外部浏览器失败:', error)
    message.error('打开外部浏览器失败')
  }
}

/**
 * 设置 webview 尺寸
 * 处理流程：
 * 1、在下一帧读取布局结果。
 * 2、有效尺寸同时设置样式和属性，否则延迟重试。
 */
const resizeWebview = () => {
  // 1、只处理备用 webview 的尺寸，不修改主进程视图。
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
 * 将应用主题变化同步到即梦网页。
 * 处理流程：
 * 1、计算明暗方案，并尝试更新全局浏览器原生主题。
 * 2、延迟三百毫秒后按承载方式注入页面主题或通知主进程更新即梦视图。
 */
watch(isDarkMode, async (newValue) => {
  // 1、把应用的布尔主题状态转换为浏览器主题方案。
  const scheme = newValue ? 'dark' : 'light'
  console.log(`[主题] 检测到主题变化，同步浏览器原生${scheme === 'dark' ? '暗色' : '亮色'}主题`)
  
  // 2、先同步全局原生主题，接口失败时记录错误并继续后续处理。
  if (window.electronAPI?.theme?.setPreferredColorScheme) {
    try {
      await window.electronAPI.theme.setPreferredColorScheme(scheme)
      console.log(`[即梦主题] 已同步全局浏览器原生主题: ${scheme}`)
    } catch (error) {
      console.error('[即梦主题] 同步失败:', error)
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
        partition: 'persist:jimeng', 
        url: jimengUrl.value, 
        scheme: scheme,
        nativeTheme: true
      })
    }
  }, 300)
})
</script>

<style scoped>
.jimeng-web-container {
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

.jimeng-toolbar {
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

.jimeng-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
  user-select: none;
}

.jimeng-icon {
  font-size: 18px;
  line-height: 1;
}

.jimeng-name {
  letter-spacing: 0.3px;
}

.jimeng-actions {
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

.jimeng-webview {
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
  .jimeng-toolbar {
    padding: 6px 12px;
  }
  
  .jimeng-title {
    font-size: 14px;
  }
  
  .jimeng-icon {
    font-size: 16px;
  }
}
</style>
