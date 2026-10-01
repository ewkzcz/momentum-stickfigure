/** PSD 会话首次参考采集入口：仅接受显式命名的新目录，原提交干净业务构建后运行。 */
import assert from 'node:assert/strict'
import { checkPsdSession } from './scenarios/psd-session.mjs'

// 1、拒绝隐式采集与覆盖，完成后仍须在迁移前通过只读回放。
assert.equal(process.argv.length, 3, '用法：node tests/record-psd-session.mjs psd-session-renderer1024-dpr1-v1')
await checkPsdSession(true, process.argv[2])
console.log('原版 PSD 会话参考采集完成；迁移前必须只读回放通过')
