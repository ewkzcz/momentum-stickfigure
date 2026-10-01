import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'
import { checkPreviewPayload } from './scenarios/preview-payload.mjs'

test('预览画布参数：错误类型编码及尺寸在转发前拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))).success, true)
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    await preview.evaluate(() => { globalThis.__canvasEvents = []; window.electronAPI.on('canvas-update', value => globalThis.__canvasEvents.push(value)) })
    const invalid = [null, [], {}, '%%%', 'https://example.invalid/a.png', { buffer: {} }, { dataUrl: 'data:image/png;base64,%%%' }, { dataUrl: 'data:image/png;base64,eA==', width: -1, height: 8 }, { dataUrl: 'data:image/png;base64,eA==', width: 1000000, height: 1000000 }, { dataUrl: 'data:image/png;base64,eA==', mimeType: 'text/html' }]
    for (const payload of invalid) {
      const result = await desktop.page.evaluate(payload => window.electronAPI.invoke('canvas-preview-update', payload), payload)
      assert.equal(result.success, false)
      assert.match(result.error, /参数|预算/)
    }
    assert.equal(await preview.evaluate(() => globalThis.__canvasEvents.length), 0)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
test('预览画布参数：合法二进制、偏移视图和旧数据地址逐像素恢复', { timeout: 120000 }, checkPreviewPayload)
