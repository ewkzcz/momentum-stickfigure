/**
 * 模板UI交互逻辑
 * 负责模板的重命名等UI交互功能
 */

import { nextTick } from 'vue'

/**
 * 连接模板列表与名称编辑交互。
 * 处理流程：
 * 1、创建编辑、失焦保存处理函数。
 * 2、返回供模板列表绑定的事件入口。
 */
export function useTemplateUI({
  templates,
  editingTemplateId,
  renameTemplate
}) {
  // 1、定义模板名称编辑与保存处理。

  /**
   * 开始编辑模板名称
   * 双击模板名称时触发
   * 处理流程：
   * 1、记录正在编辑的模板。
   * 2、等待输入框渲染后聚焦并选中文本。
   */
  const startEditTemplateName = (templateId) => {
    // 1、进入指定模板的编辑状态。
    editingTemplateId.value = templateId
    // 2、等视图更新后定位输入框。
    nextTick(() => {
      // 聚焦到输入框
      const input = document.querySelector('.template-name-input')
      if (input) {
        input.focus()
        input.select()
      }
    })
  }

  /**
   * 处理模板名称输入框失去焦点
   * 保存编辑后的模板名称
   * 处理流程：
   * 1、提取非空名称并尝试保存。
   * 2、失败时恢复原名称，最后退出编辑状态。
   */
  const handleTemplateNameBlur = async (templateId, event) => {
    // 1、修剪输入并保存有效名称。
    const newName = event.target.value.trim()
    
    if (newName && newName !== '') {
      const success = await renameTemplate(templateId, newName)
      if (!success) {
        // 2、重命名失败，恢复原名称。
        const template = templates.value.find(t => t.id === templateId)
        if (template) {
          event.target.value = template.name
        }
      }
    }
    
    editingTemplateId.value = null
  }

  // 2、导出供视图绑定的名称编辑事件。
  return {
    startEditTemplateName,
    handleTemplateNameBlur
  }
}
