/** 真实模板模块与原生离屏 Canvas；只控制注入的渲染完成时间，不复制业务实现。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, shallowRef, nextTick } from 'vue'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { useTemplateRenderCoordinator } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useTemplateRenderCoordinator.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function setup(t, options = {}) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement: () => createCanvas(2, 1) } })
  t.after(() => previous ? Object.defineProperty(globalThis, 'document', previous) : delete globalThis.document)
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, () => {})
  const leaf = name => ({ name, uniqueName: name, visible: true, userVisible: true, children: [] })
  const tree = ref([{ ...leaf('表情#2'), children: [leaf('眼睛')] }, leaf('身体')])
  const psd = shallowRef({ layerHierarchy: [{ name: '身体' }, { name: '表情', children: [{ name: '眼睛' }] }] })
  const mainCanvas = createCanvas(2, 1)
  mainCanvas.getContext('2d').fillStyle = 'blue'
  mainCanvas.getContext('2d').fillRect(0, 0, 2, 1)
  const outputCanvas = createCanvas(2, 1)
  outputCanvas.getContext('2d').fillStyle = 'red'
  outputCanvas.getContext('2d').fillRect(0, 0, 2, 1)
  const gate = deferred(), coordinator = { generation: 0 }
  const calls = { main: 0, snapshot: [] }
  const deps = {
    currentPsdData: psd, canvasRef: shallowRef(mainCanvas),
    getLayerTreeData: () => tree,
    getCustomGroupNames: () => ({ expression: ['表情'] }),
    // 与生产一样按对象身份映射原始层级；真实树是另一组节点。
    buildUniquePathMap: layers => new Map(layers.map(layer => [layer, layer.name])),
    trimWhitespace: canvas => canvas,
    getRenderCoordinator: () => coordinator,
    getRenderAllLayers: () => async () => { if (++calls.main === 1) await gate.promise },
    renderLayerTreeSnapshot: snapshot => { calls.snapshot.push(snapshot); return gate.promise },
    ...options
  }
  const module = useTemplateRenderCoordinator(deps)
  return { module, tree, psd, mainCanvas, outputCanvas, gate, calls, coordinator, leaf }
}

for (const mode of ['用户修改', '切换PSD', '往返PSD', '卸载']) {
  test(`模板生成等待期间${mode}：旧完成不恢复覆盖真实树`, async t => {
    const state = setup(t)
    const work = state.module.generateTemplatePreviewBase64('actionTemplate')
    await nextTick()
    if (mode === '用户修改') {
      state.tree.value[1].visible = false
      state.tree.value[1].userVisible = false
    } else {
      const originalPsd = state.psd.value
      state.psd.value = mode === '卸载' ? null : { layerHierarchy: [{ name: '新PSD' }] }
      state.tree.value = mode === '卸载' ? [] : [state.leaf('新PSD')]
      state.coordinator.generation++
      if (mode === '往返PSD') {
        state.psd.value = originalPsd
        state.coordinator.generation++
      }
    }
    const activeTree = state.tree.value
    const expected = JSON.parse(JSON.stringify(activeTree))
    state.gate.resolve(state.outputCanvas)
    const image = await work
    assert.deepEqual(state.tree.value, expected, '旧 finally 不得将备份树写回当前页面')
    assert.equal(state.tree.value, activeTree, '不替换真实树引用')
    assert.equal(state.calls.main, 0, '生成模板图片不得请求主画布渲染')
    assert.equal(state.calls.snapshot.length, 1)
    assert.deepEqual(Array.from(state.mainCanvas.getContext('2d').getImageData(0, 0, 1, 1).data), [0, 0, 255, 255])
    if (mode !== '用户修改') assert.equal(image, null, '旧会话图片不返回给模板保存流程')
    else {
      const decoded = await loadImage(image)
      assert.equal(decoded.width, 2)
      assert.equal(decoded.height, 1)
      assert.match(image, /^data:image\/jpeg;base64,/)
      assert.equal(image, state.outputCanvas.toDataURL('image/jpeg', 0.8), '编码来自离屏结果而非蓝色主画布')
    }
  })
}

for (const type of ['actionTemplate', 'expressionTemplate']) {
  test(`模板${type}：独立快照保持旧对象映射的可见性语义`, async t => {
    const state = setup(t)
    const live = state.tree.value
    const original = JSON.parse(JSON.stringify(live))
    const work = state.module.generateTemplatePreviewBase64(type)
    const snapshot = state.calls.snapshot[0]
    assert.notEqual(snapshot, live)
    assert.notEqual(snapshot[0].children[0], live[0].children[0])
    assert.deepEqual(live, original, '等待期间真实树可见性也不得临时改变')
    assert.equal(snapshot[0].uniqueName, '表情#2')
    assert.deepEqual(snapshot, original, '正常页面树不是 PSD 原节点，保留旧映射不命中的结果')
    state.gate.resolve(state.outputCanvas)
    assert.ok(await work)
  })
}

test('模板缺少离屏回调：返回空结果而非借用主画布', async t => {
  const state = setup(t, { renderLayerTreeSnapshot: undefined })
  const live = state.tree.value
  assert.equal(await state.module.generateTemplatePreviewBase64('actionTemplate'), null)
  assert.equal(state.tree.value, live)
  assert.equal(state.calls.main, 0)
})

test('模板离屏绘制拒绝：保留当前树和主画布，不执行恢复重绘', async t => {
  const state = setup(t)
  const work = state.module.generateTemplatePreviewBase64('actionTemplate')
  state.tree.value[1].visible = false
  const live = state.tree.value
  state.gate.reject(new Error('受控离屏绘制失败'))
  assert.equal(await work, null)
  assert.equal(state.tree.value, live)
  assert.equal(live[1].visible, false)
  assert.equal(state.calls.main, 0)
})

test('模板并行生成逆序完成：每次快照独立，不互相恢复', async t => {
  const gates = [deferred(), deferred()]
  let index = 0
  const snapshots = []
  const state = setup(t, { renderLayerTreeSnapshot: tree => {
    snapshots.push(tree)
    return gates[index++].promise
  } })
  const first = state.module.generateTemplatePreviewBase64('actionTemplate')
  const second = state.module.generateTemplatePreviewBase64('expressionTemplate')
  assert.notEqual(snapshots[0], snapshots[1])
  const live = state.tree.value
  const blueOutput = createCanvas(2, 1)
  blueOutput.getContext('2d').drawImage(state.mainCanvas, 0, 0)
  gates[1].resolve(blueOutput)
  const secondImage = await second
  gates[0].resolve(state.outputCanvas)
  const firstImage = await first
  assert.equal(firstImage, state.outputCanvas.toDataURL('image/jpeg', 0.8))
  assert.equal(secondImage, state.mainCanvas.toDataURL('image/jpeg', 0.8))
  assert.equal(state.tree.value, live)
  assert.equal(state.calls.main, 0)
})

test('模板输出保持800px上限与JPEG质量，裁边只处理离屏副本', async t => {
  let trimInput
  const state = setup(t, { trimWhitespace: canvas => { trimInput = canvas; return canvas } })
  const output = createCanvas(1600, 800)
  output.getContext('2d').fillStyle = 'red'
  output.getContext('2d').fillRect(0, 0, 1600, 800)
  const work = state.module.generateTemplatePreviewBase64('actionTemplate')
  state.gate.resolve(output)
  const image = await work
  assert.notEqual(trimInput, output)
  assert.notEqual(trimInput, state.mainCanvas)
  const decoded = await loadImage(image)
  assert.equal(decoded.width, 800)
  assert.equal(decoded.height, 400)
  assert.equal(output.width, 1600)
})
