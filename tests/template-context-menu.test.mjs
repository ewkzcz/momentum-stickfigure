/** 右键菜单展示回归：公开入口构造菜单，保护既有参考，保存稳定截图与布局。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { assertSamePixels, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 采集稳定菜单截图和全部节点的布局、计算样式；可与显式指定的原版运行目录对照。 */
async function captureMenu(desktop, name, result) {
  // 1、移开鼠标，等待字体和连续截图一致，不使用固定延迟假定画面稳定。
  const { page } = desktop
  const menu = page.locator('.template-context-menu')
  await page.mouse.move(2, 2)
  await page.evaluate(() => document.fonts.ready)
  let previous
  let image
  let stable = false
  for (let attempt = 0; attempt < 12; attempt++) {
    image = await menu.screenshot({ animations: 'disabled' })
    if (previous?.equals(image)) {
      stable = true
      break
    }
    previous = image
  }
  assert.ok(stable, `${name} 菜单截图必须稳定`)
  await writeFile(path.join(desktop.root, `${name}.png`), image, { flag: 'wx' })
  // 2、只读取公开 DOM，忽略提取后必然变化的 Vue scope 属性，其余属性、文字和样式完整比较。
  const layout = await page.evaluate(() => {
    const menu = document.querySelector('.template-context-menu')
    return [menu, ...menu.querySelectorAll('*'), document.querySelector('.context-menu-overlay')].map(node => {
      const rect = node.getBoundingClientRect()
      const style = window.getComputedStyle(node)
      return {
        tag: node.tagName,
        attributes: Object.fromEntries([...node.attributes].filter(attribute => !attribute.name.startsWith('data-v-')).map(attribute => [attribute.name, attribute.value])),
        text: node.textContent.trim(),
        parentClass: node.parentElement.className,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        style: Object.fromEntries([...style].map(property => [property, style.getPropertyValue(property)]))
      }
    })
  })
  result.scenes[name] = { layout, pngSha256: createHash('sha256').update(image).digest('hex') }
  assert.equal(layout[0].parentClass, 'action-expression-panel')
  assert.equal(layout.at(-1).parentClass, 'action-expression-panel')
  // 3、跨构建比较仅消费已有基线，不自动生成或覆写参考文件。
  if (process.env.TEMPLATE_CONTEXT_MENU_BASELINE) {
    const directory = process.env.TEMPLATE_CONTEXT_MENU_BASELINE
    const baseline = JSON.parse(await readFile(path.join(directory, 'template-context-menu-result.json'), 'utf8'))
    assert.equal(baseline.completed, true)
    assert.equal(baseline.sourceStatus, '', '跨构建参考必须来自未修改业务源码的原版')
    assert.deepEqual(layout, baseline.scenes[name].layout, `${name} 原版/提取版 DOM、布局和计算样式`)
    await assertSamePixels(image, await readFile(path.join(directory, `${name}.png`)), `${name} 原版/提取版截图`)
    result.baselineId = baseline.id
  }
}

/** 使用真实鼠标点击遮罩，同时验证冒泡和右键默认行为阻止语义。 */
async function closeOutside(page, button) {
  // 1、只读记录事件，再通过外部坐标关闭菜单与遮罩。
  const type = button === 'right' ? 'contextmenu' : 'click'
  await page.evaluate(type => {
    window.__menuOverlayEvent = null
    document.addEventListener(type, event => {
      window.__menuOverlayEvent = { type: event.type, prevented: event.defaultPrevented }
    }, { once: true })
  }, type)
  await page.locator('.context-menu-overlay').click({ position: { x: 2, y: 2 }, button })
  await page.locator('.template-context-menu').waitFor({ state: 'detached' })
  await page.locator('.context-menu-overlay').waitFor({ state: 'detached' })
  assert.deepEqual(await page.evaluate(() => window.__menuOverlayEvent), { type, prevented: button === 'right' })
}

test('右键菜单：预设删除、空配置与详情、多选禁用、外部点击和右键遮罩关闭', { timeout: 120000 }, async () => {
  // 1、全部输入走公开文件对话框，复用隔离桌面与 PSD 工具，不注入 Vue 状态或业务存储。
  const protectedReferences = await referenceDigest()
  const fixture = (await syntheticFixtures())[0]
  const desktop = await launchDesktop()
  const { page } = desktop
  const result = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src'], { cwd: repository, encoding: 'utf8' }).trim(),
    rendererHtmlSha256: createHash('sha256').update(await readFile(path.join(repository, 'out/renderer/index.html'))).digest('hex'),
    fixtureHash: fixture.sha256, scenes: {}, completed: false
  }
  console.log(`右键菜单回归证据：${desktop.root}`)
  try {
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.locator('.psd-tab-item.active .psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
    await stableCanvas(page)
    await page.getByTitle('添加当前画布为预设', { exact: true }).click()
    await page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
    await page.locator('.preset-item').waitFor()
    await page.locator('.preset-item').click({ button: 'right', position: { x: 20, y: 20 } })
    assert.equal((await page.locator('.template-context-menu').innerText()).trim(), '删除')
    assert.equal(await page.locator('.template-context-menu.detail-mode').count(), 0)
    await captureMenu(desktop, 'preset', result)
    await closeOutside(page, 'right')
    await page.locator('.preset-item').click({ button: 'right', position: { x: 20, y: 20 } })
    await page.locator('.context-menu-item').click()
    await page.locator('.n-dialog').filter({ hasText: '确认删除' }).getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.preset-item').waitFor({ state: 'detached' })
    await page.locator('.template-context-menu').waitFor({ state: 'detached' })

    // 2、经公开 JSON 导入构造空配置和多组配置，固定名称消除时间戳对截图的影响。
    const input = path.join(desktop.root, 'menu-input.json')
    await writeFile(input, JSON.stringify({ exportType: 'templates', templates: [
      { id: 'menu-empty', name: '菜单空配置', config: [], order: 0 },
      { id: 'menu-detail', name: '菜单配置详情', config: [{ tabName: '前手', selectedParts: ['选项甲', '选项乙'] }, { tabName: '动作', selectedParts: ['动作甲'] }], order: 1 }
    ] }), { flag: 'wx' })
    await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, input)
    await page.getByRole('button', { name: '更多', exact: true }).click()
    await page.getByText('导入动作模板', { exact: true }).click()
    await page.getByRole('button', { name: '确定覆盖', exact: true }).click()
    await page.locator('.part-tab').filter({ hasText: /^动作模板$/ }).click()
    const empty = page.locator('.template-item').filter({ hasText: '菜单空配置' })
    const detail = page.locator('.template-item').filter({ hasText: '菜单配置详情' })
    await empty.waitFor()
    await detail.waitFor()
    await empty.click({ button: 'right', position: { x: 60, y: 12 } })
    const menu = page.locator('.template-context-menu')
    assert.equal((await menu.locator('.template-detail-empty').innerText()).trim(), '暂无具体配置')
    assert.equal(await menu.locator('.template-detail-groups').count(), 0)
    for (const name of ['应用', '重命名']) assert.equal(await menu.getByRole('button', { name, exact: true }).isEnabled(), true)
    await captureMenu(desktop, 'template-empty', result)
    // 3、菜单点击保留 stop；关闭按钮、外部点击和右键遮罩分别验证。
    await page.evaluate(() => {
      window.__menuClickBubbled = false
      document.addEventListener('click', () => { window.__menuClickBubbled = true }, { once: true })
    })
    await menu.locator('.template-detail-title').click()
    assert.equal(await page.evaluate(() => window.__menuClickBubbled), false)
    assert.equal(await menu.isVisible(), true)
    await menu.getByRole('button', { name: '关闭', exact: true }).click()
    await menu.waitFor({ state: 'detached' })
    await detail.click({ button: 'right', position: { x: 60, y: 12 } })
    assert.deepEqual(await menu.locator('.template-detail-group-name').allTextContents(), ['前手', '动作'])
    assert.deepEqual(await menu.locator('.template-detail-group-parts').allTextContents(), ['选项甲、选项乙', '动作甲'])
    assert.equal(await menu.locator('.template-detail-empty').count(), 0)
    assert.equal(await menu.locator('.template-detail-type').innerText(), '动作')
    await captureMenu(desktop, 'template-detail', result)
    await closeOutside(page, 'left')
    await detail.click({ button: 'right', position: { x: 60, y: 12 } })
    await closeOutside(page, 'right')
    // 4、修饰键多选后禁用应用和重命名，实际鼠标点击不得触发业务，删除仍可用。
    for (const card of [empty, detail]) {
      if (!(await card.evaluate(node => node.classList.contains('multi-selected')))) {
        await card.click({ modifiers: ['Meta'], position: { x: 60, y: 12 } })
      }
    }
    assert.equal(await page.locator('.template-item.multi-selected').count(), 2)
    await empty.click({ button: 'right', position: { x: 60, y: 12 } })
    for (const name of ['应用', '重命名']) {
      const button = menu.getByRole('button', { name, exact: true })
      assert.equal(await button.isDisabled(), true)
      const rect = await button.boundingBox()
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2)
      assert.equal(await menu.isVisible(), true)
      assert.equal(await page.locator('.n-dialog').count(), 0)
    }
    assert.equal(await menu.getByRole('button', { name: '删除', exact: true }).isEnabled(), true)
    await captureMenu(desktop, 'template-multiple', result)
    await closeOutside(page, 'left')
    assert.deepEqual(desktop.errors, [])
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    result.completed = true
  } catch (error) {
    result.failure = { name: error.name, message: error.message, stack: error.stack }
    throw error
  } finally {
    // 5、失败同样保留截图、结果与日志，保护全部既有参考和真实输入文件。
    await page.screenshot({ path: path.join(desktop.root, 'template-context-menu-final.png') }).catch(() => {})
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), protectedReferences)
    result.id = createHash('sha256').update(JSON.stringify(result)).digest('hex')
    await writeFile(path.join(desktop.root, 'template-context-menu-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
    console.log(`右键菜单结果 ID：${result.id}`)
  }
})
