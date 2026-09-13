/** 生图设置域：管理生图表单状态、配置保存和项目目录选择。 */
import { reactive, ref } from 'vue'
import { normalizeApiBaseUrl } from '@shared/api-url.js'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import { createGeminiBackupSnapshot } from './settingsArchive.js'

/**
 * 创建生图设置状态与操作。
 * 处理流程：
 * 1、接收页面提示、应用版本和共用路径校验函数，初始化状态与默认项目路径。
 * 2、封装原有保存、选目录和重置流程，向页面返回实际使用的状态与操作。
 */
export function useGeminiSettings({ message, showSaveRestartTip, appVersion, isAbsolutePath }) {
  // 1、状态与配置仅创建一次，页面跨域恢复、导入和备份共用此对象。
  const isSavingGemini = ref(false)
  const isSelectingFolder = ref(false)

  /**
   * 推导默认生图项目路径。
   * 处理流程：
   * 1、读取用户目录和系统平台。
   * 2、构造图片目录中的项目路径，缺少用户目录时使用相对路径。
   */
  const getDefaultProjectRoot = () => {
    // 1、桌面环境信息由预加载提供。
    const homedir = window.env?.homedir || ''
    const platform = window.env?.platform || 'win32'

    if (!homedir) {
      // 如果无法获取homedir，使用相对路径
      return './gemini-image'
    }

    // 2、按平台使用对应路径分隔符。
    if (platform === 'win32') {
      // Windows: C:\Users\{username}\Pictures\GeminiImage
      return `${homedir}\\Pictures\\GeminiImage`
    } else if (platform === 'darwin') {
      // MacOS: /Users/{username}/Pictures/GeminiImage
      return `${homedir}/Pictures/GeminiImage`
    } else {
      // Linux: /home/{username}/Pictures/GeminiImage
      return `${homedir}/Pictures/GeminiImage`
    }
  }

  // API 配置（纳米香蕉生图）
  const geminiConfig = reactive({
    apiKey: '',
    baseUrl: '',
    projectRoot: getDefaultProjectRoot(), // 提供默认的绝对路径
    outputDir: 'output',
    editOutputDir: 'output',
    logDir: 'logs'
  })

  /**
   * 保存生图服务配置。
   * 处理流程：
   * 1、校验密钥、中转站地址和绝对项目路径。
   * 2、统一输出目录，保存当前键并移除旧存储键。
   * 3、尝试创建目录和自动备份，再提示保存结果并解除忙碌状态。
   */
  const saveGeminiConfig = async () => {
    try {
      isSavingGemini.value = true

      // 1、校验服务连接信息和项目路径后才写入配置。
      if (!geminiConfig.apiKey.trim()) {
        message.error('请输入纳米香蕉生图API密钥', {
          duration: 4000,
          keepAliveOnHover: true
        })
        return
      }

      geminiConfig.baseUrl = normalizeApiBaseUrl(geminiConfig.baseUrl)

      // 验证项目根路径
      if (!geminiConfig.projectRoot.trim()) {
        message.error('请选择项目根路径', {
          duration: 4000,
          keepAliveOnHover: true
        })
        return
      }

      if (!isAbsolutePath(geminiConfig.projectRoot)) {
        message.error('项目根路径必须是绝对路径', {
          duration: 4000,
          keepAliveOnHover: true
        })
        return
      }

      // 2、保存时统一编辑与生成结果的输出位置。
      geminiConfig.editOutputDir = geminiConfig.outputDir

      // 保存配置到本地存储（包括用户选择的baseUrl）
      localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
      if (localStorage.getItem('fal-config')) {
        localStorage.removeItem('fal-config')
      }

      // 3、目录创建失败只记录警告，不撤销已保存配置。
      try {
        await window.falApi?.createDirectories?.(JSON.parse(JSON.stringify(geminiConfig)))
      } catch (dirError) {
        console.warn('创建目录失败:', dirError)
      }

      // 4、备份当前各工具配置，备份失败不影响本地保存。
      try {
        const allSettings = createGeminiBackupSnapshot({ localStorage, appVersion, geminiConfig })
        await window.electronAPI.settings.autoBackupSettings(allSettings)
        console.log('💾 配置已自动备份到用户文档目录')
      } catch (backupError) {
        console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
      }

      showSaveRestartTip('纳米香蕉生图配置保存成功！')
    } catch (error) {
      console.error('保存纳米香蕉配置失败:', error)
      message.error('保存失败: ' + error.message, {
        duration: 5000,
        keepAliveOnHover: true
      })
    } finally {
      isSavingGemini.value = false
    }
  }

  /**
   * 选择生图项目根目录。
   * 处理流程：
   * 1、打开系统目录选择器，成功时更新表单，取消时保留原值。
   * 2、反馈选择失败并在结束时恢复选择按钮状态。
   */
  const selectProjectRootFolder = async () => {
    // 1、目录选择仅更新表单，持久化由保存按钮执行。
    try {
      isSelectingFolder.value = true

      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        geminiConfig.projectRoot = result.path
        message.success('项目根路径已设置: ' + result.path, {
          duration: 3000,
          keepAliveOnHover: true
        })
      } else if (result.canceled) {
        console.log('用户取消了文件夹选择')
      } else {
        message.error('选择文件夹失败: ' + (result.error || '未知错误'), {
          duration: 5000,
          keepAliveOnHover: true
        })
      }
    } catch (error) {
      console.error('选择文件夹失败:', error)
      message.error('选择文件夹失败: ' + error.message, {
        duration: 5000,
        keepAliveOnHover: true
      })
    } finally {
      isSelectingFolder.value = false
    }
  }

  /** 重置生图项目路径；处理流程：1、重新推导当前系统默认路径并更新表单提示。 */
  const resetProjectRootToDefault = () => {
    // 1、仅重置表单字段，用户保存后才持久化。
    const defaultPath = getDefaultProjectRoot()
    geminiConfig.projectRoot = defaultPath
    message.success('已重置为默认路径: ' + defaultPath, {
      duration: 3000,
      keepAliveOnHover: true
    })
    console.log('重置项目根路径为:', defaultPath)
  }

  /**
   * 从备份恢复生图持久化配置。
   * 处理流程：
   * 1、优先读取当前配置名，缺失时兼容旧名，按原顺序保存并移除旧键。
   */
  const restoreGeminiSettingsFromBackup = (restoreResult) => {
    // 1、存储异常仍由页面原恢复 catch 处理。
    const restoredGeminiConfig = restoreResult.settings.geminiConfig || restoreResult.settings.falConfig
    if (restoredGeminiConfig) {
      localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(restoredGeminiConfig))
      if (localStorage.getItem('fal-config')) {
        localStorage.removeItem('fal-config')
      }
      console.log('✅ 纳米香蕉配置已从备份恢复')
    }
  }

  /**
   * 从存储重新加载生图配置并迁移旧路径。
   * 处理流程：
   * 1、优先当前键，兼容旧键；修正原流程识别的旧路径和空路径。
   * 2、保持编辑与生成目录同步，只在路径修正时回写本地配置。
   */
  const reloadGeminiSettingsFromStorage = () => {
    // 1、保持同步异常传播，后端补充仍由页面在此操作之后发起。
    const savedGeminiConfig = localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config')
    let needsSave = false

    if (savedGeminiConfig) {
      const parsed = JSON.parse(savedGeminiConfig)

      // 检查保存的projectRoot是否包含旧的硬编码用户名或不存在的路径
      if (parsed.projectRoot &&
          (parsed.projectRoot.includes('Administrator\\Pictures\\fal-project') ||
           parsed.projectRoot.includes('~/Pictures/fal-project'))) {
        // 如果是旧的硬编码路径，使用新的默认路径
        console.log('检测到旧的projectRoot路径，使用新的默认路径')
        parsed.projectRoot = getDefaultProjectRoot()
        needsSave = true
      }

      Object.assign(geminiConfig, parsed)

      // 如果projectRoot为空或无效，设置为默认值
      if (!geminiConfig.projectRoot || geminiConfig.projectRoot.trim() === '') {
        geminiConfig.projectRoot = getDefaultProjectRoot()
        needsSave = true
      }

      // 确保编辑图片路径与生成图片路径一致
      geminiConfig.editOutputDir = geminiConfig.outputDir

      // 如果检测到需要更新路径，立即保存到localStorage
      if (needsSave) {
        console.log('自动保存更新后的配置到localStorage:', geminiConfig.projectRoot)
        localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
        if (localStorage.getItem('fal-config')) {
          localStorage.removeItem('fal-config')
        }
      }
    }
  }

  /**
   * 将导入的生图配置写入表单和存储。
   * 处理流程：
   * 1、兼容新旧配置名，沿用导入专属缺省值和输出目录规则。
   * 2、保存已补齐的表单并清理旧键，不复用正常保存校验以免改变导入语义。
   */
  const applyImportedGeminiSettings = (importedSettings) => {
    // 1、页面完成版本确认后同步调用，失败由原导入 catch 处理。
    const importedGeminiConfig = importedSettings.geminiConfig || importedSettings.falConfig
    if (importedGeminiConfig) {
      const imported = importedGeminiConfig

      // 更新所有属性
      geminiConfig.apiKey = imported.apiKey || ''
      geminiConfig.baseUrl = imported.baseUrl || ''
      geminiConfig.projectRoot = imported.projectRoot || getDefaultProjectRoot()
      geminiConfig.outputDir = imported.outputDir || 'output'
      geminiConfig.editOutputDir = imported.editOutputDir || imported.outputDir || 'output'
      geminiConfig.logDir = imported.logDir || 'logs'

      // 保存到 localStorage
      localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
      if (localStorage.getItem('fal-config')) {
        localStorage.removeItem('fal-config')
      }
      console.log('[设置页] 纳米香蕉配置已导入并更新到界面')
    }
  }

  // 2、仅暴露页面实际使用的状态与操作，保留配置对象引用。
  return {
    restoreGeminiSettingsFromBackup,
    reloadGeminiSettingsFromStorage,
    applyImportedGeminiSettings,
    geminiConfig,
    isSavingGemini,
    isSelectingFolder,
    saveGeminiConfig,
    selectProjectRootFolder,
    resetProjectRootToDefault
  }
}
