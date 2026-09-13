/** 共享 ref 回归：构建实际生产模块，仅替换 UI 服务及 Electron/浏览器边界，不复制业务函数。 */
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { build } from 'vite'
import { ref, shallowRef, effectScope, nextTick } from 'vue'
import { parse, compileScript } from '@vue/compiler-sfc'

const repository = fileURLToPath(new URL('../', import.meta.url))
const pageDirectory = path.join(repository, 'src/renderer/src/components/pages/ActionExpressionPage')
let output, modules
const messages = []
const handlers = new Map()
const drags = []
const desktopWindow = {
  once() {}, removeListener() {},
  webContents: { send() {}, startDrag(payload) { drags.push(payload) } }
}

before(async () => {
  await mkdir(path.join(repository, 'temp'), { recursive: true })
  output = await mkdtemp(path.join(repository, 'temp/action-shared-refs-'))
  globalThis.__sharedRefTestBoundary = { messages, handlers, desktopWindow }
  const exports = ['useLayerTree', 'useCanvasRender', 'usePresetData', 'usePreviewSyncSubscriptions', 'useDragHandlers', 'usePartImageDrag']
  await build({
    configFile: false, logLevel: 'error', ssr: { noExternal: ['naive-ui', 'electron'] },
    resolve: { alias: { '@renderer': path.join(repository, 'src/renderer/src') } },
    plugins: [{
      name: 'shared-ref-test-boundaries', enforce: 'pre',
      resolveId(id) {
        if (id === path.resolve('shared-ref-entry')) return '\0shared-ref-entry'
        if (['shared-ref-entry', 'naive-ui', 'electron'].includes(id)) return `\0${id}`
      },
      load(id) {
        if (id === '\0shared-ref-entry') return exports.map(name => `export { ${name} } from ${JSON.stringify(path.join(pageDirectory, `composables/${name}.js`))}`).join('\n') + `\nexport { registerDragToJianyingHandlers } from ${JSON.stringify(path.join(repository, 'src/main/drag-clipboard-handler.js'))}`
        if (id === '\0naive-ui') return `const message = new Proxy({}, { get: (_, method) => (...args) => globalThis.__sharedRefTestBoundary.messages.push({ method, args }) }); export const useMessage = () => message; export const useDialog = () => ({});`
        if (id === '\0electron') return `const boundary = globalThis.__sharedRefTestBoundary; export const BrowserWindow = { fromWebContents: () => boundary.desktopWindow }; export const ipcMain = { handle: (name, callback) => boundary.handlers.set(name, callback) }; export const clipboard = { writeText() {} }; export const nativeImage = { createFromDataURL: () => ({ resize() { return this } }) };`
      }
    }],
    build: { ssr: 'shared-ref-entry', outDir: output, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'modules.mjs' } } }
  })
  modules = await import(pathToFileURL(path.join(output, 'modules.mjs')).href)
  modules.registerDragToJianyingHandlers()
})

after(async () => {
  delete globalThis.__sharedRefTestBoundary
  if (output) await rm(output, { recursive: true, force: true })
})

const sharedTreeRefs = () => ({ layerTreeData: ref([]), layerTreeOperations: ref({}), selectedLayersMap: ref({}), controlPriority: ref('parts') })
const treeDeps = () => ({ currentPsdData: ref({ layerHierarchy: [{ name: '后发', type: 'layer', visible: true, children: [] }] }), showFront: ref(true), selectedParts: ref({}), onRenderTrigger: () => Promise.resolve() })
const canvas = () => ({ width: 10, height: 10, getContext: () => ({ clearRect() {}, drawImage() {} }), toBlob: callback => callback(new Blob(['new-png-bytes'])), toDataURL: () => 'data:image/png;base64,aWNvbg==' })
const renderDeps = () => ({ canvasRef: shallowRef(canvas()), canvasScale: ref(1), selectedPresetId: ref(null), presets: ref([]), updateSelectedLayersMap() {}, renderByLayerTree: async () => ({ layersRendered: 1 }) })
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setGlobal(t, key, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, key)
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key] })
}

test('图层树复用注入的四个 ref，值替换与生产操作不会分离引用', async () => {
  const shared = sharedTreeRefs()
  const deps = treeDeps()
  const tree = modules.useLayerTree({ ...deps, ...shared })
  for (const name of Object.keys(shared)) assert.equal(tree[name], shared[name], `${name} 必须是原 ref`)
  shared.layerTreeData.value = tree.buildLayerTree(deps.currentPsdData.value)
  await tree.handleLayerVisibilityChange({ layerPath: '后发', visible: false })
  assert.equal(shared.controlPriority.value, 'layerTree')
  assert.equal(shared.layerTreeData.value[0].visible, false)
  assert.equal(shared.layerTreeOperations.value['后发'].visible, false)
  shared.selectedLayersMap.value = { stale: true }
  tree.updateSelectedLayersMap()
  assert.deepEqual(shared.selectedLayersMap.value, {})
  tree.clearLayerTreeOperations()
  assert.deepEqual(shared.layerTreeOperations.value, {})
  for (const name of Object.keys(shared)) assert.equal(tree[name], shared[name])
})

test('未注入或仅注入部分 ref 时保留每实例独立默认值', () => {
  const first = modules.useLayerTree(treeDeps())
  const second = modules.useLayerTree(treeDeps())
  for (const name of Object.keys(sharedTreeRefs())) assert.notEqual(first[name], second[name])
  assert.deepEqual(first.layerTreeData.value, [])
  assert.deepEqual(first.layerTreeOperations.value, {})
  assert.deepEqual(first.selectedLayersMap.value, {})
  assert.equal(first.controlPriority.value, 'parts')
  const priority = ref('layerTree')
  assert.equal(modules.useLayerTree({ ...treeDeps(), controlPriority: priority }).controlPriority, priority)
  const render1 = modules.useCanvasRender(renderDeps())
  const render2 = modules.useCanvasRender(renderDeps())
  assert.equal(render1.isRendering.value, false)
  assert.notEqual(render1.isRendering, render2.isRendering)
})

test('真实画布渲染复用 isRendering，受控完成及失败均释放同一忙碌引用', async () => {
  for (const failure of [false, true]) {
    const isRendering = ref(false)
    const gate = deferred()
    const renderer = modules.useCanvasRender({ ...renderDeps(), isRendering, renderByLayerTree: () => gate.promise })
    assert.equal(renderer.isRendering, isRendering)
    const work = renderer.renderAllLayers()
    try {
      assert.equal(isRendering.value, true)
      await Promise.resolve()
      assert.equal(isRendering.value, true, '异步绘制未结束时保持忙碌')
    } finally {
      if (failure) gate.reject(new Error('controlled-render-failure'))
      else gate.resolve({ layersRendered: 1 })
      await work
    }
    assert.equal(isRendering.value, false)
  }
})

test('真实预设异步加载共享忙碌状态，预览订阅等待完成后同步', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const images = []
  setGlobal(t, 'Image', class { constructor() { images.push(this) } })
  setGlobal(t, 'document', { createElement: () => canvas() })
  const isRendering = ref(false)
  const deps = renderDeps()
  let directSyncs = 0, subscriptionSyncs = 0
  const preset = modules.usePresetData({ currentPsdFile: ref(null), currentPsdData: ref(null), canvasRef: deps.canvasRef, canvasWidth: ref(10), canvasHeight: ref(10), isRendering, renderAllLayers() {}, syncCanvasToPreview: async () => { directSyncs++ } })
  const renderer = modules.useCanvasRender({ ...deps, isRendering, presets: preset.presets, selectedPresetId: preset.selectedPresetId, renderPreset: preset.renderPreset })
  assert.equal(renderer.isRendering, isRendering)
  const scope = effectScope()
  t.after(() => scope.stop())
  const selectedParts = ref({})
  scope.run(() => modules.usePreviewSyncSubscriptions({ logEvent() {} }).registerPreviewSyncWatches({
    selectedParts, currentTab: ref('frontHandNormal'), currentPsdData: ref(null), isRenderingTemplatePreview: ref(false), isRendering,
    canvasRef: deps.canvasRef, syncCanvasToPreview: async () => { subscriptionSyncs++ }
  }))
  const item = { id: 'preset-1', name: '共享预设', base64Image: 'data:image/png;base64,cG5n' }
  preset.presets.value = [item]
  preset.selectedPresetId.value = item.id
  const work = renderer.renderAllLayers()
  assert.equal(isRendering.value, true)
  selectedParts.value = { hand: 'changed' }
  await nextTick()
  t.mock.timers.tick(100)
  assert.equal(subscriptionSyncs, 0, '真实预览订阅在预设加载中必须延后')
  images[0].onload()
  await work
  assert.equal(isRendering.value, false)
  assert.equal(directSyncs, 1)
  t.mock.timers.tick(50)
  t.mock.timers.tick(100)
  assert.equal(subscriptionSyncs, 1)
  // 图片失败也必须释放原 ref，且不得同步失败的图片。
  const failed = renderer.renderAllLayers()
  assert.equal(isRendering.value, true)
  images[1].onerror(new Error('controlled-image-failure'))
  await failed
  assert.equal(isRendering.value, false)
  assert.equal(directSyncs, 1)
})

test('早期创建的真实拖拽读取图层优先级，主进程强制重命名保护原文件', async t => {
  const root = path.join(output, 'drag-files')
  await mkdir(root)
  const calls = []
  const config = { outputRoot: root, overwriteMode: 'overwrite', createPsdFolder: true, forceRename: false }
  setGlobal(t, 'localStorage', { getItem: () => JSON.stringify(config) })
  setGlobal(t, 'window', { electronAPI: { createTempFileAndStartDrag: async (...args) => {
    calls.push(args)
    return handlers.get('create-temp-file-and-start-drag')({ sender: {} }, ...args)
  } } })
  setGlobal(t, 'document', { createElement: () => canvas() })
  const shared = sharedTreeRefs()
  const currentPsdFile = ref({ name: '原始_完整 名称.psd' })
  const drag = modules.useDragHandlers({
    state: { dragFollowCanvas: ref(null) }, constants: {},
    deps: { canvasRef: shallowRef(canvas()), controlPriority: shared.controlPriority, currentPsdFile, buildSuggestedFileName: () => 'same.png' }
  })
  // 与页面相同：拖拽先建立，图层树后初始化，操作发生后拖拽仍读取原引用。
  const deps = treeDeps()
  const tree = modules.useLayerTree({ ...deps, ...shared })
  tree.layerTreeData.value = tree.buildLayerTree(deps.currentPsdData.value)
  const initial = await drag.createTempFileAndDrag()
  assert.equal(initial.success, true)
  assert.equal(calls[0][3].forceRename, false, '部件模式尊重覆盖设置')
  assert.equal(calls[0][3].psdBaseName, '原始_完整_名称')
  assert.equal(path.dirname(initial.filePath), path.join(root, '原始_完整_名称'))
  await writeFile(initial.filePath, 'original-file-must-survive')
  await tree.handleLayerVisibilityChange({ layerPath: '后发', visible: false })
  const next = await drag.createTempFileAndDrag()
  assert.equal(next.success, true)
  assert.equal(calls[1][3].forceRename, true, '真实 IPC 参数必须看到后初始化图层树的优先级')
  assert.notEqual(next.filePath, initial.filePath)
  assert.equal(await readFile(initial.filePath, 'utf8'), 'original-file-must-survive')
  assert.equal(await readFile(next.filePath, 'utf8'), 'new-png-bytes')
  assert.equal(drags.at(-1).file, next.filePath)
  // 小图拖拽始终 forceRename，不随图层/部件优先级变化。
  const partDrag = modules.usePartImageDrag({ currentPsdFile, controlPriority: shared.controlPriority })
  for (const priority of ['parts', 'layerTree']) {
    shared.controlPriority.value = priority
    const previousCalls = calls.length
    await partDrag.handlePartDragStart({ preventDefault() {}, stopPropagation() {}, target: { tagName: 'IMG', src: 'file://part.png', width: 10, height: 10 } }, { name: '前手' })
    assert.equal(calls.length, previousCalls + 1, '小图必须调用真实拖拽桥接入口')
    assert.equal(calls.at(-1)[3].forceRename, true)
    assert.match(calls.at(-1)[2], /^原始_完整_名称_前手_\d+\.png$/)
  }
  assert.equal(currentPsdFile.value.name, '原始_完整 名称.psd', '输出名称清理不得修改 PSD 原名')
  assert.equal(config.forceRename, false, '导出不得修改持久化覆盖设置')
})

test('页面静态接线：五个 const ref 只创建一次，生产工厂显式接收原引用', async () => {
  const source = await readFile(path.join(pageDirectory, 'ActionExpressionPage.vue'), 'utf8')
  const { descriptor } = parse(source)
  const script = compileScript(descriptor, { id: 'shared-ref-page-contract' })
  const nodes = []
  const walk = node => {
    if (!node || typeof node !== 'object') return
    if (node.type) nodes.push(node)
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(walk)
      else if (value && typeof value === 'object') walk(value)
    }
  }
  script.scriptSetupAst.forEach(walk)
  const names = ['isRendering', ...Object.keys(sharedTreeRefs())]
  for (const name of names) {
    const declarations = nodes.filter(node => node.type === 'VariableDeclaration' && node.declarations.some(declaration => declaration.id.name === name))
    assert.equal(declarations.length, 1, `${name} 只有一个声明`)
    assert.equal(declarations[0].kind, 'const', `${name} 容器不可重新赋值`)
    const declaration = declarations[0].declarations.find(item => item.id.name === name)
    assert.equal(declaration.init.callee.name, 'ref')
    assert.equal(nodes.some(node => node.type === 'AssignmentExpression' && node.left.name === name), false)
  }
  for (const [factory, fields] of [['useCanvasRender', ['isRendering']], ['initLayerTree', Object.keys(sharedTreeRefs())], ['usePresetData', ['isRendering']], ['usePartImageDrag', ['controlPriority']]]) {
    const call = nodes.find(node => node.type === 'CallExpression' && node.callee.name === factory)
    assert.ok(call, `${factory} 接线必须存在`)
    for (const name of fields) assert.ok(call.arguments[0].properties.some(property => property.key?.name === name && property.value?.name === name), `${factory} 注入原 ${name}`)
  }
})
