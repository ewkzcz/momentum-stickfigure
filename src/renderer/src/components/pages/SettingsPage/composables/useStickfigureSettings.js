/** 人物设置域：管理人物表单状态、配置保存、输出目录选择和图层名称重置。 */
import { reactive, ref } from 'vue'
import { createStickfigureBackupSnapshot } from './settingsArchive.js'

/**
 * 创建人物设置状态与操作。
 * 处理流程：
 * 1、接收页面提示、应用版本、生图配置和共用路径校验函数，分配状态与默认常量。
 * 2、在页面原配置初始化位置读取本地配置，创建唯一的人物响应式对象。
 * 3、封装原有保存、选目录和重置流程，仅返回页面实际使用的状态、操作与常量。
 */
export function useStickfigureSettings({ message, showSaveRestartTip, appVersion, geminiConfig, isAbsolutePath }) {
  // 1、状态、函数与常量的分配不读写外部环境；本地配置读取保留在生图域创建之后。
  const isSavingStickfigure = ref(false)
  const isSelectingStickfigureFolder = ref(false)

  /**
   * 推导默认人物图片导出目录。
   * 处理流程：
   * 1、读取用户目录，缺失时使用相对导出目录。
   * 2、按平台构造系统图片目录下的工具输出路径。
   */
  const getDefaultPicturesPath = () => {
    // 1、为未保存输出位置的配置提供默认值。
    const homedir = window.env?.homedir || ''
    const platform = window.env?.platform || 'win32'

    if (!homedir) {
      // 如果无法获取homedir，使用当前目录
      return './简笔画导出'
    }

    // 2、构造平台对应的图片导出路径。
    if (platform === 'win32') {
      // Windows: C:\Users\{username}\Pictures\简笔画导出
      return `${homedir}\\Pictures\\简笔画导出`
    } else if (platform === 'darwin') {
      // MacOS: /Users/{username}/Pictures/简笔画导出
      return `${homedir}/Pictures/简笔画导出`
    } else {
      // Linux: /home/{username}/Pictures/简笔画导出
      return `${homedir}/Pictures/简笔画导出`
    }
  }

  // 导出文件名规则选项
  const fileNamingRuleOptions = [
    { label: '时间戳+压缩语义信息（如：20251028142530双手惊恐.png）', value: 'timestamp-semantic' },
    { label: 'Hash+压缩语义信息（如：a3f9b2k5双手惊恐.png）', value: 'hash-semantic' },
    { label: '仅时间戳（如：20251028142530.png）', value: 'timestamp-only' },
    { label: '仅Hash（如：a3f9b2k5m7p4q8.png）', value: 'hash-only' }
  ]

  // 前手分组配置默认值常量
  const DEFAULT_FRONT_HAND_BOTH_NAMES = '交叉、合十、抱拳、结印、托脸、戳手指、双手抱臂、敲手'
  const DEFAULT_FRONT_HAND_RIGHT_NAMES = '伏案右、伏案右边、拍胸、拍胸右、拍胸右边、拍胸口、拍胸口右、拍胸口右边、端起、端起右、端起右边、捂嘴右、捂嘴右边、拎东西、扶着头、摸头右、摸头右（2）、举手右、托腮（2）、擦汗、拳胸、吃东西动作、后手举起、单手结印、擦泪、比枪'

  // 图组名称配置默认值常量（包含常见变体）
  const DEFAULT_GROUP_NAMES = {
    frontHand: '前手、紧袖口1、古代长袖1、现代长袖1、长紧袖口1、上手、上手 副本、后手前置',
    backHand: '后手、前层后手、紧袖口2、古代长袖2、现代长袖2、长紧袖口2、下手、下手 副本、后手后置',
    bothHands: '双手、前手（双手）、前手(双手)',
    upperBody: '上身、上半身',
    lowerBody: '下身、下半身',
    action: '动作、手部',
    // 表情图组统一配置（包含所有表情变体）
    expression: '表情、表情(合并)、表情（合并）、表情1、表情2、专属表情、专属表情1、专属表情2、专属表情3、专属表情【灰豆绿色】、专属表情【粉色】、辅助表情、豆豆眼、豆豆眼1、豆豆眼2、豆豆眼表情、豆豆眼表情1、豆豆眼表情2、表情豆豆眼、帅哥眼睛、眼睛女、眼睛男、眉毛、眼睛、嘴、新表情、新新表情、脸 副本、眉毛 副本、嘴 副本、眼睛 副本、定制表情、定制表情1、定制表情2'
  }

  /**
   * 初始化人物插件配置。
   * 处理流程：
   * 1、读取本地配置，逐字段补齐导出规则、匹配和图组名称。
   * 2、无保存值或解析失败时返回完整默认配置。
   */
  const loadInitialStickfigureConfig = () => {
    // 1、布尔字段显式判断 undefined，保留用户保存的关闭状态。
    try {
      const savedConfig = localStorage.getItem('stickfigure-config')
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig)
        console.log('📖 初始化加载简笔画配置:', parsed)
        console.log('📋 图组名称配置:', parsed.groupNames)

        // 确保必要字段存在
        return {
          outputRoot: parsed.outputRoot || getDefaultPicturesPath(),
          overwriteMode: parsed.overwriteMode || 'rename', // 保留字段以兼容旧版本
          fileNamingRule: parsed.fileNamingRule || 'timestamp-semantic', // 新的文件名规则
          duplicateFileHandling: parsed.duplicateFileHandling || 'addIndex', // 同名文件处理方式
          createPsdFolder: parsed.createPsdFolder !== undefined ? parsed.createPsdFolder : true,
          enableFuzzyMatch: parsed.enableFuzzyMatch !== undefined ? parsed.enableFuzzyMatch : true, // 默认启用模糊匹配
          frontHandBothNames: parsed.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES,
          frontHandRightNames: parsed.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES,
          groupNames: {
            frontHand: parsed.groupNames?.frontHand || DEFAULT_GROUP_NAMES.frontHand,
            backHand: parsed.groupNames?.backHand || DEFAULT_GROUP_NAMES.backHand,
            bothHands: parsed.groupNames?.bothHands || DEFAULT_GROUP_NAMES.bothHands,
            upperBody: parsed.groupNames?.upperBody || DEFAULT_GROUP_NAMES.upperBody,
            lowerBody: parsed.groupNames?.lowerBody || DEFAULT_GROUP_NAMES.lowerBody,
            action: parsed.groupNames?.action || DEFAULT_GROUP_NAMES.action,
            expression: parsed.groupNames?.expression || DEFAULT_GROUP_NAMES.expression
          }
        }
      }
    } catch (error) {
      console.error('初始化加载配置失败:', error)
    }

    // 2、默认配置包含完整图组结构，保证表单可直接绑定嵌套字段。
    return {
      outputRoot: getDefaultPicturesPath(),
      overwriteMode: 'rename', // 保留字段以兼容旧版本
      fileNamingRule: 'timestamp-semantic', // 新的文件名规则，默认为时间戳+语义信息
      duplicateFileHandling: 'addIndex', // 同名文件处理方式，默认添加序号
      createPsdFolder: true,
      enableFuzzyMatch: true, // 默认启用模糊匹配
      frontHandBothNames: DEFAULT_FRONT_HAND_BOTH_NAMES,
      frontHandRightNames: DEFAULT_FRONT_HAND_RIGHT_NAMES,
      groupNames: {
        frontHand: DEFAULT_GROUP_NAMES.frontHand,
        backHand: DEFAULT_GROUP_NAMES.backHand,
        bothHands: DEFAULT_GROUP_NAMES.bothHands,
        upperBody: DEFAULT_GROUP_NAMES.upperBody,
        lowerBody: DEFAULT_GROUP_NAMES.lowerBody,
        action: DEFAULT_GROUP_NAMES.action,
        expression: DEFAULT_GROUP_NAMES.expression
      }
    }
  }

  // 2、仅此处读取初始本地配置；页面随后才创建两项悬浮预览设置。
  const stickfigureConfig = reactive(loadInitialStickfigureConfig())

  // ==================== 简笔画人物插件配置管理 ====================

  /**
   * 保存人物导出和图层匹配设置。
   * 处理流程：
   * 1、校验绝对输出目录，规范空名称并组装保存对象。
   * 2、写入配置并回读，更新表单中被默认值补齐的字段。
   * 3、尝试备份全部配置，反馈保存结果并恢复按钮状态。
   */
  const saveStickfigureConfig = async () => {
    try {
      isSavingStickfigure.value = true

      // 1、保存根目录必须非空且为绝对路径。
      if (!stickfigureConfig.outputRoot.trim()) {
        message.error('请选择图片保存根目录', {
          duration: 4000,
          keepAliveOnHover: true
        })
        return
      }

      if (!isAbsolutePath(stickfigureConfig.outputRoot)) {
        message.error('图片保存根目录必须是绝对路径', {
          duration: 4000,
          keepAliveOnHover: true
        })
        return
      }

      // 2、提取普通字段并为留空名称恢复默认值。
      // 如果某个图组名称为空，使用默认值
      const configToSave = {
        outputRoot: stickfigureConfig.outputRoot,
        overwriteMode: stickfigureConfig.overwriteMode,
        fileNamingRule: stickfigureConfig.fileNamingRule || 'timestamp-semantic', // 新增：文件名规则
        duplicateFileHandling: stickfigureConfig.duplicateFileHandling || 'addIndex', // 新增：同名文件处理方式
        createPsdFolder: stickfigureConfig.createPsdFolder,
        enableFuzzyMatch: stickfigureConfig.enableFuzzyMatch !== undefined ? stickfigureConfig.enableFuzzyMatch : true,
        frontHandBothNames: stickfigureConfig.frontHandBothNames.trim() || DEFAULT_FRONT_HAND_BOTH_NAMES,
        frontHandRightNames: stickfigureConfig.frontHandRightNames.trim() || DEFAULT_FRONT_HAND_RIGHT_NAMES,
        groupNames: {
          frontHand: stickfigureConfig.groupNames.frontHand.trim() || DEFAULT_GROUP_NAMES.frontHand,
          backHand: stickfigureConfig.groupNames.backHand.trim() || DEFAULT_GROUP_NAMES.backHand,
          bothHands: stickfigureConfig.groupNames.bothHands.trim() || DEFAULT_GROUP_NAMES.bothHands,
          upperBody: stickfigureConfig.groupNames.upperBody.trim() || DEFAULT_GROUP_NAMES.upperBody,
          lowerBody: stickfigureConfig.groupNames.lowerBody.trim() || DEFAULT_GROUP_NAMES.lowerBody,
          action: stickfigureConfig.groupNames.action.trim() || DEFAULT_GROUP_NAMES.action,
          expression: stickfigureConfig.groupNames.expression.trim() || DEFAULT_GROUP_NAMES.expression
        }
      }

      console.log('💾 保存简笔画配置:', configToSave)
      console.log('📋 保存的图组名称:', configToSave.groupNames)

      // 保存前检查是否有空值被替换为默认值
      const emptyFields = []
      if (!stickfigureConfig.frontHandBothNames.trim()) emptyFields.push('前手-双手名称')
      if (!stickfigureConfig.frontHandRightNames.trim()) emptyFields.push('前手-右手名称')
      if (!stickfigureConfig.groupNames.frontHand.trim()) emptyFields.push('前手图组名称')
      if (!stickfigureConfig.groupNames.backHand.trim()) emptyFields.push('后手图组名称')
      if (!stickfigureConfig.groupNames.bothHands.trim()) emptyFields.push('双手图组名称')
      if (!stickfigureConfig.groupNames.upperBody.trim()) emptyFields.push('上身图组名称')
      if (!stickfigureConfig.groupNames.lowerBody.trim()) emptyFields.push('下身图组名称')
      if (!stickfigureConfig.groupNames.action.trim()) emptyFields.push('动作图组名称')
      if (!stickfigureConfig.groupNames.expression.trim()) emptyFields.push('表情图组名称')

      if (emptyFields.length > 0) {
        console.log('⚠️ 以下字段为空，已自动填充默认值:', emptyFields.join('、'))
      }

      localStorage.setItem('stickfigure-config', JSON.stringify(configToSave))

      // 3、回读已保存内容，记录实际写入结果。
      const savedCheck = localStorage.getItem('stickfigure-config')
      const parsedCheck = JSON.parse(savedCheck)
      console.log('✅ 验证保存成功，读取到的配置:', parsedCheck.groupNames)

      // 4、将补齐后的名称同步回表单，避免显示与保存值不一致。
      stickfigureConfig.createPsdFolder = configToSave.createPsdFolder
      stickfigureConfig.enableFuzzyMatch = configToSave.enableFuzzyMatch
      stickfigureConfig.frontHandBothNames = configToSave.frontHandBothNames
      stickfigureConfig.frontHandRightNames = configToSave.frontHandRightNames
      stickfigureConfig.groupNames.frontHand = configToSave.groupNames.frontHand
      stickfigureConfig.groupNames.backHand = configToSave.groupNames.backHand
      stickfigureConfig.groupNames.bothHands = configToSave.groupNames.bothHands
      stickfigureConfig.groupNames.upperBody = configToSave.groupNames.upperBody
      stickfigureConfig.groupNames.lowerBody = configToSave.groupNames.lowerBody
      stickfigureConfig.groupNames.action = configToSave.groupNames.action
      stickfigureConfig.groupNames.expression = configToSave.groupNames.expression

      // 5、备份失败不回滚已经保存的人物配置。
      try {
        const allSettings = createStickfigureBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
        await window.electronAPI.settings.autoBackupSettings(allSettings)
        console.log('💾 配置已自动备份到用户文档目录')
      } catch (backupError) {
        console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
      }

      showSaveRestartTip('简笔画人物插件配置保存成功！')
    } catch (error) {
      console.error('保存简笔画配置失败:', error)
      message.error('保存失败: ' + error.message, {
        duration: 5000,
        keepAliveOnHover: true
      })
    } finally {
      isSavingStickfigure.value = false
    }
  }

  /**
   * 选择人物图片输出目录。
   * 处理流程：
   * 1、成功选择时更新表单并提示，取消时保持原值。
   * 2、无论成功或失败都结束选择状态。
   */
  const selectStickfigureOutputFolder = async () => {
    // 1、目录合法性由保存流程再次校验。
    try {
      isSelectingStickfigureFolder.value = true

      const result = await window.fileSystem.selectFolder()

      if (result.success && result.path) {
        stickfigureConfig.outputRoot = result.path
        message.success('图片保存根目录已设置: ' + result.path, {
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
      isSelectingStickfigureFolder.value = false
    }
  }

  /** 重置人物输出路径；处理流程：1、推导默认图片目录，更新表单并提示。 */
  const resetStickfigureOutputToDefault = () => {
    // 1、重置操作尚未写入持久化配置。
    const defaultPath = getDefaultPicturesPath()
    stickfigureConfig.outputRoot = defaultPath
    message.success('已重置为默认路径: ' + defaultPath, {
      duration: 3000,
      keepAliveOnHover: true
    })
    console.log('重置简笔画输出路径为:', defaultPath)
  }

  /** 重置前手双手名称；处理流程：1、用默认匹配名称覆盖表单字段并提示。 */
  const resetFrontHandBothNames = () => {
    // 1、恢复内置名称集合，等待用户保存。
    stickfigureConfig.frontHandBothNames = DEFAULT_FRONT_HAND_BOTH_NAMES
    message.success('已重置前手-双手名称为默认值', {
      duration: 3000,
      keepAliveOnHover: true
    })
    console.log('重置前手-双手名称为:', DEFAULT_FRONT_HAND_BOTH_NAMES)
  }

  /** 重置前手右手名称；处理流程：1、用默认匹配名称覆盖表单字段并提示。 */
  const resetFrontHandRightNames = () => {
    // 1、恢复内置右手名称集合。
    stickfigureConfig.frontHandRightNames = DEFAULT_FRONT_HAND_RIGHT_NAMES
    message.success('已重置前手-右手名称为默认值', {
      duration: 3000,
      keepAliveOnHover: true
    })
    console.log('重置前手-右手名称为:', DEFAULT_FRONT_HAND_RIGHT_NAMES)
  }

  /**
   * 重置指定图组的匹配名称。
   * 处理流程：
   * 1、确认图组键有默认配置，写回名称并显示对应中文提示。
   */
  const resetGroupName = (groupKey) => {
    // 1、未知图组键不修改现有配置。
    if (DEFAULT_GROUP_NAMES[groupKey]) {
      stickfigureConfig.groupNames[groupKey] = DEFAULT_GROUP_NAMES[groupKey]
      const groupNameMap = {
        frontHand: '前手',
        backHand: '后手',
        bothHands: '双手',
        upperBody: '上身',
        lowerBody: '下身',
        action: '动作',
        expression: '表情'
      }
      message.success(`已重置${groupNameMap[groupKey]}图组名称为默认值`, {
        duration: 3000,
        keepAliveOnHover: true
      })
      console.log(`重置${groupNameMap[groupKey]}图组名称为:`, DEFAULT_GROUP_NAMES[groupKey])
    }
  }

  /**
   * 恢复备份中的人物配置。
   * 处理流程：
   * 1、沿用原外层恢复结果读取顺序，将人物对象写回本地存储并记录日志。
   * 2、异常继续交给页面原恢复 catch 处理，不新增校验或回滚。
   */
  const restoreStickfigureSettingsFromBackup = (restoreResult) => {
    // 1、保留原条件及重复属性读取，不提前缓存备份对象。
    if (restoreResult.settings.stickfigureConfig) {
      localStorage.setItem('stickfigure-config', JSON.stringify(restoreResult.settings.stickfigureConfig))
      console.log('✅ 简笔画配置已从备份恢复')
    }
  }

  /**
   * 从本地存储重新加载人物表单。
   * 处理流程：
   * 1、同步读取并解析人物配置，保留原缺省值及布尔字段判断。
   * 2、仅在图组对象存在时更新名称；原本遗漏的文件命名字段仍不参与本次重载。
   */
  const reloadStickfigureSettingsFromStorage = () => {
    // 1、解析异常由页面原加载 catch 处理，后续配置域仍按原流程停止。
    console.log('🔄 重新加载简笔画配置...')
    const savedStickfigureConfig = localStorage.getItem('stickfigure-config')
    if (savedStickfigureConfig) {
      const parsed = JSON.parse(savedStickfigureConfig)
      console.log('📖 从localStorage加载简笔画配置:', parsed)
      console.log('📋 图组名称配置:', parsed.groupNames)

      // 更新 reactive 对象的每个属性
      stickfigureConfig.outputRoot = parsed.outputRoot || getDefaultPicturesPath()
      stickfigureConfig.overwriteMode = parsed.overwriteMode || 'rename'
      stickfigureConfig.createPsdFolder = parsed.createPsdFolder !== undefined ? parsed.createPsdFolder : true
      stickfigureConfig.enableFuzzyMatch = parsed.enableFuzzyMatch !== undefined ? parsed.enableFuzzyMatch : true
      stickfigureConfig.frontHandBothNames = parsed.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES
      stickfigureConfig.frontHandRightNames = parsed.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES

      // 更新图组名称配置
      if (parsed.groupNames) {
        stickfigureConfig.groupNames.frontHand = parsed.groupNames.frontHand || DEFAULT_GROUP_NAMES.frontHand
        stickfigureConfig.groupNames.backHand = parsed.groupNames.backHand || DEFAULT_GROUP_NAMES.backHand
        stickfigureConfig.groupNames.bothHands = parsed.groupNames.bothHands || DEFAULT_GROUP_NAMES.bothHands
        stickfigureConfig.groupNames.upperBody = parsed.groupNames.upperBody || DEFAULT_GROUP_NAMES.upperBody
        stickfigureConfig.groupNames.lowerBody = parsed.groupNames.lowerBody || DEFAULT_GROUP_NAMES.lowerBody
        stickfigureConfig.groupNames.action = parsed.groupNames.action || DEFAULT_GROUP_NAMES.action
        stickfigureConfig.groupNames.expression = parsed.groupNames.expression || DEFAULT_GROUP_NAMES.expression
      }

      console.log('✅ 简笔画配置已更新到组件')
    } else {
      console.log('⚠️ localStorage中没有找到简笔画配置，使用默认值')
    }
  }

  /**
   * 应用导入文件中的人物配置。
   * 处理流程：
   * 1、按原顺序为表单补齐字段，保留缺少整个图组对象时的现有名称。
   * 2、持久化原导入对象而非补齐后的表单；写入异常继续由页面原导入 catch 处理。
   */
  const applyImportedStickfigureSettings = (importedSettings) => {
    // 1、调用位置仍在文件读取与版本确认之后，不增加异步边界。
    if (importedSettings.stickfigureConfig) {
      const imported = importedSettings.stickfigureConfig

      // 更新基础配置
      stickfigureConfig.outputRoot = imported.outputRoot || getDefaultPicturesPath()
      stickfigureConfig.overwriteMode = imported.overwriteMode || 'rename'
      stickfigureConfig.fileNamingRule = imported.fileNamingRule || 'timestamp-semantic' // 新增：文件名规则
      stickfigureConfig.duplicateFileHandling = imported.duplicateFileHandling || 'addIndex' // 新增：同名文件处理方式
      stickfigureConfig.createPsdFolder = imported.createPsdFolder !== undefined ? imported.createPsdFolder : true
      stickfigureConfig.enableFuzzyMatch = imported.enableFuzzyMatch !== undefined ? imported.enableFuzzyMatch : true
      stickfigureConfig.frontHandBothNames = imported.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES
      stickfigureConfig.frontHandRightNames = imported.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES

      // 更新图组名称配置
      if (imported.groupNames) {
        stickfigureConfig.groupNames.frontHand = imported.groupNames.frontHand || DEFAULT_GROUP_NAMES.frontHand
        stickfigureConfig.groupNames.backHand = imported.groupNames.backHand || DEFAULT_GROUP_NAMES.backHand
        stickfigureConfig.groupNames.bothHands = imported.groupNames.bothHands || DEFAULT_GROUP_NAMES.bothHands
        stickfigureConfig.groupNames.upperBody = imported.groupNames.upperBody || DEFAULT_GROUP_NAMES.upperBody
        stickfigureConfig.groupNames.lowerBody = imported.groupNames.lowerBody || DEFAULT_GROUP_NAMES.lowerBody
        stickfigureConfig.groupNames.action = imported.groupNames.action || DEFAULT_GROUP_NAMES.action
        stickfigureConfig.groupNames.expression = imported.groupNames.expression || DEFAULT_GROUP_NAMES.expression
      }

      // 保存到 localStorage
      localStorage.setItem('stickfigure-config', JSON.stringify(imported))
      console.log('[设置页] 简笔画配置已导入并更新到界面')
    }
  }

  // 3、跨域恢复、导入与模板继续共用同一配置对象；初始化函数保持私有。
  return {
    restoreStickfigureSettingsFromBackup,
    reloadStickfigureSettingsFromStorage,
    applyImportedStickfigureSettings,
    stickfigureConfig,
    isSavingStickfigure,
    isSelectingStickfigureFolder,
    fileNamingRuleOptions,
    DEFAULT_GROUP_NAMES,
    saveStickfigureConfig,
    selectStickfigureOutputFolder,
    resetStickfigureOutputToDefault,
    resetFrontHandBothNames,
    resetFrontHandRightNames,
    resetGroupName
  }
}
