/** HTTP请求取消后等待close，限制响应体并清理信号监听。 */
import http from 'node:http'
import https from 'node:https'

export function requestTaskResponse(url, options, body, { signal, maxBytes = 8 * 1024 * 1024 } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason)
  return new Promise((resolve, reject) => {
    let failure, response, size = 0
    const chunks = []
    const finishError = error => { failure ||= error; request.destroy(error) }
    const abort = () => finishError(signal.reason)
    const request = (url.protocol === 'https:' ? https : http).request({ ...options, agent: false, signal }, res => {
      response = res
      res.on('data', chunk => {
        size += chunk.length
        if (size > maxBytes) finishError(new Error('API响应超过限制'))
        else chunks.push(chunk)
      })
      res.on('error', error => { failure ||= error })
    })
    request.on('error', error => { failure ||= error })
    request.on('timeout', () => finishError(new Error('API请求超时')))
    request.once('close', () => {
      signal?.removeEventListener('abort', abort)
      if (failure || !response?.complete) reject(failure || new Error('API响应未完整接收'))
      else resolve({ statusCode: response.statusCode, data: Buffer.concat(chunks).toString('utf8') })
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    else request.end(body)
  })
}
