import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('内嵌网页参数：错误配置和边界在创建视图前拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
    for (const channel of ['browserview:open', 'browserview:close', 'browserview:setBounds', 'browserview:applyTheme', 'browserview:reload']) {
      for (const payload of [null, [], { partition: {} }, { url: {} }, { bounds: { x: 0, y: 0, width: Infinity, height: 10 } }, { theme: {} }]) {
        const result = await invoke(channel, payload)
        assert.equal(result.success, false)
        assert.match(result.error, /参数/)
      }
    }
    assert.equal(await desktop.application.evaluate(({ webContents }) => webContents.getAllWebContents().filter(item => item.getType() === 'browserView').length), 0)
    assert.deepEqual(await invoke('browserview:close', { partition: 'persist:fixture', url: 'http://localhost:12345/path' }), { success: true })
  } finally { await desktop.close() }
})
