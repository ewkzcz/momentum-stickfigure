/** 严格后发会话场景：保留原公开操作及六秒逐帧观察，不读取 Vue 私有状态。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { stableCanvas, observeImages, decodePng, assertSamePixels } from '../helpers/images.mjs'
import { layerPublicState, publicSerialRedraw } from '../helpers/layer-render-public.mjs'

/** 固定原失败场景的桌面视口、像素比及焦点。 */
export async function prepareHairEnvironment(desktop) {
  const { page, application } = desktop
  await page.setViewportSize({ width: 1024, height: 700 })
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 700 && window.devicePixelRatio === 1 && document.hasFocus())
  return { runtime: await application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })), renderer: { width: 1024, height: 700, dpr: 1, focused: true }, renderMode: 'software-layout', focusEmulation: true }
}

/** 持续六秒检查每个采样的完整 RGBA；任何中途变化都失败，而非只比较最终截图。 */
async function observeSixSeconds(page, baseline) {
  const decoded = await decodePng(baseline)
  const hash = createHash('sha256').update(decoded.rgba).digest('hex')
  const result = await page.locator('.render-canvas').evaluate(async (canvas) => {
    const start = performance.now()
    const frames = []
    while (performance.now() - start < 6000) {
      await new Promise(requestAnimationFrame)
      const rgba = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data
      const hash = [...new Uint8Array(await window.crypto.subtle.digest('SHA-256', rgba))].map((value) => value.toString(16).padStart(2, '0')).join('')
      frames.push({ ms: performance.now() - start, hash, focused: document.hasFocus(), pending: [...(window.__regressionImages || [])].some((image) => !image.complete), loading: [...document.querySelectorAll('.n-message')].some((node) => /正在处理|正在解析/.test(node.textContent)) })
    }
    return { elapsedMs: performance.now() - start, frames, png: canvas.toDataURL('image/png').split(',')[1] }
  })
  assert.ok(result.elapsedMs >= 6000 && result.frames.length >= 24, '六秒多帧观察不足')
  assert.ok(result.frames.every((frame) => frame.hash === hash && frame.focused && !frame.pending && !frame.loading), '六秒观察中像素变化、焦点丢失或解码未完成')
  const late = Buffer.from(result.png, 'base64')
  await assertSamePixels(late, baseline, '观察前后画布保持稳定')
  return { image: late, observation: { elapsedMs: result.elapsedMs, samples: result.frames.length, distinctRgbaHashes: new Set(result.frames.map((frame) => frame.hash)).size, rgbaSha256: hash } }
}

/** 重放原后发失败入口；串行对照仅由显式录制命令启用，测试不会生成预期。 */
export async function runHairScenario(desktop, samples, canonicalRedraw = false) {
  const { page, application } = desktop
  const result = { images: {}, states: {}, observations: {} }
  const tab = (fixture) => page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
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
    assert.fail('完整图层展开未完成')
  }
  async function snapshot(name) {
    if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
    await expandLayers()
    const bytes = Buffer.from((await stableCanvas(page)).png, 'base64')
    result.images[name] = bytes
    result.states[name] = await layerPublicState(page)
    await writeFile(path.join(desktop.root, `${name}.png`), bytes, { flag: 'wx' })
    return bytes
  }
  async function edit(index) {
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
    if (index === 1) assert.equal((await parts.nth(index).locator('.part-name').innerText()).trim(), '伏案左', '保留原失败的部件选择')
    await parts.nth(index).click()
    await stableCanvas(page)
    await expandLayers()
    const leaves = page.locator('.layer-item:not(.is-group) input[type=checkbox]:checked')
    assert.ok(await leaves.count() > 1)
    const target = index === 0 ? leaves.nth(1) : leaves.last()
    if (index === 1) assert.equal((await target.locator('..').locator('.layer-name').innerText()).trim(), '后发', '保留原失败的后发叶图层')
    await target.uncheck()
    await stableCanvas(page)
  }
  await page.evaluate(() => { location.hash = '/action-expression' })
  await page.getByRole('button', { name: '上传', exact: true }).waitFor()
  await observeImages(page)
  for (const index of [0, 1]) {
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, samples[index].absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await tab(samples[index]).waitFor()
    await tab(samples[index]).click()
    await stableCanvas(page)
    await snapshot(`initial-${index}`)
  }
  await tab(samples[1]).click()
  await stableCanvas(page)
  await edit(1)
  const edited = await snapshot('edited-1')
  assert.notDeepEqual(edited, result.images['initial-1'], '必须实际修改原画布')
  const editedLate = await observeSixSeconds(page, edited)
  result.images['edited-1-late'] = editedLate.image
  result.observations.edited = editedLate.observation
  if (canonicalRedraw) {
    result.canonical = await publicSerialRedraw(page)
    assert.deepEqual(result.canonical.state, result.states['edited-1'])
    await writeFile(path.join(desktop.root, 'hair-canonical.png'), result.canonical.image, { flag: 'wx' })
  }
  await tab(samples[0]).click()
  await stableCanvas(page)
  await edit(0)
  await snapshot('edited-0')
  await tab(samples[1]).click()
  const returned = await snapshot('round-0-1')
  const returnedLate = await observeSixSeconds(page, returned)
  result.images['round-0-1-late'] = returnedLate.image
  result.observations.returned = returnedLate.observation
  assert.deepEqual(result.states['round-0-1'], result.states['edited-1'], '公开 DOM 完整恢复')
  assert.deepEqual(desktop.errors, [])
  return result
}
