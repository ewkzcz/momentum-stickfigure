import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

function header() {
  const bytes = new Uint8Array(26)
  bytes.set([0x38, 0x42, 0x50, 0x53])
  const view = new DataView(bytes.buffer)
  view.setUint16(4, 1)
  view.setUint16(12, 4)
  view.setUint32(14, 48)
  view.setUint32(18, 64)
  view.setUint16(22, 8)
  view.setUint16(24, 3)
  return bytes
}

test('PSD直接接口：合法ArrayBuffer和Uint8Array可查询头部并保留错误载荷拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const bytes = [...header()]
  const call = (channel, fileBuffer) => desktop.page.evaluate(({ channel, fileBuffer }) => window.electronAPI.invoke(channel, { fileBuffer }), { channel, fileBuffer })
  try {
    for (const channel of ['psd-get-info', 'psd-validate-file']) {
      const array = await call(channel, bytes)
      assert.equal(array.success, true, `${channel} array: ${array.message}`)
      assert.equal(array.data.valid, true)
      if (channel === 'psd-get-info') assert.deepEqual({ width: array.data.width, height: array.data.height, channels: array.data.channels }, { width: 64, height: 48, channels: 4 })
      for (const representation of ['ArrayBuffer', 'Uint8Array', 'offset-view']) {
        const typed = await desktop.page.evaluate(({ channel, bytes, representation }) => {
          const padded = new Uint8Array(bytes.length + 8)
          padded.set(bytes, 4)
          const fileBuffer = representation === 'ArrayBuffer' ? Uint8Array.from(bytes).buffer
            : representation === 'offset-view' ? padded.subarray(4, 4 + bytes.length) : Uint8Array.from(bytes)
          return window.electronAPI.invoke(channel, { fileBuffer })
        }, { channel, bytes, representation })
        assert.equal(typed.success, true, `${channel} ${representation}: ${typed.message}`)
        assert.equal(typed.data.valid, true)
        assert.equal(typed.data.fileSize, 26)
        if (channel === 'psd-get-info') assert.deepEqual([typed.data.width, typed.data.height], [64, 48])
      }
    }
    const invalidType = await call('psd-validate-file', '8BPS')
    assert.equal(invalidType.success, false)
    assert.match(invalidType.message, /参数/)
    const truncated = await call('psd-validate-file', [56, 66, 80, 83])
    assert.equal(truncated.success, true)
    assert.equal(truncated.data.valid, false)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
