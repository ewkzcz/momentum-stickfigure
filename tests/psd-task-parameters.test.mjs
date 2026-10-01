import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('PSD任务参数：非法标识和选项对象在任务登记前拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const before = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.listenerCount('destroyed'))
    for (const options of [null, [], { taskId: {} }, { taskId: '' }, { taskId: 'x'.repeat(129) }, { parseOptions: [] }, { parseOptions: { parseImages: 'false' } }]) {
      const result = await desktop.page.evaluate(options => window.electronAPI.invoke('psd-parse-file', options), options)
      assert.equal(result.success, false)
      assert.match(result.message, /参数/)
    }
    for (const id of [null, {}, '', 'x'.repeat(129)]) {
      assert.equal((await desktop.page.evaluate(id => window.electronAPI.invoke('psd-cancel-parse', id), id)).success, false)
    }
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('psd-cancel-parse', 'valid-中文')), { success: true, cancelled: false })
    const after = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.listenerCount('destroyed'))
    assert.equal(after, before)
  } finally { await desktop.close() }
})
