import test from 'node:test'
import assert from 'node:assert/strict'
import { controllerFixture } from './helpers/browser-controller-fixture.mjs'

for (const end of ['close', 'replace', 'host', 'view', 'failure', 'unregister']) {
  test(`网页记录清理：${end}释放索引和resize降级监听`, async () => {
    const f = await controllerFixture()
    const foreign = () => {}
    f.host.on('resize', foreign)
    if (end === 'failure') f.load = async () => { throw new Error('controlled load failure') }
    const opened = await f.invoke('open')
    if (end === 'failure') assert.equal(opened.success, false)
    else {
      assert.equal(opened.success, true)
      assert.equal(f.records.size, 1)
      assert.equal(f.host.listenerCount('resize'), 2)
      if (end === 'close') { await f.invoke('close'); await f.invoke('close') }
      if (end === 'replace') {
        await f.invoke('open')
        assert.equal(f.records.size, 1)
        assert.equal(f.host.listenerCount('resize'), 2)
        await f.invoke('close')
      }
      if (end === 'host') f.host.destroy()
      if (end === 'view') f.views[0].webContents.close()
      if (end === 'unregister') f.controller.unregisterBrowserViewHandlers()
    }
    assert.equal(f.records.size, 0)
    assert.deepEqual(f.host.listeners('resize'), [foreign])
    assert.equal(f.host.listenerCount('closed'), 0)
  })
}

test('网页记录清理：旧在途请求失败不得删除同键新记录', async () => {
  const f = await controllerFixture()
  let release
  f.load = () => new Promise(resolve => { release = resolve })
  const old = f.invoke('open')
  f.load = null
  assert.equal((await f.invoke('open')).success, true)
  release()
  assert.equal((await old).success, false)
  assert.equal(f.records.size, 1)
  assert.equal(f.host.listenerCount('resize'), 1)
  assert.equal((await f.invoke('setBounds')).success, true)
  await f.invoke('close')
  assert.equal(f.records.size, 0)
  assert.equal(f.host.listenerCount('resize'), 0)
})
