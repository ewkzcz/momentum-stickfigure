/** 读取前准入before：五个真实selectFile，首个真实decode结果受控延后。
 * 1项测试；不依赖未来模块，不直接grant，不修改现有保护；仅5张8×6图。
 * 仅覆盖inspectFile的同步Buffer.alloc/readSync路径与同一窗口的选择请求。
 * selectFile没有排队取消接口；owner销毁需独立多窗口可信入口夹具，留待后续。
 * 未覆盖粘贴base64前置分配、批量字节生命周期、HD嵌套、原生运行取消或RSS硬界。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { installAdmissionControl } from './helpers/media-admission-control.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

// 仅为测试失败提供退出路径；不以定时器判断产品已进入阶段，也不取消真实业务。
async function watchdog(operation, label) {
  let timer
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label}未在10秒内完成`)), 10000)
    })])
  } finally { clearTimeout(timer) }
}

test('媒体准入：1活动3等待时读取前排队，第五项明确繁忙且无新授权', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const child = desktop.application.process()
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const evidence = { passed: false, scope: '真实生产selectFile与预览IPC；bootstrap原生选择替身；首个真实decode结算值延后交付，不代表原生任务可取消或实际线程阻塞', fixtures: [] }
  let failure, installed = false, started = false
  try {
    for (let i = 0; i < 5; i++) {
      const canvas = createCanvas(8, 6)
      canvas.getContext('2d').fillStyle = `rgb(${20 + i * 30},70,120)`
      canvas.getContext('2d').fillRect(0, 0, 8, 6)
      const bytes = canvas.toBuffer('image/png'), file = path.join(desktop.root, `准入-${i}.png`)
      await writeFile(file, bytes)
      evidence.fixtures.push({ file, bytes: bytes.length, sha256: hash(bytes) })
    }
    evidence.initialPreviews = []
    for (const item of evidence.fixtures) {
      const result = await desktop.page.evaluate(file => window.hdToolkit.getImagePreview(file), item.file)
      evidence.initialPreviews.push({ success: result.success, hasDataUrl: !!result.data?.dataUrl })
      assert.equal(result.success, false, '可信选择之前必须没有媒体授权')
      assert.equal(!!result.data?.dataUrl, false)
    }
    evidence.installed = await desktop.application.evaluate(installAdmissionControl, {
      repository, files: evidence.fixtures.map(item => item.file), sizes: evidence.fixtures.map(item => item.bytes),
      hashes: evidence.fixtures.map(item => item.sha256)
    })
    installed = true
    assert.equal(evidence.installed.version, '1.0.5')
    started = true
    await desktop.page.evaluate(() => {
      const state = { results: [], pending: [] }
      state.start = () => {
        const index = state.pending.length
        state.pending.push(window.fileSystem.selectFile({}).then(result => {
          state.results[index] = { status: 'fulfilled', result }
        }, error => { state.results[index] = { status: 'rejected', error: String(error) } }))
      }
      window.__mediaAdmissionRequests = state
      state.start()
    })
    // 以真实decode原Promise已结算为控制信号，不sleep猜测是否进入活动阶段。
    await watchdog(desktop.application.evaluate(() => globalThis.__mediaAdmissionControl.held), '首项真实decode完成信号')
    assert.equal(await desktop.page.evaluate(() => window.__mediaAdmissionRequests.results[0] === undefined), true)
    await desktop.page.evaluate(() => { for (let i = 0; i < 4; i++) window.__mediaAdmissionRequests.start() })
    // 正确实现须在首项未放行时回复第五项繁忙。超时是该产品契约失败，不是放行条件。
    await desktop.page.waitForFunction(() => window.__mediaAdmissionRequests.results[4] !== undefined, undefined, { timeout: 10000 })
    evidence.beforeRelease = await desktop.application.evaluate(() => new Promise(resolve => setImmediate(() => resolve(globalThis.__mediaAdmissionControl.snapshot()))))
    evidence.resultsBeforeRelease = await desktop.page.evaluate(() => Array.from({ length: 5 }, (_, i) => window.__mediaAdmissionRequests.results[i] ?? null))
  } catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack } }
  finally {
    // 必须先放行，再等待所有已提交业务完成，最后恢复包装；断言失败也走此路径。
    if (installed) {
      try {
        const snapshot = await desktop.application.evaluate(() => new Promise(resolve => setImmediate(() => resolve(globalThis.__mediaAdmissionControl.snapshot()))))
        evidence.beforeRelease ??= snapshot
        await desktop.application.evaluate(() => new Promise(resolve => setImmediate(() => { globalThis.__mediaAdmissionControl.release(); resolve() })))
      } catch (error) {
        failure ||= error; evidence.releaseFailure = error.message
        try { await desktop.application.evaluate(() => { globalThis.__mediaAdmissionControl?.release() }) }
        catch (releaseError) { evidence.fallbackReleaseFailure = releaseError.message }
      }
    }
    if (started) {
      try {
        evidence.results = await watchdog(desktop.page.evaluate(async () => {
          await Promise.all(window.__mediaAdmissionRequests.pending)
          return window.__mediaAdmissionRequests.results
        }), '放行后业务收尾')
      } catch (error) { failure ||= error; evidence.drainFailure = error.message }
    }
    if (installed) {
      try {
        evidence.control = await desktop.application.evaluate(() => new Promise((resolve, reject) => setImmediate(() => {
          try { resolve(globalThis.__mediaAdmissionControl.restore()) }
          catch (error) { reject(error) }
          finally { delete globalThis.__mediaAdmissionControl }
        })))
        assert.deepEqual(evidence.control.restoreErrors, [])
        assert.deepEqual(evidence.control.trackedOpenFiles, [])
      } catch (error) { failure ||= error; evidence.restoreFailure = error.message }
    }
    if (!failure) {
      try {
        const previewResults = []
        for (const item of evidence.fixtures) {
          const result = await desktop.page.evaluate(file => window.hdToolkit.getImagePreview(file), item.file)
          previewResults.push({ success: result.success, hasDataUrl: !!result.data?.dataUrl, sha256: result.data?.dataUrl ? hash(Buffer.from(result.data.dataUrl.split(',')[1], 'base64')) : null })
        }
        evidence.previews = previewResults
        assert.equal(evidence.results.length, 5)
        for (let i = 0; i < 4; i++) {
          assert.equal(evidence.results[i].status, 'fulfilled')
          assert.equal(evidence.results[i].result.success, true, '放行后合法请求必须仍完成')
          assert.equal(evidence.results[i].result.path, evidence.fixtures[i].file)
          assert.equal(previewResults[i].success, true)
          assert.equal(previewResults[i].sha256, evidence.fixtures[i].sha256)
        }
        assert.equal(evidence.control.dialogs.length, 5)
        for (const [i, dialog] of evidence.control.dialogs.entries()) {
          assert.equal(dialog.ownerId, evidence.control.ownerId)
          assert.equal(dialog.result.canceled, false)
          assert.deepEqual(dialog.result.filePaths, [evidence.fixtures[i].file])
        }
        assert.equal(evidence.beforeRelease.released, false)
        assert.equal(evidence.beforeRelease.originalSettled, true)
        assert.equal(evidence.beforeRelease.originalOutcome, 'fulfilled')
        assert.deepEqual(evidence.beforeRelease.heldSource, { bytes: evidence.fixtures[0].bytes, sha256: evidence.fixtures[0].sha256 })
        assert.equal(evidence.resultsBeforeRelease[0], null)
        assert.ok(evidence.beforeRelease.events.some(event => event.file === evidence.fixtures[0].file && event.kind === 'whole-buffer' && event.bytes === evidence.fixtures[0].bytes), '观察必须捕获首项真实整文件分配')
        assert.ok(evidence.beforeRelease.events.some(event => event.file === evidence.fixtures[0].file && event.kind === 'read' && event.bytes > 0), '观察必须捕获首项真实读取，不能以空记录误通过')
        const fifth = evidence.resultsBeforeRelease[4]
        const queuedFiles = evidence.fixtures.slice(1).map(item => item.file)
        evidence.taskDirectories = (await readdir(path.join(desktop.root, 'temp'))).filter(name => name.startsWith('momentum-hd-') || name === 'momentum-stickfigure-paste')
        evidence.verdict = {
          waitingRequestsUnsettled: evidence.resultsBeforeRelease.slice(1, 4).every(result => result === null),
          noWaitingWholeReadOrAllocation: !evidence.beforeRelease.events.some(event => queuedFiles.includes(event.file) && (event.kind === 'whole-buffer' || (event.kind === 'read' && event.bytes > 0))),
          fifthExplicitlyBusy: fifth?.status === 'fulfilled' && fifth.result.success === false && /繁忙|忙碌|busy|队列.*满|queue.*full/i.test(fifth.result.error ?? fifth.result.message ?? ''),
          fifthHasNoMediaAuthorization: previewResults[4].success === false && !previewResults[4].hasDataUrl,
          noHdTaskSideEffects: evidence.taskDirectories.length === 0 && evidence.control.artifactOperations.length === 0
        }
        // 断言产品政策而非未来导出；并列记录所有缺口，当前源码预期前四项失败。
        assert.deepEqual(evidence.verdict, { waitingRequestsUnsettled: true, noWaitingWholeReadOrAllocation: true,
          fifthExplicitlyBusy: true, fifthHasNoMediaAuthorization: true, noHdTaskSideEffects: true })
      } catch (error) { failure ||= error; evidence.assertionFailure = { message: error.message, stack: error.stack } }
    }
    try { assert.deepEqual(desktop.errors, []) }
    catch (error) { failure ||= error; evidence.rendererFailure = error.message }
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
    await writeFile(path.join(desktop.root, 'media-resource-admission.json'), JSON.stringify(evidence, null, 2))
    console.log(`媒体准入before证据：${desktop.root}`)
  }
  if (failure) throw failure
})
