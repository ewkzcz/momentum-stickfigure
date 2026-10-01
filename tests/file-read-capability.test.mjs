/** 精确读取能力纯单元：临时磁盘与 EventEmitter owner；不是 Electron 来源登记或真实系统交互验收。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { grantSelectedReads, checkSelectedRead, readSelectedFile } from '../src/main/file-access-policy.js'

function owner() { return Object.assign(new EventEmitter(), { isDestroyed: () => false }) }
function fixture(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-read-capability-'))
  const first = path.join(root, '中文 空格.bin'), sibling = path.join(root, '兄弟.bin'), empty = path.join(root, '空 文件.bin')
  const bytes = Buffer.from([0, 127, 128, 255, ...Buffer.from('完整字节🙂')])
  fs.writeFileSync(first, bytes); fs.writeFileSync(sibling, '哨兵'); fs.writeFileSync(empty, '')
  try { run({ root, first, sibling, empty, bytes, a: owner(), b: owner() }) }
  finally { fs.rmSync(root, { recursive: true, force: true }) }
}
function denied(a, file) {
  assert.throws(() => checkSelectedRead(a, file))
  assert.throws(() => readSelectedFile(a, file))
}

test('读取能力：owner与精确文件隔离，中文空格、二进制及空文件完整', () => fixture(({ a, b, first, sibling, empty, bytes }) => {
  grantSelectedReads(a, [first, empty])
  assert.equal(checkSelectedRead(a, first), true)
  assert.deepEqual(readSelectedFile(a, first), bytes)
  assert.deepEqual(readSelectedFile(a, empty), Buffer.alloc(0))
  denied(a, sibling); denied(b, first)
}))

test('读取能力：destroy撤销且伪装恢复isDestroyed也不能复活', () => fixture(({ a, b, first }) => {
  grantSelectedReads(a, [first]); grantSelectedReads(a, [first])
  assert.equal(a.listenerCount('destroyed'), 1)
  a.emit('destroyed')
  denied(a, first)
  assert.throws(() => grantSelectedReads(a, [first]), /关闭/)
  b.isDestroyed = () => true
  assert.throws(() => grantSelectedReads(b, [first]), /关闭/)
}))

test('读取能力：批量失败不授部分文件且不破坏旧能力', () => fixture(({ a, root, first, sibling, bytes }) => {
  grantSelectedReads(a, [first])
  assert.throws(() => grantSelectedReads(a, [sibling, path.join(root, '不存在.bin')]))
  denied(a, sibling)
  assert.deepEqual(readSelectedFile(a, first), bytes)
  assert.throws(() => grantSelectedReads(a, [first, root]), /普通文件/)
  assert.deepEqual(readSelectedFile(a, first), bytes)
}))

test('读取能力：PSD缺失项跳过不授读，正常项可读，危险项仍原子拒绝', () => fixture(({ a, root, first, sibling, bytes }) => {
  const missing = path.join(root, '选择后缺失.bin')
  grantSelectedReads(a, [missing, first], { skipMissing: true })
  assert.deepEqual(readSelectedFile(a, first), bytes)
  denied(a, missing)
  fs.writeFileSync(missing, '后来出现的文件也未授权')
  denied(a, missing)
  assert.throws(() => grantSelectedReads(a, [sibling, root], { skipMissing: true }))
  denied(a, sibling)
  assert.deepEqual(readSelectedFile(a, first), bytes)
}))

test('读取能力：回滚仅撤销本次登记，不覆盖较新的能力', () => fixture(({ a, first, sibling, bytes }) => {
  grantSelectedReads(a, [first])
  const undo = grantSelectedReads(a, [first, sibling])
  undo(); undo()
  assert.deepEqual(readSelectedFile(a, first), bytes)
  denied(a, sibling)
  const staleUndo = grantSelectedReads(a, [sibling])
  grantSelectedReads(a, [sibling])
  staleUndo()
  assert.deepEqual(readSelectedFile(a, sibling), Buffer.from('哨兵'))
}))

test('读取能力：绝对路径长度NUL类型及父级回退负例', () => fixture(({ a, root, first }) => {
  grantSelectedReads(a, [first])
  for (const file of [null, undefined, {}, [], -1, Buffer.from(first), '', 'relative.bin', `${first}\0x`, '/' + 'x'.repeat(32768), path.join(root, 'child') + path.sep + '..' + path.sep + path.basename(first)]) {
    denied(a, file)
    assert.throws(() => grantSelectedReads(a, [file]))
  }
  assert.equal(checkSelectedRead(a, first), true)
}))

test('读取能力：目录、最终符号链接及父目录符号链接拒绝', () => fixture(({ a, root, first }) => {
  const link = path.join(root, '文件链接.bin')
  const directory = path.join(root, '实际目录')
  fs.mkdirSync(directory)
  const nested = path.join(directory, '内部.bin'); fs.writeFileSync(nested, '内部')
  const alias = path.join(root, '目录链接')
  fs.symlinkSync(first, link)
  fs.symlinkSync(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
  for (const file of [root, link, path.join(alias, '内部.bin')]) {
    assert.throws(() => grantSelectedReads(a, [file]))
    denied(a, file)
  }
  grantSelectedReads(a, [nested])
  assert.deepEqual(readSelectedFile(a, nested), Buffer.from('内部'))
}))

test('读取能力：授权后替换文件或修改字节均需重新选择', () => fixture(({ a, root, first, bytes }) => {
  grantSelectedReads(a, [first])
  fs.renameSync(first, path.join(root, '原始.bin'))
  fs.writeFileSync(first, bytes)
  denied(a, first)
  grantSelectedReads(a, [first])
  assert.deepEqual(readSelectedFile(a, first), bytes)
  fs.writeFileSync(first, '不同长度的新内容')
  denied(a, first)
  grantSelectedReads(a, [first])
  assert.deepEqual(readSelectedFile(a, first), Buffer.from('不同长度的新内容'))
}))

test('读取能力：授权后替换为符号链接不能读取哨兵', () => fixture(({ a, root, first, sibling }) => {
  grantSelectedReads(a, [first])
  fs.renameSync(first, path.join(root, '保留.bin'))
  fs.symlinkSync(sibling, first)
  denied(a, first)
  assert.deepEqual(fs.readFileSync(sibling), Buffer.from('哨兵'))
}))

test('读取能力：授权后父目录替换成链接也不能沿旧路径读取', () => fixture(({ a, root, first }) => {
  const directory = path.join(root, '父目录')
  const moved = path.join(root, '移走父目录')
  fs.mkdirSync(directory)
  const nested = path.join(directory, '内容.bin')
  fs.writeFileSync(nested, '原内容')
  grantSelectedReads(a, [nested, first])
  fs.renameSync(directory, moved)
  fs.symlinkSync(moved, directory, process.platform === 'win32' ? 'junction' : 'dir')
  denied(a, nested)
  assert.equal(checkSelectedRead(a, first), true)
}))

test('读取能力：硬链接及授权后新增硬链接均拒绝', () => fixture(({ a, root, first }) => {
  grantSelectedReads(a, [first])
  const linked = path.join(root, '硬链接.bin')
  fs.linkSync(first, linked)
  denied(a, first)
  assert.throws(() => grantSelectedReads(a, [linked]), /普通文件/)
}))
