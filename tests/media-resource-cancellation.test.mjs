/** 真实媒体接入取消：Node可信主进程选择来源夹具，不是真实Electron窗口或系统对话框。
 * 不调用准入核心制造活动项；活动/等待均来自真实媒体授权、预览或HD快照入口。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter, getEventListeners } from 'node:events'
import { createCanvas } from '@napi-rs/canvas'
import { grantMediaFiles, grantInputFiles, readAuthorizedImage, hasAuthorizedInput } from '../src/main/local-media-authorization.js'
import { createArtifactTask } from '../src/main/hd-output-artifacts.js'
import { digest, installCancellationControl, cancelAfterRegistration } from './helpers/media-cancellation-control.mjs'

function owner() {
  const source = new EventEmitter()
  let destroyed = false
  source.isDestroyed = () => destroyed
  source.destroy = () => { destroyed = true; source.emit('destroyed') }
  return source
}
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'momentum-media-cancellation-'))
  const files = [], hashes = [], bytes = []
  for (let i = 0; i < 6; i++) {
    const canvas = createCanvas(8, 6), context = canvas.getContext('2d')
    context.fillStyle = `rgb(${30 + i * 25},90,140)`; context.fillRect(0, 0, 8, 6)
    bytes.push(canvas.toBuffer('image/png')); hashes.push(digest(bytes[i]))
    files.push(path.join(root, `image-${i}.png`)); fs.writeFileSync(files[i], bytes[i])
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return { root, files, hashes, bytes }
}
function noReads(control, files) {
  assert.deepEqual(control.reads.filter(event => files.includes(event.file) && event.bytes > 0), [])
}
async function previewMatches(source, file, hash) {
  const result = await readAuthorizedImage(source, file)
  assert.equal('bytes' in result, false)
  assert.equal(digest(Buffer.from(result.dataUrl.split(',')[1], 'base64')), hash)
}
function success(job) { assert.equal(job.failed, undefined, job.error?.stack) }

// 1、2：同一实际场景分别覆盖AbortSignal和来源销毁，不模拟队列内部状态。
for (const mode of ['signal', 'owner']) test(`媒体等待取消：${mode}零读取、移除监听及跨来源名额恢复`, { timeout: 15000 }, async t => {
  const f = fixture(t), activeOwner = owner(), waitingOwner = owner(), previewOwner = owner(), inputOwner = owner(), replacementOwner = owner()
  // Node中明确作为可信主进程选择边界调用；仅预授权预览自身来源。
  await grantMediaFiles(previewOwner, [f.files[2]])
  const controller = new globalThis.AbortController(), reason = new Error('真实媒体等待取消')
  const control = installCancellationControl(f.files, f.hashes[0])
  let first, cancelled, preview, input, replacement
  try {
    first = control.track(grantMediaFiles(activeOwner, [f.files[0]]))
    await control.settled
    assert.equal(control.outcome.status, 'fulfilled')
    assert.ok(control.reads.some(event => event.file === f.files[0] && event.bytes > 0), '必须捕获活动请求真实读取，不能空观察通过')
    cancelled = control.track(grantMediaFiles(waitingOwner, [f.files[1]], controller.signal))
    preview = control.track(readAuthorizedImage(previewOwner, f.files[2]))
    input = control.track(grantInputFiles(inputOwner, [f.files[3]]))
    await assert.rejects(grantMediaFiles(owner(), [f.files[5]]), error => error.code === 'MEDIA_BUSY')
    noReads(control, f.files.slice(1))
    assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
    if (mode === 'signal') controller.abort(reason)
    else waitingOwner.destroy()
    await cancelled.done
    if (mode === 'signal') assert.equal(cancelled.error, reason)
    else assert.equal(cancelled.error.code, 'MEDIA_OWNER_DESTROYED')
    assert.equal(waitingOwner.listenerCount('destroyed'), 0, '尚未执行媒体state，不能残留生命周期监听')
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
    replacement = control.track(grantMediaFiles(replacementOwner, [f.files[4]]))
    assert.equal(first.settled, false); assert.equal(preview.settled, false); assert.equal(input.settled, false); assert.equal(replacement.settled, false)
    noReads(control, f.files.slice(1))
  } finally { await control.close() }
  for (const job of [first, preview, input, replacement]) success(job)
  noReads(control, [f.files[1], f.files[5]])
  await assert.rejects(readAuthorizedImage(waitingOwner, f.files[1]))
  await assert.rejects(readAuthorizedImage(activeOwner, f.files[4]), /未授权/)
  await assert.rejects(readAuthorizedImage(replacementOwner, f.files[0]), /未授权/)
  await previewMatches(activeOwner, f.files[0], f.hashes[0])
  await previewMatches(replacementOwner, f.files[4], f.hashes[4])
  assert.equal(digest(Buffer.from(preview.value.dataUrl.split(',')[1], 'base64')), f.hashes[2])
})

// 3、4：真实解码已调用并结算，但其结果交付受控；不能宣称原生线程仍在运行。
for (const entry of ['grant', 'preview']) test(`媒体活动取消：${entry}等待真实decode结果交付、不误报坏图`, { timeout: 15000 }, async t => {
  const f = fixture(t), source = owner(), nextOwner = owner()
  if (entry === 'preview') await grantMediaFiles(source, [f.files[0]])
  const controller = new globalThis.AbortController(), reason = new Error(`取消${entry}`)
  const control = installCancellationControl(f.files, f.hashes[0])
  let first, next
  try {
    first = control.track(entry === 'grant' ? grantMediaFiles(source, [f.files[0]], controller.signal) : readAuthorizedImage(source, f.files[0], controller.signal))
    await control.entered; await control.settled
    assert.equal(control.outcome.status, 'fulfilled')
    assert.ok(control.reads.some(event => event.file === f.files[0] && event.bytes > 0), '必须捕获活动请求真实读取，不能空观察通过')
    next = control.track(grantMediaFiles(nextOwner, [f.files[1]]))
    controller.abort(reason)
    // 取消事件同步已分发；事件循环握手用于排空即时取消路径，不sleep猜测时序。
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(first.settled, false); assert.equal(next.settled, false)
    noReads(control, [f.files[1]])
  } finally { await control.close() }
  assert.equal(first.error, reason)
  assert.notEqual(first.error.code, 'MEDIA_INVALID_IMAGE')
  success(next)
  if (entry === 'grant') {
    await assert.rejects(readAuthorizedImage(source, f.files[0]), /未授权/)
    assert.equal(await hasAuthorizedInput(source, f.files[0]), false)
  } else await previewMatches(source, f.files[0], f.hashes[0]) // 取消读取不得撤掉旧能力。
  await previewMatches(nextOwner, f.files[1], f.hashes[1])
})

test('HD快照活动取消：真实解码交付前不放行、取消清理任务目录而保留旧输入授权', { timeout: 15000 }, async t => {
  const f = fixture(t), source = owner(), nextOwner = owner()
  await grantMediaFiles(source, [f.files[0]])
  const controller = new globalThis.AbortController(), reason = new Error('取消HD快照')
  const control = installCancellationControl(f.files, f.hashes[0])
  let task, next
  try {
    task = control.track(createArtifactTask({ owner: source, temporaryRoot: f.root, inputs: [f.files[0]], signal: controller.signal }))
    await control.settled
    assert.equal(control.outcome.status, 'fulfilled')
    assert.ok(control.reads.some(event => event.file === f.files[0] && event.bytes > 0), '必须捕获活动请求真实读取，不能空观察通过')
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('momentum-hd-')).length, 1)
    next = control.track(grantMediaFiles(nextOwner, [f.files[1]]))
    controller.abort(reason)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(task.settled, false); assert.equal(next.settled, false)
    noReads(control, [f.files[1]])
  } finally { await control.close() }
  assert.equal(task.error, reason); success(next)
  assert.deepEqual(fs.readdirSync(f.root).filter(name => name.startsWith('momentum-hd-')), [])
  await previewMatches(source, f.files[0], f.hashes[0])
})

test('授权登记后取消：双用途真实Map登记完成到阶段交付之间回滚新能力并保留旧能力', { timeout: 15000 }, async t => {
  const f = fixture(t), source = owner(), controller = new globalThis.AbortController(), reason = new Error('登记后取消')
  await grantMediaFiles(source, [f.files[0]])
  const registration = cancelAfterRegistration(f.files[1], f.hashes[1], controller, reason)
  let job
  try {
    // 原Map.set执行后仅安排取消，不自行授能力、改state或替换业务返回值。
    job = grantMediaFiles(source, [f.files[0], f.files[1]], controller.signal).then(value => ({ value }), error => ({ error }))
    const result = await job
    assert.equal(registration.count, 2)
    assert.equal(registration.triggered, true)
    assert.equal(result.error, reason)
  } finally {
    try { if (job) await job }
    finally { registration.restore() }
  }
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  await assert.rejects(readAuthorizedImage(source, f.files[1]), /未授权/)
  assert.equal(await hasAuthorizedInput(source, f.files[1]), false)
  await previewMatches(source, f.files[0], f.hashes[0])
  await grantMediaFiles(source, [f.files[1]])
  await previewMatches(source, f.files[1], f.hashes[1])
})
