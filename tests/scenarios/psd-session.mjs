/** PSD 会话回归：两份真实素材经公开界面编辑、往返与关闭，逐字节核验独立原版参考。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop, repository, readJson } from '../helpers/desktop.mjs'
import { fixtures, referenceDirectory } from '../helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from '../helpers/images.mjs'
import { referenceDigest } from './canvas-preset-hover.mjs'

export const sessionReferenceName = 'psd-session-renderer1024-dpr1-front-hand-v4'
const originalHead = '59eefa61c4575e561f57566b30a61a2f75714a4e'

/**
 * 通过实际上传入口载入指定素材。
 * 处理流程：
 * 1、仅设置隔离文件对话框结果，等待真实标签及画布
 */
async function upload(desktop, fixture) {
  // 1、保留读取、解析、分类及渲染的完整业务链路。
  await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
  await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
  await tab(desktop.page, fixture).waitFor()
  await tab(desktop.page, fixture).click()
  await stableCanvas(desktop.page)
}

/**
 * 定位素材标签。
 * 处理流程：
 * 1、使用用户可见文件名匹配，不读取随机会话标识
 */
function tab(page, fixture) {
  // 1、限定标签名称，避免匹配历史列表或消息。
  return page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
}

/**
 * 展开完整的实际图层树。
 * 处理流程：
 * 1、打开图层面板，按公开展开按钮直至节点数稳定
 */
async function expandLayers(page) {
  // 1、只有面板未显示时才切换，避免重复点击折叠当前面板。
  if (!(await page.getByRole('button', { name: '展开', exact: true }).isVisible())) await page.getByRole('button', { name: '图层', exact: true }).click()
  let previous = -1
  for (let depth = 0; depth < 100; depth++) {
    await page.getByRole('button', { name: '展开', exact: true }).click()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const count = await page.locator('.layer-item').count()
    if (count === previous) return
    previous = count
  }
  throw new Error('图层展开未在限定深度内完成')
}

/**
 * 记录用户可见状态及实际画布。
 * 处理流程：
 * 1、先展示通用控制并读取复选框，再展示全部图层及标签
 */
async function observation(page) {
  // 1、逐个展示两类面板，不注入或访问 Vue 私有状态。
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  const controls = await page.locator('.common-controls label').evaluateAll((labels) => labels.filter((label) => label.querySelector('input[type=checkbox]')).map((label) => ({ name: label.textContent.trim(), checked: label.querySelector('input').checked })))
  await expandLayers(page)
  const image = await stableCanvas(page)
  const state = await page.evaluate(() => ({
    files: [...document.querySelectorAll('.psd-tab-item')].map((node) => ({ name: node.querySelector('.psd-tab-name').getAttribute('title'), active: node.classList.contains('active') })),
    layers: [...document.querySelectorAll('.layer-item')].map((node) => ({ name: node.querySelector('.layer-name').textContent.trim(), group: node.classList.contains('is-group'), depth: node.style.paddingLeft, checked: node.querySelector('input').checked })),
    tabs: [...document.querySelectorAll('.part-tab')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active') })),
    selectedParts: [...document.querySelectorAll('.parts-virtual-items .part-item.active .part-name')].map((node) => node.textContent.trim()),
    selectedPresets: document.querySelectorAll('.preset-item.active').length
  }))
  return { image: Buffer.from(image.png, 'base64'), state: { ...state, controls } }
}

/**
 * 在不同素材中建立不同的实际编辑状态。
 * 处理流程：
 * 1、保存初始快照，设置不同互斥开关并选择不同部件
 * 2、隐藏不同叶图层，确认画布确有变化
 */
async function edit(page, index) {
  // 1、快照留在真实预设列表，切换后仍必须恢复编辑而非自动应用快照。
  const initialTab = await page.locator('.part-tab.active').innerText()
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  await page.getByTitle('添加当前画布为预设', { exact: true }).click()
  await page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
  await page.locator('.preset-item').waitFor()
  await page.locator('.part-tab').filter({ hasText: new RegExp(`^${initialTab.trim()}$`) }).click()
  if (!(await page.getByRole('checkbox', { name: '互斥', exact: true }).isVisible())) await page.getByRole('button', { name: '通用', exact: true }).click()
  for (const name of ['互斥', '动作互斥', '表情互斥']) await page.getByRole('checkbox', { name, exact: true }).setChecked(index === 1)
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  const parts = page.locator('.parts-virtual-items .part-item:not(.active)')
  assert.ok(await parts.count() > index, '素材没有足够的不同部件')
  await parts.nth(index).click()
  await stableCanvas(page)
  // 2、隐藏不同的原可见叶图层，额外覆盖图层树直接编辑入口。
  await expandLayers(page)
  const leaves = page.locator('.layer-item:not(.is-group) input[type=checkbox]:checked')
  assert.ok(await leaves.count() > 1, '素材没有足够的可见叶图层')
  // 原版末尾后发叶图层另有像素恢复问题，单独登记于 psd-session-original-layer-issue-20260906.json。
  await (index === 0 ? leaves.nth(1) : leaves.first()).uncheck()
  await stableCanvas(page)
}

/**
 * 运行原版参考采集或只读会话验证。
 * 处理流程：
 * 1、校验原提交、素材、参考摘要与固定运行环境
 * 2、建立两个独立编辑状态，往返十轮并核验关闭和重新导入
 * 3、退出隔离成功后才写入完整参考清单
 */
export async function checkPsdSession(record = false, referenceName = sessionReferenceName) {
  // 1、独立目录拒绝覆盖；旧参考的每个已登记文件始终保持原摘要。
  assert.match(referenceName, /^psd-session-[a-z0-9-]+$/)
  const samples = (await fixtures()).slice(0, 2)
  assert.equal(samples.length, 2)
  assert.notEqual(samples[0].sha256, samples[1].sha256, '必须使用两份真实不同 PSD')
  for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  const before = await referenceDigest()
  const directory = path.join(referenceDirectory, referenceName)
  let sourceTree
  if (record) {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), originalHead)
    assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'electron.vite.config.mjs'], { cwd: repository, encoding: 'utf8' }).trim(), '', '采集要求业务源码（含未跟踪文件）干净')
    sourceTree = execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repository, encoding: 'utf8' }).trim()
    await mkdir(directory)
    execFileSync('npm', ['run', 'build'], { cwd: repository, stdio: 'inherit' })
  }
  const expected = record ? null : await readJson(path.join(directory, 'manifest.json'))
  const desktop = await launchDesktop(undefined, 'software-layout')
  const actual = { version: 1, originalHead, sourceTree, fixtureHashes: samples.map((fixture) => fixture.sha256), scenes: [], oldReferenceDigest: record ? before : expected.oldReferenceDigest }
  console.log(`PSD会话验证证据：${desktop.root}`)
  /**
   * 采集并严格验证一项观察结果。
   * 处理流程：
   * 1、保存实际图片与状态，回放时只读原版输出
   */
  const snapshot = async (name) => {
    // 1、先等待相邻实际帧稳定，不重试挑选匹配参考的结果。
    const observed = await observation(desktop.page)
    const scene = { name, state: observed.state }
    actual.scenes.push(scene)
    await writeFile(path.join(desktop.root, `${name}.png`), observed.image)
    if (record) {
      await writeFile(path.join(directory, `${name}.png`), observed.image, { flag: 'wx' })
      await chmod(path.join(directory, `${name}.png`), 0o444)
    } else {
      assert.deepEqual(scene, expected.scenes[actual.scenes.length - 1], `${name} 可见 DOM 状态变化`)
      await assertSamePixels(observed.image, await readFile(path.join(directory, `${name}.png`)), name)
    }
    console.log(`PSD会话${record ? '采集' : '像素一致'}：${name}`)
    return observed
  }
  try {
    await desktop.page.setViewportSize({ width: 1024, height: 700 })
    const cdp = await desktop.page.context().newCDPSession(desktop.page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await desktop.page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 700 && window.devicePixelRatio === 1 && document.hasFocus())
    actual.environment = { runtime: await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })), renderer: await desktop.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio, focused: document.hasFocus() })), renderMode: 'software-layout' }
    if (expected) {
      assert.deepEqual(actual.environment, expected.environment)
      assert.deepEqual(actual.fixtureHashes, expected.fixtureHashes)
    }
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    // 2、先在默认控制下导入两份不同素材，再分别建立编辑状态。
    const initial = []
    const edited = []
    for (let index = 0; index < 2; index++) {
      await upload(desktop, samples[index])
      initial[index] = await snapshot(`initial-${index}`)
    }
    for (const index of [1, 0]) {
      await tab(desktop.page, samples[index]).click()
      await stableCanvas(desktop.page)
      await edit(desktop.page, index)
      edited[index] = await snapshot(`edited-${index}`)
      assert.notDeepEqual(edited[index].image, initial[index].image, '操作没有实际改变画布')
      for (const name of ['互斥', '动作互斥', '表情互斥']) assert.equal(edited[index].state.controls.find((control) => control.name === name).checked, index === 1)
    }
    for (let round = 0; round < 10; round++) {
      for (const index of [1, 0]) {
        await tab(desktop.page, samples[index]).click()
        const result = await snapshot(`round-${round}-${index}`)
        await assertSamePixels(result.image, edited[index].image, `第${round + 1}轮素材${index}编辑独立`)
        assert.deepEqual(result.state, edited[index].state, `第${round + 1}轮素材${index}实际编辑及互斥状态必须恢复`)
        assert.equal(result.state.selectedPresets, 0, '切换不得自动选中旧预设')
      }
    }
    // 3、关闭非活动、当前、最后一个文件并重新导入不同素材。
    await tab(desktop.page, samples[1]).click()
    await stableCanvas(desktop.page)
    await tab(desktop.page, samples[0]).locator('..').getByTitle('移除', { exact: true }).click()
    const remaining = await snapshot('close-inactive')
    await assertSamePixels(remaining.image, edited[1].image, '关闭非活动文件不得改变当前编辑')
    assert.equal(remaining.state.files.length, 1)
    assert.equal(remaining.state.files[0].name, path.basename(samples[1].absolutePath))
    await upload(desktop, samples[0])
    const reimportFirst = await snapshot('reimport-first')
    await assertSamePixels(reimportFirst.image, initial[0].image, '重新导入第一份素材恢复初始画布')
    assert.deepEqual(reimportFirst.state.layers, initial[0].state.layers)
    await desktop.page.locator('.psd-tab-item.active').getByTitle('移除', { exact: true }).click()
    const afterCurrent = await snapshot('close-current')
    await assertSamePixels(afterCurrent.image, edited[1].image, '关闭当前文件恢复另一份素材编辑')
    assert.deepEqual(afterCurrent.state, remaining.state)
    await desktop.page.locator('.psd-tab-item.active').getByTitle('移除', { exact: true }).click()
    assert.equal(await desktop.page.locator('.psd-tab-item').count(), 0)
    assert.equal(await desktop.page.getByRole('button', { name: '预览', exact: true }).isDisabled(), true)
    assert.equal(await desktop.page.locator('.render-canvas').evaluate((canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value) => value !== 0)), false, '关闭最后文件应清空画布')
    actual.lastClosed = { tabs: 0, previewDisabled: true, canvasEmpty: true }
    await upload(desktop, samples[1])
    const reimportLast = await snapshot('reimport-last')
    await assertSamePixels(reimportLast.image, initial[1].image, '最后关闭后重新导入恢复初始画布')
    assert.deepEqual(reimportLast.state.layers, initial[1].state.layers)
    assert.equal(reimportLast.state.selectedPresets, 0)
    assert.deepEqual(desktop.errors, [])
  } finally {
    await writeFile(path.join(desktop.root, 'session-result.json'), JSON.stringify(actual, null, 2))
    await desktop.close()
  }
  // 4、退出隔离及素材核验成功后，才允许完成不可覆盖的参考清单。
  for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  const after = await referenceDigest()
  for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, `运行前后参考发生变化：${name}`)
  for (const [name, hash] of Object.entries(actual.oldReferenceDigest)) assert.equal(after[name], hash, `已登记旧参考发生变化：${name}`)
  if (record) {
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(actual, null, 2), { flag: 'wx' })
    await chmod(path.join(directory, 'manifest.json'), 0o444)
  } else {
    assert.deepEqual(actual.scenes, expected.scenes)
    assert.deepEqual(actual.lastClosed, expected.lastClosed)
  }
}
