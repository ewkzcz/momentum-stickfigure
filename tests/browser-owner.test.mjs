/** 内嵌网页窗口隔离回归：真实主窗与预览窗经原IPC访问本地HTTP页面。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 调用窗口公开的网页接口。
 * 处理流程：
 * 1、使用原预加载invoke，不访问生产视图Map。
 */
async function invoke(page, channel, input) {
  // 1、所有sender由真实Electron IPC生成。
  return page.evaluate(({ channel, input }) => window.electronAPI.invoke(channel, input), { channel, input })
}

/**
 * 查询两个宿主实际挂载的视图。
 * 处理流程：
 * 1、按真实页面URL区分主窗与预览窗并读取原生挂载数。
 */
async function counts(application) {
  // 1、只读取原生窗口资源，不干预销毁或登记。
  return application.evaluate(({ BrowserWindow }) => {
    const windows = BrowserWindow.getAllWindows()
    const main = windows.find(window => window.webContents.getURL().split('#')[0].endsWith('/index.html'))
    const preview = windows.find(window => window.webContents.getURL().includes('canvas-preview'))
    return { main: main.getBrowserViews().length, preview: preview.getBrowserViews().length }
  })
}

test('内嵌网页窗口隔离：拒绝越窗操作，同地址可独立共存和释放', { timeout: 120000 }, async () => {
  // 1、页面仅由本地服务器提供，不使用真实网站、账号或系统弹窗。
  const server = createServer((_request, reply) => { reply.writeHead(200, { 'Content-Type': 'text/html' }); reply.end('<!doctype html><title>owner</title>') })
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  const evidence = { passed: false, rounds: [] }
  try {
    desktop = await launchDesktop()
    console.log(`网页跨窗口边界证据：${desktop.root}`)
    const opened = desktop.application.waitForEvent('window')
    assert.equal((await invoke(desktop.page, 'canvas-preview-create')).success, true)
    const other = await opened
    await other.waitForFunction(() => typeof window.electronAPI?.invoke === 'function')
    for (let round = 0; round < 20; round++) {
      const input = { url: `http://localhost:${server.address().port}/owner-${round}`, partition: 'persist:regression-view-owner' }
      assert.deepEqual(await invoke(desktop.page, 'browserview:open', input), { success: true })
      // 2、没有自己记录时，预览窗关闭维持幂等；其他查询仍返回原来的视图不存在。
      assert.deepEqual(await invoke(other, 'browserview:close', input), { success: true })
      for (const channel of ['browserview:setBounds', 'browserview:applyTheme', 'browserview:reload']) {
        assert.deepEqual(await invoke(other, channel, { ...input, bounds: { x: 0, y: 0, width: 100, height: 100 }, scheme: 'light' }), { success: false, error: '视图不存在' })
      }
      assert.deepEqual(await counts(desktop.application), { main: 1, preview: 0 })
      // 3、相同分区和URL在两个窗口独立登记，关闭各自视图互不影响。
      assert.deepEqual(await invoke(other, 'browserview:open', input), { success: true })
      assert.deepEqual(await counts(desktop.application), { main: 1, preview: 1 })
      assert.deepEqual(await invoke(other, 'browserview:close', input), { success: true })
      assert.deepEqual(await counts(desktop.application), { main: 1, preview: 0 })
      assert.deepEqual(await invoke(desktop.page, 'browserview:setBounds', { ...input, bounds: { x: 0, y: 0, width: 200, height: 150 } }), { success: true })
      assert.deepEqual(await invoke(desktop.page, 'browserview:close', input), { success: true })
      const resources = await counts(desktop.application)
      assert.deepEqual(resources, { main: 0, preview: 0 })
      evidence.rounds.push({ round, resources })
    }
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    // 4、继续执行未修改的后台保护和写入隔离退出验收。
    try { if (desktop) await desktop.close() } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
      if (desktop) await writeFile(path.join(desktop.root, 'browser-owner-result.json'), JSON.stringify(evidence, null, 2))
    }
  }
})
