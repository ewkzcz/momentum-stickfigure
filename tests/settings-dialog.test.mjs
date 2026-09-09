/** 对话设置回归：通过真实界面核对目录、日期开关、持久化和拆分前后的稳定画面。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const storageKey = 'dialog-config'

/** 定位公开表单项。处理流程：1、按当前可见分组的标签文字查找。 */
function field(page, label) {
  // 1、避免其它隐藏设置分组的同名控件干扰。
  return page.locator('.settings-tab-content:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开对话设置。处理流程：1、固定软件视口；2、进入真实路由并等待输入框。 */
async function openSettings(desktop) {
  // 1、只仿真渲染器焦点，不激活原生窗口。
  await desktop.page.setViewportSize({ width: 1024, height: 900 })
  const session = await desktop.page.context().newCDPSession(desktop.page)
  await session.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  // 2、等实际表单挂载，不以固定延时假定完成。
  await desktop.page.evaluate(() => { location.hash = '/settings/dialog' })
  await field(desktop.page, '图片保存目录').locator('input').waitFor()
}

/** 读取实际表单。处理流程：1、读取只读路径和开关的可访问状态。 */
async function values(page) {
  // 1、不读取 Vue 私有状态，也不把磁盘值当作界面值。
  return {
    outputRoot: await field(page, '图片保存目录').locator('input').inputValue(),
    createDateFolder: (await field(page, '自动创建日期文件夹').getByRole('switch').getAttribute('aria-checked')) === 'true'
  }
}

/** 等待真实配置落盘。处理流程：1、在有限时间内读取；2、比较完整配置。 */
async function waitForDisk(root, expected) {
  // 1、共享文件非原子写入，读取中间态时保留有界轮询，最终必须完整匹配。
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    let all
    try { all = JSON.parse(await readFile(file, 'utf8')) } catch (error) {
      if (!(error instanceof SyntaxError) && error.code !== 'ENOENT') throw error
      await pollDelay(25)
      continue
    }
    // 2、字段值与布尔 false 均须正确写入。
    const saved = JSON.parse(all[storageKey] || '{}')
    if (saved.outputRoot === expected.outputRoot && saved.createDateFolder === expected.createDateFolder) return saved
    await pollDelay(25)
  }
  assert.fail('对话设置未在运行期间写入共享磁盘')
}

/** 选择目录。处理流程：1、只替代原生选择边界；2、点击真实浏览按钮。 */
async function choose(desktop, paths) {
  // 1、空数组表示取消，业务处理器仍照常运行。
  await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.openPaths = value }, paths)
  // 2、实际输入由原目录处理函数更新。
  await field(desktop.page, '图片保存目录').getByRole('button', { name: '浏览', exact: true }).click()
  await desktop.page.waitForFunction(() => !document.querySelector('.settings-tab-content:not([style*="display: none"]) .n-button--loading'))
}

/** 采集稳定画面。处理流程：1、等待真实动画终态；2、采集稳定样式和截图；3、严格对照原版。 */
async function capture(desktop, name, evidence) {
  const page = desktop.page
  // 1、等待 JavaScript 位移动画、主题过渡和按钮波纹结束，不修改样式去拟合参考。
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
  const form = page.locator('.settings-tab-content:visible .settings-form')
  await form.evaluate(node => { node.closest('.settings-content').scrollTop = 0 })
  // 2、三个连续帧的全部节点及伪元素计算样式必须一致。
  const state = await form.evaluate(async root => {
    const snapshot = () => [root, ...root.querySelectorAll('*')].map(node => {
      const rect = node.getBoundingClientRect()
      const styles = pseudo => { const css = window.getComputedStyle(node, pseudo); return Object.fromEntries([...css].map(key => [key, css.getPropertyValue(key)])) }
      return { tag: node.tagName, class: node.getAttribute('class'), bounds: [rect.x, rect.y, rect.width, rect.height], style: styles(null), before: styles('::before'), after: styles('::after') }
    })
    let previous, stable = 0
    const deadline = performance.now() + 15000
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const state = snapshot(), current = JSON.stringify(state)
      stable = current === previous ? stable + 1 : 0
      if (stable >= 2) return state
      previous = current
    }
    throw new Error('对话表单计算样式未稳定')
  })
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', style: '.n-message-container,.n-tooltip { visibility: hidden !important; } input[placeholder="请选择对话框图片保存的根目录"] { color: transparent !important; -webkit-text-fill-color: transparent !important; }' }
  let previous, stable = 0, png
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    png = await form.screenshot(options)
    const current = (await decodePng(png)).rgba
    stable = previous?.equals(current) ? stable + 1 : 0
    if (stable >= 2) break
    previous = current
  }
  assert.ok(stable >= 2, '对话表单截图未稳定')
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  // 3、仅隐藏随机路径字形，路径值、全部样式与其他像素继续严格验证。
  if (process.env.MOMENTUM_DIALOG_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_DIALOG_BEFORE, 'dialog-result.json'), 'utf8'))
    assert.equal(before.passed, true)
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, `对话/${name}样式变化`)
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_DIALOG_BEFORE, `${name}.png`)), `对话/${name}`)
  }
}

test('对话设置：目录选择取消、日期开关、保存校验、磁盘备份、重启及布局对照', { timeout: 120000 }, async () => {
  // 1、隔离配置和输出，不访问用户目录或真实外部服务。
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`对话设置验证目录：${root}`)
  const expected = { outputRoot: path.join(root, '对话 图片输出'), createDateFolder: false }
  const evidence = { layouts: [], passed: false }
  try {
    await openSettings(desktop)
    const page = desktop.page
    assert.equal(await field(page, '图片保存目录').locator('input').getAttribute('readonly'), '')
    assert.deepEqual(await values(page), { outputRoot: '', createDateFolder: true })
    await capture(desktop, 'initial', evidence)
    // 2、先验证空目录拒绝，再选择、取消、切换开关并检查跨路由保留。
    const unsaved = await page.evaluate(key => localStorage.getItem(key), storageKey)
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('请选择图片保存目录', { exact: true }).waitFor()
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), unsaved)
    await choose(desktop, [expected.outputRoot])
    await choose(desktop, [])
    const toggle = field(page, '自动创建日期文件夹').getByRole('switch')
    for (const checked of [false, true, false]) {
      await toggle.click()
      assert.deepEqual(await values(page), { ...expected, createDateFolder: checked })
    }
    await page.evaluate(() => { location.hash = '/settings/gemini' })
    await page.getByText('中转站地址', { exact: true }).waitFor()
    await openSettings(desktop)
    assert.deepEqual(await values(page), expected)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), unsaved)
    await capture(desktop, 'edited', evidence)
    // 3、检查实际保存、完整磁盘和备份对象，不用内存代替持久化。
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('设置已保存', { exact: false }).last().waitFor()
    assert.deepEqual(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), expected)
    assert.deepEqual(await waitForDisk(root, expected), expected)
    const backup = await page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(backup.success, true)
    assert.deepEqual(backup.settings.dialogConfig, expected)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  // 4、完整重启后核对路径、布尔 false 和真实界面，不重新赋值。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await waitForDisk(root, expected), expected)
    await capture(desktop, 'restart', evidence)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'dialog-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
