import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchDesktop } from './helpers/desktop.mjs'

test('特权窗口沙箱：同步环境桥接兼容中文路径，主窗预览实际启用沙箱', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))).success, true)
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const states = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(win => ({ sandbox: win.webContents.getLastWebPreferences().sandbox })))
    assert.deepEqual(states, [{ sandbox: true }, { sandbox: true }])
    const file = path.join(desktop.root, '中文 空格#?.png')
    for (const page of [desktop.page, preview]) {
      const env = await page.evaluate(file => ({ platform: window.env.platform, homedir: window.env.homedir, url: window.env.pathToFileURL(file) }), file)
      assert.deepEqual(env, { platform: process.platform, homedir: path.join(desktop.root, 'home'), url: pathToFileURL(file).href })
    }
    const rejected = await desktop.application.evaluate(({ BrowserWindow, ipcMain }) => {
      const main = BrowserWindow.getAllWindows()[0].webContents
      const foreign = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        const cases = [
          { sender: foreign.webContents, senderFrame: foreign.webContents.mainFrame },
          { sender: main, senderFrame: { url: main.mainFrame.url } }
        ]
        return cases.map(event => {
          ipcMain.emit('environment:sync', event)
          return event.returnValue
        })
      } finally { foreign.destroy() }
    })
    assert.deepEqual(rejected, [null, null], '未登记窗口和非顶层frame不得读取同步环境')
    for (const invalid of [null, {}, 'bad\u0000path', 'x'.repeat(32769)]) {
      assert.equal(await desktop.page.evaluate(value => window.env.pathToFileURL(value), invalid), null)
    }
    assert.equal(await desktop.page.evaluate(file => window.env.pathToFileURL(file), file), pathToFileURL(file).href)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
