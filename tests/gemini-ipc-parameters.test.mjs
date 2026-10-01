import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('图像服务参数：拒绝非对象配置和错误图片列表，合法配置保持可读', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
    for (const [channel, payload] of [
      ['fal-get-config', []], ['fal-get-config', null], ['fal-get-config', { model: {} }],
      ['fal-create-directories', []], ['fal-generate-image', { prompt: {} }], ['fal-edit-image', { inputImages: 'file.png' }],
      ['fal-validate-images', 'abc'], ['fal-validate-images', [null]], ['fal-validate-image', {}]
    ]) {
      const result = await invoke(channel, payload)
      assert.equal(result.success, false, channel)
      assert.match(result.message, /参数/)
    }
    const config = await invoke('fal-get-config', { baseUrl: 'http://127.0.0.1:12345/custom', model: 'fixture', timeoutMinutes: 5 })
    assert.equal(config.success, true)
    assert.equal(config.data.config.model, 'fixture')
    assert.deepEqual(await invoke('fal-validate-images', []), { success: true, data: [] })
  } finally { await desktop.close() }
})
