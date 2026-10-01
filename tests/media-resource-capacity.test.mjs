/** 1项测量测试：10张2048²图，每张独立强制bootstrap桌面，3次串行业务调用。
 * 失败或观测停止线触发后不再启动下一阶段/样本；不kill、不GC、不降低产品上限。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { capacitySamples, capacitySize, capacitySeed, capacityFixture } from './helpers/media-capacity-fixtures.mjs'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { installMediaResourceObserver } from './helpers/media-resource-observer.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
// 测量安全停止线，不是性能通过标准或应用RSS硬限；只在当前真实请求收尾后生效。
const stopPolicy = { absoluteRss: 1024 * 1024 * 1024, phaseRssGrowth: 512 * 1024 * 1024, phaseElapsedMs: 30000 }
function stopReason(phase) {
  const peak = Math.max(phase.before.rss, phase.after.rss, phase.sampledMax.rss || 0)
  if (peak >= stopPolicy.absoluteRss) return '已观察主进程RSS达到1GiB停止线'
  if (peak - phase.before.rss >= stopPolicy.phaseRssGrowth) return '已观察单请求RSS增长达到512MiB停止线'
  if (phase.elapsedMs >= stopPolicy.phaseElapsedMs) return '已完成请求耗时达到30秒停止线'
  return null
}
function sourceIntervals(main) {
  return main.sourceSets.map(source => {
    const call = main.calls.find(call => call.sourceId === source.id)
    return { sourceId: source.id, startMs: source.startMs, endMs: call ? call.startMs + call.elapsedMs : null }
  })
}
async function observerAction(desktop, action, label) {
  return desktop.application.evaluate((_, { action, label }) => new Promise((resolve, reject) => setImmediate(() => {
    try {
      const state = globalThis.__mediaResourceBaseline
      const result = action === 'begin' ? state.begin(label) : action === 'end' ? state.end() : state.cleanup()
      if (action === 'cleanup') delete globalThis.__mediaResourceBaseline
      resolve(result)
    } catch (error) { reject(error) }
  })), { action, label })
}
async function request(page, operation, file) {
  return page.evaluate(async ({ operation, file }) => {
    const start = performance.now()
    const result = operation === 'select' ? await window.fileSystem.selectFile({}) : await window.hdToolkit.getImagePreview(file)
    const ipcElapsedMs = performance.now() - start
    let dimensions
    if (result.data?.dataUrl) {
      const image = new Image()
      image.src = result.data.dataUrl
      await image.decode()
      dimensions = { width: image.naturalWidth, height: image.naturalHeight }
      image.src = ''
    }
    return { result, ipcElapsedMs, elapsedIncludingRendererDecodeMs: performance.now() - start, dimensions }
  }, { operation, file })
}
async function measureSample(sample, index, report) {
  const item = { index, ...sample, phases: [], passed: false }
  report.samples.push(item)
  let desktop, child, exited, installed = false, failure
  const save = async () => {
    await writeFile(path.join(report.root, 'media-resource-capacity.json'), JSON.stringify(report, null, 2))
    if (desktop) await writeFile(path.join(desktop.root, 'media-resource-capacity-sample.json'), JSON.stringify(item, null, 2))
  }
  try {
    // 固定尺寸夹具在测试进程生成；不计入被测Electron主进程内存。
    let bytes = await capacityFixture(sample)
    item.fixture = { width: capacitySize, height: capacitySize, pixels: capacitySize ** 2, rgba8PixelBytes: 4 * capacitySize ** 2,
      generatorNode: process.versions.node, generatorZlib: process.versions.zlib,
      encoder: sample.variant.startsWith('png-') ? 'node:zlib level=6; RGBA filter=None' : '@napi-rs/canvas locked dependency defaults',
      seed: capacitySeed, encodedBytes: bytes.length, sha256: hash(bytes), depth: sample.variant === 'png-16bit' ? 16 : 8 }
    desktop = await launchDesktop()
    item.desktopRoot = desktop.root
    child = desktop.application.process()
    exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
    const mime = sample.variant.startsWith('png') ? 'image/png' : `image/${sample.variant}`
    const file = path.join(desktop.root, `capacity-${sample.variant}-${sample.pattern}.${mime.split('/')[1]}`)
    await writeFile(file, bytes); bytes = null
    item.file = file
    item.environment = await desktop.application.evaluate(installMediaResourceObserver, repository)
    installed = true
    assert.equal(item.environment.version, '1.0.5')
    assert.equal(item.environment.esmSnapshotVerified, true)
    if (item.environment.memory.rss >= stopPolicy.absoluteRss) throw new Error('请求开始前RSS已达停止线，未执行业务')
    for (const [label, operation] of [['unauthorized', 'preview'], ['selection', 'select'], ['authorized-preview', 'preview']]) {
      const phase = { label, operation, encodedInputBytes: item.fixture.encodedBytes, inputSha256: item.fixture.sha256,
        requestedPixels: item.fixture.pixels, rgba8PixelBytes: item.fixture.rgba8PixelBytes }
      item.phases.push(phase)
      if (operation === 'select') await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
      await observerAction(desktop, 'begin', `${index}-${label}`)
      let response
      try {
        report.startedBusinessCalls++
        response = await request(desktop.page, operation, file)
        report.completedBusinessCalls++
      } finally {
        phase.main = await observerAction(desktop, 'end') // 清除10ms采样timer，即使IPC失败。
        if (response) phase.response = { success: response.result.success, path: response.result.path ?? response.result.data?.path,
          message: response.result.message ?? response.result.error, dataUrlCharacters: response.result.data?.dataUrl?.length || 0,
          ipcElapsedMs: response.ipcElapsedMs, elapsedIncludingRendererDecodeMs: response.elapsedIncludingRendererDecodeMs, dimensions: response.dimensions }
        await save()
      }
      phase.stopReason = stopReason(phase.main)
      assert.equal(phase.main.activeEnd, 0)
      if (label === 'unauthorized') {
        assert.equal(response.result.success, false)
        assert.equal(response.result.data?.dataUrl, undefined)
      } else {
        assert.equal(response.result.success, true)
        assert.equal(response.result.path ?? response.result.data?.path, file)
        assert.ok(phase.main.observedSourceSets > 0 && phase.main.observedDecodeCalls > 0, '真实Image观察必须非空')
        if (operation === 'preview') {
          assert.ok(response.result.data.dataUrl.startsWith(`data:${mime};base64,`))
          assert.equal(hash(Buffer.from(response.result.data.dataUrl.split(',')[1], 'base64')), item.fixture.sha256)
          assert.deepEqual(response.dimensions, { width: capacitySize, height: capacitySize })
        }
      }
      for (const source of phase.main.sourceSets) {
        assert.equal(source.sha256, item.fixture.sha256); assert.equal(source.encodedBytes, item.fixture.encodedBytes)
        assert.equal(source.outcome, 'returned')
        assert.ok(phase.main.calls.some(call => call.sourceId === source.id && call.outcome === 'resolved'))
      }
      for (const call of phase.main.calls) {
        assert.equal(call.outcome, 'resolved')
        assert.ok(phase.main.sourceSets.some(source => source.id === call.sourceId))
      }
      phase.sourceToDecodeIntervals = sourceIntervals(phase.main)
      response = null // 证据不持有dataURL；不假设GC已发生。
      await save()
      if (phase.stopReason) throw new Error(`${phase.stopReason}；停止剩余阶段/样本，非产品硬预算判定`)
    }
    assert.deepEqual(desktop.errors, [])
  } catch (error) {
    failure = error; item.failure = { message: error.message, stack: error.stack }
  } finally {
    if (installed) {
      try {
        item.observer = await observerAction(desktop, 'cleanup')
        assert.deepEqual(item.observer.observerErrors, [])
        assert.equal(item.observer.active, 0)
        if (!failure) {
          assert.equal(item.observer.dialogs.length, 1)
          const dialog = item.observer.dialogs[0]
          assert.equal(dialog.ownerId, item.environment.ownerId)
          assert.equal(dialog.result.canceled, false)
          assert.deepEqual(dialog.result.filePaths, [item.file])
        }
      } catch (error) { failure ||= error; item.cleanupFailure = error.message }
    }
    if (desktop) {
      try { await desktop.close() }
      catch (error) {
        failure ||= error; item.closeFailure = error.message
        // 沿既有关闭接口收尾，不主动kill，也不把此分支称自然退出成功。
        try { await desktop.application.close() } catch (closing) { item.fallbackCloseFailure = closing.message }
      }
      item.exit = child.exitCode !== null || child.signalCode !== null ? await exited : { code: child.exitCode, signal: child.signalCode }
      try { assert.deepEqual(item.exit, { code: 0, signal: null }) }
      catch (error) { failure ||= error; item.exitFailure = error.message }
    }
    item.passed = !failure
    await save()
  }
  if (failure) throw failure
}

test('媒体容量测量：2048²五格式两类内容，每样本独立桌面串行', { timeout: 600000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-capacity-report-'))
  const report = { root, passed: false, plannedSamples: capacitySamples, plannedBusinessCalls: 30, startedBusinessCalls: 0, completedBusinessCalls: 0,
    maximumConcurrentRequests: 1, stopPolicy, samples: [],
    interpretation: '仅2048²（RGBA8像素16MiB下界）观测，不能外推5.3亿像素候选上限。测试进程生成编码与Electron主进程测量分离；不采集renderer/GPU总内存。透明src/decode观察包含额外整文件hash开销；10ms采样最多保留256条/阶段，仍可能漏峰。src到decode结束区间不是原生线程或确定释放。IPC字符串和原生GC无硬预算承诺。' }
  try {
    for (const [index, sample] of capacitySamples.entries()) await measureSample(sample, index, report)
    assert.equal(report.samples.length, 10)
    assert.equal(report.completedBusinessCalls, 30)
    report.passed = true
  } catch (error) {
    report.stopReason = error.message
    report.unfinishedSamples = capacitySamples.filter((_, index) => !report.samples[index]?.passed)
    throw error
  } finally {
    await writeFile(path.join(root, 'media-resource-capacity.json'), JSON.stringify(report, null, 2))
    console.log(`2048容量测量证据：${root}`)
  }
})
