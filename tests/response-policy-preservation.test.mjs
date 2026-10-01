import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDesktop } from './helpers/desktop.mjs'

test('会话响应策略：保持远程页面CSP和CORS原值，不替换视频或预检状态', { timeout: 60000 }, async () => {
  const csp = "default-src 'none'; script-src 'none'; style-src 'self'; frame-ancestors 'none'"
  const server = createServer((req, res) => {
    res.writeHead(req.method === 'OPTIONS' ? 403 : 200, { 'Content-Type': 'text/html', 'Content-Security-Policy': csp, 'Access-Control-Allow-Origin': 'https://allowed.invalid' })
    res.end('<!doctype html><title>headers retained</title><body>safe</body>')
  })
  server.listen(0, 'localhost'); await once(server, 'listening')
  let desktop
  try {
    desktop = await launchDesktop()
    const url = `http://localhost:${server.address().port}/video-policy`
    const result = await desktop.application.evaluate(async ({ net, session }, url) => {
      const responses = []
      for (const method of ['GET', 'OPTIONS']) {
        const response = await net.fetch(url, { method, session: session.defaultSession })
        responses.push({ status: response.status, csp: response.headers.get('content-security-policy'), cors: response.headers.get('access-control-allow-origin') })
        await response.text()
      }
      return responses
    }, url)
    assert.deepEqual(result, [{ status: 200, csp, cors: 'https://allowed.invalid' }, { status: 403, csp, cors: 'https://allowed.invalid' }])
  } finally {
    // 启动或关闭失败也必须释放测试HTTP服务，保留原失败而不留下监听进程。
    try { if (desktop) await desktop.close() } finally {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
})
