import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import { requestTaskResponse } from '../src/main/task-http-request.mjs'

test('任务HTTP：本地请求成功、取消、超时、响应上限及恢复', { timeout: 15000 }, async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/hold') return
    res.end(req.url === '/large' ? 'x'.repeat(4096) : '中文响应')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const url = new URL(`http://127.0.0.1:${server.address().port}`)
  const options = { hostname: url.hostname, port: url.port, method: 'POST', path: '/', timeout: 1000 }
  try {
    assert.deepEqual(await requestTaskResponse(url, options, ''), { statusCode: 200, data: '中文响应' })
    const controller = new globalThis.AbortController()
    const arrival = once(server, 'request')
    const running = requestTaskResponse(url, { ...options, path: '/hold' }, '', { signal: controller.signal })
    const rejected = assert.rejects(running, { name: 'AbortError' })
    const [request] = await arrival
    const disconnected = once(request.socket, 'close')
    controller.abort()
    await rejected
    await disconnected
    await assert.rejects(requestTaskResponse(url, { ...options, path: '/hold', timeout: 50 }, ''), /超时/)
    await assert.rejects(requestTaskResponse(url, { ...options, path: '/large' }, '', { maxBytes: 100 }), /超过限制/)
    assert.equal((await requestTaskResponse(url, options, '')).data, '中文响应')
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
