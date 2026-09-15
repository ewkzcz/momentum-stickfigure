import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('OCR来源：预览不能检查修改环境或发起识别，主窗保留失败契约', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`OCR来源证据：${desktop.root}`)
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const first = await preview.evaluate(() => window.electronAPI.invoke('video-ocr:check-environment', '/isolated-nonexistent-python'))
    assert.match(first.message || '', /未授权/, '无效路径失败不能代替来源拒绝')
    for (const channel of ['video-ocr:clean-environment', 'video-ocr:install-environment', 'video-ocr:process-video']) {
      const result = await preview.evaluate(channel => window.electronAPI.invoke(channel, null), channel)
      assert.equal(result.success, false)
      assert.match(result.message, /未授权/)
    }
    const allowed = await desktop.page.evaluate(() => window.electronAPI.invoke('video-ocr:check-environment', '/isolated-nonexistent-python'))
    assert.equal(allowed.success, true)
    assert.deepEqual(allowed.data, { installed: false, message: 'Python环境未配置' })
  } finally { await desktop.close() }
})
