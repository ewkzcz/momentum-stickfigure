/** 配置变更只能送往可信主入口；预览及未注册窗口不应被动收到配置值。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('配置广播：主窗口收到真实变更，预览与未注册窗口不接收', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`配置广播证据：${desktop.root}`)
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    await desktop.application.evaluate(({ BrowserWindow }) => {
      // 保持真实send，仅观察主进程实际投递；不依靠固定等待断言没有事件。
      const unknown = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } })
      globalThis.__storageBroadcastUnknown = unknown
      globalThis.__storageBroadcastTrace = []
      for (const window of BrowserWindow.getAllWindows()) {
        const contents = window.webContents
        const send = contents.send.bind(contents)
        contents.send = (channel, ...args) => {
          if (channel === 'storage-changed') globalThis.__storageBroadcastTrace.push({ id: contents.id, payload: args[0] })
          return send(channel, ...args)
        }
      }
    })
    const key = 'isolated-broadcast-secret'
    await desktop.page.evaluate(key => {
      window.__storageBroadcastReceived = new Promise(resolve => {
        const off = window.electronAPI.on('storage-changed', payload => {
          if (payload.key === key) { off(); resolve(payload) }
        })
      })
    }, key)
    const result = await desktop.page.evaluate(key => window.electronAPI.storage.setItem(key, 'isolated-value'), key)
    assert.equal(result.success, true)
    assert.deepEqual(await desktop.page.evaluate(() => window.__storageBroadcastReceived), { method: 'setItem', key, value: 'isolated-value' })
    const trace = await desktop.application.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('/index.html'))
      return { mainId: main.webContents.id, events: globalThis.__storageBroadcastTrace }
    })
    const matching = trace.events.filter(event => event.payload.key === key)
    assert.deepEqual(matching.map(event => event.id), [trace.mainId], '配置仅发送给可信主窗口，不泄露给预览或未注册窗口')
  } finally {
    await desktop.application.evaluate(() => globalThis.__storageBroadcastUnknown?.destroy()).catch(() => {})
    await desktop.close()
  }
})
