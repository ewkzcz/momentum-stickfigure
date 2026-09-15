import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { registerTrustedWindow, isTrustedIpcSender } from '../src/main/ipc-sender-policy.js'

test('IPC身份要求已授予窗口、固定来源、顶层frame且未销毁', () => {
  const sender = new EventEmitter(), mainFrame = { url: 'file:///application/index.html#/home' }
  Object.assign(sender, { mainFrame, isDestroyed: () => false })
  const event = { sender, senderFrame: mainFrame }
  assert.equal(isTrustedIpcSender(event), false)
  registerTrustedWindow(sender, 'file:///application/index.html', 'main')
  assert.equal(isTrustedIpcSender(event), true)
  assert.equal(isTrustedIpcSender({ sender, senderFrame: { ...mainFrame } }), false)
  mainFrame.url = 'https://untrusted.invalid/'
  assert.equal(isTrustedIpcSender(event), false)
  mainFrame.url = 'file:///application/other.html'
  assert.equal(isTrustedIpcSender(event), false)
  mainFrame.url = 'file:///application/index.html#/settings'
  assert.equal(isTrustedIpcSender(event), true)
  sender.emit('destroyed')
  assert.equal(isTrustedIpcSender(event), false)
})

test('IPC角色与开发来源严格匹配，缺失信息默认拒绝', () => {
  const sender = new EventEmitter(), mainFrame = { url: 'http://127.0.0.1:5555/canvas-preview.html' }
  Object.assign(sender, { mainFrame, isDestroyed: () => false })
  registerTrustedWindow(sender, mainFrame.url, 'preview')
  const event = { sender, senderFrame: mainFrame }
  assert.equal(isTrustedIpcSender(event), false)
  assert.equal(isTrustedIpcSender(event, ['preview']), true)
  mainFrame.url = 'http://127.0.0.1:5556/canvas-preview.html'
  assert.equal(isTrustedIpcSender(event, ['preview']), false)
  for (const invalid of [null, {}, { sender }, { senderFrame: mainFrame }]) assert.equal(isTrustedIpcSender(invalid), false)
})
