import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:https'
import { once } from 'node:events'
import { execFile } from 'node:child_process'
import { X509Certificate } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import os from 'node:os'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL } from '../src/main/application-protocol.js'

const execute = promisify(execFile)

function assertEntry(actual, expected) {
  const url = new URL(actual)
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

test('有限HTTPS兼容：主窗与预览在精确隔离证书信任下仍执行CORS', { timeout: 120000 }, async context => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-https-regression-'))
  const prefix = '/custom-https-api/v1'
  const evidence = {
    scope: '仅验证隔离localhost HTTPS兼容与CORS；会话级精确测试证书信任，不是公网证书、第三方登录或真实AI/Python验收',
    root, prefix, base: null, certificate: {}, trust: {}, preferences: [], windows: {}, requests: [], tlsErrors: []
  }
  let certificateDirectory
  let server
  let desktop
  try {
    // 只在父Node进程生成一次性证书；不更改Electron bootstrap的子进程/网络/系统交互保护。
    certificateDirectory = await mkdtemp(path.join(root, 'certificate-'))
    const configPath = path.join(certificateDirectory, 'openssl.cnf')
    const keyPath = path.join(certificateDirectory, 'localhost.key')
    const certificatePath = path.join(certificateDirectory, 'localhost.crt')
    await writeFile(configPath, '[req]\nprompt = no\ndistinguished_name = dn\nx509_extensions = extensions\n[dn]\nCN = localhost\n[extensions]\nsubjectAltName = DNS:localhost\nbasicConstraints = critical,CA:FALSE\nkeyUsage = critical,digitalSignature,keyEncipherment\nextendedKeyUsage = serverAuth\n')
    const args = ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256', '-days', '1',
      '-config', configPath, '-keyout', keyPath, '-out', certificatePath]
    evidence.certificate.generation = { executable: 'openssl', args }
    try {
      // 显式配置且不继承用户OPENSSL_CONF或密钥环境；缺少openssl时明确失败，不降级绕过TLS。
      const result = await execute('openssl', args, {
        cwd: certificateDirectory, timeout: 20000,
        env: Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR'].filter(key => process.env[key]).map(key => [key, process.env[key]]))
      })
      evidence.certificate.generation.exitCode = 0
      evidence.certificate.generation.stderr = result.stderr
    } catch (error) {
      evidence.certificate.generation.failure = { code: error.code, signal: error.signal, message: error.message, stderr: error.stderr }
      throw error
    }
    const [key, cert] = await Promise.all([readFile(keyPath), readFile(certificatePath)])
    const certificate = new X509Certificate(cert)
    assert.equal(certificate.checkHost('localhost'), 'localhost')
    evidence.certificate.fingerprint256 = certificate.fingerprint256
    evidence.certificate.validFrom = certificate.validFrom
    evidence.certificate.validTo = certificate.validTo
    // 保留公开证书用于证据核验；私钥只存在于一次性目录，finally删除，不提交或写入证据。
    evidence.certificate.pem = cert.toString('utf8')

    server = createServer({ key, cert }, (req, res) => {
      const allowed = ['main', 'preview'].some(role => req.url === `${prefix}/${role}/allowed`)
      evidence.requests.push({
        method: req.method, path: req.url, host: req.headers.host,
        origin: req.headers.origin ?? null, encrypted: req.socket.encrypted,
        tlsProtocol: req.socket.getProtocol(), servername: req.socket.servername,
        accessControlAllowOrigin: allowed ? 'momentum-app://bundle' : null
      })
      if (allowed) res.setHeader('Access-Control-Allow-Origin', 'momentum-app://bundle')
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('Content-Type', 'text/plain; charset=utf-8')
      res.end('isolated-https-response')
    })
    server.on('tlsClientError', error => evidence.tlsErrors.push({ code: error.code, message: error.message }))
    server.listen(0, 'localhost')
    await once(server, 'listening')
    evidence.base = `https://localhost:${server.address().port}`
    desktop = await launchDesktop(root)
    const opening = desktop.application.waitForEvent('window')
    const [creation, preview] = await Promise.all([
      desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), opening
    ])
    assert.equal(creation.success, true)
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()

    evidence.trust.installation = await desktop.application.evaluate(({ BrowserWindow, app }, expectedFingerprint) => {
      const { X509Certificate } = process.getBuiltinModule('crypto')
      const windows = BrowserWindow.getAllWindows()
      const sessions = [...new Set(windows.map(window => window.webContents.session))]
      const state = globalThis.__privilegedHttpsProbe = { sessions, verifications: [] }
      for (const [sessionIndex, session] of sessions.entries()) {
        session.setCertificateVerifyProc((request, callback) => {
          let fingerprint256 = null
          let parsingError = null
          try { fingerprint256 = new X509Certificate(request.certificate.data).fingerprint256 } catch (error) { parsingError = error.message }
          // 不使用Electron未标明算法的fingerprint字符串；从叶证书PEM计算SHA-256精确匹配。
          // -3保留Chromium默认验证；仅localhost且命中本次临时证书时返回0。
          const result = request.hostname === 'localhost' && fingerprint256 === expectedFingerprint ? 0 : -3
          state.verifications.push({
            sessionIndex, hostname: request.hostname, fingerprint256, parsingError,
            verificationResult: request.verificationResult, errorCode: request.errorCode,
            isIssuedByKnownRoot: request.isIssuedByKnownRoot, result
          })
          callback(result)
        })
      }
      return {
        sessionCount: sessions.length,
        ignoreCertificateErrors: app.commandLine.hasSwitch('ignore-certificate-errors'),
        ignoreCertificateErrorsSpkiList: app.commandLine.hasSwitch('ignore-certificate-errors-spki-list'),
        disableWebSecurity: app.commandLine.hasSwitch('disable-web-security'),
        nodeTlsRejectUnauthorized: process.env.NODE_TLS_REJECT_UNAUTHORIZED ?? null
      }
    }, certificate.fingerprint256)
    evidence.preferences = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({
      url: window.webContents.getURL(),
      webSecurity: window.webContents.getLastWebPreferences().webSecurity,
      sandbox: window.webContents.getLastWebPreferences().sandbox
    })))

    // 完整采集两窗再断言，某一窗失败不能遮蔽另一窗证据；真实页面fetch不通过Node或路由模拟。
    await Promise.all([['main', desktop.page], ['preview', preview]].map(async ([role, page]) => {
      const measurement = evidence.windows[role] = { url: page.url(), fetches: [], violations: [] }
      try {
        measurement.document = await page.evaluate(() => ({
          origin: location.origin, vueMounted: Boolean(document.querySelector('#app')?.__vue_app__)
        }))
        await page.evaluate(() => {
          const probe = window.__privilegedHttpsProbe = { violations: [] }
          probe.listener = event => probe.violations.push({
            blockedURI: event.blockedURI, effectiveDirective: event.effectiveDirective, isTrusted: event.isTrusted
          })
          document.addEventListener('securitypolicyviolation', probe.listener)
        })
        measurement.fetches = await page.evaluate(async urls => {
          const results = []
          for (const url of urls) {
            try {
              const response = await window.fetch(url, { cache: 'no-store', signal: window.AbortSignal.timeout(15000) })
              results.push({ url, result: await response.text(), status: response.status, type: response.type })
            } catch (error) {
              results.push({ url, result: 'blocked', error: { name: error.name, message: error.message } })
            }
          }
          return results
        }, ['denied', 'allowed'].map(route => `${evidence.base}${prefix}/${role}/${route}`))
      } catch (error) {
        measurement.collectionError = { name: error.name, message: error.message }
      } finally {
        try {
          measurement.violations = await page.evaluate(() => {
            const probe = window.__privilegedHttpsProbe
            if (!probe) throw new Error('HTTPS CSP监听未安装')
            document.removeEventListener('securitypolicyviolation', probe.listener)
            delete window.__privilegedHttpsProbe
            return probe.violations
          })
        } catch (error) {
          measurement.cleanupError = { name: error.name, message: error.message }
        }
      }
      measurement.requests = evidence.requests.filter(request => request.path?.startsWith(`${prefix}/${role}/`))
    }))
    evidence.trust.verifications = await desktop.application.evaluate(() => globalThis.__privilegedHttpsProbe.verifications)

    await context.test('主窗与预览保持webSecurity及sandbox开启', () => {
      assert.equal(evidence.preferences.length, 2)
      for (const expected of [MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL]) {
        const preference = evidence.preferences.find(item => item.url.split('#')[0] === expected)
        assert.ok(preference, `必须加载真实应用入口：${expected}`)
        assert.equal(preference.webSecurity, true)
        assert.equal(preference.sandbox, true)
      }
    })
    await context.test('证书例外仅为会话级localhost精确SHA-256匹配', () => {
      const installation = evidence.trust.installation
      assert.equal(installation.ignoreCertificateErrors, false)
      assert.equal(installation.ignoreCertificateErrorsSpkiList, false)
      assert.equal(installation.disableWebSecurity, false)
      assert.notEqual(installation.nodeTlsRejectUnauthorized, '0')
      assert.ok(evidence.trust.verifications.length > 0, '必须观察真实Chromium证书验证调用')
      for (const verification of evidence.trust.verifications) {
        assert.equal(verification.result, verification.hostname === 'localhost' &&
          verification.fingerprint256 === certificate.fingerprint256 ? 0 : -3)
      }
      for (let index = 0; index < installation.sessionCount; index++) {
        assert.ok(evidence.trust.verifications.some(item => item.sessionIndex === index && item.result === 0),
          '每个实际页面会话必须通过精确证书信任而非全局绕过')
      }
    })
    for (const role of ['main', 'preview']) {
      await context.test(`${role === 'main' ? '主窗' : '预览'}：HTTPS自定义端口路径有CORS成功、无CORS拒绝`, () => {
        const measurement = evidence.windows[role]
        assert.equal(measurement.collectionError, undefined)
        assert.equal(measurement.cleanupError, undefined)
        assertEntry(measurement.url, role === 'main' ? MAIN_APPLICATION_URL : PREVIEW_APPLICATION_URL)
        assert.deepEqual(measurement.document, { origin: 'momentum-app://bundle', vueMounted: true })
        for (const route of ['denied', 'allowed']) {
          const requests = measurement.requests.filter(request => request.method === 'GET' && request.path === `${prefix}/${role}/${route}`)
          assert.equal(requests.length, 1, '服务端必须实际收到对应HTTPS GET，TLS/CSP失败不能冒充CORS拒绝')
          assert.equal(requests[0].host, new URL(evidence.base).host)
          assert.equal(requests[0].origin, 'momentum-app://bundle')
          assert.equal(requests[0].encrypted, true)
          assert.match(requests[0].tlsProtocol, /^TLSv1\.[23]$/)
          assert.equal(requests[0].servername, 'localhost')
          assert.equal(requests[0].accessControlAllowOrigin, route === 'allowed' ? 'momentum-app://bundle' : null)
        }
        assert.deepEqual(measurement.violations.filter(event => event.effectiveDirective === 'connect-src'), [])
        assert.deepEqual(measurement.fetches.map(fetch => fetch.result), ['blocked', 'isolated-https-response'])
        assert.equal(measurement.fetches[0].error.name, 'TypeError', '超时或TLS失败不能代替CORS拒绝')
        assert.equal(measurement.fetches[1].status, 200)
        assert.equal(measurement.fetches[1].type, 'cors')
      })
    }
    assert.deepEqual(desktop.errors, [])
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message }
    throw error
  } finally {
    try {
      if (desktop) {
        try {
          evidence.trust.finalVerifications = await desktop.application.evaluate(async () => {
            const state = globalThis.__privilegedHttpsProbe
            if (!state) return []
            // 恢复默认校验并结束连接；随后结束隔离进程，丢弃网络服务的验证缓存。
            for (const session of state.sessions) {
              session.setCertificateVerifyProc(null)
              await session.closeAllConnections()
            }
            delete globalThis.__privilegedHttpsProbe
            return state.verifications
          })
          evidence.trust.restoredDefault = true
        } catch (error) {
          evidence.trust.cleanupFailure = { name: error.name, message: error.message }
          throw error
        } finally {
          evidence.shutdown = {}
          await closeNormally(desktop, evidence.shutdown)
        }
      }
    } finally {
      try {
        if (server) {
          server.closeAllConnections()
          if (server.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
        }
      } finally {
        try {
          if (certificateDirectory) await rm(certificateDirectory, { recursive: true, force: true })
          evidence.certificate.privateKeyRemoved = true
        } finally {
          const evidencePath = path.join(root, 'privileged-https-security.json')
          await writeFile(evidencePath, JSON.stringify(evidence, null, 2))
          console.log(`有限HTTPS隔离验收证据（非公网证书验收）：${evidencePath}`)
        }
      }
    }
  }
})
