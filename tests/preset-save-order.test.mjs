import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, shallowRef } from 'vue'
import { createCanvas } from '@napi-rs/canvas'
import { modules, setup as renderSetup, flush } from './helpers/render-race-fixture.mjs'

function setup(t) {
  renderSetup(t)
  const writes = [], digests = [], images = []
  let stored = { storage_version: '2.0.0', psdItems: [] }, rejectWrite = false
  const digest = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle)
  t.mock.method(globalThis.crypto.subtle, 'digest', (...args) => new Promise(resolve => digests.push(async () => resolve(await digest(...args)))))
  for (const [key, value] of Object.entries({
    localStorage: { getItem: () => JSON.stringify(stored), setItem: (_key, value) => { if (rejectWrite) throw new Error('controlled storage failure'); stored = JSON.parse(value); writes.push(stored) }, removeItem() {} },
    window: { electronAPI: { invoke: channel => new Promise(resolve => images.push({ channel, resolve })) } }
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { configurable: true, value })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  const currentPsdFile = shallowRef({ id: 'A', filePath: 'A' }), currentPsdData = shallowRef({ width: 2, height: 2, layerHierarchy: [] }), scope = effectScope()
  const module = scope.run(() => modules.usePresetData({ currentPsdFile, currentPsdData, canvasRef: shallowRef(createCanvas(2, 2)) }))
  t.after(() => scope.stop())
  const set = (name, preview = false) => { module.presets.value = [{ id: name, name, ...(preview ? { base64Image: 'image' } : { previewPath: `${name}.png` }) }] }
  const switchToB = (sameContent = false) => { currentPsdFile.value = { id: 'B', filePath: 'B' }; if (!sameContent) currentPsdData.value = { width: 3, height: 3, layerHierarchy: [] } }
  return { module, writes, digests, images, set, switchToB, failWrite: value => { rejectWrite = value }, get stored() { return stored } }
}

for (const boundary of ['hash', 'preview']) test(`同PSD保存逆序${boundary}：最后发起的快照保留`, async t => {
  const f = setup(t)
  f.set('old', boundary === 'preview'); const older = f.module.savePresets()
  await flush(); assert.equal(f.digests.length, 1)
  if (boundary === 'preview') { await f.digests[0](); await flush(); assert.equal(f.images.length, 1) }
  f.set('new'); const newer = f.module.savePresets()
  await flush(); assert.equal(f.digests.length, 2)
  await f.digests[1](); await newer
  if (boundary === 'hash') await f.digests[0]()
  else f.images[0].resolve({ success: true, filePath: 'old.png' })
  await older
  assert.equal(f.stored.psdItems.length, 1)
  assert.equal(f.stored.psdItems[0].presets[0].name, 'new', '较早发起的保存不得覆盖较新的快照')
})

test('不同PSD预览保存交错：后完成A不得覆盖已保存B', async t => {
  const f = setup(t)
  f.set('A-item', true); const a = f.module.savePresets()
  await flush(); await f.digests[0](); await flush(); assert.equal(f.images.length, 1)
  f.switchToB(); f.set('B-item'); const b = f.module.savePresets()
  await flush(); await f.digests[1](); await b
  f.images[0].resolve({ success: true, filePath: 'a.png' }); await a
  assert.deepEqual(f.stored.psdItems.map(item => item.psdPath).sort(), ['A', 'B'])
  assert.equal(f.stored.psdItems.find(item => item.psdPath === 'B').presets[0].name, 'B-item')
})

test('同内容PSD移动路径后逆序保存不会恢复旧路径', async t => {
  const f = setup(t)
  f.set('old'); const a = f.module.savePresets(); await flush()
  f.switchToB(true); f.set('new'); const b = f.module.savePresets(); await flush()
  await f.digests[1](); await b; await f.digests[0](); await a
  assert.equal(f.stored.psdItems.length, 1); assert.equal(f.stored.psdItems[0].psdPath, 'B')
  assert.equal(f.stored.psdItems[0].presets[0].name, 'new')
})

for (const mode of ['normal', 'newer-write-failed', 'newer-cancelled']) test(`保存次序${mode}：仅成功提交阻止较旧快照`, async t => {
  const f = setup(t)
  f.set('old'); const a = f.module.savePresets(); await flush()
  let valid = true
  f.set('new'); const b = f.module.savePresets(() => valid); await flush()
  if (mode === 'normal') { await f.digests[0](); await a; assert.equal(f.stored.psdItems[0].presets[0].name, 'old') }
  if (mode === 'newer-write-failed') f.failWrite(true)
  if (mode === 'newer-cancelled') valid = false
  await f.digests[1](); await b; f.failWrite(false)
  if (mode !== 'normal') { await f.digests[0](); await a }
  assert.equal(f.stored.psdItems[0].presets[0].name, mode === 'normal' ? 'new' : 'old')
})
