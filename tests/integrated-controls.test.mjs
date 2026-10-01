/** 整合面板公开界面回归：真实控件、按钮和布局；同轮原 HEAD 产物仅作只读对照。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const screenshotOptions = { scale: 'css', animations: 'disabled', caret: 'hide', style: '.n-message-container,.n-tooltip { visibility: hidden !important; }' }

/** 只等待真实相邻帧稳定；不修改字体、生产样式或预期图片。 */
async function layout(page) {
  // 1、移开鼠标并等待已有动画及字体完成，比较连续三帧 RGBA。
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity))
  let previous
  let unchanged = 0
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const bytes = await page.screenshot(screenshotOptions)
    const image = await decodePng(bytes)
    assert.equal(image.width, page.viewportSize().width)
    assert.equal(image.height, 700)
    unchanged = previous?.equals(image.rgba) ? unchanged + 1 : 0
    if (unchanged >= 2) return bytes
    previous = image.rgba
  }
  throw new Error('面板布局没有在 10 秒内达到连续三帧 RGBA 一致')
}

/** 仅采样用户可观察的面板值、层级、尺寸和选择；不读取 Vue 私有实例。 */
async function panelState(page) {
  // 1、scope 属性不属于公开布局契约，样式效果由关键计算样式与截图约束。
  return page.locator('.integrated-controls-panel').evaluate(root => ({
    controls: [...root.querySelectorAll('input[type="checkbox"]')].map(input => ({ label: input.parentElement.textContent.trim(), checked: input.checked })),
    nodes: [root, ...root.querySelectorAll('*')].map(node => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return { tag: node.tagName, class: node.getAttribute('class'), title: node.getAttribute('title'), rect: [rect.x, rect.y, rect.width, rect.height], display: style.display, padding: style.padding, gap: style.gap, color: style.color, font: style.font, border: style.border, maxHeight: style.maxHeight }
    }),
    size: root.querySelector('.size-control-input').value,
    itemSize: document.querySelector('.parts-list').style.getPropertyValue('--part-item-size')
  }))
}

test('整合控制面板：折叠切换、缩放提交、通用设置、保存搜索和响应式布局保持一致', { timeout: 180000 }, async () => {
  // 1、真实上传确定性素材；现有 264 份参考全程只读。
  const fixture = (await syntheticFixtures())[0]
  const references = await referenceDigest()
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const evidence = { desktopId: path.basename(desktop.root), scope: '真实 Electron、公开 DOM/计算样式/画布/存储输出；无 Vue 私有注入；不修正正面恢复或组合标签双击旧问题', fixture: { id: fixture.id, sha256: fixture.sha256 }, scenes: [], passed: false }
  console.log(`整合面板回归 desktopId：${evidence.desktopId}`)
  const content = page.locator('.integrated-panel-content')
  const common = page.getByRole('button', { name: '通用', exact: true })
  const layers = page.getByRole('button', { name: '图层', exact: true })
  const size = page.locator('.size-control-input')
  /** 保存真实页面与完整面板状态，用于迁移前后严格对照。 */
  async function snapshot(name) {
    // 1、保存已稳定的布局及独立画布快照，不生成新的永久参考目录。
    const bytes = await layout(page)
    const canvas = Buffer.from((await stableCanvas(page, '.render-canvas', false)).png, 'base64')
    await writeFile(path.join(desktop.root, `${name}.png`), bytes, { flag: 'wx' })
    evidence.scenes.push({ name, viewport: page.viewportSize(), state: await panelState(page), rgbaSha256: hash((await decodePng(bytes)).rgba), canvasSha256: hash(canvas) })
  }
  /** 确认输入框与实际列表 CSS 尺寸一致。 */
  async function expectSize(expected) {
    // 1、检查事件提交后的公开输出，不以输入框值代替父页面实际尺寸。
    await page.waitForFunction(value => document.querySelector('.size-control-input').value === String(value) && document.querySelector('.parts-list').style.getPropertyValue('--part-item-size') === `${value}px`, expected)
    await content.waitFor({ state: 'hidden' })
    assert.equal(await content.isVisible(), false, '缩放控件点击不能意外展开面板')
  }
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    await layers.click()
    await content.getByText('请先上传PSD文件', { exact: true }).waitFor()
    await snapshot('empty-layers-1024')
    await layers.click()
    await content.waitFor({ state: 'hidden' })
    assert.equal(await content.isVisible(), false)
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
    await stableCanvas(page)
    await snapshot('collapsed-1024')

    // 2、同标签折叠、跨标签切换、箭头和标题空白点击都走真实冒泡链路。
    await common.click()
    await page.getByRole('checkbox', { name: '互斥', exact: true }).waitFor()
    await snapshot('common-1024')
    for (const label of ['互斥', '动作互斥', '表情互斥', '正面']) {
      const control = page.getByRole('checkbox', { name: label, exact: true })
      const original = await control.isChecked()
      await control.setChecked(!original)
      assert.equal(await control.isChecked(), !original)
      await control.setChecked(original)
    }
    await layers.click()
    await page.getByTitle('展开所有图层', { exact: true }).waitFor()
    await snapshot('layers-1024')
    await layers.click()
    await content.waitFor({ state: 'hidden' })
    assert.equal(await content.isVisible(), false)
    await page.getByTitle('点击折叠/展开', { exact: true }).click()
    await content.waitFor({ state: 'visible' })
    assert.equal(await content.isVisible(), true)
    await page.locator('.panel-header-tabs').click({ position: { x: 600, y: 10 } })
    await content.waitFor({ state: 'hidden' })
    assert.equal(await content.isVisible(), false)

    // 3、number 修饰符、Enter 和 blur 保留原边界校正及延后提交时机。
    await size.fill('123')
    assert.notEqual(await page.locator('.parts-list').evaluate(node => node.style.getPropertyValue('--part-item-size')), '123px')
    await size.press('Enter')
    await expectSize(123)
    await size.fill('450')
    await size.press('Tab')
    await expectSize(400)
    await size.fill('20')
    await size.press('Enter')
    await expectSize(50)
    await size.fill('85')
    await size.press('Tab')
    await expectSize(85)
    await snapshot('size-restored-1024')

    // 4、保存入口必须落下真实预设和模板配置；搜索入口实际显示并检索。
    await page.getByTitle('添加当前画布为预设', { exact: true }).click()
    await page.waitForFunction(() => JSON.parse(localStorage.getItem('stickfigure-all-presets') || '{}').psdItems?.some(item => item.presets?.some(preset => preset.previewPath)))
    for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
      await page.getByTitle(`保存当前${label}配置为${label}模板`, { exact: true }).click()
      await page.waitForFunction(type => {
        const saved = JSON.parse(localStorage.getItem(`stickfigure-${type}-templates`) || '{}')
        return saved.templates?.length === 1 && saved.templates[0].config.length > 0 && saved.image_file_paths?.length === 1
      }, type)
      await content.waitFor({ state: 'hidden' })
      assert.equal(await content.isVisible(), false, '保存按钮不能触发标题折叠逻辑')
    }
    await page.getByTitle('搜索动作和表情', { exact: true }).click()
    await page.getByPlaceholder('请输入搜索关键词').fill('招手')
    await page.getByPlaceholder('请输入搜索关键词').press('Enter')
    await page.locator('.search-result-item').first().waitFor()
    assert.ok((await page.locator('.search-results-container').innerText()).includes('招手'))
    await page.getByTitle('关闭（ESC键 / 点击外部）', { exact: true }).click()
    await content.waitFor({ state: 'hidden' })
    assert.equal(await content.isVisible(), false)

    // 5、额外核验原有 800/600/400 响应式覆盖，不改变生产配置或字体。
    await common.click()
    for (const width of [800, 600, 400]) {
      await page.setViewportSize({ width, height: 700 })
      await snapshot(`common-${width}`)
    }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    if (process.env.MOMENTUM_PANEL_BEFORE) {
      const root = process.env.MOMENTUM_PANEL_BEFORE
      const before = JSON.parse(await readFile(path.join(root, 'integrated-controls-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(evidence.fixture, before.fixture)
      assert.deepEqual(evidence.scenes, before.scenes, '迁移前后面板 DOM、计算样式、布局与画布必须一致')
      for (const scene of evidence.scenes) await assertSamePixels(await readFile(path.join(desktop.root, `${scene.name}.png`)), await readFile(path.join(root, `${scene.name}.png`)), scene.name)
      evidence.beforeDesktopId = path.basename(root)
      evidence.beforeAfterDifferentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message }
    await page.screenshot({ path: path.join(desktop.root, 'integrated-controls-failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references, '全部原有参考必须保持不变')
    evidence.referenceFiles = Object.keys(references).length
    evidence.referenceDigestSha256 = hash(JSON.stringify(references))
    await writeFile(path.join(desktop.root, 'integrated-controls-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
