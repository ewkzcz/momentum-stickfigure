/**
 * 模板数据管理逻辑
 * 负责模板的增删改查、导入导出、持久化存储等功能
 * 
 * 模板与预设的区别：
 * - 预设：保存完整的画布渲染结果（base64图片）
 * - 模板：保存部件选择配置（文本信息），分为：
 *   - 动作模板：管理动作相关标签（前手、后手、双手、手部、动作等）
 *   - 表情模板：管理表情相关标签
 * 模板配置按标签保存所选部件名称，预览图片独立保存到文件系统。
 */

import { ref, computed } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { calculatePsdHash } from '../utils/hashUtils'
import { generateId, generatePresetName } from '../utils/stringUtils'
import { getCustomGroupNames } from '../utils/psdClassifyUtils'

// ========== 文件系统存储辅助函数 ==========

/**
 * 将模板预览图保存到文件系统
 * 处理流程：
 * 1、检查桌面接口及待保存预览列表
 * 2、批量保存图片并返回路径记录，失败时返回空列表
 * @param {string} templateType - 模板类型
 * @param {Array} imagePreviews - 图片数据数组 [{ id, base64_data }]
 * @returns {Promise<Array>} 返回路径数据数组 [{ id, file_path }]
 */
async function savePreviewsToFileSystem(templateType, imagePreviews) {
  // 1、确认批量保存接口和图片数据可用。
  try {
    if (!window.electronAPI?.invoke) {
      console.warn('⚠️ Electron API不可用，无法保存到文件系统')
      return []
    }
    
    if (!imagePreviews || imagePreviews.length === 0) {
      return []
    }
    
    // 2、交给主进程写入文件并收集保存成功的路径。
    const result = await window.electronAPI.invoke('template-storage-batch-save', {
      templateType,
      imagePreviews
    })
    
    if (result.success) {
      console.log(`✅ 批量保存预览图到文件系统: ${result.results.length}个`)
      return result.results
    } else {
      console.error('❌ 保存预览图到文件系统失败:', result.error)
      return []
    }
  } catch (error) {
    console.error('❌ 保存预览图到文件系统出错:', error)
    return []
  }
}

/**
 * 从文件系统加载模板预览图
 * 处理流程：
 * 1、检查桌面接口与图片路径列表
 * 2、批量读取图片并返回编码数据，失败时返回空列表
 * @param {Array} filePathsData - 文件路径数组 [{ id, file_path }]
 * @returns {Promise<Array>} 返回base64数据数组 [{ id, base64_data }]
 */
async function loadPreviewsFromFileSystem(filePathsData) {
  // 1、跳过接口缺失或没有路径的加载请求。
  try {
    if (!window.electronAPI?.invoke) {
      console.warn('⚠️ Electron API不可用，无法从文件系统加载')
      return []
    }

    if (!filePathsData || filePathsData.length === 0) {
      return []
    }

    // 2、批量加载图片并记录实际读取数量和数据大小。
    const result = await window.electronAPI.invoke('template-storage-batch-load', {
      filePathsData
    })

    if (result.success) {
      const sizeInMB = result.results.reduce((sum, r) => sum + (r.base64_data?.length || 0), 0) / 1024 / 1024
      console.log(`✅ 加载模板图片: ${result.results.length}个 (${sizeInMB.toFixed(2)}MB)`)
      return result.results
    } else {
      console.error('❌ 从文件系统加载预览图失败:', result.error)
      return []
    }
  } catch (error) {
    console.error('❌ 从文件系统加载预览图出错:', error)
    return []
  }
}

/**
 * 从文件系统删除模板预览图
 * 处理流程：
 * 1、检查桌面接口及待删除路径
 * 2、批量删除文件并返回成功数量，失败时返回零
 * @param {Array} filePathsData - 文件路径数组 [{ id, file_path }]
 * @returns {Promise<number>} 返回删除成功的数量
 */
async function deletePreviewsFromFileSystem(filePathsData) {
  // 1、确认存在可删除的预览路径及桌面接口。
  try {
    if (!window.electronAPI?.invoke) {
      console.warn('⚠️ Electron API不可用，无法从文件系统删除')
      return 0
    }
    
    if (!filePathsData || filePathsData.length === 0) {
      return 0
    }
    
    // 2、调用批量删除并返回主进程确认的数量。
    const result = await window.electronAPI.invoke('template-storage-batch-delete', {
      filePathsData
    })
    
    if (result.success) {
      console.log(`✅ 从文件系统删除预览图: ${result.deleteCount}个`)
      return result.deleteCount
    } else {
      console.error('❌ 从文件系统删除预览图失败:', result.error)
      return 0
    }
  } catch (error) {
    console.error('❌ 从文件系统删除预览图出错:', error)
    return 0
  }
}

// 动作模板存储的固定Key（所有PSD共享的模板）
const ACTION_TEMPLATE_STORAGE_KEY = 'stickfigure-action-templates'
// 表情模板存储的固定Key（所有PSD共享的模板）
const EXPRESSION_TEMPLATE_STORAGE_KEY = 'stickfigure-expression-templates'
// 旧版模板1存储Key（用于数据迁移）
const TEMPLATE1_STORAGE_KEY = 'stickfigure-all-templates-1'
// 旧版模板2存储Key（用于数据迁移）
const TEMPLATE2_STORAGE_KEY = 'stickfigure-all-templates-2'
// 全局模板存储的固定Key（兼容旧版）
const GLOBAL_TEMPLATES_STORAGE_KEY = 'stickfigure-all-templates'
// 旧版按PSD存储的Key（用于数据迁移）
const OLD_TEMPLATES_STORAGE_KEY = 'stickfigure-all-templates-old'
// 当前活动模板类型存储Key
const ACTIVE_TEMPLATE_TYPE_KEY = 'stickfigure-active-template-type'

/**
 * 检查本地存储是否存在指定键。
 * 处理流程：
 * 1、确认存储和键有效后逐项比较键名
 * 2、未找到或访问异常时返回不存在
 */
const hasLocalStorageKey = (key) => {
  // 1、只扫描键名，避免读取可能较大的模板数据。
  try {
    if (typeof localStorage === 'undefined' || !key) return false
    for (let i = 0; i < localStorage.length; i++) {
      if (localStorage.key(i) === key) {
        return true
      }
    }
  } catch (_) {}
  // 2、没有匹配键或存储不可访问。
  return false
}

/**
 * 新版模板存储存在时清理旧版备份键。
 * 处理流程：
 * 1、确认本地存储已包含新版模板类型
 * 2、移除旧版备份并记录清理结果
 */
const cleanupLegacyTemplateBackup = () => {
  // 1、只有检测到迁移后的存储键才清理旧备份。
  try {
    if (typeof localStorage === 'undefined') return
    const hasMigratedStore =
      hasLocalStorageKey(ACTION_TEMPLATE_STORAGE_KEY) || hasLocalStorageKey(EXPRESSION_TEMPLATE_STORAGE_KEY)
    if (!hasMigratedStore) return
    // 2、移除旧版大体积数据，避免重复读取。
    if (hasLocalStorageKey(OLD_TEMPLATES_STORAGE_KEY)) {
      localStorage.removeItem(OLD_TEMPLATES_STORAGE_KEY)
      console.log('🧹 已清理 stickfigure-all-templates-old 备份，避免重复加载大体积数据')
    }
  } catch (error) {
    console.warn('⚠️ 清理旧版模板备份失败:', error)
  }
}

cleanupLegacyTemplateBackup()

/**
 * 管理动作和表情模板的状态、存储与预览。
 * 处理流程：
 * 1、初始化两类模板状态及当前类型的派生引用
 * 2、定义排序、存储迁移、配置捕获与模板操作
 * 3、提供预览缓存及对外管理接口
 */
export function useTemplateData({
  currentPsdFile,
  currentPsdData,
  selectedParts,
  userInteracted,
  dynamicExpressionTabs,
  applyTemplateConfig, // 应用模板配置的回调函数
  renderTemplatesPreviews // 重新渲染模板预览的回调函数（可选）
}) {
  // 1、初始化消息接口、两类模板状态及兼容引用。
  const message = useMessage()
  const dialog = useDialog()

  // ========== 状态定义 ==========
  // 当前活动的模板类型：'actionTemplate' 或 'expressionTemplate'
  const activeTemplateType = ref('actionTemplate')
  
  // 动作模板相关状态
  const actionTemplates = ref([]) // 动作模板列表 [{ id, name, config, timestamp }]
  const selectedActionTemplateId = ref(null) // 动作模板当前选中的ID
  const editingActionTemplateId = ref(null) // 动作模板当前正在编辑的ID
  
  // 表情模板相关状态
  const expressionTemplates = ref([]) // 表情模板列表 [{ id, name, config, timestamp }]
  const selectedExpressionTemplateId = ref(null) // 表情模板当前选中的ID
  const editingExpressionTemplateId = ref(null) // 表情模板当前正在编辑的ID
  
  // 计算属性：当前活动的模板列表和选中ID
  const templates = computed(() => {
    return activeTemplateType.value === 'actionTemplate' ? actionTemplates.value : expressionTemplates.value
  })
  const selectedTemplateId = computed({
    get: () => activeTemplateType.value === 'actionTemplate' ? selectedActionTemplateId.value : selectedExpressionTemplateId.value,
    set: (val) => {
      if (activeTemplateType.value === 'actionTemplate') {
        selectedActionTemplateId.value = val
      } else {
        selectedExpressionTemplateId.value = val
      }
    }
  })
  const editingTemplateId = computed({
    get: () => activeTemplateType.value === 'actionTemplate' ? editingActionTemplateId.value : editingExpressionTemplateId.value,
    set: (val) => {
      if (activeTemplateType.value === 'actionTemplate') {
        editingActionTemplateId.value = val
      } else {
        editingExpressionTemplateId.value = val
      }
    }
  })
  
  // 2、定义模板排序、持久化迁移和模板编辑操作。
  /**
   * 规范模板列表的顺序字段。
   * 处理流程：
   * 1、按排序号排序，同序号时比较时间戳
   * 2、将排序号重写为连续的正整数
   */
  const ensureTemplateOrder = (templateList) => {
    // 1、缺少排序号的模板排在后面，并用时间戳稳定同序号顺序。
    if (!Array.isArray(templateList)) return
    templateList.sort((a, b) => {
      const orderA = typeof a.sortOrder === 'number' ? a.sortOrder : Number.MAX_SAFE_INTEGER
      const orderB = typeof b.sortOrder === 'number' ? b.sortOrder : Number.MAX_SAFE_INTEGER
      if (orderA === orderB) {
        return (a.timestamp || 0) - (b.timestamp || 0)
      }
      return orderA - orderB
    })
    // 2、将最终顺序写回每个模板。
    templateList.forEach((template, index) => {
      template.sortOrder = index + 1
    })
  }

  /**
   * 获取新模板的末尾排序号。
   * 处理流程：
   * 1、空列表从一开始，否则取最大有效排序号的下一个值
   */
  const getNextSortOrder = (templateList) => {
    // 1、计算可追加到列表末尾的排序号。
    if (!Array.isArray(templateList) || templateList.length === 0) {
      return 1
    }
    const maxOrder = Math.max(...templateList.map(t => typeof t.sortOrder === 'number' ? t.sortOrder : 0))
    return Number.isFinite(maxOrder) ? maxOrder + 1 : templateList.length + 1
  }

  // 兼容旧版：保留旧的变量名作为别名（用于向后兼容）
  const templates1 = actionTemplates
  const templates2 = expressionTemplates
  const selectedTemplate1Id = selectedActionTemplateId
  const selectedTemplate2Id = selectedExpressionTemplateId
  const editingTemplate1Id = editingActionTemplateId
  const editingTemplate2Id = editingExpressionTemplateId

  // ========== 存储相关 ==========

  /**
   * 获取指定模板类型的存储Key
   * 处理流程：
   * 1、兼容新旧类型名称并返回对应存储键，未知类型使用动作模板键
   */
  const getStorageKey = (templateType = null) => {
    // 1、统一映射显式类型和当前活动类型。
    const type = templateType || activeTemplateType.value
    // 兼容旧版类型名
    if (type === 'template1' || type === 'actionTemplate') {
      return ACTION_TEMPLATE_STORAGE_KEY
    }
    if (type === 'template2' || type === 'expressionTemplate') {
      return EXPRESSION_TEMPLATE_STORAGE_KEY
    }
    return ACTION_TEMPLATE_STORAGE_KEY // 默认返回动作模板
  }

  /**
   * 从存储中获取指定模板类型的数据
   * 从文件系统加载预览图，并自动迁移旧版base64数据
   * 处理流程：
   * 1、读取指定类型存储，缺失时尝试旧键迁移
   * 2、识别按文档分组的旧格式并转换
   * 3、按加载选项读取文件预览，或迁移旧内嵌图片
   * 4、补齐兼容字段并返回数据，读取异常时返回空结构
   * @param {String} templateType - 模板类型
   * @param {Boolean} loadImages - 是否加载预览图（默认false，延迟加载以提升性能）
   */
  const getAllTemplatesData = async (templateType = null, loadImages = false) => {
    // 1、定位模板类型的存储键，并兼容早期存储位置。
    try {
      const type = templateType || activeTemplateType.value
      const storageKey = getStorageKey(type)
      let stored = localStorage.getItem(storageKey)
      
      if (!stored) {
        // 尝试从旧版存储迁移
        if (type === 'template1' || type === 'actionTemplate') {
          // 先尝试从旧版template1迁移
          const oldStored = localStorage.getItem(TEMPLATE1_STORAGE_KEY)
          if (oldStored) {
            console.log('🔄 从旧版模板1迁移到动作模板...')
            const oldData = JSON.parse(oldStored)
            await migrateAndSaveOldData(oldData, type)
            // 重新读取迁移后的数据
            stored = localStorage.getItem(storageKey)
            if (!stored) {
              return { templates: [], image_preview: [], version: '5.0.0' }
            }
          } else {
            // 再尝试从更旧的格式迁移
            return await migrateOldTemplatesData()
          }
        }
        if (type === 'template2' || type === 'expressionTemplate') {
          // 尝试从旧版template2迁移
          const oldStored = localStorage.getItem(TEMPLATE2_STORAGE_KEY)
          if (oldStored) {
            console.log('🔄 从旧版模板2迁移到表情模板...')
            const oldData = JSON.parse(oldStored)
            await migrateAndSaveOldData(oldData, type)
            // 重新读取迁移后的数据
            stored = localStorage.getItem(storageKey)
            if (!stored) {
              return { templates: [], image_preview: [], version: '5.0.0' }
            }
          }
        }
        if (!stored) {
          return { templates: [], image_preview: [], version: '5.0.0' }
        }
      }
      
      const data = JSON.parse(stored)
      // 2、如果是旧版格式（包含按文档分组的数据），进行迁移。
      if (data.psdItems && Array.isArray(data.psdItems)) {
        console.log('🔄 检测到旧版模板格式，开始迁移...')
        const migratedData = migrateFromOldFormat(data, type)
        await migrateAndSaveOldData(migratedData, type)
        // 重新读取迁移后的数据
        stored = localStorage.getItem(storageKey)
        if (stored) {
          const newData = JSON.parse(stored)
          if (newData.image_file_paths) {
            const imagePreviews = await loadPreviewsFromFileSystem(newData.image_file_paths)
            return {
              ...newData,
              image_preview: imagePreviews,
              version: '5.0.0'
            }
          }
        }
        return migratedData
      }

      // 3、按存储格式和加载选项读取文件预览，旧内嵌图片则先迁移。
      if (data.storage_version === '5.0.0' && data.image_file_paths) {
        // 只有明确要求加载图片时才从文件系统加载
        if (loadImages) {
          console.log(`📂 从文件系统加载预览图 (${data.image_file_paths.length}张)...`)

          // 从文件系统加载预览图
          const imagePreviews = await loadPreviewsFromFileSystem(data.image_file_paths)

          return {
            ...data,
            image_preview: imagePreviews,
            version: '5.0.0'
          }
        } else {
          // 延迟加载模式：不加载预览图，节省初始加载时间
          console.log(`⚡ 延迟加载模式：跳过 ${data.image_file_paths.length} 张预览图的加载`)
          return {
            ...data,
            image_preview: [], // 返回空数组，图片将在需要时按需加载
            version: '5.0.0'
          }
        }
      }
      
      // 🔄 旧版本数据迁移：如果有base64数据在localStorage中，迁移到文件系统
      if (data.image_preview && data.image_preview.length > 0 && !data.image_file_paths) {
        console.log(`🔄 检测到旧版存储格式（有base64数据），执行数据迁移...`)
        await migrateAndSaveOldData(data, type)
        
        // 重新读取迁移后的数据
        stored = localStorage.getItem(storageKey)
        if (stored) {
          const newData = JSON.parse(stored)
          const imagePreviews = await loadPreviewsFromFileSystem(newData.image_file_paths || [])
          return {
            ...newData,
            image_preview: imagePreviews,
            version: '5.0.0'
          }
        }
      }
      
      // 4、兼容旧版：如果没有预览字段，添加空数组。
      if (!data.image_preview) {
        data.image_preview = []
      }
      return data
    } catch (error) {
      console.error('❌ 读取模板数据失败:', error)
      return { templates: [], image_preview: [], version: '5.0.0' }
    }
  }
  
  /**
   * 迁移旧版数据到新版文件系统存储
   * 处理流程：
   * 1、复用统一保存入口转换内嵌预览图并记录迁移结果
   * @param {Object} oldData - 旧版数据（包含base64）
   * @param {String} templateType - 模板类型
   */
  const migrateAndSaveOldData = async (oldData, templateType) => {
    // 1、由统一保存逻辑将预览图片写入文件系统。
    try {
      console.log(`🔄 开始迁移旧版数据到文件系统...`)
      
      // 调用保存函数，会自动将base64转为文件存储
      await saveAllTemplatesData(oldData, templateType)
      
      console.log(`✅ 旧版数据迁移完成`)
    } catch (error) {
      console.error('❌ 旧版数据迁移失败:', error)
    }
  }

  /**
   * 从旧版按PSD存储的格式迁移到新版全局格式
   * 处理流程：
   * 1、合并各文档模板并按编号或配置去重
   * 2、构造全局模板结构并保存到指定类型
   * 3、清理旧备份并返回迁移结果
   */
  const migrateFromOldFormat = async (oldData, templateType = null) => {
    // 1、收集不同文档下的模板并去除重复配置。
    console.log('📦 开始从旧版格式迁移模板数据...')
    const allTemplates = []
    const templateIdSet = new Set()
    
    // 合并所有PSD的模板到全局
    if (oldData.psdItems && Array.isArray(oldData.psdItems)) {
      oldData.psdItems.forEach(psdItem => {
        if (psdItem.templates && Array.isArray(psdItem.templates)) {
          psdItem.templates.forEach(template => {
            // 去重：检查ID和配置
            const configStr = JSON.stringify(template.config)
            const isDuplicate = allTemplates.some(t => 
              t.id === template.id || JSON.stringify(t.config) === configStr
            )
            if (!isDuplicate) {
              allTemplates.push(template)
              templateIdSet.add(template.id)
            }
          })
        }
      })
    }
    
    // 2、为旧数据补齐全局模板结构并持久化。
    const newData = {
      templates: allTemplates,
      image_preview: [], // 旧数据没有预览图
      version: '4.1.0',
      migratedAt: Date.now()
    }
    
    console.log(`✅ 迁移完成：合并了 ${oldData.psdItems?.length || 0} 个PSD的模板，去重后共 ${allTemplates.length} 个模板`)
    
    // 保存新格式数据（迁移到动作模板）
    await saveAllTemplatesData(newData, templateType || 'actionTemplate')
    
    // 3、旧版数据已迁移，清理内嵌图片备份以避免重复加载。
    try {
      localStorage.removeItem(OLD_TEMPLATES_STORAGE_KEY)
      console.log('🧹 已清理 stickfigure-all-templates-old 旧版备份，释放内存')
    } catch (e) {
      console.warn('⚠️ 清理旧版数据失败:', e)
    }

    cleanupLegacyTemplateBackup()
    
    return newData
  }

  /**
   * 尝试迁移旧版数据（迁移到动作模板）
   * 处理流程：
   * 1、优先读取旧备份键，其次读取旧全局模板键
   * 2、发现数据时迁移到动作模板，未找到时返回空结构
   */
  const migrateOldTemplatesData = async () => {
    // 1、按旧备份、旧全局模板的顺序查找迁移来源。
    try {
      // 先尝试从旧版OLD_TEMPLATES_STORAGE_KEY读取
      let oldStored = localStorage.getItem(OLD_TEMPLATES_STORAGE_KEY)
      if (oldStored) {
        const oldData = JSON.parse(oldStored)
        // 2、将旧模板集合迁移到动作模板存储。
        return await migrateFromOldFormat(oldData, 'actionTemplate')
      }
      
      // 再尝试从GLOBAL_TEMPLATES_STORAGE_KEY读取（兼容旧版）
      oldStored = localStorage.getItem(GLOBAL_TEMPLATES_STORAGE_KEY)
      if (oldStored) {
        const oldData = JSON.parse(oldStored)
        return await migrateFromOldFormat(oldData, 'actionTemplate')
      }
    } catch (error) {
      console.warn('⚠️ 旧版数据迁移失败:', error)
    }
    return { templates: [], image_preview: [], version: '5.0.0' }
  }

  /**
   * 保存模板数据到指定模板类型的存储
   * 预览图保存到文件系统，localStorage只保存文件路径引用
   * 处理流程：
   * 1、确定模板类型和持久化存储键
   * 2、将传入预览图片批量写入文件系统
   * 3、序列化不含图片内容的配置及路径引用并保存
   * 4、保存失败时提示错误并向上抛出异常
   */
  const saveAllTemplatesData = async (data, templateType = null) => {
    // 1、确定本次数据对应的模板存储。
    try {
      const type = templateType || activeTemplateType.value
      const storageKey = getStorageKey(type)
      const typeName = getTemplateTypeName(type)
      
      console.log(`💾 准备保存${typeName}数据: ${data.templates?.length || 0} 个模板, ${data.image_preview?.length || 0} 个预览图`)
      
      // 2、将预览图片保存到文件系统，本地配置只记录路径。
      let filePathsData = []
      
      if (data.image_preview && data.image_preview.length > 0) {
        console.log(`🔄 将${data.image_preview.length}个预览图保存到文件系统...`)
        
        // 将base64数据保存到文件系统
        filePathsData = await savePreviewsToFileSystem(type, data.image_preview)
        
        if (filePathsData.length > 0) {
          console.log(`✅ 成功保存${filePathsData.length}个预览图到文件系统`)
        } else {
          console.warn(`⚠️ 预览图保存到文件系统失败，将使用降级方案`)
        }
      }
      
      // 3、构建不含内嵌图片的配置并保存到本地存储。
      const storageData = {
        ...data,
        image_preview: [], // 清空base64数据
        image_file_paths: filePathsData, // 保存文件路径引用
        storage_version: '5.0.0' // 新版本标记，表示使用文件系统存储
      }
      
      const jsonString = JSON.stringify(storageData)
      const sizeInKB = (jsonString.length / 1024).toFixed(2)
      
      console.log(`💾 保存${typeName}配置到localStorage (大小: ${sizeInKB}KB)`)
      
      // 保存到localStorage（现在数据很小，不会超限）
      localStorage.setItem(storageKey, jsonString)
      console.log(`✅ 保存${typeName}数据成功`)
      
    } catch (error) {
      // 4、提示持久化错误并让调用者感知保存失败。
      console.error('❌ 保存模板失败:', error)
      message.error('保存模板失败: ' + error.message)
      throw error
    }
  }
  
  /**
   * 获取模板类型的中文名称
   * 处理流程：
   * 1、兼容新旧类型名称并返回对应中文标签
   */
  const getTemplateTypeName = (type) => {
    // 1、将显式或当前模板类型转换为可读名称。
    const t = type || activeTemplateType.value
    if (t === 'template1' || t === 'actionTemplate') return '动作模板'
    if (t === 'template2' || t === 'expressionTemplate') return '表情模板'
    return '模板'
  }

  // ========== 加载模板 ==========

  /**
   * 加载活动模板类型的持久化存储
   * 处理流程：
   * 1、读取上次活动类型并兼容旧名称
   * 2、未知值或读取异常时恢复动作模板
   */
  const loadActiveTemplateType = () => {
    // 1、从本地存储恢复活动模板类型。
    try {
      const stored = localStorage.getItem(ACTIVE_TEMPLATE_TYPE_KEY)
      // 兼容旧版类型名
      if (stored === 'template1' || stored === 'actionTemplate') {
        activeTemplateType.value = 'actionTemplate'
        console.log('📂 恢复活动模板类型: 动作模板')
      } else if (stored === 'template2' || stored === 'expressionTemplate') {
        activeTemplateType.value = 'expressionTemplate'
        console.log('📂 恢复活动模板类型: 表情模板')
      } else {
        // 2、没有有效历史类型时采用动作模板。
        activeTemplateType.value = 'actionTemplate'
        console.log('📂 使用默认活动模板类型: 动作模板')
      }
    } catch (error) {
      console.error('❌ 加载活动模板类型失败:', error)
      activeTemplateType.value = 'actionTemplate'
    }
  }

  /**
   * 保存活动模板类型到持久化存储
   * 处理流程：
   * 1、写入当前活动类型并记录结果，失败时仅记录日志
   */
  const saveActiveTemplateType = () => {
    // 1、保存下次进入页面需要恢复的类型。
    try {
      localStorage.setItem(ACTIVE_TEMPLATE_TYPE_KEY, activeTemplateType.value)
      const typeName = getTemplateTypeName(activeTemplateType.value)
      console.log('💾 保存活动模板类型:', typeName)
    } catch (error) {
      console.error('❌ 保存活动模板类型失败:', error)
    }
  }

  /**
   * 加载所有模板列表（动作模板和表情模板）
   * 默认使用延迟加载模式，不加载预览图以提升初始加载性能
   * 预览图将在鼠标悬浮时按需加载
   * 处理流程：
   * 1、恢复活动类型并清空选择
   * 2、读取动作模板配置并规范排序
   * 3、读取表情模板配置并规范排序
   * 4、加载异常时清空两类列表和选择状态
   */
  const loadTemplates = async () => {
    // 1、恢复模板类型，并为本次加载清理旧选择。
    try {
      console.log('📂 加载模板列表（延迟加载模式）...')

      // 加载活动模板类型
      loadActiveTemplateType()

      // 清空当前选中
      selectedActionTemplateId.value = null
      selectedExpressionTemplateId.value = null

      // 2、加载动作模板配置（不加载预览图）。
      const data1 = await getAllTemplatesData('actionTemplate', false)
      if (data1.templates && Array.isArray(data1.templates)) {
        actionTemplates.value = data1.templates
        ensureTemplateOrder(actionTemplates.value)
        console.log('✅ 成功加载动作模板配置:', actionTemplates.value.length, '个（预览图将按需加载）')
      } else {
        console.log('📝 暂无动作模板')
        actionTemplates.value = []
      }

      // 3、加载表情模板配置（不加载预览图）。
      const data2 = await getAllTemplatesData('expressionTemplate', false)
      if (data2.templates && Array.isArray(data2.templates)) {
        expressionTemplates.value = data2.templates
        ensureTemplateOrder(expressionTemplates.value)
        console.log('✅ 成功加载表情模板配置:', expressionTemplates.value.length, '个（预览图将按需加载）')
      } else {
        console.log('📝 暂无表情模板')
        expressionTemplates.value = []
      }
    } catch (error) {
      // 4、加载失败时恢复空模板状态。
      console.error('❌ 加载模板失败:', error)
      actionTemplates.value = []
      expressionTemplates.value = []
      selectedActionTemplateId.value = null
      selectedExpressionTemplateId.value = null
    }
  }

  /**
   * 切换活动模板类型
   * 处理流程：
   * 1、将旧类型名规范为动作或表情模板
   * 2、更新有效类型并保存，按静默选项决定是否提示
   * @param {String} type - 模板类型 'actionTemplate'/'template1' 或 'expressionTemplate'/'template2'
   * @param {Boolean} silent - 是否静默切换（不显示提示消息）
   */
  const switchTemplateType = (type, silent = false) => {
    // 1、兼容旧版类型名。
    let newType = type
    if (type === 'template1') newType = 'actionTemplate'
    if (type === 'template2') newType = 'expressionTemplate'
    
    // 2、仅保存受支持的活动类型。
    if (newType === 'actionTemplate' || newType === 'expressionTemplate') {
      activeTemplateType.value = newType
      saveActiveTemplateType()
      const typeName = getTemplateTypeName(newType)
      console.log('🔄 切换到', typeName)
      if (!silent) {
        message.info(`已切换到${typeName}`)
      }
    }
  }

  // ========== 保存和创建 ==========

  /**
   * 捕获当前配置为模板配置对象
   * 简化版：只保存标签名称和选中部件名称的数组
   * 根据模板类型决定保存哪些标签：
   * - 动作模板：保存动作相关标签（前手、后手、双手、手部、动作等）
   * - 表情模板：保存表情相关标签（使用系统配置的表情图组名称）
   * 处理流程：
   * 1、确定模板类型及标签筛选规则
   * 2、遍历已选部件并规范标签名称
   * 3、识别动作和表情标签，过滤不属于目标类型的项
   * 4、按标签合并去重后的部件名称并返回配置
   */
  const captureCurrentConfig = (templateType = null) => {
    // 1、准备模板类型、排除标签及表情图组配置。
    const configArray = []
    const type = templateType || activeTemplateType.value
    
    // 排除的标签（上身、下身）
    const excludedKeys = ['upperBody', 'lowerBody']
    
    // 动作相关的标签key（手部和动作）
    const actionKeys = ['frontHandNormal', 'frontHandRight', 'frontHandBoth', 'bothHands', 
                        'backHand', 'frontLayerBackHand', 'action', 'handParts']
    
    // 获取系统配置的表情图组名称列表
    const customGroupNames = getCustomGroupNames()
    const expressionNames = customGroupNames.expression || []
    
    // 根据模板类型决定过滤逻辑
    const isActionTemplate = type === 'actionTemplate' || type === 'template1'
    const isExpressionTemplate = type === 'expressionTemplate' || type === 'template2'
    
    // 2、遍历所有选中的部件并确定标准标签名称。
    if (selectedParts?.value) {
      for (const [groupKey, partOrParts] of Object.entries(selectedParts.value)) {
        // 跳过排除的标签
        if (excludedKeys.includes(groupKey)) {
          continue
        }
        
        // 查找标签配置（使用现有的 dynamicExpressionTabs）
        const tabConfig = dynamicExpressionTabs?.value?.find(t => t.key === groupKey)
        
        // 标准化标签名称映射（确保保存的名称能在应用时正确识别）
        const standardNameMap = {
          'frontHandNormal': '前手',
          'frontHandRight': '右手',
          'frontHandBoth': '双手',
          'bothHands': '双手',
          'backHand': '后手',
          'frontLayerBackHand': '前层后手',
          'action': '动作',
          'handParts': '手部'
        }
        
        // 使用标准名称或配置中的label
        const tabName = standardNameMap[groupKey] || (tabConfig ? tabConfig.label : groupKey)
        
        // 3、优先使用标签的表情标记，缺失时匹配系统配置的表情图组名称。
        let isExpressionTab = tabConfig?.isExpression === true
        if (!isExpressionTab) {
          // 检查标签名是否匹配配置的表情图组名称
          isExpressionTab = expressionNames.some(exprName => 
            tabName === exprName || tabName.includes(exprName) || exprName.includes(tabName)
          )
        }
        
        const isActionTab = actionKeys.includes(groupKey)
        
        // 动作模板：只保存动作标签，排除表情
        if (isActionTemplate) {
          if (isExpressionTab) {
            continue
          }
          if (!isActionTab) {
            continue
          }
        }
        
        // 表情模板：只保存表情标签，排除动作
        if (isExpressionTemplate) {
          if (isActionTab) {
            continue
          }
          if (!isExpressionTab) {
            continue
          }
        }
        
        // 4、按标签收集部件名称，同时兼容单选、多选并去重。
        if (partOrParts) {
          // 查找该标签是否已存在
          let existingTabConfig = configArray.find(c => c.tabName === tabName)
          if (!existingTabConfig) {
            existingTabConfig = {
              tabName: tabName,
              selectedParts: []
            }
            configArray.push(existingTabConfig)
          }
          
          // 处理数组（多个部件）或单个对象
          const partsArray = Array.isArray(partOrParts) ? partOrParts : [partOrParts]
          
          // 添加所有选中的部件名称
          for (const part of partsArray) {
            if (part) {
              const partName = part.displayName || part.name
              if (!existingTabConfig.selectedParts.includes(partName)) {
                existingTabConfig.selectedParts.push(partName)
              }
            }
          }
        }
      }
    }
    
    return configArray
  }

  /**
   * 生成模板的可读描述（用于显示）
   * 修改为逗号拼接格式，不显示标签名称
   * 处理流程：
   * 1、收集各标签下的已选部件名称
   * 2、以逗号连接显示，没有部件时返回空配置提示
   */
  const generateTemplateDescription = (config) => {
    // 1、验证配置数组并汇总部件名称。
    if (!Array.isArray(config) || config.length === 0) {
      return '空配置'
    }
    
    const allParts = []
    for (const item of config) {
      if (item.selectedParts && item.selectedParts.length > 0) {
        // 直接添加部件名称，不添加标签名称前缀
        allParts.push(...item.selectedParts)
      }
    }
    
    // 2、返回适合列表展示的简短描述。
    return allParts.length > 0 ? allParts.join(', ') : '空配置'
  }

  /**
   * 保存当前活动模板类型的模板列表
   * 处理流程：
   * 1、取得当前模板列表及已存预览
   * 2、合并新预览并移除已不存在模板的预览
   * 3、构造完整数据并保存到对应类型存储
   * @param {Array} imagePreviews - 可选的预览图数组 [{ id, base64_data }]
   */
  const saveTemplates = async (imagePreviews = null) => {
    // 1、读取当前类型的模板及完整预览数据。
    try {
      const isActionTemplate = activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
      const currentTemplates = isActionTemplate ? actionTemplates.value : expressionTemplates.value

      // 获取现有的预览图数据（需要加载图片以便保存）
      const existingData = await getAllTemplatesData(activeTemplateType.value, true)
      const existingPreviews = existingData.image_preview || []
      
      // 当前存在的模板ID集合
      const currentTemplateIds = new Set(currentTemplates.map(t => t.id))
      
      // 2、合并新的预览图（如果提供了），并仅保留现存模板引用。
      let finalPreviews = []
      if (imagePreviews && Array.isArray(imagePreviews)) {
        // 创建一个 Map 用于快速查找和更新
        const previewMap = new Map(existingPreviews.map(p => [p.id, p]))
        // 添加或更新新的预览图
        imagePreviews.forEach(preview => {
          if (preview.id && preview.base64_data) {
            previewMap.set(preview.id, preview)
          }
        })
        // 只保留仍然存在的模板的预览图
        finalPreviews = Array.from(previewMap.values()).filter(p => currentTemplateIds.has(p.id))
      } else {
        // 如果没有提供新的预览图（例如删除、重命名等操作），只保留仍然存在的模板的预览图
        finalPreviews = existingPreviews.filter(p => currentTemplateIds.has(p.id))
      }
      
      // 3、构建模板与预览数据并持久化。
      const allData = {
        templates: currentTemplates,
        image_preview: finalPreviews,
        version: '5.0.0',
        savedAt: Date.now()
      }
      
      // 保存到对应模板类型的存储（现在是async）
      await saveAllTemplatesData(allData, activeTemplateType.value)
      
      const typeName = getTemplateTypeName(activeTemplateType.value)
      console.log(`💾 保存${typeName}列表:`, currentTemplates.length, '个, 预览图:', finalPreviews.length, '个')
    } catch (error) {
      console.error('❌ 保存模板失败:', error)
    }
  }

  /**
   * 添加当前配置为模板
   * 处理流程：
   * 1、确定目标类型并临时切换当前类型
   * 2、捕获部件配置并创建带编号、名称和顺序的模板
   * 3、按需生成并检查预览图片
   * 4、保存模板和预览并提示结果
   * 5、始终恢复调用前的活动模板类型
   * @param {Function} renderNewTemplatePreview - 可选的回调函数，用于渲染新模板预览（已废弃，使用 generatePreviewBase64）
   * @param {String} templateType - 可选的模板类型（'actionTemplate'/'template1' 或 'expressionTemplate'/'template2'），如果不提供则使用activeTemplateType
   * @param {Function} generatePreviewBase64 - 生成预览图 base64 的回调函数
   */
  const handleSaveTemplate = async (renderNewTemplatePreview, templateType, generatePreviewBase64) => {
    // 1、兼容目标类型名称并保存原活动类型。
    try {
      // 如果提供了templateType，则临时切换；否则使用当前activeTemplateType
      let targetType = templateType || activeTemplateType.value
      // 兼容旧版类型名
      if (targetType === 'template1') targetType = 'actionTemplate'
      if (targetType === 'template2') targetType = 'expressionTemplate'
      
      const isActionTemplate = targetType === 'actionTemplate'
      const typeName = getTemplateTypeName(targetType)
      
      // 临时切换activeTemplateType以使用正确的templates computed
      const originalType = activeTemplateType.value
      activeTemplateType.value = targetType
      
      try {
        // 2、捕获当前配置（传递模板类型以便过滤标签）并创建新模板。
        const config = captureCurrentConfig(targetType)
        
        // 生成描述
        const description = generateTemplateDescription(config)
        
        const targetList = isActionTemplate ? actionTemplates.value : expressionTemplates.value
        const template = {
          id: generateId(),
          name: generatePresetName(templates.value, '模板'),
          description: description,
          config: config,
          templateType: targetType, // 记录模板类型
          timestamp: Date.now(),
          sortOrder: getNextSortOrder(targetList)
        }
        
        // 添加到对应的模板列表
        if (isActionTemplate) {
          actionTemplates.value.push(template)
        } else {
          expressionTemplates.value.push(template)
        }
        
        // 3、生成预览图编码数据（如果提供了回调函数）并检查格式。
        let previewBase64 = null
        if (typeof generatePreviewBase64 === 'function') {
          try {
            console.log(`📸 开始为模板"${template.name}"生成预览图...`)
            previewBase64 = await generatePreviewBase64(targetType)
            
            if (previewBase64 && previewBase64.startsWith('data:image/')) {
              const sizeInKB = (previewBase64.length / 1024).toFixed(2)
              console.log(`✅ 已生成模板预览图 base64: ${template.name}, 大小: ${sizeInKB}KB`)
            } else if (previewBase64 === null) {
              console.warn('⚠️ 预览图生成返回null，可能是因为没有加载PSD数据')
            } else {
              console.warn('⚠️ 预览图生成返回了无效的base64数据:', previewBase64?.substring(0, 50))
              previewBase64 = null
            }
          } catch (error) {
            console.error('❌ 生成预览图失败:', error)
            console.error('错误堆栈:', error.stack)
            previewBase64 = null
          }
        } else {
          console.warn('⚠️ 未提供generatePreviewBase64回调函数')
        }
        
        // 4、保存模板，同时保存预览图。
        const imagePreviews = previewBase64 ? [{
          id: template.id,
          base64_data: previewBase64
        }] : null
        
        if (imagePreviews) {
          console.log(`💾 保存模板"${template.name}"和预览图...`)
        } else {
          console.log(`💾 保存模板"${template.name}"（无预览图）...`)
        }
        
        await saveTemplates(imagePreviews)
        
        message.success(`${typeName}"${template.name}"已添加`)
        console.log(`✅ 添加到${typeName}:`, template.name, '描述:', description)
        
        // 🔧 新版本：预览图已经生成并保存为 base64，不需要额外渲染
        // 如果没有 base64 预览图，模板预览将显示为空白（避免长时间渲染）
      } finally {
        // 5、恢复调用前的活动模板类型。
        activeTemplateType.value = originalType
      }
    } catch (error) {
      console.error('❌ 添加模板失败:', error)
      message.error('添加模板失败: ' + error.message)
    }
  }

  // ========== 导出和导入 ==========

  /**
   * 导出当前活动模板类型的所有模板
   * 处理流程：
   * 1、确认当前类型存在可导出的模板
   * 2、选择文件路径并加载全部预览
   * 3、过滤无效图片并构造带类型信息的导出数据
   * 4、序列化保存并报告结果
   */
  const handleExportTemplate = async () => {
    // 1、确定当前模板类型与导出列表。
    try {
      const isActionTemplate = activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
      const typeName = getTemplateTypeName(activeTemplateType.value)
      const currentTemplates = isActionTemplate ? actionTemplates.value : expressionTemplates.value
      
      if (!currentTemplates || currentTemplates.length === 0) {
        message.warning(`当前${typeName}没有任何模板可导出`)
        return
      }
      
      // 2、调用桌面保存对话框并补齐当前类型的预览数据。
      const result = await window.electronAPI?.preset?.export()
      
      if (!result || !result.success) {
        if (!result?.canceled) {
          message.error('导出模板失败')
        }
        return
      }
      
      // 修改导出文件名（添加模板类型后缀）
      let filePath = result.filePath
      const suffix = isActionTemplate ? '-action-templates.json' : '-expression-templates.json'
      if (filePath.endsWith('.json')) {
        filePath = filePath.replace(/\.json$/, suffix)
      }

      // 获取当前模板类型的预览图数据（需要加载图片以便导出）
      const currentData = await getAllTemplatesData(activeTemplateType.value, true)
      const imagePreviews = currentData.image_preview || []
      
      console.log(`📦 准备导出数据: ${currentTemplates.length} 个模板, ${imagePreviews.length} 个预览图（带base64）`)
      
      // 3、验证预览图数据并构造可独立导入的模板包。
      const validPreviews = imagePreviews.filter(p => {
        if (!p.id || !p.base64_data) {
          console.warn('⚠️ 发现无效的预览图数据:', p)
          return false
        }
        if (!p.base64_data.startsWith('data:image/')) {
          console.warn('⚠️ 预览图base64格式不正确:', p.id)
          return false
        }
        return true
      })
      
      if (validPreviews.length < imagePreviews.length) {
        console.warn(`⚠️ 过滤掉 ${imagePreviews.length - validPreviews.length} 个无效预览图`)
      }
      
      // 导出当前模板类型的数据
      const exportData = {
        templates: currentTemplates,
        image_preview: validPreviews, // 只包含有效的预览图数据
        exportTime: Date.now(),
        exportType: 'templates',
        templateType: activeTemplateType.value, // 标记模板类型
        templateTypeName: typeName,
        version: '4.1.0'
      }
      
      // 4、序列化导出数据并调用文件保存接口。
      let content
      try {
        content = JSON.stringify(exportData, null, 2)
        console.log(`📦 导出数据大小: ${(content.length / 1024 / 1024).toFixed(2)}MB`)
        
        // 警告：如果文件太大
        if (content.length > 50 * 1024 * 1024) {
          console.warn(`⚠️ 导出文件过大 (${(content.length / 1024 / 1024).toFixed(2)}MB)，可能会导致保存失败`)
          message.warning(`导出文件较大 (${(content.length / 1024 / 1024).toFixed(2)}MB)，保存可能需要一些时间`)
        }
      } catch (error) {
        console.error('❌ JSON序列化失败:', error)
        message.error('导出数据序列化失败: ' + error.message)
        return
      }
      
      const saveResult = await window.electronAPI?.preset?.saveFile(filePath, content)
      
      if (saveResult && saveResult.success) {
        message.success(`已导出 ${currentTemplates.length} 个${typeName}到: ${filePath}`)
        console.log(`✅ 导出${typeName}成功:`, filePath)
      } else {
        message.error('导出模板失败')
        console.error('❌ 导出模板失败:', saveResult)
      }
    } catch (error) {
      console.error('❌ 导出模板失败:', error)
      message.error('导出模板失败: ' + error.message)
    }
  }

  /**
   * 导入模板到当前活动模板类型（覆盖模式）
   * 处理流程：
   * 1、选择导入文件并解析数据
   * 2、兼容新旧格式，校验预览并规范模板顺序
   * 3、确认覆盖后重新映射模板及预览编号
   * 4、替换列表、发起持久化并安排预览刷新
   * 5、返回导入或取消结果，异常时报告失败
   * @returns {Object} 返回导入结果 { success: boolean, importedCount: number, templateType: string }
   */
  const handleImportTemplate = async () => {
    // 1、记录目标模板类型并读取用户选择的文件。
    try {
      const isActionTemplate = activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
      const typeName = getTemplateTypeName(activeTemplateType.value)
      const templateType = activeTemplateType.value
      const currentTemplateCount = isActionTemplate ? actionTemplates.value.length : expressionTemplates.value.length

      // 调用 Electron API 打开文件对话框
      const result = await window.electronAPI?.preset?.import()

      if (!result || !result.success) {
        if (!result?.canceled) {
          message.error('导入模板失败')
        }
        return { success: false, importedCount: 0, templateType }
      }

      // 解析JSON
      let importData
      try {
        importData = JSON.parse(result.content)
        console.log(`📦 解析导入文件成功，数据大小: ${(result.content.length / 1024 / 1024).toFixed(2)}MB`)
      } catch (error) {
        console.error('❌ 解析JSON失败:', error)
        message.error('导入文件格式不正确: ' + error.message)
        return { success: false, importedCount: 0, templateType }
      }

      // 2、兼容旧版按文档分组的格式，并过滤无效预览。
      let importTemplates = []
      let importPreviews = []
      if (importData.templates && Array.isArray(importData.templates)) {
        // 新版格式：直接获取模板和预览图
        importTemplates = importData.templates
        const rawPreviews = importData.image_preview || []

        // 🔧 验证预览图数据
        importPreviews = rawPreviews.filter(p => {
          if (!p.id || !p.base64_data) {
            console.warn('⚠️ 发现无效的预览图数据:', p)
            return false
          }
          if (!p.base64_data.startsWith('data:image/')) {
            console.warn('⚠️ 预览图base64格式不正确:', p.id)
            return false
          }
          return true
        })

        if (importPreviews.length < rawPreviews.length) {
          console.warn(`⚠️ 过滤掉 ${rawPreviews.length - importPreviews.length} 个无效预览图`)
        }

        console.log(`📦 导入数据: ${importTemplates.length} 个模板, ${importPreviews.length} 个有效预览图`)
      } else if (importData.psdItems && Array.isArray(importData.psdItems)) {
        // 旧版格式：从psdItems中提取并合并所有模板
        console.log('🔄 检测到旧版模板格式，正在转换...')
        const templateSet = new Map() // 使用Map去重

        importData.psdItems.forEach(psdItem => {
          if (psdItem.templates && Array.isArray(psdItem.templates)) {
            psdItem.templates.forEach(template => {
              const configStr = JSON.stringify(template.config)
              if (!templateSet.has(configStr)) {
                templateSet.set(configStr, template)
              }
            })
          }
        })

        importTemplates = Array.from(templateSet.values())
        importPreviews = [] // 旧版没有预览图
        console.log(`📦 从旧版格式提取了 ${importTemplates.length} 个模板`)
      } else {
        message.error('模板文件格式不正确')
        return { success: false, importedCount: 0, templateType }
      }

      if (importTemplates.length === 0) {
        message.warning('导入文件中没有模板')
        return { success: false, importedCount: 0, templateType }
      }

      // 确保导入模板具备稳定的排序字段
      ensureTemplateOrder(importTemplates)

      // 验证是否为模板文件（兼容处理）
      if (importData.exportType && importData.exportType !== 'templates') {
        message.warning('这似乎不是模板文件，可能是预设文件')
      }

      // 3、显示覆盖确认对话框，确认后创建新的模板编号映射。
      return new Promise((resolve) => {
        dialog.warning({
          title: '导入模板（覆盖模式）',
          content: `即将导入 ${importTemplates.length} 个模板到${typeName}。\n\n⚠️ 警告：此操作将完全覆盖当前的 ${currentTemplateCount} 个${typeName}，无法撤销！\n\n确定要继续吗？`,
          positiveText: '确定覆盖',
          negativeText: '取消',
          onPositiveClick: () => {
            // 🔧 清空当前类型的预览图缓存
            clearPreviewCache()

            // 用户确认，执行覆盖操作
            // 创建ID映射表（旧ID -> 新ID）
            const idMap = new Map()
            const newTemplates = importTemplates.map(template => {
              const newId = generateId()
              idMap.set(template.id, newId)
              return {
              ...template,
                id: newId,
              templateType: activeTemplateType.value,
              timestamp: Date.now()
              }
            })

            // 更新预览图的ID（使用新的ID）
            const newPreviews = importPreviews.map(preview => {
              const newId = idMap.get(preview.id)
              if (newId) {
                return {
                  ...preview,
                  id: newId
                }
              }
              return preview
            }).filter(p => newTemplates.some(t => t.id === p.id)) // 只保留存在的模板的预览图

            // 4、直接覆盖当前模板列表并发起持久化及预览刷新。
            if (isActionTemplate) {
              actionTemplates.value = newTemplates
              ensureTemplateOrder(actionTemplates.value)
            } else {
              expressionTemplates.value = newTemplates
              ensureTemplateOrder(expressionTemplates.value)
            }

            // 保存到存储（包含base64数据，会自动保存到文件系统）
            const allData = {
              templates: newTemplates,
              image_preview: newPreviews,
              version: '5.0.0',
              savedAt: Date.now()
            }
            // 异步发起保存；导入结果在此保存任务完成前即可返回。
            saveAllTemplatesData(allData, activeTemplateType.value).then(() => {
              message.success(`已覆盖导入 ${importTemplates.length} 个${typeName}`)
            })

            console.log(`📦 导入的预览图数据将保存到文件系统`)
            console.log(`✅ 已覆盖导入 ${importTemplates.length} 个${typeName}`)

            // 重新渲染模板预览（如果提供了回调函数）
            if (renderTemplatesPreviews) {
              setTimeout(() => {
                const renderFunc = renderTemplatesPreviews.value || renderTemplatesPreviews
                if (typeof renderFunc === 'function') {
                  renderFunc()
                  console.log('✅ 已触发模板预览重新渲染')
                }
              }, 200)
            }

            // 5、返回已应用到当前列表的导入结果。
            resolve({ success: true, importedCount: importTemplates.length, templateType })
          },
          onNegativeClick: () => {
            // 用户取消
            message.info('已取消导入')
            resolve({ success: false, importedCount: 0, templateType })
          }
        })
      })
    } catch (error) {
      console.error('❌ 导入模板失败:', error)
      message.error('导入模板失败: ' + error.message)
      return { success: false, importedCount: 0, templateType: activeTemplateType.value }
    }
  }

  // ========== 选择和应用 ==========

  // 上次点击的模板ID和时间（用于防抖）
  let lastClickedTemplateId = null
  let lastClickTime = 0
  
  /**
   * 选择模板（仅切换选中状态，不自动应用）
   * 处理流程：
   * 1、过滤短时间内对同一模板的重复点击
   * 2、记录本次点击并切换当前选择
   */
  const selectTemplate = async (templateId) => {
    // 1、按模板编号和点击间隔过滤重复事件。
    const now = Date.now()
    
    // 防抖保护：如果在300ms内点击同一个模板，忽略（防止快速双击导致取消）
    if (lastClickedTemplateId === templateId && (now - lastClickTime) < 300) {
      console.log('⚠️ 防抖：忽略快速重复点击', templateId)
      return
    }
    
    // 2、保存点击记录并切换选中状态。
    lastClickedTemplateId = templateId
    lastClickTime = now
    
    if (selectedTemplateId.value === templateId) {
      // 取消选择
      selectedTemplateId.value = null
      console.log('❌ 取消选中模板')
    } else {
      // 选中新模板（只改变选中状态，不应用配置）
      const previousTemplateId = selectedTemplateId.value
      selectedTemplateId.value = templateId
      console.log('✅ 选中模板:', templateId, previousTemplateId ? `(从 ${previousTemplateId} 切换)` : '')
      
      const template = templates.value.find(t => t.id === templateId)
      if (template) {
        console.log('📋 模板已选中，双击可应用:', template.name)
      }
    }
  }

  /**
   * 应用模板配置（点击模板时触发，不跳转标签页）
   * 处理流程：
   * 1、查找并选中模板
   * 2、调用配置应用回调并保持当前标签页
   * 3、按部件缺失情况提示结果，异常时报告失败
   */
  const applyTemplate = async (templateId) => {
    // 1、确认目标模板存在并更新选择。
    const template = templates.value.find(t => t.id === templateId)
    if (!template) return
    
    // 选中模板
    selectedTemplateId.value = templateId
    
    // 2、使用静默应用函数，避免标签页跳转。
    if (typeof applyTemplateConfig === 'function') {
      try {
        // 传入 noJump = true 和 showMissingAlert = true 参数
        // 避免标签页跳转，同时显示缺失部件警告
        const result = await applyTemplateConfig(template.config, true, true)
        
        // 3、只在没有缺失项时显示成功提示（有缺失项时弹窗已经显示了）。
        if (!result || !result.missingItems || result.missingItems.length === 0) {
          message.success(`已应用模板"${template.name}"`)
          console.log('✅ 应用模板（无跳转）:', template.name)
        } else {
          console.log('⚠️ 应用模板（部分缺失）:', template.name, '缺失项:', result.missingItems.length)
        }
      } catch (error) {
        console.error('❌ 应用模板失败:', error)
        message.error('应用模板失败: ' + error.message)
      }
    }
  }

  /**
   * 取消选中所有模板（备用）
   * 处理流程：
   * 1、清空当前活动类型的模板选择
   */
  const deselectAllTemplates = () => {
    // 1、通过派生引用清理当前类型的选中编号。
    if (selectedTemplateId.value) {
      selectedTemplateId.value = null
      console.log('❌ 取消选中所有模板')
    }
  }

  // ========== 删除和重命名 ==========

  /**
   * 确认删除模板
   * 处理流程：
   * 1、按目标类型查找待删除模板
   * 2、显示删除确认并在确认后调用删除入口
   * @param {String} templateId - 模板ID
   * @param {String} templateType - 可选的模板类型，如果不提供则使用activeTemplateType
   */
  const confirmDeleteTemplate = (templateId, templateType = null) => {
    // 1、确定要操作的模板类型并定位目标。
    const targetType = templateType || activeTemplateType.value
    const isActionTemplate = targetType === 'actionTemplate' || targetType === 'template1'
    const currentTemplates = isActionTemplate ? actionTemplates.value : expressionTemplates.value
    
    const template = currentTemplates.find(t => t.id === templateId)
    if (!template) return
    
    // 2、使用确认对话框启动删除。
    dialog.warning({
      title: '删除模板',
      content: `确定要删除模板"${template.name}"吗？\n删除后将无法恢复。`,
      positiveText: '删除',
      negativeText: '取消',
      onPositiveClick: () => {
        deleteTemplate(templateId, targetType)
      }
    })
  }

  /**
   * 删除模板
   * 处理流程：
   * 1、确定目标类型并移除指定模板
   * 2、清理该模板的预览缓存
   * 3、临时切换到目标类型并保存剩余列表
   * 4、清理已删除模板的选择状态并提示结果
   * @param {String} templateId - 模板ID
   * @param {String} templateType - 可选的模板类型，如果不提供则使用activeTemplateType
   */
  const deleteTemplate = async (templateId, templateType = null) => {
    // 1、确定要操作的模板类型并移除目标模板。
    const targetType = templateType || activeTemplateType.value
    const isActionTemplate = targetType === 'actionTemplate' || targetType === 'template1'
    const currentTemplates = isActionTemplate ? actionTemplates.value : expressionTemplates.value
    const typeName = getTemplateTypeName(targetType)

    const index = currentTemplates.findIndex(t => t.id === templateId)
    if (index >= 0) {
      const template = currentTemplates[index]
      currentTemplates.splice(index, 1)

      // 2、清除该模板的缓存。
      const cacheKey = `${targetType}-${templateId}`
      if (previewCache.has(cacheKey)) {
        previewCache.delete(cacheKey)
        console.log(`🧹 已清除模板预览图缓存: ${templateId}`)
      }

      // 3、保存到对应的模板类型存储。
      const originalType = activeTemplateType.value
      activeTemplateType.value = targetType
      await saveTemplates()
      activeTemplateType.value = originalType

      // 4、如果删除的是当前选中的模板，取消选择并提示结果。
      if (isActionTemplate && selectedActionTemplateId.value === templateId) {
        selectedActionTemplateId.value = null
      } else if (!isActionTemplate && selectedExpressionTemplateId.value === templateId) {
        selectedExpressionTemplateId.value = null
      }

      message.success(`${typeName}"${template.name}"已删除`)
      console.log(`🗑️ 删除${typeName}:`, template.name)
    }
  }

  /**
   * 重命名模板
   * 处理流程：
   * 1、查找模板并拒绝与其他模板重名
   * 2、写入新名称、保存列表并提示成功
   */
  const renameTemplate = async (templateId, newName) => {
    // 1、确认目标存在并检查当前类型内的名称冲突。
    const template = templates.value.find(t => t.id === templateId)
    if (!template) return
    
    // 检查重名
    if (templates.value.some(t => t.id !== templateId && t.name === newName)) {
      message.warning('模板名称已存在')
      return false
    }
    
    // 2、更新名称后持久化当前模板列表。
    template.name = newName
    await saveTemplates()
    message.success('模板已重命名')
    console.log('✏️ 重命名模板:', newName)
    return true
  }

  // 3、提供按需预览缓存及对外模板管理接口。

  // 🔧 预览图缓存（避免重复加载）
  const previewCache = new Map()

  /**
   * 从文件系统加载单张模板预览图
   * 处理流程：
   * 1、优先命中内存预览缓存
   * 2、读取存储配置并按路径加载单张文件预览
   * 3、兼容旧内嵌图片格式并缓存成功结果
   * 4、没有有效预览或读取异常时返回空值
   * @param {String} templateId - 模板ID
   * @param {String} templateType - 模板类型
   * @returns {Promise<String|null>} base64 数据或 null
   */
  const loadSingleTemplatePreview = async (templateId, templateType) => {
    try {
      // 1、先检查缓存。
      const cacheKey = `${templateType}-${templateId}`
      if (previewCache.has(cacheKey)) {
        return previewCache.get(cacheKey)
      }

      // 2、从本地存储读取文件路径配置并按需加载单张图片。
      const storageKey = getStorageKey(templateType)
      const stored = localStorage.getItem(storageKey)
      if (!stored) return null

      const data = JSON.parse(stored)

      // 如果是新版本（5.0.0+），从文件系统加载
      if (data.storage_version === '5.0.0' && data.image_file_paths) {
        // 找到该模板的文件路径
        const filePathData = data.image_file_paths.find(fp => fp.id === templateId)
        if (!filePathData || !filePathData.file_path) {
          return null
        }

        // 只加载这一张图片
        const result = await window.electronAPI.invoke('template-storage-batch-load', {
          filePathsData: [filePathData]
        })

        if (result.success && result.results.length > 0) {
          const base64Data = result.results[0].base64_data
          const sizeInKB = (base64Data.length / 1024).toFixed(2)
          console.log(`✅ 按需加载模板图片: ${filePathData.file_path.split(/[/\\]/).pop()} (${sizeInKB}KB)`)

          // 存入缓存
          previewCache.set(cacheKey, base64Data)
          return base64Data
        }
      }

      // 3、兼容旧格式：读取仍存于本地配置中的内嵌图片。
      if (data.image_preview && data.image_preview.length > 0) {
        const preview = data.image_preview.find(p => p.id === templateId)
        if (preview && preview.base64_data) {
          // 存入缓存
          previewCache.set(cacheKey, preview.base64_data)
          return preview.base64_data
        }
      }

      // 4、没有可用图片时返回空预览。
      return null
    } catch (error) {
      console.error('❌ 加载单张模板预览图失败:', error)
      return null
    }
  }

  /**
   * 清除预览图缓存
   * 处理流程：
   * 1、清空内存图片缓存并记录日志
   */
  const clearPreviewCache = () => {
    // 1、让后续预览重新读取持久化图片。
    previewCache.clear()
    console.log('🧹 已清空预览图缓存')
  }

  /**
   * 获取指定模板的预览图 base64 数据（使用缓存和按需加载）
   * 处理流程：
   * 1、确定模板类型并委托单张预览加载入口
   * @param {String} templateId - 模板ID
   * @param {String} templateType - 模板类型（可选，默认使用当前活动类型）
   * @returns {Promise<String|null>} base64 数据或 null
   */
  const getTemplatePreview = async (templateId, templateType = null) => {
    // 1、复用缓存和按需读取策略获取目标预览。
    const type = templateType || activeTemplateType.value
    // 使用新的按需加载函数
    return await loadSingleTemplatePreview(templateId, type)
  }

  /**
   * 获取所有预览图数据
   * 处理流程：
   * 1、按指定或当前类型完整加载图片并返回预览列表
   * @param {String} templateType - 模板类型（可选，默认使用当前活动类型）
   * @returns {Promise<Array>} 预览图数组 [{ id, base64_data }]
   */
  const getAllTemplatePreviews = async (templateType = null) => {
    // 1、显式启用图片加载以取得全部预览编码数据。
    const type = templateType || activeTemplateType.value
    // 需要加载图片以获取所有预览图
    const data = await getAllTemplatesData(type, true)
    return data.image_preview || []
  }

  return {
    // 双模板系统状态（新版）
    activeTemplateType,
    actionTemplates,
    expressionTemplates,
    selectedActionTemplateId,
    selectedExpressionTemplateId,
    editingActionTemplateId,
    editingExpressionTemplateId,
    
    // 兼容旧版变量名
    templates1,
    templates2,
    selectedTemplate1Id,
    selectedTemplate2Id,
    editingTemplate1Id,
    editingTemplate2Id,
    
    // 计算属性（当前活动模板）
    templates,
    selectedTemplateId,
    editingTemplateId,
    
    // 常量
    ACTION_TEMPLATE_STORAGE_KEY,
    EXPRESSION_TEMPLATE_STORAGE_KEY,
    TEMPLATE1_STORAGE_KEY,
    TEMPLATE2_STORAGE_KEY,
    GLOBAL_TEMPLATES_STORAGE_KEY,
    ACTIVE_TEMPLATE_TYPE_KEY,
    
    // 方法
    getAllTemplatesData,
    saveAllTemplatesData,
    getTemplateTypeName,
    loadTemplates,
    saveTemplates,
    switchTemplateType,
    captureCurrentConfig,
    generateTemplateDescription,
    handleSaveTemplate,
    handleExportTemplate,
    handleImportTemplate,
    selectTemplate,
    applyTemplate,
    deselectAllTemplates,
    confirmDeleteTemplate,
    deleteTemplate,
    renameTemplate,
    
    // 预览图管理
    getTemplatePreview,
    getAllTemplatePreviews,
    clearPreviewCache
  }
}
