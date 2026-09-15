import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('提示词模板参数：拒绝错误类型和列表而不清空原模板', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
    const initial = [{ id: 'template-中文', content: '保留内容', isFavorite: false, createdAt: 1, order: 0, type: 'image' }]
    assert.deepEqual(await invoke('prompt-templates:save', { type: 'image', templates: initial }), { success: true })
    for (const payload of [null, [], { type: '__proto__' }, { type: 'invalid' }, { templates: {} }, { templates: [null] }, { templates: [{ content: {} }] }, { templates: [{ order: Infinity }] }]) {
      const result = await invoke('prompt-templates:save', payload)
      assert.equal(result.success, false, JSON.stringify(payload))
      assert.match(result.error, /参数/)
      assert.deepEqual((await invoke('prompt-templates:get', 'image')).templates, initial)
    }
    for (const type of ['__proto__', 'constructor', {}, null]) {
      const result = await invoke('prompt-templates:get', type)
      assert.equal(result.success, false)
      assert.match(result.error, /参数/)
    }
    assert.deepEqual(await invoke('prompt-templates:save', { type: 'video', templates: [{ content: '合法视频' }] }), { success: true })
    assert.equal((await invoke('prompt-templates:get', 'video')).templates[0].content, '合法视频')
  } finally { await desktop.close() }
})
