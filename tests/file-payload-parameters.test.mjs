import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { assertBinaryPayload } from '../src/main/ipc-parameter-policy.js'

test('字节预算：ArrayBuffer、视图和数组边界在复制前检查', () => {
  for (const value of [new ArrayBuffer(3), new Uint8Array(3), new DataView(new ArrayBuffer(3)), [0, 127, 255]]) {
    assert.doesNotThrow(() => assertBinaryPayload(value, 3))
    assert.throws(() => assertBinaryPayload(value, 2), /容量/)
  }
})

test('文件载荷参数：解码前拒绝错误Base64和非字节数据且无目录副作用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const invoke = (channel, ...args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
  try {
    const target = path.join(desktop.root, 'must-not-create', 'invalid.png')
    for (const data of ['%%%=', {}, [1, 2], null]) {
      assert.equal((await invoke('write-file', target, data)).success, false)
      await assert.rejects(access(path.dirname(target)), { code: 'ENOENT' })
    }
    for (const data of ['not bytes', {}, [256], [1.5], [-1]]) assert.equal((await invoke('save-dragged-file', 'invalid.psd', data)).success, false)
    const file = path.join(desktop.root, '中文 空格', 'image.png')
    assert.equal((await invoke('write-file', file, 'aGVsbG8=')).success, true)
    assert.equal(await readFile(file, 'utf8'), 'hello')
    const dragged = await invoke('save-dragged-file', '中文 空格.psd', [0, 127, 255])
    assert.equal(dragged.success, true)
    assert.deepEqual([...await readFile(dragged.filePath)], [0, 127, 255])
  } finally { await desktop.close() }
})
