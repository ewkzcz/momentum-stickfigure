/** 主画布及预设悬浮回归：真实鼠标与开关操作，独立只读参考约束 PNG 像素和浮层布局。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, repository, readJson } from '../helpers/desktop.mjs'
import { fixtures, referenceDirectory } from '../helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from '../helpers/images.mjs'

export const hoverReferenceName = 'canvas-preset-hover-renderer1024-dpr1-v1'
const originalHead = 'b2aad27787b398c406d0207280e54c7bbc2489e8'
const targets = [
  { name: 'canvas', checkbox: '预览1', target: '.render-canvas', image: '.image-hover-preview > img[alt="preview"]' },
  { name: 'preset', checkbox: '预览2', target: '.preset-item .part-preview img', image: '.preset-hover-preview > img[alt="preset preview"]' }
]

/**
 * 汇总参考文件的内容摘要。
 * 处理流程：
 * 1、按相对路径递归读取，排除本项新目录时用于保护全部旧参考
 */
export async function referenceDigest(excludeHover = false, directory = referenceDirectory, prefix = '') {
  // 1、只读取文件字节，不修改任何参考的内容或权限。
  const entries = (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))
  const files = {}
  for (const entry of entries) {
    if (!prefix && excludeHover && entry.name.startsWith('canvas-preset-hover-')) continue
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) Object.assign(files, await referenceDigest(false, path.join(directory, entry.name), relative))
    else {
      assert.ok(entry.isFile(), '参考目录不得包含符号链接')
      files[relative] = createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex')
    }
  }
  return files
}

/**
 * 固定并记录真实桌面的渲染环境。
 * 处理流程：
 * 1、在进入业务页面前固定视口及焦点，再检查实际运行环境
 */
async function prepareEnvironment(desktop) {
  // 1、只控制浏览器环境，不改业务状态、图片或样式。
  await desktop.page.setViewportSize({ width: 1024, height: 700 })
  const cdp = await desktop.page.context().newCDPSession(desktop.page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 700 && window.devicePixelRatio === 1 && document.hasFocus())
  return {
    runtime: await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })),
    renderer: await desktop.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, focused: document.hasFocus(), visibility: document.visibilityState })),
    renderMode: 'software-layout', focusEmulation: true
  }
}

/**
 * 等待真实图像及布局达到稳定状态。
 * 处理流程：
 * 1、连续观察十二帧，任何加载或布局变化都会重新开始计数
 */
async function settle(page, selector) {
  // 1、稳定依据来自相邻实际帧，绝不根据参考重试挑选输出。
  await page.evaluate(async (selector) => {
    const deadline = performance.now() + 15000
    let previous
    let unchanged = 0
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const image = document.querySelector(selector)
      const pending = [...(window.__regressionImages || [])].some((item) => !item.complete)
      const value = image ? JSON.stringify({ src: image.src, box: image.parentElement.getBoundingClientRect().toJSON(), complete: image.complete }) : 'absent'
      unchanged = !pending && (!image || (image.complete && image.naturalWidth > 0)) && value === previous ? unchanged + 1 : 0
      previous = value
      if (unchanged >= 12) return
    }
    throw new Error('悬浮预览图像或布局未稳定')
  }, selector)
}

/**
 * 在真实目标的可见范围内选择悬停位置。
 * 处理流程：
 * 1、裁去滚动容器和窗口外的部分，再取左上及右下两个实际鼠标位置
 */
async function hoverPoints(page, target) {
  // 1、仅测量 DOM，不注入事件或改变元素位置。
  return page.locator(target).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const clip = element.closest('.canvas-area, .parts-list').getBoundingClientRect()
    const left = Math.max(0, rect.left, clip.left)
    const right = Math.min(window.innerWidth, rect.right, clip.right)
    const top = Math.max(0, rect.top, clip.top)
    const bottom = Math.min(window.innerHeight, rect.bottom, clip.bottom)
    if (right - left < 20 || bottom - top < 20) throw new Error('目标可见区域不足以验证真实鼠标移动')
    return [
      { x: Math.ceil(left + (right - left) * 0.2), y: Math.ceil(top + (bottom - top) * 0.2) },
      { x: Math.floor(left + (right - left) * 0.8), y: Math.floor(top + (bottom - top) * 0.8) }
    ]
  })
}

/**
 * 采集实际浮层图片及可观察状态。
 * 处理流程：
 * 1、读取唯一浮层的原始 PNG 地址、布局和显示状态，隐藏时确认元素已移除
 */
async function observeHover(page, target, visible, point) {
  // 1、精确限定图片的父类和 alt，避免误取部件或模板浮层。
  await page.locator(target.image).waitFor({ state: visible ? 'visible' : 'detached' })
  await settle(page, target.image)
  const checked = await page.getByRole('checkbox', { name: target.checkbox, exact: true }).isChecked()
  const observation = await page.evaluate((selector) => {
    const images = [...document.querySelectorAll(selector)]
    if (!images.length) return { state: { count: 0, visible: false }, png: null }
    if (images.length !== 1) throw new Error('浮层选择器未唯一命中')
    const image = images[0]
    const parent = image.parentElement
    const style = window.getComputedStyle(parent)
    const imageStyle = window.getComputedStyle(image)
    if (!image.src.startsWith('data:image/png;base64,')) throw new Error('浮层未提供实际 PNG')
    return { png: image.src.split(',')[1], state: {
      count: 1, visible: style.display !== 'none' && style.visibility !== 'hidden',
      naturalWidth: image.naturalWidth, naturalHeight: image.naturalHeight,
      inline: { left: parent.style.left, top: parent.style.top, width: parent.style.width, height: parent.style.height },
      parentBounds: parent.getBoundingClientRect().toJSON(), imageBounds: image.getBoundingClientRect().toJSON(),
      display: style.display, visibility: style.visibility, position: style.position, pointerEvents: style.pointerEvents,
      objectFit: imageStyle.objectFit
    } }
  }, target.image)
  assert.equal(observation.state.visible, visible)
  return { ...observation, state: { ...observation.state, checked, point } }
}

/**
 * 通过真实界面验证单类悬浮预览。
 * 处理流程：
 * 1、关闭后移入和移动，确认不显示
 * 2、开启后移入和移动，采集像素及布局
 * 3、鼠标不离开时用已聚焦开关关闭，再开启并验证离开隐藏
 */
async function exerciseTarget(desktop, target, snapshot) {
  const { page } = desktop
  // 1、通过原生可访问性开关操作，不直接写 Vue 或配置状态。
  const checkbox = page.getByRole('checkbox', { name: target.checkbox, exact: true })
  await checkbox.setChecked(false)
  const points = await hoverPoints(page, target.target)
  await page.mouse.move(1, 1)
  await page.mouse.move(points[0].x, points[0].y)
  await snapshot(`${target.name}-disabled-enter`, await observeHover(page, target, false, points[0]))
  await page.mouse.move(points[1].x, points[1].y)
  await snapshot(`${target.name}-disabled-move`, await observeHover(page, target, false, points[1]))
  // 2、保留开关焦点，用真实鼠标悬停图片；比较移动前后的实际坐标。
  await checkbox.setChecked(true)
  await checkbox.focus()
  await page.mouse.move(points[0].x, points[0].y)
  const entered = await observeHover(page, target, true, points[0])
  await snapshot(`${target.name}-enabled-enter`, entered)
  await page.mouse.move(points[1].x, points[1].y)
  const moved = await observeHover(page, target, true, points[1])
  await snapshot(`${target.name}-enabled-move`, moved)
  assert.notDeepEqual(moved.state.inline, entered.state.inline, '鼠标移动必须实际改变浮层位置')
  // 3、键盘操作真实开关，保持鼠标悬停以单独覆盖关闭监听器。
  await page.keyboard.press('Space')
  assert.equal(await checkbox.isChecked(), false)
  await snapshot(`${target.name}-disabled-while-hovering`, await observeHover(page, target, false, points[1]))
  await checkbox.setChecked(true)
  await page.mouse.move(points[0].x, points[0].y)
  await snapshot(`${target.name}-enabled-reenter`, await observeHover(page, target, true, points[0]))
  await page.mouse.move(1, 1)
  await snapshot(`${target.name}-leave`, await observeHover(page, target, false, { x: 1, y: 1 }))
}

/**
 * 独立采集或只读回放两份 PSD 的悬浮参考。
 * 处理流程：
 * 1、采集前严格核验原提交、干净源码、素材及旧参考摘要，独占创建新目录
 * 2、真实上传和保存预设，逐场景记录实际图片并零容差比较
 * 3、退出隔离成功并复核素材及参考后，才独占写入完整清单
 */
export async function checkCanvasPresetHover(record = false, referenceName = hoverReferenceName) {
  assert.match(referenceName, /^canvas-preset-hover-[a-z0-9-]+$/)
  const samples = await fixtures()
  assert.equal(samples.length, 2, '此参考要求两份已登记本地 PSD')
  const beforeHashes = await Promise.all(samples.map((fixture) => verifyFixture(fixture.absolutePath, fixture.sha256)))
  const oldReferences = await referenceDigest(true)
  const directory = path.join(referenceDirectory, referenceName)
  let sourceTree
  if (record) {
    // 1、包含未跟踪源码在内都必须干净，禁止以改后构建建立预期。
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), originalHead)
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'electron.vite.config.mjs'], { cwd: repository, encoding: 'utf8' }).trim(), '', '采集要求业务源码干净')
    sourceTree = execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repository, encoding: 'utf8' }).trim()
    await mkdir(directory)
    execFileSync('npm', ['run', 'build'], { cwd: repository, stdio: 'inherit' })
  }
  const expected = record ? null : await readJson(path.join(directory, 'manifest.json'))
  if (expected) {
    assert.equal(expected.version, 1)
    assert.equal(expected.referenceName, referenceName)
    assert.deepEqual(expected.fixtureHashesBefore, beforeHashes)
    assert.deepEqual(expected.fixtureHashesAfter, beforeHashes)
    for (const [name, hash] of Object.entries(expected.oldReferences)) {
      assert.equal(oldReferences[name], hash, `旧参考已丢失或改变：${name}`)
    }
    assert.equal(expected.complete, true)
  }
  const referenceBefore = record ? null : await referenceDigest(false, directory)
  const actual = { version: 1, referenceName, originalHead, sourceTree, fixtureHashesBefore: beforeHashes, oldReferences, runs: [] }
  for (const fixture of samples) {
    const desktop = await launchDesktop(undefined, 'software-layout')
    const run = { fixture: fixture.id, scenes: [], closedAndIsolated: false }
    actual.runs.push(run)
    console.log(`悬浮回归现场：${desktop.root}`)
    try {
      run.environment = await prepareEnvironment(desktop)
      const referenceRun = expected?.runs.find((item) => item.fixture === fixture.id)
      if (expected) assert.deepEqual(run.environment, referenceRun.environment, '悬浮参考环境改变')
      await desktop.page.evaluate(() => { location.hash = '/action-expression' })
      await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
      await observeImages(desktop.page)
      await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
      await desktop.page.locator('.psd-tab-name').filter({ hasText: path.basename(fixture.absolutePath, '.psd') }).waitFor()
      await stableCanvas(desktop.page)
      await desktop.page.getByTitle('添加当前画布为预设', { exact: true }).click()
      await desktop.page.waitForFunction(() => JSON.parse(localStorage.getItem('stickfigure-all-presets') || '{"psdItems":[]}').psdItems.some((item) => item.presets?.some((preset) => preset.previewPath)))
      await desktop.page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
      await desktop.page.locator('.preset-item .part-preview img').waitFor()
      await stableCanvas(desktop.page)
      /**
       * 留存并核验单个场景。
       * 处理流程：
       * 1、保存实际图片及状态，采集独占写入，回放只读逐字节参考
       */
      const snapshot = async (name, observation) => {
        // 1、状态与顺序同样受参考约束，隐藏场景也必须完整执行。
        const filename = observation.png ? `${fixture.id}-${name}.png` : null
        const scene = { name, state: observation.state, filename }
        run.scenes.push(scene)
        const bytes = observation.png ? Buffer.from(observation.png, 'base64') : null
        if (bytes) await writeFile(path.join(desktop.root, filename), bytes)
        await writeFile(path.join(desktop.root, 'hover-result.json'), JSON.stringify(run, null, 2))
        if (record && bytes) {
          await writeFile(path.join(directory, filename), bytes, { flag: 'wx' })
          await chmod(path.join(directory, filename), 0o444)
        } else if (!record) {
          assert.deepEqual(scene, referenceRun.scenes[run.scenes.length - 1], `${fixture.id}/${name}：悬浮状态或布局改变`)
          if (bytes) await assertSamePixels(bytes, await readFile(path.join(directory, filename)), `${fixture.id}/${name}`)
        }
        console.log(`${record ? '悬浮参考采集' : '悬浮状态及像素一致'} ${fixture.id}/${name}`)
      }
      // 2、两种浮层独立执行，模板、部件及独立窗口不在此处操作。
      for (const target of targets) await exerciseTarget(desktop, target, snapshot)
      if (expected) assert.equal(run.scenes.length, referenceRun.scenes.length)
      assert.deepEqual(desktop.errors, [])
    } finally {
      // 3、失败保留原始日志及截图，成功关闭隔离后才允许写完整标记。
      await desktop.page.screenshot({ path: path.join(desktop.root, 'hover-final.png') }).catch(() => {})
      try { await desktop.close(); run.closedAndIsolated = true } finally {
        run.fixtureHashAfter = await verifyFixture(fixture.absolutePath, fixture.sha256)
        await writeFile(path.join(desktop.root, 'hover-result.json'), JSON.stringify(run, null, 2))
      }
    }
  }
  actual.fixtureHashesAfter = await Promise.all(samples.map((fixture) => verifyFixture(fixture.absolutePath, fixture.sha256)))
  assert.deepEqual(await referenceDigest(true), oldReferences, '测试改变了旧参考')
  actual.complete = true
  if (record) {
    actual.recordedAt = new Date().toISOString()
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(actual, null, 2), { flag: 'wx' })
    await chmod(path.join(directory, 'manifest.json'), 0o444)
    await chmod(directory, 0o555)
  } else {
    assert.deepEqual(await referenceDigest(false, directory), referenceBefore, '只读回放改变了悬浮参考')
    assert.equal(actual.runs.length, expected.runs.length)
  }
  return actual
}
