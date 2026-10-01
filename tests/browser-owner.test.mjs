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

test('内嵌网页窗口隔离：预览拒绝越窗操作，主窗二十轮可用和释放', { timeout: 120000 }, async () => {
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
      // 2、预览没有网页控制角色；拒绝关闭和其它操作，主窗视图必须保留。
      assert.deepEqual(await invoke(other, 'browserview:close', input), { success: false, error: '未授权的网页操作来源' })
      for (const channel of ['browserview:setBounds', 'browserview:applyTheme', 'browserview:reload']) {
        assert.deepEqual(await invoke(other, channel, { ...input, bounds: { x: 0, y: 0, width: 100, height: 100 }, scheme: 'light' }), { success: false, error: '未授权的网页操作来源' })
      }
      assert.deepEqual(await counts(desktop.application), { main: 1, preview: 0 })
      // 3、相同分区和URL也不能绕过角色限制创建视图，拒绝后主窗仍可更新与释放。
      assert.deepEqual(await invoke(other, 'browserview:open', input), { success: false, error: '未授权的网页操作来源' })
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
