import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('窗口参数：拒绝错误主题、模式、布尔和快捷键对象且恢复合法调用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
    const opening = desktop.application.waitForEvent('window')
    await invoke('canvas-preview-create')
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const [channel, payload] of [
      ['theme:setPreferredColorScheme', {}], ['theme:setPreferredColorScheme', 'invalid'],
      ['canvas-preview-sync-theme', {}], ['canvas-preview-sync-theme', 'invalid'],
      ['window-set-mode', null], ['window-set-mode', 'invalid'],
      ['window-set-always-on-top', 'false'], ['window-set-always-on-top', 1],
      ['hotkeys-update', []], ['hotkeys-update', null], ['hotkeys-update', { toggleMainWindow: {} }],
      ['hotkeys-update', { togglePreviewWindow: 'a'.repeat(257) }],
      ['canvas-preview-update-filename', {}], ['canvas-preview-update-filename', 'a'.repeat(4097)]
    ]) {
      const result = await invoke(channel, payload)
      assert.equal(result.success, false, `${channel}: ${JSON.stringify(payload).slice(0, 90)}`)
      assert.match(result.error, /参数/)
    }
    for (const [channel, payload] of [
      ['theme:setPreferredColorScheme', 'system'], ['canvas-preview-sync-theme', 'dark'],
      ['window-set-always-on-top', false], ['window-set-mode', 'software'],
      ['canvas-preview-update-filename', '中文 空格.psd'],
      ['hotkeys-update', { toggleMainWindow: '', togglePreviewWindow: '', openSearch: 'Ctrl+F', toggleCanvasHover: 'Alt+C', togglePartHover: 'Alt+P' }]
    ]) assert.equal((await invoke(channel, payload)).success, true, channel)
    const closed = preview.waitForEvent('close')
    assert.equal((await invoke('canvas-preview-close')).success, true)
    await closed
  } finally { await desktop.close() }
})
