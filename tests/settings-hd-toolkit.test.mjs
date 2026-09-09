/** 抠图高清设置迁移回归：验证公开四字段、选择取消、保存、共享存储、备份恢复与重启。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const storageKey = 'hd-toolkit-config'
const fields = [
  ['pythonHome', 'Python 解释器路径'],
  ['removebgWeightsDir', '去背景模型权重目录'],
  ['highresWeightsDir', '高清模型权重目录'],
  ['outputDir', '输出图片保存目录']
]

function item(page, label) {
  return page.locator('.settings-tab-content:visible .n-form-item').filter({ has: page.locator('.n-form-item-label').getByText(label, { exact: true }) })
}

async function openSettings(desktop) {
  await desktop.page.setViewportSize({ width: 1024, height: 900 })
  await desktop.page.evaluate(() => { location.hash = '/settings/hd-toolkit' })
  await item(desktop.page, fields[0][1]).locator('input').waitFor()
}

async function values(page) {
  return Object.fromEntries(await Promise.all(fields.map(async ([key, label]) => [key, await item(page, label).locator('input').inputValue()])))
}

async function choose(desktop, label, selected) {
  await desktop.application.evaluate((_, paths) => { globalThis.__momentumTest.openPaths.push(...paths) }, selected)
  await item(desktop.page, label).getByRole('button', { name: '浏览', exact: true }).click()
  await desktop.page.waitForFunction(() => !document.querySelector('.settings-tab-content:not([style*="display: none"]) .n-button--loading'))
}

async function waitForDisk(root, expected) {
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    const all = JSON.parse(await readFile(file, 'utf8').catch(() => '{}') || '{}')
    const saved = JSON.parse(all[storageKey] || '{}')
    if (JSON.stringify(saved) === JSON.stringify(expected)) return saved
    await pollDelay(25)
  }
  assert.fail('抠图高清配置未写入共享磁盘')
}

async function waitForVisualSettled(page) {
  await page.waitForFunction(async () => {
    const nodes = ['.app-main', '.app-layout', '.settings-page'].map(selector => document.querySelector(selector)).filter(Boolean)
    if (nodes.length !== 3 || document.documentElement.classList.contains('theme-transition') || document.body.classList.contains('theme-transition')) return false
    if (document.getAnimations().some(animation => animation.playState !== 'finished')) return false
    const settled = node => { const css = window.getComputedStyle(node); return css.opacity === '1' && (css.transform === 'none' || css.transform === 'matrix(1, 0, 0, 1, 0, 0)') }
    if (!nodes.every(settled)) return false
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    return nodes.every(settled) && document.getAnimations().every(animation => animation.playState === 'finished')
  }, undefined, { timeout: 15000 })
}

async function capture(desktop, name, evidence) {
  const page = desktop.page
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
  const options = { animations: 'disabled', caret: 'hide', scale: 'css', style: '.n-message-container,.n-tooltip { visibility: hidden !important; } input { color: transparent !important; -webkit-text-fill-color: transparent !important; }' }
  let previous; let stable = 0; let png
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    png = await form.screenshot(options); const current = (await decodePng(png)).rgba
    stable = previous?.equals(current) ? stable + 1 : 0
    if (stable >= 2) break
    previous = current
  }
  assert.ok(stable >= 2, '抠图高清表单截图未达到三帧稳定')
  evidence.layouts.push({ name, state })
  await writeFile(path.join(desktop.root, `hd-toolkit-${name}.png`), png, { flag: 'wx' })
  if (process.env.MOMENTUM_HD_BEFORE) {
    const before = JSON.parse(await readFile(path.join(process.env.MOMENTUM_HD_BEFORE, 'hd-result.json'), 'utf8'))
    assert.equal(before.passed, true, '原版基线必须完整通过')
    assert.deepEqual(state, before.layouts.find(scene => scene.name === name).state, `抠图高清/${name}计算样式变化`)
    await assertSamePixels(png, await readFile(path.join(process.env.MOMENTUM_HD_BEFORE, `hd-toolkit-${name}.png`)), `抠图高清/${name}`)
  }
}

async function save(page) {
  await page.getByRole('button', { name: '保存设置', exact: true }).click()
  await page.getByText(/设置已保存/, { exact: false }).last().waitFor()
  await page.waitForFunction(() => !document.querySelector('.settings-tab-content:not([style*="display: none"]) .n-button--loading'))
}

test('抠图高清设置迁移：四字段、取消、保存、磁盘共享、备份恢复与重启', { timeout: 120000 }, async () => {
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  const evidence = { layouts: [], passed: false }
  console.log(`抠图高清验证目录：${root}`)
  const expected = {
    pythonHome: path.join(root, 'python-env/bin/python'),
    removebgWeightsDir: path.join(root, 'weights/removebg'),
    highresWeightsDir: path.join(root, 'weights/highres'),
    outputDir: path.join(root, 'output/hd')
  }
  try {
    await openSettings(desktop)
    const page = desktop.page
    assert.deepEqual(await values(page), { pythonHome: '', removebgWeightsDir: '', highresWeightsDir: '', outputDir: path.join(root, 'home/Pictures/hd-toolkit') })
    assert.deepEqual(await page.locator('.settings-tab-content:visible .n-form-item-label').allTextContents(), fields.map(([, label]) => label))
    assert.equal(await page.locator('.settings-tab-content:visible input').count(), 4)
    for (const [, label] of fields) {
      assert.equal(await item(page, label).locator('input').getAttribute('readonly'), '')
    }
    await capture(desktop, 'initial', evidence)
    const unsaved = await page.evaluate(key => localStorage.getItem(key), storageKey)
    await page.getByRole('button', { name: '保存设置', exact: true }).click()
    await page.getByText('请选择Python解释器路径', { exact: true }).waitFor()
    await choose(desktop, fields[0][1], [expected.pythonHome])
    await choose(desktop, fields[1][1], [expected.removebgWeightsDir])
    await choose(desktop, fields[2][1], [expected.highresWeightsDir])
    await choose(desktop, fields[3][1], [expected.outputDir])
    const beforeCancel = await values(page)
    for (const [, label] of fields) {
      await choose(desktop, label, [])
      assert.deepEqual(await values(page), beforeCancel, `${label}取消应保持原值`)
    }
    assert.deepEqual(await values(page), expected)
    assert.equal(await page.evaluate(key => localStorage.getItem(key), storageKey), unsaved, '选择不能提前持久化')
    await capture(desktop, 'edited', evidence)
    await save(page)
    assert.deepEqual(JSON.parse(await page.evaluate(key => localStorage.getItem(key), storageKey)), expected)
    assert.deepEqual(await waitForDisk(root, expected), expected)
    const backup = JSON.parse(await readFile(path.join(root, 'home/Documents/MomentumStickFigure/Settings/settings-latest.json'), 'utf8'))
    assert.deepEqual(backup.hdToolkitConfig, expected)
    const restored = await page.evaluate(() => window.electronAPI.settings.restoreSettings())
    assert.equal(restored.success, true)
    assert.deepEqual(restored.settings.hdToolkitConfig, expected)
    assert.deepEqual(desktop.errors, [])
  } finally {
    await desktop.close()
  }
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    assert.deepEqual(await values(desktop.page), expected)
    await capture(desktop, 'restart', evidence)
    assert.deepEqual(await waitForDisk(root, expected), expected)
    assert.deepEqual(desktop.errors, [])
  } finally {
    await desktop.close()
  }
  // 删除的仅为本次 fake 用户目录中的共享键，下一次启动必须依赖真实备份恢复。
  const diskFile = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const disk = JSON.parse(await readFile(diskFile, 'utf8'))
  delete disk[storageKey]
  await writeFile(diskFile, JSON.stringify(disk))
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await openSettings(desktop)
    await desktop.page.waitForFunction(({ key, pythonHome }) => JSON.parse(localStorage.getItem(key) || '{}').pythonHome === pythonHome, { key: storageKey, pythonHome: expected.pythonHome })
    assert.deepEqual(await values(desktop.page), expected)
    assert.deepEqual(await waitForDisk(root, expected), expected)
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    await desktop.close()
    await writeFile(path.join(root, 'hd-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
  }
})
