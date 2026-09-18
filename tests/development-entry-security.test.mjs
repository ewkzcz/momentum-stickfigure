import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { once } from 'node:events'
import { createServer } from 'vite'
import vue from '@vitejs/plugin-vue'
import { launchDesktop, repository } from './helpers/desktop.mjs'

test('开发入口：真实Vite双窗挂载、沙箱和主文档CSP生效', { timeout: 120000 }, async () => {
  const cacheDir = await mkdtemp(path.join(os.tmpdir(), 'momentum-vite-cache-'))
  const server = await createServer({
    configFile: false, root: path.join(repository, 'src/renderer'), cacheDir,
    server: { host: 'localhost', port: 0, strictPort: false },
    resolve: { alias: { '@renderer': path.join(repository, 'src/renderer/src'), '@shared': path.join(repository, 'src/shared') } },
    plugins: [vue({ template: { compilerOptions: { isCustomElement: tag => tag === 'webview' } } })]
  })
  const requests = []
  const api = createHttpServer((req, res) => {
    requests.push({ path: req.url, origin: req.headers.origin, host: req.headers.host })
    if (req.url.endsWith('/allowed')) res.setHeader('Access-Control-Allow-Origin', '*')
    res.end('development-api-response')
  })
  let desktop
  try {
    api.listen(0, 'localhost')
    await once(api, 'listening')
    const apiBase = `http://localhost:${api.address().port}/custom-api/v1`
    await server.listen()
    const url = `http://localhost:${server.httpServer.address().port}/`
    desktop = await launchDesktop(undefined, 'default', url)
    const opening = desktop.application.waitForEvent('window')
    const [created, preview] = await Promise.all([desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), opening])
    assert.equal(created.success, true)
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const page of [desktop.page, preview]) {
      assert.equal(new URL(page.url()).origin, new URL(url).origin)
      // reload捕获真实导航响应，不用fetch文档冒充mainFrame响应。
      const response = await page.reload()
      assert.equal(response.status(), 200)
      // Electron修改后的响应头不一定由Playwright网络响应暴露；下面用浏览器实际执行的策略取证。
      await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0)
      assert.equal(await page.evaluate(() => Boolean(window.electronAPI)), true)
      const role = page === desktop.page ? 'main' : 'preview'
      const fetched = await page.evaluate(async base => {
        const results = []
        for (const route of ['allowed', 'denied']) {
          try { results.push(await (await window.fetch(`${base}/${route}`)).text()) }
          catch { results.push('blocked') }
        }
        return results
      }, `${apiBase}/${role}`)
      assert.deepEqual(fetched, ['development-api-response', 'blocked'])
      for (const route of ['allowed', 'denied']) {
        const request = requests.find(request => request.path === `/custom-api/v1/${role}/${route}`)
        assert.ok(request)
        assert.equal(request.origin, new URL(url).origin)
        assert.equal(request.host, new URL(apiBase).host)
      }
      await page.evaluate(() => {
        window.__devCsp = []
        document.addEventListener('securitypolicyviolation', event => window.__devCsp.push({ trusted: event.isTrusted, directive: event.effectiveDirective, disposition: event.disposition, policy: event.originalPolicy }))
        const script = document.createElement('script')
        script.src = 'data:text/javascript,window.__forbiddenDevScript=true'
        document.head.appendChild(script)
      })
      await page.waitForFunction(() => window.__devCsp.some(event => event.trusted && event.disposition === 'enforce' && event.directive.startsWith('script-src')))
      assert.equal(await page.evaluate(() => Boolean(window.__forbiddenDevScript)), false)
      assert.ok(await page.evaluate(() => window.__devCsp.some(event => event.trusted && event.policy.includes("script-src 'self'"))))
    }
    const preferences = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => {
      const options = window.webContents.getLastWebPreferences()
      return { sandbox: options.sandbox, webSecurity: options.webSecurity, contextIsolation: options.contextIsolation }
    }))
    assert.equal(preferences.length, 2)
    for (const value of preferences) assert.deepEqual(value, { sandbox: true, webSecurity: true, contextIsolation: true })
    assert.deepEqual(desktop.errors, [])
  } finally {
    try { if (desktop) await desktop.close() } finally {
      await server.close()
      await new Promise(resolve => api.close(resolve))
      await rm(cacheDir, { recursive: true, force: true })
    }
  }
})
