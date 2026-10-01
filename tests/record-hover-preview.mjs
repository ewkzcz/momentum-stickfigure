/** 悬浮参考首次采集入口：必须显式命名独立目录，原版业务源码干净时才允许执行。 */
import assert from 'node:assert/strict'
import { checkCanvasPresetHover } from './scenarios/canvas-preset-hover.mjs'

// 1、显式首次创建，既有目录及文件拒绝覆盖；采集后仍须在修改业务前完成回放。
assert.equal(process.argv.length, 3, '用法：node tests/record-hover-preview.mjs canvas-preset-hover-renderer1024-dpr1-v1')
await checkCanvasPresetHover(true, process.argv[2])
console.log('悬浮参考完整采集成功；业务迁移前必须至少只读回放一次')
