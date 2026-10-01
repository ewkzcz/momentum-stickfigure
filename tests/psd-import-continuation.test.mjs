/** 真实解析编排与分类器；仅暂停原生PNG解码完成通知，保留真实分类结果。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createRenderer, h, ref, shallowRef } from 'vue'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { usePsdParser } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/usePsdParser.js'
import { classifyParts } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/usePartsClassify.js'

const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)) }
function setup(t) {
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, () => {})
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const images = [], calls = { loads: 0, renders: 0 }
  const png = createCanvas(2, 2); png.getContext('2d').fillRect(0, 0, 2, 2)
  const data = { width: 2, height: 2, layerHierarchy: [{ name: '前手', type: 'group', children: [{ name: '组合手', type: 'group', children: [{ name: '像素', width: 2, height: 2, imageData: png.toDataURL() }] }] }] }
  const globals = {
    localStorage: { getItem: () => null }, document: { createElement: () => createCanvas(2, 2) },
    window: { electronAPI: { invoke: async () => ({ success: true, data }) } },
    Image: class { constructor() {
      const image = createCanvas(2, 2)
      Object.defineProperty(image, 'src', { set(source) { image.ready = loadImage(source).then(decoded => image.getContext('2d').drawImage(decoded, 0, 0)) } })
      images.push(image); return image
    } }
  }
  for (const [key, value] of Object.entries(globals)) {
    const original = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
    t.after(() => original ? Object.defineProperty(globalThis, key, original) : delete globalThis[key])
  }
  const deps = {}
  for (const key of ['psdFiles', 'presets', 'layerTreeData', 'dynamicExpressionTabs', 'dynamicFrontHandTabs', 'dynamicBackHandTabs', 'dynamicBothHandsTabs', 'dynamicUpperBodyTabs', 'dynamicLowerBodyTabs', 'dynamicActionTabs']) deps[key] = ref([])
  for (const key of ['psdPartsCache', 'selectedLayersMap', 'selectedParts', 'userInteracted']) deps[key] = ref({})
  for (const key of ['currentPsdFile', 'currentPsdData', 'selectedPresetId', 'editingPresetId', 'currentTab', 'controlPriority', 'canvasWidth', 'canvasHeight']) deps[key] = shallowRef(null)
  for (const key of ['frontHandParts', 'frontHandNormalParts', 'frontHandRightParts', 'frontHandBothParts', 'backHandParts', 'frontLayerBackHandParts', 'bothHandsParts', 'upperBodyParts', 'lowerBodyParts', 'actionParts', 'dynamicExpressionParts', 'dynamicFrontHandParts', 'dynamicBackHandParts', 'dynamicBothHandsParts', 'dynamicUpperBodyParts', 'dynamicLowerBodyParts', 'dynamicActionParts']) deps[key] = ref([])
  let id = 0
  Object.assign(deps, { classifyParts, generateId: () => `file-${++id}`, buildLayerTree: () => [], setLayerVisibilityByPath() {}, syncBackgroundControlFromLayerTree() {}, updateCanvasDisplaySize() {}, getFirstDefaultTabKey: () => 'default', loadPresets: async () => { calls.loads++ }, renderAllLayers: () => { calls.renders++ }, message: { loading() {}, destroyAll() {} } })
  let parser
  const renderer = createRenderer({ createElement: () => ({}), insert() {}, remove() {}, createText: () => ({}), createComment: () => ({}), setText() {}, setElementText() {}, parentNode() {}, nextSibling() {}, patchProp() {} })
  const app = renderer.createApp({ setup() { parser = usePsdParser(deps); return () => h('div') } })
  app.mount({})
  t.after(() => app.unmount())
  const file = { name: '分类组.psd', size: 1, arrayBuffer: async () => new ArrayBuffer(1) }
  const release = async () => { for (const image of images) { await image.ready; image.onload?.() }; await flush() }
  return { deps, parser, app, file, calls, images, release }
}

for (const mode of ['cancel', 'remove', 'unmount']) {
  test(`真实分类图片等待期间${mode}：旧结果不恢复文件、缓存或当前会话`, async t => {
    const f = setup(t), controller = new globalThis.AbortController()
    const work = f.parser.processFile(f.file, false, controller.signal).then(() => null, error => error)
    await flush()
    assert.equal(f.images.length, 1, '必须实际进入生产分类器的图片等待')
    const id = f.deps.psdFiles.value[0].id
    if (mode === 'cancel') controller.abort()
    if (mode === 'remove') f.deps.psdFiles.value.splice(0, 1)
    if (mode === 'unmount') { f.app.unmount(); f.deps.psdFiles.value = [] }
    await f.release()
    const result = await work
    assert.equal(f.deps.currentPsdFile.value, null, '已取消或删除的文件不能重新激活')
    assert.equal(f.deps.psdPartsCache.value[id], undefined)
    assert.equal(f.deps.psdFiles.value.length, 0)
    assert.equal(result?.name, 'AbortError')
  })
}

for (const mode of ['switch', 'roundtrip', 'unmount']) {
  test(`首次100ms初始化前${mode}：旧定时器不得清空新选择`, async t => {
    const f = setup(t), work = f.parser.processFile(f.file, false)
    await flush(); await f.release(); await work
    const original = f.deps.currentPsdFile.value
    if (mode === 'unmount') f.app.unmount()
    else { f.deps.currentPsdFile.value = { id: 'B' }; if (mode === 'roundtrip') f.deps.currentPsdFile.value = original }
    f.deps.currentTab.value = '用户选择'
    f.deps.selectedPresetId.value = '新预设'
    f.deps.userInteracted.value = { chosen: true }
    t.mock.timers.tick(100); await flush()
    assert.equal(f.deps.currentTab.value, '用户选择')
    assert.equal(f.deps.selectedPresetId.value, '新预设')
    assert.deepEqual(f.deps.userInteracted.value, { chosen: true })
    assert.equal(f.calls.loads + f.calls.renders, 0)
  })
}

test('正常首次分类、尺寸初始化与后台第二文件导入保持原行为', async t => {
  const f = setup(t), first = f.parser.processFile(f.file, false)
  await flush(); await f.release(); await first
  const original = f.deps.currentPsdFile.value
  assert.equal(f.deps.frontHandNormalParts.value.length, 1)
  f.deps.canvasWidth.value = 4
  t.mock.timers.tick(100); await flush()
  assert.deepEqual(f.calls, { loads: 1, renders: 1 })
  const second = f.parser.processFile(f.file, false)
  await flush(); await f.release(); await second
  assert.equal(f.deps.psdFiles.value.length, 2)
  assert.equal(f.deps.currentPsdFile.value, original)
  assert.equal(Object.keys(f.deps.psdPartsCache.value).length, 2)
})
