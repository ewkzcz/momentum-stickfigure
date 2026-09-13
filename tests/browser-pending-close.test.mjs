/** 内嵌网页在途关闭回归：本地HTTP控制真实loadURL完成时机，原后台helper保持不变。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 验证真实资源最终归零。
 * 处理流程：
 * 1、轮询原生挂载数和存活网页内容数，给异步销毁有界结算时间。
 */
async function expectReleased(application) {
  // 1、只观察公开资源，不手动删除生产记录或销毁测试对象。
  let actual
  for (let attempt = 0; attempt < 200; attempt++) {
    actual = await application.evaluate(({ BrowserWindow, webContents }) => ({ attached: BrowserWindow.getAllWindows()[0].getBrowserViews().length, live: webContents.getAllWebContents().filter(contents => contents.getType() === 'browserView').length }))
    if (actual.attached === 0 && actual.live === 0) return actual
    await delay(25)
  }
  assert.deepEqual(actual, { attached: 0, live: 0 }, 'close已成功后不得保留或重新挂载在途视图')
}

test('内嵌网页在途关闭：20轮终止加载且同地址重新打开关闭可恢复', { timeout: 120000 }, async () => {
  // 1、每轮在HTTP请求实际到达后关闭，避免用固定等待猜测loadURL状态。
  let reply
  let received
  let hold = true
  const server = createServer((_request, response) => {
    if (hold) { reply = response; received() }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>recovery</title>') }
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  const evidence = { passed: false, rounds: [], limits: ['仅本地HTTP真实在途关闭，不代表第三方登录', '不覆盖宿主销毁、跨窗口同键操作或beforeunload拒绝关闭'] }
  try {
    desktop = await launchDesktop()
    console.log(`网页在途关闭证据：${desktop.root}`)
    for (let round = 0; round < 20; round++) {
      hold = true
      const requested = new Promise(resolve => { received = resolve })
      const input = { url: `http://localhost:${server.address().port}/pending-${round}`, partition: 'persist:regression-pending-close' }
      await desktop.page.evaluate(input => { window.__pendingOpen = window.electronAPI.invoke('browserview:open', input) }, input)
      await requested
      const close = await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input)
      assert.deepEqual(close, { success: true })
      reply.end('<!doctype html><title>pending</title>')
      const open = await desktop.page.evaluate(() => window.__pendingOpen)
      assert.equal(open.success, false, '已取消的在途打开不能迟到返回成功')
      const resources = await expectReleased(desktop.application)
      // 2、使用同地址重新打开和关闭，确保旧catch不会清除新记录。
      hold = false
      const recovery = await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:open', input), input)
      assert.deepEqual(recovery, { success: true })
      assert.deepEqual(await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input), { success: true })
      await expectReleased(desktop.application)
      evidence.rounds.push({ round, close, open, resources, recovery })
    }
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) { evidence.failure = error.message; throw error }
  finally {
    // 3、无论测试成功与否，执行原隔离退出检查并关闭本地连接。
    reply?.end()
    try { if (desktop) await desktop.close() } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      if (desktop) await writeFile(path.join(desktop.root, 'browser-pending-close-result.json'), JSON.stringify(evidence, null, 2))
    }
  }
})
