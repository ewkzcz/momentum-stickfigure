/** 主进程IPC参数基础校验；在解构、转换和副作用之前调用。 */
export function assertRecord(value, label = '对象') {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    throw new TypeError(`${label}参数必须是普通对象`)
  }
}

export function assertText(value, maxLength, label = '文本') {
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0')) throw new TypeError(`${label}参数无效`)
}

export function assertEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label}参数无效`)
}

export function assertFileName(value) {
  assertText(value, 255, '文件名')
  if (!value || value === '.' || value === '..' || /[<>:"/\\|?*]/.test(value)) throw new TypeError('文件名参数必须是单段名称')
}

export function assertDialogOptions(value) {
  assertRecord(value, '对话框')
  for (const key of ['title', 'message', 'defaultPath']) {
    if (value[key] !== undefined) assertText(value[key], 32768, key)
  }
  if (value.multiple !== undefined && typeof value.multiple !== 'boolean') throw new TypeError('multiple参数必须是布尔值')
  if (value.filters !== undefined) {
    if (!Array.isArray(value.filters) || value.filters.length > 64) throw new TypeError('filters参数无效')
    for (const filter of value.filters) {
      assertRecord(filter, '文件筛选')
      assertText(filter.name, 256, '筛选名称')
      if (!Array.isArray(filter.extensions) || !filter.extensions.length || filter.extensions.length > 64) throw new TypeError('扩展名参数无效')
      for (const extension of filter.extensions) {
        assertText(extension, 64, '扩展名')
        if (!/^(?:\*|[a-zA-Z0-9][a-zA-Z0-9_-]*)$/.test(extension)) throw new TypeError('扩展名参数无效')
      }
    }
  }
}

export function assertPsdTaskOptions(value) {
  assertRecord(value, 'PSD解析')
  if (value.taskId !== undefined) {
    assertText(value.taskId, 128, 'PSD任务ID')
    if (!value.taskId) throw new TypeError('PSD任务ID参数不能为空')
  }
  if (value.parseOptions !== undefined) {
    assertRecord(value.parseOptions, 'PSD解析选项')
    for (const key of ['validateFile', 'parseImages', 'parseChannelData', 'extractThumbnails', 'processLayers', 'autoDetectComponents']) {
      if (value.parseOptions[key] !== undefined && typeof value.parseOptions[key] !== 'boolean') throw new TypeError(`PSD ${key}参数必须是布尔值`)
    }
  }
}

export function assertPromptTemplates(payload) {
  assertRecord(payload, '提示词模板')
  assertEnum(payload.type === undefined ? 'image' : payload.type, ['image', 'video'], '模板类型')
  const templates = payload.templates === undefined ? [] : payload.templates
  if (!Array.isArray(templates) || templates.length > 10000) throw new TypeError('模板列表参数无效')
  let characters = 0
  for (const item of templates) {
    assertRecord(item, '模板项')
    if (item.id !== undefined) assertText(item.id, 256, '模板ID')
    if (item.content !== undefined) {
      assertText(item.content, 1024 * 1024, '模板内容')
      characters += item.content.length
    }
    if (characters > 16 * 1024 * 1024) throw new TypeError('模板内容总量参数超过限制')
    if (item.type !== undefined) assertEnum(item.type, ['image', 'video'], '模板项类型')
    if (item.isFavorite !== undefined && typeof item.isFavorite !== 'boolean') throw new TypeError('收藏参数必须是布尔值')
    for (const key of ['createdAt', 'order']) {
      if (item[key] !== undefined && (typeof item[key] !== 'number' || !Number.isFinite(item[key]))) throw new TypeError(`模板${key}参数无效`)
    }
  }
}

export function assertStorageValue(value) {
  if (value !== null && !['string', 'number', 'boolean', 'undefined'].includes(typeof value)) throw new TypeError('存储值参数必须是字符串或标量')
  // 保留历史标量String转换；64Mi字符为单项接口预算，不改变旧文件加载。
  if (typeof value === 'string' && value.length > 64 * 1024 * 1024) throw new TypeError('存储值参数超过容量限制')
}

export function assertSettingsArchive(value) {
  assertRecord(value, '设置归档')
  const ancestors = new Set()
  let nodes = 0, characters = 0
  const visit = (item, depth) => {
    if (++nodes > 1000000 || depth > 64) throw new TypeError('设置归档参数结构超过限制')
    if (typeof item === 'string') characters += item.length
    else if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new TypeError('设置归档数字参数无效')
    } else if (item && typeof item === 'object') {
      if (!Array.isArray(item)) assertRecord(item, '设置归档项')
      if (ancestors.has(item)) throw new TypeError('设置归档参数不允许循环引用')
      ancestors.add(item)
      for (const [key, child] of Object.entries(item)) { characters += key.length; visit(child, depth + 1) }
      ancestors.delete(item)
    } else if (item !== null && item !== undefined && typeof item !== 'boolean') throw new TypeError('设置归档参数类型无效')
    if (characters > 64 * 1024 * 1024) throw new TypeError('设置归档参数超过容量限制')
  }
  visit(value, 0)
}

export function assertPathList(value, maximum = 1024) {
  if (!Array.isArray(value) || value.length > maximum) throw new TypeError('文件列表参数无效')
  for (const file of value) assertText(file, 32768, '文件路径')
}

export function assertGeminiOptions(value) {
  assertRecord(value, '图像配置')
  for (const key of ['apiKey', 'baseUrl', 'model', 'projectRoot', 'outputDir', 'editOutputDir', 'logDir', 'logFile', 'aspectRatio']) {
    if (value[key] !== undefined) assertText(value[key], 32768, key)
  }
  if (value.prompt !== undefined) assertText(value.prompt, 1024 * 1024, '提示词')
  if (value.timeoutMinutes !== undefined && (typeof value.timeoutMinutes !== 'number' || !Number.isFinite(value.timeoutMinutes) || value.timeoutMinutes <= 0)) throw new TypeError('超时参数无效')
  if (value.inputImages !== undefined) assertPathList(value.inputImages)
}

export function assertLocalProcessOptions(value, nested = false) {
  assertRecord(value, '本地处理')
  for (const key of ['pythonHome', 'pythonPath', 'removebgWeightsDir', 'removebgWeightsPath', 'highresWeightsDir', 'highresWeightsPath', 'outputDir', 'outputPath', 'weightsDir', 'modelId', 'videoPath', 'apiKey', 'apiBaseUrl', 'aiModel']) {
    if (value[key] !== undefined) assertText(value[key], 32768, key)
  }
  if (value.inputPaths !== undefined) assertPathList(value.inputPaths)
  for (const key of ['outscale', 'tile', 'tilePad', 'prePad', 'intervalSeconds']) {
    const item = value[key]
    if (item !== undefined && ((typeof item !== 'number' && typeof item !== 'string') || item === '' || !Number.isFinite(Number(item)) || Number(item) < 0)) throw new TypeError(`${key}参数无效`)
  }
  for (const key of ['half', 'useAI']) {
    if (value[key] !== undefined && typeof value[key] !== 'boolean') throw new TypeError(`${key}参数必须是布尔值`)
  }
  if (value.alphaMatting !== undefined) assertEnum(value.alphaMatting, [true, false, '1', '0'], 'alphaMatting')
  if (value.mode !== undefined) assertEnum(value.mode, ['auto', 'cpu', 'gpu', 'custom'], '性能模式')
  if (!nested) for (const key of ['removebg', 'highres']) {
    if (value[key] !== undefined) assertLocalProcessOptions(value[key], true)
  }
}

export function assertHotkeys(value) {
  assertRecord(value, '快捷键')
  for (const key of Object.keys(value)) {
    assertEnum(key, ['toggleMainWindow', 'togglePreviewWindow', 'openSearch', 'toggleCanvasHover', 'togglePartHover'], '快捷键字段')
    // 系统加速键表达式远小于256字符，空字符串保留禁用快捷键契约。
    assertText(value[key], 256, '快捷键')
  }
}
