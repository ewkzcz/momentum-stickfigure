/** 模板编排的公开界面回归：先在原 HEAD 运行，迁移后可显式只读对照本次临时产物。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

/** 通过公开标签切换，避免对当前标签重复点击产生双击语义。 */
async function selectTab(page, name) {
  const tab = page.locator('.part-tab').and(page.getByRole('button', { name, exact: true }))
  if (!(await tab.evaluate(node => node.classList.contains('active')))) await tab.click()
}

/** 等待原有过渡结束后采样真实主画布，不改变生产延时和绘图。 */
async function image(page) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('.render-canvas')
    return canvas?.style.opacity === '1' && !document.querySelector('.canvas-container.rendering-template')
  })
  return Buffer.from((await stableCanvas(page)).png, 'base64')
}

/** 点击指定名称的真实部件，只在未选中时操作。 */
async function choose(page, tabName, name) {
  await selectTab(page, tabName)
  const part = page.locator('.parts-virtual-items .part-item').filter({ has: page.locator('.part-name').getByText(name, { exact: true }) })
  await part.waitFor()
  if (!(await part.evaluate(node => node.classList.contains('active')))) await part.locator('.part-name').click()
  await image(page)
}

/** 读取用户可见标签内容指示、当前部件选择及过渡的最终状态。 */
async function dom(page) {
  return page.evaluate(() => ({
    tabs: [...document.querySelectorAll('.part-tab')].map(node => ({ name: node.textContent.trim(), active: node.classList.contains('active'), content: node.classList.contains('has-rendered') })),
    parts: [...document.querySelectorAll('.parts-virtual-items .part-item')].map(node => ({ name: node.querySelector('.part-name').textContent.trim(), active: node.classList.contains('active') })),
    opacity: document.querySelector('.render-canvas').style.opacity,
    rendering: Boolean(document.querySelector('.canvas-container.rendering-template'))
  }))
}

/** 只读实际存储输出；预览必须真实落盘并由图像解码器读取全部 RGBA。 */
async function previewOutput(desktop, type, count, name) {
  const key = `stickfigure-${type}-templates`
  await desktop.page.waitForFunction(({ key, count }) => {
    const output = JSON.parse(localStorage.getItem(key) || '{}')
    return output.templates?.length === count && output.image_file_paths?.length === count
  }, { key, count })
  const output = await desktop.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)
  const template = output.templates.at(-1)
  assert.ok(template.config.length > 0, '实际保存的模板配置必须非空')
  const file = output.image_file_paths.find(item => item.id === template.id)
  assert.ok(file, '配置必须有对应的真实预览文件')
  const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
  const bytes = await readFile(path.join(userData, file.file_path))
  assert.equal(bytes.subarray(0, 3).toString('hex'), 'ffd8ff', '保持实际 JPEG 图片格式')
  const decoded = await decodePng(bytes)
  assert.ok(decoded.width > 0 && decoded.width <= 800 && decoded.height > 0 && decoded.height <= 800)
  assert.ok(decoded.rgba.some((value, index) => index % 4 !== 3 && value > 0), '解码预览必须包含可见颜色')
  await writeFile(path.join(desktop.root, `${name}.jpg`), bytes, { flag: 'wx' })
  return { name, config: template.config, width: decoded.width, height: decoded.height, fileSha256: hash(bytes), rgbaSha256: hash(decoded.rgba) }
}

test('模板应用与预览：动作/表情保存后改选，卡片及右键应用恢复相同 DOM 和画布', { timeout: 180000 }, async () => {
  // 1、沿用三种确定性真实 PSD 输入，独立覆盖图层蒙版、剪切组及混合透明度。
  const fixtures = await syntheticFixtures()
  assert.equal(fixtures.length, 3)
  const references = await referenceDigest()
  const desktop = await launchDesktop()
  const { page, application } = desktop
  const evidence = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), desktopId: path.basename(desktop.root), fixtures: fixtures.map(({ id, sha256 }) => ({ id, sha256 })), scenes: [], previews: [], comparisons: [], passed: false }
  console.log(`模板应用编排证据：${desktop.root}`)
  /** 保存实际 DOM 与图像；预期来自本轮同输入同选择，不创建永久参考。 */
  async function snapshot(name, expected) {
    const bytes = await image(page)
    if (expected) {
      await assertSamePixels(bytes, expected, name)
      evidence.comparisons.push({ name, differentPixels: 0 })
    }
    await writeFile(path.join(desktop.root, `${name}.png`), bytes, { flag: 'wx' })
    evidence.scenes.push({ name, dom: await dom(page), pngSha256: hash(bytes) })
    return bytes
  }
  try {
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    for (const [index, fixture] of fixtures.entries()) {
      await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      const fileTab = page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
      await fileTab.waitFor()
      await fileTab.click()
      await assertSamePixels(await image(page), await readFile(path.join(syntheticReferenceDirectory, fixture.id, 'initial.png')), `${fixture.id} 原有初始参考`)
      const handNames = (await dom(page)).tabs.map(item => item.name).filter(name => /^(左手|前手)$/.test(name))
      assert.equal(handNames.length, 1)
      const hand = handNames[0]
      await choose(page, hand, '招手')
      await choose(page, '表情', '微笑')
      const saved = await snapshot(`saved-${index}`)

      // 2、保存两种模板，逐项真实解码预览并确认生成前后主画布未改变。
      for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
        await page.getByTitle(`保存当前${label}配置为${label}模板`, { exact: true }).click()
        evidence.previews.push(await previewOutput(desktop, type, index + 1, `${type}-preview-${index}`))
        await snapshot(`${type}-save-restored-${index}`, saved)
      }

      // 3、两种入口都从真实改选开始；应用动作只恢复动作，表情只恢复表情。
      for (const method of ['card', 'context']) {
        await choose(page, hand, '自然垂手')
        await choose(page, '表情', '平静')
        const changed = await snapshot(`${method}-changed-${index}`)
        assert.notDeepEqual(changed, saved, '改选必须真实改变画布')
        // 同轮直接点击同一输入部件得到动作应用的期望，同时保留另一种类型的改选。
        await choose(page, hand, '招手')
        const actionExpected = await snapshot(`${method}-action-expected-${index}`)
        const expectedParts = (await dom(page)).parts
        await choose(page, hand, '自然垂手')
        for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
          await selectTab(page, `${label}模板`)
          const card = page.locator('.template-item').last()
          if (method === 'card') await card.locator('.template-card-body').click()
          else {
            await card.click({ button: 'right' })
            const menu = page.locator('.template-context-menu.detail-mode')
            await menu.waitFor()
            assert.ok((await menu.innerText()).includes(type === 'action' ? '招手' : '微笑'))
            await menu.getByRole('button', { name: '应用', exact: true }).click()
            await menu.waitFor({ state: 'detached' })
          }
          await image(page)
          assert.equal((await dom(page)).tabs.find(item => item.active).name, `${label}模板`, '应用保持模板标签，不跳转')
          await selectTab(page, type === 'action' ? hand : '表情')
          if (type === 'action') assert.deepEqual((await dom(page)).parts, expectedParts, '动作模板恢复同一部件 DOM 选择')
          else assert.deepEqual((await dom(page)).parts.filter(part => part.active).map(part => part.name), ['微笑'])
          await snapshot(`${method}-${type}-applied-${index}`, type === 'action' ? actionExpected : saved)
        }
      }
    }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    // 4、显式原 HEAD 临时目录逐项对照；普通全量测试仍独立运行，不依赖临时参考。
    if (process.env.MOMENTUM_TEMPLATE_BEFORE) {
      const beforeRoot = process.env.MOMENTUM_TEMPLATE_BEFORE
      const before = JSON.parse(await readFile(path.join(beforeRoot, 'template-application-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(evidence.fixtures, before.fixtures)
      assert.deepEqual(evidence.scenes, before.scenes, '迁移前后所有场景 DOM 和画布哈希一致')
      assert.deepEqual(evidence.previews, before.previews, '迁移前后每份配置、真实预览文件及解码 RGBA 一致')
      for (const scene of evidence.scenes) await assertSamePixels(await readFile(path.join(desktop.root, `${scene.name}.png`)), await readFile(path.join(beforeRoot, `${scene.name}.png`)), scene.name)
      for (const preview of evidence.previews) await assertSamePixels(await readFile(path.join(desktop.root, `${preview.name}.jpg`)), await readFile(path.join(beforeRoot, `${preview.name}.jpg`)), preview.name)
      evidence.beforeDesktopId = path.basename(beforeRoot)
      evidence.beforeAfterDifferentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message }
    await page.screenshot({ path: path.join(desktop.root, 'template-application-failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.close()
    for (const fixture of fixtures) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references, '全部原有参考必须保持不变')
    evidence.referenceFiles = Object.keys(references).length
    evidence.referenceDigestSha256 = hash(JSON.stringify(references))
    await writeFile(path.join(desktop.root, 'template-application-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
