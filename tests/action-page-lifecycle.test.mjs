/**
 * 人物页生命周期原版基线：只经公开路由、菜单、PSD 上传与真实画布观察业务结果。
 * 普通人物页/首页切换受 KeepAlive 缓存，不声称发生卸载；另经欢迎页销毁主布局验证真实卸载。
 * 历史只保存文件路径，缓存返回不是历史恢复；重新挂载后显式点击“加载历史”重新解析 PSD。
 * 默认仅接受洁净源码；MOMENTUM_ACTION_LIFECYCLE_BEFORE 指向原版证据目录进行只读前后对照。
 * 由外部串行构建和执行：本测试不构建、不更新参考、不改变原后台隔离保护或 Vue 私有状态。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures, referenceDirectory } from './helpers/reference.mjs'
import { observeImages, stableCanvas, assertSamePixels, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const parentSource = 'src/renderer/src/components/pages/ActionExpressionPage/ActionExpressionPage.vue'
const lifecycleSource = 'src/renderer/src/components/pages/ActionExpressionPage/composables/useActionPageLifecycle.js'
const allowedSources = new Set([parentSource, lifecycleSource])
const resultName = 'action-page-lifecycle-result.json'
const viewport = { width: 1024, height: 700 }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()

/** 只读记录完整目录摘要、逐文件哈希和修改时间，不把摘要误称为构建溯源证明。 */
async function directoryEvidence(directory) {
  const files = {}
  async function visit(folder) {
    const entries = (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const filename = path.join(folder, entry.name)
      if (entry.isDirectory()) await visit(filename)
      else {
        assert.ok(entry.isFile(), `证据目录不接受符号链接：${filename}`)
        files[path.relative(directory, filename).split(path.sep).join('/')] = {
          sha256: sha256(await readFile(filename)), mtimeMs: (await stat(filename)).mtimeMs
        }
      }
    }
  }
  await visit(directory)
  return { sha256: sha256(JSON.stringify(Object.entries(files).map(([name, value]) => [name, value.sha256]))), files }
}

async function references() {
  try { return await referenceDigest(false, referenceDirectory) } catch (error) {
    if (error.code === 'ENOENT' && !(await stat(referenceDirectory).catch(() => null))) return { absent: true }
    throw error
  }
}

async function provenance(before) {
  const sourceStatus = git('status', '--porcelain', '--untracked-files=all', '--', 'src')
  const rendererStatus = git('status', '--porcelain', '--untracked-files=all', '--', 'src/renderer')
  const head = git('rev-parse', 'HEAD')
  const changed = before ? [...new Set([
    ...git('diff', '--name-only', before.provenance.head, '--', 'src').split('\n'),
    ...git('ls-files', '--others', '--exclude-standard', '--', 'src').split('\n')
  ].filter(Boolean))].sort() : []
  if (before) {
    assert.equal(before.version, 1)
    assert.equal(before.passed, true, '原版基线必须完整通过，包括隔离关闭')
    assert.equal(before.mode, 'baseline', '不能把迁移后的对照结果当作原版基线')
    assert.equal(before.provenance.rendererStatus, '', '原版 renderer 源码必须洁净')
    assert.equal(before.provenance.sourceStatus, '', '原版源码必须洁净')
    assert.ok(changed.every(name => allowedSources.has(name)), `目标源码超出父页面和生命周期模块：${changed.join(', ')}`)
    assert.equal(git('diff', '--name-only', before.provenance.head, '--', 'electron.vite.config.mjs', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'), '', '对照不能同时更改构建配置或依赖')
    const oldPackage = JSON.parse(git('show', `${before.provenance.head}:package.json`))
    const currentPackage = JSON.parse(await readFile(path.join(repository, 'package.json'), 'utf8'))
    const oldLint = oldPackage.scripts.lint
    const currentLint = currentPackage.scripts.lint
    assert.ok(currentLint === oldLint || currentLint.startsWith(`${oldLint} `), '只允许追加原lint覆盖')
    delete oldPackage.scripts.lint
    delete currentPackage.scripts.lint
    assert.deepEqual(currentPackage, oldPackage, '除追加lint范围外package内容不变')
  } else {
    assert.equal(rendererStatus, '', '采集原版前必须恢复洁净 renderer 源码')
    assert.equal(sourceStatus, '', '采集原版前必须恢复洁净源码')
  }
  assert.equal(git('status', '--porcelain', '--', 'electron.vite.config.mjs', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'), '', '构建配置与依赖必须洁净')
  if (!before) assert.equal(git('status', '--porcelain', '--', 'package.json'), '', '原版package必须洁净')
  const source = await directoryEvidence(path.join(repository, 'src'))
  const out = await directoryEvidence(path.join(repository, 'out'))
  const newestSource = Math.max(...Object.values(source.files).map(file => file.mtimeMs), (await stat(path.join(repository, 'electron.vite.config.mjs'))).mtimeMs)
  const entryHtml = await readFile(path.join(repository, 'out/renderer/index.html'), 'utf8')
  const scripts = [...entryHtml.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/g)].map(match => match[1])
  assert.ok(scripts.length > 0, '缺少真实 renderer 构建入口')
  for (const script of scripts) {
    const filename = path.resolve(repository, 'out/renderer', script.replace(/^\//, ''))
    assert.ok(filename.startsWith(path.join(repository, 'out/renderer') + path.sep))
    assert.ok((await stat(filename)).mtimeMs >= newestSource, `疑似旧 out：请外部重新构建后串行执行，入口 ${script} 早于源码`)
  }
  if (before && source.sha256 !== before.provenance.source.sha256) {
    assert.notEqual(out.sha256, before.provenance.out.sha256, '源码已变化但 out 哈希未变，拒绝使用旧产物')
  }
  return { head, sourceStatus, rendererStatus, changed, source, out, entryScripts: scripts, newestSource,
    freshnessLimit: '入口修改时间和哈希只能排除明显旧产物，不能代替外部可信构建证明；运行中还会复核源码与 out 不变。' }
}

/** 透明记录显式 resize 配对及历史写入；原回调、this、options/capture 和返回值原样交给浏览器。 */
function installLifecycleObservation() {
  const add = window.addEventListener
  const remove = window.removeEventListener
  const setItem = window.Storage.prototype.setItem
  const ids = new WeakMap()
  const live = new Map()
  const events = []
  let serial = 0
  let adds = 0
  let removes = 0
  let duplicateAdds = 0
  let unmatchedRemoves = 0
  let unsupportedOptions = 0
  const identity = callback => {
    if ((typeof callback !== 'function' && typeof callback !== 'object') || callback === null) return null
    if (!ids.has(callback)) ids.set(callback, ++serial)
    return ids.get(callback)
  }
  // 只读普通数据属性，避免额外调用 options getter 改变原生语义；非普通选项明确列为未计数。
  const optionsInfo = options => {
    if (options == null || typeof options === 'boolean') return { capture: Boolean(options), once: false, signal: false }
    if (typeof options !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) return null
    const result = {}
    for (const name of ['capture', 'once', 'signal']) {
      const descriptor = Object.getOwnPropertyDescriptor(options, name)
      if (descriptor && !('value' in descriptor)) return null
      if (!descriptor && name in options) return null
      result[name] = Boolean(descriptor?.value)
    }
    return result
  }
  Object.defineProperty(window, 'addEventListener', { configurable: true, writable: true, value: function (...args) {
    const result = Reflect.apply(add, this, args)
    if (this === window && args[0] === 'resize') {
      const id = identity(args[1])
      const options = optionsInfo(args[2])
      if (!options) unsupportedOptions++
      else if (id !== null) {
        adds++
        const key = `${id}:${options.capture}`
        const duplicate = live.has(key)
        if (duplicate) duplicateAdds++
        else live.set(key, { id, ...options })
        events.push({ event: 'add', id, ...options, duplicate, route: location.hash })
      }
    }
    return result
  } })
  Object.defineProperty(window, 'removeEventListener', { configurable: true, writable: true, value: function (...args) {
    const result = Reflect.apply(remove, this, args)
    if (this === window && args[0] === 'resize') {
      const id = identity(args[1])
      const options = optionsInfo(args[2])
      if (!options) unsupportedOptions++
      else if (id !== null) {
        removes++
        const matched = live.delete(`${id}:${options.capture}`)
        if (!matched) unmatchedRemoves++
        events.push({ event: 'remove', id, capture: options.capture, matched, route: location.hash })
      }
    }
    return result
  } })
  Object.defineProperty(window.Storage.prototype, 'setItem', { configurable: true, writable: true, value: function (...args) {
    const result = Reflect.apply(setItem, this, args)
    if (this === localStorage && args[0] === 'psd-file-history') events.push({
      event: 'history-write', route: location.hash, value: localStorage.getItem('psd-file-history'),
      panelPresent: Boolean(document.querySelector('.action-expression-panel')),
      tabs: [...document.querySelectorAll('.psd-tab-name[title]')].map(node => node.title)
    })
    return result
  } })
  Object.defineProperty(window, '__actionLifecycleObservation', { value: {
    snapshot: () => ({ adds, removes, duplicateAdds, unmatchedRemoves, unsupportedOptions,
      // 仅显式配对计数；once/AbortSignal 自动移除没有被替换或伪装。
      outstandingExplicitPairs: live.size, live: [...live.values()], events: events.slice() })
  } })
}

/** 等待原有延迟任务、入场动画、图片解码和公开布局持续稳定，绝不关闭动画来取参考帧。 */
async function settle(page, panel = true) {
  await page.mouse.move(0, 0)
  await page.evaluate(async ({ panel }) => {
    await document.fonts.ready
    const start = performance.now()
    const deadline = start + 20000
    let previous = ''
    let stableSince = start
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const roots = [...document.querySelectorAll('.app-main, .app-layout, .action-expression-panel, .toolbar, .canvas-area, .render-canvas, .parts-tabs-container')]
      const value = JSON.stringify(roots.map(node => {
        const style = window.getComputedStyle(node)
        return [node.className, node.getBoundingClientRect().toJSON(), style.opacity, style.transform, node.scrollLeft, node.scrollTop]
      }))
      const ready = (!panel || document.querySelector('.action-expression-panel')) &&
        roots.every(node => window.getComputedStyle(node).opacity === '1') &&
        !document.querySelector('.n-message, .n-base-wave--active, .image-hover-preview, .preset-hover-preview') &&
        [...document.images].every(image => image.complete) &&
        [...(window.__regressionImages || [])].every(image => image.complete) &&
        document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity)
      if (!ready || value !== previous) stableSince = performance.now()
      previous = value
      if (performance.now() - start >= 1200 && performance.now() - stableSince >= 700) return
    }
    throw new Error('人物页原动画、消息、解码或公开布局未稳定')
  }, { panel })
}

async function route(page, destination) {
  await page.evaluate(destination => { location.hash = destination }, destination)
  await page.waitForFunction(destination => location.hash === `#${destination}`, destination)
  if (destination === '/action-expression') await page.getByRole('button', { name: '上传', exact: true }).waitFor()
  else await page.locator('.action-expression-panel').waitFor({ state: 'detached' })
  await settle(page, destination === '/action-expression')
}

async function menu(page, name) {
  await page.getByRole('button', { name: '更多', exact: true }).click()
  await page.getByText(name, { exact: true }).click()
  await page.mouse.move(0, 0)
}

async function history(page, fixture) {
  const actual = await page.evaluate(() => JSON.parse(localStorage.getItem('psd-file-history') || 'null'))
  assert.deepEqual(actual, [fixture.absolutePath], '历史应仅保存当前 PSD 的真实路径，不应保存编辑状态')
  return actual.map(value => value === fixture.absolutePath ? `<fixture>/${fixture.path}` : value)
}

async function publicState(page) {
  return page.evaluate(() => {
    const selectors = ['.toolbar', '.psd-tabs-container', '.parts-tabs-container', '.canvas-area', '.render-canvas']
    const serialize = node => {
      const style = window.getComputedStyle(node)
      const attributes = Object.fromEntries([...node.attributes]
        .filter(item => !item.name.startsWith('data-v-') && !['id', 'aria-labelledby', 'aria-describedby'].includes(item.name))
        .map(item => [item.name, item.value]))
      return { tag: node.tagName, attributes, text: node.textContent.trim(), rect: node.getBoundingClientRect().toJSON(),
        style: Object.fromEntries(['display', 'visibility', 'opacity', 'transform', 'width', 'height', 'overflow', 'padding', 'font', 'color', 'background-color'].map(key => [key, style.getPropertyValue(key)])),
        scroll: [node.scrollLeft, node.scrollTop, node.scrollWidth, node.scrollHeight],
        checked: node.matches('input') ? node.checked : null }
    }
    return { route: location.hash, viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      sections: Object.fromEntries(selectors.map(selector => {
        const root = document.querySelector(selector)
        return [selector, root ? { root: serialize(root), nodes: selector === '.canvas-area' ? [] : [...root.querySelectorAll('*')].map(serialize) } : null]
      })) }
  })
}

async function memorySample(desktop, cdp, label) {
  const metrics = await cdp.send('Performance.getMetrics')
  return { label, sampledAt: new Date().toISOString(),
    main: await desktop.application.evaluate(({ app }) => ({ processBytes: process.memoryUsage(), processes: app.getAppMetrics().map(metric => ({ pid: metric.pid, type: metric.type, memory: metric.memory })) })),
    renderer: Object.fromEntries(metrics.metrics.filter(item => ['JSHeapUsedSize', 'JSHeapTotalSize', 'Documents', 'Nodes', 'JSEventListeners'].includes(item.name)).map(item => [item.name, item.value])) }
}

const listenerShape = snapshot => ({ adds: snapshot.adds, removes: snapshot.removes, duplicateAdds: snapshot.duplicateAdds,
  unmatchedRemoves: snapshot.unmatchedRemoves, unsupportedOptions: snapshot.unsupportedOptions,
  outstandingExplicitPairs: snapshot.outstandingExplicitPairs,
  options: snapshot.live.map(({ capture, once, signal }) => ({ capture, once, signal })) })

async function windowCount(application) {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
}

test('人物页生命周期：20轮缓存进出、尺寸重置、路径历史及2轮真实卸载恢复', { timeout: 600000 }, async () => {
  const beforeRoot = process.env.MOMENTUM_ACTION_LIFECYCLE_BEFORE ? path.resolve(process.env.MOMENTUM_ACTION_LIFECYCLE_BEFORE) : null
  const beforeDirectory = beforeRoot ? await directoryEvidence(beforeRoot) : null
  const before = beforeRoot ? JSON.parse(await readFile(path.join(beforeRoot, resultName), 'utf8')) : null
  const source = await provenance(before)
  const referenceBefore = await references()
  const fixture = (await syntheticFixtures())[0]
  await verifyFixture(fixture.absolutePath, fixture.sha256)
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page, application, root } = desktop
  const result = { version: 1, mode: before ? 'comparison' : 'baseline', provenance: source,
    fixture: { id: fixture.id, path: fixture.path, sha256: fixture.sha256 },
    scenes: {}, cycles: [], unmountCycles: [], memory: [], passed: false,
    limits: [
      '人物页与首页均为 KeepAlive 路由，20轮切换验证激活和离开守卫，不把缓存停用假称卸载。',
      '另经 /login 公开欢迎路由销毁主布局两次，观察 DOM 身份改变及 resize 配对减少；不读取 Vue 私有实例或直接调用生命周期。',
      '历史内容仅为路径；缓存返回保留文件，重新挂载后需显式加载历史重新解析，不断言编辑状态持久化。',
      'resize 数据为整个主 renderer 的显式订阅配对；记录 once/AbortSignal 选项，不声称精确追踪其自动移除；探针不持有回调强引用。',
      '内存仅报告主进程和 renderer 样本，不强制 GC，不设绝对阈值，不把单轮波动判为泄漏。',
      '沿用 helper 的后台、文件隔离和系统快捷键边界；不验证原生显示、聚焦或系统拖出。',
      '原版首次导入画布CSS尺寸为174px，激活重新适配后为186px；不要求不同操作阶段布局相同，迁移按各自原版场景零差异比较。',
      '菜单自身会成对添加与移除resize；存活配对不可累积，累计次数另作逐轮原版严格对照。',
      source.freshnessLimit
    ] }
  let stage = 'prepare'
  console.log(`人物页生命周期证据：${root}`)
  const observation = () => page.evaluate(() => window.__actionLifecycleObservation.snapshot())
  async function capture(name) {
    await settle(page)
    const canvas = await stableCanvas(page)
    const bytes = Buffer.from(canvas.png, 'base64')
    const state = await publicState(page)
    result.scenes[name] = { state, canvas: { width: canvas.width, height: canvas.height } }
    await writeFile(path.join(root, `${name}.png`), bytes, { flag: 'wx' })
    if (before) {
      assert.deepEqual(result.scenes[name], before.scenes[name], `${name}：原版公开 DOM、尺寸与布局`)
      await assertSamePixels(bytes, await readFile(path.join(beforeRoot, `${name}.png`)), `${name}：前后完整 RGBA`)
    }
    return { bytes, state }
  }
  async function preview() {
    const opening = application.waitForEvent('window')
    await page.getByRole('button', { name: '预览', exact: true }).click()
    const child = await opening
    await child.getByRole('button', { name: '关闭', exact: true }).waitFor()
    await observeImages(child)
    const actual = await stableCanvas(child, '.canvas-wrapper canvas')
    await assertSamePixels(Buffer.from(actual.png, 'base64'), Buffer.from((await stableCanvas(page)).png, 'base64'), '独立预览与实际主画布')
    assert.equal(await windowCount(application), 2)
    return child
  }
  async function leave(destination, child, fixture, label) {
    // 先通过公开菜单清空历史，避免上传自动保存使离开守卫的断言假阳性。
    await menu(page, '清空历史')
    assert.equal(await page.evaluate(() => localStorage.getItem('psd-file-history')), null)
    const cursor = (await observation()).events.length
    const closed = child.waitForEvent('close')
    await route(page, destination)
    await closed
    assert.equal(await windowCount(application), 1, `${label}：离开必须关闭独立预览`)
    const paths = await history(page, fixture)
    const audit = (await observation()).events.slice(cursor)
    const writes = audit.filter(event => event.event === 'history-write')
    assert.ok(writes.length > 0, `${label}：必须观察到真实的离开历史写入`)
    assert.ok(writes[0].panelPresent, `${label}：首次历史保存必须在人物页 DOM 离开前发生`)
    assert.deepEqual(JSON.parse(writes[0].value), [fixture.absolutePath])
    return { paths, historyWrites: writes.map(event => ({ route: event.route, panelPresent: event.panelPresent, paths })), previewClosed: true }
  }
  try {
    // 启动 helper 后先回欢迎页；重载安装 init script，确保主布局挂载前已开始观察。
    await page.evaluate(() => { location.hash = '/login' })
    await page.locator('.layout-shell').waitFor({ state: 'detached' })
    await page.addInitScript(installLifecycleObservation)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0 && window.__actionLifecycleObservation)
    await page.setViewportSize(viewport)
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
    await cdp.send('Performance.enable')
    await observeImages(page)
    result.environment = { runtime: await application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })),
      renderer: await page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio })), renderMode: 'software-layout' }
    if (before) {
      assert.deepEqual(result.environment, before.environment, '平台、运行时和像素密度必须相同')
      assert.deepEqual(result.fixture, before.fixture)
    }
    await settle(page, false)
    result.initialListeners = listenerShape(await observation())
    result.memory.push(await memorySample(desktop, cdp, 'initial-login'))
    await route(page, '/action-expression')
    await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
    await stableCanvas(page)
    const initial = await capture('initial-import')
    await history(page, fixture)
    const canvasIdentity = await page.locator('.render-canvas').elementHandle()
    assert.ok(canvasIdentity)
    const loadedListeners = listenerShape(await observation())
    assert.ok(loadedListeners.outstandingExplicitPairs > result.initialListeners.outstandingExplicitPairs, '挂载人物页应真实增加 resize 订阅')

    // 20轮真实 hash 路由切换，逐轮开预览、改视口、滚轮缩放、清历史、离开并恢复。
    for (let index = 1; index <= 20; index++) {
      stage = `keepalive-${index}`
      const child = await preview()
      await page.setViewportSize({ width: 940, height: 640 })
      const resized = await capture(`${stage}-resized`)
      assert.notDeepEqual(resized.state.sections['.render-canvas'].root.rect, initial.state.sections['.render-canvas'].root.rect, 'resize 必须改变画布公开展示尺寸')
      await assertSamePixels(resized.bytes, initial.bytes, `${stage}：窗口尺寸变化不应改变原始 RGBA`)
      await page.setViewportSize(viewport)
      await settle(page)
      const beforeWheel = await page.locator('.render-canvas').evaluate(node => node.style.width)
      await page.locator('.canvas-area').hover()
      await page.mouse.wheel(0, -200)
      await page.waitForFunction(width => document.querySelector('.render-canvas').style.width !== width, beforeWheel)
      await capture(`${stage}-zoomed`)
      const saved = await leave('/home', child, fixture, stage)
      assert.equal(await canvasIdentity.evaluate(node => node.isConnected), false, '离开后缓存画布应脱离文档')
      const away = listenerShape(await observation())
      result.memory.push(await memorySample(desktop, cdp, `${stage}-away`))
      await route(page, '/action-expression')
      assert.equal(await canvasIdentity.evaluate(node => node === document.querySelector('.render-canvas')), true, 'KeepAlive 返回必须复用同一个公开画布节点')
      const restored = await capture(`${stage}-returned`)
      await assertSamePixels(restored.bytes, initial.bytes, `${stage}：激活后的原始画布 RGBA`)
      // 原版激活可能重新计算与首次导入不同的适配尺寸；逐场景保存，并在迁移回放时严格比较原版。
      assert.equal(restored.state.viewport[0], viewport.width)
      assert.equal(restored.state.viewport[1], viewport.height)
      const returned = listenerShape(await observation())
      // 原菜单会成对新增和移除自己的 resize 监听；核对存活数量，累计次数另与原版逐轮严格对照。
      assert.equal(away.outstandingExplicitPairs, loadedListeners.outstandingExplicitPairs, '缓存停用后的存活 resize 数量')
      assert.equal(returned.outstandingExplicitPairs, loadedListeners.outstandingExplicitPairs, '重复激活不应累积 resize')
      assert.equal(away.duplicateAdds, loadedListeners.duplicateAdds)
      assert.equal(returned.duplicateAdds, loadedListeners.duplicateAdds)
      assert.equal(away.unmatchedRemoves, loadedListeners.unmatchedRemoves)
      assert.equal(returned.unmatchedRemoves, loadedListeners.unmatchedRemoves)
      result.cycles.push({ index, route: '/home', cachedCanvasReused: true, saved, awayListeners: away, returnedListeners: returned })
      result.memory.push(await memorySample(desktop, cdp, `${stage}-returned`))
    }
    // 另覆盖区域模式激活分支：原逻辑暂切模式后恢复，而不是强制返回缩放模式。
    stage = 'region-reactivation'
    await menu(page, '切换区域调整')
    const regionBefore = await capture('region-before-leave')
    assert.equal(await page.locator('.canvas-area.scale-mode').count(), 0)
    const regionChild = await preview()
    const regionSaved = await leave('/home', regionChild, fixture, stage)
    await route(page, '/action-expression')
    const regionAfter = await capture('region-returned')
    assert.deepEqual(regionAfter.state, regionBefore.state, '激活后应恢复区域模式的公开布局')
    await assertSamePixels(regionAfter.bytes, regionBefore.bytes, '区域模式激活前后完整 RGBA')
    result.regionCycle = { saved: regionSaved, listeners: listenerShape(await observation()) }
    result.memory.push(await memorySample(desktop, cdp, 'region-returned'))
    await menu(page, '切换画布缩放')
    await settle(page)
    await canvasIdentity.dispose()

    // /login 不使用 LayoutShell，公开导航会真正销毁缓存；返回是空页，需菜单加载路径历史。
    for (let index = 1; index <= 2; index++) {
      stage = `unmount-${index}`
      const oldCanvas = await page.locator('.render-canvas').elementHandle()
      const beforeLeave = await observation()
      const child = await preview()
      const saved = await leave('/login', child, fixture, stage)
      const away = await observation()
      assert.ok(away.removes > beforeLeave.removes, '离开主布局应触发 resize 移除')
      assert.equal(away.outstandingExplicitPairs, result.initialListeners.outstandingExplicitPairs, '真实卸载后显式配对应回到欢迎页数量')
      const removed = away.events.slice(beforeLeave.events.length).filter(event => event.event === 'remove')
      assert.ok(removed.some(event => event.matched && beforeLeave.live.some(item => item.id === event.id && item.capture === event.capture)), '必须按同一回调身份与 capture 配对移除')
      await route(page, '/action-expression')
      assert.equal(await oldCanvas.evaluate(node => node === document.querySelector('.render-canvas')), false, '真实卸载返回应生成新画布节点')
      await oldCanvas.dispose()
      assert.equal(await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).count(), 0, '历史不会在挂载时自动恢复 PSD')
      assert.equal(await page.getByRole('button', { name: '预览', exact: true }).isDisabled(), true)
      await history(page, fixture)
      await menu(page, '加载历史')
      await page.getByTitle(path.basename(fixture.absolutePath), { exact: true }).waitFor()
      await stableCanvas(page)
      const restored = await capture(`${stage}-history-loaded`)
      await assertSamePixels(restored.bytes, initial.bytes, `${stage}：按路径重新解析默认画布`)
      assert.deepEqual(restored.state, initial.state, `${stage}：重新解析默认公开 DOM`)
      result.unmountCycles.push({ index, route: '/login', newCanvas: true, explicitHistoryLoad: true, saved,
        awayListeners: listenerShape(away), returnedListeners: listenerShape(await observation()) })
      result.memory.push(await memorySample(desktop, cdp, `${stage}-history-loaded`))
    }
    assert.deepEqual(desktop.errors, [], '真实页面不应抛出未处理异常')
    assert.deepEqual(desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line)), [])
    result.listenerAudit = await observation()
    // 合成素材每次临时路径不同，仅在序列化证据中归一化；运行时断言始终使用真实路径。
    result.listenerAudit.events = result.listenerAudit.events.map(event => event.event === 'history-write'
      ? { ...event, value: JSON.stringify(JSON.parse(event.value).map(value => value === fixture.absolutePath ? `<fixture>/${fixture.path}` : value)) } : event)
    if (before) {
      assert.deepEqual(Object.keys(result.scenes), Object.keys(before.scenes), '完整场景集合必须一致')
      assert.deepEqual(result.initialListeners, before.initialListeners)
      assert.deepEqual(result.cycles, before.cycles, '20轮缓存离开、保存、预览关闭与 resize 配对对照')
      assert.deepEqual(result.regionCycle, before.regionCycle, '区域模式激活分支对照')
      // 组件库菜单在相同原版回放中可能额外完成一组成对订阅；总计仍完整记录，跨运行比较存活资源与配对错误。
      const stableLifecycle = value => {
        if (Array.isArray(value)) return value.map(stableLifecycle)
        if (!value || typeof value !== 'object') return value
        return Object.fromEntries(Object.entries(value).filter(([key]) => !['adds', 'removes'].includes(key)).map(([key, item]) => [key, stableLifecycle(item)]))
      }
      assert.deepEqual(stableLifecycle(result.unmountCycles), stableLifecycle(before.unmountCycles), '真实卸载、存活订阅及显式路径恢复对照')
      result.beforeRoot = beforeRoot
    }
    stage = 'completed'
  } catch (error) {
    result.failure = { stage, message: error.message }
    throw error
  } finally {
    // 所有异常路径也执行原 helper 关闭检查；只有关闭、素材和只读参考复核全部通过才标记成功。
    try {
      await desktop.close()
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      assert.deepEqual(await references(), referenceBefore, '既有参考目录必须只读')
      if (beforeRoot) assert.deepEqual(await directoryEvidence(beforeRoot), beforeDirectory, '指定前对照证据必须只读')
      assert.equal((await directoryEvidence(path.join(repository, 'src'))).sha256, source.source.sha256, '执行期间源码发生变化，证据无效')
      assert.equal((await directoryEvidence(path.join(repository, 'out'))).sha256, source.out.sha256, '执行期间 out 发生变化，证据无效')
      assert.equal(git('rev-parse', 'HEAD'), source.head, '执行期间 HEAD 发生变化')
      result.passed = stage === 'completed'
    } catch (error) {
      result.cleanupFailure = error.message
      result.passed = false
      throw error
    } finally {
      await writeFile(path.join(root, resultName), JSON.stringify(result, null, 2), { flag: 'wx' })
    }
  }
})
