/**
 * 预设数据管理逻辑
 * 负责预设的增删改查、导入导出、持久化存储等功能
 */

import { ref, computed } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { calculatePsdHash } from '../utils/hashUtils'
import { getCanvasBase64 } from '../utils/canvasUtils'
import { generateId, generatePresetName } from '../utils/stringUtils'

// 全局预设存储的固定Key（所有PSD的预设都存在这里）
const GLOBAL_PRESETS_STORAGE_KEY = 'stickfigure-all-presets'
const PRESET_STORAGE_VERSION = '2.0.0'
const PRESET_PREVIEW_STORAGE_TYPE = 'presetPreviews'

/**
 * 将预设预览图保存为独立文件。
 * 处理流程：
 * 1、验证参数和主进程桥接能力。
 * 2、提交图片保存请求并返回文件路径。
 */
const savePresetPreviewToFile = async (presetId, base64Image) => {
  // 1、缺少图片或运行环境时跳过文件写入。
  if (!presetId || !base64Image || !window.electronAPI?.invoke) {
    return null
  }
  try {
    // 2、使用预设专属图片分类保存预览。
    const result = await window.electronAPI.invoke('template-storage-save-image', {
      templateType: PRESET_PREVIEW_STORAGE_TYPE,
      templateId: presetId,
      base64Data: base64Image
    })
    if (result?.success && result.filePath) {
      return result.filePath
    }
  } catch (error) {
    console.error('❌ 保存预设预览失败:', error)
  }
  return null
}

/**
 * 删除预设关联的预览图片。
 * 处理流程：
 * 1、检查路径和桥接接口，调用删除入口并记录失败。
 */
const deletePresetPreviewFile = async (previewPath) => {
  // 1、缺少文件路径时无需发起删除。
  if (!previewPath || !window.electronAPI?.invoke) return
  try {
    await window.electronAPI.invoke('template-storage-delete-image', { relativePath: previewPath })
  } catch (error) {
    console.warn('⚠️ 删除预设预览文件失败:', error?.message || error)
  }
}

/**
 * 读取预设预览文件的编码内容。
 * 处理流程：
 * 1、调用图片读取入口，成功返回内容，否则返回空值。
 */
const loadPresetPreviewBase64 = async (previewPath) => {
  // 1、将路径解析和文件读取交给主进程。
  if (!previewPath || !window.electronAPI?.invoke) return null
  try {
    const result = await window.electronAPI.invoke('template-storage-load-image', { relativePath: previewPath })
    if (result?.success) {
      return result.base64Data
    }
  } catch (error) {
    console.warn('⚠️ 加载预设预览图失败:', error?.message || error)
  }
  return null
}

/**
 * 为预设列表补载缺失的预览数据。
 * 处理流程：
 * 1、跳过已有预览的项目，逐个读取并回填文件内容。
 */
const hydratePresetListPreviews = async (presetList = []) => {
  // 1、仅为保存了图片路径的项目加载预览。
  for (const preset of presetList) {
    if (!preset || preset.base64Image || !preset.previewPath) continue
    const base64 = await loadPresetPreviewBase64(preset.previewPath)
    if (base64) {
      preset.base64Image = base64
    }
  }
}

/**
 * 确保预设预览具有独立文件路径。
 * 处理流程：
 * 1、复用已有路径，否则保存编码图片并回填路径。
 */
const ensurePresetPreviewFile = async (preset) => {
  // 1、优先复用已经文件化的预览。
  if (!preset) return null
  if (preset.previewPath) return preset.previewPath
  if (!preset.base64Image) return null
  const filePath = await savePresetPreviewToFile(preset.id || generateId(), preset.base64Image)
  if (filePath) {
    preset.previewPath = filePath
  }
  return preset.previewPath || null
}

/**
 * 移除预设元数据中的内嵌图片。
 * 处理流程：
 * 1、复制各 PSD 项和预设，保留图片路径及其他元数据。
 */
const sanitizePsdItemsForStorage = (psdItems = []) => {
  // 1、避免将较大的编码图片再次写入浏览器存储。
  return psdItems.map(item => ({
    ...item,
    presets: Array.isArray(item.presets)
      ? item.presets.map((preset) => {
          const { base64Image, ...rest } = preset || {}
          return rest
        })
      : []
  }))
}

/**
 * 将旧预设中的内嵌预览迁移到文件系统。
 * 处理流程：
 * 1、验证旧数据结构，为预设补齐标识与预览路径。
 * 2、移除内嵌图片并保存新的存储版本。
 */
const migrateLegacyPresetData = async (legacyData) => {
  // 1、处理无效旧数据，并逐个迁移有效预设。
  if (!legacyData || !Array.isArray(legacyData.psdItems)) {
    localStorage.removeItem(GLOBAL_PRESETS_STORAGE_KEY)
    return { psdItems: [], storage_version: PRESET_STORAGE_VERSION }
  }

  let migratedCount = 0
  for (const item of legacyData.psdItems) {
    if (!Array.isArray(item.presets)) continue
    for (const preset of item.presets) {
      if (preset && !preset.id) {
        preset.id = generateId()
      }
      const storedPath = await ensurePresetPreviewFile(preset)
      if (storedPath) {
        migratedCount++
      }
    }
  }

  // 2、使用轻量元数据替换旧的内嵌图片存储。
  const payload = {
    ...legacyData,
    storage_version: PRESET_STORAGE_VERSION,
    psdItems: sanitizePsdItemsForStorage(legacyData.psdItems)
  }
  localStorage.setItem(GLOBAL_PRESETS_STORAGE_KEY, JSON.stringify(payload))
  console.log(`✅ 预设数据迁移完成，将 ${migratedCount} 张预览图移出 localStorage`)
  return payload
}

/**
 * 构造包含预览图片的可迁移导出数据。
 * 处理流程：
 * 1、复制各 PSD 和预设，并从文件补入缺失的图片内容。
 * 2、返回独立的导出对象。
 */
const buildExportPayloadWithPreviews = async (data) => {
  // 1、导出使用副本，避免改变当前存储对象。
  const exportData = {
    ...data,
    psdItems: []
  }

  for (const item of data.psdItems || []) {
    const exportItem = {
      ...item,
      presets: []
    }
    for (const preset of item.presets || []) {
      const presetCopy = { ...preset }
      if (!presetCopy.base64Image && presetCopy.previewPath) {
        presetCopy.base64Image = await loadPresetPreviewBase64(presetCopy.previewPath)
      }
      exportItem.presets.push(presetCopy)
    }
    exportData.psdItems.push(exportItem)
  }

  // 2、返回自包含的预设导出数据。
  return exportData
}

/**
 * 管理当前 PSD 的预设保存、匹配和画布展示。
 * 处理流程：
 * 1、初始化预设列表和选择状态。
 * 2、提供持久化、导入导出与预览渲染操作。
 * 3、返回页面使用的状态和方法。
 */
export function usePresetData({
  currentPsdFile,
  currentPsdData,
  canvasRef,
  canvasWidth,
  canvasHeight,
  isRendering,
  renderAllLayers,
  syncCanvasToPreview // 传入的画布-预览同步函数，确保预设切换能更新独立预览窗口
}) {
  // 1、初始化页面消息服务及预设交互状态。
  const message = useMessage()
  const dialog = useDialog()

  // ========== 状态定义 ==========
  const presets = ref([]) // 预设列表 [{ id, name, base64Image, timestamp }]
  const selectedPresetId = ref(null) // 当前选中的预设ID
  const editingPresetId = ref(null) // 当前正在编辑的预设ID

  // 2、组织预设持久化、数据交换和渲染方法。
  // ========== 存储相关 ==========

  /**
   * 从全局存储中获取所有预设数据
   * 处理流程：
   * 1、读取并解析存储内容。
   * 2、按版本迁移旧数据，异常时清理损坏内容并返回空列表。
   */
  const getAllPresetsData = async () => {
    // 1、读取全局元数据，并在需要时迁移存储结构。
    try {
      const stored = localStorage.getItem(GLOBAL_PRESETS_STORAGE_KEY)
      if (!stored) {
        return { psdItems: [], storage_version: PRESET_STORAGE_VERSION }
      }
      const data = JSON.parse(stored)
      if (data.storage_version === PRESET_STORAGE_VERSION) {
        return data
      }
      console.log('🔄 检测到旧版预设存储格式，开始迁移...')
      return await migrateLegacyPresetData(data)
    } catch (error) {
      console.error('❌ 读取全局预设数据失败:', error)
      localStorage.removeItem(GLOBAL_PRESETS_STORAGE_KEY)
      return { psdItems: [], storage_version: PRESET_STORAGE_VERSION }
    }
  }

  /**
   * 保存所有预设数据到全局存储
   * 处理流程：
   * 1、附加存储版本并移除内嵌图片后写入。
   */
  const saveAllPresetsData = async (data) => {
    // 1、只持久化轻量元数据和预览文件路径。
    try {
      const payload = {
        ...data,
        storage_version: PRESET_STORAGE_VERSION,
        psdItems: sanitizePsdItemsForStorage(data.psdItems || [])
      }
      localStorage.setItem(GLOBAL_PRESETS_STORAGE_KEY, JSON.stringify(payload))
      console.log('💾 保存全局预设数据成功，共', payload.psdItems.length, '个PSD')
    } catch (error) {
      console.error('❌ 保存全局预设失败:', error)
    }
  }

  // ========== 匹配和加载 ==========

  /**
   * 智能匹配当前PSD的预设（优先路径匹配，其次哈希匹配）
   * 处理流程：
   * 1、读取全局预设并优先匹配文件路径。
   * 2、路径不匹配时按内容哈希匹配，并标记路径更新。
   */
  const findPresetsByMatch = async () => {
    // 1、定位当前 PSD 对应的全局预设记录。
    if (!currentPsdFile.value) return null
    
    const currentPath = currentPsdFile.value.filePath || currentPsdFile.value.name
    const allData = await getAllPresetsData()
    
    console.log('🔍 开始查找当前PSD的预设:', currentPath)
    console.log('📦 全局存储中共有', allData.psdItems.length, '个PSD的预设')
    
    // 优先通过路径匹配。
    let matchedItem = allData.psdItems.find(item => item.psdPath === currentPath)
    if (matchedItem) {
      console.log('✅ 通过路径匹配成功:', currentPath)
      return matchedItem
    }
    
    // 2、如果路径匹配失败，尝试通过 PSD 哈希匹配。
    console.log('🔐 路径匹配失败，尝试哈希匹配...')
    const currentHash = await calculatePsdHash(currentPsdData.value)
    if (currentHash) {
      matchedItem = allData.psdItems.find(item => item.psdHash === currentHash)
      if (matchedItem) {
        console.log('✅ 通过哈希匹配成功:', currentHash.substring(0, 16) + '...')
        console.log('🔄 PSD可能被移动了，更新路径:', currentPath)
        // 更新路径
        matchedItem.psdPath = currentPath
        matchedItem.pathUpdated = true
        return matchedItem
      }
    }
    
    console.log('❌ 未找到匹配的预设数据')
    return null
  }

  /**
   * 加载预设列表（支持智能匹配）
   * 处理流程：
   * 1、清空旧选择并异步匹配当前 PSD。
   * 2、确认文件未切换，再补载预览并保存已变化的路径。
   */
  const loadPresets = async () => {
    // 1、保留发起加载时的 PSD 标识，避免异步结果串到其他文件。
    try {
      if (!currentPsdFile.value) {
        console.log('⚠️ PSD文件为空，无法加载预设')
        presets.value = []
        selectedPresetId.value = null
        return
      }
      
      const loadingPsdId = currentPsdFile.value.id
      const loadingPsdName = currentPsdFile.value.name
      
      console.log('🔍 正在为PSD加载预设:', loadingPsdId, loadingPsdName)
      
      // 先清空当前预设（防止显示错误的数据）
      presets.value = []
      selectedPresetId.value = null
      
      // 使用智能匹配查找预设
      const matchedItem = await findPresetsByMatch()
      
      // 2、验证 PSD 是否仍然活动，再应用预设与预览。
      if (!currentPsdFile.value || currentPsdFile.value.id !== loadingPsdId) {
        console.log('⚠️ PSD已切换，放弃加载预设')
        return
      }
      
      if (matchedItem) {
        presets.value = matchedItem.presets || []
        await hydratePresetListPreviews(presets.value)
        console.log('📂 成功加载预设列表:', presets.value.length, '个，PSD:', loadingPsdName)
        
        // 如果路径已更新，立即保存（PSD移动后更新路径）
        if (matchedItem.pathUpdated) {
          console.log('🔄 PSD路径已更新，保存新路径')
          await savePresets()
        }
      } else {
        console.log('📝 未找到匹配的预设数据，PSD:', loadingPsdName)
        presets.value = []
        selectedPresetId.value = null
      }
    } catch (error) {
      console.error('❌ 加载预设失败:', error)
      presets.value = []
      selectedPresetId.value = null
    }
  }

  // ========== 保存和创建 ==========

  /**
   * 保存预设列表（保存到全局存储）
   * 处理流程：
   * 1、按路径和哈希定位当前 PSD 记录。
   * 2、确保预览文件存在，更新记录并保存全局数据。
   */
  const savePresets = async () => {
    // 1、计算文件匹配信息，兼容 PSD 被移动的情况。
    try {
      if (!currentPsdFile.value) {
        console.warn('⚠️ 无法保存预设: currentPsdFile 为空')
        return
      }
      
      const currentPath = currentPsdFile.value.filePath || currentPsdFile.value.name
      
      // 计算PSD哈希（用于文件移动后的匹配）
      let psdHash = null
      try {
        psdHash = await calculatePsdHash(currentPsdData.value)
        console.log('🔐 计算PSD哈希成功:', psdHash ? psdHash.substring(0, 16) + '...' : 'null')
      } catch (error) {
        console.warn('⚠️ 计算PSD哈希失败:', error)
      }
      
      // 获取全局预设数据
      const allData = await getAllPresetsData()
      
      // 查找当前PSD的预设项（通过路径或哈希匹配）
      let existingIndex = allData.psdItems.findIndex(item => item.psdPath === currentPath)
      if (existingIndex < 0 && psdHash) {
        // 如果路径不匹配，尝试通过哈希查找
        existingIndex = allData.psdItems.findIndex(item => item.psdHash === psdHash)
      }
      
      // 2、确保所有预设都有文件化的预览，再保存元数据。
      for (const preset of presets.value) {
        await ensurePresetPreviewFile(preset)
      }

      // 构建当前PSD的预设项
      const psdItem = {
        psdPath: currentPath,
        psdHash: psdHash,
        presets: presets.value,
        savedAt: Date.now()
      }
      
      // 更新或添加
      if (existingIndex >= 0) {
        allData.psdItems[existingIndex] = psdItem
        console.log('🔄 更新现有PSD的预设:', currentPath)
      } else {
        allData.psdItems.push(psdItem)
        console.log('➕ 添加新PSD的预设:', currentPath)
      }
      
      // 保存到全局存储
      await saveAllPresetsData(allData)
      console.log('💾 保存预设列表:', presets.value.length, '个')
      console.log('🔐 PSD哈希:', psdHash ? psdHash.substring(0, 16) + '...' : '未计算')
    } catch (error) {
      console.error('❌ 保存预设失败:', error)
    }
  }

  /**
   * 添加当前画布为预设
   * 处理流程：
   * 1、读取当前画布并构造预设及预览文件。
   * 2、加入列表并持久化。
   * @param {Object} configInfo - 配置信息 { selectedParts: { frontHand: 'xxx', backHand: 'yyy', ... } }
   */
  const handleSavePreset = async (configInfo = null) => {
    // 1、检查画布后捕获预览和当前配置。
    try {
      const canvas = canvasRef.value
      if (!canvas) {
        message.error('无法保存预设：画布未初始化')
        return
      }
      
      // 将画布转为Base64图片
      const base64Image = getCanvasBase64(canvas)
      
      const preset = {
        id: generateId(),
        name: generatePresetName(presets.value),
        base64Image: base64Image,
        config: configInfo, // 保存配置信息
        timestamp: Date.now()
      }
      await ensurePresetPreviewFile(preset)
      
      // 2、更新列表并立即保存，避免新预设只留在内存。
      presets.value.push(preset)
      
      // 立即保存到持久化存储
      await savePresets()
      
      message.success(`预设"${preset.name}"已添加`)
      console.log('✅ 添加预设:', preset.name, '配置:', configInfo)
    } catch (error) {
      console.error('❌ 添加预设失败:', error)
      message.error('添加预设失败: ' + error.message)
    }
  }

  // ========== 导出和导入 ==========

  /**
   * 导出所有预设
   * 处理流程：
   * 1、读取全局数据并选择导出位置。
   * 2、补全预览图片后写入 JSON 文件并反馈结果。
   */
  const handleExportPreset = async () => {
    // 1、确认存在可导出数据，再请求保存路径。
    try {
      // 获取全局预设数据
      const allData = await getAllPresetsData()
      
      if (!allData.psdItems || allData.psdItems.length === 0) {
        message.warning('当前没有任何预设可导出')
        return
      }
      
      // 调用 Electron API 打开保存对话框
      const result = await window.electronAPI?.preset?.export()
      
      if (!result || !result.success) {
        if (!result?.canceled) {
          message.error('导出预设失败')
        }
        return
      }
      
      // 2、导出全局数据，包含图片内容以便离线导入。
      const exportData = await buildExportPayloadWithPreviews(allData)
      exportData.exportTime = Date.now()
      
      const content = JSON.stringify(exportData, null, 2)
      const saveResult = await window.electronAPI?.preset?.saveFile(result.filePath, content)
      
      if (saveResult && saveResult.success) {
        const totalPresets = allData.psdItems.reduce((sum, item) => sum + (item.presets?.length || 0), 0)
        message.success(`已导出 ${allData.psdItems.length} 个PSD的 ${totalPresets} 个预设到: ${result.filePath}`)
        console.log('✅ 导出预设成功:', result.filePath)
      } else {
        message.error('导出预设失败')
        console.error('❌ 导出预设失败:', saveResult)
      }
    } catch (error) {
      console.error('❌ 导出预设失败:', error)
      message.error('导出预设失败: ' + error.message)
    }
  }

  /**
   * 导入预设
   * 处理流程：
   * 1、选择并验证导入数据。
   * 2、文件化预览，按 PSD 路径或哈希合并去重。
   * 3、保存合并结果并重新加载当前预设列表。
   */
  const handleImportPreset = async () => {
    // 1、读取导入文件并验证顶层结构。
    try {
      // 调用 Electron API 打开文件对话框
      const result = await window.electronAPI?.preset?.import()
      
      if (!result || !result.success) {
        if (!result?.canceled) {
          message.error('导入预设失败')
        }
        return
      }
      
      // 解析JSON
      const importData = JSON.parse(result.content)
      if (!importData.psdItems || !Array.isArray(importData.psdItems)) {
        message.error('预设文件格式不正确')
        return
      }
      
      // 获取当前全局预设数据
      const currentData = await getAllPresetsData()
      
      let addedPsdCount = 0
      let updatedPsdCount = 0
      let totalAddedPresets = 0
      
      // 2、遍历导入的每个 PSD 项，补齐预览并合并不重复的预设。
      for (const importItem of importData.psdItems) {
        if (!importItem?.psdPath || !Array.isArray(importItem.presets)) {
          console.warn('⚠️ 跳过无效的PSD项:', importItem)
          continue
        }

        const normalizedPresets = []
        for (const preset of importItem.presets) {
          const normalized = {
            ...preset,
            id: generateId(),
            timestamp: Date.now()
          }
          await ensurePresetPreviewFile(normalized)
          delete normalized.base64Image
          normalizedPresets.push(normalized)
        }
        
        // 查找是否已存在（通过路径或哈希）
        let existingIndex = currentData.psdItems.findIndex(item => item.psdPath === importItem.psdPath)
        if (existingIndex < 0 && importItem.psdHash) {
          existingIndex = currentData.psdItems.findIndex(item => item.psdHash === importItem.psdHash)
        }
        
        if (existingIndex >= 0) {
          // 合并预设（去重）
          const existingPresets = currentData.psdItems[existingIndex].presets || []
          const newPresets = []
          
          normalizedPresets.forEach(preset => {
            const presetConfig = JSON.stringify(preset.config || {})
            const isDuplicate = existingPresets.some(p => {
              const existingConfig = JSON.stringify(p.config || {})
              return p.name === preset.name || existingConfig === presetConfig
            })
            if (!isDuplicate) {
              newPresets.push(preset)
            }
          })
          
          if (newPresets.length > 0) {
            currentData.psdItems[existingIndex].presets = [...existingPresets, ...newPresets]
            currentData.psdItems[existingIndex].savedAt = Date.now()
            updatedPsdCount++
            totalAddedPresets += newPresets.length
          }
        } else {
          // 添加新PSD项
          const newItem = {
            ...importItem,
            presets: normalizedPresets,
            savedAt: Date.now()
          }
          currentData.psdItems.push(newItem)
          addedPsdCount++
          totalAddedPresets += normalizedPresets.length
        }
      }
      
      // 保存到全局存储
      // 3、仅在存在新增内容时保存并刷新列表。
      if (addedPsdCount > 0 || updatedPsdCount > 0) {
        await saveAllPresetsData(currentData)
        
        let msg = `成功导入 ${totalAddedPresets} 个预设`
        if (addedPsdCount > 0) msg += `，新增 ${addedPsdCount} 个PSD`
        if (updatedPsdCount > 0) msg += `，更新 ${updatedPsdCount} 个PSD`
        message.success(msg)
        
        console.log('✅', msg)
        
        // 重新加载当前PSD的预设
        await loadPresets()
      } else {
        message.info('所有预设都已存在，未导入新预设')
      }
    } catch (error) {
      console.error('❌ 导入预设失败:', error)
      message.error('导入预设失败: ' + error.message)
    }
  }

  // ========== 选择和渲染 ==========

  // 上次点击的预设ID和时间（用于防抖）
  let lastClickedPresetId = null
  let lastClickTime = 0
  
  /**
   * 选择预设（优化：完全异步，防抖保护）
   * 处理流程：
   * 1、忽略短时间内同一预设的重复点击。
   * 2、切换选择状态，异步渲染预设或恢复图层画布。
   */
  const selectPreset = (presetId) => {
    // 1、记录点击间隔，避免双击立即反转选择。
    const now = Date.now()
    
    // 防抖保护：如果在300ms内点击同一个预设，忽略（防止快速双击导致取消）
    if (lastClickedPresetId === presetId && (now - lastClickTime) < 300) {
      console.log('⚠️ 防抖：忽略快速重复点击', presetId)
      return
    }
    
    lastClickedPresetId = presetId
    lastClickTime = now
    
    // 2、依据当前选择决定恢复图层还是绘制预设。
    if (selectedPresetId.value === presetId) {
      // 取消选择
      selectedPresetId.value = null
      console.log('❌ 取消选中预设')
      
      // 异步渲染，不阻塞UI
      renderAllLayers().then(() => {
        if (typeof syncCanvasToPreview === 'function') {
          syncCanvasToPreview().catch(err => {
            console.error('同步预览失败:', err)
          })
        }
      }).catch(err => {
        console.error('渲染失败:', err)
      })
    } else {
      // 选中新预设
      const previousPresetId = selectedPresetId.value
      selectedPresetId.value = presetId
      console.log('✅ 选中预设:', presetId, previousPresetId ? `(从 ${previousPresetId} 切换)` : '')
      
      // 异步渲染，不阻塞UI
      const preset = presets.value.find(p => p.id === presetId)
      if (preset) {
        renderPreset(preset).catch(err => {
          console.error('渲染预设失败:', err)
        })
      }
    }
  }

  // 渲染序列号（用于取消过时的渲染）
  let renderSequence = 0
  
  /**
   * 渲染预设（支持快速切换时自动中断）
   * 处理流程：
   * 1、生成渲染序列并异步加载图片。
   * 2、确认任务与选择仍有效，以离屏缓冲更新画布。
   * 3、释放当前渲染状态，成功后同步独立预览窗口。
   */
  const renderPreset = async (preset) => {
    // 1、用递增序列识别快速切换造成的过期任务。
    const canvas = canvasRef.value
    if (!canvas || !preset.base64Image) return
    
    // 生成当前渲染的序列号
    const currentSequence = ++renderSequence
    const renderingPresetId = preset.id
    
    console.log(`🎬 开始渲染预设 #${currentSequence}:`, preset.name)
    
    let renderSucceeded = false
    try {
      isRendering.value = true
      const ctx = canvas.getContext('2d')
      
      // 加载预设图片（异步操作，期间可能被新的选择中断）
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = resolve
        img.onerror = reject
        img.src = preset.base64Image
      })
      
      // 2、检查序列号与选中预设，避免旧图片覆盖新的选择。
      if (currentSequence !== renderSequence) {
        console.log(`⚠️ 渲染序列已过时 #${currentSequence}（当前 #${renderSequence}），放弃:`, preset.name)
        return
      }
      
      // 检查2：选中的预设是否已变化
      if (selectedPresetId.value !== renderingPresetId) {
        console.log(`⚠️ 预设已切换 #${currentSequence}，放弃渲染:`, preset.name)
        return
      }
      
      // 使用双缓冲技术：先在离屏canvas绘制，然后一次性更新到主canvas
      const offscreenCanvas = document.createElement('canvas')
      offscreenCanvas.width = canvas.width
      offscreenCanvas.height = canvas.height
      const offscreenCtx = offscreenCanvas.getContext('2d')
      
      // 在离屏canvas上绘制预设图片
      offscreenCtx.drawImage(img, 0, 0)
      
      // 最终检查：确保在绘制前序列号和选中状态都没有变化
      if (currentSequence !== renderSequence || selectedPresetId.value !== renderingPresetId) {
        console.log(`⚠️ 最终检查失败 #${currentSequence}，放弃更新画布:`, preset.name)
        return
      }
      
      // 一次性更新到主canvas（避免闪烁）
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(offscreenCanvas, 0, 0)
      
      console.log(`✅ 渲染预设完成 #${currentSequence}:`, preset.name)
      renderSucceeded = true
    } catch (error) {
      console.error(`❌ 渲染预设失败 #${currentSequence}:`, error)
      message.error('渲染预设失败')
    } finally {
      // 只有当前序列是最新时才释放锁
      if (currentSequence === renderSequence) {
        isRendering.value = false
      }
    }
    
    // 3、仅把成功绘制的预设同步到独立预览窗口。
    if (renderSucceeded && typeof syncCanvasToPreview === 'function') {
      // 异步同步到预览窗口，不阻塞主流程
      syncCanvasToPreview().catch(err => {
        console.error('同步预览窗口失败:', err)
      })
    }
  }

  /**
   * 取消选中所有预设（双击时触发）
   * 处理流程：
   * 1、清除当前选择并重新渲染图层画布。
   */
  const deselectAllPresets = async () => {
    // 1、仅在存在选中预设时恢复图层渲染。
    if (selectedPresetId.value) {
      selectedPresetId.value = null
      console.log('❌ 双击取消选中所有预设')
      await renderAllLayers()
      message.info('已取消选中预设')
    }
  }

  // ========== 删除和重命名 ==========

  /**
   * 确认删除预设
   * 处理流程：
   * 1、找到目标预设并显示确认对话框，确认后执行删除。
   */
  const confirmDeletePreset = (presetId) => {
    // 1、以预设名称确认删除对象。
    const preset = presets.value.find(p => p.id === presetId)
    if (!preset) return
    
    // 使用 Naive UI 对话框
    dialog.warning({
      title: '删除预设',
      content: `确定要删除预设"${preset.name}"吗？\n删除后将无法恢复。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        deletePreset(presetId)
      }
    })
  }

  /**
   * 删除预设
   * 处理流程：
   * 1、删除列表项目并保存，随后清理预览文件。
   * 2、若删除当前选择，则恢复图层画布。
   */
  const deletePreset = async (presetId) => {
    // 1、删除元数据及其独立预览文件。
    const index = presets.value.findIndex(p => p.id === presetId)
    if (index >= 0) {
      const preset = presets.value[index]
      const previewPath = preset.previewPath
      presets.value.splice(index, 1)
      await savePresets()
      if (previewPath) {
        await deletePresetPreviewFile(previewPath)
      }
      
      // 2、如果删除的是当前选中的预设，取消选择并恢复图层。
      if (selectedPresetId.value === presetId) {
        selectedPresetId.value = null
        renderAllLayers()
      }
      
      message.success(`预设"${preset.name}"已删除`)
      console.log('🗑️ 删除预设:', preset.name)
    }
  }

  /**
   * 重命名预设
   * 处理流程：
   * 1、检查目标存在性与名称冲突。
   * 2、更新名称并保存列表。
   */
  const renamePreset = async (presetId, newName) => {
    // 1、定位预设并排除其他预设已经使用的名称。
    const preset = presets.value.find(p => p.id === presetId)
    if (!preset) return
    
    // 检查重名
    if (presets.value.some(p => p.id !== presetId && p.name === newName)) {
      message.warning('预设名称已存在')
      return false
    }
    
    // 2、保存新名称并反馈结果。
    preset.name = newName
    await savePresets()
    message.success('预设已重命名')
    console.log('✏️ 重命名预设:', newName)
    return true
  }

  // 3、向页面暴露预设状态和操作方法。
  return {
    // 状态
    presets,
    selectedPresetId,
    editingPresetId,
    
    // 常量
    GLOBAL_PRESETS_STORAGE_KEY,
    
    // 方法
    getAllPresetsData,
    saveAllPresetsData,
    findPresetsByMatch,
    loadPresets,
    savePresets,
    handleSavePreset,
    handleExportPreset,
    handleImportPreset,
    selectPreset,
    renderPreset,
    deselectAllPresets,
    confirmDeletePreset,
    deletePreset,
    renamePreset
  }
}
