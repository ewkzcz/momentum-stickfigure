import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('漫画真实导出：明确选择中文目录后整体与拆分PNG实际落盘', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const directory = path.join(desktop.root, '中文 导出')
  await mkdir(directory)
  try {
    await desktop.page.evaluate(() => { location.hash = '/comic' })
    await desktop.page.locator('.comic-page').waitFor()
    for (const [button, message] of [['导出整体', '整体视角导出成功'], ['导出拆分', /视角导出成功，共/]]) {
      await desktop.application.evaluate((_electron, directory) => { globalThis.__momentumTest.openPaths = [directory] }, directory)
      await desktop.page.getByRole('button', { name: button, exact: true }).click()
      await desktop.page.getByText(message, { exact: typeof message === 'string' }).waitFor()
    }
    const files = await readdir(directory)
    assert.ok(files.length >= 2, '整体和拆分结果必须在所选目录真实落盘')
    for (const file of files) {
      assert.ok(file.endsWith('.png'))
      const data = await readFile(path.join(directory, file))
      assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a')
      assert.equal(data.readUInt32BE(16), 1920)
      assert.equal(data.readUInt32BE(20), 1080)
    }
    assert.deepEqual(desktop.errors, [])
    console.log(`漫画导出证据：${directory}；PNG数量：${files.length}`)
  } finally { await desktop.close() }
})
