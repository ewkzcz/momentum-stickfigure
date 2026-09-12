/** 设置归档：分别组装五种保存备份快照，并提供四域当前草稿的手动导出操作。 */

/**
 * 组装生图保存后的备份快照。
 * 处理流程：
 * 1、按人物、快捷键、高清顺序读取本地配置。
 * 2、记录版本和时间，按原顺序解析存储值并深拷贝生图草稿。
 * 3、返回快照，由调用方保持原有备份调用和异常处理。
 */
export function createGeminiBackupSnapshot({ localStorage, appVersion, geminiConfig }) {
  // 1、存储读取全部完成后，才记录时间并组装快照。
  const stickfigureConfigData = localStorage.getItem('stickfigure-config')
  const hotkeysConfigData = localStorage.getItem('hotkeys-config')
  const hdToolkitConfigData = localStorage.getItem('hd-toolkit-config')
  // 2、生图始终使用当前草稿，其他域保持各自存储来源。
  const allSettings = {
    version: appVersion.value,
    exportTime: new Date().toISOString(),
    stickfigureConfig: stickfigureConfigData ? JSON.parse(stickfigureConfigData) : null,
    geminiConfig: JSON.parse(JSON.stringify(geminiConfig)),
    hotkeysConfig: hotkeysConfigData ? JSON.parse(hotkeysConfigData) : null,
    hdToolkitConfig: hdToolkitConfigData ? JSON.parse(hdToolkitConfigData) : null
  }
  // 3、同步返回，不增加异步边界或异常捕获。
  return allSettings
}

/**
 * 组装人物保存后的备份快照。
 * 处理流程：
 * 1、按快捷键、高清顺序读取本地配置。
 * 2、记录版本和时间，保留本次人物保存对象并深拷贝生图草稿，再解析其他域。
 * 3、返回快照，由调用方执行备份。
 */
export function createStickfigureBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave }) {
  // 1、仅从存储读取本次未保存的快捷键和高清配置。
  const hotkeysConfigData = localStorage.getItem('hotkeys-config')
  const hdToolkitConfigData = localStorage.getItem('hd-toolkit-config')
  // 2、人物保留保存对象引用，生图仍使用当前草稿的深拷贝。
  const allSettings = {
    version: appVersion.value,
    exportTime: new Date().toISOString(),
    stickfigureConfig: configToSave,
    geminiConfig: JSON.parse(JSON.stringify(geminiConfig)),
    hotkeysConfig: hotkeysConfigData ? JSON.parse(hotkeysConfigData) : null,
    hdToolkitConfig: hdToolkitConfigData ? JSON.parse(hdToolkitConfigData) : null
  }
  // 3、同步返回，不改变调用方异常处理。
  return allSettings
}

/**
 * 组装快捷键保存后的备份快照。
 * 处理流程：
 * 1、按人物、高清顺序读取本地配置。
 * 2、记录版本和时间，依次解析人物、深拷贝生图草稿、使用快捷键保存对象并解析高清。
 * 3、返回快照，由调用方执行备份。
 */
export function createHotkeysBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave }) {
  // 1、保持人物和高清配置的存储读取顺序。
  const stickfigureConfigData = localStorage.getItem('stickfigure-config')
  const hdToolkitConfigData = localStorage.getItem('hd-toolkit-config')
  // 2、快捷键使用本次保存对象，其他域保持原有来源和求值顺序。
  const allSettings = {
    version: appVersion.value,
    exportTime: new Date().toISOString(),
    stickfigureConfig: stickfigureConfigData ? JSON.parse(stickfigureConfigData) : null,
    geminiConfig: JSON.parse(JSON.stringify(geminiConfig)),
    hotkeysConfig: configToSave,
    hdToolkitConfig: hdToolkitConfigData ? JSON.parse(hdToolkitConfigData) : null
  }
  // 3、同步返回，不提前执行备份接口。
  return allSettings
}

/**
 * 组装高清保存后的备份快照。
 * 处理流程：
 * 1、按人物、快捷键顺序读取本地配置。
 * 2、记录版本和时间，依次解析人物、深拷贝生图草稿、解析快捷键并使用高清保存对象。
 * 3、返回快照，由高清设置模块执行备份。
 */
export function createHdToolkitBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave }) {
  // 1、高清仍由本次保存对象提供，不重复读取高清存储。
  const stickfigureConfigData = localStorage.getItem('stickfigure-config')
  const hotkeysConfigData = localStorage.getItem('hotkeys-config')
  // 2、保留时间记录位置、各域数据来源和解析顺序。
  const allSettings = {
    version: appVersion.value,
    exportTime: new Date().toISOString(),
    stickfigureConfig: stickfigureConfigData ? JSON.parse(stickfigureConfigData) : null,
    geminiConfig: JSON.parse(JSON.stringify(geminiConfig)),
    hotkeysConfig: hotkeysConfigData ? JSON.parse(hotkeysConfigData) : null,
    hdToolkitConfig: configToSave
  }
  // 3、同步返回，备份等待与失败提示仍归高清保存流程。
  return allSettings
}

/**
 * 组装对话保存后的备份快照。
 * 处理流程：
 * 1、按人物、快捷键、高清顺序读取本地配置。
 * 2、记录版本和时间，按原顺序解析各域并深拷贝生图草稿，最后附加对话保存对象。
 * 3、返回唯一包含对话配置的保存备份快照。
 */
export function createDialogBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave }) {
  // 1、读取其余三个持久化域，生图不读取存储。
  const stickfigureConfigData = localStorage.getItem('stickfigure-config')
  const hotkeysConfigData = localStorage.getItem('hotkeys-config')
  const hdToolkitConfigData = localStorage.getItem('hd-toolkit-config')
  // 2、对话域差异单独保留，不补入其他保存或手动导出快照。
  const allSettings = {
    version: appVersion.value,
    exportTime: new Date().toISOString(),
    stickfigureConfig: stickfigureConfigData ? JSON.parse(stickfigureConfigData) : null,
    geminiConfig: JSON.parse(JSON.stringify(geminiConfig)),
    hotkeysConfig: hotkeysConfigData ? JSON.parse(hotkeysConfigData) : null,
    hdToolkitConfig: hdToolkitConfigData ? JSON.parse(hdToolkitConfigData) : null,
    dialogConfig: configToSave
  }
  // 3、同步返回，沿用调用方的备份异常边界。
  return allSettings
}

/**
 * 创建手动设置导出操作。
 * 处理流程：
 * 1、接收已初始化的四域草稿、版本、页面导出状态、消息及桌面窗口依赖。
 * 2、定义原有导出流程，仅在调用时读取草稿、记录时间及访问桌面接口。
 * 3、返回导出操作，不创建状态、读取存储或接管加载与导入。
 */
export function createSettingsArchive({
  window,
  message,
  appVersion,
  isExportingSettings,
  stickfigureConfig,
  geminiConfig,
  hotkeysConfig,
  hdToolkitConfig
}) {
  // 1、所有依赖均由页面传入，导出状态仍只有页面一个所有者。
  // 2、初始化仅定义操作，保留原有正文及异步、异常和提示顺序。
  /**
   * 导出所有配置到JSON文件
   * 处理流程：
   * 1、收集人物、生图、快捷键和抠图高清配置，并附版本与导出时间。
   * 2、请求主进程选择保存位置并导出，成功后另外写入自动备份。
   * 3、区分取消与失败，结束时恢复导出按钮状态。
   */
  const handleExportSettings = async () => {
    // 1、当前导出集合明确列出下方四类配置，包含用户填写的 API 密钥。
    try {
      isExportingSettings.value = true

      console.log('[设置页] 开始导出配置...')

      // 收集所有配置
      const allSettings = {
        version: appVersion.value, // 记录配置版本
        exportTime: new Date().toISOString(), // 导出时间
        stickfigureConfig: JSON.parse(JSON.stringify(stickfigureConfig)), // 简笔画配置
        geminiConfig: JSON.parse(JSON.stringify(geminiConfig)), // 纳米香蕉配置（包含API密钥）
        hotkeysConfig: JSON.parse(JSON.stringify(hotkeysConfig)), // 快捷键配置
        hdToolkitConfig: JSON.parse(JSON.stringify(hdToolkitConfig)), // 抠图高清配置
      }

      console.log('[设置页] 配置已收集:', allSettings)

      // 2、文件选择和磁盘写入由主进程完成。
      const result = await window.electronAPI.settings.exportSettings(allSettings)

      if (result.success) {
        message.success(`配置已导出到: ${result.filePath}`, {
          duration: 5000,
          keepAliveOnHover: true
        })

        // 同时保存一份到用户文档目录作为自动备份
        await window.electronAPI.settings.autoBackupSettings(allSettings)
      } else if (result.canceled) {
        console.log('[设置页] 用户取消导出')
      } else {
        message.error('导出失败: ' + (result.error || '未知错误'), {
          duration: 5000
        })
      }
    } catch (error) {
      console.error('[设置页] 导出配置失败:', error)
      message.error('导出配置失败: ' + error.message, {
        duration: 5000
      })
    } finally {
      isExportingSettings.value = false
    }
  }

  // 3、仅公开导出操作，不增加页面初始化副作用。
  return { handleExportSettings }
}
