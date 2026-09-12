/** 内嵌网页资源回归：真实本地页面与Electron公开资源计数，关闭后必须实际销毁。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/** 查询主窗挂载和仍存活的网页内容；1、只使用Electron公开API。 */
async function resources(application) {
  return application.evaluate(({ BrowserWindow, webContents }) => {
    const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().split('#')[0].endsWith('/index.html'))
    return { attached: main.getBrowserViews().length, live: webContents.getAllWebContents().filter(wc => wc.getType() === 'browserView').length }
  })
}

/** 等待异步销毁完成；1、以真实资源数判断，不把成功响应或解除挂载当销毁。 */
async function expectResources(application, expected) {
  const deadline = Date.now() + 5000
  let actual
  do {
    actual = await resources(application)
    if (actual.attached === expected.attached && actual.live === expected.live) return actual
    await delay(25)
  } while (Date.now() < deadline)
  assert.deepEqual(actual, expected, '内嵌网页资源必须回到预期数量')
}

/** 经公开preload调用原控制器；1、不访问生产私有Map或手动清理资源。 */
async function invoke(page, channel, payload) {
  return page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
}

test('内嵌网页资源：20轮替换、分区共存和关闭后实际销毁', { timeout: 120000 }, async () => {
  // 1、先用不注册退出弹窗的本地页面隔离资源释放问题；退出拦截另列专项。
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><head><title>本地资源回归</title></head><body>中文网页</body></html>')
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  const result = { cycles: [], passed: false, limits: ['不验证真实第三方登录', '原helper强制后台保护和文件隔离不变', '只核验当前Electron版本和公开网页内容数，不声称全面内存无泄漏'] }
  try {
    desktop = await launchDesktop()
    const { application, page, root } = desktop
    console.log(`内嵌网页资源证据：${root}`)
    const baseline = await resources(application)
    assert.deepEqual(baseline, { attached: 0, live: 0 })
    const key = { url: `http://localhost:${server.address().port}/fixture`, partition: 'persist:regression-disposal' }
    const other = { ...key, partition: 'persist:regression-disposal-other' }
    for (let index = 0; index < 20; index++) {
      // 2、替换同键视图不得留下旧内容；独立分区关闭不影响另一视图。
      assert.deepEqual(await invoke(page, 'browserview:open', key), { success: true })
      await expectResources(application, { attached: 1, live: 1 })
      assert.deepEqual(await invoke(page, 'browserview:open', key), { success: true })
      await expectResources(application, { attached: 1, live: 1 })
      assert.deepEqual(await invoke(page, 'browserview:open', other), { success: true })
      await expectResources(application, { attached: 2, live: 2 })
      assert.deepEqual(await invoke(page, 'browserview:close', other), { success: true })
      await expectResources(application, { attached: 1, live: 1 })
      assert.deepEqual(await invoke(page, 'browserview:close', key), { success: true })
      assert.deepEqual(await invoke(page, 'browserview:close', key), { success: true })
      result.cycles.push({ index, resources: await expectResources(application, baseline) })
      assert.deepEqual(await invoke(page, 'browserview:reload', key), { success: false, error: '视图不存在' })
    }
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } catch (error) { result.failure = error.message; throw error }
  finally {
    try { if (desktop) await desktop.close() } catch (error) { result.passed = false; result.cleanupFailure = error.message; throw error }
    finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      if (desktop) await writeFile(path.join(desktop.root, 'browser-view-disposal-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
    }
  }
})
