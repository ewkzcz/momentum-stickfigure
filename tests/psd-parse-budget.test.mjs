/** 使用小体积、超多空图层PSD验证真实解析资源拒绝，不分配巨幅图像。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { writePsdBuffer, initializeCanvas } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { preflightPsdResources, validatePsdMetadata, assertPsdOutputBudget, PSD_RESOURCE_LIMITS } from '../src/main/psd-api/psd-resource-budget.mjs'

initializeCanvas(createCanvas)
test('PSD预算边界：巨幅头部在解码前拒绝，输出累计有界', () => {
  const bytes = writePsdBuffer({ width: 1, height: 1 })
  const changed = Buffer.from(bytes)
  changed.writeUInt32BE(100000, 14)
  changed.writeUInt32BE(100000, 18)
  assert.throws(() => preflightPsdResources(changed, true), /文档像素超过限制/)
  const block = 'a'.repeat(1024 * 1024)
  assert.throws(() => assertPsdOutputBudget(Array(129).fill(block)), /解析输出超过限制/)
  assert.ok(assertPsdOutputBudget({ data: block }) < PSD_RESOURCE_LIMITS.outputBytes)
  assert.equal(preflightPsdResources(bytes, true).documentPixels, 1)
  const bigLayer = { left: 0, top: 0, right: 8192, bottom: 8192 }
  assert.throws(() => validatePsdMetadata({ width: 1, height: 1, children: [bigLayer, bigLayer] }, true), /累计图层像素超过限制/)
  assert.throws(() => validatePsdMetadata({ width: 1, height: 1, children: [{ ...bigLayer, mask: bigLayer }] }, true), /累计图层像素超过限制/)
  let nested = { children: [] }
  for (let depth = 0; depth < 129; depth++) nested = { children: [nested] }
  assert.throws(() => validatePsdMetadata({ width: 1, height: 1, children: [nested] }, false), /嵌套超过限制/)
  assert.equal(validatePsdMetadata({ width: 1, height: 1, children: [bigLayer, bigLayer] }, false).decodedPixels, 1)
})
test('PSD解析预算：超多图层明确拒绝，正常小文件继续解析', { timeout: 60000 }, async () => {
  const excessive = writePsdBuffer({ width: 1, height: 1, children: Array.from({ length: 8193 }, (_, index) => ({ name: `layer-${index}` })) })
  const normal = writePsdBuffer({ width: 1, height: 1, children: [{ name: 'normal' }] })
  const desktop = await launchDesktop()
  console.log(`PSD解析预算证据：${desktop.root}`)
  try {
    const result = await desktop.application.evaluate(async (_, { excessive, normal, url }) => {
      const vm = process.getBuiltinModule('vm')
      const load = vm.compileFunction('return import(url)', ['url'], { importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })
      const { parsePSDInWorker } = await load(url)
      const [large] = await Promise.allSettled([parsePSDInWorker(new Uint8Array(excessive), { parseImages: false })])
      const recovered = await parsePSDInWorker(new Uint8Array(normal), { parseImages: true })
      return { status: large.status, error: large.reason?.message, layers: recovered.layerCount }
    }, { excessive: [...excessive], normal: [...normal], url: pathToFileURL(path.join(repository, 'out/main/psd-worker-queue.mjs')).href })
    assert.equal(result.status, 'rejected', '超过8192图层必须在图像解码前拒绝')
    assert.match(result.error, /图层.*限制/)
    assert.equal(result.layers, 1)
  } finally { await desktop.close() }
})
