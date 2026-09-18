import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile, access } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('文件IPC来源：预览窗口拒绝读写，主窗口保留合法文件操作', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const input = path.join(desktop.root, 'isolated-input.txt'), output = path.join(desktop.root, 'unauthorized-output.txt')
    await writeFile(input, 'isolated data')
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.waitForFunction(() => !!window.electronAPI)
    const denied = await preview.evaluate(async ({ input, output }) => ({
      exists: await window.electronAPI.invoke('check-file-exists', input),
      read: await window.electronAPI.invoke('read-file', input),
      write: await window.electronAPI.invoke('write-file', output, 'd3JpdGU=')
    }), { input, output })
    assert.equal(denied.exists, false); assert.equal(denied.read, null); assert.equal(denied.write.success, false)
    await assert.rejects(access(output))
    // 主窗正例先通过原生选择取得读取权限；预览来源拒绝和通用写入断言保持。
    await desktop.application.evaluate((_electron, input) => { globalThis.__momentumTest.openPaths = [input] }, input)
    assert.deepEqual(await desktop.page.evaluate(() => window.fileSystem.selectFile()), { success: true, canceled: false, paths: [input], path: input })
    const allowed = await desktop.page.evaluate(async ({ input, output }) => ({
      exists: await window.electronAPI.invoke('check-file-exists', input),
      read: Array.from(await window.electronAPI.invoke('read-file', input)),
      write: await window.electronAPI.invoke('write-file', output, 'd3JpdGU=')
    }), { input, output })
    assert.equal(allowed.exists, true); assert.deepEqual(allowed.read, [...Buffer.from('isolated data')]); assert.equal(allowed.write.success, true)
  } finally { await desktop.close() }
})
