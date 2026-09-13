import test from 'node:test'
import assert from 'node:assert/strict'
import { controllerFixture } from './helpers/browser-controller-fixture.mjs'
for (const action of ['close', 'replace', 'navigation', 'reload', 'host', 'view', 'unregister']) {
  test(`主题任务释放：${action}取消延迟任务且不改变后续主题`, async () => {
    const f = await controllerFixture()
    await f.invoke('open', { theme: 'dark', nativeTheme: true })
    if (action === 'navigation') f.views[0].webContents.emit('did-navigate')
    if (action === 'reload') await f.invoke('reload')
    if (action === 'replace') await f.invoke('open', { theme: 'light', nativeTheme: true })
    if (action === 'host') f.host.destroy()
    else if (action === 'view') f.views[0].webContents.close()
    else if (action === 'unregister') f.controller.unregisterBrowserViewHandlers()
    else await f.invoke('close')
    assert.equal(f.timers.size, 0)
    f.nativeTheme.themeSource = 'system'
    await f.flush()
    assert.equal(f.nativeTheme.themeSource, 'system')
    for (const view of f.views) assert.equal(view.webContents.listenerCount('did-navigate'), 0)
  })
}

test('主题任务：有效视图仍应用主题且跨窗口关闭互不取消', async () => {
  const f = await controllerFixture()
  const other = new f.Host()
  await f.invoke('open', { theme: 'dark', nativeTheme: true })
  await f.invoke('open', { theme: 'light', nativeTheme: true }, other)
  await f.invoke('close')
  assert.equal(f.timers.size, 3)
  await f.flush()
  assert.equal(f.nativeTheme.themeSource, 'light')
  assert.ok(f.views[1].webContents.scripts > 0)
  await f.invoke('close', {}, other)
  assert.equal(f.timers.size, 0)
})

test('主题任务：CSS等待期间关闭不得继续执行脚本', async () => {
  const f = await controllerFixture()
  let release
  f.cssWait = new Promise(resolve => { release = resolve })
  await f.invoke('open', { theme: 'dark', nativeTheme: true })
  assert.equal(f.views[0].webContents.css, 1)
  await f.invoke('close')
  release()
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(f.views[0].webContents.scripts, 0)
})
