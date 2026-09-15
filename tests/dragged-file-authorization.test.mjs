import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

test('拖入临时文件授权：目录及目标链接拒绝，合法覆盖恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const save = () => desktop.page.evaluate(() => window.electronAPI.saveDraggedFile('中文 空格.psd', new Uint8Array([1, 2, 3]).buffer))
  try {
    const temp = path.join(desktop.root, 'temp', 'momentum-stickfigure')
    const directory = path.join(temp, 'dragged-files')
    const outside = path.join(desktop.root, 'sentinel-directory')
    await mkdir(temp, { recursive: true })
    await mkdir(outside)
    const sentinel = path.join(outside, '中文 空格.psd')
    await writeFile(sentinel, 'keep')
    await symlink(outside, directory)
    const result = await save()
    assert.equal(result.success, false)
    assert.match(result.error, /符号链接/)
    assert.equal(await readFile(sentinel, 'utf8'), 'keep')
    await unlink(directory)
    await mkdir(directory)
    const target = path.join(directory, '中文 空格.psd')
    await symlink(sentinel, target)
    assert.equal((await save()).success, false)
    assert.equal(await readFile(sentinel, 'utf8'), 'keep')
    await unlink(target)
    assert.equal((await save()).success, true)
    assert.equal((await save()).success, true)
    assert.deepEqual([...await readFile(target)], [1, 2, 3])
  } finally { await desktop.close() }
})
