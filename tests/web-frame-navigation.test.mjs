import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { protectWebNavigation } from '../src/main/web-session-policy.js'

test('网页frame导航：兼容Electron事件对象中的URL并保持危险协议拒绝', () => {
  const contents = new EventEmitter()
  contents.setWindowOpenHandler = handler => { contents.open = handler }
  protectWebNavigation(contents)
  for (const [url, expected] of [['http://localhost:12345/custom/path', false], ['https://example.invalid/login', false], ['file:///private/probe', true], ['data:text/html,test', true], ['https://user:pass@example.invalid/', true]]) {
    let blocked = false
    contents.emit('will-frame-navigate', { url, isMainFrame: true, preventDefault: () => { blocked = true } })
    assert.equal(blocked, expected, url)
  }
  for (const name of ['will-navigate', 'will-redirect']) {
    let blocked = false
    contents.emit(name, { preventDefault: () => { blocked = true } }, 'http://localhost:12345/valid')
    assert.equal(blocked, false)
  }
  assert.deepEqual(contents.open(), { action: 'deny' })
  contents.emit('destroyed')
  for (const name of ['will-frame-navigate', 'will-navigate', 'will-redirect']) assert.equal(contents.listenerCount(name), 0)
})
