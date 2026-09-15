import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, symlink, readFile, writeFile, rm } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('临时图片：拒绝专属目录和目标文件符号链接越界，拒绝后正常保存', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const target = path.join(desktop.root, 'temp', 'outside.png')
    await writeFile(target, 'sentinel')
    const root = path.join(desktop.root, 'temp', 'momentum-stickfigure-paste')
    await mkdir(root, { recursive: true })
    await symlink(target, path.join(root, 'linked.png'))
    const invoke = fileName => desktop.page.evaluate(fileName => window.electronAPI.invoke('save-temp-image', 'eA==', fileName), fileName)
    const denied = await invoke('linked.png')
    assert.equal(denied.success, false)
    assert.match(denied.error, /符号链接|授权/)
    assert.equal(await readFile(target, 'utf8'), 'sentinel')
    const saved = await invoke('中文 正常.png')
    assert.equal(saved.success, true)
    assert.equal(await readFile(saved.path, 'utf8'), 'x')
    await rm(root, { recursive: true })
    const outside = path.join(desktop.root, 'temp', 'outside-directory')
    await mkdir(outside)
    await symlink(outside, root)
    const deniedRoot = await invoke('blocked.png')
    assert.equal(deniedRoot.success, false)
    assert.match(deniedRoot.error, /符号链接|授权/)
    await assert.rejects(readFile(path.join(outside, 'blocked.png')), { code: 'ENOENT' })
  } finally { await desktop.close() }
})
