import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('特权窗口权限：主窗口和预览均拒绝地理位置且保留应用可用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))).success, true)
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const page of [desktop.page, preview]) {
      assert.equal(await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state), 'denied')
    }
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.storage.length())).success, true)
    const closed = preview.waitForEvent('close')
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-close'))).success, true)
    await closed
  } finally { await desktop.close() }
})
