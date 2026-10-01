import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('高清模式兼容：fast可保存，任务进入正常环境校验，未知模式仍拒绝', { timeout: 30000 }, async () => {
  const desktop = await launchDesktop()
  const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
  try {
    for (const mode of ['auto', 'cpu', 'gpu', 'custom', 'fast']) {
      const saved = await invoke('hd:save-config', { highres: { mode } })
      assert.equal(saved.success, true, `${mode}: ${saved.message}`)
      assert.equal(saved.data.highres.mode, mode)
      const result = await invoke('hd:run-highres', { mode, pythonHome: '' })
      assert.equal(result.success, false)
      assert.match(result.message, /Python/, '未配置环境应正常拒绝，不能把合法模式当成错误参数')
    }
    for (const mode of ['unknown', '', {}, 1]) {
      assert.equal((await invoke('hd:save-config', { highres: { mode } })).success, false)
      assert.match((await invoke('hd:run-highres', { mode })).message, /参数/)
    }
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
