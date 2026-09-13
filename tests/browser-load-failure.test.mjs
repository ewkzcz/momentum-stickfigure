/** 内嵌网页加载失败回归：本地HTTP主动断开连接，真实生产IPC和资源计数。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/** 查询实际存活资源；处理流程：1、取得主窗挂载数和全部BrowserView网页内容数。 */
async function resources(application) {
  return application.evaluate(({ BrowserWindow, webContents }) => {
    const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().split('#')[0].endsWith('/index.html'))
    return { attached: main.getBrowserViews().length, live: webContents.getAllWebContents().filter(wc => wc.getType() === 'browserView').length }
  })
}
/** 等待实际异步销毁；处理流程：1、轮询公开计数；2、有界失败且保留最后计数。 */
async function expectResources(application, expected) {
  const deadline = Date.now() + 5000
  let actual
  do {
    actual = await resources(application)
    if (actual.attached === expected.attached && actual.live === expected.live) return actual
    await delay(25)
  } while (Date.now() < deadline)
  assert.deepEqual(actual, expected, '打开失败后不得遗留挂载视图或网页内容')
}
/** 调用生产IPC；处理流程：1、只经原公开preload入口，不访问Map或手动销毁视图。 */
async function invoke(page, channel, payload) {
  return page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
}

test('内嵌网页加载失败：回收失败视图且下一次正常打开关闭仍可用', { timeout: 120000 }, async () => {
  // 1、启动仅本机可达的失败与恢复夹具，不请求真实第三方页面。
  let requests = 0
  const server = createServer((request, response) => {
    requests++
    if (request.url.startsWith('/broken')) request.socket.destroy()
    else { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); response.end('<!doctype html><title>隔离网页</title><p>加载恢复</p>') }
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  const evidence = { cycles: [], passed: false, limits: ['本地HTTP真实连接中断，不代表第三方登录或权限', '不验证并发打开、在途关闭、宿主销毁或beforeunload'] }
  try {
    desktop = await launchDesktop()
    console.log(`网页加载失败目录：${desktop.root}`)
    const baseline = await resources(desktop.application)
    assert.deepEqual(baseline, { attached: 0, live: 0 })
    const base = `http://localhost:${server.address().port}`
    // 2、每轮真实加载失败后确认资源释放，再验证普通打开与关闭可恢复。
    for (let cycle = 0; cycle < 20; cycle++) {
      const broken = { url: `${base}/broken-${cycle}`, partition: 'persist:regression-load-failure' }
      const response = await invoke(desktop.page, 'browserview:open', broken)
      assert.equal(response.success, false, '必须实际触发生产加载失败分支')
      assert.match(response.error, /ERR_EMPTY_RESPONSE|ERR_CONNECTION_RESET|ERR_CONNECTION_CLOSED|ERR_ABORTED/)
      const actual = await resources(desktop.application)
      evidence.cycles.push({ cycle, response, resourcesImmediatelyAfterFailure: actual })
      await expectResources(desktop.application, baseline)
      assert.deepEqual(await invoke(desktop.page, 'browserview:reload', broken), { success: false, error: '视图不存在' })
      const normal = { ...broken, url: `${base}/normal-${cycle}` }
      assert.deepEqual(await invoke(desktop.page, 'browserview:open', normal), { success: true })
      await expectResources(desktop.application, { attached: 1, live: 1 })
      assert.deepEqual(await invoke(desktop.page, 'browserview:close', normal), { success: true })
      await expectResources(desktop.application, baseline)
    }
    assert.ok(requests >= 40)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) { evidence.failure = error.message; throw error }
  finally {
    // 3、原桌面退出隔离断言与本地连接清理均执行，清理异常不能算通过。
    try { if (desktop) await desktop.close() } catch (error) { evidence.passed = false; evidence.cleanupFailure = error.message; throw error }
    finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      if (desktop) await writeFile(path.join(desktop.root, 'browser-load-failure-result.json'), JSON.stringify({ ...evidence, requests }, null, 2))
    }
  }
})
