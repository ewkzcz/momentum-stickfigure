import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef, ref } from 'vue'
import { createCanvas } from '@napi-rs/canvas'
import { modules, setup as renderSetup, flush } from './helpers/render-race-fixture.mjs'

function setup(t) {
  renderSetup(t)
  let stored = { storage_version: '2.0.0', psdItems: [] }
  const writes = [], digests = [], images = []
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
  t.mock.method(globalThis.crypto.subtle, 'digest', (...args) => new Promise(resolve => digests.push(async () => resolve(await digest(...args)))))
  for (const [name, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify(stored), setItem: (_key, value) => { stored = JSON.parse(value); writes.push(stored) }, removeItem() {} },
    window: { electronAPI: { invoke: (channel) => new Promise(resolve => images.push({ channel, resolve })) } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, name)
    Object.defineProperty(globalThis, name, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, name, previous) : delete globalThis[name])
  }
  const a = { id: 'A', filePath: 'A' }, b = { id: 'B', filePath: 'B' }
  const currentPsdFile = shallowRef(a), currentPsdData = shallowRef({ width: 2, height: 2, layerHierarchy: [] })
  const scope = effectScope()
  const module = scope.run(() => modules.usePresetData({ currentPsdFile, currentPsdData, canvasRef: shallowRef(createCanvas(2, 2)), canvasWidth: ref(2), canvasHeight: ref(2) }))
  t.after(() => scope.stop())
  const switchToB = () => { currentPsdFile.value = b; currentPsdData.value = { width: 3, height: 3, layerHierarchy: [] }; module.presets.value = [{ id: 'B-new', previewPath: 'b.png' }] }
  return { module, digests, images, writes, switchToB, scope, currentPsdFile, a }
}

for (const boundary of ['hash', 'preview']) test(`手动保存等待${boundary}后切换：只持久化发起时A的快照`, async t => {
  const f = setup(t)
  f.module.presets.value = [{ id: 'A-old', name: 'before', config: { selectedParts: { arm: 'old' } }, ...(boundary === 'hash' ? { previewPath: 'a.png' } : { base64Image: 'image' }) }]
  const original = f.module.presets.value[0]
  const work = f.module.savePresets()
  await flush(); assert.equal(f.digests.length, 1)
  if (boundary === 'preview') { await f.digests[0](); await flush(); assert.equal(f.images.length, 1) }
  original.name = 'changed'; original.config.selectedParts.arm = 'changed'
  f.switchToB()
  if (boundary === 'hash') await f.digests[0]()
  else f.images[0].resolve({ success: true, filePath: 'a.png' })
  await work
  assert.equal(f.writes.length, 1)
  const item = f.writes[0].psdItems[0]
  assert.equal(item.psdPath, 'A'); assert.deepEqual(item.presets, [{ id: 'A-old', name: 'before', config: { selectedParts: { arm: 'old' } }, previewPath: 'a.png' }])
  assert.deepEqual(f.module.presets.value.map(p => p.id), ['B-new'])
  if (boundary === 'preview') assert.equal(original.previewPath, undefined, '失效会话对象不得被异步预览回填')
})
test('正常手动保存回填预览路径，后续保存复用原文件', async t => {
  const f = setup(t)
  f.module.presets.value = [{ id: 'normal', base64Image: 'image' }]
  const work = f.module.savePresets(); await flush(); await f.digests[0](); await flush()
  assert.equal(f.images.length, 1)
  f.images[0].resolve({ success: true, filePath: 'normal.png' }); await work
  assert.equal(f.module.presets.value[0].previewPath, 'normal.png')
  const again = f.module.savePresets(); await flush(); await f.digests[1](); await again
  assert.equal(f.images.length, 1); assert.equal(f.writes.length, 2)
})
for (const mode of ['switch', 'roundtrip', 'unmount', 'normal']) test(`添加预设图片保存等待${mode}：旧操作不插入新会话`, async t => {
  const f = setup(t), work = f.module.handleSavePreset({ selectedParts: { arm: 'old' } })
  await flush(); assert.equal(f.images.length, 1)
  if (mode === 'switch' || mode === 'roundtrip') f.switchToB()
  if (mode === 'roundtrip') f.currentPsdFile.value = f.a
  if (mode === 'unmount') f.scope.stop()
  f.images[0].resolve({ success: true, filePath: 'created.png' }); await flush()
  for (const release of f.digests) await release()
  await work
  if (mode === 'normal') {
    assert.equal(f.writes.length, 1); assert.equal(f.module.presets.value.length, 1)
    assert.equal(f.module.presets.value[0].previewPath, 'created.png')
  } else {
    assert.equal(f.writes.length, 0)
    assert.deepEqual(f.module.presets.value.map(p => p.id), mode === 'unmount' ? [] : ['B-new'])
  }
})
