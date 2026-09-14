import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef, ref } from 'vue'
import { createCanvas } from '@napi-rs/canvas'
import { modules, setup as renderSetup, flush } from './helpers/render-race-fixture.mjs'

function setup(t) {
  const { messages } = renderSetup(t)
  const writes = [], digests = [], requests = [], renders = []
  let stored = { storage_version: '2.0.0', psdItems: [] }
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
  t.mock.method(globalThis.crypto.subtle, 'digest', (...args) => new Promise(resolve => digests.push(async () => resolve(await digest(...args)))))
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify(stored), setItem: (_key, value) => { stored = JSON.parse(value); writes.push(stored) }, removeItem() {} },
    window: { electronAPI: { invoke: (channel, args) => new Promise(resolve => requests.push({ channel, args, resolve })) } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name])
  }
  const a = { id: 'A', filePath: 'A' }, data = { width: 2, height: 2, layerHierarchy: [] }
  const currentPsdFile = shallowRef(a), currentPsdData = shallowRef(data), scope = effectScope()
  const module = scope.run(() => modules.usePresetData({ currentPsdFile, currentPsdData, canvasRef: shallowRef(createCanvas(2, 2)), canvasWidth: ref(2), canvasHeight: ref(2), renderAllLayers: () => { renders.push(currentPsdFile.value.id) } }))
  const ui = scope.run(() => modules.usePresetUI({ presets: module.presets, editingPresetId: module.editingPresetId, renamePreset: module.renamePreset, currentPsdFile, currentPsdData }))
  t.after(() => scope.stop())
  module.presets.value = [{ id: 'shared', name: 'old', previewPath: 'a.png' }, { id: 'keep', name: 'keep', previewPath: 'keep.png' }]
  module.selectedPresetId.value = 'shared'
  module.editingPresetId.value = 'shared'
  const invalidate = mode => {
    if (mode === 'normal') return
    if (mode === 'unmount') { scope.stop(); return }
    // 同内容 PSD 可按哈希复用预设 ID；往返时恢复原文件和原 PSD 引用。
    currentPsdFile.value = { id: 'B', filePath: 'B' }
    currentPsdData.value = { ...data }
    if (mode === 'roundtrip') { currentPsdFile.value = a; currentPsdData.value = data }
    module.presets.value = [{ id: 'shared', name: 'current-session', previewPath: 'a.png' }]
    module.selectedPresetId.value = 'shared'
    module.editingPresetId.value = 'current-edit'
  }
  return { module, ui, messages, writes, digests, requests, renders, invalidate, scope }
}

for (const boundary of ['hash', 'delete-image']) for (const mode of ['switch', 'roundtrip', 'unmount', 'normal']) {
  test(`删除预设等待${boundary}/${mode}：保留原目标持久化，隔离选择重绘与提示`, async t => {
    const f = setup(t), work = f.module.deletePreset('shared')
    await flush(); assert.equal(f.digests.length, 1)
    if (boundary === 'delete-image') { await f.digests[0](); await flush(); assert.equal(f.requests.length, 1) }
    f.invalidate(mode)
    if (boundary === 'hash') { await f.digests[0](); await flush() }
    assert.equal(f.requests.length, 1)
    assert.equal(f.requests[0].channel, 'template-storage-delete-image')
    assert.deepEqual(f.requests[0].args, { relativePath: 'a.png' })
    f.requests[0].resolve({ success: true }); await work
    assert.equal(f.writes.length, 1)
    assert.equal(f.writes[0].psdItems[0].psdPath, 'A')
    assert.deepEqual(f.writes[0].psdItems[0].presets.map(p => p.id), ['keep'])
    if (mode === 'normal') {
      assert.equal(f.module.selectedPresetId.value, null)
      assert.deepEqual(f.renders, ['A']); assert.deepEqual(f.messages, [['预设"old"已删除']])
    } else {
      assert.equal(f.module.selectedPresetId.value, 'shared', '旧删除不得清空当前选择')
      assert.deepEqual(f.renders, [], '旧删除不得请求当前画布重绘')
      assert.deepEqual(f.messages, [], '旧删除不得显示成功提示')
      if (mode !== 'unmount') assert.equal(f.module.presets.value[0].name, 'current-session')
    }
  })
}

for (const mode of ['switch', 'roundtrip', 'unmount', 'normal']) {
  test(`改名保存等待${mode}：保留原目标名称但不清理新会话编辑状态或提示`, async t => {
    const f = setup(t), input = { value: '  renamed  ' }
    const work = f.ui.handlePresetNameBlur('shared', { target: input })
    await flush(); assert.equal(f.digests.length, 1)
    f.invalidate(mode); await f.digests[0](); await work
    assert.equal(f.writes.length, 1)
    assert.equal(f.writes[0].psdItems[0].psdPath, 'A')
    assert.equal(f.writes[0].psdItems[0].presets[0].name, 'renamed')
    if (mode === 'normal') {
      assert.deepEqual(f.messages, [['预设已重命名']]); assert.equal(f.module.editingPresetId.value, null)
    } else {
      assert.deepEqual({ messages: f.messages, editingPresetId: f.module.editingPresetId.value }, { messages: [], editingPresetId: mode === 'unmount' ? 'shared' : 'current-edit' }, '旧改名不得显示提示或清理编辑状态')
      assert.equal(input.value, '  renamed  ', '旧续体不得操作原输入框')
      if (mode !== 'unmount') assert.equal(f.module.presets.value[0].name, 'current-session')
    }
  })
}

test('正常改名保持公开返回契约，重名与缺失目标不保存', async t => {
  const f = setup(t)
  assert.equal(await f.module.renamePreset('missing', 'name'), undefined)
  assert.equal(await f.module.renamePreset('shared', 'keep'), false)
  assert.equal(f.digests.length, 0)
  const work = f.module.renamePreset('shared', 'renamed')
  await flush(); await f.digests[0]()
  assert.equal(await work, true)
  assert.equal(f.writes.length, 1)
})

test('卸载后调用删除或改名不再修改列表或启动存储', async t => {
  const f = setup(t); f.scope.stop()
  await f.module.renamePreset('shared', 'keep')
  const deletion = f.module.deletePreset('shared')
  await flush()
  for (const release of f.digests) await release()
  await flush()
  for (const request of f.requests) request.resolve({ success: true })
  await deletion
  assert.deepEqual(f.module.presets.value.map(p => p.id), ['shared', 'keep'])
  assert.equal(f.writes.length, 0); assert.equal(f.digests.length, 0); assert.deepEqual(f.messages, [])
})
