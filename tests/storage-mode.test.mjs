/** 共享配置权限回归：原子替换不得扩大已有私有文件权限；仅操作隔离配置。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { chmod, readFile, stat, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('共享配置权限：异步替换和退出同步保存均保留0600', { timeout: 40000 }, async () => {
  // 1、先通过真实IPC生成配置，再给该隔离文件设置私有权限。
  const desktop = await launchDesktop()
  const evidence = { passed: false }
  const file = path.join(desktop.root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  let closed = false
  console.log(`共享存储权限证据：${desktop.root}`)
  try {
    for (const value of ['initial', 'updated']) {
      await desktop.page.evaluate(value => window.electronAPI.invoke('storage:setItem', 'permissions-regression', value), value)
      let found = false
      for (let attempt = 0; attempt < 1500; attempt++) {
        const data = await readFile(file, 'utf8').catch(() => '{}')
        if (JSON.parse(data)['permissions-regression'] === value) { found = true; break }
        await delay(10)
      }
      assert.equal(found, true)
      if (value === 'initial') await chmod(file, 0o600)
    }
    evidence.asyncMode = (await stat(file)).mode & 0o777
    assert.equal(evidence.asyncMode, 0o600, '异步替换不能扩大已有文件读取权限')
    // 2、尚未到防抖计时时退出，验证同步保存也继承权限且写入最新值。
    await desktop.page.evaluate(() => window.electronAPI.invoke('storage:setItem', 'permissions-regression', 'exit-latest'))
    await desktop.close()
    closed = true
    evidence.exitMode = (await stat(file)).mode & 0o777
    assert.equal(evidence.exitMode, 0o600, '退出替换不能扩大已有文件读取权限')
    assert.equal(JSON.parse(await readFile(file, 'utf8'))['permissions-regression'], 'exit-latest')
    evidence.passed = true
  } finally {
    try { if (!closed) await desktop.close() } finally { await writeFile(path.join(desktop.root, 'storage-mode-result.json'), JSON.stringify(evidence, null, 2)) }
  }
})
