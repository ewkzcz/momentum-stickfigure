/** 后发会话失败的独立公开 UI 重现；只读旧证据，不录制/批准参考，不构建业务。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, repository, readJson } from '../helpers/desktop.mjs'
import { fixtures } from '../helpers/reference.mjs'
import { observeImages, stableCanvas, decodePng, assertSamePixels, verifyFixture } from '../helpers/images.mjs'

const diagnostic = process.argv.includes('--diagnostics')
// 额外因果对照：原始 edited-1 已冻结后，仅通过公开互斥开关引发两次串行重绘。
// 默认严格复现不执行；此选项不会替换原始失败断言的 edited-1。
const redrawBeforeSwitch = process.argv.includes('--redraw-before-switch')
const observationMs = 6000
const sha = (value) => createHash('sha256').update(value).digest('hex')
const evidence = await readJson(path.join(repository, 'tests/evidence/psd-session-original-layer-issue-20260906.json'))
const samples = (await fixtures()).slice(0, 2)
for (const fixture of samples) {
  assert.equal(fixture.sha256, evidence.fixtureHashes[fixture.id])
  await verifyFixture(fixture.absolutePath, fixture.sha256)
}
const oldEdited = await readFile(path.join(repository, evidence.observed.editedPng))
const oldReturned = await readFile(path.join(repository, evidence.observed.returnedPng))
assert.equal(sha(oldEdited), evidence.observed.editedPngSha256)
assert.equal(sha(oldReturned), evidence.observed.returnedPngSha256)
const desktop = await launchDesktop(undefined, 'software-layout')
console.log(`后发失败独立调查目录：${desktop.root}`)
const { page } = desktop
const report = { version: 1, originalHead: evidence.originalHead, currentHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), diagnostic, observationMs, operations: [], scenes: [], timelines: {}, assertions: [], originalComparison: {} }
let phase = 'launch'
const consoleEvents = []
page.on('console', (message) => consoleEvents.push({ at: Date.now(), phase, type: message.type(), text: message.text() }))
const mark = async (name) => {
  phase = name
  report.operations.push({ name, at: Date.now(), rendererMs: await page.evaluate(() => performance.now()) })
  console.log(`后发调查：${name}`)
}
function tab(fixture) {
  return page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
}
async function upload(fixture) {
  await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
  await page.getByRole('button', { name: '上传', exact: true }).click()
  await tab(fixture).waitFor()
  await tab(fixture).click()
  await stableCanvas(page)
}
async function expandLayers() {
  if (!(await page.getByRole('button', { name: '展开', exact: true }).isVisible())) await page.getByRole('button', { name: '图层', exact: true }).click()
  let previous = -1
  for (let depth = 0; depth < 100; depth++) {
    await page.getByRole('button', { name: '展开', exact: true }).click()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const count = await page.locator('.layer-item').count()
    if (count === previous) return
    previous = count
  }
  throw new Error('完整图层展开未完成')
}
// 诊断只读取现有状态；不赋值、不调用业务方法，不作为测试正确性的来源。
async function readOnlyState() {
  if (!diagnostic) return undefined
  return page.evaluate(() => {
    let instance = document.querySelector('.render-canvas')?.__vueParentComponent
    while (instance && !('layerTreeData' in (instance.setupState || {}))) instance = instance.parent
    if (!instance) return { available: false }
    const state = instance.setupState
    const flatten = (nodes, prefix = '') => (nodes || []).flatMap((node) => {
      const fullPath = prefix ? `${prefix}/${node.uniqueName || node.name}` : (node.uniqueName || node.name)
      return [{ path: fullPath, visible: node.visible, userVisible: node.userVisible, type: node.type }, ...flatten(node.children, fullPath)]
    })
    const selected = (part) => part && (Array.isArray(part) ? part.map(selected) : { name: part.name, path: part.path, hidden: part.hidden })
    return {
      available: true, controlPriority: state.controlPriority, currentTab: state.currentTab,
      controls: Object.fromEntries(['showBackHair', 'showBackground', 'showFront', 'exclusiveMode', 'actionExclusiveMode', 'expressionExclusiveMode'].map((key) => [key, state[key]])),
      layers: flatten(state.layerTreeData), psdLayers: flatten(state.currentPsdData?.layerHierarchy),
      selectedParts: Object.fromEntries(Object.entries(state.selectedParts || {}).map(([key, value]) => [key, selected(value)])),
      cacheFields: Object.values(state.psdStatesCache || {}).map((value) => Object.keys(value).sort())
    }
  })
}
async function snapshot(name) {
  await mark(name)
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  const controls = await page.locator('.common-controls label').evaluateAll((labels) => labels.filter((label) => label.querySelector('input[type=checkbox]')).map((label) => ({ name: label.textContent.trim(), checked: label.querySelector('input').checked })))
  await expandLayers()
  const image = await stableCanvas(page)
  const state = await page.evaluate(() => ({
    files: [...document.querySelectorAll('.psd-tab-item')].map((node) => ({ name: node.querySelector('.psd-tab-name').getAttribute('title'), active: node.classList.contains('active') })),
    layers: [...document.querySelectorAll('.layer-item')].map((node) => ({ name: node.querySelector('.layer-name').textContent.trim(), group: node.classList.contains('is-group'), depth: node.style.paddingLeft, checked: node.querySelector('input').checked })),
    tabs: [...document.querySelectorAll('.part-tab')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active') })),
    selectedParts: [...document.querySelectorAll('.parts-virtual-items .part-item.active .part-name')].map((node) => node.textContent.trim()),
    selectedPresets: document.querySelectorAll('.preset-item.active').length
  }))
  state.controls = controls
  const bytes = Buffer.from(image.png, 'base64')
  await writeFile(path.join(desktop.root, `${name}.png`), bytes, { flag: 'wx' })
  const scene = { name, state, pngSha256: sha(bytes), domSha256: sha(JSON.stringify(state)), readOnly: await readOnlyState() }
  report.scenes.push(scene)
  return { image: bytes, state }
}
/** 每次 requestAnimationFrame 读取完整 RGBA、做 SHA-256；记录每帧时间和每次像素变化，非固定等待后采样。 */
async function trace(name, baseline) {
  await mark(`${name}-observe-6s`)
  const trajectory = await page.locator('.render-canvas').evaluate(async (canvas, duration) => {
    const start = performance.now()
    const frames = []
    const changes = []
    let previous = ''
    while (performance.now() - start < duration) {
      await new Promise(requestAnimationFrame)
      const now = performance.now()
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const hash = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', rgba))].map((v) => v.toString(16).padStart(2, '0')).join('')
      const frame = { ms: now - start, hash, pendingImages: [...(window.__regressionImages || [])].filter((image) => !image.complete).length, loading: [...document.querySelectorAll('.n-message')].some((node) => /正在处理|正在解析/.test(node.textContent)), focused: document.hasFocus() }
      frames.push(frame)
      if (hash !== previous) changes.push({ ...frame, png: canvas.toDataURL('image/png').split(',')[1] })
      previous = hash
    }
    return { start, elapsedMs: performance.now() - start, width: canvas.width, height: canvas.height, frames, changes, finalPng: canvas.toDataURL('image/png').split(',')[1] }
  }, observationMs)
  const final = Buffer.from(trajectory.finalPng, 'base64')
  delete trajectory.finalPng
  for (const [index, change] of trajectory.changes.entries()) {
    await writeFile(path.join(desktop.root, `${name}-change-${index}.png`), Buffer.from(change.png, 'base64'), { flag: 'wx' })
    delete change.png
  }
  await writeFile(path.join(desktop.root, `${name}-late.png`), final, { flag: 'wx' })
  trajectory.baselineToLate = await difference(final, baseline)
  trajectory.readOnlyLate = await readOnlyState()
  trajectory.summary = { samples: trajectory.frames.length, elapsedMs: trajectory.elapsedMs, distinctRgbaHashes: new Set(trajectory.frames.map((frame) => frame.hash)).size, pixelChangesAfterFirstFrame: trajectory.changes.length - 1, maxFrameGapMs: Math.max(...trajectory.frames.map((frame, index) => frame.ms - (trajectory.frames[index - 1]?.ms || 0))), pendingImagesAlwaysZero: trajectory.frames.every((frame) => frame.pendingImages === 0), loadingAlwaysFalse: trajectory.frames.every((frame) => !frame.loading), focusedAlwaysTrue: trajectory.frames.every((frame) => frame.focused) }
  report.timelines[name] = trajectory
  assert.ok(trajectory.frames.length >= 24, '多帧观察不足，不能判断稳定性')
  assert.ok(trajectory.frames.every((frame) => frame.focused), '焦点模拟在观察中丢失')
  return final
}
async function difference(leftBytes, rightBytes) {
  const [left, right] = await Promise.all([decodePng(leftBytes), decodePng(rightBytes)])
  if (left.width !== right.width || left.height !== right.height) return { dimensionsEqual: false }
  let differentRgbaPixels = 0
  const bounds = { left: left.width, top: left.height, right: -1, bottom: -1 }
  for (let i = 0; i < left.rgba.length; i += 4) {
    if (left.rgba.readUInt32LE(i) === right.rgba.readUInt32LE(i)) continue
    differentRgbaPixels++
    const x = i / 4 % left.width
    const y = Math.floor(i / 4 / left.width)
    bounds.left = Math.min(bounds.left, x); bounds.top = Math.min(bounds.top, y)
    bounds.right = Math.max(bounds.right, x); bounds.bottom = Math.max(bounds.bottom, y)
  }
  return { dimensionsEqual: true, differentRgbaPixels, bounds: differentRgbaPixels ? bounds : null }
}
async function edit(index) {
  await mark(`edit-${index}-preset-controls-part`)
  const initialTab = await page.locator('.part-tab.active').innerText()
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  await page.getByTitle('添加当前画布为预设', { exact: true }).click()
  await page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
  await page.locator('.preset-item').waitFor()
  await page.locator('.part-tab').filter({ hasText: new RegExp(`^${initialTab.trim()}$`) }).click()
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  for (const name of ['互斥', '动作互斥', '表情互斥']) await page.getByRole('checkbox', { name, exact: true }).setChecked(index === 1)
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  const parts = page.locator('.parts-virtual-items .part-item:not(.active)')
  assert.ok(await parts.count() > index)
  const partName = await parts.nth(index).locator('.part-name').innerText()
  if (index === 1) assert.equal(partName.trim(), '伏案左', '必须选原失败的第二个未选部件，禁止替换场景')
  await parts.nth(index).click()
  await stableCanvas(page)
  await expandLayers()
  const leaves = page.locator('.layer-item:not(.is-group) input[type=checkbox]:checked')
  assert.ok(await leaves.count() > 1)
  const target = index === 0 ? leaves.nth(1) : leaves.last()
  const leafName = await target.locator('..').locator('.layer-name').innerText()
  if (index === 1) assert.equal(leafName.trim(), '后发', '必须取消最后勾选的后发叶图层，禁止替换为前手')
  report.operations.push({ name: `edit-${index}-selection`, partName, leafName, readOnlyBeforeLeaf: await readOnlyState() })
  await mark(`edit-${index}-uncheck-${leafName.trim()}`)
  await target.uncheck()
  await stableCanvas(page)
}
const failures = []
async function keepAssertion(name, action) {
  try {
    await action()
    report.assertions.push({ name, passed: true })
  } catch (error) {
    report.assertions.push({ name, passed: false, message: error.message, actual: error.actual, expected: error.expected, operator: error.operator, stack: error.stack })
    failures.push(error)
  }
}
try {
  await page.setViewportSize({ width: 1024, height: 700 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 700 && window.devicePixelRatio === 1 && document.hasFocus())
  report.environment = { runtime: await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })), renderer: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, focused: document.hasFocus() })), renderMode: 'software-layout', focusEmulation: true }
  await page.evaluate(() => { location.hash = '/action-expression' })
  await page.getByRole('button', { name: '上传', exact: true }).waitFor()
  await observeImages(page)
  const initial = []
  for (const index of [0, 1]) {
    await mark(`upload-${index}`)
    await upload(samples[index])
    initial[index] = await snapshot(`initial-${index}`)
  }
  await tab(samples[1]).click()
  await stableCanvas(page)
  await edit(1)
  const edited = await snapshot('edited-1')
  const editedLate = await trace('edited-1', edited.image)
  assert.notDeepEqual(edited.image, initial[1].image)
  if (redrawBeforeSwitch) {
    await mark('diagnostic-public-serial-redraw-before-any-switch')
    await page.getByRole('button', { name: '通用', exact: true }).click()
    const mode = page.getByRole('checkbox', { name: '表情互斥', exact: true })
    assert.equal(await mode.isChecked(), true)
    await mode.uncheck()
    await stableCanvas(page)
    await mode.check()
    await stableCanvas(page)
    const redrawn = await snapshot('edited-1-public-redraw')
    await keepAssertion('诊断对照：公开开关往返后完整 DOM 不变', () => assert.deepEqual(redrawn.state, edited.state))
    report.publicRedrawDiagnostic = { beforeSwitch: true, operations: ['表情互斥 true→false', '完整画布十二帧稳定', '表情互斥 false→true', '完整画布十二帧稳定'], vsOriginalEdited: await difference(redrawn.image, oldEdited), vsOriginalReturned: await difference(redrawn.image, oldReturned), domEqual: JSON.stringify(redrawn.state) === JSON.stringify(edited.state) }
  }
  await mark('switch-to-yun-jian-qi-lin')
  await tab(samples[0]).click()
  await stableCanvas(page)
  await edit(0)
  await snapshot('edited-0')
  await mark('first-return-to-xing-kong')
  await tab(samples[1]).click()
  const returned = await snapshot('round-0-1')
  const returnedLate = await trace('round-0-1', returned.image)
  report.originalComparison = {
    editedEarlyVsOriginalEdited: await difference(edited.image, oldEdited),
    editedLateVsOriginalEdited: await difference(editedLate, oldEdited),
    returnedEarlyVsOriginalReturned: await difference(returned.image, oldReturned),
    returnedLateVsOriginalReturned: await difference(returnedLate, oldReturned),
    editedDomVsOriginalHash: sha(JSON.stringify(edited.state)) === evidence.observed.visibleDomSha256,
    returnedDomVsOriginalHash: sha(JSON.stringify(returned.state)) === evidence.observed.visibleDomSha256,
    originalPair: await difference(oldReturned, oldEdited),
    currentEarlyPair: await difference(returned.image, edited.image),
    currentLatePair: await difference(returnedLate, editedLate)
  }
  await keepAssertion('公开 DOM 完整恢复', () => assert.deepEqual(returned.state, edited.state))
  await keepAssertion('原始正确断言：首次返回星空应逐字节恢复 edited-1', () => assertSamePixels(returned.image, edited.image, '首次返回星空应恢复原编辑画布'))
  await keepAssertion('持续六秒观察后仍应逐字节恢复编辑画布', () => assertSamePixels(returnedLate, editedLate, '六秒多帧观察后星空应恢复原编辑画布'))
  assert.deepEqual(desktop.errors, [])
} catch (error) {
  report.probeError = { message: error.message, stack: error.stack }
  failures.push(error)
} finally {
  report.pageErrors = desktop.errors
  report.redrawBeforeSwitch = redrawBeforeSwitch
  report.renderEvents = consoleEvents.filter((event) => /使用图层树模式渲染|收集到 \d+ 个可渲染图层|图层树模式渲染完成|控制优先级|反向同步|通用控制.*更新图层/.test(event.text))
  await writeFile(path.join(desktop.root, 'hair-summary.json'), JSON.stringify({ environment: report.environment, scenes: report.scenes.map(({ name, pngSha256, domSha256, readOnly }) => ({ name, pngSha256, domSha256, readOnlyAvailable: readOnly?.available })), timelines: Object.fromEntries(Object.entries(report.timelines).map(([name, value]) => [name, value.summary])), publicRedrawDiagnostic: report.publicRedrawDiagnostic, renderEvents: report.renderEvents }, null, 2))
  await writeFile(path.join(desktop.root, 'hair-result.json'), JSON.stringify(report, null, 2))
  await writeFile(path.join(desktop.root, 'hair-console.json'), JSON.stringify(consoleEvents, null, 2))
  await desktop.close()
  for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  assert.equal(sha(await readFile(path.join(repository, evidence.observed.editedPng))), evidence.observed.editedPngSha256)
  assert.equal(sha(await readFile(path.join(repository, evidence.observed.returnedPng))), evidence.observed.returnedPngSha256)
}
console.log(JSON.stringify({ directory: desktop.root, assertions: report.assertions, originalComparison: report.originalComparison }, null, 2))
if (failures.length) throw failures[0]
