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

export function assertHotkeys(value) {
  assertRecord(value, '快捷键')
  for (const key of Object.keys(value)) {
    assertEnum(key, ['toggleMainWindow', 'togglePreviewWindow'], '快捷键字段')
    // 系统加速键表达式远小于256字符，空字符串保留禁用快捷键契约。
    assertText(value[key], 256, '快捷键')
  }
}
