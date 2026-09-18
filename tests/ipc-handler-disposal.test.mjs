import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { assertOwnedFilePath } from '../src/main/file-access-policy.js'
import { EventEmitter } from 'node:events'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const groups = [
  ['file-read-handler', 'registerFileOperationHandlers', 'unregisterFileOperationHandlers'],
  ['file-write-handler', 'registerFileWriteHandler', 'unregisterFileWriteHandler'],
  ['file-selection-handler', 'registerFolderSelectHandler', 'unregisterFolderSelectHandler'],
  ['custom-dialog-handler', 'registerCustomDialogHandlers', 'unregisterCustomDialogHandlers'],
  ['drag-clipboard-handler', 'registerDragToJianyingHandlers', 'unregisterDragToJianyingHandlers'],
  ['preset-handler', 'registerPresetHandlers', 'unregisterPresetHandlers'],
  ['settings-handler', 'registerSettingsHandlers', 'unregisterSettingsHandlers'],
  ['shell-handler', 'registerShellHandlers', 'unregisterShellHandlers'],
  ['window-controller', 'registerWindowControlHandlers', 'unregisterWindowControlHandlers'],
  ['window-controller', 'registerHotkeyHandlers', 'unregisterHotkeyHandlers']
]
for (const [file, register, unregister] of groups) test(`IPC注销契约：${file}/${register}真正释放并可重复注册`, async t => {
  t.mock.method(console, 'log', () => {})
  const handlers = new Map(), ipcMain = new EventEmitter()
  ipcMain.handle = (name, callback) => { if (handlers.has(name)) throw new Error(`duplicate ${name}`); handlers.set(name, callback) }
  ipcMain.removeHandler = name => handlers.delete(name)
  const app = new EventEmitter()
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-ipc-disposal-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  app.getPath = () => root
  const deps = { assertOwnedFilePath, app, ipcMain, BrowserWindow: {}, shell: {}, dialog: {}, clipboard: {}, nativeImage: {}, nativeTheme: {}, globalShortcut: { unregisterAll() {} }, path, fs: { ...fs, existsSync: () => true }, os, is: { dev: false }, getHotkeysConfig: () => ({}), saveHotkeysConfig() {} }
  const source = process.env.MOMENTUM_IPC_REVISION
    ? execFileSync('git', ['show', `${process.env.MOMENTUM_IPC_REVISION}:src/main/${file}.js`], { encoding: 'utf8' })
    : await readFile(new URL(`../src/main/${file}.js`, import.meta.url), 'utf8')
  const body = source.replace(/^import .*\n/gm, '').replace(/^export \{.*\}\s*$/gm, '').replace(/export function /g, 'function ')
  const result = file === 'window-controller' ? 'createWindowController({mainDirectory: "/unused"})' : `{${register},${unregister}}`
  const api = new Function(...Object.keys(deps), `${body}\nreturn ${result}`)(...Object.values(deps))
  for (let cycle = 0; cycle < 3; cycle++) {
    api[register]()
    assert.ok(handlers.size > 0)
    const channel = [...handlers.keys()][0], unrelatedListener = () => {}
    ipcMain.on(channel, unrelatedListener)
    api[unregister]()
    assert.deepEqual([...handlers.keys()], [], '注销后invoke处理器必须全部释放')
    assert.ok(ipcMain.listeners(channel).includes(unrelatedListener), '不得移除同名通道独立事件订阅')
    ipcMain.removeListener(channel, unrelatedListener)
  }
})
