/**
 * 提示词模板管理器
 * 负责加载/保存提示词模板并在多实例间保持同步
 */

const STORAGE_KEY_PREFIX = 'prompt-templates'

/**
 * 获取跨窗口共享存储接口。
 * 处理流程：
 * 1、检查桌面桥接对象，缺失时返回 null 供后续降级。
 */
const getSharedStorage = () => {
  // 1、允许在未注入桌面接口的环境中加载管理器。
  if (typeof window !== 'undefined' && window.storage) {
    return window.storage
  }
  return null
}

/**
 * 获取浏览器本地存储接口。
 * 处理流程：
 * 1、确认窗口和存储对象存在，否则返回 null。
 */
const getBrowserStorage = () => {
  // 1、本地存储作为共享服务不可用时的备用来源。
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage
  }
  return null
}

/**
 * 获取专用提示词模板服务。
 * 处理流程：
 * 1、返回预加载暴露的模板接口，缺失时返回 null。
 */
const getPromptTemplateAPI = () => {
  // 1、专用服务优先于通用键值存储。
  if (typeof window !== 'undefined' && window.promptTemplates) {
    return window.promptTemplates
  }
  return null
}

/**
 * 规范模板数组的字段。
 * 处理流程：
 * 1、非数组输入转换为空列表。
 * 2、为每条记录补齐标识、内容、收藏状态、时间、顺序和类型。
 */
const normalizeTemplates = (templates, type) => {
  // 1、只接受数组作为模板集合。
  if (!Array.isArray(templates)) {
    return []
  }
  // 2、返回新的普通对象，仅保留管理器支持的字段。
  return templates.map((template, index) => ({
    id: template.id || `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    content: template.content ?? '',
    isFavorite: Boolean(template.isFavorite),
    createdAt: template.createdAt || Date.now(),
    order: typeof template.order === 'number' ? template.order : index,
    type: template.type || type || 'image'
  }))
}

/** 提示词模板管理器：按类型隔离模板，协调持久化、排序和跨窗口变更。 */
export class PromptTemplateManager {
  /**
   * 初始化指定类型的模板管理器。
   * 处理流程：
   * 1、确定存储键并收集可用的持久化接口。
   * 2、启动异步加载，订阅共享存储和模板服务变化。
   */
  constructor(type = 'image') {
    // 1、每种类型使用独立存储键和内存列表。
    this.type = type
    this.storageKey = `${STORAGE_KEY_PREFIX}-${type}`
    this.templates = []
    this.sharedStorage = getSharedStorage()
    this.browserStorage = getBrowserStorage()
    this.nativeAPI = getPromptTemplateAPI()
    this.initialized = false
    this.loadingPromise = null
    this.unsubscribeStorage = null
    this.unsubscribeNative = null

    // 2、构造函数发起加载，实际读取方法会等待同一初始化任务。
    this.ensureInitialized()
    this.setupStorageListener()
    this.setupNativeListener()
  }

  /**
   * 订阅通用共享存储的模板变化。
   * 处理流程：
   * 1、接口存在时订阅，仅应用当前类型存储键的变更。
   */
  setupStorageListener() {
    // 1、忽略其他配置键的广播。
    if (this.sharedStorage?.onStorageChanged) {
      this.unsubscribeStorage = this.sharedStorage.onStorageChanged((change) => {
        if (change?.key === this.storageKey) {
          const serialized = typeof change.value === 'string' ? change.value : null
          this.applySerializedString(serialized)
        }
      })
    }
  }

  /**
   * 订阅专用模板服务的变化。
   * 处理流程：
   * 1、筛选类型匹配且内容为数组的广播并更新内存。
   */
  setupNativeListener() {
    // 1、专用服务直接广播模板数组，无需反序列化。
    if (this.nativeAPI?.onTemplatesChanged) {
      this.unsubscribeNative = this.nativeAPI.onTemplatesChanged((payload) => {
        if (payload?.type === this.type && Array.isArray(payload?.templates)) {
          this.applyTemplatesArray(payload.templates)
        }
      })
    }
  }

  /**
   * 等待模板初次加载。
   * 处理流程：
   * 1、已初始化时直接返回。
   * 2、复用正在执行的加载任务，避免并发读取重复发起请求。
   */
  async ensureInitialized() {
    // 1、完成初始化的实例直接使用内存数据。
    if (this.initialized) {
      return
    }
    // 2、并发调用共享同一个加载 Promise。
    if (!this.loadingPromise) {
      this.loadingPromise = this.reloadFromStorage()
    }
    await this.loadingPromise
  }

  /**
   * 按优先级重新读取模板。
   * 处理流程：
   * 1、优先使用专用模板服务，空数组也是有效结果。
   * 2、服务无结果时读取通用存储并应用序列化内容。
   */
  async reloadFromStorage() {
    // 1、专用服务的有效结果覆盖本地备份。
    const nativeTemplates = await this.readFromNative()
    if (nativeTemplates) {
      this.applyTemplatesArray(nativeTemplates)
      this.loadingPromise = null
      return
    }
    // 2、缺少专用服务结果时使用旧存储渠道。
    const serialized = await this.readFromStorage()
    await this.applySerializedString(serialized)
  }

  /**
   * 读取专用模板服务。
   * 处理流程：
   * 1、确认接口存在并请求当前类型的模板。
   * 2、只接受成功响应中的数组，其他结果返回 null 触发降级。
   */
  async readFromNative() {
    // 1、缺失接口与请求失败都交给上层选择备用存储。
    if (!this.nativeAPI?.getTemplates) {
      return null
    }
    try {
      // 2、验证响应结构，避免错误内容覆盖模板列表。
      const result = await this.nativeAPI.getTemplates(this.type)
      if (result?.success && Array.isArray(result.templates)) {
        return result.templates
      }
    } catch (error) {
      console.warn('[PromptTemplateManager] 读取共享模板失败:', error)
    }
    return null
  }

  /**
   * 读取通用存储中的序列化模板。
   * 处理流程：
   * 1、尝试共享存储中的当前类型键。
   * 2、没有有效文本时尝试浏览器本地存储。
   */
  async readFromStorage() {
    // 1、优先读取主进程提供的共享配置。
    let serialized = null
    if (this.sharedStorage) {
      try {
        const result = await this.sharedStorage.getItem(this.storageKey)
        if (result?.success && typeof result.value === 'string') {
          serialized = result.value
        }
      } catch (error) {
        console.warn('[PromptTemplateManager] 读取共享存储失败:', error)
      }
    }

    // 2、共享配置缺失或读取失败时回退到窗口本地存储。
    if (!serialized && this.browserStorage) {
      try {
        serialized = this.browserStorage.getItem(this.storageKey)
      } catch (error) {
        console.warn('[PromptTemplateManager] 读取localStorage失败:', error)
      }
    }

    return serialized
  }

  /**
   * 应用已解析的模板数组。
   * 处理流程：
   * 1、规范字段并按顺序排序，然后标记初始化完成。
   */
  applyTemplatesArray(templates) {
    // 1、读取和广播都经过相同的字段规范化入口。
    this.templates = normalizeTemplates(templates, this.type)
    this.templates.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    this.initialized = true
  }

  /**
   * 应用序列化模板快照。
   * 处理流程：
   * 1、空内容清空列表并完成初始化。
   * 2、解析数组并应用；无效内容清空列表，最后释放加载句柄。
   */
  async applySerializedString(serialized) {
    // 1、存储中无数据时以空列表结束初始化。
    if (!serialized) {
      // 无数据时直接清空
      this.templates = []
      this.initialized = true
      this.loadingPromise = null
      return
    }

    try {
      // 2、只有数组能成为模板列表，解析异常保留错误日志。
      const parsed = JSON.parse(serialized)
      if (Array.isArray(parsed)) {
        this.applyTemplatesArray(parsed)
      } else {
        this.templates = []
      }
      this.initialized = true
    } catch (error) {
      console.error('[PromptTemplateManager] 解析模板失败:', error)
      this.templates = []
    } finally {
      this.loadingPromise = null
    }
  }

  /**
   * 保存当前模板列表。
   * 处理流程：
   * 1、规范字段并优先写入专用模板服务。
   * 2、专用服务未成功时分别尝试共享存储和浏览器存储。
   */
  async saveTemplates() {
    // 1、保存前统一字段结构，专用服务成功后直接结束。
    const normalized = normalizeTemplates(this.templates, this.type)
    this.templates = normalized

    if (this.nativeAPI?.saveTemplates) {
      try {
        const result = await this.nativeAPI.saveTemplates(this.type, normalized)
        if (result?.success) {
          return
        }
      } catch (error) {
        console.warn('[PromptTemplateManager] 保存到提示词服务失败:', error)
      }
    }

    // 2、备用渠道各自处理失败，单个渠道异常不阻断另一渠道。
    const serialized = JSON.stringify(normalized, null, 2)

    if (this.sharedStorage) {
      try {
        const result = await this.sharedStorage.setItem(this.storageKey, serialized)
        if (!result?.success) {
          console.warn('[PromptTemplateManager] 共享存储保存失败')
        }
      } catch (error) {
        console.error('[PromptTemplateManager] 保存到共享存储失败:', error)
      }
    }

    if (this.browserStorage) {
      try {
        this.browserStorage.setItem(this.storageKey, serialized)
      } catch (error) {
        console.warn('[PromptTemplateManager] 保存到localStorage失败:', error)
      }
    }
  }

  /**
   * 获取全部模板。
   * 处理流程：
   * 1、等待初始化后返回数组浅拷贝，避免调用方直接改动列表顺序。
   */
  async getAllTemplates() {
    // 1、复制数组容器，模板对象仍与管理器共享。
    await this.ensureInitialized()
    return [...this.templates]
  }

  /**
   * 添加提示词模板。
   * 处理流程：
   * 1、等待加载并拒绝空白内容。
   * 2、创建带顺序的模板，追加并保存后返回记录。
   */
  async addTemplate(content, isFavorite = false) {
    // 1、已有模板加载完成后才能确定新记录的顺序。
    await this.ensureInitialized()
    if (!content || !content.trim()) {
      throw new Error('提示词内容不能为空')
    }

    // 2、去除内容首尾空白，生成本地标识和创建时间。
    const template = {
      id: `template-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      content: content.trim(),
      isFavorite,
      createdAt: Date.now(),
      order: this.templates.length,
      type: this.type
    }

    this.templates.push(template)
    await this.saveTemplates()
    return template
  }

  /**
   * 删除指定模板。
   * 处理流程：
   * 1、等待加载并定位标识，不存在时返回 false。
   * 2、删除记录、重排顺序并保存。
   */
  async deleteTemplate(id) {
    // 1、先按稳定标识定位，避免列表排序影响删除目标。
    await this.ensureInitialized()
    const index = this.templates.findIndex((t) => t.id === id)
    if (index === -1) {
      return false
    }

    // 2、删除后补齐连续顺序。
    this.templates.splice(index, 1)
    this.reorderTemplates()
    await this.saveTemplates()
    return true
  }

  /**
   * 清除未收藏模板。
   * 处理流程：
   * 1、保留收藏项并重排顺序。
   * 2、保存结果并返回删除数量。
   */
  async clearNonFavorites() {
    // 1、记录清理前数量，用于返回实际删除条数。
    await this.ensureInitialized()
    const before = this.templates.length
    this.templates = this.templates.filter((t) => t.isFavorite)
    this.reorderTemplates()
    // 2、保存筛选后的列表，再报告数量变化。
    await this.saveTemplates()
    return before - this.templates.length
  }

  /**
   * 切换模板收藏状态。
   * 处理流程：
   * 1、找到记录后反转收藏标志并保存，缺失时返回 null。
   */
  async toggleFavorite(id) {
    // 1、收藏修改基于已加载的记录。
    await this.ensureInitialized()
    const template = this.templates.find((t) => t.id === id)
    if (!template) {
      return null
    }

    template.isFavorite = !template.isFavorite
    await this.saveTemplates()
    return template.isFavorite
  }

  /**
   * 移动模板的列表位置。
   * 处理流程：
   * 1、校验源位置和目标位置均在当前列表范围内。
   * 2、移除后插入目标位置，重排并保存。
   */
  async moveTemplate(fromIndex, toIndex) {
    // 1、越界移动直接返回，不改变列表。
    await this.ensureInitialized()
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= this.templates.length ||
      toIndex >= this.templates.length
    ) {
      return false
    }

    // 2、使用移除后的数组执行插入，再统一更新顺序字段。
    const [moved] = this.templates.splice(fromIndex, 1)
    this.templates.splice(toIndex, 0, moved)
    this.reorderTemplates()
    await this.saveTemplates()
    return true
  }

  /**
   * 按内存顺序更新模板序号。
   * 处理流程：
   * 1、遍历列表，将当前下标写入各记录的 order 字段。
   */
  reorderTemplates() {
    // 1、序号连续化，不额外改变数组顺序。
    this.templates.forEach((template, index) => {
      template.order = index
    })
  }

  /**
   * 使用外部列表替换当前模板。
   * 处理流程：
   * 1、等待初始化并复制传入记录，按新顺序设置序号。
   * 2、保存替换结果并返回当前列表。
   */
  async syncTemplates(newTemplates = []) {
    // 1、复制各条记录，避免在重排时直接修改调用方对象。
    await this.ensureInitialized()
    this.templates = (newTemplates || []).map((template, index) => ({
      ...template,
      order: index
    }))
    // 2、保存时还会执行统一字段规范化。
    await this.saveTemplates()
    return this.templates
  }

  /**
   * 清空全部模板。
   * 处理流程：
   * 1、等待初始化，将列表置空并保存。
   */
  async clearAllTemplates() {
    // 1、等待旧数据读入后再清空，防止加载结果覆盖清空操作。
    await this.ensureInitialized()
    this.templates = []
    await this.saveTemplates()
    return true
  }

  /**
   * 获取已收藏模板。
   * 处理流程：
   * 1、等待初始化后按收藏标志筛选。
   */
  async getFavoriteTemplates() {
    // 1、保持当前模板顺序。
    await this.ensureInitialized()
    return this.templates.filter((t) => t.isFavorite)
  }

  /**
   * 获取未收藏模板。
   * 处理流程：
   * 1、等待初始化后筛选未收藏项。
   */
  async getNonFavoriteTemplates() {
    // 1、返回筛选数组，不改动原列表。
    await this.ensureInitialized()
    return this.templates.filter((t) => !t.isFavorite)
  }

  /**
   * 按提示词内容搜索模板。
   * 处理流程：
   * 1、空白关键词返回全部模板。
   * 2、对内容进行不区分大小写的包含匹配。
   */
  async searchTemplates(keyword) {
    // 1、先等待加载，空搜索与全部查询保持一致。
    await this.ensureInitialized()
    if (!keyword || !keyword.trim()) {
      return this.getAllTemplates()
    }
    // 2、只规范比较文本，保留模板原始内容。
    const lower = keyword.toLowerCase().trim()
    return this.templates.filter((t) => t.content.toLowerCase().includes(lower))
  }

  /**
   * 导出模板 JSON 文本。
   * 处理流程：
   * 1、等待初始化后将当前列表序列化为便于阅读的 JSON。
   */
  async exportTemplates() {
    // 1、导出的是完整列表及各记录属性。
    await this.ensureInitialized()
    return JSON.stringify(this.templates, null, 2)
  }

  /**
   * 从 JSON 文本导入模板。
   * 处理流程：
   * 1、解析并验证数组格式，然后等待现有列表加载。
   * 2、按模式替换列表或追加未与现有标识重复的记录。
   * 3、重排并保存，格式或操作异常时返回 false。
   */
  async importTemplates(jsonString, merge = false) {
    // 1、输入格式合法后才进入合并或替换流程。
    try {
      const imported = JSON.parse(jsonString)
      if (!Array.isArray(imported)) {
        throw new Error('导入数据格式不正确')
      }

      await this.ensureInitialized()

      // 2、合并模式仅按现有列表标识排重，不比较内容。
      if (merge) {
        const existingIds = new Set(this.templates.map((t) => t.id))
        const newItems = imported.filter((t) => !existingIds.has(t.id))
        this.templates.push(...newItems)
      } else {
        this.templates = imported
      }

      // 3、无论导入模式如何，都按当前列表重建顺序并保存。
      this.reorderTemplates()
      await this.saveTemplates()
      return true
    } catch (error) {
      console.error('[PromptTemplateManager] 导入模板失败:', error)
      return false
    }
  }

  /**
   * 获取模板总数。
   * 处理流程：
   * 1、等待初始化后返回列表长度。
   */
  async getCount() {
    // 1、统计持久化数据恢复后的列表。
    await this.ensureInitialized()
    return this.templates.length
  }

  /**
   * 获取收藏模板数量。
   * 处理流程：
   * 1、等待初始化后筛选收藏项并计数。
   */
  async getFavoriteCount() {
    // 1、按当前内存中的收藏标志统计。
    await this.ensureInitialized()
    return this.templates.filter((t) => t.isFavorite).length
  }
}

const imageTemplateManager = new PromptTemplateManager('image')
const videoTemplateManager = new PromptTemplateManager('video')

export default imageTemplateManager
export { videoTemplateManager }
