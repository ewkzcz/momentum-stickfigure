/** 漫画图片激活与变换：公开 DOM 事件及工具栏，验证真实画布与落盘 PNG。
 * 隐藏窗口用 dispatchEvent 选择素材，避免 Playwright 鼠标点击触发 macOS 原生显示；不证明系统焦点行为。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop } from './helpers/desktop.mjs'
import { stableCanvas, decodePng } from './helpers/images.mjs'

test('漫画图片：背景/角色激活切换，变换、重置及整体导出保留素材像素', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const exit = []
  desktop.application.process().on('exit', (code, signal) => { exit.push({ code, signal }) })
  let originalError
  try {
    const { page, application, root } = desktop
    await page.evaluate(() => { location.hash = '/comic' })
    const section = page.locator('.comic-page .layer-section').first()
    await section.dispatchEvent('click')
    const input = page.locator('.comic-page input[type=file]')
    const toolbar = page.locator('.comic-page .canvas-toolbar')
    const source = createCanvas(80, 80)
    const ctx = source.getContext('2d')
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 40, 80)
    ctx.fillStyle = '#0000ff'; ctx.fillRect(40, 0, 40, 80)
    for (const button of ['设置背景', '添加角色']) {
      // 仅阻止系统文件选择窗口；真实按钮仍设置上传目标，文件通过原 input/change 流程导入。
      await input.evaluate(element => { element.click = () => {} })
      await section.getByRole('button', { name: button, exact: true }).dispatchEvent('click')
      await input.evaluate((element, payload) => {
        const bytes = Uint8Array.from(atob(payload.base64), character => character.charCodeAt(0))
        const transfer = new window.DataTransfer()
        transfer.items.add(new File([bytes], payload.name, { type: 'image/png' }))
        element.files = transfer.files
        element.dispatchEvent(new window.Event('change', { bubbles: true }))
      }, { name: `${button}.png`, base64: source.toBuffer('image/png').toString('base64') })
      await section.locator(button === '设置背景' ? '.background-container img' : '.character-container img').waitFor()
    }
    assert.equal(await input.count(), 1)
    await section.locator('.character-container').first().dispatchEvent('click')
    const controls = toolbar.locator('.image-controls input')
    await controls.first().waitFor()
    const before = await stableCanvas(page, '.comic-page canvas')
    await controls.first().fill('150')
    await controls.first().press('Tab')
    await controls.nth(1).fill('45')
    await controls.nth(1).press('Tab')
    assert.equal(await controls.first().inputValue(), '150')
    assert.equal(await controls.nth(1).inputValue(), '45')
    const changed = await stableCanvas(page, '.comic-page canvas')
    assert.notEqual(changed.png, before.png, '角色变换应影响真实画布')
    await section.locator('.background-container').dispatchEvent('click')
    assert.equal(await controls.first().inputValue(), '100', '激活背景应显示背景缩放')
    assert.equal(await controls.nth(1).inputValue(), '0')
    await section.locator('.character-container').first().dispatchEvent('click')
    assert.equal(await controls.first().inputValue(), '150', '重新激活角色保留其独立状态')
    assert.equal(await controls.nth(1).inputValue(), '45')
    await toolbar.locator('.image-controls').getByRole('button', { name: '重置', exact: true }).click()
    assert.equal(await controls.first().inputValue(), '100')
    assert.equal(await controls.nth(1).inputValue(), '0')
    assert.equal((await stableCanvas(page, '.comic-page canvas')).png, before.png, '重置恢复原画布')
    const directory = path.join(root, 'comic-images')
    await mkdir(directory)
    await application.evaluate((_, folder) => { globalThis.__momentumTest.openPaths = [folder] }, directory + path.sep)
    await toolbar.getByRole('button', { name: '导出整体', exact: true }).click()
    await page.getByText('整体视角导出成功', { exact: true }).waitFor()
    const files = (await readdir(directory)).filter(name => name.endsWith('.png'))
    assert.equal(files.length, 1)
    const exported = await decodePng(await readFile(path.join(directory, files[0])))
    assert.ok(exported.rgba.some((value, index, rgba) => index % 4 === 0 && value > 240 && rgba[index + 1] < 10 && rgba[index + 2] < 10 && rgba[index + 3] > 240), '实际导出有红色素材像素')
    assert.deepEqual(desktop.errors, [])
    console.log(`漫画图片交互证据：${root}`)
  } catch (error) {
    originalError = error
    throw error
  } finally {
    await writeFile(path.join(desktop.root, 'comic-interaction-diagnostic.json'), JSON.stringify({ error: originalError?.stack, exit, errors: desktop.errors, logs: desktop.logs }, null, 2))
    console.log(`漫画交互诊断：${desktop.root}`)
    try { await desktop.close() } catch (cleanupError) {
      if (!originalError) throw cleanupError
      console.error('清理错误：', cleanupError.message)
    }
  }
})
