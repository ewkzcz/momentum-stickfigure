/**
 * 窗口控制逻辑
 * 
 * 功能：
 * - 窗口置顶控制
 * - 窗口模式切换（软件模式/插件模式）
 * - 窗口边界信息获取
 */

import { ref } from 'vue'
import { useMessage } from 'naive-ui'

/**
 * 窗口控制组合函数
 * 处理流程：
 * 1、创建窗口模式、置顶与边界状态。
 * 2、封装主进程窗口操作及浏览器边界回退逻辑。
 * 3、返回状态和控制函数。
 * @returns {Object} 窗口控制相关的状态和方法
 */
export function useWindowControl() {
  // 1、初始化提示服务和窗口状态。
  const message = useMessage()
  
  // ==================== 状态定义 ====================
  
  /**
   * 窗口是否置顶
   */
  const isAlwaysOnTop = ref(false)
  
  /**
   * 窗口模式：'software' 软件模式 / 'plugin' 插件模式
   */
  const windowMode = ref('software')
  
  /**
   * 窗口边界信息
   */
  const windowBounds = ref({ 
    x: 0, 
    y: 0, 
    width: 1200, 
    height: 800 
  })
  
  // 2、定义窗口操作和状态同步方法。
  
  /**
   * 切换窗口置顶状态
   * 处理流程：
   * 1、请求主进程设置相反的置顶状态。
   * 2、成功后同步界面，失败或异常时提示错误。
   */
  const toggleAlwaysOnTop = async () => {
    // 1、请求实际窗口状态变更。
    try {
      const newState = !isAlwaysOnTop.value
      const result = await window.electronAPI?.windowSetAlwaysOnTop(newState)
      
      // 2、仅在主进程确认成功后修改界面状态。
      if (result && result.success) {
        isAlwaysOnTop.value = newState
        message.success(newState ? '窗口已置顶' : '已取消置顶')
      } else {
        message.error('设置窗口置顶失败')
      }
    } catch (error) {
      console.error('切换窗口置顶失败:', error)
      message.error('切换窗口置顶失败: ' + error.message)
    }
  }
  
  /**
   * 切换窗口模式（软件模式/插件模式）
   * 处理流程：
   * 1、计算下一模式并请求主进程应用。
   * 2、成功后同步模式，失败或异常时提示错误。
   */
  const toggleWindowMode = async () => {
    // 1、请求切换软件模式与插件模式。
    try {
      const newMode = windowMode.value === 'software' ? 'plugin' : 'software'
      const result = await window.electronAPI?.windowSetMode(newMode)
      
      // 2、以主进程结果决定是否同步界面模式。
      if (result && result.success) {
        windowMode.value = newMode
        message.success(newMode === 'plugin' ? '已切换到插件模式' : '已切换到软件模式')
      } else {
        message.error('切换窗口模式失败')
      }
    } catch (error) {
      console.error('切换窗口模式失败:', error)
      message.error('切换窗口模式失败: ' + error.message)
    }
  }
  
  /**
   * 获取当前窗口置顶状态
   * 处理流程：
   * 1、查询主进程窗口状态。
   * 2、成功时更新置顶状态，异常时记录错误。
   */
  const getAlwaysOnTopState = async () => {
    // 1、查询实际窗口的置顶设置。
    try {
      const result = await window.electronAPI?.windowGetAlwaysOnTop()
      // 2、有效响应才覆盖已有状态。
      if (result && result.success) {
        isAlwaysOnTop.value = result.alwaysOnTop
      }
    } catch (error) {
      console.error('获取窗口置顶状态失败:', error)
    }
  }
  
  /**
   * 更新窗口边界信息
   * 处理流程：
   * 1、优先查询主进程提供的窗口边界。
   * 2、响应无效或调用异常时使用浏览器窗口信息。
   */
  const updateWindowBounds = async () => {
    // 1、优先使用桌面窗口提供的位置和尺寸。
    try {
      const result = await window.electronAPI?.getWindowBounds?.()
      
      if (result?.success && result?.bounds) {
        windowBounds.value = result.bounds
        console.log('✅ 窗口边界更新成功:', result.bounds)
      } else {
        // 2、降级方案：使用浏览器 API 获取窗口信息。
        windowBounds.value = {
          x: window.screenX || 0,
          y: window.screenY || 0,
          width: window.outerWidth || 1200,
          height: window.outerHeight || 800
        }
      }
    } catch (error) {
      console.warn('⚠️ 无法获取窗口边界，使用默认值', error)
      windowBounds.value = {
        x: window.screenX || 0,
        y: window.screenY || 0,
        width: window.outerWidth || 1200,
        height: window.outerHeight || 800
      }
    }
  }
  
  // 3、返回窗口状态及操作入口。
  
  return {
    // 状态
    isAlwaysOnTop,
    windowMode,
    windowBounds,
    
    // 方法
    toggleAlwaysOnTop,
    toggleWindowMode,
    getAlwaysOnTopState,
    updateWindowBounds
  }
}
