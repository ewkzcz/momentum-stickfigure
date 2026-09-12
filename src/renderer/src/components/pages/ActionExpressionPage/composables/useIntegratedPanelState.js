/** 整合面板控制：唯一维护折叠状态和活动标签，不负责通用配置、图层数据或绘制。 */
import { ref } from 'vue'

/**
 * 创建整合面板控制状态。
 * 处理流程：
 * 1、保持默认折叠和通用控制标签。
 * 2、提供标题点击、折叠切换和标签切换方法。
 * 3、返回原绑定，供页面及文件会话恢复共用同一状态。
 */
export function useIntegratedPanelState() {
  // 1、每个页面实例只创建一组原始状态。
  const integratedPanelCollapsed = ref(true)
  const integratedPanelTab = ref('commonControls')

  /** 切换折叠状态。处理流程：1、反转当前折叠标记。 */
  const toggleIntegratedPanel = () => {
    // 1、触发面板展开或折叠。
    integratedPanelCollapsed.value = !integratedPanelCollapsed.value
  }

  /**
   * 响应标题空白处点击。
   * 处理流程：
   * 1、排除按钮、输入框和内部元素。
   * 2、空白处点击切换折叠状态。
   */
  const handleHeaderClick = (event) => {
    // 1、保留原六种交互区域的排除条件。
    const target = event.target
    if (target.closest('.panel-tab-button') ||
        target.closest('.collapse-icon') ||
        target.closest('.save-preset-button') ||
        target.closest('.save-template-button') ||
        target.closest('.search-preset-button') ||
        target.closest('.size-control-compact')) {
      return
    }
    // 2、仅标题空白处切换面板。
    toggleIntegratedPanel()
  }

  /**
   * 切换标签或收起当前标签。
   * 处理流程：
   * 1、重复点击展开中的标签时折叠。
   * 2、其它情况选中目标标签并展开。
   */
  const switchIntegratedPanelTab = (tab) => {
    // 1、当前标签处于展开状态时收起。
    if (integratedPanelTab.value === tab && !integratedPanelCollapsed.value) {
      integratedPanelCollapsed.value = true
    } else {
      // 2、选中点击的标签并展开面板。
      integratedPanelTab.value = tab
      integratedPanelCollapsed.value = false
    }
  }

  // 3、父页面引用与会话恢复使用同一组 ref。
  return { integratedPanelCollapsed, integratedPanelTab, toggleIntegratedPanel, handleHeaderClick, switchIntegratedPanelTab }
}
