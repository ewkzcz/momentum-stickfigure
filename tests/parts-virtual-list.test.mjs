/** 普通部件虚拟列表公开回归：采集原版 DOM、计算样式、响应式布局和列表滚动基线。 */
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

async function listState(page) {
  return page.locator('.parts-list').evaluate(root => {
    const nodes = [...root.querySelectorAll('*')]
    return {
      scrollTop: root.scrollTop,
      scrollHeight: root.scrollHeight,
      clientHeight: root.clientHeight,
      items: nodes.filter(node => node.classList.contains('part-item')).map(node => {
        const rect = node.getBoundingClientRect()
        const style = window.getComputedStyle(node)
        return { tag: node.tagName, attributes: Object.fromEntries([...node.attributes].filter(item => item.name !== 'scope' && !item.name.startsWith('data-v-')).map(item => [item.name, item.value])), text: node.textContent.trim(), rect: [rect.x, rect.y, rect.width, rect.height], style: Object.fromEntries([...style].map(key => [key, style.getPropertyValue(key)])) }
      }),
      dom: nodes.map(node => {
        const rect = node.getBoundingClientRect(); const style = window.getComputedStyle(node)
        return { tag: node.tagName, attributes: Object.fromEntries([...node.attributes].filter(item => item.name !== 'scope' && !item.name.startsWith('data-v-')).map(item => [item.name, item.value])), text: node.textContent.trim(), rect: [rect.x, rect.y, rect.width, rect.height], style: Object.fromEntries([...style].map(key => [key, style.getPropertyValue(key)])) }
      })
    }
  })
}

async function capture(desktop, name, result) {
  const { page } = desktop
  await page.evaluate(() => document.fonts.ready)
  await page.waitForFunction(() => document.querySelectorAll('.part-item').length > 0 || document.querySelector('.empty-state'))
  const list = page.locator('.parts-list')
  const image = await list.screenshot({ animations: 'disabled', caret: 'hide' })
  result.scenes[name] = await listState(page)
  await writeFile(path.join(desktop.root, `${name}.png`), image, { flag: 'wx' })
}

test('普通部件虚拟列表：空列表、普通部件、选中、尺寸、响应式和滚动', { timeout: 180000 }, async () => {
  const references = await referenceDigest()
  const fixture = (await syntheticFixtures())[0]
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application } = desktop
  const outHash = await directoryHash(path.join(repository, 'out'))
  const result = { sourceStatus: { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), outSha256: outHash }, fixture: { path: fixture.path, sha256: fixture.sha256 }, scenes: {}, passed: false }
  console.log(`普通部件列表原版基线：${desktop.root}`)
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
    // 先通过公开标签寻找真实空列表，避免把有部件的普通标签误判为空状态。
    const tabs = page.locator('.part-tab')
    let emptyTabFound = false
    for (let index = 0; index < await tabs.count(); index++) {
      await tabs.nth(index).click()
      if (await page.locator('.parts-list .empty-state').count()) { emptyTabFound = true; break }
    }
    assert.equal(emptyTabFound, true, '必须存在可见的空列表标签')
    await page.locator('.parts-list .empty-state').waitFor()
    await capture(desktop, 'empty', result)
    // 公开合成素材使用前手/表情等默认图组名，按真实虚拟列表节点选标签，不写死私人素材标签。
    let ordinaryFound = false
    for (let index = 0; index < await tabs.count(); index++) {
      await tabs.nth(index).click()
      if (await page.locator('.parts-virtual-items .part-item').count()) { ordinaryFound = true; break }
    }
    assert.equal(ordinaryFound, true, '必须存在带虚拟列表项的普通部件标签')
    await page.locator('.parts-virtual-items .part-item').first().waitFor()
    await capture(desktop, 'ordinary-1024', result)
    await page.locator('.part-item').first().click()
    await stableCanvas(page)
    await capture(desktop, 'selected-1024', result)
    const size = page.locator('.size-control-input')
    await size.fill('200'); await size.press('Enter'); await stableCanvas(page)
    await capture(desktop, 'size-200', result)
    for (const width of [800, 600, 400]) { await page.setViewportSize({ width, height: 700 }); await capture(desktop, `selected-${width}`, result) }
    await page.setViewportSize({ width: 1024, height: 700 })
    const list = page.locator('.parts-list'); await list.hover(); await page.mouse.wheel(0, 100000)
    await page.waitForFunction(() => { const node = document.querySelector('.parts-list'); return node.scrollTop > 0 || node.scrollHeight <= node.clientHeight })
    await capture(desktop, 'scrolled', result)
    const graph = page.locator('.part-tab').filter({ hasText: /图组/ })
    if (await graph.count()) { await graph.first().click(); await page.locator('.parts-list').waitFor(); await capture(desktop, 'graph-if-visible', result) }
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    result.passed = true
    if (process.env.MOMENTUM_PARTS_LIST_BEFORE) {
      // 只核对公开场景与像素；迁移后 out 产物哈希必然变化，不得拿来当行为断言。
      const beforeRoot = process.env.MOMENTUM_PARTS_LIST_BEFORE
      const before = JSON.parse(await readFile(path.join(beforeRoot, 'parts-virtual-list-result.json'), 'utf8'))
      assert.equal(before.passed, true)
      assert.deepEqual(result.fixture, before.fixture)
      assert.deepEqual(Object.keys(result.scenes).sort(), Object.keys(before.scenes).sort(), '场景集合')
      assert.deepEqual(result.scenes, before.scenes, '原版列表公开 DOM、属性、矩形和计算样式')
      for (const name of Object.keys(result.scenes)) await assertSamePixels(await readFile(path.join(desktop.root, `${name}.png`)), await readFile(path.join(beforeRoot, `${name}.png`)), `${name} 原版列表像素`)
    }
  } finally {
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), references)
    await writeFile(path.join(desktop.root, 'parts-virtual-list-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  }
})
