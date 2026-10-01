import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

const encoded = Buffer.from('中文导出内容').toString('base64')
const write = (desktop, file) => desktop.page.evaluate(({ file, encoded }) => window.electronAPI.writeFile(file, encoded), { file, encoded })
async function absent(file) { await assert.rejects(access(file), { code: 'ENOENT' }) }

for (const scenario of ['未选择路径', '取消保存', '配置字符串', '读取选择不授写', '选中文件不授兄弟', '普通目录不授写']) {
  test(`通用写入授权：${scenario}必须在文件副作用前拒绝`, { timeout: 30000 }, async () => {
    const desktop = await launchDesktop()
    const root = path.join(desktop.root, '中文 输出')
    await mkdir(root)
    const target = path.join(root, '结果.txt')
    try {
      if (scenario === '取消保存') {
        const selection = await desktop.page.evaluate(defaultPath => window.electronAPI.invoke('show-save-dialog', { defaultPath }), target)
        assert.equal(selection.canceled, true)
      }
      if (scenario === '配置字符串') {
        assert.equal((await desktop.page.evaluate(outputRoot => window.electronAPI.storage.setItem('stickfigure-config', JSON.stringify({ outputRoot })), root)).success, true)
      }
      if (scenario === '读取选择不授写') {
        await writeFile(target, '只读哨兵')
        await desktop.application.evaluate((_electron, file) => { globalThis.__momentumTest.openPaths = [file] }, target)
        assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('select-file', {}))).success, true)
      }
      if (scenario === '选中文件不授兄弟') {
        await desktop.application.evaluate((_electron, file) => { globalThis.__momentumTest.savePath = file }, path.join(root, '已选.txt'))
        assert.equal((await desktop.page.evaluate(() => window.electronAPI.invoke('show-save-dialog', {}))).success, true)
      }
      if (scenario === '普通目录不授写') {
        await desktop.application.evaluate((_electron, root) => { globalThis.__momentumTest.openPaths = [root] }, root)
        assert.equal((await desktop.page.evaluate(() => window.fileSystem.selectFolder())).success, true)
      }
      const result = await write(desktop, target)
      assert.equal(result.success, false, '未获得明确写入授权不能返回成功')
      if (scenario === '读取选择不授写') {
        assert.equal(await readFile(target, 'utf8'), '只读哨兵')
        await absent(path.join(root, '结果_1.txt'))
      } else await absent(target)
      assert.deepEqual(desktop.errors, [])
    } finally { await desktop.close() }
  })
}

test('通用写入授权控制：原生保存精确路径可写中文内容', { timeout: 30000 }, async () => {
  const desktop = await launchDesktop()
  const target = path.join(desktop.root, '中文 空格', '结果.txt')
  try {
    await mkdir(path.dirname(target))
    await desktop.application.evaluate((_electron, file) => { globalThis.__momentumTest.savePath = file }, target)
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('show-save-dialog', {})), { success: true, canceled: false, filePath: target })
    assert.deepEqual(await write(desktop, target), { success: true, filePath: target })
    assert.equal(await readFile(target, 'utf8'), '中文导出内容')
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
