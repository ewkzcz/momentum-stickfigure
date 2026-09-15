import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('本地处理参数：高清配置和字幕载荷先校验且不启动进程', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
    const initial = (await invoke('hd:get-initial-data')).data.config
    for (const [channel, payload] of [
      ['hd:save-config', []], ['hd:save-config', null], ['hd:save-config', { highres: [] }], ['hd:save-config', { pythonHome: {} }],
      ['hd:run-removebg', { inputPaths: 'image.png' }], ['hd:run-highres', { outscale: {} }], ['hd:get-image-preview', {}],
      ['video-ocr:check-environment', {}], ['video-ocr:clean-environment', []], ['video-ocr:install-environment', {}],
      ['video-ocr:process-video', null], ['video-ocr:process-video', { useAI: 'false' }], ['video-ocr:process-video', { intervalSeconds: Infinity }]
    ]) {
      const result = await invoke(channel, payload)
      assert.equal(result.success, false, channel)
      assert.match(result.message, /参数/)
    }
    assert.deepEqual((await invoke('hd:get-initial-data')).data.config, initial)
    assert.equal((await invoke('hd:save-config', { highres: { outscale: 2, tile: 0, half: false } })).success, true)
    assert.deepEqual(await invoke('hd:cancel'), { success: true, cancelled: 0 })
    assert.deepEqual(await invoke('video-ocr:cancel'), { success: true, cancelled: 0 })
  } finally { await desktop.close() }
})
