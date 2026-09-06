<template>
  <div class="baidu-rembg-container">
    <div class="baidu-toolbar">
      <div class="baidu-title">
        <span class="baidu-icon">🎨</span>
        <span class="baidu-name">百度抠图</span>
      </div>
      <div class="baidu-actions">
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
        :src="baiduUrl"
        class="baidu-webview"
        allowpopups="true"
        partition="persist:baidu-rembg"
      ></webview>
      
      <!-- 加载指示器 -->
      <div v-if="isLoading" class="loading-overlay">
        <n-spin size="large">
          <template #description>
            <span class="loading-text">正在加载百度抠图...</span>
          </template>
        </n-spin>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 百度抠图网页容器：按页签激活状态管理桌面嵌入视图、尺寸同步和刷新操作。 */
import { ref, onMounted, onBeforeUnmount, nextTick, onActivated, onDeactivated, watch } from 'vue'
import { NButton, NSpin, useMessage } from 'naive-ui'

const message = useMessage()
const props = defineProps({ active: { type: Boolean, default: true } })

// 百度抠图地址
const baiduUrl = ref('https://image.baidu.com/pc/edit/remove-background')
const isLoading = ref(true)
const useBrowserView = ref(true) // 默认启用 BrowserView 嵌入，更稳定
const webviewRef = ref(null)
const webviewWrapper = ref(null)

// 记录 BrowserView 打开状态与监听器，便于关闭与清理
const isBVOpen = ref(false)
let bvBoundsObserver = null

/**
 * 同步百度抠图嵌入视图的边界。
 * 处理流程：
 * 1、确认容器和接口可用，仅在尺寸有效时提交整数边界。
 */
const applyBVBounds = () => {
  // 1、页面布局尚未展开时不把零尺寸传给桌面视图。
  try {
    const wrapper = webviewWrapper.value
    if (!wrapper || !window.electronAPI?.browserView?.setBounds) return
    const rect = wrapper.getBoundingClientRect()
    if (!(rect.width > 0 && rect.height > 50)) return
    const bounds = { x: Math.floor(rect.left), y: Math.floor(rect.top), width: Math.floor(rect.width), height: Math.floor(rect.height) }
    window.electronAPI.browserView.setBounds(baiduUrl.value, bounds, { partition: 'persist:baidu-rembg' })
  } catch (e) {
    console.warn('applyBVBounds 失败:', e)
  }
}

/**
 * 等待网页容器完成布局。
 * 处理流程：
 * 1、定次检查容器尺寸，重试之间等待短暂间隔。
 * 2、有效时返回 true，超过次数返回 false。
 */
async function waitForWrapperReady(maxRetries = 10) {
  // 1、避免页签刚激活时使用尚未确定的容器尺寸。
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
 * 打开百度抠图桌面视图。
 * 处理流程：
 * 1、确认页签激活、接口可用且未重复打开，等待有效布局。
 * 2、打开独立存储分区的视图，注册容器尺寸监听并取消遮罩。
 */
async function openBrowserView() {
  // 1、非当前页签不创建覆盖在页面之上的桌面视图。
  if (!props.active) return
  if (!useBrowserView.value || !window.electronAPI?.browserView?.open || isBVOpen.value === true) return
  const ready = await waitForWrapperReady(20)
  if (!ready) return
  const wrapper = webviewWrapper.value
  try {
    await window.electronAPI.browserView.open(
      baiduUrl.value,
      undefined,
      {
        partition: 'persist:baidu-rembg',
        enableDevTools: false
        // 移除主题设置，百度网站不支持主题切换
      }
    )
    // 2、首次定位后监听窗口与容器变化。
    applyBVBounds()
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
 * 关闭百度抠图视图并释放尺寸监听。
 * 处理流程：
 * 1、已打开时通知主进程关闭对应分区视图。
 * 2、无论关闭结果如何都移除监听并重置打开标志。
 */
function closeBrowserView() {
  // 1、页签切出和组件卸载共用此清理入口。
  try {
    if (isBVOpen.value && window.electronAPI?.browserView?.close) {
      window.electronAPI.browserView.close(baiduUrl.value, { partition: 'persist:baidu-rembg' })
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
 * 重新加载网页
 * 处理流程：
 * 1、优先通过主进程刷新桌面视图，否则刷新 webview 并显示遮罩。
 */
const reloadWebview = async () => {
  // 1、根据当前嵌入模式选择刷新接口。
  try {
    if (useBrowserView.value && window.electronAPI?.invoke) {
      await window.electronAPI.invoke('browserview:reload', { partition: 'persist:baidu-rembg', url: baiduUrl.value })
      message.info('正在刷新百度抠图页面...')
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
 * 1、优先交给系统默认浏览器，桌面接口缺失时使用 window.open。
 */
const openInBrowser = async () => {
  // 1、打开的地址始终来自本组件的目标网站配置。
  try {
    if (window.electronAPI?.shell?.openExternal) {
      await window.electronAPI.shell.openExternal(baiduUrl.value)
      message.success('已在默认浏览器中打开')
    } else {
      // 备用方案
      window.open(baiduUrl.value, '_blank')
    }
  } catch (error) {
    console.error('打开外部浏览器失败:', error)
    message.error('打开外部浏览器失败')
  }
}

/**
 * 设置 webview 尺寸
 * 处理流程：
 * 1、等待下一动画帧读取容器尺寸。
 * 2、有效尺寸同时写入样式和 HTML 属性，无效时延迟重试。
 */
const resizeWebview = () => {
  // 1、仅兼容 webview 模式，桌面视图使用独立边界同步接口。
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

// 注意：百度抠图网站不支持主题切换，这里不监听主题变化
</script>

<style scoped>
.baidu-rembg-container {
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

.baidu-toolbar {
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

.baidu-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 15px;
  font-weight: 500;
  color: var(--n-text-color);
  user-select: none;
}

.baidu-icon {
  font-size: 18px;
  line-height: 1;
}

.baidu-name {
  letter-spacing: 0.3px;
}

.baidu-actions {
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

.baidu-webview {
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
  .baidu-toolbar {
    padding: 6px 12px;
  }
  
  .baidu-title {
    font-size: 14px;
  }
  
  .baidu-icon {
    font-size: 16px;
  }
}
</style>
