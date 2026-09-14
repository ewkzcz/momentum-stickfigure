import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { setup, flush, modules } from './helpers/render-race-fixture.mjs'
import { effectScope, ref, shallowRef } from 'vue'

test('会话清空或 A→B→A 后真实图片迟到不能复活旧帧', async t => {
  const f = setup(t), scope = effectScope()
  const coordinator = modules.getCanvasRenderCoordinator?.(f.deps)
  if (modules.bindCanvasRenderSession) scope.run(() => modules.bindCanvasRenderSession(coordinator, { ...f.deps, currentPsdFile: shallowRef({ id: 'A' }), canvasWidth: ref(2), canvasHeight: ref(1) }))
  t.after(() => scope.stop())
  const work = f.start('part', '#ff0000')
  await flush()
  const oldPsd = f.deps.currentPsdData.value, image = f.images.at(-1)
  f.deps.currentPsdData.value = null
  f.deps.currentPsdData.value = oldPsd
  await image.release()
  await work
  assert.deepEqual(f.pixel(), [0, 0, 0, 0])
  assert.equal(f.deps.isRendering.value, false)
})

const pagePath = 'src/renderer/src/components/pages/ActionExpressionPage/ActionExpressionPage.vue'
const source = process.env.MOMENTUM_RACE_REVISION
  ? execFileSync('git', ['show', `${process.env.MOMENTUM_RACE_REVISION}:${pagePath}`], { encoding: 'utf8' })
  : await readFile(new URL(`../${pagePath}`, import.meta.url), 'utf8')
// 提取页面原始队列声明；不复制其业务实现。
const begin = source.includes('let renderAllLayersQueue =') ? source.indexOf('let renderAllLayersQueue =') : source.indexOf('const queueRenderAllLayers =')
const end = source.indexOf('// ====================', begin)
const queueSource = source.slice(begin, end)

test('页面真实队列在途三十次选择最终提交最后一次状态', async t => {
  const f = setup(t)
  const queue = new Function('renderAllLayers', `${queueSource}\nreturn queueRenderAllLayers`)(() => f.tree.renderByLayerTree())
  f.select('#ff0000')
  const first = queue()
  await flush()
  let last
  for (let index = 0; index < 30; index++) {
    f.select(index === 29 ? '#0000ff' : '#ff0000')
    last = queue()
    await flush()
  }
  for (const image of [...f.images].reverse()) await image.release()
  await Promise.all([first, last])
  assert.deepEqual(f.pixel(), [0, 0, 255, 255])
})
