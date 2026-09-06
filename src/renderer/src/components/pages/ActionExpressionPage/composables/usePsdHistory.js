/**
 * PSD历史记录管理
 * 负责保存和加载PSD文件路径历史记录
 */

/**
 * 创建历史记录管理功能
 * 处理流程：
 * 1、定义存储键、数量限制及路径规范化工具
 * 2、提供当前文件保存、历史恢复及备份导入导出入口
 * @param {Object} deps - 依赖项
 * @param {import('vue').Ref} deps.psdFiles - PSD文件列表
 * @param {Function} deps.processFile - 处理文件的函数
 * @param {Object} deps.message - 消息提示对象
 * @returns {Object} 历史记录管理相关的方法
 */
export function usePsdHistory({ psdFiles, processFile, message }) {
  // 1、限定历史记录的本地存储位置与保留数量
  const HISTORY_KEY = 'psd-file-history'
  // 历史记录最大数量
  const MAX_HISTORY_COUNT = 30

  /**
   * 返回用户友好的错误提示
   * 处理流程：
   * 1、提取错误文本并识别存储容量、权限或数据格式问题
   * 2、未匹配已知原因时使用原错误或通用提示
   * @param {'保存历史' | '加载历史' | '导入历史' | '导出历史'} action
   * @param {Error|string} error
   */
  const formatFriendlyError = (action, error) => {
    // 1、把常见底层错误转换为当前操作的中文提示
    const rawMessage = typeof error === 'string' ? error : (error?.message || '')
    const lowerMessage = rawMessage.toLowerCase()

    if (lowerMessage.includes('quota')) {
      return `${action}失败：本地存储空间不足，请清理后重试`
    }
    if (lowerMessage.includes('denied') || lowerMessage.includes('permission')) {
      return `${action}失败：当前环境阻止访问本地存储，请检查安全/隐私设置`
    }
    if (lowerMessage.includes('json') || lowerMessage.includes('unexpected token')) {
      return `${action}失败：历史数据已损坏，可尝试清空后重新保存`
    }
    if (lowerMessage.includes('history data')) {
      return `${action}失败：历史数据格式异常，请重新导入或清空历史`
    }

    // 2、保留未知错误的具体信息，缺失时使用通用提示
    return rawMessage
      ? `${action}失败：${rawMessage}`
      : `${action}失败：发生未知错误，请查看控制台日志或联系开发者`
  }

  /**
   * 规范化历史列表
   * 处理流程：
   * 1、仅保留非空字符串路径，并截取最大记录数量
   * @param {unknown} list
   * @returns {string[]}
   */
  const normalizeHistoryList = (list) => {
    // 1、非法结构回退空列表，不对路径执行文件访问
    if (!Array.isArray(list)) {
      return []
    }
    return list
      .filter(item => typeof item === 'string')
      .map(item => item.trim())
      .filter(item => item.length > 0)
      .slice(0, MAX_HISTORY_COUNT)
  }

  /**
   * 读取本地历史记录
   * 处理流程：
   * 1、读取并解析历史数据，再过滤无效条目
   * 2、解析失败时记录原因并抛出历史损坏错误
   * @returns {string[]}
   */
  const getStoredHistory = () => {
    // 1、没有保存记录时返回空列表
    const historyStr = localStorage.getItem(HISTORY_KEY)
    if (!historyStr) {
      return []
    }
    try {
      const parsed = JSON.parse(historyStr)
      const normalized = normalizeHistoryList(parsed)
      if (normalized.length !== (Array.isArray(parsed) ? parsed.length : 0)) {
        console.warn('⚠️ 历史记录中存在无效的路径，已自动忽略')
      }
      return normalized
    } catch (error) {
      // 2、将解析异常交给调用方决定重建或显示提示
      console.error('❌ 历史数据损坏:', error)
      throw new Error('历史数据损坏')
    }
  }

  /**
   * 收集当前PSD文件的路径信息
   * 处理流程：
   * 1、遍历打开文件，分别收集真实路径与缺少路径的显示名称
   */
  const collectCurrentPsdPaths = () => {
    // 1、把可保存路径与需要提示的缺失项分开返回
    const paths = []
    const missing = []
    for (const psdFile of psdFiles.value) {
      if (psdFile.filePath) {
        paths.push(psdFile.filePath)
      } else if (psdFile.name) {
        missing.push(psdFile.name)
      } else {
        missing.push('未命名PSD')
      }
    }
    return {
      paths,
      missing
    }
  }

  /**
   * 保存PSD文件路径到历史记录
   * 处理流程：
   * 1、读取旧历史，损坏时从空列表重建
   * 2、仅追加未存在的路径到列表开头，截断后写入本地存储
   * @param {string} filePath - 文件路径
   */
  const savePsdPathToHistory = (filePath) => {
    // 1、容忍旧历史损坏，保证新载入文件仍可记录路径
    try {
      let history = []
      try {
        history = getStoredHistory()
      } catch (error) {
        console.warn('⚠️ 历史数据异常，自动重建', error)
        history = []
      }
      
      // 2、避免重复添加，新路径放到开头并限制保留数量
      if (!history.includes(filePath)) {
        history.unshift(filePath) // 添加到开头
        // 限制历史记录数量（最多保存30个）
        if (history.length > MAX_HISTORY_COUNT) {
          history = history.slice(0, MAX_HISTORY_COUNT)
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
        console.log('💾 保存PSD路径到历史:', filePath)
      }
    } catch (error) {
      console.error('❌ 保存PSD路径失败:', error)
    }
  }

  /**
   * 手动保存当前所有PSD文件路径到历史
   * 替换模式：清空旧历史，只保存当前打开的文件列表
   * 处理流程：
   * 1、检查打开文件并收集真实路径，提示缺失项
   * 2、以当前有效路径替换历史并反馈结果
   */
  const saveCurrentPsdHistory = () => {
    // 1、无文件或没有有效路径时保留原历史
    try {
      if (psdFiles.value.length === 0) {
        message.warning('当前没有打开的PSD文件')
        return
      }

      const { paths: currentPaths, missing } = collectCurrentPsdPaths()

      if (currentPaths.length === 0) {
        message.warning('当前打开的文件没有路径信息')
        return
      }

      if (missing.length > 0) {
        const preview = missing.slice(0, 3).join('、')
        message.warning(`有 ${missing.length} 个PSD缺少真实路径，已跳过：${preview}${missing.length > 3 ? ' 等' : ''}`)
      }
      
      // 2、替换模式：直接保存当前路径列表，限制数量
      const history = currentPaths.slice(0, MAX_HISTORY_COUNT)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
      
      message.success(`成功保存 ${currentPaths.length} 个文件路径到历史`)
      console.log('💾 手动保存历史（替换模式）:', currentPaths.length, '个文件')
    } catch (error) {
      console.error('❌ 保存历史失败:', error)
      message.error(formatFriendlyError('保存历史', error))
    }
  }

  /**
   * 从历史记录加载PSD文件
   * 处理流程：
   * 1、读取历史并检查桌面文件接口
   * 2、过滤已打开路径，逐个检查、读取和处理剩余文件
   * 3、保留可用路径并汇总加载、已打开和跳过数量
   */
  const loadPsdFromHistory = async () => {
    // 1、历史或桌面接口不可用时提前反馈
    try {
      const history = getStoredHistory()
      if (history.length === 0) {
        message.warning('暂无历史记录')
        return
      }

      if (!window.electronAPI || !window.electronAPI.checkFileExists || !window.electronAPI.readFile) {
        message.error('加载历史失败：当前环境无法访问本地PSD文件，请从桌面客户端运行')
        return
      }
      
      // 获取当前已打开的PSD文件路径集合
      const openedPaths = new Set(
        psdFiles.value
          .filter(psd => psd.filePath)
          .map(psd => psd.filePath)
      )
      
      console.log('📂 当前已打开的文件路径:', Array.from(openedPaths))
      
      // 2、先过滤出尚未打开的文件，再逐个验证和加载
      const toLoad = []
      const alreadyOpened = []
      const validPaths = []
      
      for (const filePath of history) {
        if (openedPaths.has(filePath)) {
          alreadyOpened.push(filePath)
          validPaths.push(filePath) // 已打开的仍保留在历史中
        } else {
          toLoad.push(filePath)
        }
      }
      
      const alreadyOpenedCount = alreadyOpened.length
      
      if (toLoad.length === 0) {
        // 所有文件都已打开
        message.info(`所有历史文件都已打开（${alreadyOpenedCount} 个）`, { duration: 3000 })
        return
      }
      
      message.info(`找到 ${history.length} 个历史文件，${alreadyOpenedCount} 个已打开，开始加载 ${toLoad.length} 个...`, { duration: 2000 })
      
      let successCount = 0
      let skipCount = 0
      
      // 只遍历需要加载的文件
      for (let i = 0; i < toLoad.length; i++) {
        const filePath = toLoad[i]
        try {
          // 显示加载进度
          message.loading(`正在加载 ${i + 1}/${toLoad.length}: ${filePath.split(/[\\/]/).pop()}`, { 
            duration: 0, 
            key: 'load-history' 
          })
          
          // 使用Electron API检查文件是否存在并读取
          const exists = await window.electronAPI?.checkFileExists?.(filePath)
          
          if (!exists) {
            console.log(`⏭️ 文件不存在，跳过: ${filePath}`)
            skipCount++
            continue
          }
          
          // 读取文件
          const fileBuffer = await window.electronAPI?.readFile?.(filePath)
          if (!fileBuffer) {
            console.log(`⏭️ 无法读取文件，跳过: ${filePath}`)
            skipCount++
            continue
          }
          
          // 创建File对象
          const fileName = filePath.split(/[\\/]/).pop()
          const file = new File([fileBuffer], fileName, { type: 'application/octet-stream' })
          // 保存文件路径到file对象（用于后续保存历史）
          Object.defineProperty(file, 'path', {
            value: filePath,
            writable: false
          })
          
          // 处理文件
          await processFile(file, false)
          validPaths.push(filePath)
          successCount++
        } catch (error) {
          console.error(`❌ 加载文件失败: ${filePath}`, error)
          skipCount++
        }
      }
      
      // 3、清理进度提示，删除不可用历史并汇总本轮结果
      message.destroyAll()
      
      // 更新历史记录，只保留有效的路径
      if (validPaths.length !== history.length) {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(validPaths))
        console.log('🔄 已清理无效的历史记录')
      }
      
      // 显示最终结果
      if (successCount > 0 || alreadyOpenedCount > 0 || skipCount > 0) {
        const resultParts = []
        if (successCount > 0) {
          resultParts.push(`成功加载 ${successCount} 个`)
        }
        if (alreadyOpenedCount > 0) {
          resultParts.push(`${alreadyOpenedCount} 个已打开`)
        }
        if (skipCount > 0) {
          resultParts.push(`${skipCount} 个不可用`)
        }
        
        if (successCount > 0) {
          message.success(resultParts.join('，'), { duration: 3000 })
        } else if (alreadyOpenedCount > 0) {
          message.info(resultParts.join('，'), { duration: 3000 })
        } else {
          message.warning(resultParts.join('，'), { duration: 3000 })
        }
      }
    } catch (error) {
      console.error('❌ 加载历史失败:', error)
      message.destroyAll()
      message.error(formatFriendlyError('加载历史', error))
    }
  }

  /**
   * 清空历史记录
   * 处理流程：
   * 1、删除本地历史存储项并反馈成功或失败
   */
  const clearPsdHistory = () => {
    // 1、只删除路径历史，不修改磁盘上的 PSD 文件
    try {
      localStorage.removeItem(HISTORY_KEY)
      message.success('历史记录已清空')
      console.log('🗑️ 清空PSD历史记录')
    } catch (error) {
      console.error('❌ 清空历史失败:', error)
      message.error('清空历史失败')
    }
  }

  /**
   * 自动保存所有PSD文件路径到历史（路由离开时调用）
   * 替换模式：清空旧历史，只保存当前打开的文件列表
   * 处理流程：
   * 1、收集当前可用路径，缺少路径时仅记录日志
   * 2、截取数量限制后替换历史，异常仅记录日志
   */
  const autoSavePsdHistory = () => {
    // 1、没有可保存文件时保持原历史
    try {
      if (psdFiles.value.length === 0) {
        console.log('📝 无需保存历史：当前没有打开的PSD文件')
        return
      }

      const { paths: currentPaths, missing } = collectCurrentPsdPaths()

      if (missing.length > 0) {
        console.warn(`⚠️ 有 ${missing.length} 个PSD缺少真实路径，自动保存时已跳过`, missing)
      }

      if (currentPaths.length === 0) {
        console.log('📝 无需保存历史：当前文件没有路径信息')
        return
      }
      
      // 2、替换模式：直接保存当前路径列表，限制数量
      const history = currentPaths.slice(0, MAX_HISTORY_COUNT)
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
      
      console.log(`💾 自动保存历史（替换模式）：${currentPaths.length} 个文件路径已保存`)
    } catch (error) {
      console.error('❌ 自动保存历史失败:', error)
    }
  }

  /**
   * 导出历史记录到JSON文件
   * 处理流程：
   * 1、读取非空历史并构造带格式版本的备份数据
   * 2、创建下载链接触发导出，随后释放临时地址
   */
  const exportPsdHistory = () => {
    // 1、导出数据只包含历史路径及备份元信息
    try {
      const history = getStoredHistory()
      if (history.length === 0) {
        message.warning('暂无历史记录可导出')
        return
      }

      const payload = {
        type: 'psd-history-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        paths: history
      }

      // 2、通过临时对象地址下载 JSON，完成后移除链接并释放地址
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      anchor.href = url
      anchor.download = `psd-history-backup_${timestamp}.json`
      anchor.style.display = 'none'
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)

      message.success(`历史记录已导出 (${history.length} 条)`)
      console.log('💾 历史记录已导出')
    } catch (error) {
      console.error('❌ 导出历史失败:', error)
      message.error(formatFriendlyError('导出历史', error))
    }
  }

  /**
   * 导入历史记录
   * 处理流程：
   * 1、选择 JSON 文件并读取文本
   * 2、兼容数组及多种备份字段，规范路径后替换本地历史
   * 3、报告结果并移除临时文件输入控件
   */
  const importPsdHistory = () => {
    // 1、使用临时文件输入框选择备份文件
    try {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = '.json,application/json'
      input.style.display = 'none'
      document.body.appendChild(input)

      input.addEventListener('change', () => {
        const file = input.files?.[0]
        if (!file) {
          document.body.removeChild(input)
          return
        }

        const reader = new FileReader()
        reader.onload = () => {
          try {
            const text = typeof reader.result === 'string'
              ? reader.result
              : reader.result?.toString()
            if (!text) {
              throw new Error('文件内容为空')
            }
            let parsed
            try {
              parsed = JSON.parse(text)
            } catch (_) {
              throw new Error('文件不是有效的JSON')
            }

            // 2、兼容历史备份曾使用的不同列表字段
            let list = []
            if (Array.isArray(parsed)) {
              list = parsed
            } else if (Array.isArray(parsed?.paths)) {
              list = parsed.paths
            } else if (Array.isArray(parsed?.history)) {
              list = parsed.history
            } else if (Array.isArray(parsed?.items)) {
              list = parsed.items
            }

            const normalized = normalizeHistoryList(list)
            if (normalized.length === 0) {
              message.warning('导入的文件中没有有效的历史路径')
              return
            }

            localStorage.setItem(HISTORY_KEY, JSON.stringify(normalized))
            message.success(`成功导入 ${normalized.length} 条历史记录`)
            console.log('📥 历史记录导入成功:', normalized.length)
          } catch (error) {
            console.error('❌ 导入历史失败:', error)
            message.error(formatFriendlyError('导入历史', error))
          } finally {
            // 3、成功、校验失败或异常时都移除本次临时控件
            document.body.removeChild(input)
          }
        }

        reader.onerror = () => {
          console.error('❌ 导入历史失败：文件读取错误')
          message.error('导入历史失败：无法读取文件')
          document.body.removeChild(input)
        }

        reader.readAsText(file, 'utf-8')
      }, { once: true })

      input.click()
    } catch (error) {
      console.error('❌ 导入历史失败:', error)
      message.error(formatFriendlyError('导入历史', error))
    }
  }

  // 2、导出页面生命周期与更多菜单需要的历史管理入口
  return {
    savePsdPathToHistory,
    saveCurrentPsdHistory,
    loadPsdFromHistory,
    clearPsdHistory,
    autoSavePsdHistory,
    exportPsdHistory,
    importPsdHistory
  }
}
