import test from 'node:test'
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { setup, flush } from './helpers/render-race-fixture.mjs'

for (const [firstKind, secondKind] of [['part', 'part'], ['tree', 'preset'], ['preset', 'tree']]) {
  test(`跨入口竞争：${firstKind}慢请求不能覆盖${secondKind}最新帧`, async t => {
    const f = setup(t)
    const first = f.start(firstKind, '#ff0000')
    await flush()
    const oldImage = f.images.at(-1)
    const second = f.start(secondKind, '#0000ff')
    await flush()
    await f.images.at(-1).release()
    await second
    assert.deepEqual(f.pixel(), [0, 0, 255, 255])
    await oldImage.release()
    await first
    assert.deepEqual(f.pixel(), [0, 0, 255, 255], '迟到旧帧不能覆盖新帧')
    assert.equal(f.deps.isRendering.value, false)
  })
}

test('旧请求 finally 不得解除仍在等待的新请求状态', async t => {
  const f = setup(t)
  const first = f.start('part', '#ff0000')
  await flush()
  const firstImage = f.images.at(-1)
  const second = f.start('part', '#0000ff')
  await flush()
  const secondImage = f.images.at(-1)
  await firstImage.release()
  await first
  const busy = f.deps.isRendering.value
  await secondImage.release()
  await second
  assert.equal(busy, true)
})

test('图层五秒超时后释放旧 onload 不得再写入上下文', async t => {
  const f = setup(t)
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const work = f.start('part', '#ff0000')
  await flush()
  const image = f.images.at(-1)
  t.mock.timers.tick(5000)
  await flush()
  await work
  const before = f.pixel()
  const buffers = []
  // 主帧已结束；回调必须解除，而不是仅靠最终主画布校验。
  buffers.push(image.onload)
  await image.release()
  assert.deepEqual(f.pixel(), before)
  assert.equal(buffers[0], null, '超时必须解除图片回调')
})

test('独立模板树快照复用像素算法且不触碰主画布和真实树', async t => {
  const f = setup(t)
  f.select('#0000ff')
  const tree = f.tree.layerTreeData.value
  const source = createCanvas(2, 1)
  source.getContext('2d').fillStyle = '#ff0000'
  source.getContext('2d').fillRect(0, 0, 2, 1)
  f.deps.canvasRef.value.getContext('2d').drawImage(source, 0, 0)
  const before = f.pixel()
  const work = f.tree.renderLayerTreeSnapshot(JSON.parse(JSON.stringify(tree)))
  await flush()
  assert.equal(f.deps.isRendering.value, false)
  await f.images.at(-1).release()
  const snapshot = await work
  assert.deepEqual(Array.from(snapshot.getContext('2d').getImageData(0, 0, 1, 1).data), [0, 0, 255, 255])
  assert.deepEqual(f.pixel(), before)
  assert.equal(f.tree.layerTreeData.value, tree)
})

test('连续三十次请求逆序完成保留最后选择', async t => {
  const f = setup(t), work = []
  for (let index = 0; index < 30; index++) {
    work.push(f.start('part', index === 29 ? '#0000ff' : '#ff0000'))
    await flush()
  }
  for (const image of [...f.images].reverse()) await image.release()
  await Promise.all(work)
  assert.deepEqual(f.pixel(), [0, 0, 255, 255])
})
