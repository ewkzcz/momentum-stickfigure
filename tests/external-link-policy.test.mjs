import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL } from '../src/main/application-protocol.js'
import { protectPrivilegedNavigation } from '../src/main/privileged-navigation.js'
import { registerTrustedWindow, isTrustedIpcSender } from '../src/main/ipc-sender-policy.js'
import { installPrivilegedPermissions, protectWebNavigation } from '../src/main/web-session-policy.js'

async function fixture(t) {
  t.mock.method(console, 'log', () => {}); t.mock.method(console, 'warn', () => {}); t.mock.method(console, 'error', () => {})
  const opened = [], windows = [], app = new EventEmitter(), handlers = new Map()
  const shell = { openExternal: async url => { opened.push(url) } }
  class Window extends EventEmitter {
    constructor() {
      super(); windows.push(this)
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { session: { webRequest: { onBeforeRequest() {}, onHeadersReceived() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} }, setWindowOpenHandler: handler => { this.open = handler } })
    }
    loadFile() {} loadURL() {} isDestroyed() { return false }
  }
  const attachmentSource = await readFile(new URL('../src/main/webview-attachment-policy.js', import.meta.url), 'utf8')
  const attachmentBody = attachmentSource.replace(/^import .*\n/gm, '').replace(/export (async )?function /g, '$1function ')
  const protectWebviewAttachment = new Function('isTrustedIpcSender', `${attachmentBody}\nreturn protectWebviewAttachment`)(isTrustedIpcSender)
  const deps = { app, BrowserWindow: Window, shell, ipcMain: { on() {}, handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name) }, nativeTheme: {}, globalShortcut: {}, is: { dev: false }, path, pathToFileURL, MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL, protectPrivilegedNavigation, registerTrustedWindow, isTrustedIpcSender, installPrivilegedPermissions, protectWebviewAttachment, getHotkeysConfig: () => ({}), saveHotkeysConfig() {} }
  const policy = await readFile(new URL('../src/main/external-link-policy.js', import.meta.url), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error })
  const source = await readFile(new URL('../src/main/window-controller.js', import.meta.url), 'utf8')
  const body = (policy + '\n' + source).replace(/^import .*\n/gm, '').replace(/export (async )?function /g, '$1function ')
  const controller = new Function(...Object.keys(deps), `${body}\nreturn createWindowController({mainDirectory: '/unused'})`)(...Object.values(deps))
  controller.createWindow()
  const main = windows[0]
  main.webContents.isDestroyed = () => false
  main.webContents.mainFrame = { url: MAIN_APPLICATION_URL }
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
  assert.equal(isTrustedIpcSender(event), true, '模拟主框架必须匹配生产登记的应用协议入口')
  const webview = new EventEmitter()
  webview.setWindowOpenHandler = handler => { webview.open = handler }
  protectWebNavigation(webview)
  const shellSource = await readFile(new URL('../src/main/shell-handler.js', import.meta.url), 'utf8')
  const shellBody = (policy + '\n' + shellSource).replace(/^import .*\n/gm, '').replace(/^export \{.*\}\s*$/gm, '').replace(/export (async )?function /g, '$1function ')
  new Function(...Object.keys(deps), `${shellBody}\nregisterShellHandlers()`)(...Object.values(deps))
  return { main, webview, opened, invoke: value => handlers.get('shell-open-external')(event, value) }
}

for (const target of ['main', 'webview']) test(`外部链接${target}：仅HTTP(S)交给系统，拒绝本地与脚本协议`, async t => {
  const f = await fixture(t)
  for (const url of ['file:///tmp/private', 'javascript:alert(1)', 'data:text/html,test', 'custom-app://run', 'not a url']) {
    assert.deepEqual(f[target].open({ url }), { action: 'deny' })
  }
  assert.deepEqual(f.opened, [], '不允许的协议不得到达系统处理器')
  for (const url of ['https://github.com/ewkzcz/momentum-stickfigure', 'http://localhost:8080/docs', 'HTTPS://example.com/help']) {
    assert.deepEqual(f[target].open({ url }), { action: 'deny' })
  }
  await Promise.resolve()
  assert.deepEqual(f.opened, target === 'main' ? ['https://github.com/ewkzcz/momentum-stickfigure', 'http://localhost:8080/docs', 'https://example.com/help'] : [], '主窗链接交给系统；网页弹窗按既有策略全部拒绝')
})

test('系统链接IPC：与窗口入口共享协议且保持成功失败返回', async t => {
  const f = await fixture(t)
  for (const url of [undefined, null, 123, {}, '', 'broken', 'file:///tmp/private', 'custom-app://run', 'javascript:alert(1)']) assert.equal((await f.invoke(url)).success, false)
  assert.deepEqual(f.opened, [])
  assert.deepEqual(await f.invoke('HTTPS://example.com/help'), { success: true })
  assert.deepEqual(f.opened, ['https://example.com/help'])
})
