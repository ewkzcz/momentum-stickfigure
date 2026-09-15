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

export function assertHotkeys(value) {
  assertRecord(value, '快捷键')
  for (const key of Object.keys(value)) {
    assertEnum(key, ['toggleMainWindow', 'togglePreviewWindow'], '快捷键字段')
    // 系统加速键表达式远小于256字符，空字符串保留禁用快捷键契约。
    assertText(value[key], 256, '快捷键')
  }
}
