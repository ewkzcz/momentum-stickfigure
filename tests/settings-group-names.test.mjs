/** 图组名称桌面回归：验证原版七项输入、独立重置、跨页签、磁盘备份与重启，并严格比较拆分前布局。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const fields = [
  ['frontHand', '前手图组名称', '测试前手、上手，前置\nfront hand'],
  ['backHand', '后手图组名称', '测试后手、下手，后置\nback hand'],
  ['bothHands', '双手图组名称', '测试双手、抱拳，合十\nboth hands'],
  ['action', '动作图组名称', '测试动作、手部，动作组\naction'],
  ['expression', '表情图组名称', '测试表情、眉毛，眼睛\nexpression'],
  ['upperBody', '上身图组名称', '测试上身、上半身，衣服\nupper body'],
  ['lowerBody', '下身图组名称', '测试下身、下半身，裤子\nlower body']
]

/** 按公开标签定位当前页签表单项。 */
function item(page, label) {
  // 1、Naive UI 标签没有原生关联，使用实际标签文字定位。
  return page.locator('.n-tab-pane:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开真实设置页并固定后台视口。 */
async function openSettings(desktop) {
  // 1、提高视口以完整容纳七项反馈和保存按钮，不激活原生窗口。
  await desktop.page.setViewportSize({ width: 1024, height: 1800 })
  const session = await desktop.page.context().newCDPSession(desktop.page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.evaluate(() => { location.hash = '/settings/stickfigure' })
  await desktop.page.getByText('自定义图层名称', { exact: true }).click()
  await item(desktop.page, fields[0][1]).locator('textarea').waitFor()
}

/** 读取全部七个公开输入框。 */
async function values(page) {
  // 1、逐项核对字段与标签，避免只验证第一个输入。
  return Object.fromEntries(await Promise.all(fields.map(async ([key, label]) => [key, await item(page, label).locator('textarea').inputValue()])))
}

/** 等待生产共享存储在运行期间写入全部字段。 */
async function waitForDisk(file, expected) {
  // 1、轮询实际磁盘，不能用退出时刷盘替代。
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const data = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
    const saved = JSON.parse(data['stickfigure-config'] || '{}')
    if (fields.every(([key]) => saved.groupNames?.[key] === expected[key])) return saved
    await pollDelay(25)
  }
  assert.fail('图组名称未在运行期间写入共享文件')
}

/** 捕获连续稳定截图与计算样式，存在原版目录时要求严格零差异。 */
async function layout(desktop, name, evidence) {
  // 1、等待连续三帧相同，不参考预期图片挑选截图。
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
  assert.ok(stable >= 2, '图组名称表单截图未达到连续三帧稳定')
  const state = await form.evaluate(root => [root, ...root.querySelectorAll('.n-alert,.n-text,.n-form-item,.n-form-item-label,.n-form-item-feedback-wrapper,.n-input-group,.save-button-container,textarea,button,svg,path')].map(node => {
    const rect = node.getBoundingClientRect()
    const style = window.getComputedStyle(node)
    return { tag: node.tagName, class: node.getAttribute('class'), bounds: [rect.x, rect.y, rect.width, rect.height], margin: style.margin, padding: style.padding, color: style.color, font: style.font, display: style.display, lineHeight: style.lineHeight }
  }))
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  // 2、只读取独立临时基线，不更新已有参考，不放宽像素或布局断言。
  if (process.env.MOMENTUM_GROUP_NAMES_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_GROUP_NAMES_BEFORE, 'group-names-result.json'), 'utf8'))
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, '图组名称表单位置或计算样式变化')
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_GROUP_NAMES_BEFORE, `${name}.png`)), `图组名称表单/${name}`)
  }
}

/** 读取其它分组的实际输入并改变基础字段，验证保存时不会丢失。 */
async function editOtherFields(page) {
  // 1、基础设置保留输出目录，修改可保存的规则与布尔字段。
  await page.getByText('基础设置', { exact: true }).click()
  const outputRoot = await item(page, '图片保存根目录').locator('input').inputValue()
  await item(page, '导出文件名规则').locator('.n-base-selection').click()
  await page.locator('.n-base-select-option').filter({ hasText: '仅Hash（如：a3f9b2k5m7p4q8.png）' }).click()
  await item(page, '同名文件处理').getByText('添加时间戳后缀', { exact: true }).click()
  for (const label of ['PSD文件夹组织', '动作表情模糊匹配']) await item(page, label).getByText('否', { exact: true }).click()
  // 2、前手特殊名称属于另一个页签，保存图组名称时应原样保留。
  await page.getByText('前手特殊图层', { exact: true }).click()
  const frontHandBothNames = '保留双手特殊、交叉\n合十'
  const frontHandRightNames = '保留右手特殊、托腮\n擦汗'
  await item(page, '前手-双手名称').locator('textarea').fill(frontHandBothNames)
  await item(page, '前手-右手名称').locator('textarea').fill(frontHandRightNames)
  return { outputRoot, overwriteMode: 'rename', fileNamingRule: 'hash-only', duplicateFileHandling: 'addTimestamp', createPsdFolder: false, enableFuzzyMatch: false, frontHandBothNames, frontHandRightNames }
}

test('图组名称：七项输入与独立重置、跨页签、保存重启、其它字段保留及磁盘备份', { timeout: 120000 }, async () => {
  // 1、隔离后台启动，所有保存与备份均使用生产实现。
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`图组名称验证目录：${root}`)
  const evidence = { layouts: [], passed: false }
  const expected = Object.fromEntries(fields.map(([key, , value]) => [key, value]))
  let saved
  try {
    await openSettings(desktop)
    const initial = await values(desktop.page)
    evidence.initial = initial
    assert.equal(await desktop.page.locator('.n-tab-pane:visible textarea').count(), 7)
    assert.deepEqual(await desktop.page.locator('.n-tab-pane:visible .n-form-item-label').allTextContents(), fields.map(([, label]) => label), '字段顺序必须与原版一致')
    await layout(desktop, 'initial', evidence)
    for (const [, label, value] of fields) await item(desktop.page, label).locator('textarea').fill(value)
    assert.deepEqual(await values(desktop.page), expected)
    for (const [key, label, value] of fields) {
      await item(desktop.page, label).getByRole('button', { name: '重置', exact: true }).click()
      assert.deepEqual(await values(desktop.page), { ...expected, [key]: initial[key] }, '每次重置仅影响对应图组名称')
      await item(desktop.page, label).locator('textarea').fill(value)
    }
    const otherFields = await editOtherFields(desktop.page)
    await desktop.page.getByText('自定义图层名称', { exact: true }).click()
    assert.deepEqual(await values(desktop.page), expected, '跨页签不能丢失未保存输入')
    await layout(desktop, 'edited', evidence)
    await desktop.page.locator('.n-tab-pane:visible').getByRole('button', { name: '保存配置', exact: true }).click()
    await desktop.page.locator('.n-message--success-type').filter({ hasText: '设置已保存' }).waitFor()
    saved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config')))
    assert.deepEqual(saved, { ...otherFields, groupNames: expected }, '完整保存对象须包含其它分组全部字段')
    const disk = await waitForDisk(path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json'), expected)
    assert.deepEqual(disk, saved)
    const backup = await desktop.page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(backup.success, true)
    assert.deepEqual(backup.settings.stickfigureConfig, saved)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  // 2、关闭后重新启动同一隔离目录，验证界面和保存对象而非组件内存。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config'))), saved)
    await layout(desktop, 'restart', evidence)
    await desktop.page.getByText('前手特殊图层', { exact: true }).click()
    assert.equal(await item(desktop.page, '前手-双手名称').locator('textarea').inputValue(), saved.frontHandBothNames)
    assert.equal(await item(desktop.page, '前手-右手名称').locator('textarea').inputValue(), saved.frontHandRightNames)
    await desktop.page.getByText('基础设置', { exact: true }).click()
    assert.equal(await item(desktop.page, '图片保存根目录').locator('input').inputValue(), saved.outputRoot)
    assert.match(await item(desktop.page, '导出文件名规则').innerText(), /仅Hash/)
    assert.equal(await item(desktop.page, '同名文件处理').locator('input:checked').inputValue(), saved.duplicateFileHandling)
    for (const label of ['PSD文件夹组织', '动作表情模糊匹配']) assert.equal(await item(desktop.page, label).locator('input:checked').inputValue(), 'false')
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'group-names-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
