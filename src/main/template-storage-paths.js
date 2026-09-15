/** 模板专属目录的路径边界；拒绝路径段跳转及已存在的符号链接。 */
import fs from 'node:fs'
import path from 'node:path'

export function assertTemplateSegment(value) {
  if (typeof value !== 'string' || !value || value === '.' || value === '..' || /[\\/\0:]/.test(value)) throw new Error('无效的模板路径标识')
}

export function assertTemplateType(value) {
  if (!['actionTemplate', 'expressionTemplate', 'presetPreviews'].includes(value)) throw new Error('无效的模板类型')
}

export function checkedTemplatePath(userData, segments) {
  let current = userData
  for (const segment of segments) {
    assertTemplateSegment(segment)
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('模板路径不允许符号链接')
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return current
}

export function resolveTemplateImagePath(userData, relativePath) {
  if (typeof relativePath !== 'string' || path.isAbsolute(relativePath)) throw new Error('无效的模板相对路径')
  const segments = relativePath.split(/[\\/]/)
  if (segments.length !== 3 || segments[0] !== 'templates') throw new Error('路径不属于模板存储目录')
  assertTemplateType(segments[1])
  if (!segments[2].endsWith('.png')) throw new Error('模板图片必须为PNG文件')
  return checkedTemplatePath(userData, segments)
}
