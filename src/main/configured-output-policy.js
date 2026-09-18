/** 配置中的路径只是偏好；按用途确认输出根，不授予通用文件读写能力。 */
import { BrowserWindow, dialog } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { isTrustedIpcSender } from './ipc-sender-policy.js'

const owners = new WeakMap()
const closed = new WeakSet()
const purposes = new Set(['canvas-output', 'gemini-output', 'ocr-output'])
const defaults = {
  'canvas-output': [path.join(os.homedir(), 'Pictures', 'MomentumStickFigure'), path.join(os.homedir(), 'Pictures', '简笔画导出')],
  'gemini-output': [path.join(os.homedir(), 'Pictures', 'GeminiImage')],
  'ocr-output': [path.join(os.homedir(), 'Documents', 'VideoSubtitles')]
}
export function configuredOutputPurpose(purpose) { return purposes.has(purpose) }
function absolute(value) {
  if (typeof value !== 'string' || !value || value.length > 32768 || value.includes('\0') || !path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) throw new Error('输出目录路径无效')
  return path.resolve(value)
}
function directory(value, create = false) {
  const target = absolute(value)
  let current = path.parse(target).root
  for (const part of target.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    let stat
    try { stat = fs.lstatSync(current) } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error
      fs.mkdirSync(current); stat = fs.lstatSync(current)
    }
    if (stat.isSymbolicLink()) {
      if (!(process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && fs.realpathSync(current) === '/private' + current)) throw new Error('输出目录不允许符号链接')
    } else if (!stat.isDirectory()) throw new Error('输出路径不是目录')
  }
  const stat = fs.statSync(target)
  return { path: target, canonical: fs.realpathSync(target), identity: `${stat.dev}:${stat.ino}` }
}
function state(owner) {
  if (!owner || closed.has(owner) || owner.isDestroyed()) throw new Error('输出来源已关闭')
  if (!owners.has(owner)) {
    owners.set(owner, new Map())
    owner.once('destroyed', () => { closed.add(owner); owners.delete(owner) })
  }
  return owners.get(owner)
}
export function grantConfiguredOutput(owner, purpose, root) {
  if (!purposes.has(purpose)) throw new Error('输出用途无效')
  const record = directory(root)
  state(owner).set(`${purpose}:${record.path}`, record)
}
function verify(record) {
  const current = directory(record.path)
  if (current.canonical !== record.canonical || current.identity !== record.identity) throw new Error('输出目录已变化，请重新选择')
}
export async function authorizeConfiguredOutput(event, purpose, requested) {
  const roles = purpose === 'canvas-output' ? ['main', 'preview'] : ['main']
  if (!isTrustedIpcSender(event, roles) || !purposes.has(purpose)) throw new Error('输出来源未授权')
  const root = absolute(requested || defaults[purpose][0])
  const grants = state(event.sender)
  const key = `${purpose}:${root}`
  let record = grants.get(key)
  if (!record && defaults[purpose].includes(root)) {
    record = directory(root, true)
    grants.set(key, record)
  }
  if (!record) {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '确认本次配置输出目录', defaultPath: root,
      message: '请重新选择配置中的输出目录以授权本窗口保存文件；取消不会写入文件。', properties: ['openDirectory']
    })
    if (!isTrustedIpcSender(event, roles)) throw new Error('输出来源已失效')
    if (result.canceled || result.filePaths?.length !== 1 || absolute(result.filePaths[0]) !== root) throw new Error('输出目录未授权，请重新选择配置中的目录')
    grantConfiguredOutput(event.sender, purpose, root)
    record = grants.get(key)
  }
  verify(record)
  return {
    root,
    directory(target, create = false) {
      state(event.sender); verify(record)
      const resolved = absolute(target)
      const relative = path.relative(root, resolved)
      if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw new Error('输出路径超出已授权目录')
      // 先检查已有祖先；创建时也逐级检查，不允许穿过链接。
      if (create) directory(resolved, true)
      else {
        let existing = resolved
        while (!fs.existsSync(existing)) {
          // lstat 检查悬空链接，避免 existsSync 将其当作缺失目录。
          try { fs.lstatSync(existing); throw new Error('输出路径不允许符号链接') } catch (error) { if (error.code !== 'ENOENT') throw error }
          existing = path.dirname(existing)
        }
        directory(existing)
      }
      verify(record)
      return resolved
    }
  }
}
