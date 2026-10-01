import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('内嵌网页控制：预览七通道来源先于参数及副作用拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const channel of ['browserview:close', 'browserview:open', 'browserview:setBounds', 'browserview:applyTheme', 'browserview:reload', 'doubao:drag-start', 'doubao:prepare-file-async']) {
      for (const payload of [{}, null]) {
        const result = await preview.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
        assert.equal(result.success, false, channel)
        assert.match(result.error, /未授权/)
      }
    }
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('browserview:close', {})), { success: true })
  } finally { await desktop.close() }
})
