/** 网页宿主销毁回归：仅本地HTTP、真实预览窗口与原IPC，不修改后台保护。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 等待宿主销毁后原生网页资源归零。
 * 处理流程：
 * 1、轮询存活webContents，不主动代替生产代码释放。
 */
async function released(application) {
  // 1、原生资源归零不等同生产Map、计时器或内存长稳验收。
  let live
  for (let i = 0; i < 200; i++) {
    live = await application.evaluate(({ webContents }) => webContents.getAllWebContents().filter(item => item.getType() === 'browserView').map(item => ({ id: item.id, url: item.getURL() })))
    if (live.length === 0) return live
    await delay(25)
  }
  assert.deepEqual(live, [], '宿主销毁后必须释放所属内嵌网页')
}

for (const pending of [false, true]) {
  test(`网页宿主销毁：${pending ? '加载中' : '已加载'}视图释放并可重新创建`, { timeout: 90000 }, async () => {
    // 1、仅在测试HTTP收到请求后销毁窗口，不猜测加载开始时间。
    let arrived
    let reply
    let hold = pending
    const server = createServer((_request, response) => {
      if (hold) { reply = response; arrived() }
      else { response.writeHead(200, { 'Content-Type': 'text/html' }); response.end('<!doctype html><title>host</title>') }
    })
    server.listen(0, 'localhost')
    await once(server, 'listening')
    let desktop
    const evidence = { pending, passed: false, rounds: [] }
    try {
      desktop = await launchDesktop()
      console.log(`网页宿主销毁证据：${desktop.root}`)
      for (let round = 0; round < 5; round++) {
        const opened = desktop.application.waitForEvent('window')
        assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))).success, true)
        const other = await opened
        await other.waitForFunction(() => typeof window.electronAPI?.invoke === 'function')
        const input = { url: `http://localhost:${server.address().port}/host-${round}`, partition: 'persist:regression-host-destroy' }
        hold = pending
        const requested = new Promise(resolve => { arrived = resolve })
        await other.evaluate(input => { window.__hostOpen = window.electronAPI.invoke('browserview:open', input).catch(() => null) }, input)
        if (pending) await requested
        else assert.deepEqual(await other.evaluate(() => window.__hostOpen), { success: true })
        // 2、销毁真实宿主，不调用browserview:close或手动销毁内嵌网页。
        const closed = other.waitForEvent('close')
        await desktop.application.evaluate(({ BrowserWindow }) => {
          const host = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('canvas-preview'))
          if (!host) throw new Error('未找到真实预览宿主')
          host.destroy()
        })
        await closed
        reply?.end('<!doctype html><title>late</title>')
        const resources = await released(desktop.application)
        // 3、存活主窗口仍能以相同地址创建并正常关闭。
        hold = false
        assert.deepEqual(await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:open', input), input), { success: true })
        assert.deepEqual(await desktop.page.evaluate(input => window.electronAPI.invoke('browserview:close', input), input), { success: true })
        await released(desktop.application)
        evidence.rounds.push({ round, resources })
      }
      assert.deepEqual(desktop.errors, [])
      evidence.passed = true
    } catch (error) { evidence.failure = error.message; throw error }
    finally {
      // 4、继续执行未修改的后台保护与隔离退出检查。
      reply?.end()
      try { if (desktop) await desktop.close() } finally {
        server.closeAllConnections()
        await new Promise(resolve => server.close(resolve))
        if (desktop) await writeFile(path.join(desktop.root, 'browser-host-destroy-result.json'), JSON.stringify(evidence, null, 2))
      }
    }
  })
}
