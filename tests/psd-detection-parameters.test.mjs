import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('PSD组件检测：默认分类成功且自定义关键词参数拒绝后恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const psdData = { layerHierarchy: [{ name: '前手', children: [] }] }
    const detect = detectionOptions => desktop.page.evaluate(({ psdData, detectionOptions }) => window.electronAPI.invoke('psd-detect-components', { psdData, detectionOptions }), { psdData, detectionOptions })
    const normal = await detect({})
    assert.equal(normal.success, true)
    assert.equal(normal.data.success, true, JSON.stringify(normal.data))
    assert.equal(normal.data.data.components.frontHand.length, 1)
    const custom = Object.fromEntries(['FRONT_HAND', 'BACK_HAND', 'EXPRESSION', 'BODY', 'HAIR', 'ACCESSORY'].map(key => [`${key}_KEYWORDS`, key === 'BODY' ? ['前手'] : []]))
    for (const detection of [[], {}, { ...custom, BODY_KEYWORDS: '前手' }, { ...custom, BODY_KEYWORDS: [{}] }, { ...custom, BODY_KEYWORDS: ['a'.repeat(257)] }, { ...custom, BODY_KEYWORDS: Array(257).fill('a') }]) {
      const result = await detect({ detection })
      assert.equal(result.success, false)
      assert.match(result.message, /参数/)
    }
    const restored = await detect({ detection: custom })
    assert.equal(restored.success, true)
    assert.equal(restored.data.success, true)
    assert.equal(restored.data.data.components.frontHand.length, 0)
    assert.equal(restored.data.data.components.body.length, 1)
  } finally { await desktop.close() }
})
