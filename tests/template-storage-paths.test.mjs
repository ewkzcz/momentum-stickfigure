import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, mkdtemp, symlink, access, rm } from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { promisify } from 'node:util'
import { assertTemplateImagePayload } from '../src/main/template-image-parameters.js'

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-template-path-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const userData = path.join(root, 'user-data'), outside = path.join(root, 'outside')
  await mkdir(userData); await mkdir(outside)
  const handlers = new Map(), ipcMain = { handle: (name, fn) => handlers.set(name, fn) }, app = { getPath: () => userData }
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, () => {})
  const source = await readFile(new URL('../src/main/template-storage-service.js', import.meta.url), 'utf8')
  const policy = await readFile(new URL('../src/main/template-storage-paths.js', import.meta.url), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  const senderPolicy = await readFile(new URL('../src/main/ipc-sender-policy.js', import.meta.url), 'utf8')
  const sender = { mainFrame: { url: 'file:///isolated/index.html' }, isDestroyed: () => false, once: () => {} }
  const event = { sender, senderFrame: sender.mainFrame }
  const body = (senderPolicy + '\n' + policy + '\n' + source).replace(/^import .*\n/gm, '').replace(/export function /g, 'function ')
  new Function('ipcMain', 'app', 'fs', 'path', 'promisify', 'sender', 'assertTemplateImagePayload', `${body}\nregisterTrustedWindow(sender, sender.mainFrame.url, 'main')\nregisterTemplateStorageHandlers()`)(ipcMain, app, fs, path, promisify, sender, assertTemplateImagePayload)
  return { root, userData, outside, invoke: (name, args) => handlers.get(`template-storage-${name}`)(event, args) }
}

for (const kind of ['traversal', 'directory-symlink', 'file-symlink']) test(`模板图片读删${kind}不得越过存储目录`, async t => {
  const f = await fixture(t), secret = path.join(f.outside, 'secret.png')
  await writeFile(secret, 'isolated secret')
  await mkdir(path.join(f.userData, 'templates', 'actionTemplate'), { recursive: true })
  let relativePath
  if (kind === 'traversal') relativePath = '../outside/secret.png'
  if (kind === 'directory-symlink') { await symlink(f.outside, path.join(f.userData, 'templates', 'escape')); relativePath = 'templates/escape/secret.png' }
  if (kind === 'file-symlink') { await symlink(secret, path.join(f.userData, 'templates', 'actionTemplate', 'link.png')); relativePath = 'templates/actionTemplate/link.png' }
  const loaded = await f.invoke('load-image', { relativePath })
  const deleted = await f.invoke('delete-image', { relativePath })
  assert.equal(loaded.base64Data == null, true, '目录外内容不得返回')
  assert.equal(deleted.success, false, '越界路径不得删除')
  assert.equal(await readFile(secret, 'utf8'), 'isolated secret')
})

for (const kind of ['type-traversal', 'id-traversal', 'directory-symlink', 'file-symlink']) test(`模板图片写入${kind}不得越界`, async t => {
  const f = await fixture(t), secret = path.join(f.outside, 'secret.png')
  await writeFile(secret, 'isolated secret')
  await mkdir(path.join(f.userData, 'templates', 'actionTemplate'), { recursive: true })
  let templateType = 'actionTemplate', templateId = 'safe'
  if (kind === 'type-traversal') { templateType = '../../outside'; templateId = 'secret' }
  if (kind === 'id-traversal') templateId = '../../../outside/secret'
  if (kind === 'directory-symlink') { await symlink(f.outside, path.join(f.userData, 'templates', 'escape')); templateType = 'escape'; templateId = 'secret' }
  if (kind === 'file-symlink') { await symlink(secret, path.join(f.userData, 'templates', 'actionTemplate', 'safe.png')) }
  assert.equal((await f.invoke('save-image', { templateType, templateId, base64Data: 'data:image/png;base64,Y2hhbmdlZA==' })).success, false)
  assert.equal(await readFile(secret, 'utf8'), 'isolated secret')
})

test('模板合法类型与中文空格标识保存读取删除保持可用', async t => {
  const f = await fixture(t)
  for (const templateType of ['actionTemplate', 'expressionTemplate', 'presetPreviews']) {
    const saved = await f.invoke('save-image', { templateType, templateId: '中文 空格', base64Data: 'data:image/png;base64,aGVsbG8=' })
    assert.equal(saved.success, true)
    const loaded = await f.invoke('load-image', { relativePath: saved.filePath })
    assert.equal(loaded.base64Data, 'data:image/png;base64,aGVsbG8=')
    assert.equal((await f.invoke('delete-image', { relativePath: saved.filePath })).success, true)
    await assert.rejects(access(path.join(f.userData, saved.filePath)))
  }
})
