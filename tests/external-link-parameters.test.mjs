import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('外部链接参数：拒绝凭据、控制字符和超长URL，保留端口路径及恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = value => desktop.page.evaluate(value => window.electronAPI.invoke('shell-open-external', value), value)
    for (const value of ['https://user:password@example.invalid/', 'https://example.invalid/a\nb', 'https://example.invalid/\0', `https://example.invalid/${'a'.repeat(32768)}`]) {
      assert.equal((await invoke(value)).success, false)
    }
    assert.deepEqual(await desktop.application.evaluate(() => globalThis.__momentumTest.external), [])
    for (const url of ['http://localhost:8080/prefix/help?q=中文', 'HTTPS://example.invalid:8443/docs#help']) assert.equal((await invoke(url)).success, true)
    assert.deepEqual(await desktop.application.evaluate(() => globalThis.__momentumTest.external), ['http://localhost:8080/prefix/help?q=%E4%B8%AD%E6%96%87', 'https://example.invalid:8443/docs#help'])
  } finally { await desktop.close() }
})
