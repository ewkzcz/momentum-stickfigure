import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('高清工具来源：预览拒绝配置、任务与图片读取，主窗配置可用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`高清来源证据：${desktop.root}`)
  try {
    const original = await desktop.page.evaluate(() => window.electronAPI.invoke('hd:get-initial-data'))
    assert.equal(original.success, true)
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const read = await preview.evaluate(() => window.electronAPI.invoke('hd:get-initial-data'))
    assert.equal(read.success, false, '预览不得读取高清环境配置')
    assert.equal(read.data, undefined)
    for (const channel of ['hd:save-config', 'hd:run-removebg', 'hd:run-highres', 'hd:get-image-preview', 'hd:cancel']) {
      const response = await preview.evaluate(channel => window.electronAPI.invoke(channel, {}), channel)
      assert.equal(response.success, false)
      assert.match(response.message, /未授权/)
    }
    const after = await desktop.page.evaluate(() => window.electronAPI.invoke('hd:get-initial-data'))
    assert.deepEqual(after, original)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
