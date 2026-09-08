/** 后台测试边界回归：真实 Electron 页面可连接，但所有原生窗口必须隐藏、不可聚焦且不置顶。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('后台桌面测试：窗口不显示、不聚焦、不置顶且不开开发者工具', { timeout: 30000 }, async () => {
  // 1、启动器强制设置后台环境，仍连接真实生产入口而不是替换页面。
  const desktop = await launchDesktop()
  try {
    const initial = await desktop.application.evaluate(() => globalThis.__momentumTest.backgroundPolicy.snapshot())
    assert.ok(initial.windows.length > 0, '必须创建真实主窗口后再验收')
    const snapshot = await desktop.application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.show()
      window.showInactive()
      window.focus()
      window.setAlwaysOnTop(true)
      window.setFocusable(true)
      window.webContents.openDevTools()
      return globalThis.__momentumTest.backgroundPolicy.snapshot()
    })
    for (const name of ['show', 'showInactive', 'focus', 'setAlwaysOnTop', 'setFocusable', 'openDevTools']) assert.ok(snapshot.blockedCalls[name] > (initial.blockedCalls[name] || 0), `未拦截${name}`)
    assert.ok(snapshot.windows.every(window => !window.visible && !window.focused && !window.alwaysOnTop && !window.focusable && !window.devToolsOpened), JSON.stringify(snapshot))
    assert.equal(snapshot.windowEvents.length, 0, JSON.stringify(snapshot))
    assert.equal(await desktop.page.evaluate(() => document.querySelector('#app')?.children.length > 0), true)
    assert.deepEqual(desktop.errors, [])
  } finally {
    await desktop.close()
  }
})
