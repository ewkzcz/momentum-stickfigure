import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('存储参数：错误键和值拒绝且不污染已有配置', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
    assert.deepEqual(await invoke('storage:setItem', 'fixture-key', 'original'), { success: true })
    for (const key of [null, {}, [], 'x'.repeat(4097)]) {
      for (const channel of ['storage:getItem', 'storage:setItem', 'storage:removeItem']) {
        const result = await invoke(channel, key, 'bad')
        assert.equal(result.success, false)
        assert.match(result.error, /参数/)
      }
    }
    for (const value of [{ arbitrary: true }, [], new Uint8Array([1, 2])]) {
      const result = await invoke('storage:setItem', 'fixture-key', value)
      assert.equal(result.success, false)
      assert.match(result.error, /参数/)
      assert.equal((await invoke('storage:getItem', 'fixture-key')).value, 'original')
    }
    for (const value of [42, false, null, undefined, '中文 空格']) {
      assert.deepEqual(await invoke('storage:setItem', 'fixture-scalar', value), { success: true })
      assert.equal((await invoke('storage:getItem', 'fixture-scalar')).value, String(value))
    }
    assert.deepEqual(await invoke('storage:removeItem', 'fixture-key'), { success: true })
  } finally { await desktop.close() }
})
