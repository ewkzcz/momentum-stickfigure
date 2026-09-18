// 修复前 node --test 本文件：4 tests / 0 pass / 4 fail。
// 三个入口均 before commit encodes=1，输出像素=[255,0,0,255]（旧红图）；
// 预览编码仍为红图，却携带 width=4、filename=blue.png（新元数据）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { ref, shallowRef, watch } from 'vue'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { useCanvasOutputCoordinator } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasOutputCoordinator.js'
import { createCanvasRenderCoordinator } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasRenderCoordinator.js'
import { loadRenderImage } from '../src/renderer/src/components/pages/ActionExpressionPage/utils/renderImageTask.js'

const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)) }
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255]
async function pixel(payload) {
  const image = await loadImage(payload.buffer ? Buffer.from(payload.buffer) : payload.dataURL || payload.dataUrl)
  const canvas = createCanvas(image.width, image.height)
  canvas.getContext('2d').drawImage(image, 0, 0)
  return Array.from(canvas.getContext('2d').getImageData(0, 0, 1, 1).data)
}
function setup(t, { injected = true } = {}) {
  const encodes = [], images = [], calls = [], routes = [], writes = [], storage = new Map(), messages = []
  const makeCanvas = () => {
    const canvas = createCanvas(2, 1)
    canvas.toBlob = (callback, type) => {
      // Native PNG serialization captures pixels at toBlob invocation; only delivery is controlled.
      const bytes = canvas.toBuffer('image/png')
      encodes.push({ canvas, release: () => callback(new Blob([bytes], { type })), fail: () => callback(null) })
    }
    return canvas
  }
  const canvasRef = shallowRef(makeCanvas()), currentPsdData = shallowRef({ id: 'A' })
  const coordinator = createCanvasRenderCoordinator({ canvasRef })
  const filename = ref('red.png'), isSendingToGenerate = ref(false)
  const globals = {
    document: { createElement: makeCanvas },
    Image: class {
      constructor() {
        const canvas = makeCanvas()
        Object.defineProperty(canvas, 'src', { set(source) { canvas.ready = loadImage(source).then(image => { canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0) }) } })
        canvas.release = async () => { await canvas.ready; canvas.onload?.(); await flush() }
        images.push(canvas)
        return canvas
      }
    },
    FileReader: class {
      readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = `data:image/png;base64,${Buffer.from(buffer).toString('base64')}`; this.onload() }) }
    },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    // 当前跳转协议只暴露 saveTempImage；路径由主进程响应决定，渲染端不拼接临时路径。
    window: {
      electronAPI: { invoke: async (...args) => { calls.push(args); return { success: true } } },
      fileSystem: { saveTempImage: async (...args) => { writes.push(args); return { success: true, path: '/tmp/render-output-fixture/saved.png' } } }
    }
  }
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  t.after(() => coordinator.invalidate())
  for (const method of ['log', 'warn', 'error']) t.mock.method(console, method, () => {})
  const output = useCanvasOutputCoordinator({ canvasRef, currentPsdData, isSendingToGenerate,
    message: Object.fromEntries(['error', 'warning', 'success'].map(name => [name, text => messages.push([name, text])])),
    router: { push: async route => { routes.push(route) } }, perfLogger: { start: () => ({ end() {} }), logEvent() {} },
    buildSuggestedFileName: () => filename.value, logPreviewSyncTrigger() {},
    ...(injected ? { getRenderCoordinator: () => coordinator } : {})
  })
  function paint(color, canvas = canvasRef.value) { const ctx = canvas.getContext('2d'); ctx.fillStyle = color; ctx.fillRect(0, 0, canvas.width, canvas.height) }
  function render(color) {
    const request = coordinator.begin(), buffer = coordinator.createBuffer(request)
    const source = makeCanvas(); paint(color, source)
    return loadRenderImage(source.toDataURL(), { signal: request.signal }).then(image => {
      buffer.ctx.drawImage(image, 0, 0)
      coordinator.commit(request, buffer.canvas)
    })
  }
  paint('red')
  return { output, canvasRef, coordinator, currentPsdData, filename, encodes, images, calls, storage, routes, writes, messages, render, paint, isSendingToGenerate }
}

for (const method of ['sendCanvasToGenerate', 'handleJumpSelect', 'syncCanvasToPreview']) {
  test(`${method}: waits for queued Vue watcher and real image render before native snapshot`, async t => {
    const f = setup(t), selection = ref('red')
    let rendering
    const stop = watch(selection, color => { rendering = f.render(color) })
    t.after(stop)
    selection.value = 'blue'; f.filename.value = 'blue.png'
    const pending = f.output[method](method === 'handleJumpSelect' ? 'comic' : undefined)
    await flush()
    const beforeCommit = f.encodes.length
    await f.images[0].release(); await rendering; await flush()
    t.diagnostic(`before commit encodes=${beforeCommit}; after commit encodes=${f.encodes.length}`)
    f.encodes[0]?.release(); await pending
    const payload = method === 'syncCanvasToPreview' ? f.calls.find(([channel]) => channel === 'canvas-preview-update')?.[1] : JSON.parse(f.storage.get(method === 'handleJumpSelect' ? 'pendingImageForJump' : 'pendingImageForGenerate') || '{}')
    t.diagnostic(`output pixel=${JSON.stringify(await pixel(payload))}`)
    assert.equal(beforeCommit, 0)
    assert.deepEqual(await pixel(payload), blue)
  })
}

test('preview freezes filename, dimensions and PNG pixels before asynchronous encoding', async t => {
  const f = setup(t)
  const pending = f.output.syncCanvasToPreview(); await flush()
  f.filename.value = 'blue.png'; f.canvasRef.value.width = 4; f.paint('blue')
  f.encodes[0].release(); await pending
  const payload = f.calls.find(([channel]) => channel === 'canvas-preview-update')[1]
  const name = f.calls.find(([channel]) => channel === 'canvas-preview-update-filename')[1]
  t.diagnostic(`encoded red pixels; metadata width=${payload.width}, filename=${name}`)
  assert.deepEqual(await pixel(payload), red)
  assert.equal(payload.width, 2)
  assert.equal(payload.height, 1)
  assert.equal(name, 'red.png')
})

for (const method of ['sendCanvasToGenerate', 'handleJumpSelect', 'syncCanvasToPreview']) {
  test(`${method}: session invalidation during native encoding prevents external effects`, async t => {
    const f = setup(t)
    const pending = f.output[method](method === 'handleJumpSelect' ? 'comic' : undefined)
    await flush()
    f.coordinator.invalidate()
    f.encodes[0].release(); await pending
    assert.equal(f.storage.size, 0)
    assert.equal(f.calls.length + f.routes.length + f.writes.length, 0)
    assert.equal(f.isSendingToGenerate.value, false)
  })
  test(`${method}: session invalidation while waiting never exports old pixels`, async t => {
    const f = setup(t), request = f.coordinator.begin()
    const pending = f.output[method](method === 'handleJumpSelect' ? 'comic' : undefined)
    await flush(); f.coordinator.invalidate(); await pending
    assert.equal((await request.done).status, 'stale')
    assert.equal(f.encodes.length, 0)
    assert.equal(f.storage.size + f.calls.length + f.routes.length + f.writes.length, 0)
  })
}

for (const status of ['failed', 'timeout', 'stale', 'completed']) {
  test(`render terminal ${status} does not permit an output snapshot`, async t => {
    const f = setup(t), request = f.coordinator.begin()
    const pending = f.output.syncCanvasToPreview()
    await flush(); f.coordinator.finish(request, status); await pending
    assert.equal(f.encodes.length, 0)
    assert.equal(f.calls.length, 0)
  })
}

test('preview sequence discards slower old encoding and its filename', async t => {
  const f = setup(t)
  const first = f.output.syncCanvasToPreview(); await flush()
  f.filename.value = 'blue.png'; f.paint('blue')
  const second = f.output.syncCanvasToPreview(); await flush()
  f.encodes[1].release(); await second
  f.encodes[0].release(); await first
  const updates = f.calls.filter(([channel]) => channel === 'canvas-preview-update')
  assert.equal(updates.length, 1)
  assert.deepEqual(await pixel(updates[0][1]), blue)
  assert.deepEqual(f.calls.filter(([channel]) => channel === 'canvas-preview-update-filename'), [['canvas-preview-update-filename', 'blue.png']])
})

test('preview PNG fallback serializes the frozen copy, never the mutated main canvas', async t => {
  const f = setup(t)
  const pending = f.output.syncCanvasToPreview(); await flush()
  f.paint('blue'); f.filename.value = 'blue.png'
  f.encodes[0].fail(); await pending
  const payload = f.calls.find(([channel]) => channel === 'canvas-preview-update')[1]
  assert.equal(payload.mimeType, 'image/png')
  assert.ok(payload.dataUrl.startsWith('data:image/png;base64,'))
  assert.deepEqual(await pixel(payload), red)
  assert.equal(f.calls[1][1], 'red.png')
})

for (const method of ['sendCanvasToGenerate', 'handleJumpSelect', 'syncCanvasToPreview']) {
  test(`${method}: optional injection preserves standalone protocol and frozen filename`, async t => {
    const f = setup(t, { injected: false })
    const pending = f.output[method](method === 'handleJumpSelect' ? 'comic' : undefined)
    await flush(); f.filename.value = 'blue.png'; f.paint('blue')
    assert.notEqual(f.encodes[0].canvas, f.canvasRef.value)
    f.encodes[0].release(); await pending
    if (method === 'syncCanvasToPreview') {
      assert.deepEqual(await pixel(f.calls[0][1]), red)
      assert.equal(f.calls[1][1], 'red.png')
    } else {
      const payload = JSON.parse(f.storage.get(method === 'handleJumpSelect' ? 'pendingImageForJump' : 'pendingImageForGenerate'))
      assert.deepEqual(await pixel(payload), red)
      assert.equal(payload.fileName, 'red.png')
      assert.equal(payload.source, 'action-expression-canvas')
      assert.equal(f.routes[0], method === 'handleJumpSelect' ? '/comic' : '/image-processing')
      if (method === 'handleJumpSelect') {
        assert.equal(payload.targetPage, 'comic')
        assert.equal(payload.filePath, '/tmp/render-output-fixture/saved.png')
        assert.deepEqual(f.writes, [[payload.dataURL.split(',')[1], 'red.png']])
      }
    }
  })
}

// getTempDir/writeFile 已合并为一次 saveTempImage 调用；已发出的保存不可撤销，
// 但会话失效后，无论成功或失败响应，都不能触发后续保存、缓存、跳转或提示。
for (const success of [true, false]) {
  test(`jump session invalidation during saveTempImage ignores ${success ? 'success' : 'failure'} response and prevents subsequent effects`, async t => {
    const f = setup(t)
    let release
    window.fileSystem.saveTempImage = (...args) => {
      f.writes.push(args)
      return new Promise(resolve => { release = resolve })
    }
    const pending = f.output.handleJumpSelect('comic'); await flush()
    f.encodes[0].release(); await flush()
    assert.equal(typeof release, 'function')
    assert.equal(f.writes.length, 1)
    const [base64Data, fileName] = f.writes[0]
    assert.deepEqual(await pixel({ dataURL: `data:image/png;base64,${base64Data}` }), red)
    assert.equal(fileName, 'red.png')
    assert.equal(f.storage.size + f.calls.length + f.routes.length + f.messages.length, 0)
    f.coordinator.invalidate()
    release(success ? { success: true, path: '/tmp/render-output-fixture/saved.png' } : { success: false, error: 'fixture save failure' })
    await pending
    assert.equal(f.storage.size + f.calls.length + f.routes.length, 0)
    assert.deepEqual(f.writes, [[base64Data, fileName]])
    assert.equal(f.messages.length, 0)
    assert.equal(f.isSendingToGenerate.value, false)
  })
}

test('session change before nextTick cancels output even when PSD returns to the same object', async t => {
  const f = setup(t), original = f.currentPsdData.value
  const stop = watch(f.currentPsdData, () => f.coordinator.invalidate(), { flush: 'sync' })
  t.after(stop)
  const pending = f.output.syncCanvasToPreview()
  f.currentPsdData.value = {}; f.currentPsdData.value = original
  await pending
  assert.equal(f.encodes.length + f.calls.length, 0)
})

test('waitForCurrent follows a replacement real image request', async t => {
  const f = setup(t)
  const first = f.render('red').catch(error => error)
  const pending = f.output.syncCanvasToPreview(); await flush()
  const second = f.render('blue'); await flush()
  await f.images[1].release(); await second; await flush()
  f.encodes[0].release(); await pending
  assert.equal((await first).name, 'AbortError')
  assert.deepEqual(await pixel(f.calls[0][1]), blue)
})

test('preview invalidation during blob.arrayBuffer prevents IPC', async t => {
  const f = setup(t)
  let release
  const original = Blob.prototype.arrayBuffer
  t.mock.method(Blob.prototype, 'arrayBuffer', function () {
    const blob = this
    return new Promise(resolve => { release = async () => resolve(await original.call(blob)) })
  })
  const pending = f.output.syncCanvasToPreview(); await flush()
  f.encodes[0].release(); await flush()
  f.coordinator.invalidate(); await release(); await pending
  assert.equal(f.calls.length, 0)
})

for (const method of ['sendCanvasToGenerate', 'handleJumpSelect']) {
  test(`${method}: invalidation during FileReader conversion prevents storage and navigation`, async t => {
    const f = setup(t)
    let release
    globalThis.FileReader = class {
      readAsDataURL(blob) { release = async () => { this.result = `data:image/png;base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`; this.onload() } }
    }
    const pending = f.output[method](method === 'handleJumpSelect' ? 'comic' : undefined)
    await flush(); f.encodes[0].release(); await flush()
    f.coordinator.invalidate(); await release(); await pending
    assert.equal(f.storage.size + f.routes.length + f.writes.length, 0)
  })
}

test('late render coordinator getter is not evaluated during output initialization', t => {
  const f = setup(t)
  let reads = 0
  useCanvasOutputCoordinator({ getRenderCoordinator: () => { reads++; throw new Error('not initialized') } })
  assert.equal(reads, 0)
  assert.ok(f.output.syncCanvasToPreview)
})
