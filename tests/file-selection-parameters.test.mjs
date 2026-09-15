import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('文件选择参数：拒绝错误选项与临时文件路径穿越，合法名称仍可保存', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
    for (const name of ['../escaped.png', '..\\escaped.png', '.', '..', 'nested/name.png', 'a\0b.png']) {
      const result = await invoke('save-temp-image', 'eA==', name)
      assert.equal(result.success, false, name)
      assert.match(result.error, /参数/)
    }
    for (const channel of ['select-file', 'show-save-dialog']) {
      for (const options of [null, [], { title: {} }, { defaultPath: 123 }, { filters: [{}] }, { filters: [{ name: '图像', extensions: [12] }] }]) {
        const result = await invoke(channel, options)
        assert.equal(result.success, false)
        assert.match(result.error, /参数/)
      }
    }
    assert.equal((await invoke('save-temp-image', 'eA==', '中文 空格.png')).success, true)
    assert.equal((await invoke('save-temp-image', 'eA==')).success, true)
    assert.equal((await invoke('select-file', { title: '合法选择', filters: [{ name: '图片', extensions: ['png', 'jpg'] }], multiple: true })).canceled, true)
    assert.equal((await invoke('show-save-dialog', { title: '保存图片', defaultPath: '中文 空格.png' })).canceled, true)
  } finally { await desktop.close() }
})
