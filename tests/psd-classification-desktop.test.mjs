/** 保留真实PSD解析与分类图片解码，仅暂停离屏Image的完成通知。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'

for (const mode of ['cancel', 'remove', 'unmount', 'cached']) {
  test(`真实桌面分类等待${mode}：迟到图片不恢复无效文件，缓存停用继续`, { timeout: 90000 }, async () => {
    const desktop = await launchDesktop(undefined, 'software-layout'), { page, application } = desktop
    const fixture = (await fixtures())[0], evidence = { mode, passed: false }
    console.log(`分类取消桌面证据：${desktop.root}`)
    try {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      await page.evaluate(() => { location.hash = '/action-expression' })
      await page.getByRole('button', { name: '上传', exact: true }).waitFor()
      await observeImages(page)
      await page.evaluate(() => {
        const Original = window.Image
        const state = window.__classificationImages = { paused: true, queue: [] }
        window.Image = class extends Original {
          constructor(...args) {
            super(...args)
            let handler = null
            Object.defineProperty(this, 'onload', { get: () => handler, set: value => { handler = value } })
            this.addEventListener('load', event => {
              const run = () => handler?.call(this, event)
              if (state.paused) state.queue.push(run); else run()
            })
          }
        }
      })
      await application.evaluate((_, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      await page.waitForFunction(() => window.__classificationImages.queue.length > 0)
      await page.getByRole('button', { name: '取消解析', exact: true }).waitFor()
      assert.equal(await page.locator('.psd-tab-name').count(), 1, '解析已完成且文件记录已创建，等待点属于分类阶段')
      if (mode === 'cancel') await page.getByRole('button', { name: '取消解析', exact: true }).click()
      if (mode === 'remove') await page.locator('.psd-tab-item').first().locator('.psd-tab-close').click()
      if (mode === 'unmount' || mode === 'cached') {
        await page.evaluate(destination => { location.hash = destination }, mode === 'unmount' ? '/login' : '/home')
        await page.locator('.action-expression-panel').waitFor({ state: 'detached' })
      }
      await page.evaluate(() => { const s = window.__classificationImages; s.paused = false; for (const run of s.queue.splice(0)) run() })
      if (mode === 'unmount' || mode === 'cached') {
        await page.evaluate(() => { location.hash = '/action-expression' })
        await page.getByRole('button', { name: '上传', exact: true }).waitFor()
      }
      await page.getByRole('button', { name: '取消解析', exact: true }).waitFor({ state: 'hidden' })
      await page.waitForFunction(expected => document.querySelectorAll('.psd-tab-name').length === expected, mode === 'cached' ? 1 : 0)
      evidence.tabs = await page.locator('.psd-tab-name').count()
      if (mode === 'cached') await stableCanvas(page)
      else {
        await application.evaluate((_, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
        await page.getByRole('button', { name: '上传', exact: true }).click()
        await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
        await stableCanvas(page)
      }
      assert.deepEqual(desktop.errors, [])
      evidence.passed = true
    } finally {
      await desktop.close()
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      await writeFile(path.join(desktop.root, 'classification-continuation.json'), JSON.stringify(evidence, null, 2))
    }
  })
}
