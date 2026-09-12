/** 抠图高清设置：管理高清表单状态、路径选择和持久化；跨域恢复与导入仍由设置页面协调。 */
import { reactive, ref } from 'vue'
import { createHdToolkitBackupSnapshot } from './settingsArchive.js'

/**
 * 创建抠图高清设置状态与操作。
 * 处理流程：
 * 1、接收页面消息、保存提示、版本及生图配置依赖，初始化高清表单与忙碌状态。
 * 2、提供路径选择、后端加载与保存操作，沿用原有字段兼容和备份语义。
 * 3、返回同一响应式配置供页面跨域恢复、导入和导出使用，不接管页面挂载时序。
 */
export function useHdToolkitSettings({ message, showSaveRestartTip, appVersion, geminiConfig }) {
  // 1、状态归属本模块，配置初始化仍在页面原有调用位置执行。
  // 抠图高清设置相关状态
  const isSavingHdToolkit = ref(false)
  const isSelectingPython = ref(false)
  const isSelectingRemovebgWeights = ref(false)
  const isSelectingHighresWeights = ref(false)
  const isSelectingOutput = ref(false)

  /**
   * 推导旧版抠图高清资源目录。
   * 处理流程：
   * 1、从应用路径移除打包资源后缀。
   * 2、按旧版 Windows 目录约定拼接可选子路径。
   */
  const getDefaultHdToolkitPath = (subPath = '') => {
    // 1、此函数用于旧配置导入的缺省路径兼容。
    const appPath = window.env?.appPath || ''
    if (!appPath) return ''

    // 获取应用根目录（去除 resources\app.asar 部分）
    const rootPath = appPath.replace(/[\\\/]resources[\\\/]app\.asar.*$/, '')

    // 2、可选子路径附加在抠图高清资源目录下。
    if (subPath) {
      return `${rootPath}\\hd-remove_bg\\${subPath}`
    }
    return `${rootPath}\\hd-remove_bg`
  }

  /**
   * 初始化抠图高清路径配置。
   * 处理流程：
   * 1、读取保存值并兼容旧版 Path 后缀字段。
   * 2、无有效配置时返回空路径，等待用户选择环境和模型。
   */
  const loadInitialHdToolkitConfig = () => {
    // 1、当前字段优先，旧字段仅作为兼容来源。
    try {
      const savedConfig = localStorage.getItem('hd-toolkit-config')
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig)
        console.log('📖 初始化加载抠图高清配置:', parsed)
        // 兼容旧字段名
        return {
          pythonHome: parsed.pythonHome || parsed.pythonPath || '',
          removebgWeightsDir: parsed.removebgWeightsDir || parsed.removebgWeightsPath || '',
          highresWeightsDir: parsed.highresWeightsDir || parsed.highresWeightsPath || '',
          outputDir: parsed.outputDir || parsed.outputPath || ''
        }
      }
    } catch (error) {
      console.error('初始化加载抠图高清配置失败:', error)
    }

    // 2、默认不预设解释器或权重位置。
    return {
      pythonHome: '',
      removebgWeightsDir: '',
      highresWeightsDir: '',
      outputDir: ''
    }
  }

  const hdToolkitConfig = reactive(loadInitialHdToolkitConfig())

  // 2、路径选择与持久化操作保持原有实现，由页面绑定与调用。
  // ==================== 抠图高清设置功能 ====================

  /**
   * 选择Python解释器路径
   * 处理流程：
   * 1、打开可执行文件选择器，成功时更新解释器表单路径。
   * 2、显示选择结果并在结束时解除选择状态。
   */
  const selectPythonPath = async () => {
    // 1、选择器沿用当前扩展名规则，实际解释器检查由工具服务执行。
    try {
      isSelectingPython.value = true
      const result = await window.fileSystem.selectFile({
        filters: [
          { name: 'Python可执行文件', extensions: ['exe'] }
        ],
        properties: ['openFile']
      })

      if (result.success && result.path) {
        hdToolkitConfig.pythonHome = result.path
        message.success('Python路径已设置', { duration: 2000 })
      }
    } catch (error) {
      console.error('选择Python路径失败:', error)
      message.error('选择失败: ' + error.message)
    } finally {
      isSelectingPython.value = false
    }
  }

  /**
   * 选择去背景权重目录
   * 处理流程：
   * 1、请求系统选择目录，将成功结果写入抠图模型路径。
   * 2、保留取消时的原值，结束时恢复按钮状态。
   */
  const selectRemovebgWeightsPath = async () => {
    // 1、仅设置目录，模型文件完整性在工具运行时检查。
    try {
      isSelectingRemovebgWeights.value = true
      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        hdToolkitConfig.removebgWeightsDir = result.path
        message.success('去背景权重目录已设置', { duration: 2000 })
      }
    } catch (error) {
      console.error('选择去背景权重目录失败:', error)
      message.error('选择失败: ' + error.message)
    } finally {
      isSelectingRemovebgWeights.value = false
    }
  }

  /**
   * 选择高清权重目录
   * 处理流程：
   * 1、请求系统选择目录，将成功结果写入高清模型路径。
   * 2、处理异常并恢复按钮状态。
   */
  const selectHighresWeightsPath = async () => {
    // 1、高清和抠图模型目录分别保存。
    try {
      isSelectingHighresWeights.value = true
      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        hdToolkitConfig.highresWeightsDir = result.path
        message.success('高清权重目录已设置', { duration: 2000 })
      }
    } catch (error) {
      console.error('选择高清权重目录失败:', error)
      message.error('选择失败: ' + error.message)
    } finally {
      isSelectingHighresWeights.value = false
    }
  }

  /**
   * 选择输出目录
   * 处理流程：
   * 1、选择目录并更新抠图高清输出路径，结束时清除选择状态。
   */
  const selectOutputPath = async () => {
    // 1、取消选择不覆盖表单中的现有路径。
    try {
      isSelectingOutput.value = true
      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        hdToolkitConfig.outputDir = result.path
        message.success('输出目录已设置', { duration: 2000 })
      }
    } catch (error) {
      console.error('选择输出目录失败:', error)
      message.error('选择失败: ' + error.message)
    } finally {
      isSelectingOutput.value = false
    }
  }

  /**
   * 保存抠图高清配置
   * 处理流程：
   * 1、验证解释器路径并提取环境、模型和输出字段。
   * 2、优先保存到主进程，接口缺失时仍保存到浏览器存储。
   * 3、尝试自动备份，反馈保存结果并结束忙碌状态。
   */
  const saveHdToolkitConfig = async () => {
    // 1、存在后端接口但返回失败时中断，不继续写入本地备份。
    try {
      isSavingHdToolkit.value = true

      // 验证必填项
      if (!hdToolkitConfig.pythonHome || !hdToolkitConfig.pythonHome.trim()) {
        message.error('请选择Python解释器路径')
        return
      }

      const configToSave = {
        pythonHome: hdToolkitConfig.pythonHome,
        removebgWeightsDir: hdToolkitConfig.removebgWeightsDir,
        highresWeightsDir: hdToolkitConfig.highresWeightsDir,
        outputDir: hdToolkitConfig.outputDir
      }

      console.log('💾 保存抠图高清配置:', configToSave)

      // 2、先让主进程持久化工具配置，成功后再同步页面存储。
      if (window.hdToolkit?.saveConfig) {
        const response = await window.hdToolkit.saveConfig(configToSave)
        if (!response?.success) {
          throw new Error(response?.message || '保存配置到后端失败')
        }
        console.log('✅ 配置已保存到后端')
      } else {
        console.warn('⚠️ window.hdToolkit.saveConfig 不可用，仅保存到 localStorage')
      }

      // 3、本地配置供字幕提取等共享环境的页面读取。
      localStorage.setItem('hd-toolkit-config', JSON.stringify(configToSave))

      // 自动备份配置到用户文档目录
      try {
        const allSettings = createHdToolkitBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
        await window.electronAPI.settings.autoBackupSettings(allSettings)
        console.log('💾 配置已自动备份到用户文档目录')
      } catch (backupError) {
        console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
      }

      showSaveRestartTip('抠图高清配置保存成功！')
    } catch (error) {
      console.error('保存抠图高清配置失败:', error)
      message.error('保存失败: ' + error.message)
    } finally {
      isSavingHdToolkit.value = false
    }
  }

  /**
   * 从后端加载抠图高清配置
   * 处理流程：
   * 1、读取主进程工具配置，兼容当前字段与旧版路径字段。
   * 2、更新表单后同步浏览器存储，失败时保留原本地配置。
   */
  const loadHdToolkitConfigFromBackend = async () => {
    // 1、桥接接口缺失时无需覆盖本地初始化结果。
    try {
      if (window.hdToolkit?.getInitialData) {
        console.log('🔄 从后端加载抠图高清配置...')
        const response = await window.hdToolkit.getInitialData()

        if (response?.success && response.data?.config) {
          const cfg = response.data.config
          console.log('✅ 从后端加载到配置:', cfg)

          // 更新配置对象
          hdToolkitConfig.pythonHome = cfg.pythonHome || cfg.pythonPath || ''
          hdToolkitConfig.removebgWeightsDir = cfg.removebgWeightsDir || cfg.removebgWeightsPath || ''
          hdToolkitConfig.highresWeightsDir = cfg.highresWeightsDir || cfg.highresWeightsPath || ''
          hdToolkitConfig.outputDir = cfg.outputDir || cfg.outputPath || ''

          // 2、统一以当前字段名写回本地存储，供其他页面复用。
          localStorage.setItem('hd-toolkit-config', JSON.stringify({
            pythonHome: hdToolkitConfig.pythonHome,
            removebgWeightsDir: hdToolkitConfig.removebgWeightsDir,
            highresWeightsDir: hdToolkitConfig.highresWeightsDir,
            outputDir: hdToolkitConfig.outputDir
          }))

          console.log('✅ 抠图高清配置已从后端加载')
        } else {
          console.warn('⚠️ 后端返回的配置数据为空，使用本地配置')
        }
      } else {
        console.warn('⚠️ window.hdToolkit.getInitialData 不可用，使用本地配置')
      }
    } catch (error) {
      console.error('❌ 从后端加载抠图高清配置失败:', error)
      // 失败时继续使用 localStorage 中的配置
    }
  }

  // 3、页面共享同一状态，并继续负责跨域恢复、导入和导出。
  return {
    hdToolkitConfig,
    isSavingHdToolkit,
    isSelectingPython,
    isSelectingRemovebgWeights,
    isSelectingHighresWeights,
    isSelectingOutput,
    getDefaultHdToolkitPath,
    loadInitialHdToolkitConfig,
    loadHdToolkitConfigFromBackend,
    saveHdToolkitConfig,
    selectPythonPath,
    selectRemovebgWeightsPath,
    selectHighresWeightsPath,
    selectOutputPath
  }
}
