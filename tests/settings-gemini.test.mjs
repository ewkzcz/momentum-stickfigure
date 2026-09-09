/** 生图设置桌面回归：仅用隔离目录和本地假密钥验证表单、保存备份与重启，并严格比较原版布局。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const storageKey = 'gemini-image-config'
const fields = [['baseUrl', '中转站地址'], ['apiKey', 'API 密钥'], ['projectRoot', '保存根目录'], ['outputDir', '图片保存路径'], ['logDir', '日志路径']]
const fakeKey = 'local-only-fake-gemini-key-never-send'

/** 等待页面运动和主题过渡真实结束；1、连续两帧确认终态，避免在中间帧采样。 */
async function waitForVisualSettled(page) {
  await page.waitForFunction(async () => {
    const selectors = ['.app-main', '.app-layout', '.settings-page']
    const nodes = selectors.map(selector => document.querySelector(selector)).filter(Boolean)
    if (nodes.length !== selectors.length) return false
    const animations = document.getAnimations()
    if (animations.some(animation => animation.playState !== 'finished')) return false
    if (nodes.some(node => {
      const css = window.getComputedStyle(node)
      return css.opacity !== '1' || (css.transform !== 'none' && css.transform !== 'matrix(1, 0, 0, 1, 0, 0)')
    })) return false
    if (document.documentElement.classList.contains('theme-transition') || document.body.classList.contains('theme-transition')) return false
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    return nodes.every(node => {
      const css = window.getComputedStyle(node)
      return css.opacity === '1' && (css.transform === 'none' || css.transform === 'matrix(1, 0, 0, 1, 0, 0)')
    }) && document.getAnimations().every(animation => animation.playState === 'finished')
  }, undefined, { timeout: 15000 })
}

/** 按可见标签定位表单项；1、使用组件库公开结构而不访问组件内部状态。 */
function item(page, label) {
  // 1、避免其他设置页中同名输入干扰。
  return page.locator('.settings-tab-content:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

/** 打开生图设置；1、固定软件布局的视口后进入真实路由。 */
async function openSettings(desktop) {
  // 1、仅操作页面，不显示或聚焦系统窗口。
  await desktop.page.setViewportSize({ width: 1024, height: 1200 })
  await desktop.page.evaluate(() => { location.hash = '/settings/gemini' })
  await item(desktop.page, '中转站地址').locator('input').waitFor()
}

/** 读取五项表单值；1、分别检查字段绑定。 */
async function values(page) {
  // 1、不以持久化结果代替用户可见的输入值。
  return Object.fromEntries(await Promise.all(fields.map(async ([key, label]) => [key, await item(page, label).locator('input').inputValue()])))
}

/** 点击真实保存按钮；1、等待提示和忙碌状态恢复。 */
async function save(page, message) {
  // 1、让父级执行真实校验、存储、目录创建和备份。
  await page.locator('.settings-tab-content:visible').getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText(message, { exact: message !== '设置已保存' }).last().waitFor()
  await page.waitForFunction(() => !document.querySelector('.settings-tab-content:not([style*="display: none"]) .n-button--loading'))
}

/** 通过原生目录选择边界提供路径；1、业务选择处理器保持真实。 */
async function selectFolder(desktop, selected) {
  // 1、空数组代表取消，其他输入仍由原生产逻辑处理。
  await desktop.application.evaluate((_, paths) => { globalThis.__momentumTest.openPaths.push(...paths) }, selected)
  await item(desktop.page, '保存根目录').getByRole('button', { name: '选择文件夹', exact: true }).click()
  await desktop.page.waitForFunction(() => !document.querySelector('.settings-tab-content:not([style*="display: none"]) .n-button--loading'))
}

/** 读取运行期真实共享文件；1、等待生产异步写盘而不是关进程后补写。 */
async function waitForDisk(root, expected) {
  // 1、只读取本次隔离目录。
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const all = JSON.parse(await readFile(file, 'utf8').catch(() => '{}'))
    const saved = JSON.parse(all[storageKey] || '{}')
    if (Object.entries(expected).every(([key, value]) => JSON.stringify(saved[key]) === JSON.stringify(value))) return saved
    await pollDelay(25)
  }
  assert.fail('生图设置未在运行期写入磁盘')
}

/** 捕获三帧稳定截图；1、记录完整计算样式；2、仅隐藏隔离路径文字并与原版零差异比较。 */
async function layout(desktop, name, evidence) {
  // 1、截图前检查路径值，样式采集保留真实颜色、字体及全部布局。
  const page = desktop.page
  assert.ok((await values(page)).projectRoot.startsWith(desktop.root))
  await page.mouse.move(1, 1)
  await page.evaluate(() => { document.activeElement?.blur(); return document.fonts.ready })
  await waitForVisualSettled(page)
  const form = page.locator('.settings-tab-content:visible .settings-form')
  await form.evaluate(node => { node.closest('.settings-content').scrollTop = 0 })
  const state = await form.evaluate(async root => {
    // 1、逐帧记录全部计算样式、伪元素和实际边界，连续三帧相同才接受。
    const snapshot = () => [root, ...root.querySelectorAll('*')].map(node => {
      const rect = node.getBoundingClientRect()
      const styles = pseudo => { const css = window.getComputedStyle(node, pseudo); return Object.fromEntries([...css].map(key => [key, css.getPropertyValue(key)])) }
      return { tag: node.tagName, class: node.getAttribute('class'), bounds: [rect.x, rect.y, rect.width, rect.height], style: styles(null), before: styles('::before'), after: styles('::after') }
    })
    let previous; let stable = 0
    const deadline = performance.now() + 15000
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const state = snapshot(); const current = JSON.stringify(state)
      stable = current === previous ? stable + 1 : 0
      if (stable >= 2 && document.getAnimations().every(animation => animation.playState === 'finished')) return state
      previous = current
    }
    throw new Error('完整计算样式未达到连续三帧稳定')
  })
  // 2、只抹去随机隔离路径的字形，不遮盖输入边框、背景、尺寸或其他元素。
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', style: '.n-message-container,.n-tooltip { visibility: hidden !important; } input[placeholder="请选择项目文件存储的绝对路径"] { color: transparent !important; -webkit-text-fill-color: transparent !important; }' }
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
  assert.ok(stable >= 2, '生图表单截图未达到三帧稳定')
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `${name}.png`), png, { flag: 'wx' })
  if (process.env.MOMENTUM_GEMINI_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_GEMINI_BEFORE, 'gemini-result.json'), 'utf8'))
    assert.equal(before.passed, true, '原版基线必须完整通过')
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, `生图/${name}计算样式变化`)
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_GEMINI_BEFORE, `${name}.png`)), `生图/${name}`)
  }
}

test('生图设置：输入、选择取消重置、保存校验与URL规范化、真实磁盘备份重启及原版布局', { timeout: 120000 }, async () => {
  // 1、既有启动器隔离用户目录、环境和网络，并禁止 Python 与其他子进程。
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`生图验证目录：${root}`)
  const evidence = { layouts: [], passed: false, credentials: 'local fake string only' }
  const initial = { baseUrl: '', apiKey: '', projectRoot: path.join(root, 'home/Pictures/GeminiImage'), outputDir: 'output', logDir: 'logs' }
  const expected = { baseUrl: 'https://gemini.invalid/gateway/v1', apiKey: fakeKey, projectRoot: path.join(root, 'selected-project'), outputDir: 'edited-images', logDir: 'edited-logs' }
  let saved
  try {
    await openSettings(desktop)
    const page = desktop.page
    assert.deepEqual(await values(page), initial)
    assert.deepEqual(await page.locator('.settings-tab-content:visible .n-form-item-label').allTextContents(), fields.map(([, label], index) => index < 2 ? `${label}\u00a0*` : label))
    assert.equal(await page.locator('.settings-tab-content:visible input').count(), 5)
    assert.equal(await item(page, 'API 密钥').locator('input').getAttribute('type'), 'password')
    assert.equal(await item(page, '保存根目录').locator('input').getAttribute('readonly'), '')
    await layout(desktop, 'initial', evidence)
    const unsaved = await page.evaluate(key => localStorage.getItem(key), storageKey)
    // 2、空密钥优先失败，随后覆盖 URL 的全部拒绝分支。
    await save(page, '请输入纳米香蕉生图API密钥')
    await item(page, 'API 密钥').locator('input').fill('   ')
    await save(page, '请输入纳米香蕉生图API密钥')
    await item(page, 'API 密钥').locator('input').fill(fakeKey)
    for (const [url, error] of [['', '请填写中转站地址'], ['not-a-url', '中转站地址必须是完整的 HTTP 或 HTTPS 地址'], ['ftp://gemini.invalid', '中转站地址仅支持 HTTP 或 HTTPS，且不能包含账号、查询参数或片段'], ['https://u:p@gemini.invalid', '中转站地址仅支持 HTTP 或 HTTPS，且不能包含账号、查询参数或片段'], ['https://gemini.invalid?q=1', '中转站地址仅支持 HTTP 或 HTTPS，且不能包含账号、查询参数或片段'], ['https://gemini.invalid#fragment', '中转站地址仅支持 HTTP 或 HTTPS，且不能包含账号、查询参数或片段']]) {
      await item(page, '中转站地址').locator('input').fill(url)
      await save(page, `保存失败: ${error}`)
      assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), unsaved)
    }
    await item(page, '中转站地址').locator('input').fill('  HTTPS://GEMINI.INVALID:443/gateway/v1///  ')
    // 3、使用目录对话框边界注入异常返回值，验证只读字段对应的父级校验。
    await selectFolder(desktop, ['   '])
    await save(page, '请选择项目根路径')
    assert.equal((await values(page)).baseUrl, expected.baseUrl, '路径校验之前已执行URL规范化')
    await selectFolder(desktop, ['relative-project'])
    await save(page, '项目根路径必须是绝对路径')
    await selectFolder(desktop, [expected.projectRoot])
    await selectFolder(desktop, [])
    assert.equal((await values(page)).projectRoot, expected.projectRoot, '取消保留已有路径')
    await item(page, '保存根目录').getByRole('button', { name: '重置', exact: true }).click()
    assert.equal((await values(page)).projectRoot, initial.projectRoot)
    await selectFolder(desktop, [expected.projectRoot])
    await item(page, '图片保存路径').locator('input').fill(expected.outputDir)
    await item(page, '日志路径').locator('input').fill(expected.logDir)
    assert.deepEqual(await values(page), expected)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), unsaved, '编辑选择重置不能提前保存')
    await page.evaluate(() => { location.hash = '/settings/hotkeys' })
    await page.getByText('主窗口唤醒/最小化', { exact: true }).waitFor()
    await openSettings(desktop)
    assert.deepEqual(await values(page), expected)
    await layout(desktop, 'edited', evidence)
    // 4、保存使用真实本地目录创建和备份；不替代任何保存业务。
    await save(page, '设置已保存')
    saved = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey)
    for (const [key, value] of Object.entries(expected)) assert.equal(saved[key], value)
    assert.equal(saved.editOutputDir, expected.outputDir)
    assert.deepEqual(await waitForDisk(root, saved), saved)
    for (const directory of [expected.outputDir, expected.logDir]) assert.equal((await stat(path.join(expected.projectRoot, directory))).isDirectory(), true)
    const backup = JSON.parse(await readFile(path.join(root, 'home/Documents/MomentumStickFigure/Settings/settings-latest.json'), 'utf8'))
    assert.deepEqual(backup.geminiConfig, saved)
    const restored = await page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(restored.success, true)
    assert.deepEqual(restored.settings.geminiConfig, saved)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  // 5、先验证普通磁盘重启，再清除共享配置验证备份能独立恢复。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    await layout(desktop, 'restart', evidence)
    assert.deepEqual(await desktop.page.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey), saved)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  const diskFile = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const disk = JSON.parse(await readFile(diskFile, 'utf8'))
  delete disk[storageKey]
  await writeFile(diskFile, JSON.stringify(disk))
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    await desktop.page.waitForFunction(({ key, apiKey }) => JSON.parse(localStorage.getItem(key) || '{}').apiKey === apiKey, { key: storageKey, apiKey: fakeKey })
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await waitForDisk(root, saved), saved)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'gemini-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
