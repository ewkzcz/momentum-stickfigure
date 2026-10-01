import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { PREVIEW_APPLICATION_URL } from '../src/main/application-protocol.js'
import { launchDesktop } from './helpers/desktop.mjs'
import { stableCanvas, assertSamePixels } from './helpers/images.mjs'
import { closePreviewByButton } from './helpers/preview-close.mjs'

/** 只在原生loadURL入口控制页面加载交付；实际预览脚本、桥接及绘制保持原实现。 */
async function pausePreviewLoad(application) {
  await application.evaluate(({ app }, expectedURL) => {
    const state = globalThis.__previewLoading = { entered: false }
    state.enteredPromise = new Promise(resolve => { state.onEntered = resolve })
    app.once('browser-window-created', (_event, window) => {
      const loadURL = window.loadURL.bind(window)
      window.loadURL = (...args) => {
        if (args[0] !== expectedURL) throw new Error(`预览入口不匹配：${args[0]}`)
        state.entered = true
        state.url = args[0]
        state.target = window
        state.onEntered()
        return new Promise((resolve, reject) => {
          state.release = () => loadURL(...args).then(resolve, reject)
        })
      }
    })
  }, PREVIEW_APPLICATION_URL)
}

test('预览页面加载等待期间复用：只保留最新图片并在真实订阅后绘制', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`预览就绪竞态证据：${desktop.root}`)
  try {
    await pausePreviewLoad(desktop.application)
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => {
      globalThis.__openingPreview = window.electronAPI.invoke('canvas-preview-create')
    })
    await desktop.application.evaluate(() => globalThis.__previewLoading.enteredPromise)
    assert.equal(await desktop.application.evaluate(() => globalThis.__previewLoading.entered), true)
    assert.equal(await desktop.application.evaluate(() => globalThis.__previewLoading.url), PREVIEW_APPLICATION_URL)
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), { success: true, existed: true })
    const image = createCanvas(32, 32), ctx = image.getContext('2d')
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 32, 32)
    assert.equal((await desktop.page.evaluate(data => window.electronAPI.invoke('canvas-preview-update', data), image.toDataURL())).success, true)
    ctx.clearRect(0, 0, 32, 32); ctx.fillStyle = '#336699'; ctx.fillRect(3, 5, 21, 19)
    const expected = image.toBuffer('image/png')
    assert.equal((await desktop.page.evaluate(data => window.electronAPI.invoke('canvas-preview-update', data), image.toDataURL())).success, true)
    const unauthorized = await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-ready'))
    assert.equal(unauthorized.success, false, '主窗口不能代替预览声明监听就绪')
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-update-filename', 'latest.png'))).success, true)
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-sync-theme', 'light'))).success, true)
    await desktop.application.evaluate(() => globalThis.__previewLoading.release())
    await desktop.page.evaluate(() => globalThis.__openingPreview)
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    assert.equal(preview.url(), PREVIEW_APPLICATION_URL)
    const actual = await stableCanvas(preview, '.canvas-wrapper canvas')
    await assertSamePixels(Buffer.from(actual.png, 'base64'), expected, '订阅后收到加载期间最新图片')
    await preview.locator('.canvas-preview-page.theme-light').waitFor()
    await closePreviewByButton(desktop.application, preview)
    // 新原生窗口不能收到前一窗口保存的图片或主题。
    const nextOpening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const nextPreview = await nextOpening
    await nextPreview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    assert.equal((await nextPreview.evaluate(() => window.electronAPI.invoke('canvas-preview-ready'))).success, true)
    await nextPreview.evaluate(() => new Promise(requestAnimationFrame))
    assert.equal(await nextPreview.locator('.canvas-wrapper').isVisible(), false)
    await closePreviewByButton(desktop.application, nextPreview)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
