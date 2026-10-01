/** 真实页面取消入口与恢复；服务响应受控，真实进程退出由独立生命周期测试覆盖。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('字幕页面取消在途任务后恢复按钮，并可再次提交', { timeout: 90000 }, async () => {
  const desktop = await launchDesktop(undefined, 'software-layout')
  try {
    await desktop.application.evaluate(({ ipcMain }) => {
      globalThis.__cancelProbe = { calls: 0, cancellations: 0, release: null }
      for (const name of ['check-environment', 'process-video', 'cancel']) ipcMain.removeHandler(`video-ocr:${name}`)
      ipcMain.handle('video-ocr:check-environment', () => ({ success: true, data: { installed: true } }))
      ipcMain.handle('video-ocr:process-video', async () => {
        globalThis.__cancelProbe.calls++
        await new Promise(resolve => { globalThis.__cancelProbe.release = resolve })
        return { success: false, message: '任务已取消' }
      })
      ipcMain.handle('video-ocr:cancel', () => {
        globalThis.__cancelProbe.cancellations++
        if (!globalThis.__cancelProbe.release) throw new Error('没有在途任务')
        globalThis.__cancelProbe.release()
        globalThis.__cancelProbe.release = null
        return { success: true, cancelled: 1 }
      })
    })
    await desktop.page.evaluate(root => {
      localStorage.setItem('hd-toolkit-config', JSON.stringify({ pythonHome: `${root}/fake-python` }))
      localStorage.setItem('video-ocr-api-key', 'FAKE_CANCEL_KEY')
      localStorage.setItem('video-ocr-api-base-url', 'https://cancel.invalid/v1')
      location.hash = '/video-subtitle-ocr'
    }, desktop.root)
    await desktop.page.getByText('✓ 环境已安装', { exact: true }).waitFor()
    await desktop.page.locator('.loading-overlay').waitFor({ state: 'hidden' })
    const video = path.join(desktop.root, '取消测试.mp4')
    await writeFile(video, 'isolated fixture; never passed to Python')
    await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, video)
    await desktop.page.getByText('点击选择视频文件', { exact: true }).click()
    await desktop.page.getByText('取消测试.mp4', { exact: true }).waitFor()
    for (let cycle = 0; cycle < 2; cycle++) {
      await desktop.page.getByRole('button', { name: '开始提取字幕', exact: true }).click()
      // 等待公开进度区域出现，再通过真实按钮发起同一renderer的后续IPC请求。
      await desktop.page.waitForFunction(() => document.querySelector('.progress-container'))
      await desktop.page.getByRole('button', { name: '取消当前任务', exact: true }).click()
      await desktop.page.getByRole('button', { name: '开始提取字幕', exact: true }).waitFor()
      await desktop.page.getByRole('button', { name: '取消当前任务', exact: true }).waitFor({ state: 'hidden' })
      assert.equal(await desktop.page.locator('.progress-message').textContent(), '任务已取消')
    }
    assert.deepEqual(await desktop.application.evaluate(() => ({ calls: globalThis.__cancelProbe.calls, cancellations: globalThis.__cancelProbe.cancellations })), { calls: 2, cancellations: 2 })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
