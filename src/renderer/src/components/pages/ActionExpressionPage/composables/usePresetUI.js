/**
 * 预设UI交互逻辑
 * 负责预设的重命名等UI交互功能
 */

import { nextTick } from 'vue'

/**
 * 连接预设列表与名称编辑交互。
 * 处理流程：
 * 1、创建编辑、失焦保存处理函数。
 * 2、返回供预设列表绑定的事件入口。
 */
export function usePresetUI({
  presets,
  editingPresetId,
  renamePreset
}) {
  // 1、定义预设名称编辑与保存处理。

  /**
   * 开始编辑预设名称
   * 双击预设名称时触发
   * 处理流程：
   * 1、记录正在编辑的预设。
   * 2、等待输入框渲染后聚焦并选中文本。
   */
  const startEditPresetName = (presetId) => {
    // 1、进入指定预设的编辑状态。
    editingPresetId.value = presetId
    // 2、等视图更新后定位输入框。
    nextTick(() => {
      // 聚焦到输入框
      const input = document.querySelector('.preset-name-input')
      if (input) {
        input.focus()
        input.select()
      }
    })
  }

  /**
   * 处理预设名称输入框失去焦点
   * 保存编辑后的预设名称
   * 处理流程：
   * 1、提取非空名称并尝试保存。
   * 2、失败时恢复原名称，最后退出编辑状态。
   */
  const handlePresetNameBlur = async (presetId, event) => {
    // 1、修剪输入并保存有效名称。
    const newName = event.target.value.trim()
    
    if (newName && newName !== '') {
      const success = await renamePreset(presetId, newName)
      if (!success) {
        // 2、重命名失败，恢复原名称。
        const preset = presets.value.find(p => p.id === presetId)
        if (preset) {
          event.target.value = preset.name
        }
      }
    }
    
    editingPresetId.value = null
  }

  // 2、导出供视图绑定的名称编辑事件。
  return {
    startEditPresetName,
    handlePresetNameBlur
  }
}
