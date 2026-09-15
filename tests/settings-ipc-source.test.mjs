/** 归档配置含敏感值，预览不得读取备份或发起文件选择/写入。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('设置归档来源：预览拒绝四通道且主窗口备份恢复不变', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`设置归档来源证据：${desktop.root}`)
  try {
    const settings = { isolated: 'archive-secret' }
    assert.equal((await desktop.page.evaluate(settings => window.electronAPI.invoke('settings-auto-backup', settings), settings)).success, true)
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    // 先验证不涉及对话框的读取；原版会泄露备份，失败即停止，不误触系统选择。
    const restored = await preview.evaluate(() => window.electronAPI.invoke('settings-restore'))
    assert.equal(restored.success, false, '预览不得读取设置备份')
    assert.equal(restored.settings, undefined)
    const responses = await preview.evaluate(async () => {
      const invoke = window.electronAPI.invoke
      return [await invoke('settings-auto-backup', { isolated: 'unauthorized' }), await invoke('settings-export', {}), await invoke('settings-import')]
    })
    for (const result of responses) {
      assert.equal(result.success, false)
      assert.match(result.error, /未授权/)
    }
    const allowed = await desktop.page.evaluate(() => window.electronAPI.invoke('settings-restore'))
    assert.equal(allowed.success, true)
    assert.deepEqual(allowed.settings, settings, '拒绝预览写入后主窗口备份保持原值')
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
