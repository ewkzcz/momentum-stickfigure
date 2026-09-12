/** 对话插件设置：管理输出配置、目录选择和保存，保持原有初始化与备份语义。 */
import { reactive, ref } from 'vue'
import { createDialogBackupSnapshot } from './settingsArchive.js'

/**
 * 创建对话插件设置状态与操作。
 * 处理流程：
 * 1、接收页面消息、保存提示、版本及生图配置依赖，在页面原有位置初始化状态。
 * 2、沿用原有目录选择与保存逻辑，不补齐旧配置字段或增加路径校验。
 * 3、返回页面使用的配置、忙碌状态和操作，初始化函数保持私有。
 */
export function useDialogSettings({ message, showSaveRestartTip, appVersion, geminiConfig }) {
  // 1、配置初始化仍在页面原有调用位置执行。
  // 对话插件设置相关状态
  const isSavingDialog = ref(false)
  const isSelectingDialogFolder = ref(false)

  /**
   * 初始化对话插件输出配置。
   * 处理流程：
   * 1、存在保存值时直接解析返回。
   * 2、读取失败或未保存时使用空输出根目录和按日期分组默认值。
   */
  function loadInitialDialogConfig() {
    // 1、保存对象直接使用，此处不执行字段补齐。
    try {
      const saved = localStorage.getItem('dialog-config')
      if (saved) {
        return JSON.parse(saved)
      }
    } catch (error) {
      console.warn('加载对话插件配置失败:', error)
    }

    // 2、默认输出目录由用户后续选择。
    return {
      outputRoot: '',
      createDateFolder: true
    }
  }

  const dialogConfig = reactive(loadInitialDialogConfig())

  // 2、目录选择与保存操作保留原有正文和调用语义。
  /**
   * 选择对话插件输出文件夹
   * 处理流程：
   * 1、打开系统目录选择器并更新成功选择的路径。
   * 2、报告错误并恢复选择按钮状态。
   */
  const selectDialogOutputFolder = async () => {
    // 1、只更新对话工具表单，不影响其他工具的输出目录。
    try {
      isSelectingDialogFolder.value = true
      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        dialogConfig.outputRoot = result.path
        message.success('输出文件夹已设置', { duration: 2000 })
      }
    } catch (error) {
      console.error('选择输出文件夹失败:', error)
      message.error('选择失败: ' + error.message)
    } finally {
      isSelectingDialogFolder.value = false
    }
  }

  /**
   * 保存对话插件配置
   * 处理流程：
   * 1、校验输出目录，保存目录和日期分组选项。
   * 2、将对话配置连同其他工具设置备份，最后反馈保存结果。
   */
  const saveDialogConfig = async () => {
    // 1、空目录不保存，其他路径规则由实际输出流程处理。
    try {
      isSavingDialog.value = true

      // 验证必填项
      if (!dialogConfig.outputRoot || !dialogConfig.outputRoot.trim()) {
        message.error('请选择图片保存目录')
        return
      }

      const configToSave = {
        outputRoot: dialogConfig.outputRoot,
        createDateFolder: dialogConfig.createDateFolder
      }

      // 2、先写入对话工具独立配置，再尝试整体备份。
      localStorage.setItem('dialog-config', JSON.stringify(configToSave))

      // 自动备份配置到用户文档目录
      try {
        const allSettings = createDialogBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
        await window.electronAPI.settings.autoBackupSettings(allSettings)
        console.log('💾 配置已自动备份到用户文档目录')
      } catch (backupError) {
        console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
      }

      showSaveRestartTip('对话插件配置保存成功！')
    } catch (error) {
      console.error('保存对话插件配置失败:', error)
      message.error('保存失败: ' + error.message)
    } finally {
      isSavingDialog.value = false
    }
  }

  // 3、仅公开页面实际使用的状态和操作。
  return {
    dialogConfig,
    isSavingDialog,
    isSelectingDialogFolder,
    selectDialogOutputFolder,
    saveDialogConfig
  }
}
