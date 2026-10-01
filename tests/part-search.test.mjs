/** 部件搜索回归：两份授权 PSD 通过公开输入、过滤和单双击确认，与同轮手动选择逐像素相等。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const tab = (page, name) => page.locator('.part-tab').and(page.getByRole('button', { name, exact: true }))

/** 读取真实标签与列表定位；不读取 Vue 私有实例或虚拟列表内部状态。 */
async function browsingState(page) {
  // 1、只采集公开 DOM、滚动位置与高亮样式类。
  return page.evaluate(() => {
    const list = document.querySelector('.parts-list')
    return {
      tabs: [...document.querySelectorAll('.part-tab')].map(node => ({ name: node.textContent.trim(), active: node.classList.contains('active'), content: node.classList.contains('has-rendered') })),
      parts: [...list.querySelectorAll('.part-item')].map(node => ({ name: node.querySelector('.part-name').textContent.trim(), active: node.classList.contains('active'), highlighted: node.classList.contains('search-highlighted') })),
      scrollTop: list.scrollTop,
      maximumScrollTop: list.scrollHeight - list.clientHeight,
      virtualOffset: list.querySelector('.parts-virtual-items').style.transform
    }
  })
}

test('部件搜索：两份 PSD 过滤、单双击确认、代理标签、高亮和滚动与手动选择像素一致', { timeout: 180000 }, async () => {
  // 1、只读已有授权素材与全部参考；每轮实际画布保存在隔离桌面，不新增永久参考。
  const samples = (await fixtures()).slice(0, 2)
  assert.equal(samples.length, 2)
  const references = await referenceDigest()
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const evidence = { desktopId: path.basename(desktop.root), scope: '真实上传与公开 DOM 输入/过滤/单击/双击；右手代理来源；同轮手动选择零容差 RGBA；不修改旧诊断', fixtures: samples.map(({ id, sha256 }) => ({ id, sha256 })), scenes: [], passed: false }
  console.log(`部件搜索回归 desktopId：${evidence.desktopId}`)
  try {
    await page.setViewportSize({ width: 800, height: 700 })
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    const size = page.locator('.size-control-input')
    await size.fill('200')
    await size.press('Enter')
    for (const [index, fixture] of samples.entries()) {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
      await page.getByRole('button', { name: '上传', exact: true }).click()
      const fileTab = page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
      await fileTab.waitFor()
      await fileTab.click()
      await page.waitForFunction(name => document.querySelector('.psd-tab-item.active .psd-tab-name')?.getAttribute('title') === name, path.basename(fixture.absolutePath))
      await stableCanvas(page)
      await tab(page, '右手').click()
      await stableCanvas(page)

      // 2、用真实滚轮到列表底部，选择末项代理部件作为本轮手动基准。
      const list = page.locator('.parts-list')
      await list.hover()
      await page.mouse.wheel(0, 100000)
      await page.waitForFunction(() => {
        const list = document.querySelector('.parts-list')
        return list.scrollTop > 0 && list.scrollTop === list.scrollHeight - list.clientHeight
      })
      await stableCanvas(page)
      const candidate = page.locator('.parts-virtual-items .part-item:not(.active)').last()
      const name = (await candidate.locator('.part-name').innerText()).trim()
      const keyword = await candidate.locator('img').getAttribute('alt')
      assert.match(name, /^(前手|后手|前层后手)-/, '必须覆盖右手真实代理显示名称')
      const card = page.locator('.parts-virtual-items .part-item').filter({ has: page.locator('.part-name').getByText(name, { exact: true }) })
      await card.click()
      await page.waitForFunction(name => [...document.querySelectorAll('.parts-virtual-items .part-item.active')].some(node => node.querySelector('.part-name').textContent.trim() === name), name)
      const manual = Buffer.from((await stableCanvas(page)).png, 'base64')
      const manualTabs = (await browsingState(page)).tabs
      await writeFile(path.join(desktop.root, `manual-${index}.png`), manual, { flag: 'wx' })
      await card.click()
      await page.waitForFunction(name => ![...document.querySelectorAll('.parts-virtual-items .part-item.active')].some(node => node.querySelector('.part-name').textContent.trim() === name), name)
      const deselected = Buffer.from((await stableCanvas(page)).png, 'base64')
      assert.notDeepEqual(deselected, manual, '手动取消必须实际改变画布，不能用未变化的画布假通过')
      await tab(page, '左手').click()
      await stableCanvas(page)

      // 3、实际输入及类型过滤后确认搜索结果；不能直接向页面发送选择对象。
      await page.getByTitle('搜索动作和表情', { exact: true }).click()
      const input = page.getByPlaceholder('请输入搜索关键词')
      await input.fill(`  ${keyword}  `)
      await page.locator('.search-type-selector .n-radio').filter({ hasText: '表情' }).click()
      await input.press('Enter')
      assert.equal(await page.locator('.result-category').getByText('右手', { exact: true }).count(), 0, '表情过滤不能泄漏手部结果')
      await page.locator('.search-type-selector .n-radio').filter({ hasText: '动作' }).click()
      await page.locator('.part-search-panel').getByRole('button', { name: '搜索', exact: true }).click()
      const result = page.locator('.search-result-item').filter({ has: page.locator('.result-category').getByText('右手', { exact: true }) }).filter({ has: page.locator('.result-name').getByText(keyword, { exact: true }) })
      await result.waitFor()
      const results = await page.locator('.search-result-item').evaluateAll(nodes => nodes.map(node => ({ category: node.querySelector('.result-category').textContent.trim(), name: node.querySelector('.result-name').textContent.trim() })))
      if (index === 0) await result.click()
      else await result.dblclick({ delay: 30 })
      await page.waitForFunction(name => document.querySelector('.part-tab.active')?.textContent.trim() === '右手' && [...document.querySelectorAll('.parts-virtual-items .part-item.active.search-highlighted')].some(node => node.querySelector('.part-name').textContent.trim() === name), name)
      const search = Buffer.from((await stableCanvas(page)).png, 'base64')
      await assertSamePixels(search, manual, `${fixture.id} 搜索选择与同轮手动选择`)
      await writeFile(path.join(desktop.root, `search-${index}.png`), search, { flag: 'wx' })
      assert.equal(await page.locator('.part-search-panel').isVisible(), index === 0, '单击保留弹窗，双击应用后关闭')
      const state = await browsingState(page)
      assert.deepEqual(state.tabs, manualTabs, '搜索应用后的全部标签、活动标签和绿点必须与同轮手动选择一致')
      assert.ok(state.scrollTop > 0, '原搜索定位必须实际滚动，不被标签 watch 重置')
      assert.notEqual(state.virtualOffset, 'translateY(0px)', '虚拟列表必须实际滚动，而非仅改变标签')
      assert.ok(state.tabs.find(item => item.name === '右手').content)
      const geometry = await card.evaluate(node => {
        const rect = node.getBoundingClientRect()
        const list = node.closest('.parts-list').getBoundingClientRect()
        return { intersects: rect.bottom > list.top && rect.top < list.bottom }
      })
      assert.equal(geometry.intersects, true, '高亮目标必须出现在滚动容器视口中')
      if (index === 0) await page.getByTitle('关闭（ESC键 / 点击外部）', { exact: true }).click()

      // 4、基线实际保留九秒高亮：三秒时仍在，九秒计时结束后自动消失，不更改生产定时器。
      await page.waitForTimeout(3000)
      assert.equal(await card.evaluate(node => node.classList.contains('search-highlighted')), true)
      await page.waitForFunction(() => !document.querySelector('.search-highlighted'), null, { timeout: 10000 })
      assert.equal(await card.evaluate(node => node.classList.contains('active')), true, '清除高亮不能取消部件')
      evidence.scenes.push({ fixtureId: fixture.id, name, keyword, confirmation: index === 0 ? 'single' : 'double', results, state, manualPngSha256: hash(manual), searchPngSha256: hash(search), differentPixels: 0, tabsEqualToManual: true, highlightedAtThreeSeconds: true, highlightCleared: true })
    }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    if (process.env.MOMENTUM_PART_SEARCH_BEFORE) {
      const beforeRoot = process.env.MOMENTUM_PART_SEARCH_BEFORE
      const before = JSON.parse(await readFile(path.join(beforeRoot, 'part-search-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(evidence.fixtures, before.fixtures)
      assert.deepEqual(evidence.scenes, before.scenes, '迁移前后搜索结果、标签、选中、高亮、滚动和画布必须一致')
      for (const index of samples.keys()) await assertSamePixels(await readFile(path.join(desktop.root, `search-${index}.png`)), await readFile(path.join(beforeRoot, `search-${index}.png`)), `搜索迁移前后 ${index}`)
      evidence.beforeDesktopId = path.basename(beforeRoot)
      evidence.beforeAfterDifferentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message.replaceAll(desktop.root, evidence.desktopId) }
    await page.screenshot({ path: path.join(desktop.root, 'part-search-failure.png') }).catch(() => {})
    throw error
  } finally {
    await desktop.close()
    for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references, '搜索前后全部参考必须保持不变')
    evidence.referenceFiles = Object.keys(references).length
    evidence.referenceDigestSha256 = hash(JSON.stringify(references))
    await writeFile(path.join(desktop.root, 'part-search-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
