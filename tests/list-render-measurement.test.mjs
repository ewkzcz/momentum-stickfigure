import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { initializeCanvas, writePsdBuffer } from 'ag-psd'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { stableCanvas } from './helpers/images.mjs'

const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

test('长列表与重绘实测：1000部件、120帧滚动及20次交替选择', { timeout: 120000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-list-measurement-'))
  initializeCanvas(createCanvas)
  const image = createCanvas(8, 8)
  image.getContext('2d').fillRect(0, 0, 8, 8)
  const fixture = path.join(root, '公开长列表.psd')
  await writeFile(fixture, writePsdBuffer({ width: 8, height: 8, canvas: image, children: [{ name: '头部', top: 0, left: 0, bottom: 8, right: 8, canvas: image }, { name: '前手', children: Array.from({ length: 1000 }, (_, index) => ({ name: `部件${index}`, top: 0, left: 0, bottom: 8, right: 8, canvas: image, hidden: index > 0 })) }] }), { flag: 'wx' })
  const desktop = await launchDesktop()
  const result = { items: 1000, passed: false }
  try {
    const page = desktop.page
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, fixture)
    await page.getByRole('button', { name: '上传', exact: true }).click()
    await page.getByTitle('公开长列表.psd', { exact: true }).waitFor()
    await stableCanvas(page)
    const tabs = page.locator('.part-tab')
    for (let index = 0; index < await tabs.count(); index++) {
      await tabs.nth(index).click()
      if (await page.locator('.parts-virtual-items .part-item').count() > 1) break
    }
    assert.ok(await page.locator('.parts-virtual-items .part-item').count() > 1)
    result.scroll = await page.locator('.parts-list').evaluate(async list => {
      const intervals = [], nodes = []
      let previous = performance.now()
      const maximum = list.scrollHeight - list.clientHeight
      if (maximum <= 0) throw new Error('长列表未产生滚动范围')
      for (let index = 0; index < 120; index++) {
        list.scrollTop = maximum * ((index % 60) / 59)
        await new Promise(requestAnimationFrame)
        const time = performance.now()
        intervals.push(time - previous)
        previous = time
        nodes.push(list.querySelectorAll('.part-item').length)
      }
      list.scrollTop = 0
      await new Promise(requestAnimationFrame)
      return { intervals, nodes, maximum }
    })
    await page.evaluate(() => {
      const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
      const originalDraw = window.CanvasRenderingContext2D.prototype.drawImage
      const state = { imageLoads: 0, draws: 0, drawMs: 0, sources: new Set() }
      Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) { state.imageLoads++; state.sources.add(value); descriptor.set.call(this, value) } })
      window.CanvasRenderingContext2D.prototype.drawImage = function (...args) {
        const start = performance.now()
        try { return originalDraw.apply(this, args) } finally { state.draws++; state.drawMs += performance.now() - start }
      }
      window.__renderMetric = { state, restore() { Object.defineProperty(HTMLImageElement.prototype, 'src', descriptor); window.CanvasRenderingContext2D.prototype.drawImage = originalDraw } }
    })
    const selections = []
    try {
      for (let index = 0; index < 20; index++) {
        const start = performance.now()
        await page.locator('.parts-virtual-items .part-item').nth(index % 2).click()
        await stableCanvas(page)
        selections.push(performance.now() - start)
      }
      result.render = await page.evaluate(() => {
        const { state } = window.__renderMetric
        return { imageLoads: state.imageLoads, distinctSources: state.sources.size, draws: state.draws, drawMs: state.drawMs }
      })
    } finally { await page.evaluate(() => { window.__renderMetric.restore(); delete window.__renderMetric }) }
    result.frames = summarize(result.scroll.intervals)
    result.maxVisibleNodes = Math.max(...result.scroll.nodes)
    result.selection = summarize(selections)
    assert.ok(result.maxVisibleNodes < 1000, '长列表必须维持虚拟化而非挂载全部项')
    result.passed = true
    console.log(JSON.stringify({ frames: result.frames, maxVisibleNodes: result.maxVisibleNodes, render: result.render, selection: result.selection }))
  } finally {
    await writeFile(path.join(repository, 'temp/list-render-measurement-result.json'), JSON.stringify(result, null, 2))
    await desktop.close()
  }
})
