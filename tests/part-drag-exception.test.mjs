/** 部件拖拽异常回归：真实缩略图事件，验证编码失败与IPC拒绝后提示及恢复。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { stableCanvas, verifyFixture, assertSamePixels } from './helpers/images.mjs'

for (const failure of ['ipc', 'encode']) {
  test(`部件拖拽异常${failure}：20轮提示原错误且恢复正常拖拽，画布不变`, { timeout: 120000 }, async () => {
    // 1、导入公开PSD，通过真实标签找到有缩略图的普通部件。
    const fixture = (await syntheticFixtures())[0]
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    const desktop = await launchDesktop()
    const result = { failure, passed: false, rounds: [] }
    console.log(`部件拖拽异常证据：${desktop.root}`)
    try {
      const { page, application } = desktop
      await page.evaluate(() => { location.hash = '/action-expression' })
      await page.getByRole('button', { name: '上传', exact: true }).waitFor()
      await application.evaluate((_electron, file) => { globalThis.__momentumTest.openPaths = [file] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
      await stableCanvas(page)
      const tabs = page.locator('.part-tab')
      let found = false
      for (let i = 0; i < await tabs.count(); i++) {
        await tabs.nth(i).click()
        if (await page.locator('.parts-virtual-items img[draggable="true"]').count()) { found = true; break }
      }
      assert.equal(found, true, '公开夹具必须具有实际缩略图拖拽入口')
      const image = page.locator('.parts-virtual-items img[draggable="true"]').first()
      await image.evaluate(img => img.decode())
      const before = Buffer.from((await stableCanvas(page)).png, 'base64')
      // 2、仅控制故障边界；正常时调用原IPC和原图片编码，不模拟renderer处理器。
      await application.evaluate(({ ipcMain }) => {
        const state = globalThis.__partDragProbe = { calls: 0, fail: false, original: ipcMain._invokeHandlers.get('create-temp-file-and-start-drag') }
        ipcMain.removeHandler('create-temp-file-and-start-drag')
        ipcMain.handle('create-temp-file-and-start-drag', (...args) => {
          state.calls++
          if (state.fail) throw new Error('regression-part-drag-rejected')
          return state.original(...args)
        })
      })
      await page.evaluate(() => {
        const state = window.__partEncodeProbe = { original: window.HTMLCanvasElement.prototype.toBlob, fail: false, calls: 0 }
        window.HTMLCanvasElement.prototype.toBlob = function (...args) {
          if (state.fail) { state.calls++; args[0](null); return }
          return state.original.apply(this, args)
        }
      })
      const expected = failure === 'ipc' ? /拖拽失败：.*regression-part-drag-rejected/ : /拖拽失败：无法创建Blob对象/
      for (let round = 0; round < 20; round++) {
        await application.evaluate((_electron, fail) => { globalThis.__partDragProbe.fail = fail }, failure === 'ipc')
        await page.evaluate(fail => { window.__partEncodeProbe.fail = fail }, failure === 'encode')
        const messageCount = await page.getByText(expected).count()
        const dragsBefore = await application.evaluate(() => globalThis.__momentumTest.drags.length)
        await image.dispatchEvent('dragstart', { bubbles: true, cancelable: true })
        await page.waitForFunction(({ source, count }) => [...document.querySelectorAll('.n-message__content')].filter(node => new RegExp(source).test(node.textContent)).length > count, { source: expected.source, count: messageCount })
        assert.equal(await application.evaluate(() => globalThis.__momentumTest.drags.length), dragsBefore)
        // 3、恢复真实边界后再拖拽，必须实际落盘并进入原helper的系统拖拽记录。
        await application.evaluate(() => { globalThis.__partDragProbe.fail = false })
        await page.evaluate(() => { window.__partEncodeProbe.fail = false })
        await image.dispatchEvent('dragstart', { bubbles: true, cancelable: true })
        await application.evaluate(async (_electron, before) => {
          for (let i = 0; i < 500 && globalThis.__momentumTest.drags.length === before; i++) await new Promise(resolve => setTimeout(resolve, 10))
          if (globalThis.__momentumTest.drags.length !== before + 1) throw new Error('正常拖拽未恢复')
        }, dragsBefore)
        await image.dispatchEvent('dragend')
        result.rounds.push({ round, recovered: true })
      }
      const after = Buffer.from((await stableCanvas(page)).png, 'base64')
      await assertSamePixels(after, before, '失败与恢复拖拽不得改变当前画布RGBA')
      assert.deepEqual(desktop.errors, [])
      assert.deepEqual(desktop.logs.filter(line => /base64 is not defined|iconPayload is not defined/.test(line)), [])
      result.passed = true
    } catch (error) { result.failureMessage = error.message; throw error }
    finally {
      // 4、还原两个故障边界，继续执行未修改的后台和隔离退出检查。
      await desktop.page.evaluate(() => { if (window.__partEncodeProbe) window.HTMLCanvasElement.prototype.toBlob = window.__partEncodeProbe.original })
      await desktop.application.evaluate(({ ipcMain }) => {
        if (!globalThis.__partDragProbe) return
        ipcMain.removeHandler('create-temp-file-and-start-drag')
        ipcMain.handle('create-temp-file-and-start-drag', globalThis.__partDragProbe.original)
      })
      try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'part-drag-exception-result.json'), JSON.stringify(result, null, 2)) }
    }
  })
}
