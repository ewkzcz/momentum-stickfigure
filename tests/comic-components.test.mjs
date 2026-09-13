/** 漫画组件回归：编译并挂载生产 SFC，只替换桌面桥接和叶子组件，不复制业务函数。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { build } from 'vite'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { createRenderer, h, nextTick, ref } from 'vue'

const base = new URL('../src/renderer/src/components/pages/ComicPage/', import.meta.url)
const repository = fileURLToPath(new URL('../', import.meta.url))
const targets = new Set(['ComicPage.vue', 'components/CanvasEditor.vue'].map(name => fileURLToPath(new URL(name, base))))
await mkdir(path.join(repository, 'temp'), { recursive: true })
const output = await mkdtemp(path.join(repository, 'temp/comic-component-contract-'))
await build({
  configFile: false, logLevel: 'error', ssr: { noExternal: ['naive-ui', 'vue-router'] },
  plugins: [{
    name: 'comic-component-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id === 'naive-ui') return '\0comic-message'
      if (id === 'vue-router') return '\0comic-router'
    },
    load(id) {
      if (id === '\0comic-message') return 'export const NButton = {}; export const useMessage = () => ({})'
      if (id === '\0comic-router') return 'export const useRouter = () => ({}); export const onBeforeRouteLeave = () => {}'
      if (id.endsWith('.css')) return ''
      if (!id.endsWith('.vue')) return
      if (!targets.has(id)) return 'export default { render() { return null } }'
      const { descriptor, errors } = parse(readFileSync(id, 'utf8'), { filename: id })
      assert.deepEqual(errors, [])
      const script = compileScript(descriptor, { id, genDefaultAs: '__component' })
      const template = compileTemplate({ source: descriptor.template.content, filename: id, id, compilerOptions: { bindingMetadata: script.bindings } })
      assert.deepEqual(template.errors, [])
      return `${script.content}\n${template.code}\n__component.render = render; export default __component;`
    }
  }],
  build: { ssr: true, outDir: output, emptyOutDir: false, rollupOptions: {
    input: { page: fileURLToPath(new URL('ComicPage.vue', base)), editor: fileURLToPath(new URL('components/CanvasEditor.vue', base)) },
    output: { entryFileNames: '[name].mjs' }
  } }
})
const { default: ComicPage } = await import(pathToFileURL(path.join(output, 'page.mjs')).href)
const { default: CanvasEditor } = await import(pathToFileURL(path.join(output, 'editor.mjs')).href)

// 内存宿主保留真实 Vue setup、模板、props、watch、生命周期和事件分发。
const node = type => ({ type, children: [], parent: null, focusCount: 0, focus() { this.focusCount++ } })
const renderer = createRenderer({
  createElement: node,
  createText: text => ({ ...node('text'), text }),
  createComment: text => ({ ...node('comment'), text }),
  setText: (el, text) => { el.text = text },
  setElementText: (el, text) => { el.text = text },
  patchProp: (el, key, _old, value) => { el[key] = value },
  parentNode: el => el.parent,
  nextSibling: el => el.parent?.children[el.parent.children.indexOf(el) + 1] || null,
  insert(el, parent, anchor = null) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
    el.parent = parent
  },
  remove(el) { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null }
})
function mount(component, props = {}) {
  const app = renderer.createApp(component, props)
  const warnings = []
  app.config.warnHandler = message => warnings.push(message)
  return { app, vm: app.mount(node('root')), warnings }
}
function environment(t, fileSystem = {}) {
  const apps = []
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const storage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  globalThis.window = { fileSystem, addEventListener() {}, removeEventListener() {} }
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: { getItem: () => null } })
  t.mock.timers.enable({ apis: ['setTimeout'] })
  t.mock.method(console, 'log', () => {})
  t.mock.method(console, 'error', () => {})
  t.after(() => {
    for (const app of apps) app.unmount()
    if (original) Object.defineProperty(globalThis, 'window', original)
    else delete globalThis.window
    if (storage) Object.defineProperty(globalThis, 'sessionStorage', storage)
    else delete globalThis.sessionStorage
  })
  return apps
}
function page(t, selection = { success: true, path: '/tmp/漫画 导出' }) {
  const calls = []
  const apps = environment(t, {
    async selectFolder() { calls.push(['select']); if (selection instanceof Error) throw selection; return selection },
    async openFolder(folder) { calls.push(['open', folder]); return { success: true } }
  })
  const editor = {
    async exportAll(...args) { calls.push(['all', ...args]) },
    async exportSingle(...args) { calls.push(['single', ...args]) }
  }
  const EditorStub = { setup(_, { expose }) { expose(editor); return () => null } }
  const mounted = mount({ ...ComicPage, components: { ...ComicPage.components, CanvasEditor: EditorStub } })
  mounted.vm.hideToast() // 默认模板初始化会显示提示，取消断言只观察本次导出。
  apps.push(mounted.app)
  return { ...mounted, calls, editor }
}

test('单层成功：先选择目录，传入原图层和目录，保持原成功提示且不新增打开目录行为', async t => {
  const { vm, calls } = page(t)
  const layer = { id: 'single', name: '视角一' }
  await vm.handleExportSingle(layer)
  assert.equal(vm.toast.message, '图层 视角一 导出成功')
  assert.deepEqual(calls, [['select'], ['single', layer, '/tmp/漫画 导出']])
  assert.equal(calls[1][1], layer)
  assert.equal(vm.toast.type, 'success')
})

test('单层取消：仅选择目录，不调用导出且不显示提示', async t => {
  const { vm, calls } = page(t, { canceled: true })
  await vm.handleExportSingle({ name: '取消视角' })
  assert.deepEqual(calls, [['select']])
  assert.equal(vm.toast.show, false)
})

for (const selection of [new Error('选择异常'), { success: false, error: '目录不可用' }]) {
  test(`单层目录失败：${selection.message || selection.error}`, async t => {
    const { vm, calls } = page(t, selection)
    await vm.handleExportSingle({ name: '失败视角' })
    assert.deepEqual(calls, [['select']])
    assert.equal(vm.toast.type, 'error')
    assert.equal(vm.toast.message, `文件夹选择失败: ${selection.message || selection.error}`)
  })
}

test('单层导出异常：保留真实异常提示且不打开目录', async t => {
  const { vm, editor, calls } = page(t)
  editor.exportSingle = async (...args) => { calls.push(['single', ...args]); throw new Error('写入失败') }
  const layer = { name: '异常视角' }
  await vm.handleExportSingle(layer)
  assert.deepEqual(calls, [['select'], ['single', layer, '/tmp/漫画 导出']])
  assert.equal(vm.toast.message, '导出失败：写入失败')
  assert.equal(vm.toast.type, 'error')
})

test('单层编辑器未初始化：不选择目录', async t => {
  const { vm, calls } = page(t)
  vm.canvasEditor = null
  await vm.handleExportSingle({ name: '未初始化' })
  assert.deepEqual(calls, [])
  assert.equal(vm.toast.message, '画布编辑器未初始化')
})

for (const mode of ['all', 'batch']) {
  const method = mode === 'all' ? 'handleExportAll' : 'handleExportBatch'
  const event = mode === 'all' ? 'export-all' : 'export-batch'
  test(`公开${mode}事件：模板连线、目录透传、完成后打开目录`, async t => {
    const { vm, calls } = page(t)
    // 发出真实子组件事件，验证生产模板绑定，而不只直接调用父组件方法。
    vm.canvasEditor.$emit(event)
    for (let i = 0; i < 12; i++) await nextTick()
    const exports = mode === 'all' ? [['all', '/tmp/漫画 导出']] : vm.layers.map(layer => ['single', layer, '/tmp/漫画 导出'])
    assert.deepEqual(calls, [['select'], ...exports, ['open', '/tmp/漫画 导出']])
    assert.equal(vm.toast.type, 'success')
  })
  test(`公开${mode}取消：无导出和打开目录副作用`, async t => {
    const { vm, calls } = page(t, { canceled: true })
    await vm[method]()
    assert.deepEqual(calls, [['select']])
    assert.equal(vm.toast.show, false)
  })
  test(`公开${mode}异常：停止后续导出且不打开目录`, async t => {
    const { vm, calls, editor } = page(t)
    editor[mode === 'all' ? 'exportAll' : 'exportSingle'] = async () => { throw new Error('写入失败') }
    await vm[method]()
    assert.deepEqual(calls, [['select']])
    assert.equal(vm.toast.message, '导出失败：写入失败')
  })
}

test('画布 activeImage：无重复 setup 暴露，父属性更新同步三个子组件和内部焦点 watcher', async t => {
  const apps = environment(t)
  const observed = new Map()
  const probe = name => ({ props: ['activeImage'], setup(props) { observed.set(name, props); return () => null } })
  const active = ref(null)
  const component = { ...CanvasEditor, components: Object.fromEntries(['CanvasToolbar', 'CanvasRenderer', 'ImageTransformController'].map(name => [name, probe(name)])) }
  const editor = ref(null)
  const mounted = mount({ setup: () => () => h(component, { activeImage: active.value, ref: editor }) })
  apps.push(mounted.app)
  await nextTick()
  const el = editor.value.canvasEditor
  const initialFocus = el.focusCount
  const first = { type: 'background', layer: { id: 'one' } }
  active.value = first
  await nextTick(); await nextTick()
  for (const props of observed.values()) assert.equal(props.activeImage, active.value)
  assert.equal(editor.value.activeImage, active.value)
  assert.equal(el.focusCount, initialFocus + 1, '内部 toRef watcher 必须继续聚焦')
  active.value = { type: 'character', layer: { id: 'two' }, characterId: 'character' }
  await nextTick(); await nextTick()
  for (const props of observed.values()) assert.equal(props.activeImage, active.value)
  assert.equal(el.focusCount, initialFocus + 2)
  active.value = null
  await nextTick(); await nextTick()
  for (const props of observed.values()) assert.equal(props.activeImage, null)
  assert.equal(el.focusCount, initialFocus + 2)
  assert.equal(Object.hasOwn(editor.value.$.setupState, 'activeImage'), false, 'activeImage 应只通过 prop 暴露')
})

test('漫画页面移除未使用的 NButton 注册', () => {
  assert.equal(Object.hasOwn(ComicPage.components, 'NButton'), false)
})
