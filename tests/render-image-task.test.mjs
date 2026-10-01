import test from 'node:test'
import assert from 'node:assert/strict'
import * as layers from '../src/renderer/src/components/pages/ActionExpressionPage/utils/layerRenderUtils.js'
import { loadRenderImage, bindRenderSignal, getRenderSignal } from '../src/renderer/src/components/pages/ActionExpressionPage/utils/renderImageTask.js'

const drain = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

function harness(t) {
  const originals = { Image: globalThis.Image, document: globalThis.document, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, error: console.error }
  const images = [], timers = new Map(), contexts = [], callbackErrors = []
  let clock = 0, nextId = 0
  globalThis.setTimeout = (fn, delay) => { const id = ++nextId; timers.set(id, { fn, at: clock + delay }); return id }
  globalThis.clearTimeout = id => timers.delete(id)
  globalThis.Image = class {
    width = 2
    height = 2
    constructor() { images.push(this) }
    set src(value) { this.source = value }
    async fire(kind = 'onload') {
      try { await this[kind]?.(new Error('controlled image error')) } catch (error) { callbackErrors.push(error) }
      await drain()
    }
  }
  function context() {
    const ctx = {
      canvas: { width: 2, height: 2 }, writes: [], depth: 0,
      globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() { this.depth++ }, restore() { this.depth-- },
      drawImage(...args) { this.writes.push(args); if (this.failDraw) throw new Error('controlled draw failure') },
      getImageData() { return { data: new Uint8ClampedArray([128, 128, 128, 255]) } },
      putImageData(...args) { this.writes.push(args) }, fillRect(...args) { this.writes.push(args) }
    }
    contexts.push(ctx)
    return ctx
  }
  globalThis.document = { createElement() { const ctx = context(); const canvas = { width: 2, height: 2, getContext: () => ctx }; ctx.canvas = canvas; return canvas } }
  console.error = () => {}
  t.after(() => {
    for (const key of ['Image', 'document', 'setTimeout', 'clearTimeout']) {
      if (originals[key] === undefined) delete globalThis[key]
      else globalThis[key] = originals[key]
    }
    console.error = originals.error
  })
  return { images, timers, contexts, callbackErrors, context,
    async tick(ms) { clock += ms; for (const [id, timer] of [...timers]) if (timer.at <= clock) { timers.delete(id); timer.fn() }; await drain() }
  }
}

function observe(promise) {
  const state = { status: 'pending' }
  promise.then(value => Object.assign(state, { status: 'fulfilled', value }), error => Object.assign(state, { status: 'rejected', error }))
  return state
}

const layer = { name: 'test', imageData: 'layer-source' }

test('drawLayerImage: callback drawing exception settles and restores rather than hanging', async t => {
  const h = harness(t), ctx = h.context()
  ctx.failDraw = true
  const state = observe(layers.drawLayerImage(ctx, layer))
  await h.images[0].fire()
  assert.equal(state.status, 'fulfilled', 'legacy draw API logs ordinary errors and completes; callback must not hang')
  assert.equal(ctx.depth, 0)
  assert.deepEqual(h.callbackErrors, [])
})

test('drawLayerImage: timeout prevents late image writes', async t => {
  const h = harness(t), ctx = h.context()
  const state = observe(layers.drawLayerImage(ctx, layer))
  await h.tick(5000)
  await h.images[0].fire()
  assert.equal(ctx.writes.length, 0, 'late image event must not write after timeout')
  assert.notEqual(state.status, 'pending')
  assert.equal(h.images[0].onload, null)
  assert.equal(h.timers.size, 0)
})

test('applyLayerMask: stalled mask times out and releases callbacks', async t => {
  const h = harness(t), ctx = h.context()
  const state = observe(layers.applyLayerMask(ctx, { mask: { imageData: 'mask-source' } }, 0, 0, 2, 2, 2, 2))
  await h.tick(5000)
  assert.equal(state.status, 'rejected', 'mask load must not wait indefinitely')
  assert.equal(state.error.name, 'TimeoutError')
  await h.images[0].fire()
  assert.equal(ctx.writes.length, 0)
  assert.equal(h.timers.size, 0)
})

for (const outcome of ['load', 'error', 'timeout', 'abort']) {
  test(`loadRenderImage: ${outcome} settles once and removes handlers, timer and abort listener`, async t => {
    const h = harness(t), controller = new globalThis.AbortController()
    let listeners = 0
    const { signal } = controller
    const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = (...args) => { listeners++; add(...args) }
    signal.removeEventListener = (...args) => { listeners--; remove(...args) }
    const state = observe(loadRenderImage('source', { signal, timeout: 20 }))
    const img = h.images[0], staleLoad = img.onload, staleError = img.onerror
    if (outcome === 'load') await img.fire()
    if (outcome === 'error') await img.fire('onerror')
    if (outcome === 'timeout') await h.tick(20)
    if (outcome === 'abort') { controller.abort('cancelled'); await drain() }
    const status = state.status, error = state.error
    assert.equal(status, outcome === 'load' ? 'fulfilled' : 'rejected')
    if (outcome === 'load') assert.equal(state.value, img)
    else assert.ok(error instanceof Error)
    if (outcome === 'timeout') assert.equal(error.name, 'TimeoutError')
    if (outcome === 'abort') assert.equal(error.name, 'AbortError')
    staleLoad(); staleError(); controller.abort(); await h.tick(5000)
    assert.equal(state.status, status)
    assert.equal(state.error, error)
    assert.equal(img.onload, null)
    assert.equal(img.onerror, null)
    assert.equal(h.timers.size, 0)
    assert.equal(listeners, 0)
  })
}

test('loadRenderImage: pre-abort creates no image or timer; source setter exceptions reject and clean up', async t => {
  const h = harness(t), controller = new globalThis.AbortController()
  controller.abort(new Error('custom reason'))
  await assert.rejects(loadRenderImage('source', { signal: controller.signal }), { name: 'AbortError' })
  assert.equal(h.images.length, 0)
  assert.equal(h.timers.size, 0)
  globalThis.Image = class extends globalThis.Image { set src(value) { throw new Error('setter failed') } }
  await assert.rejects(loadRenderImage('bad-source'), /setter failed/)
  assert.equal(h.images[0].onload, null)
  assert.equal(h.timers.size, 0)
})

for (const method of ['drawLayerImage', 'renderLayerToContext']) {
  test(`${method}: abort between successful load and continuation prevents writes`, async t => {
    const h = harness(t), controller = new globalThis.AbortController(), ctx = h.context()
    assert.equal(bindRenderSignal(ctx, controller.signal), ctx)
    const state = observe(layers[method](ctx, layer, 2, 2))
    h.images[0].onload()
    controller.abort()
    await drain()
    assert.notEqual(state.status, 'pending')
    assert.equal(ctx.writes.length, 0)
    assert.equal(ctx.depth, 0)
  })

  test(`${method}: mask inherits signal; abort releases pending mask and restores parent`, async t => {
    const h = harness(t), controller = new globalThis.AbortController(), ctx = h.context()
    bindRenderSignal(ctx, controller.signal)
    const state = observe(layers[method](ctx, { ...layer, mask: { imageData: 'mask' } }, 2, 2))
    await h.images[0].fire()
    assert.equal(h.images.length, 2)
    for (const temp of h.contexts) assert.equal(getRenderSignal(temp), controller.signal)
    controller.abort()
    await drain()
    assert.notEqual(state.status, 'pending')
    await h.images[1].fire()
    assert.equal(ctx.writes.length, 0)
    assert.equal(ctx.depth, 0)
    assert.equal(h.timers.size, 0)
  })

  test(`${method}: successful mask preserves grayscale alpha, draw coordinates and signal inheritance`, async t => {
    const h = harness(t), ctx = h.context(), controller = new globalThis.AbortController()
    bindRenderSignal(ctx, controller.signal)
    const state = observe(layers[method](ctx, { ...layer, left: 3, top: 4, width: 5, height: 6, mask: { imageData: 'mask' } }, 2, 2))
    await h.images[0].fire()
    await h.images[1].fire()
    assert.equal(state.status, 'fulfilled')
    assert.equal(ctx.writes.length, 1)
    assert.deepEqual(h.contexts[1].writes[0].slice(1), [0, 0, 2, 2, 3, 4, 5, 6])
    assert.deepEqual([...h.contexts[2].writes[1][0].data], [255, 255, 255, 128])
    for (const temp of h.contexts) assert.equal(getRenderSignal(temp), controller.signal)
    assert.equal(ctx.depth, 0)
    assert.equal(h.timers.size, 0)
  })
}

test('renderLayerToContext: drawing failure rejects and restores; image error preserves message', async t => {
  const h = harness(t), ctx = h.context()
  ctx.failDraw = true
  const state = observe(layers.renderLayerToContext(ctx, layer, 2, 2))
  await h.images[0].fire()
  assert.equal(state.status, 'rejected')
  assert.match(state.error.message, /controlled draw failure/)
  assert.equal(ctx.depth, 0)
  const errorState = observe(layers.renderLayerToContext(ctx, layer, 2, 2))
  await h.images[1].fire('onerror')
  assert.equal(errorState.error.message, '图层图像加载失败: test')
})

test('renderClippingGroup: temp contexts inherit signal and abort stops final composition', async t => {
  const h = harness(t), ctx = h.context(), controller = new globalThis.AbortController()
  bindRenderSignal(ctx, controller.signal)
  let calls = 0
  await assert.rejects(layers.renderClippingGroup(ctx, layer, [layer], 2, 2, async target => {
    assert.equal(getRenderSignal(target), controller.signal)
    calls++
    if (calls === 3) controller.abort()
  }), { name: 'AbortError' })
  assert.equal(calls, 3)
  assert.equal(ctx.writes.length, 0)
  for (const target of h.contexts) assert.equal(target.writes.length, 0)
})

test('applyLayerMask: drawing error restores composite operation and rejects', async t => {
  const h = harness(t), ctx = h.context()
  ctx.failDraw = true
  ctx.globalCompositeOperation = 'multiply'
  const state = observe(layers.applyLayerMask(ctx, { mask: { imageData: 'mask' } }, 0, 0, 2, 2, 2, 2))
  await h.images[0].fire()
  assert.equal(state.status, 'rejected')
  assert.equal(ctx.globalCompositeOperation, 'multiply')
  assert.equal(h.timers.size, 0)
})

for (const method of ['drawLayerImage', 'renderLayerToContext']) {
  for (const outcome of ['error', 'timeout']) {
    test(`${method}: ${outcome} during mask wait settles, restores and cannot write late`, async t => {
      const h = harness(t), ctx = h.context()
      const state = observe(layers[method](ctx, { ...layer, mask: { imageData: 'mask' } }, 2, 2))
      await h.images[0].fire()
      if (outcome === 'error') await h.images[1].fire('onerror')
      else await h.tick(5000)
      assert.equal(state.status, method === 'drawLayerImage' ? 'fulfilled' : 'rejected')
      if (method === 'renderLayerToContext') {
        if (outcome === 'error') assert.equal(state.error.message, '蒙版图像加载失败')
        else assert.equal(state.error.name, 'TimeoutError')
      }
      await h.images[1].fire()
      assert.equal(ctx.writes.length, 0)
      assert.equal(ctx.depth, 0)
      assert.equal(h.timers.size, 0)
    })
  }
}
