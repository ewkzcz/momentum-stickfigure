/** 前手分组桌面回归：原版仅有双手和右手两个字段；后台验证输入、重置、跨页签和持久化。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const fields = [
  ['frontHandBothNames', '前手-双手名称', '测试交叉、合十，抱拳\n双手动作'],
  ['frontHandRightNames', '前手-右手名称', '测试举手右、托腮，擦汗\n右手动作']
]

/** 通过公开标签定位实际表单项。 */
function item(page, label) {
  // 1、Naive UI 标签没有原生 label 关联，使用可见文字定位。
  return page.locator('.n-tab-pane:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开真实设置页；只仿真渲染器焦点，不激活原生窗口。 */
async function openSettings(desktop) {
  // 1、固定视口供拆分前后布局比较。
  await desktop.page.setViewportSize({ width: 1024, height: 1000 })
  const session = await desktop.page.context().newCDPSession(desktop.page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.evaluate(() => { location.hash = '/settings/stickfigure' })
  await desktop.page.getByText('前手特殊图层', { exact: true }).click()
  await item(desktop.page, fields[0][1]).locator('textarea').waitFor()
}

/** 读取用户可见输入，不依赖组件调试状态。 */
async function values(page) {
  // 1、逐个读出两个原版字段。
  return Object.fromEntries(await Promise.all(fields.map(async ([key, label]) => [key, await item(page, label).locator('textarea').inputValue()])))
}

/** 等待运行期间实际写盘，不用退出时刷盘替代验证。 */
async function waitForDisk(file, expected) {
  // 1、轮询真实共享存储，匹配所有前手字段。
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
    const saved = JSON.parse(data['stickfigure-config'] || '{}')
    if (fields.every(([key]) => saved[key] === expected[key])) return saved
    await pollDelay(25)
  }
  assert.fail('前手设置未在运行期间写入共享文件')
}

/** 捕获稳定截图和实际计算样式，对照原版基线验证作用域样式继承。 */
async function layout(desktop, name, evidence) {
  // 1、等待连续三帧相同，不依照基线挑选截图。
  const page = desktop.page
  await page.mouse.move(1, 1)
  await page.evaluate(() => document.fonts.ready)
  const form = page.locator('.n-tab-pane:visible .settings-form')
  await form.evaluate(node => { node.closest('.settings-content').scrollTop = 0 })
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', style: '.n-message-container,.n-tooltip { visibility: hidden !important; }' }
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
  assert.ok(stable >= 2, '前手表单截图未达到连续三帧稳定')
  const state = await form.evaluate(root => [root, ...root.querySelectorAll('.n-form-item,.n-form-item-label,.n-form-item-feedback-wrapper,.n-input-group,.save-button-container,textarea,button')].map(node => {
    const rect = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)
    return { tag: node.tagName, class: node.className, bounds: [rect.x, rect.y, rect.width, rect.height], margin: style.margin, padding: style.padding, color: style.color, font: style.font }
  }))
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  if (process.env.MOMENTUM_FRONTHAND_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_FRONTHAND_BEFORE, 'fronthand-result.json'), 'utf8'))
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, '前手表单位置或计算样式变化')
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_FRONTHAND_BEFORE, `${name}.png`)), `前手表单/${name}`)
  }
}

test('前手设置：原版两个字段输入、独立重置、跨页签保留、保存与重启恢复', { timeout: 120000 }, async () => {
  // 1、复用后台隔离启动，保存和备份均走生产路径。
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`前手设置验证目录：${root}`)
  const evidence = { layouts: [], passed: false }
  const expected = Object.fromEntries(fields.map(([key, , value]) => [key, value]))
  let saved
  try {
    await openSettings(desktop)
    const initial = await values(desktop.page)
    evidence.initial = initial
    assert.equal(await desktop.page.locator('.n-tab-pane:visible textarea').count(), 2, '当前原版分组只有两个字段')
    await layout(desktop, 'initial', evidence)
    for (const [, label, value] of fields) await item(desktop.page, label).locator('textarea').fill(value)
    assert.deepEqual(await values(desktop.page), expected)
    for (const [key, label, value] of fields) {
      await item(desktop.page, label).getByRole('button', { name: '重置', exact: true }).click()
      assert.deepEqual(await values(desktop.page), { ...expected, [key]: initial[key] }, '重置仅影响对应字段')
      await item(desktop.page, label).locator('textarea').fill(value)
    }
    await desktop.page.getByText('自定义图层名称', { exact: true }).click()
    // 2、第三项实际位于另一个分组；同时验证该字段不被前手保存丢失。
    const groupName = '测试前手图组、front hand'
    await item(desktop.page, '前手图组名称').locator('textarea').fill(groupName)
    await desktop.page.getByText('基础设置', { exact: true }).click()
    await desktop.page.getByText('前手特殊图层', { exact: true }).click()
    assert.deepEqual(await values(desktop.page), expected, '切换页签不能丢失未保存输入')
    await layout(desktop, 'edited', evidence)
    await desktop.page.locator('.n-tab-pane:visible').getByRole('button', { name: '保存配置', exact: true }).click()
    await desktop.page.locator('.n-message--success-type').filter({ hasText: '设置已保存' }).waitFor()
    saved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config')))
    for (const [key] of fields) assert.equal(saved[key], expected[key])
    assert.equal(saved.groupNames.frontHand, groupName)
    const disk = await waitForDisk(path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json'), expected)
    assert.deepEqual(disk, saved)
    const backup = await desktop.page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(backup.success, true)
    assert.deepEqual(backup.settings.stickfigureConfig, saved)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  // 3、完整关闭重启，核验界面和保存状态而不是内存残留。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config'))), saved)
    await layout(desktop, 'restart', evidence)
    await desktop.page.getByText('自定义图层名称', { exact: true }).click()
    assert.equal(await item(desktop.page, '前手图组名称').locator('textarea').inputValue(), saved.groupNames.frontHand)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'fronthand-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
