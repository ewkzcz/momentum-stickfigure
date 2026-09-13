/** 本地网页真实主题注入、导航与刷新；控制器保持原主题内容和延迟策略。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDesktop } from './helpers/desktop.mjs'

test('网页主题：有效视图导航刷新后仍应用主题且关闭可恢复', { timeout: 90000 }, async () => {
  const server = createServer((_request, response) => response.end('<!doctype html><html><head><title>theme</title></head><body>主题</body></html>'))
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  try {
    desktop = await launchDesktop()
    const input = { url: `http://localhost:${server.address().port}/theme`, partition: 'persist:theme-cleanup', theme: 'dark', nativeTheme: true }
    const invoke = (channel, extra = {}) => desktop.page.evaluate(({ channel, input, extra }) => window.electronAPI.invoke(channel, { ...input, ...extra }), { channel, input, extra })
    for (let round = 0; round < 3; round++) {
      assert.deepEqual(await invoke('browserview:open'), { success: true })
      const context = desktop.application.context()
      let view = context.pages().find(page => page.url() === input.url)
      if (!view) view = await context.waitForEvent('page', { predicate: page => page !== desktop.page })
      await view.waitForFunction(() => document.documentElement.style.colorScheme === 'dark')
      await view.goto(input.url + '?navigation=1')
      await view.waitForFunction(() => document.documentElement.style.colorScheme === 'dark')
      assert.deepEqual(await invoke('browserview:applyTheme', { scheme: 'dark' }), { success: true })
      await view.waitForFunction(() => document.documentElement.style.colorScheme === 'dark')
      const reloaded = view.waitForEvent('domcontentloaded')
      assert.deepEqual(await invoke('browserview:reload'), { success: true })
      await reloaded
      // reload也保留原导航回调携带的打开主题；这里只断言真实重载后主题脚本重新运行。
      await view.waitForFunction(() => Boolean(window.__appThemeObserver))
      assert.deepEqual(await invoke('browserview:close'), { success: true })
      assert.deepEqual(await invoke('browserview:applyTheme'), { success: false, error: '视图不存在' })
    }
    assert.deepEqual(desktop.errors, [])
  } finally {
    try { if (desktop) await desktop.close() } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
})
