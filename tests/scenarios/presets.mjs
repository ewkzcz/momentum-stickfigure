/** 预设生命周期回归：验证快照与编辑状态区分、跨素材恢复、文件删除及重启。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { launchDesktop, repository, readJson } from '../helpers/desktop.mjs'
import { fixtures, referenceDirectory } from '../helpers/reference.mjs'
import { stableCanvas, observeImages, assertSamePixels, verifyFixture, decodePng } from '../helpers/images.mjs'

// 此独立环境候选已在原业务源码下完成采集及两次全场景零差异回放；旧参考目录保持不变。
const defaultReference = 'preset-lifecycle-renderer1024-dpr1-focus-v1'
const layoutOptions = { scale: 'css', animations: 'disabled', caret: 'hide', style: '.n-message-container,.n-tooltip { visibility: hidden !important; }' }

/** 固定 Chromium 视口与页面焦点；原生窗口大小及命令行 DPR 在 macOS 上不足以固定截图。 */
async function prepareLayoutEnvironment(desktop) {
  // 1、仅控制测试浏览器环境，不改 DOM、业务状态或原生窗口焦点，不抢占其他测试窗口。
  await desktop.page.setViewportSize({ width: 1024, height: 700 })
  const cdp = await desktop.page.context().newCDPSession(desktop.page)
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
  await desktop.page.waitForFunction(() => window.innerWidth === 1024 && window.innerHeight === 700 && window.devicePixelRatio === 1 && document.hasFocus())
}

/** 环境单独留证，平台、版本、renderer 尺寸或焦点变化时明确失败。 */
async function layoutEnvironment(desktop) {
  // 1、原生屏幕信息仅作为诊断；实际像素契约约束已固定的 renderer 环境。
  const runtime = await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome }))
  const renderer = await desktop.page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio, focused: document.hasFocus(), visibility: document.visibilityState, screenWidth: window.screen.width, screenHeight: window.screen.height, viewportScale: window.visualViewport.scale }))
  const native = await desktop.application.evaluate(({ BrowserWindow, screen }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { bounds: window.getBounds(), content: window.getContentBounds(), focused: window.isFocused(), zoomFactor: window.webContents.getZoomFactor(), displays: screen.getAllDisplays().map(({ bounds, workArea, scaleFactor }) => ({ bounds, workArea, scaleFactor })) }
  })
  const environment = { runtime, renderer, viewport: desktop.page.viewportSize(), renderMode: 'software-layout', focusEmulation: true, screenshot: layoutOptions }
  assert.deepEqual(renderer, { width: 1024, height: 700, devicePixelRatio: 1, focused: true, visibility: 'visible', screenWidth: 1024, screenHeight: 700, viewportScale: 1 })
  await writeFile(path.join(desktop.root, 'layout-environment.json'), JSON.stringify({ environment, native }, null, 2))
  return environment
}

/** 只根据相邻实际帧等待合成稳定，不通过重试挑选匹配参考的帧。 */
async function stableLayout(page) {
  // 1、要求连续三张截图 RGBA 完全一致，最终仍逐字节比较不可变参考。
  await page.evaluate(() => document.fonts.ready)
  const deadline = Date.now() + 10000
  let previous
  let unchanged = 0
  while (Date.now() < deadline) {
    const bytes = await page.screenshot(layoutOptions)
    const image = await decodePng(bytes)
    assert.equal(image.width, 1024, 'layout 截图宽度必须为 1024 CSS 像素')
    assert.equal(image.height, 700, 'layout 截图高度必须为 700 CSS 像素')
    unchanged = previous?.equals(image.rgba) ? unchanged + 1 : 0
    if (unchanged >= 2) return bytes
    previous = image.rgba
  }
  throw new Error('layout 实际帧未在 10 秒内达到 RGBA 零差异稳定状态')
}

/** 通过现有上传入口导入素材，不绕过分类及会话初始化。 */
async function upload(desktop, fixture) {
  // 1、只控制文件选择结果，保留实际读取及渲染链路。
  await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
  await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
  const name = path.basename(fixture.absolutePath, '.psd')
  await desktop.page.locator('.psd-tab-name').filter({ hasText: name }).waitFor()
  await desktop.page.locator('.psd-tab-name').filter({ hasText: name }).click()
  await desktop.page.locator('.psd-tab-item.active .psd-tab-name').filter({ hasText: name }).waitFor()
  await stableCanvas(desktop.page)
}

/** 等待业务画布等于已保存的参考像素，而不只等待标签被选中。 */
async function canvasEquals(page, png) {
  // 1、当前业务输出由场景参考约束，图片完成解码后再逐字节验证。
  const actual = await stableCanvas(page)
  await assertSamePixels(Buffer.from(actual.png, 'base64'), png, '预设生命周期画布')
  return actual
}

/** 读取实际预设持久化元数据，不依赖 Vue 组件的私有变量。 */
async function presetMetadata(page) {
  // 1、按兼容的磁盘数据格式取得所有预设。
  return page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-all-presets') || '{"psdItems":[]}').psdItems.flatMap((item) => item.presets || []))
}

/** 为两份指定素材执行预设往返、删除和重启场景。 */
export async function checkPresetLifecycle(record = false, referenceName = process.env.MOMENTUM_PRESET_REFERENCE || defaultReference) {
  assert.match(referenceName, /^preset-lifecycle-[a-z0-9-]+$/, '预设参考必须使用明确且不含路径的独立环境名称')
  const samples = await fixtures()
  assert.ok(samples.length >= 2, '预设跨 PSD 回归需要两份指定素材')
  const [first, second] = samples
  for (const fixture of [first, second]) await verifyFixture(fixture.absolutePath, fixture.sha256)
  const directory = path.join(referenceDirectory, referenceName)
  let sourceTree
  if (record) {
    execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'electron.vite.config.mjs'], { cwd: repository })
    sourceTree = execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repository, encoding: 'utf8' }).trim()
    await mkdir(directory)
  }
  const expected = record ? null : await readJson(path.join(directory, 'manifest.json'))
  const states = []
  let desktop = await launchDesktop(undefined, 'software-layout')
  const root = desktop.root
  console.log(`预设回归证据：${root}`)
  /** 记录或核验独立参考，预期图片只在修改前显式采集。 */
  const snapshot = async (name, bytes) => {
    // 1、每个场景保存实际输出；回归时不得修改参考。
    states.push(name)
    await writeFile(path.join(root, `${name}.png`), bytes)
    if (record) {
      await writeFile(path.join(directory, `${name}.png`), bytes, { flag: 'wx' })
      await chmod(path.join(directory, `${name}.png`), 0o444)
    } else {
      assert.equal(expected.scenes[states.length - 1], name)
      await assertSamePixels(bytes, await readFile(path.join(directory, `${name}.png`)), name)
    }
  }
  let savedPreset
  let environment
  try {
    await prepareLayoutEnvironment(desktop)
    // 1、从真实初始画面 P 保存预设，再编辑为画面 Q，建立两种状态的明确参考。
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    await upload(desktop, first)
    // renderer 已在进入业务页面前固定，禁止上传后才调整窗口引入第二次布局。
    const initial = Buffer.from((await stableCanvas(desktop.page)).png, 'base64')
    const initialTab = await desktop.page.locator('.part-tab.active').innerText()
    await snapshot('saved-preset', initial)
    await desktop.page.getByTitle('添加当前画布为预设', { exact: true }).click()
    await desktop.page.waitForFunction(() => JSON.parse(localStorage.getItem('stickfigure-all-presets') || '{"psdItems":[]}').psdItems.some((item) => item.presets?.some((preset) => preset.previewPath)))
    savedPreset = (await presetMetadata(desktop.page))[0]
    assert.ok(savedPreset.previewPath, '预设预览没有真实落盘路径')
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    const previewPath = path.join(userData, savedPreset.previewPath)
    await access(previewPath)
    const partTab = desktop.page.locator('.parts-tabs').getByRole('button', { name: initialTab.trim(), exact: true })
    await partTab.click()
    await desktop.page.locator('.parts-virtual-items .part-item:not(.active)').first().click()
    const edited = Buffer.from((await stableCanvas(desktop.page)).png, 'base64')
    await snapshot('edited-state', edited)
    assert.notDeepEqual(initial, edited, '测试操作未改变画布，无法检验快照与编辑状态区别')

    // 2、显式选择预设后恢复 P；切换到另一份素材再返回，应恢复编辑状态 Q。
    await desktop.page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
    await desktop.page.locator('.preset-item').click()
    await canvasEquals(desktop.page, initial)
    await upload(desktop, second)
    await desktop.page.locator('.psd-tab-name').filter({ hasText: path.basename(first.absolutePath, '.psd') }).click()
    await desktop.page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
    await desktop.page.locator('.preset-item').waitFor()
    assert.equal(await desktop.page.locator('.preset-item.active').count(), 0, 'PSD切换后不应自动选中旧预设')
    await canvasEquals(desktop.page, edited)
    await snapshot('return-edited', Buffer.from((await stableCanvas(desktop.page)).png, 'base64'))
    await desktop.page.locator('.preset-item').click()
    await canvasEquals(desktop.page, initial)

    // 3、截取稳定布局参考，隐藏瞬时消息而保留真实按钮、面板和画布样式。
    await desktop.page.mouse.move(1, 1)
    await desktop.page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity))
    environment = await layoutEnvironment(desktop)
    if (!record) assert.deepEqual(environment, expected.environment, 'layout 环境与参考不一致；应显式记录独立环境候选，禁止覆盖旧参考')
    const layout = await stableLayout(desktop.page)
    await snapshot('layout', layout)

    // 4、通过实际右键确认删除，等待元数据、卡片和预览文件三者都消失。
    await desktop.page.locator('.preset-item').click({ button: 'right' })
    await desktop.page.locator('.template-context-menu .context-menu-item').filter({ hasText: /^删除/ }).click()
    await desktop.page.locator('.n-dialog').filter({ hasText: '确认删除' }).getByRole('button', { name: '删除', exact: true }).click()
    await desktop.page.locator('.preset-item').waitFor({ state: 'detached' })
    await desktop.page.waitForFunction((id) => !JSON.parse(localStorage.getItem('stickfigure-all-presets') || '{"psdItems":[]}').psdItems.some((item) => item.presets?.some((preset) => preset.id === id)), savedPreset.id)
    await desktop.page.waitForFunction(async (relativePath) => !(await window.electronAPI.invoke('template-storage-load-image', { relativePath })).success, savedPreset.previewPath)
    await assert.rejects(access(previewPath), { code: 'ENOENT' })
    await canvasEquals(desktop.page, edited)
    await snapshot('deleted-edited', Buffer.from((await stableCanvas(desktop.page)).png, 'base64'))
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }

  // 5、重新启动真实应用并重新导入，确认删除结果没有因退出而丢失。
  desktop = await launchDesktop(root, 'software-layout')
  try {
    await prepareLayoutEnvironment(desktop)
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    await upload(desktop, first)
    await desktop.page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
    await desktop.page.getByText('暂无预设，点击"预设"按钮创建预设', { exact: true }).waitFor()
    assert.ok(!(await presetMetadata(desktop.page)).some((preset) => preset.id === savedPreset.id))
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
  for (const fixture of [first, second]) await verifyFixture(fixture.absolutePath, fixture.sha256)
  if (record) {
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ version: 2, referenceName, sourceTree, environment, recordedAt: new Date().toISOString(), scenes: states, fixtureHashes: [first.sha256, second.sha256] }, null, 2), { flag: 'wx' })
    await chmod(path.join(directory, 'manifest.json'), 0o444)
  } else {
    assert.deepEqual(expected.fixtureHashes, [first.sha256, second.sha256])
    assert.deepEqual(expected.scenes, states)
  }
}
