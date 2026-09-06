<template>
  <div class="liblib-web-container">
    <div class="liblib-toolbar">
      <div class="liblib-title">
        <span class="liblib-icon">🎨</span>
        <span class="liblib-name">LibLib AI</span>
      </div>
      <div class="liblib-actions">
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
        :src="liblibUrl"
        class="liblib-webview"
        allowpopups="true"
        partition="persist:liblib"
      ></webview>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <n-spin size="large">
          <template #description>
            <span class="loading-text">正在加载 LibLib...</span>
          </template>
        </n-spin>
      </div>
    </div>
  </div>
</template>

<script setup>
/** LibLib 网页容器：管理站点独立视图与尺寸监听，并按应用明暗模式同步主题。 */
import { ref, onMounted, onBeforeUnmount, computed, watch, nextTick, onActivated, onDeactivated } from 'vue'
import { NButton, NSpin, useMessage } from 'naive-ui'
import { useTheme } from '@renderer/utils/composables/useTheme'

const message = useMessage()
const props = defineProps({ active: { type: Boolean, default: true } })
const { currentTheme } = useTheme()

// LibLib 官网地址
const liblibUrl = ref('https://www.liblib.art/')
const isLoading = ref(true)
const useBrowserView = ref(true) // 默认启用 BrowserView 嵌入，更稳定
const webviewRef = ref(null)
const webviewWrapper = ref(null)

// 记录 BrowserView 打开状态与监听器，便于关闭与清理
const isBVOpen = ref(false)
let bvBoundsObserver = null
const isDarkMode = computed(() => currentTheme.value === 'dark')

/**
 * 更新 LibLib 桌面视图边界。
 * 处理流程：
 * 1、读取有效容器矩形，整数化后提交到 LibLib 站点分区。
 */
const applyBVBounds = () => {
  // 1、避免容器隐藏时将原生视图缩到无效尺寸。
  try {
    const wrapper = webviewWrapper.value
    if (!wrapper || !window.electronAPI?.browserView?.setBounds) return
    const rect = wrapper.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 50)) return
    const bounds = { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
    window.electronAPI.browserView.setBounds(liblibUrl.value, bounds, { partition: 'persist:liblib' })
  } catch (e) {
    console.warn('[LibLib] applyBVBounds 失败:', e)
  }
}

/**
 * 等待 LibLib 容器可见且完成布局。
 * 处理流程：
 * 1、以有限次数间隔探测尺寸，首次有效时返回成功。
 */
async function waitForWrapperReady(maxRetries = 10) {
  // 1、超过等待次数时由调用方放弃本次打开。
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
 * 打开 LibLib 桌面视图。
 * 处理流程：
 * 1、确认活动页签与接口，等待容器就绪并记录当前主题。
 * 2、打开独立分区视图，主题应用失败仅记警告。
 * 3、注册尺寸观察器，成功或失败时结束加载遮罩。
 */
async function openBrowserView() {
  // 1、避免非激活页签或已打开的视图重复初始化。
  if (!props.active) return
  if (!useBrowserView.value || !window.electronAPI?.browserView?.open || isBVOpen.value === true) return
  const ready = await waitForWrapperReady(20)
  if (!ready) return
  const wrapper = webviewWrapper.value
  const currentScheme = isDarkMode.value ? 'dark' : 'light'
  
  try {
    console.log(`[LibLib] 打开 BrowserView，主题: ${currentScheme}`)
    
    await window.electronAPI.browserView.open(
      liblibUrl.value,
      undefined,
      {
        partition: 'persist:liblib',
        enableDevTools: false,
        theme: currentScheme,
        nativeTheme: true
      }
    )
    applyBVBounds()
    
    // 2、单独处理主题失败，视图仍可继续初始化。
    try {
      await window.electronAPI.invoke('browserview:applyTheme', {
        partition: 'persist:liblib',
        url: liblibUrl.value,
        scheme: currentScheme,
        nativeTheme: true
      })
      console.log(`[LibLib] 已应用 ${currentScheme} 主题`)
    } catch (themeError) {
      console.warn('[LibLib] 应用主题失败:', themeError)
    }
    
    // 3、后续布局变化由窗口事件和容器观察器共同驱动。
    window.addEventListener('resize', applyBVBounds)
    if (bvBoundsObserver) { try { bvBoundsObserver.disconnect() } catch {} }
    bvBoundsObserver = new ResizeObserver(() => applyBVBounds())
    bvBoundsObserver.observe(wrapper)
    isBVOpen.value = true
    // 打开成功后取消遮罩
    isLoading.value = false
  } catch (e) {
    console.error('[LibLib] 打开 BrowserView 失败:', e)
    isLoading.value = false
  }
}

/**
 * 关闭 LibLib 视图并移除尺寸订阅。
 * 处理流程：
 * 1、按站点地址和分区请求关闭。
 * 2、在收尾阶段断开观察器和窗口事件，并重置打开状态。
 */
function closeBrowserView() {
  // 1、关闭请求异常也不会跳过本地监听清理。
  try {
    if (isBVOpen.value && window.electronAPI?.browserView?.close) {
      console.log('[LibLib] 关闭 BrowserView')
      window.electronAPI.browserView.close(liblibUrl.value, { partition: 'persist:liblib' })
    }
  } catch (e) {
    console.warn('[LibLib] 关闭 BrowserView 失败:', e)
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
 * 1、为当前主题构造颜色方案和页面布局样式。
 * 2、注入样式与主题维护脚本，分别处理异步失败。
 */
const injectTheme = () => {
  // 1、备用 webview 直接注入，桌面视图交由主进程管理主题。
  try {
    const webview = webviewRef.value
    if (!webview) return

    const darkMode = isDarkMode.value
    console.log(`[LibLib 主题] 应用浏览器原生${darkMode ? '暗色' : '亮色'}主题`)

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
          
          console.log('[LibLib] 已应用并锁定浏览器原生主题: ' + scheme);
        } catch (e) {
          console.error('[LibLib 主题] 设置失败:', e);
        }
      })();
    `

    // 2、将样式与脚本作为两个独立注入请求提交。
    webview.insertCSS(css).catch(err => {
      console.error('[LibLib Webview] CSS 注入失败:', err)
    })
    webview.executeJavaScript(script).catch(err => {
      console.error('[LibLib Webview] 主题脚本注入失败:', err)
    })
  } catch (error) {
    console.error('[LibLib] 注入主题失败:', error)
  }
}

/**
 * 重新加载网页
 * 处理流程：
 * 1、桌面视图刷新后同步当前原生主题。
 * 2、webview 模式调用元素刷新，并通过加载遮罩反馈。
 */
const reloadWebview = async () => {
  // 1、优先刷新当前独立分区的桌面视图。
  try {
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:reload', { partition: 'persist:liblib', url: liblibUrl.value })
      // 刷新后重新应用浏览器原生主题
      await window.electronAPI.invoke('browserview:applyTheme', { 
        partition: 'persist:liblib', 
        url: liblibUrl.value, 
        scheme: isDarkMode.value ? 'dark' : 'light',
        nativeTheme: true
      })
      message.info('正在刷新 LibLib 页面...')
      return
    }
    if (webviewRef.value) {
      isLoading.value = true
      webviewRef.value.reload()
      message.info('正在刷新页面...')
    }
  } catch (error) {
    console.error('[LibLib] 刷新页面失败:', error)
    message.error('刷新页面失败')
  }
}

/**
 * 在外部浏览器中打开
 * 处理流程：
 * 1、通过系统默认浏览器打开网址，接口不可用时回退新窗口。
 */
const openInBrowser = async () => {
  // 1、外部打开与嵌入视图生命周期相互独立。
  try {
    if (window.electronAPI?.shell?.openExternal) {
      await window.electronAPI.shell.openExternal(liblibUrl.value)
      message.success('已在默认浏览器中打开')
    } else {
      // 备用方案
      window.open(liblibUrl.value, '_blank')
    }
  } catch (error) {
    console.error('[LibLib] 打开外部浏览器失败:', error)
    message.error('打开外部浏览器失败')
  }
}

/**
 * 设置 webview 尺寸
 * 处理流程：
 * 1、下一帧读取容器尺寸。
 * 2、同步有效宽高与定位样式，尺寸尚未就绪时延迟重试。
 */
const resizeWebview = () => {
  // 1、原生桌面视图由边界接口管理，此处只更新备用元素。
  const wrapper = webviewWrapper.value
  const webview = webviewRef.value
  if (!wrapper || !webview) return

  try {
    // 等待下一帧再获取尺寸，确保CSS布局完成
    requestAnimationFrame(() => {
      const rect = wrapper.getBoundingClientRect()
      
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
        
        console.log('[LibLib] webview尺寸已设置:', Math.floor(rect.width), 'x', Math.floor(rect.height))
      } else {
        console.warn('[LibLib] Wrapper尺寸无效，稍后重试')
        // 如果尺寸无效，等待一段时间后重试
        setTimeout(resizeWebview, 300)
      }
    })
  } catch (error) {
    console.error('[LibLib] 设置webview尺寸失败:', error)
  }
}

onMounted(async () => {
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
 * 将应用主题变化同步到 LibLib 网页。
 * 处理流程：
 * 1、取得明暗方案并等待三百毫秒。
 * 2、网页标签模式重新注入主题；独立视图已打开时请求主进程应用主题。
 * 3、记录独立视图的更新结果或失败原因。
 */
watch(isDarkMode, async (newValue) => {
  // 1、取得目标方案，本回调不调用全局主题设置接口。
  const scheme = newValue ? 'dark' : 'light'
  console.log(`[LibLib 主题] 检测到主题变化: ${scheme}`)
  
  // 2、延迟处理，给应用层主题同步留出时间。
  setTimeout(async () => {
    // 对于 webview 模式，重新注入主题
    if (!useBrowserView.value) {
      injectTheme()
    }
    
    // 3、独立视图打开且桥接可用时发送主题请求，并记录结果。
    if (useBrowserView.value && isBVOpen.value && window.electronAPI?.invoke) {
      try {
        await window.electronAPI.invoke('browserview:applyTheme', { 
          partition: 'persist:liblib', 
          url: liblibUrl.value, 
          scheme: scheme,
          nativeTheme: true
        })
        console.log(`[LibLib 主题] 已应用 ${scheme} 主题到 LibLib 视图`)
      } catch (error) {
        console.warn('[LibLib 主题] 应用主题失败:', error)
      }
    }
  }, 300)
})
</script>

<style scoped>
.liblib-web-container {
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

.liblib-toolbar {
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

.liblib-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
  user-select: none;
}

.liblib-icon {
  font-size: 18px;
  line-height: 1;
}

.liblib-name {
  letter-spacing: 0.3px;
}

.liblib-actions {
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

.liblib-webview {
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
  .liblib-toolbar {
    padding: 6px 12px;
  }
  
  .liblib-title {
    font-size: 14px;
  }
  
  .liblib-icon {
    font-size: 16px;
  }
}
</style>
