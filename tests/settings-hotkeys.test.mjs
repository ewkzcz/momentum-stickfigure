/** 快捷键桌面回归：用页面键盘验证五项输入和失败分支，比较原版布局并检查真实磁盘恢复；不验证系统快捷键。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const fields = [
  ['toggleMainWindow', '主窗口唤醒/最小化', 'Alt+Z', 'Control+Alt+Shift+k', 'Ctrl+Alt+Shift+K'],
  ['togglePreviewWindow', '预览窗口唤醒/最小化', 'Alt+X', 'Control+Shift+p', 'Ctrl+Shift+P'],
  ['openSearch', '打开搜索面板', 'Ctrl+F', 'Alt+Shift+s', 'Alt+Shift+S'],
  ['toggleCanvasHover', '切换悬浮预览（主画布）', 'Alt+C', 'Control+ArrowUp', 'Ctrl+Up'],
  ['togglePartHover', '切换悬浮预览（部件）', 'Alt+V', 'Alt+Shift+v', 'Alt+Shift+V']
]

/** 按真实标签定位公开表单项。 */
function item(page, label) {
  // 1、标签未关联原生输入，使用 Naive UI 公开结构与标签文字。
  return page.locator('.settings-tab-content:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开快捷键页并固定软件渲染视口，不激活系统窗口。 */
async function openSettings(desktop) {
  // 1、页面焦点模拟仅用于 Playwright 页面键盘事件。
  await desktop.page.setViewportSize({ width: 1024, height: 1200 })
  const session = await desktop.page.context().newCDPSession(desktop.page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.evaluate(() => { location.hash = '/settings/hotkeys' })
  await item(desktop.page, fields[0][1]).locator('input').waitFor()
}

/** 读取全部五项输入值。 */
async function values(page) {
  // 1、每个标签独立读取，避免字段错接漏检。
  return Object.fromEntries(await Promise.all(fields.map(async ([key, label]) => [key, await item(page, label).locator('input').inputValue()])))
}

/** 在输入框中按页面组合键，不使用系统级键盘或手动调用业务函数。 */
async function press(page, label, keys) {
  // 1、真实点击触发焦点事件，再经 Playwright keyboard 发送按键。
  await item(page, label).locator('input').click()
  await page.keyboard.press(keys)
}

/** 等待生产共享存储在进程运行期间完成写盘。 */
async function waitForDisk(root, expected) {
  // 1、读取实际共享文件；不能用关闭时刷盘替代保存行为。
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
    const saved = JSON.parse(data['hotkeys-config'] || '{}')
    if (fields.every(([key]) => saved[key] === expected[key])) return saved
    await pollDelay(25)
  }
  assert.fail('快捷键配置未在运行期间写入共享文件')
}

/** 捕获稳定截图与计算样式，有独立原版目录时要求严格零差异。 */
async function layout(desktop, name, evidence) {
  // 1、以连续三帧稳定判断截图时机，不按照预期图片挑选截图。
  const page = desktop.page
  await page.mouse.move(1, 1)
  await page.evaluate(() => { document.activeElement?.blur(); return document.fonts.ready })
  const form = page.locator('.settings-tab-content:visible .settings-form')
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
  assert.ok(stable >= 2, '快捷键表单截图未达到连续三帧稳定')
  const state = await form.evaluate(root => [root, ...root.querySelectorAll('*')].map(node => {
    const rect = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)
    return { tag: node.tagName, class: node.getAttribute('class'), bounds: [rect.x, rect.y, rect.width, rect.height], margin: style.margin, padding: style.padding, color: style.color, background: style.backgroundColor, font: style.font, display: style.display, lineHeight: style.lineHeight, border: style.border, boxSizing: style.boxSizing, flex: style.flex }
  }))
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  // 2、不更新原版参考，不放宽像素或计算样式断言。
  if (process.env.MOMENTUM_HOTKEYS_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_HOTKEYS_BEFORE, 'hotkeys-result.json'), 'utf8'))
    assert.equal(before.passed, true, '仅使用完整通过的原版基线')
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, `快捷键/${name}计算样式变化`)
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_HOTKEYS_BEFORE, `${name}.png`)), `快捷键/${name}`)
  }
}

/** 覆盖每项的只读、修饰键、Meta 和冲突拒绝，以及 ESC、独立清空和重置。 */
async function exerciseInputs(page, expected, initial) {
  // 1、先通过五项不同组合键验证字段映射和修饰键顺序。
  for (const [, label, , keys] of fields) await press(page, label, keys)
  assert.deepEqual(await values(page), expected)
  for (const [key, label, , keys] of fields) {
    const input = item(page, label).locator('input')
    assert.equal(await input.getAttribute('readonly'), '')
    await input.click()
    await page.keyboard.insertText('不能直接写入')
    assert.deepEqual(await values(page), expected, 'readonly 必须阻止直接文本输入')
    for (const modifier of ['Control', 'Alt', 'Shift']) {
      await page.keyboard.press(modifier)
      assert.deepEqual(await values(page), expected, '单独修饰键必须忽略')
    }
    await page.keyboard.press('Meta+j')
    await page.getByText('不支持Meta键（Win键/Cmd键），请使用 Ctrl、Alt、Shift', { exact: true }).last().waitFor()
    assert.deepEqual(await values(page), expected, '不支持 Meta 时不得覆盖已有值')
    const other = fields.find(([otherKey]) => otherKey !== key)
    await page.keyboard.press(other[3])
    await page.getByText(`快捷键 ${other[4]} 已被 "${other[1]}" 使用`, { exact: true }).last().waitFor()
    assert.deepEqual(await values(page), expected, '冲突输入必须拒绝且保持全部字段')
    await page.keyboard.press(keys)
    assert.deepEqual(await values(page), expected, '相同字段可重复录入已有组合')
    await page.keyboard.press('Escape')
    assert.deepEqual(await values(page), { ...expected, [key]: '' }, 'ESC 仅清空当前项')
    await press(page, label, keys)
    await item(page, label).getByRole('button', { name: '清空', exact: true }).click()
    assert.deepEqual(await values(page), { ...expected, [key]: '' }, '清空按钮仅影响当前项')
    await item(page, label).getByRole('button', { name: '重置', exact: true }).click()
    assert.deepEqual(await values(page), { ...expected, [key]: initial[key] }, '重置按钮仅恢复当前项默认值')
    await press(page, label, keys)
  }
  // 2、保留原版裸键、方向键与空格序列化行为，不顺带修正空格映射。
  await press(page, fields[0][1], 'a')
  assert.equal((await values(page)).toggleMainWindow, 'A')
  await press(page, fields[0][1], 'Control+Space')
  assert.equal((await values(page)).toggleMainWindow, 'Ctrl+ ')
  await press(page, fields[0][1], fields[0][3])
  assert.deepEqual(await values(page), expected)
}

test('快捷键：五项页面键盘、拒绝输入、只读、清空重置、跨路由、保存磁盘与重启及严格布局比较', { timeout: 120000 }, async () => {
  // 1、使用既有保护器隔离真实入口，globalShortcut.register 固定返回 false，不验证系统注册成功。
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`快捷键验证目录：${root}`)
  const evidence = { layouts: [], passed: false, systemShortcutsVerified: false }
  const initial = Object.fromEntries(fields.map(([key, , value]) => [key, value]))
  const expected = Object.fromEntries(fields.map(([key, , , , value]) => [key, value]))
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), initial)
    assert.deepEqual(await desktop.page.locator('.settings-tab-content:visible .n-form-item-label').allTextContents(), fields.map(([, label]) => label))
    assert.equal(await desktop.page.locator('.settings-tab-content:visible input').count(), 5)
    await layout(desktop, 'initial', evidence)
    await exerciseInputs(desktop.page, expected, initial)
    // 2、跨设置路由复用父组件，未保存编辑应保持且不能提前持久化。
    await desktop.page.evaluate(() => { location.hash = '/settings/stickfigure' })
    await desktop.page.getByText('基础设置', { exact: true }).waitFor()
    await desktop.page.evaluate(() => { location.hash = '/settings/hotkeys' })
    await item(desktop.page, fields[0][1]).locator('input').waitFor()
    assert.deepEqual(await values(desktop.page), expected)
    const unsaved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('hotkeys-config')))
    assert.notDeepEqual(unsaved, expected, '编辑与清空重置均不能提前保存')
    await layout(desktop, 'edited', evidence)
    await desktop.page.evaluate(() => {
      window.__hotkeyEvents = []
      window.addEventListener('hotkeys-config-updated', event => window.__hotkeyEvents.push(event.detail))
    })
    await desktop.page.locator('.settings-tab-content:visible').getByRole('button', { name: '保存配置', exact: true }).click()
    await desktop.page.locator('.n-message--success-type').filter({ hasText: '设置已保存' }).waitFor()
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('hotkeys-config'))), expected)
    assert.deepEqual(await desktop.page.evaluate(() => window.__hotkeyEvents), [expected])
    assert.deepEqual(await waitForDisk(root, expected), expected)
    const backup = await desktop.page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(backup.success, true)
    assert.deepEqual(backup.settings.hotkeysConfig, expected)
    assert.equal(await desktop.page.locator('.settings-tab-content:visible .n-button--loading').count(), 0)
    assert.deepEqual(desktop.errors, [])
    evidence.saved = expected
  } finally { await desktop.close() }
  // 3、同一隔离目录重启真实应用，从磁盘与备份恢复，而不是重挂组件。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('hotkeys-config'))), expected)
    await layout(desktop, 'restart', evidence)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'hotkeys-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
