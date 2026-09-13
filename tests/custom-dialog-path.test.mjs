/** 自定义图片删除安全边界：拒绝路径跳转并保持正常文件名删除，所有文件均在隔离目录。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('自定义图片删除：拒绝父路径、分隔符和绝对路径，合法中文文件名可用', { timeout: 30000 }, async () => {
  // 1、哨兵属于本次测试，不读取或删除任何用户真实配置。
  const desktop = await launchDesktop()
  const evidence = { passed: false, rejected: [] }
  console.log(`自定义图片路径边界证据：${desktop.root}`)
  try {
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    const marker = path.join(userData, 'regression-owned-marker.txt')
    await writeFile(marker, 'owned isolation marker')
    const inputs = ['../regression-owned-marker.txt', '..\\regression-owned-marker.txt', 'nested/../../regression-owned-marker.txt', marker, 'C:\\outside\\marker.png', '/', '.', '..', '']
    for (const name of inputs) {
      const response = await desktop.page.evaluate(name => window.customDialog.delete(name), name)
      assert.deepEqual(response, { success: false, error: '文件名不能包含路径' })
      assert.equal(await readFile(marker, 'utf8'), 'owned isolation marker')
      evidence.rejected.push({ name, response })
    }
    // 2、不额外限制扩展名或编码内容，保持原公开保存及删除契约。
    const saved = await desktop.page.evaluate(() => window.customDialog.save('中文 空格图片.png', 'aXNvbGF0ZWQ='))
    assert.equal(saved.success, true)
    assert.equal(await readFile(saved.filePath, 'utf8'), 'isolated')
    assert.deepEqual(await desktop.page.evaluate(name => window.customDialog.delete(name), saved.fileName), { success: true })
    await assert.rejects(readFile(saved.filePath), { code: 'ENOENT' })
    assert.deepEqual(await desktop.page.evaluate(name => window.customDialog.delete(name), saved.fileName), { success: false, error: '文件不存在' })
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    // 3、继续执行原后台和文件写入隔离检查。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'custom-dialog-path-result.json'), JSON.stringify(evidence, null, 2)) }
  }
})
