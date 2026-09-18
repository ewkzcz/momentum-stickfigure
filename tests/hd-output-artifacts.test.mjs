import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createCanvas } from '@napi-rs/canvas'
import { grantMediaFile, grantMediaFiles, grantInputFile, grantInputFiles, grantOutputDirectory, readAuthorizedImage, MEDIA_LIMITS, validateImage, assertImageDimensions } from '../src/main/local-media-authorization.js'
import { createArtifactTask, parseCompletion } from '../src/main/hd-output-artifacts.js'
import { pngFixture, pngChunk } from './helpers/png-media-fixtures.mjs'
import { deflateSync } from 'node:zlib'

async function fixture(t) {
  // 保留os.tmpdir的词法别名，专门覆盖macOS /var 与 /private/var；不改bootstrap。
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-hd-artifact-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const canvas = createCanvas(8, 6)
  canvas.getContext('2d').fillRect(1, 1, 4, 3)
  const bytes = canvas.toBuffer('image/png')
  const input = path.join(root, '中文 空格.png'), output = path.join(root, 'published')
  fs.writeFileSync(input, bytes); fs.mkdirSync(output)
  await grantMediaFile(owner, input); grantOutputDirectory(owner, output)
  const controller = new globalThis.AbortController()
  const task = await createArtifactTask({ owner, temporaryRoot: root, inputs: [input], signal: controller.signal })
  t.after(() => { try { task.cleanup() } finally { fs.rmSync(root, { recursive: true, force: true }) } })
  return { root, owner, bytes, input, output, task, controller, record: task.records[0] }
}

test('HD产物完成记录：仅本任务预定编号，拒绝重复、其他任务、路径自报和超限', () => {
  parseCompletion('模型日志\nMOMENTUM_ARTIFACT task:0\n', 'task:0')
  parseCompletion('MOMENTUM_ARTIFACT task:0\nMOMENTUM_ARTIFACT task:1', ['task:0', 'task:1'])
  for (const value of ['', 'MOMENTUM_ARTIFACT other:0', 'MOMENTUM_ARTIFACT ../../private.png', 'MOMENTUM_ARTIFACT task:0\nMOMENTUM_ARTIFACT task:0', 'x'.repeat(1024 * 1024 + 1)]) assert.throws(() => parseCompletion(value, 'task:0'))
  assert.throws(() => parseCompletion('MOMENTUM_ARTIFACT task:0', ['task:0', 'task:1']))
  assert.throws(() => parseCompletion('MOMENTUM_ARTIFACT task:1\nMOMENTUM_ARTIFACT task:0', ['task:0', 'task:1']))
})

test('HD产物发布：精确中文图片安全追加，旧文件不变且只授本owner', { timeout: 10000 }, async t => {
  const f = await fixture(t)
  const existing = path.join(f.output, path.basename(f.input))
  fs.writeFileSync(existing, 'old-file-never-rewrite')
  fs.writeFileSync(f.record.output, f.bytes)
  await f.task.complete(f.record, `MOMENTUM_ARTIFACT ${f.record.id}`)
  const files = await f.task.publish(f.output)
  assert.deepEqual(files, [path.join(f.output, '中文 空格_1.png')])
  assert.equal(fs.readFileSync(existing, 'utf8'), 'old-file-never-rewrite')
  assert.deepEqual(Buffer.from((await readAuthorizedImage(f.owner, files[0])).dataUrl.split(',')[1], 'base64'), f.bytes)
  const stranger = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  await assert.rejects(() => readAuthorizedImage(stranger, files[0]))
  f.task.commit()
  assert.equal(fs.existsSync(f.task.directory), false)
  f.task.cleanup()
  assert.equal(fs.existsSync(files[0]), true)
})

test('HD产物映射：拒绝其他任务对象及被改写的输出路径', async t => {
  const f = await fixture(t)
  await assert.rejects(() => f.task.complete({ ...f.record }, `MOMENTUM_ARTIFACT ${f.record.id}`))
  f.record.output = f.input
  await assert.rejects(() => f.task.complete(f.record, `MOMENTUM_ARTIFACT ${f.record.id}`))
  assert.deepEqual(fs.readFileSync(f.input), f.bytes)
})

for (const kind of ['symbolic-link', 'fake-image', 'oversized']) test(`HD产物校验拒绝${kind}`, async t => {
  const f = await fixture(t)
  if (kind === 'symbolic-link') fs.symlinkSync(f.input, f.record.output)
  if (kind === 'fake-image') fs.writeFileSync(f.record.output, '<svg><script>alert(1)</script></svg>')
  if (kind === 'oversized') { fs.writeFileSync(f.record.output, 'x'); fs.truncateSync(f.record.output, MEDIA_LIMITS.batchBytes + 1) }
  await assert.rejects(() => f.task.complete(f.record, `MOMENTUM_ARTIFACT ${f.record.id}`))
  assert.deepEqual(fs.readdirSync(f.output), [])
})

test('HD产物取消：已发布未提交图片撤销并清理暂存，不改旧文件', async t => {
  const f = await fixture(t)
  fs.writeFileSync(f.record.output, f.bytes)
  await f.task.complete(f.record, `MOMENTUM_ARTIFACT ${f.record.id}`)
  const files = await f.task.publish(f.output)
  f.controller.abort(new Error('受控取消'))
  assert.throws(() => f.task.commit(), /受控取消/)
  f.task.cleanup()
  assert.equal(fs.existsSync(f.task.directory), false)
  assert.equal(fs.existsSync(files[0]), false)
  await assert.rejects(() => readAuthorizedImage(f.owner, files[0]))
})

test('媒体能力：替换、销毁、伪图片及解码前像素超限拒绝', async t => {
  const f = await fixture(t)
  fs.writeFileSync(f.input, '<html>not an image</html>')
  await assert.rejects(() => readAuthorizedImage(f.owner, f.input))
  await assert.rejects(() => grantMediaFile(f.owner, f.input))
  const huge = Buffer.from(f.bytes)
  huge.writeUInt32BE(100000, 16); huge.writeUInt32BE(100000, 20)
  await assert.rejects(() => validateImage(huge))
  fs.writeFileSync(f.input, f.bytes); await grantMediaFile(f.owner, f.input)
  f.owner.emit('destroyed')
  await assert.rejects(() => readAuthorizedImage(f.owner, f.input))
})

test('HD非图片复制保留用途但不授媒体能力', async t => {
  const f = await fixture(t)
  const other = path.join(f.root, '说明 中文.txt')
  fs.writeFileSync(other, '保留非图片复制用途')
  await grantInputFile(f.owner, other)
  const task = await createArtifactTask({ owner: f.owner, temporaryRoot: f.root, inputs: [other] })
  try {
    await task.complete(task.records[0], '')
    const [file] = await task.publish(f.output)
    assert.equal(fs.readFileSync(file, 'utf8'), '保留非图片复制用途')
    await assert.rejects(() => readAuthorizedImage(f.owner, file))
    task.commit()
  } finally { task.cleanup() }
})

for (const mime of ['image/png', 'image/jpeg', 'image/webp']) {
  test(`媒体实际解码：${mime}合法字节`, async () => {
    const canvas = createCanvas(8, 6)
    canvas.getContext('2d').fillRect(0, 0, 8, 6)
    const bytes = canvas.toBuffer(mime)
    assert.deepEqual(await validateImage(bytes), { mime, width: 8, height: 6, pixels: 48 })
  })
  test(`媒体实际解码：${mime}损坏数据`, async () => {
    const canvas = createCanvas(8, 6)
    canvas.getContext('2d').fillRect(0, 0, 8, 6)
    const bytes = canvas.toBuffer(mime)
    // 保留原损坏字节负例；拆分只为独立进程定位，不跳过、不改变拒绝断言。
    const headerEnd = mime === 'image/jpeg' ? bytes.indexOf(Buffer.from([255, 218])) : 30
    assert.ok(headerEnd > 0 && headerEnd < bytes.length)
    await assert.rejects(() => validateImage(bytes.subarray(0, headerEnd)))
    assert.deepEqual(await validateImage(bytes), { mime, width: 8, height: 6, pixels: 48 }, '拒绝损坏输入后仍可解码正常输入')
  })
}

test('PNG规范预检：所有合法颜色位深、Adam7小图及过滤类型仍实际可解码', async () => {
  for (const [color, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]) {
    for (const depth of depths) for (const interlace of [0, 1]) {
      const image = await validateImage(pngFixture({ color, depth, interlace, split: true }))
      assert.deepEqual(image, { mime: 'image/png', width: 9, height: 7, pixels: 63 })
    }
  }
  for (const filter of [0, 1, 2, 3, 4]) {
    const image = await validateImage(pngFixture({ filter, interlace: 1, width: 1, height: 1 }))
    assert.equal(image.pixels, 1, '空Adam7 pass不得产生扫描行')
    const crossed = await validateImage(pngFixture({ filter, width: 4096, height: 3, split: true }))
    assert.equal(crossed.pixels, 12288, '扫描行跨16KiB输出块时仍正确跟踪过滤字节')
  }
})

test('PNG明确无效数据：CRC、块截断/缺失、非法zlib、扫描行长度和过滤类型拒绝并恢复', async () => {
  const valid = pngFixture()
  const badCrc = Buffer.from(valid); badCrc[29] ^= 1
  const illegalZlib = pngFixture({ payload: Buffer.from([0, 0, 0, 0]) }) // CM=0，不是zlib要求的DEFLATE(8)，CRC有效。
  const short = pngFixture({ rawTransform: raw => raw.subarray(0, -1) })
  const excess = pngFixture({ rawTransform: raw => Buffer.concat([raw, Buffer.alloc(65536)]) })
  const compressed = deflateSync(Buffer.alloc(259)) // 7行 × (1个filter字节 + 9×4样本字节)
  const badAdler = Buffer.from(compressed); badAdler[badAdler.length - 1] ^= 1
  const cases = [
    [badCrc, /CRC/], [valid.subarray(0, 30), /截断/], [valid.subarray(0, -12), /IEND/],
    [Buffer.concat([valid.subarray(0, 33), pngChunk('IEND', Buffer.alloc(0))]), /IDAT/],
    [illegalZlib, /zlib/], [short, /扫描行/], [excess, /扫描行/], [pngFixture({ filter: 5 }), /过滤/],
    [pngFixture({ payload: badAdler }), /zlib/], [pngFixture({ payload: compressed.subarray(0, -1) }), /zlib/],
    [pngFixture({ payload: Buffer.concat([compressed, Buffer.from([1, 2, 3])]) }), /尾随/]
  ]
  for (const [bytes, message] of cases) {
    await assert.rejects(() => validateImage(bytes), message)
    assert.equal((await validateImage(valid)).pixels, 63)
  }
})

test('HD像素预算元数据边界：4K的2/4/8倍可表示，超过上限拒绝且不分配大图', () => {
  for (const scale of [1, 2, 4, 8]) assert.equal(assertImageDimensions(3840, 2160, scale), 3840 * 2160 * scale * scale)
  assert.equal(assertImageDimensions(3840, 2160, 8), MEDIA_LIMITS.pixels)
  assert.equal(MEDIA_LIMITS.batchPixels, MEDIA_LIMITS.pixels * MEDIA_LIMITS.files)
  assert.throws(() => assertImageDimensions(3841, 2160, 8))
  for (const scale of [0, -1, Infinity, NaN]) assert.throws(() => assertImageDimensions(3840, 2160, scale))
})

test('HD受控代表图像：1–8倍尺寸真实解码，不分配4K放大产物', async () => {
  for (const scale of [1, 2, 4, 8]) {
    const canvas = createCanvas(8 * scale, 6 * scale)
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height)
    const decoded = await validateImage(canvas.toBuffer('image/png'))
    assert.equal(decoded.pixels, assertImageDimensions(8, 6, scale))
    assert.equal(decoded.width, 8 * scale)
    assert.equal(decoded.height, 6 * scale)
  }
})

test('媒体多选事务：后项失败不留前项能力，保留既有授权，销毁期间不得重新登记', async t => {
  const f = await fixture(t)
  const fresh = path.join(f.root, '新选择.png'), bad = path.join(f.root, '伪图.png')
  fs.writeFileSync(fresh, f.bytes); fs.writeFileSync(bad, '<svg/>')
  await assert.rejects(() => grantMediaFiles(f.owner, [f.input, fresh, bad]))
  await assert.rejects(() => readAuthorizedImage(f.owner, fresh))
  assert.deepEqual(Buffer.from((await readAuthorizedImage(f.owner, f.input)).dataUrl.split(',')[1], 'base64'), f.bytes)
  const stranger = Object.assign(new EventEmitter(), { isDestroyed: () => false })
  const pending = grantMediaFile(stranger, fresh)
  stranger.emit('destroyed')
  await assert.rejects(() => pending, /关闭/)
  await assert.rejects(() => readAuthorizedImage(stranger, fresh))
  const controller = new globalThis.AbortController()
  const selecting = grantInputFiles(f.owner, [fresh], controller.signal)
  controller.abort(new Error('受控取消'))
  await assert.rejects(() => selecting, /取消/)
  await assert.rejects(() => readAuthorizedImage(f.owner, fresh))
})

test('HD清理失败：提交前清理失败保留失败状态，回滚本次发布且新任务可重试', async t => {
  const f = await fixture(t)
  fs.writeFileSync(f.record.output, f.bytes)
  await f.task.complete(f.record, `MOMENTUM_ARTIFACT ${f.record.id}`)
  const [file] = await f.task.publish(f.output)
  const original = fs.rmSync
  let injected = false
  try {
    fs.rmSync = (target, options) => {
      if (target === f.task.directory && !injected) { injected = true; throw new Error('受控暂存清理失败') }
      return original(target, options)
    }
    assert.throws(() => f.task.commit(), /受控暂存清理失败/)
  } finally { fs.rmSync = original }
  f.task.cleanup()
  assert.equal(fs.existsSync(file), false)
  await assert.rejects(() => readAuthorizedImage(f.owner, file))
  const retry = await createArtifactTask({ owner: f.owner, temporaryRoot: f.root, inputs: [f.input] })
  try {
    fs.writeFileSync(retry.records[0].output, f.bytes)
    await retry.complete(retry.records[0], `MOMENTUM_ARTIFACT ${retry.records[0].id}`)
    assert.deepEqual(await retry.publish(f.output), [file])
    retry.commit()
  } finally { retry.cleanup() }
})
