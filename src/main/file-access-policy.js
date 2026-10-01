/** 应用自建目录的路径检查；可信系统根可解析别名，根以下拒绝符号链接。 */
import fs from 'node:fs'
import path from 'node:path'

const selectedWrites = new WeakMap()
const selectedReads = new WeakMap()
const destroyedReaders = new WeakSet()

function readOwner(owner) {
  if (!owner || destroyedReaders.has(owner) || owner.isDestroyed()) throw new Error('文件读取来源已关闭')
  let grants = selectedReads.get(owner)
  if (!grants) {
    grants = new Map()
    selectedReads.set(owner, grants)
    owner.once('destroyed', () => { destroyedReaders.add(owner); selectedReads.delete(owner) })
  }
  return grants
}

function readPath(filePath) {
  if (typeof filePath !== 'string' || !filePath || filePath.length > 32768 || filePath.includes('\0') || !path.isAbsolute(filePath)) throw new Error('文件路径未授权')
  // 不允许 resolve 在检查前消去链接/.. 分量。
  if (filePath.split(process.platform === 'win32' ? /[\\/]/ : /\//).includes('..')) throw new Error('文件路径未授权')
  return path.resolve(filePath)
}

function readIdentity(filePath) {
  const absolute = readPath(filePath)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) {
      const systemAlias = process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && fs.realpathSync(current) === '/private' + current
      if (!systemAlias) throw new Error('读取路径不允许符号链接')
    }
  }
  const stat = fs.lstatSync(absolute)
  if (!stat.isFile() || stat.nlink !== 1) throw new Error('读取对象必须是单链接普通文件')
  return { canonical: fs.realpathSync(absolute), identity: readStatIdentity(stat) }
}

function readStatIdentity(stat) {
  return `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
}

/** 仅原生文件选择或成功保存拖入文件调用；全批检查后登记，失败不改变旧能力。 */
export function grantSelectedReads(owner, files, { skipMissing = false } = {}) {
  const grants = readOwner(owner)
  if (!Array.isArray(files)) throw new Error('文件列表未授权')
  const records = new Map()
  for (const file of files) {
    const absolute = readPath(file)
    try { records.set(absolute, readIdentity(absolute)) } catch (error) {
      // PSD批量选择后的缺失项不授能力；保留路径给上传流程统计失败，其他安全错误仍拒绝整批。
      if (!skipMissing || error.code !== 'ENOENT') throw error
    }
  }
  // 先核验整批，随后再次复核；登记不会因后续文件失败而留下部分能力。
  for (const [file, record] of records) {
    let current
    try { current = readIdentity(file) } catch (error) {
      if (!skipMissing || error.code !== 'ENOENT') throw error
      records.delete(file)
      continue
    }
    if (current.canonical !== record.canonical || current.identity !== record.identity) throw new Error('选择期间文件发生变化')
  }
  readOwner(owner)
  const changes = []
  for (const [key, record] of records) {
    changes.push({ key, record, previous: grants.get(key) })
    grants.set(key, record)
  }
  let rolledBack = false
  return () => {
    if (rolledBack) return
    rolledBack = true
    for (const { key, record, previous } of changes) if (grants.get(key) === record) {
      if (previous) grants.set(key, previous)
      else grants.delete(key)
    }
  }
}

function selectedRead(owner, filePath) {
  const absolute = readPath(filePath)
  const grants = readOwner(owner)
  const record = grants.get(absolute)
  // 未授路径在任何文件系统查询之前拒绝，不泄漏存在性。
  if (!record) throw new Error('文件未授权，请通过原生文件选择重新确认')
  const current = readIdentity(absolute)
  if (current.canonical !== record.canonical || current.identity !== record.identity) throw new Error('文件读取授权已失效，请重新选择')
  return { absolute, grants, record }
}

export function checkSelectedRead(owner, filePath) {
  selectedRead(owner, filePath)
  return true
}

/** 绑定已核验文件描述符读取；读取后再次核验身份，拒绝链接替换和读取期间变化。 */
export function readSelectedFile(owner, filePath) {
  const { absolute, grants, record } = selectedRead(owner, filePath)
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK)
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.nlink !== 1 || readStatIdentity(before) !== record.identity) throw new Error('读取文件身份已变化')
    const bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    if (after.nlink !== 1 || readStatIdentity(after) !== record.identity || bytes.length !== after.size) throw new Error('文件在读取期间发生变化')
    selectedRead(owner, absolute)
    if (grants.get(absolute) !== record) throw new Error('文件读取授权已变化')
    return bytes
  } finally { fs.closeSync(fd) }
}

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
