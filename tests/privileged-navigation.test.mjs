import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

for (const target of ['main', 'preview']) test(`特权窗口导航${target}：阻止远程与其他文件，保留自身路由`, { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    if (target === 'preview') await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const result = await desktop.application.evaluate(({ BrowserWindow }, target) => {
      const window = BrowserWindow.getAllWindows().find(window => target === 'main' ? !window.webContents.getURL().includes('canvas-preview.html') : window.webContents.getURL().includes('canvas-preview.html'))
      const contents = window.webContents, current = contents.getURL()
      const outcomes = []
      for (const eventName of ['will-navigate', 'will-redirect']) {
        for (const url of ['https://untrusted.invalid/', 'file:///tmp/untrusted.html', 'data:text/html,unsafe', current.replace(/#.*$/, '') + '#/home']) {
          let prevented = false
          contents.emit(eventName, { preventDefault() { prevented = true } }, url, false, true)
          outcomes.push({ eventName, url, prevented })
        }
      }
      return outcomes
    }, target)
    for (const row of result) assert.equal(row.prevented, !row.url.endsWith('#/home'), `${row.eventName} ${row.url}`)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
