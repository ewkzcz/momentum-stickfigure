/** 模板悬浮回归：通过公开界面保存两类模板，真实鼠标验证浮层，逐像素对照实际落盘预览。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const selector = '.template-hover-preview > img[alt="template preview"]'
const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** 只读实际卡片和滚动区域，取得可见范围内两个真实鼠标位置。 */
async function points(page) {
  // 1、裁去滚动区域，避免移动实际落到其它元素。
  return page.locator('.template-card-body').evaluate(element => {
    const rect = element.getBoundingClientRect()
    const clip = element.closest('.parts-list').getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const left = Math.max(rect.left, clip.left, 0)
    const right = Math.min(rect.right, clip.right, viewportWidth)
    const top = Math.max(rect.top, clip.top, 0)
    const bottom = Math.min(rect.bottom, clip.bottom, viewportHeight)
    if (right - left < 12 || bottom - top < 12) throw new Error('卡片可见范围不足')
    return [{ x: Math.ceil(left + 4), y: Math.ceil(top + 4) }, { x: Math.floor(right - 4), y: Math.floor(bottom - 4) }]
  })
}

/** 等待真实图片完成，独立按自然尺寸核对浮层及窗口边界。 */
async function shown(page, point, expected) {
  // 1、读取实际传送到 body 的图片及布局，不调用组件方法或改写状态。
  await page.locator(selector).waitFor({ state: 'visible' })
  await page.waitForFunction(selector => {
    const img = document.querySelector(selector)
    return img?.complete && img.naturalWidth > 0
  }, selector)
  const actual = await page.locator(selector).evaluate(img => {
    const parent = img.parentElement
    return { src: img.src, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight,
      teleport: parent.parentElement === document.body, position: window.getComputedStyle(parent).position,
      pointerEvents: window.getComputedStyle(parent).pointerEvents,
      x: parseFloat(parent.style.left), y: parseFloat(parent.style.top),
      width: parseFloat(parent.style.width), height: parseFloat(parent.style.height),
      viewport: { width: window.innerWidth, height: window.innerHeight }, box: parent.getBoundingClientRect().toJSON() }
  })
  assert.equal(actual.teleport, true)
  assert.equal(actual.position, 'fixed')
  assert.equal(actual.pointerEvents, 'none')
  const decoded = await decodePng(expected)
  assert.equal(actual.naturalWidth, decoded.width)
  assert.equal(actual.naturalHeight, decoded.height)
  const scale = Math.min(1, Math.min(actual.viewport.width * 0.5, 800) / decoded.width, Math.min(actual.viewport.height * 0.7, 600) / decoded.height)
  const width = decoded.width * scale
  const height = decoded.height * scale
  const x = Math.max(8, point.x + 12 + width > actual.viewport.width - 8 ? point.x - width - 12 : point.x + 12)
  const y = Math.max(8, Math.min(point.y + 12, actual.viewport.height - height - 8))
  for (const [key, value] of Object.entries({ x, y, width, height })) assert.ok(Math.abs(actual[key] - value) < 0.02, `${key} 应保持原定位/缩放规则`)
  assert.ok(actual.box.left >= 8 && actual.box.top >= 8)
  assert.ok(actual.box.right <= actual.viewport.width && actual.box.bottom <= actual.viewport.height, '浮层必须保持在实际屏幕范围内')
  // 2、期望来自公开保存流程真实输出的文件，绝不从浮层自身生成期望。
  assert.match(actual.src, /^data:image\/(png|jpeg);base64,/)
  const bytes = Buffer.from(actual.src.split(',')[1], 'base64')
  await assertSamePixels(bytes, expected, '模板浮层与真实保存文件 RGBA')
  const { src: _src, ...state } = actual
  return { ...state, rgbaSha256: hash((await decodePng(bytes)).rgba) }
}

/** 等待离开或关闭后真实浮层卸载，并跨越原隐藏延迟确认没有再次显示。 */
async function hidden(page) {
  // 1、持续观察帧而非注入假定时器，不改变生产 100ms 延迟。
  await page.locator(selector).waitFor({ state: 'detached' })
  await page.evaluate(async selector => {
    const start = performance.now()
    while (performance.now() - start < 180) {
      await new Promise(requestAnimationFrame)
      if (document.querySelector(selector)) throw new Error('隐藏后浮层再次出现')
    }
  }, selector)
}

test('模板悬浮：动作和表情真实 enter/move/leave、尺寸边界、开关及落盘 RGBA', { timeout: 180000 }, async () => {
  // 1、使用现有确定性 synthetic 输入和只读原参考，启动隔离真实 Electron。
  const fixtures = await syntheticFixtures()
  const fixture = fixtures[0]
  const references = await referenceDigest()
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const evidence = { fixture: fixture.sha256, scenes: [], passed: false }
  console.log(`模板悬浮证据：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-name').getByText(path.basename(fixture.absolutePath, '.psd'), { exact: true }).waitFor()
    await assertSamePixels(Buffer.from((await stableCanvas(page)).png, 'base64'), await readFile(path.join(syntheticReferenceDirectory, fixture.id, 'initial.png')), 'synthetic 原画布参考')
    const expectedFiles = {}
    for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
      // 2、两种模板均从公开保存按钮创建，随后只读其真实预览文件。
      await page.getByTitle(`保存当前${label}配置为${label}模板`, { exact: true }).click()
      const key = `stickfigure-${type}-templates`
      await page.waitForFunction(key => {
        const output = JSON.parse(localStorage.getItem(key) || '{}')
        return output.templates?.length === 1 && output.image_file_paths?.length === 1
      }, key)
      const output = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)
      assert.ok(output.templates[0].config.length > 0)
      const file = output.image_file_paths.find(item => item.id === output.templates[0].id)
      const userData = await application.evaluate(({ app }) => app.getPath('userData'))
      expectedFiles[type] = await readFile(path.join(userData, file.file_path))
      await stableCanvas(page)
    }
    for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
      // 3、保留真实开关焦点，通过鼠标移动及键盘单独检验关闭 watcher。
      await page.locator('.part-tab').and(page.getByRole('button', { name: `${label}模板`, exact: true })).click()
      await page.locator('.template-card-body').waitFor()
      const checkbox = page.getByRole('checkbox', { name: '预览2', exact: true })
      await checkbox.setChecked(false)
      const [enter, move] = await points(page)
      await page.mouse.move(1, 1)
      await page.mouse.move(enter.x, enter.y)
      await hidden(page)
      await page.mouse.move(move.x, move.y)
      await hidden(page)
      await checkbox.setChecked(true)
      await checkbox.focus()
      await page.mouse.move(enter.x, enter.y)
      const entered = await shown(page, enter, expectedFiles[type])
      await page.mouse.move(move.x, move.y)
      const moved = await shown(page, move, expectedFiles[type])
      assert.notDeepEqual({ x: entered.x, y: entered.y }, { x: moved.x, y: moved.y }, '真实移动必须改变坐标')
      await page.keyboard.press('Space')
      assert.equal(await checkbox.isChecked(), false)
      await hidden(page)
      await checkbox.setChecked(true)
      await page.mouse.move(enter.x, enter.y)
      await shown(page, enter, expectedFiles[type])
      await page.mouse.move(1, 1)
      await hidden(page)
      evidence.scenes.push({ type, entered, moved, disabledEnter: true, disabledMove: true, disabledWhileHovering: true, reentered: true, left: true })
    }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    // 4、可选只读本次原版运行结果，要求同一测试迁移后所有可观察状态一致。
    if (process.env.MOMENTUM_TEMPLATE_HOVER_BEFORE) {
      const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_TEMPLATE_HOVER_BEFORE, 'template-hover-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.equal(evidence.fixture, before.fixture)
      assert.deepEqual(evidence.scenes, before.scenes)
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = error.message
    await page.screenshot({ path: path.join(desktop.root, 'template-hover-failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.close()
    for (const fixture of fixtures) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references, '所有已有参考保持原字节')
    await writeFile(path.join(desktop.root, 'template-hover-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
