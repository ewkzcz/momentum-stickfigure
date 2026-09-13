/** 隔离加载真实控制器正文，仅替代Electron、计时器和记录观察边界。 */
import { readFile } from 'node:fs/promises'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import fs from 'node:fs'

export async function controllerFixture() {
  const handlers = new Map(), records = [], views = [], timers = new Map(), hosts = []
  let serial = 0
  class ObservedMap extends Map { constructor(...args) { super(...args); records.push(this) } }
  class Host extends EventEmitter {
    constructor() { super(); this.id = hosts.length + 1; this.dead = false; this.attached = []; this.webContents = { id: this.id }; hosts.push(this) }
    isDestroyed() { return this.dead }
    getContentBounds() { return { x: 0, y: 0, width: 800, height: 600 } }
    addBrowserView(view) { this.attached.push(view) }
    removeBrowserView(view) { this.attached = this.attached.filter(item => item !== view) }
    destroy() { this.dead = true; this.emit('closed'); for (const view of [...this.attached]) view.webContents.close() }
    static fromWebContents(sender) { return hosts.find(host => host.webContents === sender) }
  }
  class View {
    constructor() {
      this.webContents = new EventEmitter()
      Object.assign(this.webContents, { dead: false, scripts: 0, css: 0,
        isDestroyed() { return this.dead },
        close() { if (!this.dead) { this.dead = true; this.emit('destroyed') } },
        getUserAgent: () => 'test Electron/35 browser', setUserAgent() {},
        loadURL: async () => { if (fixture.load) await fixture.load() },
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
  const electron = { app: {}, BrowserWindow: Host, BrowserView: View, ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler: name => handlers.delete(name), on() {} }, nativeImage: {}, nativeTheme, session: { defaultSession: { webRequest: { onHeadersReceived() {} } } } }
  const source = await readFile(new URL('../../src/main/browser-view-controller.js', import.meta.url), 'utf8')
  const body = source.replace(/^import .*\n/gm, '').replace('export function createBrowserViewController', 'function createBrowserViewController')
  const load = new Function(...Object.keys(electron), 'path', 'fs', 'Map', 'setTimeout', 'clearTimeout', `${body}\nreturn createBrowserViewController`)
  const factory = load(...Object.values(electron), path, fs, ObservedMap, (callback, ms) => { const id = ++serial; timers.set(id, { callback, ms }); return id }, id => timers.delete(id))
  const controller = factory({ getPicturesDirectory: () => '/unused' })
  controller.registerBrowserViewHandlers()
  const host = new Host()
  const fixture = { controller, host, hosts, Host, records: records[0], views, timers, nativeTheme, load: null, cssWait: null,
    invoke: (name, input = {}, owner = host) => handlers.get(`browserview:${name}`)({ sender: owner.webContents }, { url: 'http://fixture.test', ...input }),
    async flush() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.callback() }; await Promise.resolve(); await Promise.resolve() }
  }
  return fixture
}
