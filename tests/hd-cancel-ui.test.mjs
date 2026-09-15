/** 真实高清页面取消，受控服务不代表真实Python业务。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop } from './helpers/desktop.mjs'

test('高清页面：抠图与高清均可取消并恢复下一任务', { timeout: 90000 }, async () => {
  const desktop = await launchDesktop(undefined, 'software-layout')
  try {
    await desktop.application.evaluate(({ ipcMain }, root) => {
      const state = globalThis.__hdCancel = { calls: [], release: null }
      for (const channel of ['hd:get-initial-data', 'hd:run-removebg', 'hd:run-highres', 'hd:cancel']) ipcMain.removeHandler(channel)
      ipcMain.handle('hd:get-initial-data', () => ({ success: true, data: {
        config: { pythonHome: `${root}/fake-python`, outputDir: root, removebgWeightsDir: root, highresWeightsDir: root, removebg: { modelId: 'u2net' }, highres: { modelId: 'real-esrgan' } },
        removebgModels: [{ id: 'u2net', name: 'u2net' }], highresModels: [{ id: 'real-esrgan', name: 'real-esrgan' }]
      } }))
      for (const channel of ['hd:run-removebg', 'hd:run-highres']) ipcMain.handle(channel, async () => {
        state.calls.push(channel)
        await new Promise(resolve => { state.release = resolve })
        return { success: false, message: '任务已取消' }
      })
      ipcMain.handle('hd:cancel', () => {
        if (!state.release) throw new Error('无在途任务')
        state.calls.push('hd:cancel'); state.release(); state.release = null
        return { success: true, cancelled: 1 }
      })
    }, desktop.root)
    await desktop.page.evaluate(() => { location.hash = '/image-processing' })
    const panel = desktop.page.locator('.image-processing-page')
    await panel.waitFor()
    const image = path.join(desktop.root, '取消图片.png')
    await writeFile(image, createCanvas(16, 16).toBuffer('image/png'))
    await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, image)
    await panel.getByRole('button', { name: '上传图片', exact: true }).click()
    await panel.locator('.input-section .media-card').waitFor()
    for (const label of ['开始抠图', '开始高清']) {
      await panel.getByRole('button', { name: label, exact: true }).click()
      const cancel = panel.getByRole('button', { name: '取消本地处理', exact: true })
      await cancel.click()
      await cancel.waitFor({ state: 'hidden' })
      await desktop.page.waitForFunction(() => [...document.querySelectorAll('.mode-button')].every(button => !button.disabled))
    }
    assert.deepEqual(await desktop.application.evaluate(() => globalThis.__hdCancel.calls), ['hd:run-removebg', 'hd:cancel', 'hd:run-highres', 'hd:cancel'])
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
