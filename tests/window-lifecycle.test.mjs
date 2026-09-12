/** 窗口生命周期回归：真实预览创建、复用、状态转发与关闭，保持原强制后台保护。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { stableCanvas, assertSamePixels } from './helpers/images.mjs'

/** 获取原生窗口列表；1、仅规范化随机窗口编号，保留真实资源路径和后台状态。 */
async function windows(application) {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
    id: window.id, url: window.webContents.getURL(), visible: window.isVisible(), focused: window.isFocused(),
    alwaysOnTop: window.isAlwaysOnTop(), focusable: window.isFocusable(), devTools: window.webContents.isDevToolsOpened()
  })))
}

test('窗口生命周期：十轮预览复用、主题和视图同步、关闭及主窗联动', { timeout: 180000 }, async () => {
  // 1、沿用真实隔离桌面；不修改globalShortcut假边界或原生窗口保护。
  const desktop = await launchDesktop()
  const { application, page, root } = desktop
  const evidence = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    mainSourceStatus: execFileSync('git', ['status', '--porcelain', '--', 'src/main'], { cwd: repository, encoding: 'utf8' }),
    environment: { platform: process.platform, architecture: process.arch, node: process.version },
    mainBundleSha256: createHash('sha256').update(await readFile(path.join(repository, 'out/main/index.js'))).digest('hex'),
    cycles: [], passed: false,
    limits: ['后台策略阻止show/focus/置顶，不等同原生显示验收', 'globalShortcut.register为原helper固定false，未验证系统快捷键触发']
  }
  let stage = 'start'
  console.log(`窗口生命周期证据：${root}`)
  try {
    const beforeRoot = process.env.MOMENTUM_WINDOW_BEFORE
    const before = beforeRoot ? JSON.parse(await readFile(path.join(beforeRoot, 'window-lifecycle-result.json'), 'utf8')) : null
    if (before) {
      assert.equal(before.passed, true)
      assert.equal(before.mainSourceStatus, '')
    }
    const canvas = createCanvas(64, 48)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#795ab6'
    ctx.fillRect(4, 7, 38, 28)
    const png = canvas.toBuffer('image/png')
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    const first = await windows(application)
    assert.equal(first.length, 1)
    const mainId = first[0].id
    let previousId
    for (let index = 0; index < 10; index++) {
      stage = `cycle-${index + 1}`
      const opening = application.waitForEvent('window')
      assert.deepEqual(await page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), { success: true, existed: false })
      const preview = await opening
      await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
      await preview.evaluate(() => new Promise(requestAnimationFrame))
      const opened = await windows(application)
      assert.equal(opened.length, 2)
      const created = opened.find(window => window.id !== mainId)
      assert.notEqual(created.id, previousId)
      previousId = created.id
      assert.ok(created.url.endsWith('/canvas-preview.html'))
      assert.deepEqual(await page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), { success: true, existed: true })
      assert.deepEqual((await windows(application)).map(window => window.id), opened.map(window => window.id))
      assert.deepEqual(await page.evaluate(payload => window.electronAPI.invoke('canvas-preview-update', payload), dataUrl), { success: true })
      await assertSamePixels(Buffer.from((await stableCanvas(preview, '.canvas-wrapper canvas')).png, 'base64'), png, stage)
      const initialZoom = await preview.locator('.zoom-info').textContent()
      await preview.getByTitle('放大', { exact: true }).click()
      await preview.waitForFunction(initial => document.querySelector('.zoom-info').textContent !== initial, initialZoom)
      assert.deepEqual(await page.evaluate(() => window.electronAPI.invoke('canvas-preview-reset-viewport')), { success: true })
      // 原业务将重置延后到下一次图像更新，不要求立即改变缩放。
      assert.deepEqual(await page.evaluate(payload => window.electronAPI.invoke('canvas-preview-update', payload), dataUrl), { success: true })
      await preview.waitForFunction(initial => document.querySelector('.zoom-info').textContent === initial, initialZoom)
      const theme = index % 2 ? 'light' : 'dark'
      assert.deepEqual(await page.evaluate(theme => window.electronAPI.invoke('canvas-preview-sync-theme', theme), theme), { success: true })
      await preview.locator(`.canvas-preview-page.theme-${theme}`).waitFor()
      // 2、文件名转发只核对IPC成功；该值没有公开展示，不读取组件私有状态冒充用户行为。
      assert.deepEqual(await page.evaluate(name => window.electronAPI.invoke('canvas-preview-update-filename', name), `测试-${index}.png`), { success: true })
      const closed = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '关闭', exact: true }).click()
      await closed
      assert.deepEqual((await windows(application)).map(window => window.id), [mainId])
      assert.deepEqual(await page.evaluate(() => window.electronAPI.invoke('canvas-preview-close')), { success: true })
      const missing = []
      for (const channel of ['canvas-preview-update', 'canvas-preview-update-filename', 'canvas-preview-sync-theme', 'canvas-preview-reset-viewport']) {
        const result = await page.evaluate(({ channel, dataUrl }) => window.electronAPI.invoke(channel, dataUrl), { channel, dataUrl })
        assert.deepEqual(result, { success: false, error: '预览窗口不存在' })
        missing.push({ channel, result })
      }
      evidence.cycles.push({ index, initialZoom, theme, missing, windowCountAfterClose: 1, pixelsEqual: true })
    }
    // 3、在最后一轮直接关闭真实主窗口，等待预览联动关闭。
    stage = 'main-close'
    const opening = application.waitForEvent('window')
    await page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const previewClosed = preview.waitForEvent('close')
    const mainClosed = page.waitForEvent('close')
    await application.evaluate(({ BrowserWindow }, id) => { BrowserWindow.fromId(id).close() }, mainId)
    await Promise.all([previewClosed, mainClosed])
    assert.equal((await windows(application)).length, 0)
    // macOS保留无窗口进程；其它平台由独立进程验收退出，不改变平台规则。
    if (process.platform === 'darwin') {
      const reopened = application.waitForEvent('window')
      await application.evaluate(({ app }) => { app.emit('activate') })
      const next = await reopened
      await next.waitForFunction(() => document.querySelector('#app')?.children.length > 0)
      assert.equal((await windows(application)).length, 1)
      evidence.macActivateRecreated = true
    }
    assert.deepEqual(desktop.errors, [])
    evidence.safety = await application.evaluate(() => ({ violations: globalThis.__momentumTest.violations, external: globalThis.__momentumTest.external }))
    assert.deepEqual(evidence.safety, { violations: [], external: [] })
    if (before) {
      assert.deepEqual(evidence.cycles, before.cycles)
      assert.equal(evidence.macActivateRecreated, before.macActivateRecreated)
      evidence.beforeDesktopId = path.basename(beforeRoot)
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { stage, message: error.message }
    throw error
  } finally {
    try { await desktop.close() } catch (error) {
      evidence.passed = false
      evidence.cleanupFailure = error.message
      throw error
    } finally {
      await writeFile(path.join(root, 'window-lifecycle-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
