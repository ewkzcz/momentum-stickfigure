<template>
  <div class="koukoutu-web-container">
    <div class="koukoutu-toolbar">
      <div class="koukoutu-title">
        <span class="koukoutu-icon">✂️</span>
        <span class="koukoutu-name">扣扣图 AI</span>
      </div>
      <div class="koukoutu-actions">
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
        :src="koukoutuUrl"
        class="koukoutu-webview"
        allowpopups="true"
        partition="persist:koukoutu"
      ></webview>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <n-spin size="large">
          <template #description>
            <span class="loading-text">正在加载扣扣图...</span>
          </template>
        </n-spin>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 扣扣图网页容器：按激活状态开关嵌入视图，独立保存站点状态并保持浅色主题。 */
import { ref, onMounted, onBeforeUnmount, watch, onActivated, onDeactivated } from 'vue'
import { NButton, NSpin, useMessage } from 'naive-ui'

const message = useMessage()
const props = defineProps({ active: { type: Boolean, default: true } })

// 扣扣图官网地址
const koukoutuUrl = ref('https://www.koukoutu.com/removebgtool/all?open=true')
const isLoading = ref(true)
const useBrowserView = ref(true) // 默认启用 BrowserView 嵌入，更稳定
const webviewRef = ref(null)
const webviewWrapper = ref(null)

// 记录 BrowserView 打开状态与监听器，便于关闭与清理
const isBVOpen = ref(false)
let bvBoundsObserver = null

/**
 * 同步扣扣图桌面视图边界。
 * 处理流程：
 * 1、获取有效容器矩形，将整数化的位置和尺寸传给对应分区视图。
 */
const applyBVBounds = () => {
  // 1、跳过未布局或高度过小的容器，避免闪烁。
  try {
    const wrapper = webviewWrapper.value
    if (!wrapper || !window.electronAPI?.browserView?.setBounds) return
    const rect = wrapper.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 50)) return
    const bounds = { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
    window.electronAPI.browserView.setBounds(koukoutuUrl.value, bounds, { partition: 'persist:koukoutu' })
  } catch (e) {
    console.warn('applyBVBounds 失败:', e)
  }
}

/**
 * 等待扣扣图容器布局就绪。
 * 处理流程：
 * 1、循环检查有效尺寸，短暂等待后重试，达到上限返回失败。
 */
async function waitForWrapperReady(maxRetries = 10) {
  // 1、限制等待次数，容器不可见时不会持续阻塞打开流程。
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
 * 打开扣扣图桌面视图。
 * 处理流程：
 * 1、确认页签激活和容器有效，避免重复打开。
 * 2、使用站点独立分区打开视图，单独尝试应用浅色主题。
 * 3、监听尺寸变化，打开成功或失败时均结束加载遮罩。
 */
async function openBrowserView() {
  // 1、只为当前活动页签创建视图。
  if (!props.active) return
  if (!useBrowserView.value || !window.electronAPI?.browserView?.open || isBVOpen.value === true) return
  const ready = await waitForWrapperReady(20)
  if (!ready) return
  const wrapper = webviewWrapper.value
  
  try {
    console.log('[扣扣图] 打开 BrowserView，强制使用白色主题')
    
    await window.electronAPI.browserView.open(
      koukoutuUrl.value,
      undefined,
      {
        partition: 'persist:koukoutu',
        enableDevTools: false,
        theme: 'light',  // 强制使用白色主题
        nativeTheme: true
      }
    )
    applyBVBounds()
    
    // 2、主题请求失败只记警告，不阻止视图继续初始化。
    try {
      await window.electronAPI.invoke('browserview:applyTheme', {
        partition: 'persist:koukoutu',
        url: koukoutuUrl.value,
        scheme: 'light',  // 强制使用白色主题
        nativeTheme: true
      })
      console.log('[扣扣图] 已应用白色主题')
    } catch (themeError) {
      console.warn('[扣扣图] 应用主题失败:', themeError)
    }
    
    // 3、同步窗口和容器两种尺寸变化。
    window.addEventListener('resize', applyBVBounds)
    if (bvBoundsObserver) { try { bvBoundsObserver.disconnect() } catch {} }
    bvBoundsObserver = new ResizeObserver(() => applyBVBounds())
    bvBoundsObserver.observe(wrapper)
    isBVOpen.value = true
    // 打开成功后取消遮罩
    isLoading.value = false
  } catch (e) {
    console.error('[扣扣图] 打开 BrowserView 失败:', e)
    isLoading.value = false
  }
}

/**
 * 关闭扣扣图视图并清理监听。
 * 处理流程：
 * 1、通知主进程关闭已打开的视图。
 * 2、在收尾阶段解除尺寸监听并清除状态。
 */
function closeBrowserView() {
  // 1、关闭按网站地址和分区定位，不影响其他网页工具。
  try {
    if (isBVOpen.value && window.electronAPI?.browserView?.close) {
      console.log('[扣扣图] 关闭 BrowserView')
      window.electronAPI.browserView.close(koukoutuUrl.value, { partition: 'persist:koukoutu' })
    }
  } catch (e) {
    console.warn('[扣扣图] 关闭 BrowserView 失败:', e)
  } finally {
    window.removeEventListener('resize', applyBVBounds)
    if (bvBoundsObserver) { try { bvBoundsObserver.disconnect() } catch {} }
    bvBoundsObserver = null
    isBVOpen.value = false
  }
}

/**
 * 重新加载网页
 * 处理流程：
 * 1、桌面视图刷新后重新应用浅色主题。
 * 2、webview 模式使用元素自身的刷新方法，异常时显示错误。
 */
const reloadWebview = async () => {
  // 1、扣扣图刷新后仍保持浅色模式，不跟随应用明暗切换。
  try {
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:reload', { partition: 'persist:koukoutu', url: koukoutuUrl.value })
      
      // 刷新后重新应用白色主题
      await window.electronAPI.invoke('browserview:applyTheme', { 
        partition: 'persist:koukoutu', 
        url: koukoutuUrl.value, 
        scheme: 'light',  // 强制使用白色主题
        nativeTheme: true
      })
      
      message.info('正在刷新扣扣图页面...')
      return
    }
    if (webviewRef.value) {
      isLoading.value = true
      webviewRef.value.reload()
      message.info('正在刷新页面...')
    }
  } catch (error) {
    console.error('[扣扣图] 刷新页面失败:', error)
    message.error('刷新页面失败')
  }
}

/**
 * 在外部浏览器中打开
 * 处理流程：
 * 1、优先调用系统浏览器接口，缺失时使用浏览器新窗口。
 */
const openInBrowser = async () => {
  // 1、外部打开不改变当前嵌入视图状态。
  try {
    if (window.electronAPI?.shell?.openExternal) {
      await window.electronAPI.shell.openExternal(koukoutuUrl.value)
      message.success('已在默认浏览器中打开')
    } else {
      // 备用方案
      window.open(koukoutuUrl.value, '_blank')
    }
  } catch (error) {
    console.error('打开外部浏览器失败:', error)
    message.error('打开外部浏览器失败')
  }
}

onMounted(async () => {
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
  closeBrowserView()
})

// 扣扣图始终使用白色主题，不响应应用主题变化
// 注释：扣扣图网站不支持暗色模式，因此无论应用主题如何切换，都保持白色主题
</script>

<style scoped>
.koukoutu-web-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  min-height: 0;
  flex: 1;
  background: #ffffff;
  overflow: hidden;
  box-sizing: border-box;
}

.koukoutu-toolbar {
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

.koukoutu-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
  user-select: none;
}

.koukoutu-icon {
  font-size: 18px;
  line-height: 1;
}

.koukoutu-name {
  letter-spacing: 0.3px;
}

.koukoutu-actions {
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
  background: #ffffff;
  position: relative;
}

.koukoutu-webview {
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
  background: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.loading-text {
  margin-top: 12px;
  color: #666666;
  font-size: 14px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .koukoutu-toolbar {
    padding: 6px 12px;
  }
  
  .koukoutu-title {
    font-size: 14px;
  }
  
  .koukoutu-icon {
    font-size: 16px;
  }
}
</style>
