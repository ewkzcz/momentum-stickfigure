/** 原 HEAD 选择协调诊断：保留正面恢复的严格断言；单独执行，不掩盖已发现的旧行为。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'

/** 通过公开控件进入指定选择状态，不读取组件私有对象。 */
async function setControls(page, settings) {
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  for (const [name, checked] of Object.entries(settings)) await page.getByRole('checkbox', { name, exact: true }).setChecked(checked)
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  await stableCanvas(page, '.render-canvas', false)
}

/** 按实际标签和未选项点击，等待原绘制流程稳定。 */
async function choose(page, name) {
  await page.locator('.part-tab').and(page.getByRole('button', { name, exact: true })).click()
  await page.locator('.parts-virtual-items .part-item:not(.active)').first().click()
  await stableCanvas(page, '.render-canvas', false)
}

test('旧问题诊断：初始素材正面关闭再恢复应还原原像素', { timeout: 90000 }, async () => {
  // 1、明确运行命令为 node --test tests/diagnose-part-selection-original.mjs；它不是默认通配回归。
  const [fixture] = await fixtures()
  await verifyFixture(fixture.absolutePath, fixture.sha256)
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  console.log(`原有正面恢复问题诊断：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
    await stableCanvas(page)
    await setControls(page, { '互斥': true, '动作互斥': true, '正面': true })
    // 2、原始素材即可重现，不需要额外补手或互斥操作。
    const before = Buffer.from((await stableCanvas(page)).png, 'base64')
    await setControls(page, { '正面': false })
    await setControls(page, { '正面': true })
    const after = Buffer.from((await stableCanvas(page)).png, 'base64')
    await writeFile(path.join(desktop.root, 'front-before.png'), before)
    await writeFile(path.join(desktop.root, 'front-after.png'), after)
    // 2、保留原零容差正确性断言；禁止为迁移修改图像参考或修正业务算法。
    await assertSamePixels(after, before, 'front-restored-0')
    assert.deepEqual(desktop.errors, [])
  } finally {
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
  }
})

test('旧问题诊断：组合表情标签双击应清空子分组内容', { timeout: 90000 }, async () => {
  // 1、最短操作为上传、选择组合卡片、双击组合标签。
  const [fixture] = await fixtures()
  await verifyFixture(fixture.absolutePath, fixture.sha256)
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  console.log(`原有组合双击问题诊断：${desktop.root}`)
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
    await stableCanvas(page)
    await choose(page, '组合表情')
    await page.locator('.part-tab').and(page.getByRole('button', { name: '组合表情', exact: true })).dblclick({ delay: 30 })
    await stableCanvas(page)
    const state = await page.locator('.part-tab').evaluateAll((nodes) => nodes.filter((node) => /^(眉毛|眼睛|嘴)/.test(node.textContent.trim())).map((node) => ({ name: node.textContent.trim(), content: node.classList.contains('has-rendered') })))
    await writeFile(path.join(desktop.root, 'combined-double-click.json'), JSON.stringify(state, null, 2))
    // 2、保留原正确断言，失败只记录，不修改迁移职责的任何逻辑。
    for (const item of state) assert.equal(item.content, false, `${item.name}内容指示`)
  } finally {
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
  }
})
