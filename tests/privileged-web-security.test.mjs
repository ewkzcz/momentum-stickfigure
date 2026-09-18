import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { APPLICATION_CSP, MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL } from '../src/main/application-protocol.js'

function assertEntry(actual, expected) {
  const url = new URL(actual)
  // Vue 使用 hash 路由；片段不参与静态资源定位。
  url.hash = ''
  assert.equal(url.href, expected)
}

async function closeNormally(desktop, evidence) {
  const child = desktop.application.process()
  const exited = child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve({ code: child.exitCode, signal: child.signalCode })
    : new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  try {
    await desktop.close()
    evidence.exit = await exited
    assert.deepEqual(evidence.exit, { code: 0, signal: null }, '必须正常退出，不能忽略原生析构失败')
  } catch (error) {
    evidence.closeFailure = { name: error.name, message: error.message }
    if (child.exitCode === null && child.signalCode === null) {
      try { await desktop.application.close() } catch (failure) { evidence.fallbackCloseFailure = failure.message }
    }
    evidence.exit = { code: child.exitCode, signal: child.signalCode }
    throw error
  }
}

test('主窗预览网页安全：实际启用webSecurity并拒绝无CORS跨域读取', { timeout: 120000 }, async context => {
  const prefix = '/custom-api/v1'
  const evidence = { base: null, prefix, preferences: [], windows: {}, requests: [], shutdown: {}, restoration: {} }
  const server = createServer((req, res) => {
    const allowed = req.url === `${prefix}/main/allowed` || req.url === `${prefix}/preview/allowed`
    evidence.requests.push({
      method: req.method, path: req.url, host: req.headers.host,
      origin: req.headers.origin ?? null, referer: req.headers.referer ?? null,
      accessControlAllowOrigin: allowed ? '*' : null
    })
    if (allowed) res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Cache-Control', 'no-store')
    res.end('isolated-response')
  })
  let desktop
  let evidenceRoot
  const pages = []
  try {
    // 强制bootstrap只豁免localhost解析；保持保护不变，使用允许的回环服务。
    server.listen(0, 'localhost')
    await once(server, 'listening')
    evidence.base = `http://localhost:${server.address().port}`
    // 始终使用强制后台启动器；启动失败也由外层finally关闭已监听的服务。
    desktop = await launchDesktop()
    evidenceRoot = desktop.root
    const opening = desktop.application.waitForEvent('window')
    const [creation, preview] = await Promise.all([
      desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')),
      opening
    ])
    assert.equal(creation.success, true)
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    pages.push(['main', desktop.page], ['preview', preview])
    evidence.preferences = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
      id: window.id, url: window.webContents.getURL(),
      security: window.webContents.getLastWebPreferences().webSecurity,
      sandbox: window.webContents.getLastWebPreferences().sandbox
    })))

    // 先完成两窗采集，不在循环中断言；一窗读取失败不能遮蔽另一窗证据。
    await Promise.all(pages.map(async ([role, page]) => {
      const urls = ['/denied', '/allowed'].map(route => `${evidence.base}${prefix}/${role}${route}`)
      const measurement = evidence.windows[role] = { url: page.url(), urls, fetches: [], violations: [] }
      try {
        measurement.document = await page.evaluate(async () => {
          const entry = new URL(location.href)
          entry.hash = ''
          const response = await window.fetch(entry.href, { cache: 'no-store' })
          const scripts = [...document.querySelectorAll('script[src]')].map(script => script.src)
          const assets = []
          for (const url of scripts) {
            const asset = await window.fetch(url, { cache: 'no-store' })
            assets.push({ url, status: asset.status, mime: asset.headers.get('content-type') })
          }
          return {
            status: response.status, csp: response.headers.get('content-security-policy'),
            vueMounted: Boolean(document.querySelector('#app')?.__vue_app__), assets
          }
        })
        await page.evaluate(() => {
          const probe = { violations: [] }
          probe.listener = event => probe.violations.push({
            blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective,
            violatedDirective: event.violatedDirective, disposition: event.disposition,
            originalPolicy: event.originalPolicy, documentURI: event.documentURI, isTrusted: event.isTrusted
          })
          window.__privilegedWebSecurityProbe = probe
          document.addEventListener('securitypolicyviolation', probe.listener)
        })
        measurement.fetches = await page.evaluate(async urls => {
          const fetches = []
          for (const url of urls) {
            try {
              const response = await window.fetch(url, { cache: 'no-store' })
              fetches.push({ url, result: await response.text(), status: response.status, type: response.type })
            } catch (error) {
              fetches.push({ url, result: 'blocked', error: { name: error.name, message: error.message } })
            }
          }
          return fetches
        }, urls)
        // DOM 插入的脚本走页面 CSP，而不是调试协议执行代码的特权路径。
        await page.evaluate(() => {
          const probe = window.__privilegedWebSecurityProbe
          probe.inlineExecuted = false
          probe.inlineScript = document.createElement('script')
          probe.inlineScript.textContent = 'window.__privilegedWebSecurityProbe.inlineExecuted = true'
          document.head.appendChild(probe.inlineScript)
        })
        // 等待浏览器真实违规事件；无事件或脚本执行成功均不能算 CSP 生效。
        await page.waitForFunction(() => window.__privilegedWebSecurityProbe.violations.some(event =>
          event.isTrusted && event.blockedURI === 'inline' && event.disposition === 'enforce' &&
          ['script-src', 'script-src-elem'].includes(event.effectiveDirective)), undefined, { timeout: 10000 })
      } catch (error) {
        measurement.collectionError = { name: error.name, message: error.message }
      }
    }))
    // fetch均完成后再用独立页面任务收集已派发事件，不依赖console文本或固定等待。
    await Promise.all(pages.map(async ([role, page]) => {
      const measurement = evidence.windows[role]
      try {
        const probeResult = await page.evaluate(() => {
          const probe = window.__privilegedWebSecurityProbe
          if (!probe) throw new Error('CSP事件监听未安装')
          document.removeEventListener('securitypolicyviolation', probe.listener)
          probe.inlineScript?.remove()
          delete window.__privilegedWebSecurityProbe
          return { violations: probe.violations, inlineExecuted: probe.inlineExecuted }
        })
        measurement.violations = probeResult.violations
        measurement.inlineExecuted = probeResult.inlineExecuted
        measurement.url = page.url()
      } catch (error) {
        measurement.collectionError = { name: error.name, message: error.message }
      }
      measurement.requests = evidence.requests.filter(request => request.path?.startsWith(`${prefix}/${role}/`))
      measurement.consoleErrors = desktop.logs.filter(line => /error|CORS|fetch|Mixed Content/i.test(line))
    }))

    await context.test('主窗和预览实际webSecurity及sandbox保持开启', () => {
      assert.equal(evidence.preferences.length, 2)
      for (const expected of [MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL]) {
        assert.ok(evidence.preferences.some(preference => {
          const url = new URL(preference.url)
          url.hash = ''
          return url.href === expected
        }), `必须实际加载固定应用入口：${expected}`)
      }
      assert.deepEqual(evidence.preferences.map(({ security, sandbox }) => ({ security, sandbox })), [
        { security: true, sandbox: true }, { security: true, sandbox: true }
      ])
    })
    for (const role of ['main', 'preview']) {
      await context.test(`${role === 'main' ? '主窗' : '预览'}：无CORS读取拒绝且有CORS读取成功`, () => {
        const measurement = evidence.windows[role]
        assert.equal(measurement.collectionError, undefined, '两窗都必须完整采集，不以页面异常代替跨域拒绝')
        assertEntry(measurement.url, role === 'main' ? MAIN_APPLICATION_URL : PREVIEW_APPLICATION_URL)
        assert.equal(measurement.document.status, 200)
        assert.equal(measurement.document.csp, APPLICATION_CSP, '生产响应必须自身携带 CSP')
        assert.equal(measurement.document.vueMounted, true, '必须挂载真实 Vue，而非只返回入口 200')
        assert.ok(measurement.document.assets.length > 0, '生产入口必须加载构建脚本')
        for (const asset of measurement.document.assets) {
          assert.equal(new URL(asset.url).protocol, 'momentum-app:')
          assert.equal(new URL(asset.url).host, 'bundle')
          assert.equal(asset.status, 200)
          assert.match(asset.mime, /javascript/)
        }
        for (const route of ['/denied', '/allowed']) {
          const request = measurement.requests.find(request => request.method === 'GET' && request.path === `${prefix}/${role}${route}`)
          assert.ok(request, `受控服务必须实际收到${prefix}/${role}${route}请求`)
          assert.equal(request.host, new URL(evidence.base).host, '必须命中受控回环服务的实际自定义端口')
          assert.equal(request.origin, 'momentum-app://bundle', '应用必须具有实际可校验的非 file 来源')
          assert.equal(request.accessControlAllowOrigin, route === '/allowed' ? '*' : null)
        }
        const connectionViolations = measurement.violations.filter(event =>
          event.effectiveDirective === 'connect-src' &&
          (event.blockedURI === evidence.base || event.blockedURI.startsWith(evidence.base + '/')))
        assert.deepEqual(connectionViolations, [], 'CSP阻断不能代替无CORS跨域读取拒绝')
        assert.deepEqual(measurement.fetches.map(fetch => fetch.result), ['blocked', 'isolated-response'])
        assert.equal(measurement.fetches[0].error.name, 'TypeError')
        assert.equal(measurement.fetches[1].status, 200)
        assert.equal(measurement.fetches[1].type, 'cors')
      })
      await context.test(`${role === 'main' ? '主窗' : '预览'}：实际 CSP 拒绝内联脚本并产生可信违规事件`, () => {
        const measurement = evidence.windows[role]
        assert.equal(measurement.collectionError, undefined, '必须采集实际 CSP 执行结果')
        assert.equal(measurement.inlineExecuted, false, 'DOM 内联脚本必须未执行')
        const violations = measurement.violations.filter(event => event.isTrusted && event.blockedURI === 'inline' &&
          event.disposition === 'enforce' && ['script-src', 'script-src-elem'].includes(event.effectiveDirective))
        assert.ok(violations.length > 0, '必须存在浏览器实际派发的 CSP 强制执行事件')
        for (const event of violations) {
          assert.equal(event.originalPolicy, APPLICATION_CSP)
          // Chromium CSP3报告对非HTTP(S)/WS(S)文档仅保留scheme；完整入口已单独核验。
          assert.equal(event.documentURI, 'momentum-app')
        }
      })
    }
    await context.test('正常退出并在相同隔离目录恢复真实主窗与预览', async () => {
      assert.deepEqual(desktop.errors, [])
      const previous = desktop
      desktop = null
      await closeNormally(previous, evidence.shutdown)
      // 退出后独立进程重新注册协议，不能以同进程 reload 代替恢复。
      desktop = await launchDesktop(evidenceRoot)
      assertEntry(desktop.page.url(), MAIN_APPLICATION_URL)
      const opening = desktop.application.waitForEvent('window')
      const [creation, preview] = await Promise.all([
        desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), opening
      ])
      assert.equal(creation.success, true, '恢复后可信 IPC 仍须创建预览')
      await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
      assertEntry(preview.url(), PREVIEW_APPLICATION_URL)
      evidence.restoration.urls = [desktop.page.url(), preview.url()]
      evidence.restoration.preferences = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
        security: window.webContents.getLastWebPreferences().webSecurity,
        sandbox: window.webContents.getLastWebPreferences().sandbox
      })))
      assert.deepEqual(evidence.restoration.preferences, [{ security: true, sandbox: true }, { security: true, sandbox: true }])
      assert.deepEqual(desktop.errors, [])
      const restored = desktop
      desktop = null
      await closeNormally(restored, evidence.restoration)
    })
  } catch (error) {
    evidence.setupError = { name: error.name, message: error.message }
    throw error
  } finally {
    try {
      if (desktop) await closeNormally(desktop, evidence.cleanup = {})
    } finally {
      try {
        // 先收集退出结果再落盘；旧固定基线证据始终保留，本次只写隔离 root。
        if (evidenceRoot) {
          const evidencePath = path.join(evidenceRoot, 'privileged-web-security.json')
          await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
          console.log(`主窗预览网页安全证据：${evidencePath}`)
        }
      } finally {
        server.closeAllConnections()
        if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      }
    }
  }
})
