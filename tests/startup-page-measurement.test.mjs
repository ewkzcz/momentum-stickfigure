import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'

const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

test('启动与页面切换实测：二十次新进程及四类页面往返', { timeout: 180000 }, async () => {
  const result = { startups: [], pages: {}, passed: false }
  try {
    for (let index = 0; index < 20; index++) {
      const start = performance.now()
      const desktop = await launchDesktop()
      result.startups.push(performance.now() - start)
      try {
        if (index === 0) {
          for (let round = 0; round < 20; round++) {
            for (const [route, selector] of [['/settings/stickfigure', '.settings-page'], ['/comic', '.comic-page'], ['/dialog-frame', '.dialog-frame-page'], ['/generate', '.generate-page']]) {
              const duration = await desktop.page.evaluate(async ({ route, selector }) => {
                const start = performance.now()
                location.hash = route
                const deadline = start + 10000
                while (performance.now() < deadline) {
                  await new Promise(requestAnimationFrame)
                  const node = document.querySelector(selector)
                  if (node && node.getBoundingClientRect().width > 0) return performance.now() - start
                }
                throw new Error(`页面未就绪: ${route}`)
              }, { route, selector })
              ;(result.pages[route] ||= []).push(duration)
            }
          }
        }
        assert.deepEqual(desktop.errors, [])
      } finally { await desktop.close() }
    }
    result.startupSummary = summarize(result.startups)
    result.pageSummary = Object.fromEntries(Object.entries(result.pages).map(([route, samples]) => [route, summarize(samples)]))
    result.passed = true
    console.log(JSON.stringify({ startup: result.startupSummary, pages: result.pageSummary }))
  } finally { await writeFile(path.join(repository, 'temp/startup-page-measurement-result.json'), JSON.stringify(result, null, 2)) }
})
