import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile, symlink, unlink } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('预设写入授权：只允许当前窗口原生导出选择的文件', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const allowed = path.join(desktop.root, '中文 预设.json')
    const deniedPath = path.join(desktop.root, '未授权.json')
    const save = (file, content) => desktop.page.evaluate(({ file, content }) => window.electronAPI.invoke('preset-save-file', file, content), { file, content })
    const denied = await save(deniedPath, '{}')
    assert.equal(denied.success, false)
    assert.match(denied.error, /授权/)
    await assert.rejects(readFile(deniedPath), { code: 'ENOENT' })
    await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.savePath = file }, allowed)
    const selection = await desktop.page.evaluate(() => window.electronAPI.invoke('preset-export'))
    assert.equal(selection.filePath, allowed)
    assert.equal((await save(allowed, '{"name":"中文"}')).success, true)
    assert.equal(await readFile(allowed, 'utf8'), '{"name":"中文"}')
    assert.equal((await save(deniedPath, '{}')).success, false)
    assert.equal((await save(allowed, {})).success, false)
    const sentinel = path.join(desktop.root, 'sentinel.json')
    await writeFile(sentinel, 'sentinel')
    await unlink(allowed)
    await symlink(sentinel, allowed)
    assert.equal((await save(allowed, 'changed')).success, false)
    assert.equal(await readFile(sentinel, 'utf8'), 'sentinel')
    await unlink(allowed)
    assert.equal((await save(allowed, 'recovered')).success, true)
    assert.equal(await readFile(allowed, 'utf8'), 'recovered')
  } finally { await desktop.close() }
})
