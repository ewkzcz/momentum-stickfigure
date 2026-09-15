import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('PSD直接接口参数：拒绝非对象配置及错误字节载荷，合法查询恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const call = (channel, options) => desktop.page.evaluate(({ channel, options }) => window.electronAPI.invoke(channel, options), { channel, options })
  try {
    for (const [channel, options] of [
      ['psd-get-config', []], ['psd-get-config', { parseOptions: [] }],
      ['psd-render-layers', null], ['psd-render-layers', { psdData: [], renderOptions: {} }],
      ['psd-detect-components', { psdData: {}, detectionOptions: [] }],
      ['psd-get-info', { fileBuffer: 'not bytes' }], ['psd-validate-file', { fileBuffer: [-1] }]
    ]) {
      const result = await call(channel, options)
      assert.equal(result.success, false, channel)
      assert.match(result.message, /参数/)
    }
    assert.equal((await call('psd-get-config', {})).success, true)
  } finally { await desktop.close() }
})
