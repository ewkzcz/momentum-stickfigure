import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { launchDesktop, repository } from './helpers/desktop.mjs'

test('系统能力：未登记窗口不能调用拖拽剪贴板字体和链接', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.application.evaluate(({ BrowserWindow }, preload) => {
      const main = BrowserWindow.getAllWindows()[0]
      const probe = globalThis.__systemProbe = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: false, contextIsolation: true } })
      void probe.loadURL(main.webContents.getURL())
    }, path.join(repository, 'out/preload/index.cjs'))
    const probe = await opening
    await probe.waitForFunction(() => Boolean(window.electronAPI))
    for (const [channel, args] of [['get-window-bounds', []], ['copy-to-clipboard', ['isolated']], ['save-drag-image-and-copy', ['eA==']], ['create-temp-file-and-start-drag', ['eA==']], ['fonts:get-system-fonts', []], ['shell-open-external', ['https://example.invalid']]]) {
      const result = await probe.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
      assert.equal(result.success, false, channel)
      assert.match(result.error, /未授权/)
    }
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('get-window-bounds'))).success, true)
  } finally {
    await desktop.application.evaluate(() => globalThis.__systemProbe?.destroy())
    await desktop.close()
  }
})
