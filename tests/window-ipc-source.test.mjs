import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'
import { closePreviewByButton } from './helpers/preview-close.mjs'

test('窗口控制来源：预览不能更改主窗主题快捷键或发送预览状态，但可管理自身', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const [channel, payload] of [['theme:setPreferredColorScheme', 'light'], ['hotkeys-update', {}], ['canvas-preview-create'], ['canvas-preview-update', 'data:image/png;base64,eA=='], ['canvas-preview-sync-theme', 'light'], ['canvas-preview-update-filename', 'probe'], ['canvas-preview-reset-viewport'], ['window-set-mode', 'plugin']]) {
      const result = await preview.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
      assert.equal(result.success, false, channel)
      assert.match(result.error, /未授权/)
    }
    assert.equal((await preview.evaluate(() => window.electronAPI.invoke('window-get-always-on-top'))).success, true)
    assert.equal((await preview.evaluate(() => window.electronAPI.invoke('window-set-always-on-top', false))).success, true)
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('theme:setPreferredColorScheme', 'system'))).success, true)
    await closePreviewByButton(desktop.application, preview)
  } finally { await desktop.close() }
})
