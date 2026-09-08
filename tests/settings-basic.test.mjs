/** 基础设置桌面回归：通过公开控件保存配置、验证磁盘与重启恢复，窗口始终处于后台。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 按公开标签定位当前基础表单的一项，不读取组件私有变量。 */
function item(page, label) {
  // 1、Naive UI 标签不是原生 label 关联，按可见文字定位表单项。
  return page.locator('.n-tab-pane:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开真实设置路由并固定后台 Chromium 视口。 */
async function openSettings(desktop) {
  // 1、只设置渲染器环境，禁止激活原生窗口。
  await desktop.page.setViewportSize({ width: 1024, height: 1000 })
  const session = await desktop.page.context().newCDPSession(desktop.page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.evaluate(() => { location.hash = '/settings/stickfigure' })
  await desktop.page.getByText('基础设置', { exact: true }).waitFor()
  await item(desktop.page, '图片保存根目录').locator('input').waitFor()
}

/** 读取用户实际看到的字段，保留布尔值 false 的原始含义。 */
async function values(page) {
  // 1、原生 radio 的值用于确认实际选择，不把显示文字误认为保存值。
  const selected = label => item(page, label).locator('input:checked').inputValue()
  return {
    outputRoot: await item(page, '图片保存根目录').locator('input').inputValue(),
    fileNaming: await item(page, '导出文件名规则').locator('.n-base-selection-label').innerText(),
    duplicate: await selected('同名文件处理'),
    createFolder: await selected('PSD文件夹组织'),
    fuzzy: await selected('动作表情模糊匹配'),
    canvasHover: await selected('悬浮预览（主画布）'),
    partHover: await selected('悬浮预览（部件）')
  }
}

/** 等待实际磁盘出现目标配置，不以退出刷盘或内存值代替运行期间持久化。 */
async function waitForDisk(file, outputRoot) {
  // 1、保留原十五秒上限，持续观察实际共享文件。
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
    if (JSON.parse(data['stickfigure-config'] || '{}').outputRoot === outputRoot) return data
    await pollDelay(25)
  }
  assert.fail('基础设置没有在运行期间实际写入共享文件')
}

/** 保存稳定表单布局；只遮盖每次变化的隔离路径文字，另行核验该输入的值与样式。 */
async function layout(desktop, name, evidence) {
  // 1、等待实际相邻截图稳定，不根据预期图重试挑选帧。
  const page = desktop.page
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.fonts.ready)
  const form = page.locator('.n-tab-pane:visible .settings-form')
  await form.evaluate(node => { node.closest('.settings-content').scrollTop = 0 })
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', mask: [item(page, '图片保存根目录').locator('input')], style: '.n-message-container,.n-tooltip { visibility: hidden !important; }' }
  let previous
  let stable = 0
  let png
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    png = await form.screenshot(options)
    const current = (await decodePng(png)).rgba
    stable = previous?.equals(current) ? stable + 1 : 0
    if (stable >= 2) break
    previous = current
  }
  assert.ok(stable >= 2, '基础表单截图没有达到实际连续三帧稳定')
  const state = await form.evaluate(root => [...root.querySelectorAll('.n-form-item,.save-button-container,input')].map(node => {
    const rect = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)
    return { tag: node.tagName, class: node.className, bounds: [rect.x, rect.y, rect.width, rect.height], margin: style.margin, padding: style.padding, color: style.color, font: style.font, ...('readOnly' in node ? { readOnly: node.readOnly } : {}) }
  }))
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  if (process.env.MOMENTUM_SETTINGS_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_SETTINGS_BEFORE, 'settings-result.json'), 'utf8'))
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, '基础表单位置或计算样式变化')
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_SETTINGS_BEFORE, `${name}.png`)), `基础表单/${name}`)
  }
}

test('基础设置：公开配置保存、取消重置、磁盘备份与重启恢复保持一致', { timeout: 120000 }, async () => {
  // 1、所有目录来自隔离根；设置读取及自动备份继续使用生产实现。
  const references = await referenceDigest()
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`基础设置验证目录：${root}`)
  const outputRoot = path.join(root, '图片 输出目录')
  const storageFile = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  await mkdir(outputRoot)
  const evidence = { layouts: [], passed: false }
  let expected
  let saved
  try {
    await openSettings(desktop)
    const initial = await values(desktop.page)
    evidence.initial = { ...initial, outputRoot: initial.outputRoot.replace(root, '<root>') }
    await layout(desktop, 'initial', evidence)
    const chooseFolder = async paths => {
      await desktop.application.evaluate((_electron, paths) => { globalThis.__momentumTest.openPaths = paths }, paths)
      await item(desktop.page, '图片保存根目录').getByRole('button', { name: '选择文件夹', exact: true }).click()
    }
    await chooseFolder([outputRoot])
    assert.equal(await item(desktop.page, '图片保存根目录').locator('input').inputValue(), outputRoot)
    await chooseFolder([])
    assert.equal(await item(desktop.page, '图片保存根目录').locator('input').inputValue(), outputRoot, '取消目录选择应保留原值')
    await item(desktop.page, '图片保存根目录').getByTitle('重置为默认路径（系统图片目录）', { exact: true }).click()
    assert.equal(await item(desktop.page, '图片保存根目录').locator('input').inputValue(), initial.outputRoot)
    await chooseFolder([outputRoot])
    await item(desktop.page, '导出文件名规则').locator('.n-base-selection').click()
    await desktop.page.locator('.n-base-select-option').filter({ hasText: '仅Hash（如：a3f9b2k5m7p4q8.png）' }).click()
    await item(desktop.page, '同名文件处理').getByText('添加时间戳后缀', { exact: true }).click()
    for (const label of ['PSD文件夹组织', '动作表情模糊匹配']) await item(desktop.page, label).getByText('否', { exact: true }).click()
    for (const label of ['悬浮预览（主画布）', '悬浮预览（部件）']) await item(desktop.page, label).getByText('开启', { exact: true }).click()
    expected = await values(desktop.page)
    await desktop.page.locator('.n-tab-pane:visible').getByRole('button', { name: '保存配置', exact: true }).click()
    await desktop.page.locator('.n-message--success-type').filter({ hasText: '设置已保存' }).waitFor()
    saved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config')))
    assert.equal(saved.outputRoot, outputRoot)
    assert.equal(saved.fileNamingRule, 'hash-only')
    assert.equal(saved.duplicateFileHandling, 'addTimestamp')
    assert.equal(saved.createPsdFolder, false)
    assert.equal(saved.enableFuzzyMatch, false)
    assert.ok(saved.groupNames.frontHand && saved.frontHandBothNames, '基础保存不能丢失其它分组字段')
    const disk = await waitForDisk(storageFile, outputRoot)
    assert.deepEqual(JSON.parse(disk['stickfigure-config']), saved)
    const backup = await desktop.page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(backup.success, true)
    assert.deepEqual(backup.settings.stickfigureConfig, saved, '实际自动备份应与保存配置相同')
    evidence.saved = { ...saved, outputRoot: '<root>/图片 输出目录' }
    await layout(desktop, 'saved', evidence)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  // 2、完全重启后只读公开表单与保存配置，确认 false 及两个独立预览开关均恢复。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    await desktop.page.waitForFunction(value => [...document.querySelectorAll('input')].some(input => input.value === value), outputRoot)
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config'))), saved)
    await layout(desktop, 'restart', evidence)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    assert.deepEqual(await referenceDigest(), references, '设置测试不得修改任何图像参考')
    await writeFile(path.join(root, 'settings-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
