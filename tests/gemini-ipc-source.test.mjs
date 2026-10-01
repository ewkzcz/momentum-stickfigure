import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('Gemini图像能力：预览六通道拒绝，主窗无效图片保持正常结果', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const [channel, payload] of [['fal-get-config', {}], ['fal-generate-image', {}], ['fal-edit-image', {}], ['fal-validate-image', '/nonexistent'], ['fal-validate-images', []], ['fal-create-directories', {}]]) {
      const result = await preview.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
      assert.equal(result.success, false, channel)
      assert.match(result.message, /未授权/)
    }
    const valid = await desktop.page.evaluate(() => window.electronAPI.invoke('fal-validate-image', '/isolated-nonexistent.png'))
    assert.deepEqual(valid, { success: true, data: { isValid: false, imageInfo: null } })
  } finally { await desktop.close() }
})
