import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop } from './helpers/desktop.mjs'

for (const rejectWrite of [false, true]) {
  test(`幻想框真实导出：${rejectWrite ? '写入拒绝不得显示成功' : '中文目录PNG实际落盘'}`, { timeout: 60000 }, async () => {
    const desktop = await launchDesktop()
    const directory = path.join(desktop.root, '幻想框 中文')
    await mkdir(directory)
    try {
      await desktop.page.evaluate(() => { location.hash = '/dialog-frame' })
      await desktop.page.locator('.dialog-frame-page').waitFor()
      const canvas = createCanvas(64, 48)
      const context = canvas.getContext('2d')
      context.fillStyle = 'white'; context.fillRect(0, 0, 64, 48)
      context.strokeStyle = 'black'; context.lineWidth = 3; context.strokeRect(2, 2, 60, 44)
      await desktop.page.locator('.dialog-frame-manager input[type=file]').first().setInputFiles({ name: '中文 对话框.png', mimeType: 'image/png', buffer: canvas.toBuffer('image/png') })
      await desktop.page.locator('.frame-preview img').waitFor()
      if (rejectWrite) {
        // 仅在真实UI路径的写入返回边界注入失败，验证页面不会误报成功；成功用例使用原生产处理器。
        await desktop.application.evaluate(({ ipcMain }) => {
          ipcMain.removeHandler('write-file')
          ipcMain.handle('write-file', () => ({ success: false, error: '受控导出拒绝' }))
        })
      }
      await desktop.application.evaluate((_electron, directory) => { globalThis.__momentumTest.openPaths = [directory] }, directory)
      await desktop.page.getByRole('button', { name: '导出', exact: true }).click()
      if (rejectWrite) {
        await desktop.page.getByText('导出失败：受控导出拒绝', { exact: true }).waitFor()
        assert.equal(await desktop.page.getByText('导出成功', { exact: true }).count(), 0)
        assert.deepEqual(await readdir(directory), [])
      } else {
        await desktop.page.getByText('导出成功', { exact: true }).waitFor()
        const files = await readdir(directory)
        assert.equal(files.length, 1)
        const bytes = await readFile(path.join(directory, files[0]))
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
        assert.ok(bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0)
      }
      assert.deepEqual(desktop.errors, [])
    } finally { await desktop.close() }
  })
}
