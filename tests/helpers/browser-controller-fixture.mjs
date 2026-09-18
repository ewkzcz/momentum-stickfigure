/** 隔离加载真实控制器正文，仅替代Electron、计时器和记录观察边界。 */
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs'
import { isTrustedIpcSender, registerTrustedWindow } from '../../src/main/ipc-sender-policy.js'
import { assertBrowserOptions, assertRecord, assertText } from '../../src/main/ipc-parameter-policy.js'
import { assertBrowserDragParameters } from '../../src/main/browser-drag-parameters.js'
import { assertOwnedFilePath, writeOwnedFile } from '../../src/main/file-access-policy.js'
import { sitePartition, webOrigin, installWebPermissions, protectWebNavigation } from '../../src/main/web-session-policy.js'

export async function controllerFixture() {
  const handlers = new Map(), records = [], views = [], timers = new Map(), hosts = [], sessions = new Map()
  let serial = 0
  class ObservedMap extends Map { constructor(...args) { super(...args); records.push(this) } }
  class Host extends EventEmitter {
    constructor() {
      super()
      this.id = hosts.length + 1
      this.dead = false
      this.attached = []
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, {
        id: this.id,
        mainFrame: { url: 'file:///fixture/index.html' },
        isDestroyed: () => this.dead,
        getURL: () => this.webContents.mainFrame.url
      })
      hosts.push(this)
    }
    isDestroyed() { return this.dead }
    getContentBounds() { return { x: 0, y: 0, width: 800, height: 600 } }
    addBrowserView(view) { this.attached.push(view) }
    removeBrowserView(view) { this.attached = this.attached.filter(item => item !== view) }
    destroy() {
      if (this.dead) return
      this.dead = true
      this.emit('closed')
      for (const view of [...this.attached]) view.webContents.close()
      this.webContents.emit('destroyed')
    }
    static fromWebContents(sender) { return hosts.find(host => host.webContents === sender) }
  }
  function createMainHost() {
    const host = new Host()
    registerTrustedWindow(host.webContents, host.webContents.getURL(), 'main')
    return host
  }
  function getSession(partition) {
    if (!sessions.has(partition)) sessions.set(partition, {
      webRequest: { onHeadersReceived() {} },
      setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler },
      setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler }
    })
    return sessions.get(partition)
  }
  class View {
    constructor({ webPreferences }) {
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { dead: false, scripts: 0, css: 0, url: 'about:blank',
        session: getSession(webPreferences.partition),
        isDestroyed() { return this.dead },
        close() { if (!this.dead) { this.dead = true; this.emit('destroyed') } },
        getURL() { return this.url },
        setWindowOpenHandler(handler) { this.windowOpenHandler = handler },
        getUserAgent: () => 'test Electron/35 browser', setUserAgent() {},
        loadURL: async url => { this.webContents.url = url; if (fixture.load) await fixture.load() },
        insertCSS: async () => { this.webContents.css++; if (fixture.cssWait) await fixture.cssWait },
        executeJavaScript: async () => { this.webContents.scripts++ },
        reloadIgnoringCache() {}, reload() {}
      })
      views.push(this)
    }
    setBounds() {}
    setBackgroundColor() {}
  }
  const nativeTheme = { themeSource: 'system', shouldUseDarkColors: false }
  const electron = { app: {}, BrowserWindow: Host, BrowserView: View, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name), on() {} }, nativeImage: {}, nativeTheme, session: { defaultSession: getSession('default'), fromPartition: getSession } }
  // 控制器正文移除静态import后，显式注入原模块导出的真实策略，不放宽授权边界。
  const policies = { isTrustedIpcSender, assertBrowserOptions, assertRecord, assertText, assertBrowserDragParameters, assertOwnedFilePath, writeOwnedFile, sitePartition, webOrigin, installWebPermissions, protectWebNavigation }
  const source = await readFile(new URL('../../src/main/browser-view-controller.js', import.meta.url), 'utf8')
  const body = source.replace(/^import .*\n/gm, '').replace('export function createBrowserViewController', 'function createBrowserViewController')
  const load = new Function(...Object.keys(electron), ...Object.keys(policies), 'path', 'fs', 'Map', 'setTimeout', 'clearTimeout', `${body}\nreturn createBrowserViewController`)
  const factory = load(...Object.values(electron), ...Object.values(policies), path, fs, ObservedMap, (callback, ms) => { const id = ++serial; timers.set(id, { callback, ms }); return id }, id => timers.delete(id))
  const controller = factory({ getPicturesDirectory: () => '/unused' })
  controller.registerBrowserViewHandlers()
  const host = createMainHost()
  const fixture = { controller, host, hosts, Host, createMainHost, records: records[0], views, timers, nativeTheme, load: null, cssWait: null,
    invoke: (name, input = {}, owner = host) => handlers.get(`browserview:${name}`)({ sender: owner.webContents, senderFrame: owner.webContents.mainFrame }, { url: 'http://fixture.test', ...input }),
    async flush() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback() }; await Promise.resolve(); await Promise.resolve() }
  }
  return fixture
}
