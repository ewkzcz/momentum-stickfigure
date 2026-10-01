/** 网页宿主销毁回归：本地HTTP、真实主窗口及生产激活恢复，不修改后台保护。 */
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
        const other = desktop.page
        const input = { url: `http://localhost:${server.address().port}/host-${round}`, partition: 'persist:regression-host-destroy' }
        hold = pending
        const requested = new Promise(resolve => { arrived = resolve })
        await other.evaluate(input => { window.__hostOpen = window.electronAPI.invoke('browserview:open', input).catch(() => null) }, input)
        if (pending) {
          let timer
          try {
            await Promise.race([requested, other.evaluate(() => window.__hostOpen).then(result => {
              throw new Error(`请求抵达前网页打开已结算：${JSON.stringify(result)}`)
            }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('本地网页请求未抵达')), 10000) })])
          } finally { clearTimeout(timer) }
        }
        else assert.deepEqual(await other.evaluate(() => window.__hostOpen), { success: true })
        // 2、销毁真实宿主，不调用browserview:close或手动销毁内嵌网页。
        const closed = other.waitForEvent('close')
        await desktop.application.evaluate(({ BrowserWindow }) => {
          const host = BrowserWindow.getAllWindows().find(item => item.webContents.getURL().includes('/index.html'))
          if (!host) throw new Error('未找到真实主窗口宿主')
          host.destroy()
        })
        await closed
        reply?.end('<!doctype html><title>late</title>')
        const resources = await released(desktop.application)
        // 3、走生产activate入口重建合法主窗，不赋予预览窗口网页操作权限。
        const reopening = desktop.application.waitForEvent('window', {
          predicate: async page => {
            try {
              await page.waitForURL(url => url.protocol === 'momentum-app:' && url.pathname === '/index.html')
              return true
            } catch { return false }
          }
        })
        await desktop.application.evaluate(({ app }) => app.emit('activate'))
        desktop.page = await reopening
        await desktop.page.waitForFunction(() => document.querySelector('#app')?.children.length > 0)
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
