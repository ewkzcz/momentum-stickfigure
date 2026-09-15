/** 有界排队：小输入突发也不能无限保留任务；拒绝后可正常解析。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'

test('PSD队列预算：拒绝超量请求，取消释放额度且正常任务恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`PSD预算证据：${desktop.root}`)
  try {
    const fixture = (await syntheticFixtures())[0]
    const bytes = [...await readFile(fixture.absolutePath)]
    const result = await desktop.application.evaluate(async (_, { bytes, url }) => {
      const vm = process.getBuiltinModule('vm')
      const load = vm.compileFunction('return import(url)', ['url'], { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
      const { parsePSDInWorker } = await load(url)
      const controllers = Array.from({ length: 10 }, () => new globalThis.AbortController())
      const tasks = controllers.map(controller => parsePSDInWorker(new Uint8Array(bytes), { parseImages: true }, 30000, controller.signal))
      const settled = Promise.allSettled(tasks)
      controllers.forEach(controller => controller.abort())
      const responses = await settled
      const large = new Uint8Array(50 * 1024 * 1024)
      const byteControllers = Array.from({ length: 6 }, () => new globalThis.AbortController())
      const byteTasks = byteControllers.map((controller, index) => parsePSDInWorker(index === 0 ? new Uint8Array(bytes) : large, {}, 30000, controller.signal))
      const byteSettled = Promise.allSettled(byteTasks)
      byteControllers.forEach(controller => controller.abort())
      const byteResponses = await byteSettled
      const invalid = await Promise.allSettled([parsePSDInWorker('not bytes'), parsePSDInWorker(new Uint8Array(50 * 1024 * 1024 + 1))])
      const recovered = await parsePSDInWorker(new Uint8Array(bytes), { parseImages: true })
      return { errors: responses.map(response => ({ name: response.reason?.name, message: response.reason?.message })), byteErrors: byteResponses.map(response => response.reason?.name), invalid: invalid.map(response => response.reason?.name), layers: recovered.layerCount }
    }, { bytes, url: pathToFileURL(path.join(repository, 'out/main/psd-worker-queue.mjs')).href })
    assert.equal(result.errors.filter(error => error.name === 'ResourceLimitError').length, 1, '单活动加八个等待任务后，第十个请求必须明确拒绝')
    assert.equal(result.errors.filter(error => error.name === 'AbortError').length, 9)
    assert.equal(result.byteErrors.filter(name => name === 'ResourceLimitError').length, 1)
    assert.equal(result.byteErrors.filter(name => name === 'AbortError').length, 5)
    assert.deepEqual(result.invalid, ['TypeError', 'ResourceLimitError'])
    assert.ok(result.layers > 0)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
