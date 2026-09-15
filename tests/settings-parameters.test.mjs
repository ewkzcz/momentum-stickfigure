import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('设置归档参数：错误对象拒绝且不覆盖最新备份', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
    const original = { version: 'fixture', settings: { name: '保留', apiKey: 'fake-key' } }
    assert.equal((await invoke('settings-auto-backup', original)).success, true)
    const cyclic = {}; cyclic.self = cyclic
    for (const value of [null, [], 'text', { invalid: Infinity }, cyclic]) {
      const result = await invoke('settings-auto-backup', value)
      assert.equal(result.success, false)
      assert.match(result.error, /参数/)
      assert.deepEqual((await invoke('settings-restore')).settings, original)
    }
    for (const options of [null, [], { includeSecrets: 'true' }]) {
      const result = await invoke('settings-export', original, options)
      assert.equal(result.success, false)
      assert.match(result.error, /参数/)
    }
    assert.equal((await invoke('settings-export', original)).canceled, true)
  } finally { await desktop.close() }
})
