/** 人物页生命周期：按原顺序管理挂载、缓存激活、卸载与路由离开，复用页面唯一状态。 */
import { onMounted, onUnmounted, onActivated, nextTick } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { useCanvasActivationReset } from './useCanvasActivationReset.js'

/**
 * 在原生命周期位置注册页面资源的初始化与释放。
 * 处理流程：
 * 1、复用页面引用和延迟函数，保持窗口尺寸回调唯一。
 * 2、按原顺序注册挂载、激活、卸载与离开守卫。
 * 3、卸载时先保存历史再释放数据，不提前读取后初始化的图层树。
 */
export function useActionPageLifecycle({
  windowHeight, updateCanvasDisplaySize, initPSDService, getAlwaysOnTopState,
  loadTemplates, registerDragFinished, handleDragFinished, partsListRef, virtualScroll,
  scrollMode, canvasScale, userHasManuallyScrolled, renderAllLayers,
  autoSavePsdHistory, cleanupDragFinished, psdFiles, currentPsdFile, currentPsdData,
  getLayerTreeData, psdPartsCache, psdStatesCache, userInteracted
}) {
  /**
   * 监听窗口大小变化
   * 处理流程：
   * 1、更新窗口高度并重新计算画布展示尺寸
   */
  const handleWindowResize = () => {
    // 1、让尺寸计算使用最新窗口高度
    windowHeight.value = window.innerHeight
    updateCanvasDisplaySize()
  }

  // ==================== 分隔条拖拽功能 ====================
  // handleDividerMouseDown, handleDividerMouseMove, handleDividerMouseUp 函数已迁移到 composables/useCanvasDivider.js

  // handleCanvasWheel 函数已迁移到 composables/useCanvasScale.js

  // handleKeyDown 函数已迁移到 composables/useKeyboard.js

  // ==================== 生命周期 ====================

  /**
   * 初始化人物编辑页面的服务、模板和交互监听。
   * 处理流程：
   * 1、检查 PSD 服务和置顶状态，计算画布尺寸并加载全局模板
   * 2、注册窗口尺寸及系统拖拽完成监听
   * 3、等待部件列表挂载，初始化虚拟滚动并保留清理入口
   */
  onMounted(async () => {
    // 1、先准备页面显示和全局模板所需的数据
    await initPSDService()
    await getAlwaysOnTopState()

    // 初始化Canvas显示尺寸
    updateCanvasDisplaySize()

    // 加载全局模板（不依赖PSD）
    await loadTemplates()
    console.log('✅ 已加载全局模板')

    // 2、注册窗口大小变化与桌面系统拖拽完成事件
    window.addEventListener('resize', handleWindowResize)

    // 注意：键盘事件监听已由 useKeyboard composable 内部管理，无需手动添加

    // 监听 drag-finished 事件
    registerDragFinished(handleDragFinished)

    // 3、等待列表容器可用后初始化虚拟滚动，并保存卸载时的清理函数
    await nextTick()
    if (partsListRef.value) {
      const cleanup = virtualScroll.init(partsListRef.value)
      // 保存清理函数，以便在onUnmounted中调用
      window.__virtualScrollCleanup = cleanup
      console.log('✅ 虚拟滚动已初始化')
    }
  })

  // 保持原生命周期注册位置；延迟读取初始化后才替换的渲染函数。
  const { resetCanvasOnActivated } = useCanvasActivationReset({
    nextTick,
    scrollMode,
    canvasScale,
    userHasManuallyScrolled,
    updateCanvasDisplaySize,
    renderAllLayers: () => renderAllLayers()
  })
  onActivated(resetCanvasOnActivated)

  /**
   * 卸载人物编辑页面并释放文件与监听资源。
   * 处理流程：
   * 1、自动保存当前 PSD 路径历史
   * 2、解除窗口、拖拽及虚拟滚动监听
   * 3、释放 PSD 数据、部件缓存与图层树引用
   */
  onUnmounted(() => {
    // 1、在清空文件引用之前保存路径历史
    autoSavePsdHistory()

    // 2、清理页面持有的窗口、拖拽和虚拟滚动监听
    window.removeEventListener('resize', handleWindowResize)

    // 注意：键盘事件监听已由 useKeyboard composable 内部管理，无需手动清理
    // 注意：分隔条拖拽监听已由 useCanvasDivider composable 内部管理，无需手动清理

    // 清理拖拽监听
    cleanupDragFinished()

    // 清理虚拟滚动
    if (window.__virtualScrollCleanup) {
      window.__virtualScrollCleanup()
      delete window.__virtualScrollCleanup
      console.log('✅ 虚拟滚动已清理')
    }

    // 3、彻底释放 PSD 相关引用，避免大文件常驻内存
    psdFiles.value.splice(0, psdFiles.value.length)
    currentPsdFile.value = null
    currentPsdData.value = null
    getLayerTreeData().value = []
    psdPartsCache.value = {}
    psdStatesCache.value = {}
    userInteracted.value = {}
  })

  // 路由离开前的处理
  onBeforeRouteLeave(async (to, from) => {
    // 自动保存PSD历史记录
    autoSavePsdHistory()

    // 关闭预览窗口
    try {
      await window.electronAPI?.invoke('canvas-preview-close')
    } catch (error) {
      console.error('关闭预览窗口失败:', error)
    }

    return true
  })
}
