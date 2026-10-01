/** 后台窗口策略：测试入口在任何业务模块加载前安装，拒绝弹窗、聚焦和系统通知。 */
const assert = require('node:assert/strict')
const Module = require('node:module')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** 安装受保护的 Electron 外观；保留原生查询和业务 IPC，不改变生产代码。 */
function installBackgroundPolicy(electron) {
  // 1、只统计请求和实际事件，查询方法不被替换。
  const { app, BrowserWindow: OriginalWindow } = electron
  const calls = {}
  const events = []
  const windows = new WeakSet()
  const contentsSet = new WeakSet()
  const remember = name => { calls[name] = (calls[name] || 0) + 1 }
  /** 固定系统副作用入口，保护不可安装时抛错。 */
  function block(object, name, value) {
    // 1、缺少的平台接口不安装，其余接口必须确实被覆盖。
    if (!object || typeof object[name] !== 'function') return
    const handler = () => { remember(name); return value }
    Object.defineProperty(object, name, { value: handler, configurable: false, writable: false })
    assert.equal(object[name], handler)
  }
  // 2、保护安装错误也不得弹系统错误框。
  for (const key of ['showErrorBox', 'showMessageBoxSync']) block(electron.dialog, key, 0)
  for (const key of ['showMessageBox', 'showCertificateTrustDialog']) block(electron.dialog, key, Promise.resolve({ response: 0 }))
  block(electron.Menu?.prototype, 'popup')
  block(electron.Notification?.prototype, 'show')
  block(electron.shell, 'showItemInFolder')
  block(electron.shell, 'beep')
  if (process.platform === 'darwin') {
    app.setActivationPolicy('prohibited')
    app.dock?.hide()
    block(app, 'setActivationPolicy')
    block(app.dock, 'show', Promise.resolve())
    block(app.dock, 'bounce', -1)
    block(app.dock, 'setBadge')
  }
  for (const key of ['show', 'focus', 'showAboutPanel']) block(app, key)
  for (const key of ['disable-background-timer-throttling', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(key)

  /** 后台维持真实绘制，但禁止系统焦点与开发者工具。 */
  function protectContents(contents) {
    // 1、重复事件不重复安装。
    if (contentsSet.has(contents)) return
    contentsSet.add(contents)
    contents.setBackgroundThrottling(false)
    contents.setAudioMuted(true)
    for (const key of ['focus', 'openDevTools', 'toggleDevTools', 'inspectElement']) block(contents, key)
    contents.setWindowOpenHandler(() => ({ action: 'deny' }))
    block(contents, 'setWindowOpenHandler')
    contents.on('will-attach-webview', event => { event.preventDefault(); remember('webview') })
  }
  /** 窗口已经使用隐藏参数构造；再锁定所有主动显示接口。 */
  function protectWindow(window) {
    // 1、原生事件若仍出现，终止测试，不能用事后隐藏掩盖。
    if (windows.has(window)) return
    windows.add(window)
    for (const key of ['show', 'showInactive', 'focus', 'restore', 'maximize', 'minimize', 'moveTop', 'moveAbove', 'setFullScreen', 'setSimpleFullScreen', 'setKiosk', 'setAlwaysOnTop', 'setFocusable', 'setSkipTaskbar', 'flashFrame', 'setVisibleOnAllWorkspaces']) block(window, key)
    for (const key of ['show', 'focus']) window.on(key, () => {
      events.push({ windowId: window.id, event: key })
      app.exit(1)
    })
    if (window.webContents) protectContents(window.webContents)
    assert.equal(window.isVisible(), false)
    assert.equal(window.isFocused(), false)
    assert.equal(window.isAlwaysOnTop(), false)
    assert.equal(window.isFocusable(), false)
  }
  app.on('web-contents-created', (_event, contents) => protectContents(contents))
  app.on('browser-window-created', (_event, window) => protectWindow(window))
  /** 在原生构造前强制参数，不存在先显示再隐藏的时间窗口。 */
  function wrap(Native) {
    // 1、仅包装原构造器，实例和静态查询仍为真实 Electron 能力。
    return new Proxy(Native, { construct(target, args) {
      const options = args[0] || {}
      const window = Reflect.construct(target, [{
        ...options, show: false, focusable: false, alwaysOnTop: false, skipTaskbar: true,
        fullscreen: false, kiosk: false, paintWhenInitiallyHidden: true,
        webPreferences: { ...options.webPreferences, backgroundThrottling: false, disableDialogs: true, navigateOnDragDrop: false }
      }])
      protectWindow(window)
      return window
    } })
  }
  // 生产主进程会请求显示窗口；测试只断言其请求被后台代理拦截，原生窗口仍保持隐藏。
  const facade = {}
  const replacements = { BrowserWindow: wrap(OriginalWindow) }
  if (electron.BaseWindow) replacements.BaseWindow = wrap(electron.BaseWindow)
  if (electron.Tray) replacements.Tray = class { constructor() { throw new Error('后台测试禁止系统托盘') } }
  for (const name of Object.keys(electron)) Object.defineProperty(facade, name, {
    enumerable: true, get: () => Object.hasOwn(replacements, name) ? replacements[name] : electron[name]
  })
  Object.freeze(facade)
  globalThis.__momentumBackgroundElectron = facade
  const originalLoad = Module._load
  const aliases = ['electron', 'electron/main', 'electron/common', 'electron/renderer']
  Module._load = function (name, ...args) {
    if (aliases.includes(name)) return facade
    return originalLoad.call(this, name, ...args)
  }
  // 3、ESM 入口使用相同外观，避开 Electron 不可改写的原模块 getter。
  Module.register(pathToFileURL(path.join(__dirname, 'background-electron-loader.mjs')).href, { data: { names: Object.keys(electron) } })
  const policy = {
    snapshot: () => ({ installed: true, blockedCalls: { ...calls }, windowEvents: [...events], windows: OriginalWindow.getAllWindows().map(window => ({
      id: window.id, visible: window.isVisible(), focused: window.isFocused(), alwaysOnTop: window.isAlwaysOnTop(), focusable: window.isFocusable(), devToolsOpened: window.webContents.isDevToolsOpened()
    })) })
  }
  globalThis.__momentumBackgroundPolicy = policy
  return { facade, policy }
}

module.exports = { installBackgroundPolicy }
