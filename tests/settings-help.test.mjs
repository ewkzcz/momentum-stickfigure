/** 设置帮助回归：核验三个路由、配置操作转发、外部链接和拆分前后完整视觉状态。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

/** 进入帮助路由。处理流程：1、导航；2、等待实际标题显示。 */
async function navigate(page, route, title) {
  // 1、走真实 Vue Router，不改组件内部状态。
  await page.evaluate(route => { location.hash = `/settings/${route}` }, route)
  // 2、标题包含原文中的表情符号。
  await page.getByText(title, { exact: true }).waitFor()
}

/** 核验稳定画面。处理流程：1、等待动画结束；2、记录全部样式和截图；3、对照只读原版结果。 */
async function capture(desktop, name, evidence) {
  const page = desktop.page
  // 1、只等待真实终态，不关闭生产动画或修改业务 CSS。
  await page.mouse.move(1, 1)
  await page.evaluate(() => { document.activeElement?.blur(); return document.fonts.ready })
  await page.waitForFunction(() => {
    const nodes = ['.app-main', '.app-layout', '.settings-page'].map(selector => document.querySelector(selector))
    return nodes.every(node => {
      if (!node) return false
      const css = window.getComputedStyle(node)
      return css.opacity === '1' && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(css.transform)
    }) && !document.querySelector('.settings-page .n-base-wave--active') && document.getAnimations().every(animation => animation.playState === 'finished')
  }, undefined, { timeout: 15000 })
  const content = page.locator('.settings-tab-content:visible')
  await content.locator('.settings-content').evaluate(node => { node.scrollTop = 0 })
  // 2、逐帧检查完整计算样式及伪元素，保留所有节点和属性。
  const state = await content.evaluate(async root => {
    const snapshot = () => [root, ...root.querySelectorAll('*')].map(node => {
      const rect = node.getBoundingClientRect()
      const style = pseudo => { const css = window.getComputedStyle(node, pseudo); return Object.fromEntries([...css].map(key => [key, css.getPropertyValue(key)])) }
      return { tag: node.tagName, class: node.getAttribute('class'), bounds: [rect.x, rect.y, rect.width, rect.height], style: style(null), before: style('::before'), after: style('::after') }
    })
    let previous, stable = 0
    const deadline = performance.now() + 15000
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const state = snapshot(), current = JSON.stringify(state)
      stable = previous === current ? stable + 1 : 0
      if (stable >= 2) return state
      previous = current
    }
    throw new Error('帮助页面样式未达到连续三帧稳定')
  })
  let previous, stable = 0, png
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    png = await content.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css', style: '.n-message-container,.n-tooltip { visibility: hidden !important; }' })
    const rgba = (await decodePng(png)).rgba
    stable = previous?.equals(rgba) ? stable + 1 : 0
    if (stable >= 2) break
    previous = rgba
  }
  assert.ok(stable >= 2, '帮助页面截图未达到连续三帧稳定')
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  // 3、原版结果必须完整通过且逐像素一致，禁止替换基线或放宽比较。
  if (process.env.MOMENTUM_HELP_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_HELP_BEFORE, 'help-result.json'), 'utf8'))
    assert.equal(before.passed, true)
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, `帮助/${name}样式变化`)
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_HELP_BEFORE, `${name}.png`)), `帮助/${name}`)
  }
}

test('设置帮助：三个路由视觉一致、导入导出转发、教程跳转、二维码与开源链接', { timeout: 120000 }, async () => {
  // 1、隔离真实配置和原生对话框，不访问外部站点或用户资料。
  const desktop = await launchDesktop(undefined, 'software-layout')
  console.log(`帮助页面验证目录：${desktop.root}`)
  const evidence = { layouts: [], passed: false }
  try {
    const page = desktop.page
    await page.setViewportSize({ width: 1024, height: 1100 })
    const session = await page.context().newCDPSession(page)
    await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await navigate(page, 'about', '时刻简笔画免登录版本')
    await capture(desktop, 'about', evidence)
    const exportedPath = path.join(desktop.root, '帮助页配置.json')
    // 2、实际点击父页面导出流程，读取其磁盘产物，再分别核验导出和导入取消。
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.savePath = value }, exportedPath)
    await page.getByRole('button', { name: '导出设置', exact: true }).click()
    await page.getByText(`配置已导出到: ${exportedPath}`, { exact: true }).waitFor()
    const exported = JSON.parse(await readFile(exportedPath, 'utf8'))
    assert.ok(exported.version && exported.exportTime && exported.stickfigureConfig)
    assert.ok(Object.hasOwn(exported, 'geminiConfig') && Object.hasOwn(exported, 'hotkeysConfig') && Object.hasOwn(exported, 'hdToolkitConfig'))
    await desktop.application.evaluate(() => {
      const state = globalThis.__momentumTest
      const { dialog } = globalThis.__momentumBackgroundElectron
      state.helpCalls = { open: 0, save: 0, originals: { open: dialog.showOpenDialog, save: dialog.showSaveDialog } }
      state.savePath = null
      state.openPaths = []
      dialog.showOpenDialog = async (...args) => { state.helpCalls.open++; return state.helpCalls.originals.open(...args) }
      dialog.showSaveDialog = async (...args) => { state.helpCalls.save++; return state.helpCalls.originals.save(...args) }
    })
    try {
      await page.getByRole('button', { name: '导出设置', exact: true }).click()
      await page.getByRole('button', { name: '导入设置', exact: true }).click()
      assert.deepEqual(await desktop.application.evaluate(() => ({ open: globalThis.__momentumTest.helpCalls.open, save: globalThis.__momentumTest.helpCalls.save })), { open: 1, save: 1 })
    } finally {
      await desktop.application.evaluate(() => {
        const { dialog } = globalThis.__momentumBackgroundElectron
        const originals = globalThis.__momentumTest.helpCalls.originals
        dialog.showOpenDialog = originals.open
        dialog.showSaveDialog = originals.save
        delete globalThis.__momentumTest.helpCalls
      })
    }
    // 3、教程链接只核对地址，内部导航实际点击，二维码必须成功解码。
    await navigate(page, 'tutorial', '📚 软件教程')
    assert.equal(await page.getByRole('link', { name: /时刻简笔画教程/ }).getAttribute('href'), 'https://gxpdma05aj9.feishu.cn/wiki/F3H9w8ypZiXULQkV50rcEPcXn5d')
    await capture(desktop, 'tutorial', evidence)
    await page.getByRole('button', { name: '前往人物插件设置', exact: true }).click()
    await page.waitForFunction(() => location.hash === '#/settings/stickfigure')
    await page.getByText('基础设置', { exact: true }).waitFor()
    await navigate(page, 'qq-group', '💬 时刻简笔画官方群')
    assert.equal(await page.getByText('QQ群号：902990261', { exact: true }).count(), 1)
    await page.getByAltText('QQ群二维码').evaluate(image => image.decode())
    assert.ok(await page.getByAltText('QQ群二维码').evaluate(image => image.naturalWidth > 0))
    await capture(desktop, 'qq-group', evidence)
    await page.getByRole('link', { name: '打开 GitHub 开源仓库', exact: true }).click()
    assert.deepEqual(await desktop.application.evaluate(() => globalThis.__momentumTest.external), ['https://github.com/ewkzcz/momentum-stickfigure'])
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(desktop.root, 'help-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
