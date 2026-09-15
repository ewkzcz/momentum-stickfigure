import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertPsdTree } from '../src/main/psd-tree-parameters.js'

test('PSD树预算：循环、图层总数与深度在递归处理前拒绝', () => {
  const cycle = { name: 'cycle', children: [] }
  cycle.children.push(cycle)
  assert.throws(() => assertPsdTree({ layerHierarchy: [cycle] }), /循环/)
  assert.throws(() => assertPsdTree({ layerHierarchy: Array.from({ length: 8193 }, () => ({})) }), /预算/)
  let node = {}
  for (let index = 0; index < 128; index++) node = { children: [node] }
  assert.throws(() => assertPsdTree({ layerHierarchy: [node] }), /预算/)
  assert.doesNotThrow(() => assertPsdTree({ layerHierarchy: [] }, { width: 8192, height: 4096 }, true))
  assert.throws(() => assertPsdTree({ layerHierarchy: [] }, { width: 8192, height: 4097 }, true), /预算/)
})

test('PSD直接图层预算：非法树和画布尺寸拒绝后合法渲染恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const call = (channel, options) => desktop.page.evaluate(({ channel, options }) => window.electronAPI.invoke(channel, options), { channel, options })
  try {
    for (const options of [
      { psdData: { width: 8, height: 8, layerHierarchy: {} } },
      { psdData: { width: 8, height: 8, layerHierarchy: [null] } },
      { psdData: { width: 8, height: 8, layerHierarchy: [] }, renderOptions: { width: -1 } },
      { psdData: { width: 8, height: 8, layerHierarchy: [] }, renderOptions: { width: 100000, height: 100000 } }
    ]) {
      const result = await call('psd-render-layers', options)
      assert.equal(result.success, false)
      assert.match(result.message, /参数|预算/)
    }
    const valid = await call('psd-render-layers', { psdData: { width: 8, height: 8, layerHierarchy: [] }, renderOptions: { width: 8, height: 8 } })
    assert.equal(valid.success, true)
    assert.equal(valid.data.success, true)
    assert.equal(valid.data.data.width, 8)
    assert.equal(valid.data.data.height, 8)
  } finally { await desktop.close() }
})
