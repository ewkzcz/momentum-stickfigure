/** 通用导出仅接受原生保存位置或明确选择的输出目录；不从配置文本恢复权限。 */
import fs from 'node:fs'
import path from 'node:path'

const owners = new WeakMap()
const destroyed = new WeakSet()
function state(owner) {
  if (!owner || destroyed.has(owner) || owner.isDestroyed()) throw new Error('导出窗口已关闭')
  let value = owners.get(owner)
  if (!value) {
    value = { files: new Map(), directories: new Map() }
    owners.set(owner, value)
    owner.once('destroyed', () => { destroyed.add(owner); owners.delete(owner) })
  }
  return value
}
function absolutePath(value) {
  if (typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0') || !path.isAbsolute(value)) throw new Error('导出路径无效')
  if (value.split(process.platform === 'win32' ? /[\\/]/ : /\//).includes('..')) throw new Error('导出路径不允许父级回退')
  return path.resolve(value)
}
function inspectDirectory(value) {
  const absolute = absolutePath(value)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) {
      if (!(process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && fs.realpathSync(current) === '/private' + current)) throw new Error('导出目录不允许符号链接')
    } else if (!stat.isDirectory()) throw Object.assign(new Error('ENOTDIR: 导出父路径不是目录'), { code: 'ENOTDIR' })
  }
  const stat = fs.statSync(absolute)
  return { path: absolute, canonical: fs.realpathSync(absolute), identity: `${stat.dev}:${stat.ino}` }
}
function verifyDirectory(record) {
  const current = inspectDirectory(record.path)
  if (current.canonical !== record.canonical || current.identity !== record.identity) throw new Error('导出目录已变化，请重新选择')
}
export function grantExportFile(owner, file) {
  const target = absolutePath(file)
  const parent = inspectDirectory(path.dirname(target))
  state(owner).files.set(target, parent)
}
export function grantExportDirectory(owner, directory) {
  const record = inspectDirectory(directory)
  state(owner).directories.set(record.path, record)
}
function permission(owner, file) {
  const target = absolutePath(file)
  const grants = state(owner)
  const selected = grants.files.get(target)
  if (selected) { verifyDirectory(selected); return { target, root: selected } }
  for (const record of grants.directories.values()) {
    const relative = path.relative(record.path, target)
    if (relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)) {
      verifyDirectory(record)
      return { target, root: record }
    }
  }
  throw new Error('导出位置未授权，请重新选择保存位置或输出文件夹')
}
function prepareParent(root, target) {
  verifyDirectory(root)
  const relative = path.relative(root.path, path.dirname(target))
  let current = root.path
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    try { fs.mkdirSync(current) } catch (error) { if (error.code !== 'EEXIST') throw error }
    inspectDirectory(current)
  }
  inspectDirectory(path.dirname(target))
  verifyDirectory(root)
}
/** 保留重名编号，使用独占打开，禁止覆盖/跟随链接；写入权限不转换为读取权限。 */
export function writeExportFile(owner, file, bytes) {
  const { target, root } = permission(owner, file)
  prepareParent(root, target)
  const extension = path.extname(target)
  const stem = path.basename(target, extension)
  for (let counter = 0; counter < 10000; counter++) {
    permission(owner, target)
    const candidate = counter ? path.join(path.dirname(target), `${stem}_${counter}${extension}`) : target
    inspectDirectory(path.dirname(candidate))
    try {
      const existing = fs.lstatSync(candidate)
      if (!existing.isFile() || existing.nlink !== 1) throw new Error('导出目标不是普通单链接文件')
      continue
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    let fd
    try {
      fd = fs.openSync(candidate, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600)
    } catch (error) { if (error.code === 'EEXIST') continue; throw error }
    try { fs.writeFileSync(fd, bytes) } finally { fs.closeSync(fd) }
    return candidate
  }
  throw new Error('导出重名文件过多，请选择其他名称')
}
