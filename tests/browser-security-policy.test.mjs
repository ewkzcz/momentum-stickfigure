import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDesktop } from './helpers/desktop.mjs'

test('内嵌网页安全：实际启用webSecurity与沙箱，阻止文件导航和新窗口', { timeout: 60000 }, async () => {
  const server = createServer((req, res) => res.end('<!doctype html><title>safe</title><body>safe</body>'))
  server.listen(0, 'localhost'); await once(server, 'listening')
  const desktop = await launchDesktop()
  try {
    const input = { url: `http://localhost:${server.address().port}/safe`, partition: 'persist:security-fixture' }
    assert.equal((await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:open', input), input)).success, true)
    const prefs = await desktop.application.evaluate(({ webContents }, url) => {
      const view = webContents.getAllWebContents().find(item => item.getURL() === url)
      const prefs = view.getLastWebPreferences()
      return { sandbox: prefs.sandbox, webSecurity: prefs.webSecurity, nodeIntegration: prefs.nodeIntegration }
    }, input.url)
    assert.deepEqual(prefs, { sandbox: true, webSecurity: true, nodeIntegration: false })
    const page = desktop.application.context().pages().find(page => page.url() === input.url)
    assert.ok(page)
    assert.equal(await page.evaluate(() => window.open('https://example.com/') === null), true)
    const denied = await desktop.application.evaluate(({ webContents }, url) => {
      const view = webContents.getAllWebContents().find(item => item.getURL() === url)
      const event = { prevented: false, preventDefault() { this.prevented = true } }
      view.emit('will-navigate', event, 'file:///forbidden')
      return event.prevented
    }, input.url)
    assert.equal(denied, true)
    await Promise.all([
      page.waitForURL(input.url + '?normal=1'),
      page.evaluate(url => { location.href = url }, input.url + '?normal=1')
    ])
    assert.equal(await page.title(), 'safe')
    assert.equal((await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input)).success, true)
  } finally { await desktop.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
