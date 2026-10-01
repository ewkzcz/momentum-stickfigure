import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile, symlink, unlink, rename } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('自定义图片授权：拒绝扫描链接和目录替换，非法编码不写入', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
  try {
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    const directory = path.join(userData, 'custom-dialogs')
    const secret = path.join(desktop.root, 'sentinel.png')
    await writeFile(secret, 'keep')
    const link = path.join(directory, 'linked.png')
    await symlink(secret, link)
    const scanned = await invoke('scan-custom-dialogs')
    assert.equal(scanned.success, false, '扫描不能读取目录外链接目标')
    assert.deepEqual(scanned.dialogs, [])
    assert.equal((await invoke('delete-custom-dialog', 'linked.png')).success, false)
    await unlink(link)
    for (const value of ['%%%=', {}, null]) assert.equal((await invoke('save-custom-dialog', 'new.png', value)).success, false)
    await rename(directory, directory + '-original')
    await symlink(desktop.root, directory)
    assert.equal((await invoke('save-custom-dialog', 'new.png', 'aGVsbG8=')).success, false)
    assert.equal((await invoke('delete-custom-dialog', 'sentinel.png')).success, false)
    assert.equal(await readFile(secret, 'utf8'), 'keep')
    await unlink(directory)
    await rename(directory + '-original', directory)
    const saved = await invoke('save-custom-dialog', '中文 空格.png', 'aGVsbG8=')
    assert.equal(saved.success, true)
    assert.equal(await readFile(saved.filePath, 'utf8'), 'hello')
    assert.equal((await invoke('scan-custom-dialogs')).dialogs.length, 1)
    assert.equal((await invoke('delete-custom-dialog', saved.fileName)).success, true)
  } finally { await desktop.close() }
})
