/** 顶部工具栏、部件标签与悬浮预览公开回归：采集原版 DOM、计算样式与截图像素基线。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { assertSamePixels, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 计算实际构建目录摘要。处理流程：1、收集文件；2、按稳定顺序纳入路径和字节。 */
async function directoryHash(directory) {
  const files = []
  async function visit(folder) {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const filename = path.join(folder, entry.name)
      if (entry.isDirectory()) await visit(filename)
      else files.push(filename)
    }
  }
  await visit(directory)
  const hash = createHash('sha256')
  for (const filename of files.sort()) {
    hash.update(path.relative(directory, filename)).update('\0').update(await readFile(filename)).update('\0')
  }
  return hash.digest('hex')
}

async function subtreeState(page, selector) {
  return page.locator(selector).evaluate((root) => {
    const serialize = (node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      const attributes = Object.fromEntries([...node.attributes]
        .filter((item) => item.name !== 'scope' && !item.name.startsWith('data-v-') && item.name !== 'id' && item.name !== 'aria-labelledby')
        .map((item) => [item.name, item.value]))
      const styleEntries = [...style].map((key) => [key, style.getPropertyValue(key)])
      return {
        tag: node.tagName,
        attributes,
        text: node.textContent.trim(),
        rect: [rect.x, rect.y, rect.width, rect.height],
        style: Object.fromEntries(styleEntries)
      }
    }
    return { root: serialize(root), nodes: [...root.querySelectorAll('*')].map(serialize) }
  })
}

async function overlayState(page, selector) {
  return page.evaluate((target) => {
    const serialize = (node) => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      const attributes = Object.fromEntries([...node.attributes]
        .filter((item) => item.name !== 'scope' && !item.name.startsWith('data-v-') && item.name !== 'id' && item.name !== 'aria-labelledby')
        .map((item) => [item.name, item.value]))
      const styleEntries = [...style].map((key) => [key, style.getPropertyValue(key)])
      return {
        tag: node.tagName,
        attributes,
        text: node.textContent.trim(),
        rect: [rect.x, rect.y, rect.width, rect.height],
        style: Object.fromEntries(styleEntries)
      }
    }
    const root = document.querySelector(target)
    if (!root) return { present: false, root: null, nodes: [] }
    return { present: true, root: serialize(root), nodes: [...root.querySelectorAll('*')].map(serialize) }
  }, selector)
}

/** 等待页面真实入场与控件波纹结束，不覆盖样式，也不移走浮层所需的鼠标。 */
async function waitForAnimations(page, preserveHover) {
  // 1、普通控件采样前移出鼠标，浮层采样保持触发位置。
  if (!preserveHover) await page.mouse.move(0, 0)
  await page.waitForFunction(() => {
    const ready = ['.app-main', '.app-layout', '.action-expression-panel'].every(selector => {
      const node = document.querySelector(selector)
      if (!node) return true
      const style = window.getComputedStyle(node)
      return style.opacity === '1' && (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)')
    })
    return ready && !document.querySelector('.n-base-wave--active') && document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)
  }, undefined, { timeout: 15000 })
}

/** 连续三张截图相同后才返回；计时动画不修改生产样式。 */
async function stableScreenshot(locator) {
  // 1、采用有界循环等待真实图像稳定。
  let previous
  let unchanged = 0
  for (let attempt = 0; attempt < 30; attempt++) {
    const image = await locator.screenshot({ animations: 'disabled', caret: 'hide' })
    unchanged = previous?.equals(image) ? unchanged + 1 : 0
    if (unchanged >= 2) return image
    previous = image
  }
  throw new Error('控件截图未达到连续三帧一致')
}

async function capture(desktop, name, result, options = {}) {
  const { page } = desktop
  await page.evaluate(() => document.fonts.ready)
  await waitForAnimations(page, Boolean(options.overlay))
  const scene = {}
  if (options.toolbar !== false) {
    scene.toolbar = await subtreeState(page, '.toolbar')
    await writeFile(path.join(desktop.root, `${name}-toolbar.png`), await stableScreenshot(page.locator('.toolbar')), { flag: 'wx' })
  }
  if (options.tabs !== false) {
    scene.tabs = await subtreeState(page, '.parts-tabs-container')
    await writeFile(path.join(desktop.root, `${name}-tabs.png`), await stableScreenshot(page.locator('.parts-tabs-container')), { flag: 'wx' })
  }
  if (options.overlay) {
    scene.overlay = await overlayState(page, options.overlay)
    assert.equal(scene.overlay.present, true, '浮层场景必须真实可见')
    if (scene.overlay.present) {
      await writeFile(path.join(desktop.root, `${name}-overlay.png`), await page.locator(options.overlay).screenshot({ animations: 'disabled', caret: 'hide' }), { flag: 'wx' })
    }
  }
  if (options.checks) scene.checks = options.checks
  result.scenes[name] = scene
}

async function hoverPoint(page, target) {
  return page.locator(target).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const clip = element.closest('.canvas-area, .parts-list')?.getBoundingClientRect() || rect
    const left = Math.max(0, rect.left, clip.left)
    const right = Math.min(window.innerWidth, rect.right, clip.right)
    const top = Math.max(0, rect.top, clip.top)
    const bottom = Math.min(window.innerHeight, rect.bottom, clip.bottom)
    if (right - left < 20 || bottom - top < 20) throw new Error('目标可见区域不足以采集悬浮预览')
    return { x: Math.ceil(left + (right - left) * 0.35), y: Math.ceil(top + (bottom - top) * 0.35) }
  })
}

test('工具栏标签与悬浮预览：上传后控件、开关、标签点击与可见浮层', { timeout: 180000 }, async () => {
  const references = await referenceDigest()
  const fixture = (await syntheticFixtures())[0]
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const outHash = await directoryHash(path.join(repository, 'out'))
  const result = {
    sourceStatus: { workingTree: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src'], { cwd: repository, encoding: 'utf8' }).trim(), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), outSha256: outHash },
    fixture: { path: fixture.path, sha256: fixture.sha256 },
    scenes: {},
    passed: false
  }
  console.log(`工具栏标签预览原版基线：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
    await stableCanvas(page)
    await page.locator('.toolbar').waitFor()
    await page.locator('.parts-tabs-container').waitFor()
    await page.getByRole('checkbox', { name: '预览1', exact: true }).waitFor()
    await page.getByRole('checkbox', { name: '预览2', exact: true }).waitFor()
    await capture(desktop, 'after-upload', result, {
      checks: {
        preview1: await page.getByRole('checkbox', { name: '预览1', exact: true }).isChecked(),
        preview2: await page.getByRole('checkbox', { name: '预览2', exact: true }).isChecked(),
        previewDisabled: await page.getByRole('button', { name: '预览', exact: true }).isDisabled(),
        jumpDisabled: await page.getByRole('button', { name: '跳转', exact: true }).isDisabled()
      }
    })

    await page.getByRole('checkbox', { name: '预览1', exact: true }).setChecked(true)
    await page.getByRole('checkbox', { name: '预览2', exact: true }).setChecked(false)
    await capture(desktop, 'preview1-on', result, {
      checks: {
        preview1: await page.getByRole('checkbox', { name: '预览1', exact: true }).isChecked(),
        preview2: await page.getByRole('checkbox', { name: '预览2', exact: true }).isChecked()
      }
    })

    await page.getByRole('checkbox', { name: '预览1', exact: true }).setChecked(false)
    await page.getByRole('checkbox', { name: '预览2', exact: true }).setChecked(true)
    await capture(desktop, 'preview2-on', result, {
      checks: {
        preview1: await page.getByRole('checkbox', { name: '预览1', exact: true }).isChecked(),
        preview2: await page.getByRole('checkbox', { name: '预览2', exact: true }).isChecked()
      }
    })

    const tabs = page.locator('.part-tab')
    assert.ok(await tabs.count() > 1, '必须存在多个部件标签')
    const secondLabel = (await tabs.nth(1).innerText()).trim()
    await tabs.nth(1).click()
    await page.locator('.part-tab.active').filter({ hasText: secondLabel }).waitFor()
    await capture(desktop, 'tab-clicked', result, {
      checks: { activeTab: secondLabel }
    })

    await page.getByRole('checkbox', { name: '预览1', exact: true }).setChecked(true)
    const point = await hoverPoint(page, '.render-canvas')
    await page.mouse.move(1, 1)
    await page.mouse.move(point.x, point.y)
    await page.locator('.image-hover-preview > img[alt="preview"]').waitFor({ state: 'visible', timeout: 5000 })
    await capture(desktop, 'canvas-hover-visible', result, {
      toolbar: false,
      tabs: false,
      overlay: '.image-hover-preview',
      checks: { point, preview1: true }
    })
    await page.mouse.move(1, 1)
    await page.locator('.image-hover-preview').waitFor({ state: 'detached' })

    // 1、仅在显式验收跟随节点时追加十轮按下/松开，不越过窗口边界或触发系统拖出。
    if (process.env.MOMENTUM_CHECK_DRAG_OVERLAY) {
      await page.getByRole('checkbox', { name: '预览1', exact: true }).setChecked(false)
      for (let round = 0; round < 10; round++) {
        await page.mouse.move(point.x, point.y)
        await page.mouse.down()
        const follow = await stableCanvas(page, '.drag-follow-preview canvas')
        await writeFile(path.join(desktop.root, `drag-${round}-canvas.png`), Buffer.from(follow.png, 'base64'), { flag: 'wx' })
        await capture(desktop, `drag-${round}`, result, { toolbar: false, tabs: false, overlay: '.drag-follow-preview' })
        await page.mouse.up()
        await page.locator('.drag-follow-preview').waitFor({ state: 'detached' })
      }
    }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter((line) => /\[renderer:error\].*VueError:/.test(line)), [])
    result.passed = true

    if (process.env.MOMENTUM_TOOLBAR_BEFORE) {
      const beforeRoot = process.env.MOMENTUM_TOOLBAR_BEFORE
      const before = JSON.parse(await readFile(path.join(beforeRoot, 'action-toolbar-tabs-overlays-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.equal(before.sourceStatus.workingTree, '', '对照必须来自干净的原版源码构建')
      assert.deepEqual(result.fixture, before.fixture)
      assert.deepEqual(Object.keys(result.scenes).sort(), Object.keys(before.scenes).sort(), '场景集合')
      assert.deepEqual(result.scenes, before.scenes, '原版工具栏/标签/预览公开 DOM、属性、矩形和计算样式')
      for (const name of Object.keys(result.scenes)) {
        for (const suffix of ['toolbar', 'tabs', 'overlay']) {
          const actualPath = path.join(desktop.root, `${name}-${suffix}.png`)
          const expectedPath = path.join(beforeRoot, `${name}-${suffix}.png`)
          if (!result.scenes[name][suffix]) continue
          await assertSamePixels(await readFile(actualPath), await readFile(expectedPath), `${name}/${suffix} 原版像素`)
        }
      }
    }
  } finally {
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references)
    await writeFile(path.join(desktop.root, 'action-toolbar-tabs-overlays-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  }
})
