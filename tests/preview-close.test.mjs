/** 自关闭按钮同步回归：真实预览五十轮，仍要求原处理器成功和唯一目标销毁。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { closePreviewByButton } from './helpers/preview-close.mjs'

test('预览关闭同步：50轮原关闭IPC成功且真实目标销毁，主窗保留', { timeout: 120000 }, async () => {
  // 1、沿用原后台桌面策略，全部窗口保持隐藏和无焦点。
  const desktop = await launchDesktop()
  const result = { passed: false, rounds: [] }
  console.log(`预览关闭同步证据：${desktop.root}`)
  try {
    for (let round = 0; round < 50; round++) {
      const opening = desktop.application.waitForEvent('window')
      assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), { success: true, existed: false })
      const preview = await opening
      await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
      const close = await closePreviewByButton(desktop.application, preview)
      const count = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
      assert.equal(count, 1)
      assert.equal(desktop.page.isClosed(), false)
      result.rounds.push({ round, close })
    }
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    // 2、退出继续检查后台窗口和文件隔离，不跳过真实关闭。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'preview-close-result.json'), JSON.stringify(result, null, 2)) }
  }
})
