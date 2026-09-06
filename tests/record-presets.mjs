/** 预设及布局参考补充：原业务未改时显式采集，独立目录禁止覆盖。 */
import assert from 'node:assert/strict'
import { checkPresetLifecycle } from './scenarios/presets.mjs'

// 1、必须明确命名新环境；旧参考仍只读，采集成功不等于候选已通过重复回放。
const referenceName = process.argv[2]
assert.ok(referenceName, '请明确指定新环境名称，例如：node tests/record-presets.mjs preset-lifecycle-renderer1024-dpr1-focus-v1')
assert.equal(process.argv.length, 3, '只能提供一个独立环境名称')
await checkPresetLifecycle(true, referenceName)
console.log(`候选已采集：${referenceName}；必须至少两次独立零差异回放后才可接受`)
