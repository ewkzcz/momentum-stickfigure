/** 应用自建目录的路径检查；可信系统根可解析别名，根以下拒绝符号链接。 */
import fs from 'node:fs'
import path from 'node:path'

const selectedWrites = new WeakMap()

function canonicalDestination(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 32768 || filePath.includes('\0') || !path.isAbsolute(filePath)) throw new Error('文件路径未授权')
  const absolute = path.resolve(filePath)
  let ancestor = absolute
  const suffix = []
  while (true) {
    try {
      const stat = fs.lstatSync(ancestor)
      if (stat.isSymbolicLink()) throw new Error('文件路径不允许符号链接')
      const real = fs.realpathSync(ancestor)
      return path.join(real, ...suffix)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      const parent = path.dirname(ancestor)
      if (parent === ancestor) throw new Error('文件路径未授权')
      suffix.unshift(path.basename(ancestor))
      ancestor = parent
    }
  }
}

/** 仅原生保存选择完成后授予单文件写入，按调用窗口隔离。 */
export function grantSelectedWrite(owner, filePath) {
  const canonical = canonicalDestination(filePath)
  let grants = selectedWrites.get(owner)
  if (!grants) { grants = new Map(); selectedWrites.set(owner, grants) }
  grants.set(path.resolve(filePath), canonical)
}

export function assertSelectedWrite(owner, filePath) {
  const canonical = canonicalDestination(filePath)
  if (selectedWrites.get(owner)?.get(path.resolve(filePath)) !== canonical) throw new Error('文件路径未授权，请先选择导出位置')
  return path.resolve(filePath)
}

export function assertOwnedFilePath(trustedRoot, segments) {
  const root = path.resolve(trustedRoot)
  let current = root
  for (const segment of segments) {
    if (typeof segment !== 'string' || !segment || segment === '.' || segment === '..' || /[\\/\0]/.test(segment)) throw new Error('文件路径未授权')
    current = path.join(current, segment)
    try {
      if (fs.lstatSync(current).isSymbolicLink()) throw new Error('应用文件路径不允许符号链接')
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return current
}

/** 最终文件打开时禁止跟随符号链接；允许原临时文件覆盖语义。 */
export function writeOwnedFile(filePath, bytes) {
  const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW, 0o600)
  try { fs.writeFileSync(descriptor, bytes) } finally { fs.closeSync(descriptor) }
}
