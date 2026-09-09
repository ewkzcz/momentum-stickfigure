/** 文件写入公开 API 回归：验证真实 Electron preload 到磁盘的完整链路。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

function failed(result, pattern = /./) {
  assert.deepEqual(Object.keys(result).sort(), ['error', 'success'])
  assert.equal(result.success, false)
  assert.equal(typeof result.error, 'string')
  assert.match(result.error, pattern)
}

test('文件写入：Base64、拖入字节、错误与重启持久化', { timeout: 60000 }, async () => {
  let desktop = await launchDesktop()
  const root = desktop.root
  const target = path.join(root, '中文 空格', '嵌套 目录', '资料.txt')
  const text = '中文 内容\n含空格'
  let savedPath
  let draggedPath
  try {
    // 1、通过 preload 暴露的 writeFile 写入中文和空格路径，并验证同名自动编号。
    const write = (filePath, data) => desktop.page.evaluate(({ filePath, data }) => window.electronAPI.writeFile(filePath, data), { filePath, data })
    const encoded = Buffer.from(text).toString('base64')
    assert.deepEqual(await write(target, encoded), { success: true, filePath: target })
    assert.equal(await readFile(target, 'utf8'), text)
    const duplicate = await write(target, Buffer.from('第二份').toString('base64'))
    savedPath = path.join(path.dirname(target), '资料_1.txt')
    assert.deepEqual(duplicate, { success: true, filePath: savedPath })
    assert.equal(await readFile(savedPath, 'utf8'), '第二份')
    const thirdPath = path.join(path.dirname(target), '资料_2.txt')
    assert.deepEqual(await desktop.page.evaluate(({ target, encoded }) => window.api.writeFile(target, encoded), { target, encoded }), { success: true, filePath: thirdPath })
    assert.equal(await readFile(target, 'utf8'), text)
    assert.equal(await readFile(savedPath, 'utf8'), '第二份')
    assert.equal(await readFile(thirdPath, 'utf8'), text)

    // 2、拖入 API 接收真实 ArrayBuffer，清理文件名并覆盖同名结果。
    const drag = (fileName, bytes) => desktop.page.evaluate(({ fileName, bytes }) => window.electronAPI.saveDraggedFile(fileName, new Uint8Array(bytes).buffer), { fileName, bytes: [...bytes] })
    const first = await drag('原始/文件?:名.bin', [0, 1, 2, 255])
    assert.equal(first.success, true)
    assert.equal(first.originalName, '原始/文件?:名.bin')
    draggedPath = first.filePath
    assert.match(draggedPath, /dragged-files\/文件__名\.bin$/)
    assert.deepEqual([...await readFile(draggedPath)], [0, 1, 2, 255])
    const second = await drag('原始/文件?:名.bin', [9, 8, 7])
    assert.deepEqual(second, { success: true, filePath: draggedPath, originalName: '原始/文件?:名.bin' })
    assert.deepEqual([...await readFile(draggedPath)], [9, 8, 7])

    // 3、非法参数和父目录冲突必须返回失败对象，而非抛出或伪造成功。
    failed(await desktop.page.evaluate(() => window.electronAPI.writeFile()))
    failed(await write(null, encoded))
    failed(await write(123, encoded))
    failed(await write(target, null))
    failed(await write(path.join(root, '缺失数据.bin'), undefined))
    failed(await write(path.join(root, '非法数据.bin'), {}))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile()))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile(null, new Uint8Array([1]).buffer)))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile(123, new Uint8Array([1]).buffer)))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile('缺失数据.bin')))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile('坏.bin', null)))
    failed(await desktop.page.evaluate(() => window.electronAPI.saveDraggedFile('非法.bin', {})))
    const blocked = path.join(root, '父目录是文件')
    await writeFile(blocked, '占位')
    failed(await write(path.join(blocked, '子.txt'), encoded), /ENOTDIR/)
    await assert.rejects(stat(path.join(blocked, '子.txt')), { code: 'ENOTDIR' })
    assert.equal(await readFile(blocked, 'utf8'), '占位')
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }

  // 4、重启同一隔离环境后，之前落盘的文件仍可读。
  desktop = await launchDesktop(root)
  try {
    assert.equal(await readFile(target, 'utf8'), text)
    assert.equal(await readFile(savedPath, 'utf8'), '第二份')
    assert.deepEqual([...await readFile(draggedPath)], [9, 8, 7])
    for (const [filePath, bytes] of [[target, [...Buffer.from(text)]], [savedPath, [...Buffer.from('第二份')]], [draggedPath, [9, 8, 7]]]) {
      assert.deepEqual(await desktop.page.evaluate(async filePath => Array.from(await window.electronAPI.readFile(filePath)), filePath), bytes)
    }
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
