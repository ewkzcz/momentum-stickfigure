/**
 * 更多菜单逻辑 - 处理更多按钮的下拉菜单和选项处理
 * @module composables/useMoreMenu
 */

import { computed } from 'vue'

/**
 * 更多菜单功能
 * 处理流程：
 * 1、建立画布、历史、预设及模板的菜单配置
 * 2、将菜单选择分派给对应业务入口，并提供菜单状态
 * @param {Object} options - 配置选项
 * @param {Object} options.canvasScaleControl - 画布缩放控制对象
 * @param {Ref} options.canvasScaleControl.scrollMode - 滚动模式
 * @param {Ref} options.canvasScaleControl.canvasScale - 画布缩放比例
 * @param {Ref} options.canvasScaleControl.userHasManuallyScrolled - 用户是否手动滚动
 * @param {Function} options.canvasScaleControl.updateCanvasDisplaySize - 更新画布显示尺寸
 * @param {Function} options.renderAllLayers - 渲染所有图层函数
 * @param {Object} options.historyControl - 历史记录控制对象
 * @param {Function} options.historyControl.saveCurrentPsdHistory - 保存当前历史
 * @param {Function} options.historyControl.loadPsdFromHistory - 从历史加载
 * @param {Function} options.historyControl.clearPsdHistory - 清空历史
 * @param {Function} [options.historyControl.exportPsdHistory] - 导出历史
 * @param {Function} [options.historyControl.importPsdHistory] - 导入历史
 * @param {Object} options.presetControl - 预设控制对象
 * @param {Function} options.presetControl.handleExportPreset - 导出预设
 * @param {Function} options.presetControl.handleImportPreset - 导入预设
 * @param {Object} options.templateControl - 模板控制对象
 * @param {Function} options.templateControl.handleExportTemplate - 导出模板
 * @param {Function} options.templateControl.handleImportTemplate - 导入模板
 * @param {Function} options.templateControl.switchTemplateType - 切换模板类型
 * @param {Ref} options.currentTab - 当前标签页
 * @param {Function} options.switchTab - 切换标签页函数
 * @param {Function} options.renderTemplatesPreviews - 渲染模板预览函数
 * @param {Object} options.message - Naive UI message实例
 * @returns {Object} 更多菜单相关状态和方法
 */
export function useMoreMenu({
  canvasScaleControl,
  renderAllLayers,
  historyControl,
  presetControl,
  templateControl,
  currentTab,
  switchTab,
  renderTemplatesPreviews,
  message
}) {
  // 1、定义更多按钮下拉菜单选项
  const moreOptions = computed(() => [
    {
      label: '切换画布缩放',
      key: 'toggleCanvasScale',
      props: {
        title: '切换到画布缩放模式（鼠标滚轮缩放画布）'
      }
    },
    {
      label: '切换区域调整',
      key: 'toggleRegionAdjust',
      props: {
        title: '切换到区域调整模式（鼠标滚轮滚动区域）'
      }
    },
    {
      label: '保存历史',
      key: 'saveHistory',
      props: {
        title: '保存当前打开的所有PSD文件路径到历史记录'
      }
    },
    {
      label: '加载历史',
      key: 'loadHistory',
      props: {
        title: '从历史记录中加载之前打开的PSD文件'
      }
    },
    {
      label: '清空历史',
      key: 'clearHistory',
      props: {
        title: '清空所有历史记录'
      }
    },
    {
      label: '导出历史',
      key: 'exportHistory',
      props: {
        title: '手动导出历史记录列表为 JSON 文件'
      }
    },
    {
      label: '导入历史',
      key: 'importHistory',
      props: {
        title: '从 JSON 文件导入历史记录列表'
      }
    },
    {
      type: 'divider',
      key: 'divider1'
    },
    {
      label: '导出预设',
      key: 'exportPreset',
      props: {
        title: '导出所有PSD的预设为JSON文件（用于备份或分享）'
      }
    },
    {
      label: '导入预设',
      key: 'importPreset',
      props: {
        title: '从JSON文件导入所有PSD的预设（自动合并去重）'
      }
    },
    {
      type: 'divider',
      key: 'divider2'
    },
    {
      label: '导出动作模板',
      key: 'exportTemplate1',
      props: {
        title: '导出动作模板为JSON文件（用于备份或分享动作配置）'
      }
    },
    {
      label: '导入动作模板',
      key: 'importTemplate1',
      props: {
        title: '从JSON文件导入动作模板（自动合并去重）'
      }
    },
    {
      type: 'divider',
      key: 'divider3'
    },
    {
      label: '导出表情模板',
      key: 'exportTemplate2',
      props: {
        title: '导出表情模板为JSON文件（用于备份或分享表情配置）'
      }
    },
    {
      label: '导入表情模板',
      key: 'importTemplate2',
      props: {
        title: '从JSON文件导入表情模板（自动合并去重）'
      }
    }
  ])

  /**
   * 处理更多按钮选择
   * 处理流程：
   * 1、读取画布控制，按菜单键进入对应功能分支
   * 2、画布模式变更时重置缩放并重绘，历史和预设操作委托各自模块
   * 3、模板操作先切换类型，导入新增内容后切换标签或刷新预览
   * @param {string} key - 选项的key
   */
  const handleMoreSelect = async (key) => {
    // 1、取得画布依赖后按菜单键分派操作
    const { scrollMode, canvasScale, userHasManuallyScrolled, updateCanvasDisplaySize } = canvasScaleControl
    
    switch (key) {
      // 2、画布模式重置尺寸与滚动状态，其他基础操作委托对应模块
      case 'toggleCanvasScale':
        // 切换到画布缩放模式
        if (scrollMode.value !== 'scale') {
          scrollMode.value = 'scale'
          canvasScale.value = 1.0
          userHasManuallyScrolled.value = false
          updateCanvasDisplaySize()
          renderAllLayers()
          message.success('已切换到画布缩放模式')
        }
        break
        
      case 'toggleRegionAdjust':
        // 切换到区域调整模式
        if (scrollMode.value !== 'region') {
          scrollMode.value = 'region'
          canvasScale.value = 1.0
          userHasManuallyScrolled.value = false
          updateCanvasDisplaySize()
          renderAllLayers()
          message.success('已切换到区域调整模式')
        }
        break
        
      case 'saveHistory':
        historyControl.saveCurrentPsdHistory()
        break
        
      case 'loadHistory':
        historyControl.loadPsdFromHistory()
        break
        
      case 'clearHistory':
        historyControl.clearPsdHistory()
        break

      case 'exportHistory':
        if (historyControl.exportPsdHistory) {
          historyControl.exportPsdHistory()
        } else {
          message.error('历史导出功能尚未初始化')
        }
        break

      case 'importHistory':
        if (historyControl.importPsdHistory) {
          historyControl.importPsdHistory()
        } else {
          message.error('历史导入功能尚未初始化')
        }
        break
        
      case 'exportPreset':
        presetControl.handleExportPreset()
        break
        
      case 'importPreset':
        presetControl.handleImportPreset()
        break
        
      // 3、模板导入导出需先选择对应类型，并在导入后刷新目标视图
      case 'exportTemplate1':
        if (templateControl && templateControl.handleExportTemplate && templateControl.switchTemplateType) {
          // 静默切换到动作模板
          templateControl.switchTemplateType('template1', true)
          // 导出动作模板
          templateControl.handleExportTemplate()
        } else {
          message.error('模板功能尚未初始化')
        }
        break
        
      case 'importTemplate1':
        if (templateControl && templateControl.handleImportTemplate && templateControl.switchTemplateType) {
          // 静默切换到动作模板
          templateControl.switchTemplateType('template1', true)
          // 导入动作模板
          const result1 = await templateControl.handleImportTemplate()
          // 如果导入成功，渲染预览
          if (result1 && result1.success && result1.addedCount > 0) {
            // 如果不在动作模板标签页，切换过去
            if (currentTab.value !== 'template1' && switchTab) {
              setTimeout(() => {
                switchTab('template1')
              }, 100)
            } else if (renderTemplatesPreviews) {
              // 如果已经在动作模板标签页，直接渲染预览
              setTimeout(async () => {
                await renderTemplatesPreviews()
              }, 150)
            }
          }
        } else {
          message.error('模板功能尚未初始化')
        }
        break
        
      case 'exportTemplate2':
        if (templateControl && templateControl.handleExportTemplate && templateControl.switchTemplateType) {
          // 静默切换到表情模板
          templateControl.switchTemplateType('template2', true)
          // 导出表情模板
          templateControl.handleExportTemplate()
        } else {
          message.error('模板功能尚未初始化')
        }
        break
        
      case 'importTemplate2':
        if (templateControl && templateControl.handleImportTemplate && templateControl.switchTemplateType) {
          // 静默切换到表情模板
          templateControl.switchTemplateType('template2', true)
          // 导入表情模板
          const result2 = await templateControl.handleImportTemplate()
          // 如果导入成功，渲染预览
          if (result2 && result2.success && result2.addedCount > 0) {
            // 如果不在表情模板标签页，切换过去
            if (currentTab.value !== 'template2' && switchTab) {
              setTimeout(() => {
                switchTab('template2')
              }, 100)
            } else if (renderTemplatesPreviews) {
              // 如果已经在表情模板标签页，直接渲染预览
              setTimeout(async () => {
                await renderTemplatesPreviews()
              }, 150)
            }
          }
        } else {
          message.error('模板功能尚未初始化')
        }
        break
    }
  }

  // 2、向页面暴露菜单配置及统一选择入口
  return {
    moreOptions,
    handleMoreSelect
  }
}
