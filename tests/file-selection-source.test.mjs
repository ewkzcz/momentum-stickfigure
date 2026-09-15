import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('文件选择与自定义图片：预览调用在副作用前拒绝，主窗仍可扫描', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const [channel, args] of [
      ['scan-custom-dialogs', []], ['save-custom-dialog', ['probe.png', 'eA==']], ['delete-custom-dialog', ['probe.png']],
      ['select-psd-files', []], ['select-folder', []], ['select-file', [{}]], ['show-save-dialog', [{}]],
      ['select-image-files', []], ['save-temp-image', ['eA==', 'probe.png']], ['open-folder', ['/isolated-denied']]
    ]) {
      const result = await preview.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
      assert.equal(result.success, false, `${channel}应拒绝来源`)
      assert.match(result.error || '', /未授权/, `${channel}业务失败不能代替来源拒绝`)
    }
    const allowed = await desktop.page.evaluate(() => window.electronAPI.invoke('scan-custom-dialogs'))
    assert.equal(allowed.success, true)
    assert.deepEqual(allowed.dialogs, [])
  } finally { await desktop.close() }
})
