import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('应用协议：主窗口带实际 hash 路由重载仍返回入口并挂载 Vue', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  const requests = []
  const responses = []
  desktop.page.on('request', request => requests.push({ url: request.url(), type: request.resourceType() }))
  desktop.page.on('response', response => responses.push({ url: response.url(), status: response.status() }))
  const result = { requests, responses, passed: false }
  try {
    await desktop.page.evaluate(() => { location.hash = '/login' })
    await desktop.page.locator('.layout-shell').waitFor({ state: 'detached' })
    const response = await desktop.page.reload({ waitUntil: 'domcontentloaded' })
    result.url = desktop.page.url()
    result.status = response?.status()
    result.body = await response?.text()
    assert.equal(result.status, 200, '实际 hash 重载必须获取固定入口，不能返回404')
    assert.equal(result.url, 'momentum-app://bundle/index.html#/login')
    await desktop.page.waitForFunction(() => document.querySelector('#app')?.children.length > 0)
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    console.log(`协议路由重载证据：${desktop.root}`)
    await writeFile(path.join(desktop.root, 'application-protocol-reload.json'), JSON.stringify(result, null, 2))
    await desktop.close()
  }
})
