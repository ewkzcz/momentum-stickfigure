/** 画布输出回归：真实公开菜单、独立窗口及目标页面图片逐像素对照，不调用图像处理服务。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** 等待生产过渡及图像解码完成，采样用户真实主画布。 */
async function mainImage(page) {
  await page.waitForFunction(() => document.querySelector('.render-canvas')?.style.opacity === '1' && !document.querySelector('.canvas-container.rendering-template'))
  return Buffer.from((await stableCanvas(page)).png, 'base64')
}

/** 从目标页面已经显示并解码的真实图片元素提取全部像素。 */
async function receivedImage(page, selector) {
  const image = page.locator(selector).first()
  await image.waitFor({ state: 'visible' })
  return image.evaluate(async image => {
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth
    canvas.height = image.naturalHeight
    canvas.getContext('2d').drawImage(image, 0, 0)
    return { src: image.currentSrc, alt: image.alt, png: canvas.toDataURL('image/png').split(',')[1] }
  })
}

test('画布输出：两条菜单接收路径真实显示输入，独立预览连续开关十次 RGBA 一致', { timeout: 180000 }, async () => {
  // 1、只读原有自制 PSD 和参考，桌面环境由原辅助完整隔离。
  const fixture = (await syntheticFixtures())[0]
  const references = await referenceDigest()
  // macOS 的 /var 是 /private/var 别名；规范隔离根目录，原有相对写入仍被同一边界保护。
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'momentum-output-')))
  const desktop = await launchDesktop(root)
  const { page, application } = desktop
  const evidence = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), desktopId: path.basename(desktop.root), fixture: { id: fixture.id, sha256: fixture.sha256 }, startedAt: new Date().toISOString(), events: [], scenes: [], passed: false }
  let stage = 'upload'
  console.log(`画布输出证据：${desktop.root}`)
  application.on('window', window => {
    window.on('console', message => evidence.events.push({ at: new Date().toISOString(), stage, type: message.type(), text: message.text() }))
    window.on('close', () => evidence.events.push({ at: new Date().toISOString(), stage, type: 'window-close' }))
  })
  page.on('console', message => evidence.events.push({ at: new Date().toISOString(), stage, type: message.type(), text: message.text() }))
  /** 记录实际输出图像及零容差 RGBA；不新增或重录永久参考。 */
  async function output(name, actual, expected, metadata = {}) {
    await assertSamePixels(actual, expected, name)
    const decoded = await decodePng(actual)
    await writeFile(path.join(desktop.root, `${name}.png`), actual, { flag: 'wx' })
    evidence.scenes.push({ name, width: decoded.width, height: decoded.height, rgbaSha256: hash(decoded.rgba), differentPixels: 0, ...metadata })
  }
  try {
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    // 仅记录原始会话写入，不替换实际载荷、文件写入、路由及接收逻辑。
    await page.evaluate(() => {
      const setItem = window.Storage.prototype.setItem
      window.__canvasOutputTransfers = []
      window.Storage.prototype.setItem = function (key, value) {
        if (this === sessionStorage && ['pendingImageForJump', 'pendingImageForGenerate'].includes(key)) window.__canvasOutputTransfers.push({ key, value: JSON.parse(value) })
        return setItem.call(this, key, value)
      }
    })
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
    await assertSamePixels(await mainImage(page), await readFile(path.join(syntheticReferenceDirectory, fixture.id, 'initial.png')), '原有初始参考')

    // 2、先确认两种真实发送分支可用；只查看输入，不点击任何开始处理按钮。
    for (const [key, label, route, selector] of [
      ['removebg', '跳转到抠图', '/image-processing', '.image-processing-page .input-section .media-card img'],
      ['comic', '跳转到分格', '/comic', '.comic-page .character-container img.preview-image']
    ]) {
      stage = `jump-${key}`
      const before = await mainImage(page)
      await page.getByRole('button', { name: '跳转', exact: true }).click()
      // 真实鼠标离开按钮，等待悬浮提示收起，避免它遮挡点击式下拉菜单。
      await page.mouse.move(0, 0)
      await page.locator('.n-tooltip').filter({ hasText: '跳转到其他页面并传递图片' }).waitFor({ state: 'hidden' })
      await page.getByText(label, { exact: true }).click()
      await page.waitForURL(url => url.hash === `#${route}`)
      const received = await receivedImage(page, selector)
      const transfer = await page.evaluate(() => window.__canvasOutputTransfers.at(-1))
      assert.equal(transfer.key, 'pendingImageForJump')
      assert.equal(transfer.value.targetPage, key)
      assert.equal(transfer.value.source, 'action-expression-canvas')
      assert.equal(received.src, transfer.value.dataURL, '接收页面展示原始输入地址')
      assert.equal(await page.evaluate(() => sessionStorage.getItem('pendingImageForJump')), null, '目标页面真实消费会话缓存')
      assert.match(transfer.value.fileName, /^\d{14}.+\.png$/)
      assert.ok(transfer.value.timestamp > 0)
      const sentPath = path.resolve(desktop.root, transfer.value.filePath)
      assert.ok(sentPath.startsWith(desktop.root + path.sep), '发送文件只能位于隔离目录')
      await assertSamePixels(await readFile(sentPath), before, `${key} 实际发送临时文件`)
      await output(stage, Buffer.from(received.png, 'base64'), before, { key: transfer.key, targetPage: key, route, namePattern: transfer.value.fileName.replace(/^\d{14}/, '<timestamp>') })
      await page.screenshot({ path: path.join(desktop.root, `${stage}.png.screen.png`) })
      await page.evaluate(() => { location.hash = '/action-expression' })
      await page.getByRole('button', { name: '预览', exact: true }).waitFor()
      assert.equal(await page.getByRole('button', { name: '跳转', exact: true }).evaluate(button => button.classList.contains('n-button--loading')), false)
      await assertSamePixels(await mainImage(page), before, `${key} 返回后主画布`)
    }

    // 3、十次都由真实预览按钮新建窗口，等待可见画布完成绘制后比较，再由关闭按钮退出。
    for (let index = 0; index < 10; index++) {
      stage = `preview-${index + 1}`
      const before = await mainImage(page)
      const opening = application.waitForEvent('window')
      await page.getByRole('button', { name: '预览', exact: true }).click()
      const preview = await opening
      await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
      await preview.locator('.canvas-wrapper').waitFor({ state: 'visible' })
      const result = await stableCanvas(preview, '.canvas-wrapper canvas')
      await output(stage, Buffer.from(result.png, 'base64'), before)
      const closing = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '关闭', exact: true }).click()
      await closing
      await assertSamePixels(await mainImage(page), before, `${stage} 关闭后主画布`)
    }
    assert.deepEqual(desktop.errors, [])
    const safety = await application.evaluate(() => ({ violations: globalThis.__momentumTest.violations, external: globalThis.__momentumTest.external }))
    assert.deepEqual(safety, { violations: [], external: [] }, '未启动外部进程、Python、网络或外部链接')
    evidence.safety = safety
    if (process.env.MOMENTUM_CANVAS_OUTPUT_BEFORE) {
      const beforeRoot = process.env.MOMENTUM_CANVAS_OUTPUT_BEFORE
      const before = JSON.parse(await readFile(path.join(beforeRoot, 'canvas-output-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(evidence.fixture, before.fixture)
      assert.deepEqual(evidence.scenes, before.scenes, '迁移前后十二个实际输出及跨页协议一致')
      for (const scene of evidence.scenes) await assertSamePixels(await readFile(path.join(desktop.root, `${scene.name}.png`)), await readFile(path.join(beforeRoot, `${scene.name}.png`)), scene.name)
      evidence.beforeDesktopId = path.basename(beforeRoot)
      evidence.beforeAfterDifferentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { at: new Date().toISOString(), stage, name: error.name, message: error.message }
    for (const [index, window] of application.windows().entries()) await window.screenshot({ path: path.join(desktop.root, `canvas-output-failure-${index}.png`) }).catch(() => {})
    throw error
  } finally {
    evidence.finishedAt = new Date().toISOString()
    try { await desktop.close() } catch (error) {
      evidence.cleanupFailure = { at: new Date().toISOString(), name: error.name, message: error.message }
      evidence.passed = false
      throw error
    } finally {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      assert.deepEqual(await referenceDigest(), references, '全部264份新旧参考保持不变')
      evidence.referenceFiles = Object.keys(references).length
      evidence.referenceDigestSha256 = hash(JSON.stringify(references))
      await writeFile(path.join(desktop.root, 'canvas-output-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
