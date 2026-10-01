import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { launchDesktop, repository } from './helpers/desktop.mjs'

test('PSD来源：相同入口但未登记窗口不能调用，合法预览仍可取消自身任务', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.application.evaluate(({ BrowserWindow }, preload) => {
      const main = BrowserWindow.getAllWindows()[0]
      const probe = new BrowserWindow({ show: false, webPreferences: { preload, sandbox: false, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } })
      globalThis.__psdUntrusted = probe
      void probe.loadURL(main.webContents.getURL())
    }, path.join(repository, 'out/preload/index.cjs'))
    const probe = await opening
    await probe.waitForFunction(() => Boolean(window.electronAPI))
    for (const channel of ['psd-cancel-parse', 'psd-parse-file', 'psd-render-layers', 'psd-detect-components', 'psd-get-info', 'psd-validate-file', 'psd-get-config']) {
      const result = await probe.evaluate(channel => window.electronAPI.invoke(channel, channel === 'psd-cancel-parse' ? 'probe' : {}), channel)
      assert.equal(result.success, false, channel)
      assert.match(result.message || '', /未授权/, channel)
    }
    await desktop.application.evaluate(() => globalThis.__psdUntrusted.destroy())
    const previewOpening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await previewOpening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    assert.deepEqual(await preview.evaluate(() => window.electronAPI.invoke('psd-cancel-parse', 'none')), { success: true, cancelled: false })
  } finally {
    await desktop.application.evaluate(() => { if (globalThis.__psdUntrusted && !globalThis.__psdUntrusted.isDestroyed()) globalThis.__psdUntrusted.destroy() })
    await desktop.close()
  }
})
