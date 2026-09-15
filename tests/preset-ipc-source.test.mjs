import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('预设文件来源：预览不能写文件或打开导入导出，主窗可正常保存', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`预设来源证据：${desktop.root}`)
  try {
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const output = path.join(desktop.root, '预设 测试.json')
    const denied = await preview.evaluate(output => window.electronAPI.invoke('preset-save-file', output, '{"safe":false}'), output)
    assert.equal(denied.success, false, '预览不能写预设文件')
    await assert.rejects(access(output))
    for (const channel of ['preset-import', 'preset-export']) {
      const response = await preview.evaluate(channel => window.electronAPI.invoke(channel), channel)
      assert.equal(response.success, false)
      assert.match(response.error, /未授权/)
    }
    const allowed = await desktop.page.evaluate(output => window.electronAPI.invoke('preset-save-file', output, '{"safe":true}'), output)
    assert.equal(allowed.success, true)
    assert.deepEqual(JSON.parse(await readFile(output, 'utf8')), { safe: true })
  } finally { await desktop.close() }
})
