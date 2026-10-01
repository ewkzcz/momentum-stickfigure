import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef, nextTick } from 'vue'
import { createCanvas } from '@napi-rs/canvas'
import { modules, setup as renderSetup, flush } from './helpers/render-race-fixture.mjs'

function setup(t) {
  const { messages, dialogs } = renderSetup(t)
  const writes = [], focuses = [], renders = []
  let finishRender
  const rendering = new Promise(resolve => { finishRender = resolve })
  const a = { id: 'A', filePath: 'A' }, data = { width: 2, height: 2, layerHierarchy: [] }
  const currentPsdFile = shallowRef(a), currentPsdData = shallowRef(data), scope = effectScope()
  for (const [key, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify({ storage_version: '2.0.0', psdItems: [] }), setItem: (_key, value) => writes.push(JSON.parse(value)), removeItem() {} },
    window: { electronAPI: { invoke: async () => ({ success: true }) } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  document.querySelector = () => ({ focus: () => focuses.push('focus'), select: () => focuses.push('select') })
  const module = scope.run(() => modules.usePresetData({ currentPsdFile, currentPsdData, canvasRef: shallowRef(createCanvas(2, 2)), renderAllLayers: () => { renders.push(currentPsdFile.value.id); return rendering } }))
  const ui = scope.run(() => modules.usePresetUI({ ...module, currentPsdFile, currentPsdData }))
  t.after(() => scope.stop())
  const preset = () => ({ id: 'same', name: 'preset', previewPath: 'a.png' })
  module.presets.value = [preset()]
  module.selectedPresetId.value = 'same'
  const invalidate = mode => {
    if (mode === 'normal') return
    if (mode === 'unmount') { scope.stop(); return }
    currentPsdFile.value = { id: 'B', filePath: 'B' }; currentPsdData.value = { ...data }
    if (mode === 'roundtrip') { currentPsdFile.value = a; currentPsdData.value = data }
    module.presets.value = [preset()]; module.selectedPresetId.value = 'same'; module.editingPresetId.value = 'new-edit'
  }
  return { module, ui, messages, dialogs, writes, focuses, renders, finishRender, invalidate }
}

for (const mode of ['switch', 'roundtrip', 'unmount', 'normal']) {
  test(`预设删除确认等待${mode}：旧确认不删除当前列表`, async t => {
    const f = setup(t)
    f.module.confirmDeletePreset('same'); assert.equal(f.dialogs.length, 1)
    f.invalidate(mode)
    await f.dialogs[0].onPositiveClick(); await flush()
    if (mode === 'normal') {
      assert.equal(f.module.presets.value.length, 0); assert.equal(f.writes.length, 1)
      assert.equal(f.writes[0].psdItems[0].psdPath, 'A'); assert.equal(f.messages.length, 1)
    } else {
      assert.equal(f.module.presets.value.length, 1, '旧确认不得删除当前预设')
      assert.deepEqual(f.writes, []); assert.deepEqual(f.renders, []); assert.deepEqual(f.messages, [])
    }
  })
  test(`预设名称聚焦等待${mode}：旧nextTick不操作输入框`, async t => {
    const f = setup(t)
    f.ui.startEditPresetName('same'); f.invalidate(mode); await nextTick()
    assert.deepEqual(f.focuses, mode === 'normal' ? ['focus', 'select'] : [])
  })
  test(`取消预设重绘等待${mode}：旧完成不向新会话显示提示`, async t => {
    const f = setup(t), work = f.module.deselectAllPresets()
    assert.deepEqual(f.renders, ['A']); assert.equal(f.module.selectedPresetId.value, null)
    f.invalidate(mode); f.finishRender(); await work
    assert.deepEqual(f.messages, mode === 'normal' ? [['已取消选中预设']] : [])
    if (mode === 'switch' || mode === 'roundtrip') assert.equal(f.module.selectedPresetId.value, 'same')
  })
}

test('卸载后确认删除、进入编辑及取消预设均不再启动交互', async t => {
  const f = setup(t); f.invalidate('unmount')
  f.module.confirmDeletePreset('same'); f.ui.startEditPresetName('same')
  const work = f.module.deselectAllPresets(); f.finishRender(); await work; await nextTick()
  assert.deepEqual({ dialogs: f.dialogs, focuses: f.focuses, renders: f.renders, messages: f.messages, editing: f.module.editingPresetId.value, selected: f.module.selectedPresetId.value }, { dialogs: [], focuses: [], renders: [], messages: [], editing: null, selected: 'same' })
})
