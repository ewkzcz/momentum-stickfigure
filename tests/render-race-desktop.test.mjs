/** 真实桌面图片完成事件调度：保留原解码与绘制，只暂停业务 onload。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { stableCanvas, assertSamePixels, observeImages } from './helpers/images.mjs'

const png = async page => Buffer.from((await stableCanvas(page, '.render-canvas', false)).png, 'base64')

test('真实桌面连续选择与在途 PSD 切换保留最后有效画面', { timeout: 180000 }, async () => {
  const samples = (await fixtures()).slice(0, 2), desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  console.log(`渲染竞争桌面证据：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    for (const fixture of samples) {
      await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      await page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
      await stableCanvas(page)
    }
    const tabs = page.locator('.psd-tab-name')
    await tabs.nth(0).click()
    await stableCanvas(page)
    await page.locator('.part-tab').and(page.getByRole('button', { name: '左手', exact: true })).click()
    const parts = page.locator('.parts-virtual-items .part-item')
    assert.ok(await parts.count() >= 2)
    await parts.nth(0).click()
    await stableCanvas(page, '.render-canvas', false)
    await parts.nth(1).click()
    const expected = await png(page)
    await parts.nth(0).click()
    await stableCanvas(page, '.render-canvas', false)
    await page.evaluate(() => {
      const Original = window.Image
      const state = window.__renderRaceImages = { paused: true, queue: [], intercepted: 0 }
      window.Image = class extends Original {
        constructor(...args) {
          super(...args)
          let handler = null
          Object.defineProperty(this, 'onload', { configurable: true, get: () => handler, set: value => { handler = value } })
          this.addEventListener('load', event => {
            const run = () => handler?.call(this, event)
            if (state.paused) { state.intercepted++; state.queue.push(run) }
            else run()
          })
        }
      }
    })
    // 原生解码已经结束而业务 onload 仍被暂停时，旧帧稳定也不代表请求完成。
    await parts.nth(1).dispatchEvent('click')
    await page.waitForFunction(() => window.__renderRaceImages.queue.length > 0 && [...window.__regressionImages].every(image => image.complete))
    let sampled = false
    const waitingFrame = png(page).then(image => { sampled = true; return image })
    await page.evaluate(async () => { for (let frame = 0; frame < 24; frame++) await new Promise(requestAnimationFrame) })
    const sampledBeforeCommit = sampled
    await page.evaluate(() => { const s = window.__renderRaceImages; s.paused = false; for (const run of s.queue.splice(0)) run() })
    await waitingFrame
    assert.equal(sampledBeforeCommit, false, '解码完成但离屏合成未提交时不能采样旧帧')
    await assertSamePixels(await png(page), expected, '延迟提交后等待真实新帧')
    await parts.nth(0).click()
    await stableCanvas(page, '.render-canvas', false)
    await page.evaluate(() => { window.__renderRaceImages.paused = true })
    for (let index = 0; index < 30; index++) await parts.nth(index % 2).dispatchEvent('click')
    await page.waitForFunction(() => window.__renderRaceImages.intercepted > 0)
    await page.evaluate(() => { const s = window.__renderRaceImages; s.paused = false; for (const run of s.queue.splice(0).reverse()) run() })
    await assertSamePixels(await png(page), expected, '连续三十次选择最终帧')

    await tabs.nth(1).click()
    const secondPsd = await png(page)
    await tabs.nth(0).click()
    await stableCanvas(page)
    await page.locator('.part-tab').and(page.getByRole('button', { name: '左手', exact: true })).click()
    await page.evaluate(() => { window.__renderRaceImages.paused = true; window.__renderRaceImages.intercepted = 0 })
    await parts.nth(0).dispatchEvent('click')
    await page.waitForFunction(() => window.__renderRaceImages.intercepted > 0)
    await tabs.nth(1).click()
    await page.evaluate(() => { const s = window.__renderRaceImages; s.paused = false; for (const run of s.queue.splice(0).reverse()) run() })
    await assertSamePixels(await png(page), secondPsd, '在途切换PSD后旧帧不复活')
  } finally { await desktop.close() }
})
