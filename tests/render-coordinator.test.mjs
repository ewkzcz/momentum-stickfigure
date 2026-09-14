import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, shallowRef, effectScope } from 'vue'
import { createCanvas } from '@napi-rs/canvas'
import { createCanvasRenderCoordinator, bindCanvasRenderSession } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasRenderCoordinator.js'

function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const canvasRef = shallowRef(createCanvas(2, 1)), isRendering = ref(false)
  const coordinator = createCanvasRenderCoordinator({ canvasRef, isRendering })
  return { canvasRef, isRendering, coordinator }
}

test('旧看门狗已清理，十秒超时只结束所属请求且可以恢复', async t => {
  const { coordinator: c, isRendering } = setup(t)
  const first = c.begin()
  t.mock.timers.tick(9000)
  const second = c.begin()
  assert.equal((await first.done).status, 'stale')
  t.mock.timers.tick(1000)
  assert.equal(isRendering.value, true)
  assert.equal(c.isCurrent(second), true)
  t.mock.timers.tick(9000)
  assert.equal((await second.done).status, 'timeout')
  assert.equal(isRendering.value, false)
  assert.equal(c.isCurrent(second), false)
  const third = c.begin()
  assert.equal(isRendering.value, true)
  c.finish(first, 'completed')
  assert.equal(isRendering.value, true)
  c.finish(third, 'failed')
  assert.equal((await third.done).status, 'failed')
})

test('尺寸变化、画布替换和会话失效均阻止旧提交', async t => {
  const { coordinator: c, canvasRef } = setup(t)
  for (const invalidate of [() => { canvasRef.value.width++ }, () => { canvasRef.value = createCanvas(2, 1) }, () => c.invalidate()]) {
    const request = c.begin(), buffer = createCanvas(2, 1)
    buffer.getContext('2d').fillRect(0, 0, 2, 1)
    invalidate()
    assert.equal(c.commit(request, buffer), false)
    assert.equal((await request.done).status, 'stale')
    assert.equal(canvasRef.value.getContext('2d').getImageData(0, 0, 1, 1).data[3], 0)
  }
})

test('会话同步绑定覆盖 A→B→A、清空、尺寸与真实作用域销毁', async t => {
  const { coordinator: c, canvasRef, isRendering } = setup(t)
  const firstPsd = {}, currentPsdData = shallowRef(firstPsd), currentPsdFile = shallowRef({ id: 'A' })
  const canvasWidth = ref(2), canvasHeight = ref(1), scope = effectScope()
  scope.run(() => bindCanvasRenderSession(c, { currentPsdData, currentPsdFile, canvasRef, canvasWidth, canvasHeight }))
  const first = c.begin(), generation = c.generation
  currentPsdData.value = {}
  currentPsdData.value = firstPsd
  assert.equal(c.generation, generation + 2)
  assert.equal((await first.done).status, 'stale')
  for (const action of [() => { currentPsdData.value = null }, () => { canvasWidth.value++ }, () => scope.stop()]) {
    const request = c.begin()
    action()
    assert.equal((await request.done).status, 'stale')
    assert.equal(isRendering.value, false)
  }
})

test('完成屏障跟随新请求，成功提交只结算一次', async t => {
  const { coordinator: c } = setup(t)
  const first = c.begin(), waiting = c.waitForCurrent()
  const second = c.begin()
  const buffer = createCanvas(2, 1)
  assert.equal(c.commit(second, buffer), true)
  assert.equal(c.commit(first, buffer), false)
  assert.deepEqual(await waiting, { status: 'committed', sequence: second.sequence })
  c.finish(second, 'failed')
  assert.equal((await second.done).status, 'committed')
})
