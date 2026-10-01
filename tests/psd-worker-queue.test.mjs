/** PSD队列回归：真实Electron与原隔离辅助，验证先入先出、取消、超时及错误恢复。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { verifyFixture } from './helpers/images.mjs'

/**
 * 在真实Electron中执行单活动队列生命周期。
 * 处理流程：
 * 1、调用构建产物，不替换Worker或解析引擎。
 * 2、交错取消等待项和活动项，再验证错误、超时及关闭后拒绝。
 */
test('PSD工作线程队列：20轮取消与恢复、真实超时及关闭屏障', { timeout: 120000 }, async () => {
  const desktop = await launchDesktop()
  const evidence = { passed: false }
  console.log(`PSD队列回归证据：${desktop.root}`)
  try {
    // 1、仅使用固定公开PSD，调用方字节不得被分离。
    const fixture = (await syntheticFixtures())[0]
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    const bytes = [...await readFile(fixture.absolutePath)]
    evidence.result = await desktop.application.evaluate(async (_, { bytes, moduleUrl }) => {
      const vm = process.getBuiltinModule('vm')
      const load = vm.compileFunction('return import(url)', ['url'], { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
      const { parsePSDInWorker, stopPSDWorkers } = await load(moduleUrl)
      const rounds = []
      for (let round = 0; round < 20; round++) {
        const buffer = new Uint8Array(bytes)
        const running = new globalThis.AbortController()
        const waiting = new globalThis.AbortController()
        const first = parsePSDInWorker(buffer, { parseImages: true }, 30000, running.signal)
        const second = parsePSDInWorker(buffer, { parseImages: true }, 30000, waiting.signal)
        const third = parsePSDInWorker(buffer, { parseImages: true }, 30000)
        const all = Promise.allSettled([first, second, third])
        waiting.abort()
        running.abort()
        const values = await all
        rounds.push({ statuses: values.map(value => value.status), errors: values.slice(0, 2).map(value => value.reason?.name), layers: values[2].value?.layerCount, inputLength: buffer.byteLength })
      }
      // 2、1ms包含线程启动，验证超时拒绝及随后同输入可用，不冒称已进入原生解析内部。
      const timed = await Promise.allSettled([parsePSDInWorker(new Uint8Array(bytes), {}, 1)])
      const corrupt = await Promise.allSettled([parsePSDInWorker(new Uint8Array([1, 2, 3, 4]), {}, 30000)])
      const recovery = await parsePSDInWorker(new Uint8Array(bytes), { parseImages: true }, 30000)
      const active = parsePSDInWorker(new Uint8Array(bytes), {}, 30000)
      const pending = parsePSDInWorker(new Uint8Array(bytes), {}, 30000)
      const closing = Promise.allSettled([active, pending])
      await stopPSDWorkers()
      const closed = await closing
      const rejected = await Promise.allSettled([parsePSDInWorker(new Uint8Array(bytes))])
      return { rounds, timed: timed[0].reason?.message, corrupt: corrupt[0].status, layers: recovery.layerCount, closed: closed.map(value => value.reason?.name), rejected: rejected[0].reason?.name }
    }, { bytes, moduleUrl: pathToFileURL(path.join(repository, 'out/main/psd-worker-queue.mjs')).href })
    for (const round of evidence.result.rounds) {
      assert.deepEqual(round.statuses, ['rejected', 'rejected', 'fulfilled'])
      assert.deepEqual(round.errors, ['AbortError', 'AbortError'])
      assert.ok(round.layers > 0)
      assert.equal(round.inputLength, bytes.length)
    }
    assert.equal(evidence.result.timed, '操作超时')
    assert.equal(evidence.result.corrupt, 'rejected')
    assert.ok(evidence.result.layers > 0)
    assert.deepEqual(evidence.result.closed, ['AbortError', 'AbortError'])
    assert.equal(evidence.result.rejected, 'AbortError')
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } finally {
    // 3、无论断言结果如何，都保留原后台、写入及退出隔离检查。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'psd-worker-queue-result.json'), JSON.stringify(evidence, null, 2)) }
  }
})
