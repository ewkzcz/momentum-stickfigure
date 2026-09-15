import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { stableCanvas, observeImages, verifyFixture } from './helpers/images.mjs'

const summary = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

test('PSD页面资源趋势：二十轮真实双素材导入切换移除', { timeout: 300000 }, async () => {
  const inputs = await fixtures()
  for (const input of inputs) await verifyFixture(input.absolutePath, input.sha256)
  const desktop = await launchDesktop()
  const result = { cycles: [], passed: false }
  try {
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    const cdp = await desktop.page.context().newCDPSession(desktop.page)
    for (let round = 0; round < 20; round++) {
      const start = performance.now()
      await desktop.application.evaluate((_, paths) => { globalThis.__momentumTest.openPaths = paths }, inputs.map(input => input.absolutePath))
      await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
      for (const input of inputs) await desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(path.basename(input.absolutePath), { exact: true })).waitFor({ timeout: 60000 })
      await stableCanvas(desktop.page)
      const imported = performance.now()
      for (const input of inputs) {
        await desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(path.basename(input.absolutePath), { exact: true })).click()
        await stableCanvas(desktop.page)
      }
      const switched = performance.now()
      while (await desktop.page.locator('.psd-tab-close').count()) await desktop.page.locator('.psd-tab-close').first().click()
      await desktop.page.waitForFunction(() => !document.querySelector('.psd-tab-item'))
      await stableCanvas(desktop.page, '.render-canvas', false)
      const ended = performance.now()
      const heap = await cdp.send('Runtime.getHeapUsage')
      const dom = await cdp.send('Memory.getDOMCounters')
      const main = await desktop.application.evaluate(({ BrowserWindow }) => new Promise(resolve => setImmediate(() => resolve({ rss: process.memoryUsage().rss, windows: BrowserWindow.getAllWindows().length }))))
      result.cycles.push({ round: round + 1, importMs: imported - start, switchMs: switched - imported, closeMs: ended - switched, heap, dom, main })
      assert.equal(main.windows, 1)
    }
    // 正常周期读数不强制GC；末尾另作一次回收诊断，区分未回收堆与仍被引用对象。
    await cdp.send('HeapProfiler.collectGarbage')
    result.afterExplicitGc = { heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') }
    // 调试协议会保留console参数对象，单列清除后的诊断，不混作正常周期读数。
    await cdp.send('Runtime.discardConsoleEntries')
    await cdp.send('HeapProfiler.collectGarbage')
    result.afterConsoleRelease = { heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') }
    result.import = summary(result.cycles.map(cycle => cycle.importMs))
    result.switch = summary(result.cycles.map(cycle => cycle.switchMs))
    result.close = summary(result.cycles.map(cycle => cycle.closeMs))
    result.passed = true
    console.log(JSON.stringify({ import: result.import, switch: result.switch, close: result.close, first: result.cycles[0], last: result.cycles.at(-1), afterExplicitGc: result.afterExplicitGc, afterConsoleRelease: result.afterConsoleRelease }))
    await cdp.detach()
  } finally {
    await writeFile(path.join(repository, 'temp/psd-ui-resource-measurement-result.json'), JSON.stringify(result, null, 2))
    await desktop.close()
    for (const input of inputs) await verifyFixture(input.absolutePath, input.sha256)
  }
})
