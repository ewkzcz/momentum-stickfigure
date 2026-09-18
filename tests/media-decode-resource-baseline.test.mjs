/** 小图资源before：真实选择/授权/预览IPC，原生对话框由强制bootstrap替代。
 * 不注入IPC结果、不直接授予能力；不是真实OS选择/安装产物或大图预算验收。
 * 1项测试，15张图，每图1次未授权预览+1次选择+1次单预览+4次并发预览，共105次业务调用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { pngFixture } from './helpers/png-media-fixtures.mjs'
import { installMediaResourceObserver } from './helpers/media-resource-observer.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

function fixture(size, variant) {
  if (variant === 'png-adam7') return pngFixture({ width: size, height: size, interlace: 1, split: true })
  if (variant === 'png-16bit') return pngFixture({ width: size, height: size, depth: 16, split: true })
  const canvas = createCanvas(size, size), context = canvas.getContext('2d')
  context.fillStyle = '#347ac1'; context.fillRect(0, 0, size, size)
  context.fillStyle = '#e66342'; context.fillRect(size / 4, size / 4, size / 2, size / 2)
  return canvas.toBuffer(`image/${variant}`)
}

// 单个page.evaluate内发出至多4次真实IPC；Promise.allSettled保证失败时也等待该批完成。
async function requestBatch(page, operation, file, count) {
  return page.evaluate(async ({ operation, file, count }) => {
    const start = performance.now()
    const settled = await Promise.allSettled(Array.from({ length: count }, async (_, index) => {
      const at = performance.now()
      const result = operation === 'select' ? await window.fileSystem.selectFile({}) : await window.hdToolkit.getImagePreview(file)
      return { index, elapsedMs: performance.now() - at, result }
    }))
    return { elapsedMs: performance.now() - start, requests: settled.map(item => item.status === 'fulfilled'
      ? { status: item.status, ...item.value } : { status: item.status, error: String(item.reason) }) }
  }, { operation, file, count })
}

test('媒体资源before：固定小图真实授权及单请求/四并发预览观测', { timeout: 180000 }, async () => {
  const desktop = await launchDesktop()
  const child = desktop.application.process()
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const evidence = { passed: false, observationRevision: 2, previousEvidence: 'momentum-regression-xA5TgU：v1 CJS loadImage包装未捕获ESM调用；原证据只读保留', scope: '强制bootstrap工作区生产入口；真实磁盘小图、原生选择替身和真实预览IPC；非真实OS拖放/File导入、非安装产物或性能硬保证',
    limits: { fixtures: 15, maximumDimension: 1024, maximumConcurrentRequests: 4, businessCalls: 105 }, fixtures: [], phases: [],
    interpretation: '固定顺序、无预热/GC控制；每阶段采样及观察本身有开销。4×像素为单张RGBA8像素存储下界参考，不是总内存；乘请求数仅工作量参考。小图结果不得外推大图容量、无泄漏或系统/GPU上限。' }
  let failure, installed = false
  const save = () => writeFile(path.join(desktop.root, 'media-decode-resource-baseline.json'), JSON.stringify(evidence, null, 2))
  try {
    evidence.environment = await desktop.application.evaluate(installMediaResourceObserver, repository)
    installed = true
    assert.equal(evidence.environment.version, '1.0.5')
    assert.equal(evidence.environment.esmSnapshotVerified, true, '需实证旧CJS包装不能更新ESM命名绑定')
    for (const size of [64, 256, 1024]) for (const variant of ['png', 'jpeg', 'webp', 'png-adam7', 'png-16bit']) {
      const bytes = fixture(size, variant)
      const mime = variant.startsWith('png') ? 'image/png' : `image/${variant}`
      const file = path.join(desktop.root, `资源基线-${size}-${variant}.${mime.split('/')[1]}`)
      await writeFile(file, bytes)
      const item = { file, variant, width: size, height: size, encodedBytes: bytes.length, sha256: hash(bytes), pixels: size * size, rgba8PixelBytes: 4 * size * size }
      evidence.fixtures.push(item)
      for (const [label, operation, count] of [['unauthorized', 'preview', 1], ['selection', 'select', 1], ['single', 'preview', 1], ['concurrent', 'preview', 4]]) {
        if (operation === 'select') await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
        const phase = { fixture: evidence.fixtures.length - 1, label, operation, count, encodedInputBytesPerRequest: bytes.length, encodedInputWorkBytes: bytes.length * count,
          requestedPixelWork: size * size * count, rgba8PixelBytesPerImage: item.rgba8PixelBytes }
        evidence.phases.push(phase)
        await desktop.application.evaluate((_, label) => new Promise((resolve, reject) => setImmediate(() => {
          try { globalThis.__mediaResourceBaseline.begin(label); resolve() }
          catch (error) { reject(error) }
        })), `${size}-${variant}-${label}`)
        let response
        try { response = await requestBatch(desktop.page, operation, file, count) }
        finally {
          phase.main = await desktop.application.evaluate(() => new Promise((resolve, reject) => setImmediate(() => {
            try { resolve(globalThis.__mediaResourceBaseline.end()) } catch (error) { reject(error) }
          })))
          if (response) {
            phase.rendererElapsedMs = response.elapsedMs
            // 不保存dataURL，避免观测记录长期持有图片字节/放大测量内存。
            phase.requests = response.requests.map(({ result, ...request }) => ({ ...request, success: result?.success, path: result?.path ?? result?.data?.path,
              message: result?.message ?? result?.error, dataUrlCharacters: result?.data?.dataUrl?.length ?? 0 }))
          }
          await save()
        }
        assert.equal(phase.main.activeEnd, 0, '业务结算后观察到的解码必须结算')
        for (const request of response.requests) {
          assert.equal(request.status, 'fulfilled')
          if (label === 'unauthorized') {
            assert.equal(request.result.success, false)
            assert.equal(request.result.data?.dataUrl, undefined)
          } else if (operation === 'select') {
            assert.equal(request.result.success, true)
            assert.equal(request.result.path, file)
          } else {
            assert.equal(request.result.success, true)
            assert.equal(request.result.data.path, file)
            assert.ok(request.result.data.dataUrl.startsWith(`data:${mime};base64,`))
            assert.equal(hash(Buffer.from(request.result.data.dataUrl.split(',')[1], 'base64')), item.sha256)
          }
        }
        // 每个全新文件的首次真实选择验证观察覆盖；不要求重复次数或并发峰值等于4。
        if (label === 'selection') {
          assert.ok(phase.main.observedSourceSets > 0 && phase.main.observedDecodeCalls > 0, '首次选择未覆盖真实Image边界，计数无效')
        }
        for (const source of phase.main.sourceSets) {
          assert.equal(source.sha256, item.sha256, '原生src必须对应本阶段真实文件字节')
          assert.equal(source.encodedBytes, bytes.length)
          assert.equal(source.outcome, 'returned')
          assert.ok(phase.main.calls.some(call => call.sourceId === source.id), '成功业务中的src必须被decode观察关联')
        }
        for (const call of phase.main.calls) {
          assert.ok(phase.main.sourceSets.some(source => source.id === call.sourceId), 'decode必须关联本阶段真实src')
          assert.equal(call.outcome, 'resolved')
        }
        phase.callObservation = phase.main.observedSourceSets > 0
          ? '捕获真实src及其decode关联；分别报告设置次数与decode Promise活动峰值，不代表原生线程数'
          : '未捕获src；不据此宣称缓存、零解码或线程串行'
        await save()
      }
    }
    assert.equal(evidence.fixtures.length, 15)
    assert.equal(evidence.phases.length, 60)
    assert.equal(evidence.phases.reduce((sum, phase) => sum + phase.count, 0), 105)
    assert.deepEqual(desktop.errors, [])
  } catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack } }
  finally {
    if (installed) {
      try {
        evidence.observer = await desktop.application.evaluate(() => new Promise((resolve, reject) => setImmediate(() => {
          try { resolve(globalThis.__mediaResourceBaseline.cleanup()); delete globalThis.__mediaResourceBaseline }
          catch (error) { reject(error) }
        })))
        assert.deepEqual(evidence.observer.observerErrors, [])
        assert.equal(evidence.observer.active, 0)
        if (!failure) {
          assert.equal(evidence.observer.dialogs.length, 15)
          for (const [index, dialog] of evidence.observer.dialogs.entries()) {
            assert.equal(dialog.ownerId, evidence.environment.ownerId)
            assert.equal(dialog.result.canceled, false)
            assert.deepEqual(dialog.result.filePaths, [evidence.fixtures[index].file])
          }
        }
        evidence.counterValidity = evidence.observer.total > 0 && evidence.observer.sourceSets.length > 0
          ? '捕获Image.src及decode；逐图首次选择另做覆盖断言，指标不等于loadImage全程或原生线程并行'
          : 'Image边界未捕获，测量无效；不得将业务成功当计数成功'
        assert.ok(evidence.observer.total > 0 && evidence.observer.sourceSets.length > 0, '观察覆盖无效')
      } catch (error) { failure ||= error; evidence.observerCleanupFailure = error.message }
    }
    try { await desktop.close() }
    catch (error) {
      failure ||= error; evidence.closeFailure = error.message
      try { await desktop.application.close() } catch (closeError) { evidence.fallbackCloseFailure = closeError.message }
    }
    if (child.exitCode !== null || child.signalCode !== null) evidence.exit = await exited
    else { evidence.exit = { code: child.exitCode, signal: child.signalCode }; failure ||= new Error('关闭后进程仍未退出') }
    try { assert.deepEqual(evidence.exit, { code: 0, signal: null }) }
    catch (error) { failure ||= error; evidence.exitFailure = error.message }
    evidence.passed = !failure
    await save()
    console.log(`媒体资源before证据：${desktop.root}`)
  }
  if (failure) throw failure
})
