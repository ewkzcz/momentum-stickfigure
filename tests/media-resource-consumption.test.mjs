/** 固定媒体消费接入测试：真实授权核心/文件系统；不冒充Electron端到端或原生内存测量。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { createCanvas } from '@napi-rs/canvas'
import { withMediaAdmission, runMediaOperation } from '../src/main/media-resource-admission.js'
import { saveTemporaryImage, grantMediaFiles, readAuthorizedImage, hasAuthorizedInput } from '../src/main/local-media-authorization.js'

const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false })
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-media-consumption-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const canvas = createCanvas(8, 6)
  canvas.getContext('2d').fillRect(1, 1, 4, 3)
  return { root, bytes: canvas.toBuffer('image/png'), source: owner() }
}
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const observed = promise => promise.then(value => ({ value }), error => ({ error }))

test('媒体接入：第五项临时图片在base64分配和创建写盘前繁忙', { timeout: 10000 }, async t => {
  const { root, bytes, source } = fixture(t)
  const gate = deferred(), entered = deferred(), pending = []
  const encoded = bytes.toString('base64'), original = Buffer.from
  let allocations = 0
  try {
    pending.push(observed(withMediaAdmission({ owner: source }, lease => runMediaOperation(lease, () => { entered.resolve(); return gate.promise }))))
    await entered.promise
    for (let i = 0; i < 3; i++) pending.push(observed(saveTemporaryImage(source, root, encoded, `waiting-${i}.png`)))
    Buffer.from = function (...args) {
      if (args[0] === encoded && args[1] === 'base64') allocations++
      return Reflect.apply(original, this, args)
    }
    await assert.rejects(saveTemporaryImage(source, root, encoded, 'busy.png'), error => error.code === 'MEDIA_BUSY' && /繁忙/.test(error.message))
    await assert.rejects(hasAuthorizedInput(source, path.join(root, 'unknown.png')), error => error.code === 'MEDIA_BUSY')
    assert.equal(allocations, 0)
    assert.deepEqual(fs.readdirSync(root), [])
  } finally {
    Buffer.from = original
    gate.resolve()
    const results = await Promise.all(pending)
    for (const result of results) assert.equal(result.error, undefined)
  }
  assert.equal(fs.existsSync(path.join(root, 'momentum-stickfigure-paste/busy.png')), false)
  await assert.rejects(readAuthorizedImage(source, path.join(root, 'momentum-stickfigure-paste/busy.png')), /未授权/)
  const result = await readAuthorizedImage(source, path.join(root, 'momentum-stickfigure-paste/waiting-0.png'))
  assert.equal('bytes' in result, false)
  assert.deepEqual(Buffer.from(result.dataUrl.split(',')[1], 'base64'), bytes)
})

test('媒体接入：预览编码消费时仍占额度，完整结果不返回裸bytes', { timeout: 10000 }, async t => {
  const { root, bytes, source } = fixture(t), file = path.join(root, 'preview.png')
  fs.writeFileSync(file, bytes)
  await grantMediaFiles(source, [file])
  const original = Buffer.prototype.toString, queued = []
  let captured = false, starts = 0, startsDuringConsumption, fifth
  try {
    Buffer.prototype.toString = function (...args) {
      if (!captured && args[0] === 'base64' && this.equals(bytes)) {
        captured = true
        for (let i = 0; i < 3; i++) queued.push(observed(withMediaAdmission({ owner: owner() }, () => { starts++ })))
        fifth = observed(withMediaAdmission({ owner: owner() }, () => { starts++; return '不应执行' }))
        startsDuringConsumption = starts
      }
      return Reflect.apply(original, this, args)
    }
    const preview = await readAuthorizedImage(source, file)
    assert.equal(captured, true)
    assert.equal(startsDuringConsumption, 0)
    assert.equal((await fifth).error?.code, 'MEDIA_BUSY')
    assert.equal('bytes' in preview, false)
    assert.equal(preview.dataUrl, `data:image/png;base64,${original.call(bytes, 'base64')}`)
  } finally {
    Buffer.prototype.toString = original
    await Promise.all(queued)
    if (fifth) await fifth
  }
  assert.equal(starts, 3)
})

test('媒体接入：批预览后项失败保持原子授权，非图片临时写入不授能力', { timeout: 10000 }, async t => {
  const { root, bytes, source } = fixture(t)
  const old = path.join(root, 'old.png'), fresh = path.join(root, 'fresh.png'), bad = path.join(root, 'bad.png')
  fs.writeFileSync(old, bytes); fs.writeFileSync(fresh, bytes); fs.writeFileSync(bad, '<svg/>')
  await grantMediaFiles(source, [old])
  await assert.rejects(grantMediaFiles(source, [old, fresh, bad], undefined, { preview: true }), error => error.code === 'MEDIA_INVALID_IMAGE')
  assert.equal(await hasAuthorizedInput(source, fresh), false)
  await assert.rejects(readAuthorizedImage(source, fresh), /未授权/)
  assert.deepEqual(Buffer.from((await readAuthorizedImage(source, old)).dataUrl.split(',')[1], 'base64'), bytes)
  const saved = await saveTemporaryImage(source, root, Buffer.from('<svg/>').toString('base64'), 'not-image.png')
  assert.equal(fs.readFileSync(saved.path, 'utf8'), '<svg/>')
  await assert.rejects(readAuthorizedImage(source, saved.path), /未授权/)
  const selection = await grantMediaFiles(source, [fresh], undefined, { preview: true })
  assert.equal('bytes' in selection.files[0], false)
  assert.deepEqual(Buffer.from(selection.files[0].dataUrl.split(',')[1], 'base64'), bytes)
  selection.rollback()
  await assert.rejects(readAuthorizedImage(source, fresh), /未授权/)
})
