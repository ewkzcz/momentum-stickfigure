/** 应用自建目录的路径检查；可信系统根可解析别名，根以下拒绝符号链接。 */
import fs from 'node:fs'
import path from 'node:path'

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
