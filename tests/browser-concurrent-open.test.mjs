/** 内嵌网页并发回归：本地HTTP保持首请求未完成，让后请求替换真实视图。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 等待原生视图资源达到预期。
 * 处理流程：
 * 1、只读挂载与存活数，最多等待五秒。
 */
async function expectCounts(application, count) {
  // 1、观察真实Electron资源，不访问生产Map。
  let actual
  for (let attempt = 0; attempt < 200; attempt++) {
    actual = await application.evaluate(({ BrowserWindow, webContents }) => ({ attached: BrowserWindow.getAllWindows()[0].getBrowserViews().length, live: webContents.getAllWebContents().filter(item => item.getType() === 'browserView').length }))
    if (actual.attached === count && actual.live === count) return actual
    await delay(25)
  }
  assert.deepEqual(actual, { attached: count, live: count })
}

test('同键并发打开：旧请求失败不能清除后请求视图，20轮正常回收', { timeout: 120000 }, async () => {
  // 1、首请求实际到达后再发第二次打开，同一地址不以URL差异绕开键冲突。
  let hold = true
  let arrived
  let reply
  const server = createServer((_request, response) => {
    if (hold) { reply = response; arrived() }
    else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>replacement</title>') }
  })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  const evidence = { passed: false, rounds: [] }
  try {
    desktop = await launchDesktop()
    console.log(`网页同键并发证据：${desktop.root}`)
    for (let round = 0; round < 20; round++) {
      hold = true
      const requested = new Promise(resolve => { arrived = resolve })
      const input = { url: `http://localhost:${server.address().port}/replace-${round}`, partition: 'persist:regression-concurrent-view' }
      await desktop.page.evaluate(input => { window.__oldViewOpen = window.electronAPI.invoke('browserview:open', input) }, input)
      await requested
      hold = false
      const current = await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:open', input), input)
      assert.deepEqual(current, { success: true })
      reply.end('<!doctype html><title>late-old</title>')
      const old = await desktop.page.evaluate(() => window.__oldViewOpen)
      assert.equal(old.success, false)
      const retained = await expectCounts(desktop.application, 1)
      // 2、原IPC必须仍能找到后请求，旧catch不能删除新记录。
      assert.deepEqual(await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:setBounds', { ...input, bounds: { x: 0, y: 0, width: 200, height: 150 } }), input), { success: true })
      assert.deepEqual(await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input), { success: true })
      const released = await expectCounts(desktop.application, 0)
      evidence.rounds.push({ round, old, current, retained, released })
    }
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) { evidence.failure = error.message; throw error }
  finally {
    // 3、保留原后台和退出隔离检查。
    reply?.end()
    try { if (desktop) await desktop.close() } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      if (desktop) await writeFile(path.join(desktop.root, 'browser-concurrent-open-result.json'), JSON.stringify(evidence, null, 2))
    }
  }
})
