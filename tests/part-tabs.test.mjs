/** 部件标签编排回归：两份本地 PSD 经真实页面拖动、切换、重置及跨文件往返。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures, referenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { sessionReferenceName } from './scenarios/psd-session.mjs'

/** 根据公开按钮文本定位部件标签，避免触及 Vue 实例和会话键。 */
function partTab(page, name) {
  return page.locator('.part-tab').and(page.getByRole('button', { name, exact: true }))
}

/** 读取实际两行的 DOM 顺序，并验证每个标签仍位于所属行的高度范围。 */
async function rows(page) {
  return page.locator('.parts-tabs').evaluateAll((containers) => containers.map((container) => {
    const bounds = container.getBoundingClientRect()
    return [...container.querySelectorAll('.part-tab')].map((node) => {
      const rect = node.getBoundingClientRect()
      if (rect.height <= 0 || rect.top < bounds.top || rect.bottom > bounds.bottom + 1) {
        throw new Error(`标签没有在对应行中显示：${node.textContent.trim()}`)
      }
      return node.textContent.trim()
    })
  }))
}

/** 对真实 DOM 分发标准拖放事件；覆盖页面处理器，不声称覆盖操作系统原生拖放手势。 */
async function drag(page, source, target, position, containerRow = null) {
  return page.evaluate(async ({ source, target, position, containerRow }) => {
    const tabs = [...document.querySelectorAll('.part-tab')]
    const from = tabs.find((node) => node.textContent.trim() === source)
    const to = containerRow ? document.querySelector(`.parts-tabs-row-${containerRow}`) : tabs.find((node) => node.textContent.trim() === target)
    if (!from || !to) throw new Error('拖动源或目标不存在')
    const transfer = new window.DataTransfer()
    const rect = to.getBoundingClientRect()
    const clientX = position === 'before' ? rect.left + 1 : rect.right - 1
    const emit = (node, type) => node.dispatchEvent(new window.DragEvent(type, {
      bubbles: true, cancelable: true, dataTransfer: transfer, clientX, clientY: rect.top + rect.height / 2
    }))
    emit(from, 'dragstart')
    if (from.style.opacity !== '0.5') throw new Error('拖动开始没有更新视觉反馈')
    emit(to, 'dragover')
    await new Promise(requestAnimationFrame)
    if (!containerRow && !to.classList.contains(`drag-over-${position}`)) {
      throw new Error('拖动悬停没有显示对应插入位置')
    }
    emit(to, 'drop')
    emit(from, 'dragend')
    if (from.style.opacity !== '1') throw new Error('拖动结束没有恢复视觉反馈')
  }, { source, target, position, containerRow })
}

/** 等待一轮实际页面更新后严格核验两行顺序。 */
async function expectRows(page, expected, label) {
  await page.evaluate(() => new Promise(requestAnimationFrame))
  assert.deepEqual(await rows(page), expected, label)
  assert.equal(await page.locator('.drag-over-before, .drag-over-after').count(), 0, '结束后不能残留拖动提示')
}

test('部件标签：两份 PSD 的行内拖动、固定分行、切换及重置保持一致', { timeout: 180000 }, async () => {
  // 1、引用已存在的只读会话目录核验初始标签；图像只比较本次运行的等价操作，不建立新参考。
  const samples = (await fixtures()).slice(0, 2)
  assert.equal(samples.length, 2)
  assert.notEqual(samples[0].sha256, samples[1].sha256)
  const reference = JSON.parse(await readFile(path.join(referenceDirectory, sessionReferenceName, 'manifest.json'), 'utf8'))
  const row2Names = ['动作模板', '表情模板', '预设', '上身', '下身']
  const expectedRows = samples.map((_fixture, index) => {
    const names = reference.scenes.find((scene) => scene.name === `initial-${index}`).state.tabs.map((tab) => tab.name)
    return [names.filter((name) => !row2Names.includes(name)), names.filter((name) => row2Names.includes(name))]
  })
  const desktop = await launchDesktop(undefined, 'software-layout')
  const evidence = { boundary: '公开上传；真实 DOM 标准 DragEvent；真实鼠标单击；不覆盖操作系统原生拖动，不读取或注入 Vue 私有状态', fixtures: samples.map(({ id, sha256 }) => ({ id, sha256 })), scenes: [] }
  console.log(`部件标签排序回归证据：${desktop.root}`)
  const initialImages = []
  /** 保存实际行序与画布，便于对迁移前后结果进行复核。 */
  async function snapshot(name, sameImage = null) {
    const image = Buffer.from((await stableCanvas(desktop.page)).png, 'base64')
    if (sameImage) await assertSamePixels(image, sameImage, name)
    await writeFile(path.join(desktop.root, `${name}.png`), image)
    evidence.scenes.push({ name, rows: await rows(desktop.page), active: (await desktop.page.locator('.part-tab.active').innerText()).trim(), pngSha256: createHash('sha256').update(image).digest('hex') })
    return image
  }
  try {
    await desktop.page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await desktop.page.context().newCDPSession(desktop.page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    for (const [index, fixture] of samples.entries()) {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
      const fileTab = desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
      await fileTab.waitFor()
      await fileTab.click()
      initialImages[index] = await snapshot(`initial-${index}`)
      const initial = expectedRows[index]
      await expectRows(desktop.page, initial, '初始两行必须匹配既有会话参考')
      assert.ok(initial[0].length >= 3 && initial[1].length >= 3, '素材必须包含足够的标签用于真实排序')

      // 2、分别拖动两行末项到首项之前，再拖到行空白末尾，逐项核验实际 DOM 顺序。
      const reordered = initial.map((row) => [...row])
      for (let row = 0; row < 2; row++) {
        const source = reordered[row].at(-1)
        await drag(desktop.page, source, reordered[row][0], 'before')
        reordered[row] = [source, ...reordered[row].slice(0, -1)]
        await expectRows(desktop.page, reordered, `素材${index}第${row + 1}行前插`)
        await snapshot(`before-${index}-${row}`, initialImages[index])
        await drag(desktop.page, source, null, 'after', row + 1)
        reordered[row] = [...reordered[row].slice(1), source]
        await expectRows(desktop.page, reordered, `素材${index}第${row + 1}行容器末尾`)
      }
      // 3、跨行拖动只改变自定义顺序，分类行保持原算法；源标签排到其原行末尾。
      const source = reordered[0][0]
      await drag(desktop.page, source, reordered[1][0], 'after')
      reordered[0] = [...reordered[0].slice(1), source]
      await expectRows(desktop.page, reordered, '跨行放置不得改变标签分类行')
      await snapshot(`cross-row-${index}`, initialImages[index])

      // 4、真实鼠标单击左右手、动态表情、上下身和模板预设，切换列表但不改变画布。
      const switches = [...new Set([initial[0][0], '右手', ...initial[0].filter((name) => /表情|眉|眼|嘴/.test(name)).slice(0, 2), ...initial[1]])].filter((name) => initial.flat().includes(name))
      for (const name of switches) {
        await partTab(desktop.page, name).click()
        assert.equal((await desktop.page.locator('.part-tab.active').innerText()).trim(), name)
        if (!['动作模板', '表情模板', '预设'].includes(name)) {
          await desktop.page.locator('.parts-virtual-items .part-item').first().waitFor()
        }
        await snapshot(`switch-${index}-${switches.indexOf(name)}`, initialImages[index])
        await expectRows(desktop.page, reordered, '切换标签不能触发重新排序')
      }
      await desktop.page.getByTitle('重置标签排序', { exact: true }).click()
      await expectRows(desktop.page, initial, '重置入口必须恢复原始两行顺序')
      await snapshot(`reset-${index}`, initialImages[index])
      await desktop.page.getByTitle('重置标签排序', { exact: true }).click()
      await desktop.page.locator('.n-message').filter({ hasText: '标签已是默认排序' }).first().waitFor()
      await expectRows(desktop.page, initial, '重复重置必须保持默认顺序')
    }
    // 5、往返两个不同目录的 PSD，验证首次排序缓存被原会话入口重置，没有残留另一文件的标签。
    for (const index of [0, 1, 0, 1]) {
      await desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(path.basename(samples[index].absolutePath), { exact: true })).click()
      await snapshot(`return-${evidence.scenes.length}-${index}`, initialImages[index])
      await expectRows(desktop.page, expectedRows[index], '跨 PSD 后必须重新建立各自完整标签目录')
    }
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) {
    evidence.failure = error.stack
    throw error
  } finally {
    await writeFile(path.join(desktop.root, 'part-tabs-result.json'), JSON.stringify(evidence, null, 2))
    await desktop.close()
    for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  }
})
