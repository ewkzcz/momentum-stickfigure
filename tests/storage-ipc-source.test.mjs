/** 共享配置权限：预览不应读取或改写主窗口全部设置；正常主窗口保留原契约。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('共享配置来源：预览拒绝七类操作，主窗口仍可完整读写', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`共享配置来源证据：${desktop.root}`)
  try {
    const key = 'isolated-storage-source'
    assert.equal((await desktop.page.evaluate(key => window.electronAPI.storage.setItem(key, 'original'), key)).success, true)
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const results = await preview.evaluate(async key => {
      const api = window.electronAPI.storage
      return {
        get: await api.getItem(key), all: await api.getAllData(), keys: await api.keys(), length: await api.length(),
        set: await api.setItem(key, 'unauthorized'), remove: await api.removeItem(key), clear: await api.clear()
      }
    }, key)
    for (const [operation, result] of Object.entries(results)) assert.equal(result.success, false, `${operation}必须拒绝预览来源`)
    assert.equal(results.get.value, null)
    assert.deepEqual(results.all.data, {})
    assert.deepEqual(results.keys.keys, [])
    assert.equal(results.length.length, 0)
    const allowed = await desktop.page.evaluate(async key => {
      const api = window.electronAPI.storage
      return { get: await api.getItem(key), all: await api.getAllData(), keys: await api.keys(), length: await api.length() }
    }, key)
    assert.deepEqual(allowed.get, { success: true, value: 'original' })
    assert.equal(allowed.all.data[key], 'original')
    assert.ok(allowed.keys.keys.includes(key))
    assert.ok(allowed.length.length > 0)
    assert.equal((await desktop.page.evaluate(key => window.electronAPI.storage.removeItem(key), key)).success, true)
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.storage.clear())).success, true)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
