/** 预设卡片公开交互回归：从真实上传和保存入口构造数据，核对原版布局与像素。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { assertSamePixels, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 等待字体、页面入场和卡片过渡完成，保存公开节点的样式与连续稳定截图。 */
async function capture(desktop, name, result) {
  // 1、等待真实动画完成，不修改业务样式，也不依赖固定延迟。
  const { page } = desktop
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => ['.app-main', '.app-layout'].every(selector => {
    const node = document.querySelector(selector)
    if (!node) return true
    const style = window.getComputedStyle(node)
    return style.opacity === '1' && (style.transform === 'none' || style.transform === 'matrix(1, 0, 0, 1, 0, 0)')
  }))
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity))
  const list = page.locator('.parts-list')
  let previous
  let image
  let count = 0
  for (let attempt = 0; attempt < 20 && count < 2; attempt++) {
    image = await list.screenshot({ animations: 'disabled', caret: 'hide' })
    count = previous?.equals(image) ? count + 1 : 0
    previous = image
  }
  assert.equal(count, 2, '连续三帧卡片截图必须稳定')
  // 2、比较全部计算样式及 DOM 属性，排除组件拆分必然改变的 scope 属性。
  const nodes = await list.evaluate(root => [...root.querySelectorAll('*')].map(node => {
    const rect = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)
    return {
      tag: node.tagName,
      attributes: Object.fromEntries([...node.attributes].filter(item => !item.name.startsWith('data-v-')).map(item => [item.name, item.value])),
      text: node.textContent.trim(),
      rect: [rect.x, rect.y, rect.width, rect.height],
      style: Object.fromEntries([...style].map(key => [key, style.getPropertyValue(key)]))
    }
  }))
  await writeFile(path.join(desktop.root, `${name}.png`), image, { flag: 'wx' })
  result.scenes[name] = nodes
  // 3、只消费显式指定的原版运行结果，绝不覆写旧参考。
  if (process.env.MOMENTUM_PRESET_LIST_BEFORE) {
    const directory = process.env.MOMENTUM_PRESET_LIST_BEFORE
    const baseline = JSON.parse(await readFile(path.join(directory, 'preset-list-result.json'), 'utf8'))
    assert.equal(baseline.passed, true)
    assert.equal(baseline.sourceStatus, '')
    assert.deepEqual(nodes, baseline.scenes[name], `${name} 原版布局、属性与样式`)
    await assertSamePixels(image, await readFile(path.join(directory, `${name}.png`)), `${name} 原版卡片像素`)
  }
}

test('预设卡片：空列表、名称编辑、响应式展示、多选和右键删除', { timeout: 120000 }, async () => {
  // 1、隔离桌面中真实上传确定性 PSD，保护全部冻结参考。
  const references = await referenceDigest()
  const fixture = (await syntheticFixtures())[0]
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src'], { cwd: repository, encoding: 'utf8' }).trim(),
    scenes: {}, passed: false
  }
  console.log(`预设卡片回归证据：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-item.active .psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
    await stableCanvas(page)
    await page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
    await page.locator('.parts-list .empty-state').waitFor()
    await capture(desktop, 'empty', result)
    // 2、保存两张预设并通过原有双击、Enter 和失焦入口改名，消除自动名称的非确定性。
    for (let index = 0; index < 2; index++) {
      await page.getByTitle('添加当前画布为预设', { exact: true }).click()
      await page.waitForFunction(count => document.querySelectorAll('.preset-item').length === count, index + 1)
      const card = page.locator('.preset-item').last()
      await card.locator('.part-name span').dblclick()
      const input = card.locator('.preset-name-input')
      await input.fill(`预设卡片验证${index + 1}完整名称`)
      await input.press(index === 0 ? 'Enter' : 'Tab')
      await input.waitFor({ state: 'detached' })
      assert.equal(await card.locator('.part-name').innerText(), `预设卡片验证${index + 1}完整名称`)
    }
    for (const width of [1024, 800, 600, 400]) {
      await page.setViewportSize({ width, height: 700 })
      await capture(desktop, `cards-${width}`, result)
    }
    // 3、选择、图片点击阻止冒泡、多选和右键删除均走真实鼠标事件。
    await page.setViewportSize({ width: 1024, height: 700 })
    await page.locator('.preset-item').first().locator('img').click()
    await stableCanvas(page)
    assert.equal(await page.locator('.preset-item').first().evaluate(node => node.classList.contains('active')), true)
    for (const card of [page.locator('.preset-item').first(), page.locator('.preset-item').last()]) {
      if (!(await card.evaluate(node => node.classList.contains('multi-selected')))) {
        await card.click({ modifiers: ['Meta'], position: { x: 3, y: 3 } })
      }
    }
    assert.equal(await page.locator('.preset-item.multi-selected').count(), 2)
    await capture(desktop, 'multiple', result)
    await page.locator('.preset-item').first().click({ button: 'right', position: { x: 3, y: 3 } })
    await page.locator('.context-menu-item').click()
    await page.locator('.n-dialog').filter({ hasText: '确认删除' }).getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.preset-item').waitFor({ state: 'detached' })
    await capture(desktop, 'deleted', result)
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    result.passed = true
  } finally {
    // 4、失败也保存结果并检查输入与参考未变化。
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references)
    await writeFile(path.join(desktop.root, 'preset-list-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  }
})
