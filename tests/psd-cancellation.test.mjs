/** PSD取消回归：真实页面和原解析处理器验证批量取消、历史以及缓存/卸载行为。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { copyFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { verifyFixture } from './helpers/images.mjs'

/**
 * 安装原解析调用前的受控等待。
 * 处理流程：
 * 1、保存原处理器，仅延迟指定请求，不伪造解析返回。
 * 2、取消时释放等待，让原解析实际完成，以验证页面拒绝迟到成功。
 */
async function installBoundary(desktop, delayedCall) {
  // 1、受控边界只验证界面取消与迟到结果，实际线程退出由独立队列测试覆盖。
  await desktop.application.evaluate(({ ipcMain }, delayedCall) => {
    const original = ipcMain._invokeHandlers.get('psd-parse-file')
    const cancel = ipcMain._invokeHandlers.get('psd-cancel-parse')
    if (!original || !cancel) throw new Error('生产PSD处理器缺失')
    const state = globalThis.__psdCancellationRegression = { count: 0, cancellations: 0, release: null, completed: false, delayedTask: null }
    ipcMain.removeHandler('psd-parse-file')
    ipcMain.handle('psd-parse-file', async (event, options) => {
      state.count++
      const delayed = state.count === delayedCall
      if (delayed) {
        state.delayedTask = options.taskId
        await new Promise(resolve => { state.release = resolve })
      }
      const response = await original(event, options)
      if (delayed) state.completed = true
      return response
    })
    ipcMain.removeHandler('psd-cancel-parse')
    ipcMain.handle('psd-cancel-parse', (event, id) => {
      state.cancellations++
      if (id === state.delayedTask) state.release?.()
      return cancel(event, id)
    })
  }, delayedCall)
}

/**
 * 等待主进程实际进入或完成受控边界。
 * 处理流程：
 * 1、以边界状态为准，超过五秒失败，不用历史写入推断IPC已到达。
 */
async function waitBoundary(desktop, key) {
  // 1、历史保存早于file.arrayBuffer，必须等待真正的主进程状态。
  await desktop.application.evaluate(async (_, key) => {
    for (let i = 0; i < 500 && !globalThis.__psdCancellationRegression[key]; i++) await new Promise(resolve => setTimeout(resolve, 10))
    if (!globalThis.__psdCancellationRegression[key]) throw new Error(`PSD受控边界未就绪: ${key}`)
  }, key)
}

/**
 * 用原生选择边界提交路径。
 * 处理流程：
 * 1、配置隔离对话框输入并点击真实上传按钮。
 */
async function upload(desktop, files) {
  // 1、保留原preload、文件读取、解析和页面状态处理。
  await desktop.application.evaluate((_, files) => { globalThis.__momentumTest.openPaths = files }, files)
  await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
}

for (const mode of ['batch', 'cached', 'unmounted']) {
  test(`PSD取消${mode}：保留成功与历史，缓存继续、卸载停止`, { timeout: 60000 }, async () => {
    const desktop = await launchDesktop()
    const evidence = { mode, passed: false, limits: ['仅在原解析处理器前受控等待，非此测试独立证明原生解析中途终止', '文件为公开夹具，使用未修改的后台隔离辅助'] }
    console.log(`PSD取消${mode}回归证据：${desktop.root}`)
    try {
      // 1、三个不同路径使用同一公开输入，验证路径历史和批次边界。
      const fixture = (await syntheticFixtures())[0]
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      const files = ['已成功.psd', '被取消.psd', '未开始.psd'].map(name => path.join(desktop.root, name))
      for (const file of files) await copyFile(fixture.absolutePath, file)
      await desktop.page.evaluate(() => { location.hash = '/action-expression' })
      await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
      await installBoundary(desktop, mode === 'batch' ? 2 : 1)
      await upload(desktop, mode === 'batch' ? files : [files[1]])
      await waitBoundary(desktop, 'release')
      if (mode === 'batch') {
        assert.equal(await desktop.page.locator('.psd-tab-name').count(), 1)
        await desktop.page.getByRole('button', { name: '取消解析', exact: true }).click()
      } else {
        await desktop.page.evaluate(destination => { location.hash = destination }, mode === 'cached' ? '/home' : '/login')
        await desktop.page.locator('.action-expression-panel').waitFor({ state: 'detached' })
        if (mode === 'cached') {
          assert.equal(await desktop.application.evaluate(() => globalThis.__psdCancellationRegression.cancellations), 0)
          await desktop.application.evaluate(() => globalThis.__psdCancellationRegression.release())
        }
      }
      // 2、让原解析完成后检查迟到成功不会重建已取消的会话。
      await waitBoundary(desktop, 'completed')
      if (mode !== 'batch') {
        await desktop.page.evaluate(() => { location.hash = '/action-expression' })
        await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
      }
      await desktop.page.getByRole('button', { name: '取消解析', exact: true }).waitFor({ state: 'hidden' })
      evidence.tabs = await desktop.page.locator('.psd-tab-name').evaluateAll(nodes => nodes.map(node => node.title))
      assert.deepEqual(evidence.tabs, mode === 'batch' ? ['已成功.psd'] : mode === 'cached' ? ['被取消.psd'] : [])
      evidence.state = await desktop.application.evaluate(() => ({ count: globalThis.__psdCancellationRegression.count, cancellations: globalThis.__psdCancellationRegression.cancellations }))
      assert.deepEqual(evidence.state, { count: mode === 'batch' ? 2 : 1, cancellations: mode === 'cached' ? 0 : 1 })
      evidence.history = await desktop.page.evaluate(() => localStorage.getItem('psd-file-history'))
      assert.ok(evidence.history.includes('被取消.psd'))
      assert.ok(!evidence.history.includes('未开始.psd'))
      if (mode === 'batch') {
        await upload(desktop, [files[1]])
        await desktop.page.waitForFunction(() => document.querySelectorAll('.psd-tab-item').length === 2)
        await desktop.page.getByRole('button', { name: '取消解析', exact: true }).waitFor({ state: 'hidden' })
      }
      assert.deepEqual(desktop.errors, [])
      evidence.passed = true
    } finally {
      // 3、失败也执行原隔离检查并留下证据。
      try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'psd-cancellation-result.json'), JSON.stringify(evidence, null, 2)) }
    }
  })
}
