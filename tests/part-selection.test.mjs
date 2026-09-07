/** 选择协调回归：实际点击覆盖取消、手部代理、三种互斥及正面过滤，参考保持只读。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 仅按用户可见名称定位标签。 */
function tab(page, name) {
  return page.locator('.part-tab').and(page.getByRole('button', { name, exact: true }))
}

/** 展示通用控制并设置实际复选框，收起后继续部件操作。 */
async function controls(page, settings) {
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  for (const [name, checked] of Object.entries(settings)) await page.getByRole('checkbox', { name, exact: true }).setChecked(checked)
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  await stableCanvas(page, '.render-canvas', false)
}

/** 读取公开 DOM 的标签内容指示和当前列表选择，不接触 Vue 内部实例。 */
async function selection(page) {
  return page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.part-tab')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active'), content: node.classList.contains('has-rendered') })),
    parts: [...document.querySelectorAll('.parts-virtual-items .part-item')].map((node) => ({ name: node.querySelector('.part-name').textContent.trim(), active: node.classList.contains('active') }))
  }))
}

/** 点击一个当前未选部件，返回其实际公开名称。 */
async function choose(page) {
  const item = page.locator('.parts-virtual-items .part-item:not(.active)').first()
  await item.waitFor()
  const name = (await item.locator('.part-name').innerText()).trim()
  await item.click()
  await stableCanvas(page, '.render-canvas', false)
  return name
}

/** 核验标签的实际内容指示。 */
async function expectContent(page, name, expected) {
  assert.equal(await tab(page, name).evaluate((node) => node.classList.contains('has-rendered')), expected, `${name}内容指示`)
}

test('部件选择协调：单双击取消、代理补手、三种互斥和正面显示过滤保持一致', { timeout: 180000 }, async () => {
  // 1、沿用两份授权素材；只保存本轮实际产物，不创建或更新任何参考目录。
  const samples = (await fixtures()).slice(0, 2)
  assert.equal(samples.length, 2)
  const references = await referenceDigest()
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const evidence = { boundary: '真实上传、鼠标单击/双击、公开 DOM 与画布；无 Vue 私有注入；不把多选图层树等同于单对象 selectedParts', fixtures: samples.map(({ id, sha256 }) => ({ id, sha256 })), scenes: [] }
  console.log(`部件选择协调证据：${desktop.root}`)
  /** 保存实际选择和像素，并对等价操作执行零容差检查。 */
  async function snapshot(name, sameImage = null) {
    const image = Buffer.from((await stableCanvas(page, '.render-canvas', false)).png, 'base64')
    if (sameImage) await assertSamePixels(image, sameImage, name)
    await writeFile(path.join(desktop.root, `${name}.png`), image)
    evidence.scenes.push({ name, state: await selection(page), pngSha256: createHash('sha256').update(image).digest('hex') })
    return image
  }
  try {
    await page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    for (const [index, fixture] of samples.entries()) {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      const fileTab = page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
      await fileTab.waitFor()
      await fileTab.click()
      await stableCanvas(page)
      await controls(page, { '互斥': true, '动作互斥': true, '表情互斥': true, '正面': true })
      await snapshot(`initial-${index}`)

      // 2、普通单选可取消并重选；同一部件恢复必须与本轮原图逐像素一致。
      await tab(page, '左手').click()
      const chosen = await choose(page)
      const selected = await snapshot(`single-${index}`)
      assert.deepEqual((await selection(page)).parts.filter((part) => part.active).map((part) => part.name), [chosen])
      const samePart = page.locator('.parts-virtual-items .part-item').filter({ has: page.locator('.part-name').getByText(chosen, { exact: true }) })
      await samePart.click()
      await snapshot(`deselect-${index}`)
      await expectContent(page, '左手', false)
      await samePart.click()
      await snapshot(`reselect-${index}`, selected)

      // 3、真实双击清空主组及右手代理；重复双击的空状态不能修改画布。
      await tab(page, '右手').click()
      await choose(page)
      await expectContent(page, '右手', true)
      await tab(page, '右手').dblclick({ delay: 30 })
      const emptyRight = await snapshot(`proxy-clear-${index}`)
      await expectContent(page, '右手', false)
      await tab(page, '右手').dblclick({ delay: 30 })
      await page.locator('.n-message').filter({ hasText: '当前没有显示的图层' }).first().waitFor()
      await snapshot(`proxy-clear-empty-${index}`, emptyRight)

      // 4、多选保留两个部件；双击按图层路径清空，不用数组当单对象取消。
      await controls(page, { '互斥': false, '动作互斥': false })
      await tab(page, '左手').click()
      await tab(page, '左手').dblclick({ delay: 30 })
      await stableCanvas(page, '.render-canvas', false)
      const first = await choose(page)
      const second = await choose(page)
      assert.notEqual(first, second)
      assert.deepEqual((await selection(page)).parts.filter((part) => part.active).map((part) => part.name).sort(), [first, second].sort())
      await snapshot(`multi-${index}`)
      await tab(page, '左手').dblclick({ delay: 30 })
      await snapshot(`multi-clear-${index}`)
      await expectContent(page, '左手', false)

      // 5、动作互斥关闭单手，重新选择左手时按原优先级补右手。
      await controls(page, { '互斥': true, '动作互斥': true })
      await tab(page, '双手').click()
      await choose(page)
      await snapshot(`both-hands-${index}`)
      await expectContent(page, '左手', false)
      await expectContent(page, '右手', false)
      await tab(page, '左手').click()
      await choose(page)
      await snapshot(`ensure-right-${index}`)
      await expectContent(page, '双手', false)
      await expectContent(page, '右手', true)

      // 6、表情互斥覆盖同类别与独立表情；眉眼嘴之间保持各自选择。
      const names = (await selection(page)).tabs.map((item) => item.name)
      if (index === 0) {
        const eyebrows = names.filter((name) => name.startsWith('眉毛'))
        const eye = names.find((name) => name.startsWith('眼睛'))
        assert.equal(eyebrows.length, 2)
        assert.ok(eye)
        for (const name of eyebrows) { await tab(page, name).click(); await choose(page) }
        await expectContent(page, eyebrows[0], false)
        await expectContent(page, eyebrows[1], true)
        await tab(page, eye).click()
        await choose(page)
        await expectContent(page, eyebrows[1], true)
        await snapshot('expression-category')
        await tab(page, '组合表情').click()
        await choose(page)
        await snapshot('combined-selected')
        assert.ok((await selection(page)).parts.some((part) => part.active), '组合表情必须实际选中')
        // 组合标签双击的原有空状态问题保留在独立诊断；这里验证组合卡片自身的取消入口。
        await page.locator('.parts-virtual-items .part-item.active').first().click()
        await snapshot('combined-deselected')
        assert.equal((await selection(page)).parts.some((part) => part.active), false)
      } else {
        await tab(page, '表情').click()
        await choose(page)
        await tab(page, '专属表情').click()
        await choose(page)
        await expectContent(page, '表情', false)
        await expectContent(page, '表情2', false)
        await snapshot('standalone-expression')
      }
      // 7、正面只过滤显示，选中和内容指示不受影响；恢复像素的旧问题由独立严格诊断保留。
      const frontSelection = await selection(page)
      const frontImage = await snapshot(`front-original-${index}`)
      await controls(page, { '正面': false })
      const hiddenFront = await snapshot(`front-hidden-${index}`)
      assert.deepEqual(await selection(page), frontSelection)
      assert.notDeepEqual(hiddenFront, frontImage, '关闭正面必须实际改变画布')
      await controls(page, { '正面': true })
      assert.deepEqual(await selection(page), frontSelection)
      await snapshot(`front-restored-${index}`)
    }
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) {
    evidence.failure = error.stack
    throw error
  } finally {
    await writeFile(path.join(desktop.root, 'part-selection-result.json'), JSON.stringify(evidence, null, 2))
    await desktop.close()
    for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references, '选择测试前后全部参考必须不变')
    // 8、迁移验收可显式指定同次原 HEAD 产物作只读对照；普通回归不依赖临时目录。
    if (evidence.passed && process.env.MOMENTUM_PART_SELECTION_BEFORE) {
      const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_PART_SELECTION_BEFORE, 'part-selection-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(evidence.fixtures, before.fixtures)
      assert.deepEqual(evidence.scenes, before.scenes, '迁移前后每个实际选择场景和图像哈希必须一致')
      for (const scene of evidence.scenes) await assertSamePixels(await readFile(path.join(desktop.root, `${scene.name}.png`)), await readFile(path.join(process.env.MOMENTUM_PART_SELECTION_BEFORE, `${scene.name}.png`)), scene.name)
      console.log(`部件选择迁移前后 ${evidence.scenes.length} 场景 DOM、哈希和 RGBA 全部一致`)
    }
  }
})
