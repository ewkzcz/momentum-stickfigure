import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDesktop } from './helpers/desktop.mjs'

test('网页会话：同分区名称的不同来源隔离，危险权限拒绝', { timeout: 60000 }, async () => {
  const servers = [createServer((req, res) => res.end('<!doctype html><title>site</title>')), createServer((req, res) => res.end('<!doctype html><title>site</title>'))]
  for (const server of servers) { server.listen(0, 'localhost'); await once(server, 'listening') }
  const desktop = await launchDesktop()
  try {
    const inputs = servers.map(server => ({ url: `http://localhost:${server.address().port}/site`, partition: 'persist:same-label' }))
    for (const input of inputs) assert.equal((await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:open', input), input)).success, true)
    const observed = await desktop.application.evaluate(({ webContents, session }, urls) => {
      const views = urls.map(url => webContents.getAllWebContents().find(contents => contents.getURL() === url))
      return { distinct: views[0].session !== views[1].session, separateMain: views.every(view => view.session !== session.defaultSession) }
    }, inputs.map(input => input.url))
    assert.deepEqual(observed, { distinct: true, separateMain: true })
    for (const input of inputs) {
      const page = desktop.application.context().pages().find(page => page.url() === input.url)
      assert.ok(page)
      const permission = await page.evaluate(async () => (await navigator.permissions.query({ name: 'geolocation' })).state)
      assert.equal(permission, 'denied')
    }
    for (const input of inputs) assert.equal((await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input)).success, true)
  } finally {
    await desktop.close()
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
})
