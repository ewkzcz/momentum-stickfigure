import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { grantExportDirectory, grantExportFile, writeExportFile } from '../src/main/export-write-policy.js'

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-export-policy-'))
  context.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const owner = new EventEmitter()
  owner.isDestroyed = () => false
  return { root, owner }
}

test('导出授权：精确文件中文空格及重名编号，不授权任意兄弟', context => {
  const { root, owner } = fixture(context)
  const file = path.join(root, '中文 空格.txt')
  grantExportFile(owner, file)
  assert.equal(writeExportFile(owner, file, Buffer.from('一')), file)
  assert.equal(writeExportFile(owner, file, Buffer.from('二')), path.join(root, '中文 空格_1.txt'))
  assert.equal(fs.readFileSync(file, 'utf8'), '一')
  assert.throws(() => writeExportFile(owner, path.join(root, '其他.txt'), Buffer.from('x')), /未授权/)
})

test('导出授权：明确输出目录允许子目录但不接受穿越或相邻目录', context => {
  const { root, owner } = fixture(context)
  const allowed = path.join(root, '输出')
  fs.mkdirSync(allowed)
  grantExportDirectory(owner, allowed)
  const file = path.join(allowed, '中文 日期', '图.png')
  assert.equal(writeExportFile(owner, file, Buffer.from([1, 2])), file)
  assert.deepEqual(fs.readFileSync(file), Buffer.from([1, 2]))
  for (const denied of [path.join(root, '输出相邻', 'x'), `${allowed}/../x`, 'relative.txt']) {
    assert.throws(() => writeExportFile(owner, denied, Buffer.from('x')), /未授权|回退|无效/)
  }
  assert.equal(fs.existsSync(path.join(root, '输出相邻')), false)
})

test('导出授权：窗口隔离、销毁后不能复活，不恢复磁盘权限', context => {
  const { root, owner } = fixture(context)
  const other = new EventEmitter()
  other.isDestroyed = () => false
  grantExportDirectory(owner, root)
  assert.throws(() => writeExportFile(other, path.join(root, 'x'), Buffer.from('x')), /未授权/)
  owner.emit('destroyed')
  assert.throws(() => writeExportFile(owner, path.join(root, 'x'), Buffer.from('x')), /关闭/)
  assert.throws(() => grantExportDirectory(owner, root), /关闭/)
})

test('导出授权：符号链接目录及链接目标拒绝且哨兵不变', context => {
  const { root, owner } = fixture(context)
  const inside = path.join(root, '输出'), outside = path.join(root, '哨兵')
  fs.mkdirSync(inside); fs.mkdirSync(outside)
  const sentinel = path.join(outside, '原文件.txt')
  fs.writeFileSync(sentinel, '不变')
  grantExportDirectory(owner, inside)
  fs.symlinkSync(outside, path.join(inside, '链接目录'), process.platform === 'win32' ? 'junction' : 'dir')
  fs.symlinkSync(sentinel, path.join(inside, '链接.txt'))
  assert.throws(() => grantExportDirectory(owner, path.join(inside, '链接目录')), /符号链接/)
  assert.throws(() => writeExportFile(owner, path.join(inside, '链接目录', '新增.txt'), Buffer.from('x')), /符号链接/)
  assert.throws(() => writeExportFile(owner, path.join(inside, '链接.txt'), Buffer.from('x')), /普通单链接/)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), '不变')
  assert.equal(fs.existsSync(path.join(outside, '新增.txt')), false)
})

test('导出授权：目录替换失效，原文件及硬链接不覆盖', context => {
  const { root, owner } = fixture(context)
  const selected = path.join(root, '输出')
  fs.mkdirSync(selected)
  grantExportDirectory(owner, selected)
  fs.renameSync(selected, path.join(root, '旧输出'))
  fs.mkdirSync(selected)
  assert.throws(() => writeExportFile(owner, path.join(selected, 'x'), Buffer.from('x')), /变化/)
  grantExportDirectory(owner, selected)
  const sentinel = path.join(root, '哨兵.txt')
  fs.writeFileSync(sentinel, '保留')
  const linked = path.join(selected, '链接.txt')
  fs.linkSync(sentinel, linked)
  assert.throws(() => writeExportFile(owner, linked, Buffer.from('x')), /普通单链接/)
  assert.equal(fs.readFileSync(sentinel, 'utf8'), '保留')
})
