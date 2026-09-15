import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { fixtures } from './helpers/reference.mjs'
import { verifyFixture } from './helpers/images.mjs'

const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
const summary = values => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: Math.max(...values) })

test('PSD分离测量：两素材各20轮，渲染进程内IPC计时与每轮RSS', { timeout: 180000 }, async () => {
  const desktop = await launchDesktop()
  const results = { platform: process.platform, arch: process.arch, fixtures: [] }
  try {
    for (const fixture of await fixtures()) {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      // 只传路径；磁盘加载和模块导入在测量前完成，不通过Inspector传巨大数字数组。
      const staging = await desktop.application.evaluate(async (_, input) => {
        const vm = process.getBuiltinModule('vm')
        const load = vm.compileFunction('return import(url)', ['url'], { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
        const start = performance.now()
        const { parsePSDInWorker } = await load(input.queueUrl)
        const bytes = process.getBuiltinModule('fs').readFileSync(input.file)
        globalThis.__psdMetric = { parsePSDInWorker, bytes }
        return { durationMs: performance.now() - start, bytes: bytes.byteLength }
      }, { file: fixture.absolutePath, queueUrl: pathToFileURL(path.join(repository, 'out/main/psd-worker-queue.mjs')).href })
      await desktop.page.evaluate(() => {
        const state = { running: true, samples: [], errors: [] }
        window.__ipcMetric = state
        state.done = (async () => {
          while (state.running) {
            const start = performance.now()
            const result = await window.electronAPI.storage.length()
            state.samples.push(performance.now() - start)
            if (!result.success) state.errors.push(result.error)
            // 帧调度控制采样频率，不使用固定sleep，也不淹没主进程事件队列。
            await new Promise(resolve => requestAnimationFrame(resolve))
          }
        })()
      })
      let metric, ipc
      try {
        metric = await desktop.application.evaluate(async () => {
          const { parsePSDInWorker, bytes } = globalThis.__psdMetric
          const samples = [], rss = [], peaks = [], cancel = []
          let currentPeak = process.memoryUsage().rss
          const timer = setInterval(() => { currentPeak = Math.max(currentPeak, process.memoryUsage().rss) }, 10)
          try {
            for (let i = 0; i < 20; i++) {
              currentPeak = process.memoryUsage().rss
              const start = performance.now()
              let result = await parsePSDInWorker(bytes, { parseImages: true })
              samples.push(performance.now() - start)
              if (!result) throw new Error('PSD结果为空')
              result = null
              const memory = process.memoryUsage().rss
              rss.push(memory)
              peaks.push(Math.max(memory, currentPeak))
            }
            for (let i = 0; i < 20; i++) {
              const controller = new globalThis.AbortController()
              const pending = parsePSDInWorker(bytes, { parseImages: true }, 30000, controller.signal)
              const start = performance.now()
              controller.abort()
              try { await pending; throw new Error('取消后错误成功') } catch (error) { if (error.name !== 'AbortError') throw error }
              cancel.push(performance.now() - start)
            }
            return { samples, rss, peaks, cancel }
          } finally { clearInterval(timer); delete globalThis.__psdMetric }
        })
      } finally {
        ipc = await desktop.page.evaluate(async () => {
          const state = window.__ipcMetric
          state.running = false
          await state.done
          delete window.__ipcMetric
          return { samples: state.samples, errors: state.errors }
        })
      }
      assert.deepEqual(ipc.errors, [])
      assert.ok(ipc.samples.length > 20)
      assert.equal(metric.samples.length, 20)
      const result = {
        id: fixture.id, staging, parse: summary(metric.samples), ipc: summary(ipc.samples), cancel: summary(metric.cancel),
        rssPeak: Math.max(...metric.peaks), rssFirst: metric.rss[0], rssLast: metric.rss.at(-1),
        rssLastFiveRange: Math.max(...metric.rss.slice(-5)) - Math.min(...metric.rss.slice(-5)),
        samples: metric, ipcSamples: ipc.samples
      }
      results.fixtures.push(result)
      console.log(JSON.stringify({ ...result, samples: undefined, ipcSamples: undefined }))
      assert.ok(result.ipc.p95 < 100, '沿用代表机器IPC p95低于100ms要求')
      assert.ok(result.cancel.max < 5000, '沿用启动取消5秒内要求')
      await verifyFixture(fixture.absolutePath, fixture.sha256)
    }
  } finally {
    await writeFile(path.join(repository, 'temp/psd-separated-measurement-result.json'), JSON.stringify(results, null, 2))
    await desktop.close()
  }
})
