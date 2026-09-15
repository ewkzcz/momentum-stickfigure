import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('浏览器存储隔离：业务启动不再追加第三方存储分区禁用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const switches = await desktop.application.evaluate(() => globalThis.__momentumTest.commandLineSwitches)
    assert.equal(switches.some(({ name, value }) => name === 'disable-features' && String(value).split(',').includes('ThirdPartyStoragePartitioning')), false)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
