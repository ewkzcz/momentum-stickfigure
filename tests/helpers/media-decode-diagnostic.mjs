/** 单进程原生解码阶段诊断。仅由验收端逐条启动；不派生进程、不修改文件或保护。
 * node tests/helpers/media-decode-diagnostic.mjs png|jpeg|webp encode|valid|truncated|sequence production|load-image|image
 * 最后一个同步JSON标记用于区分导入、编码、src赋值、回调、断言及自然退出阶段。
 * 原生崩溃必须连同退出码/信号判为失败；本脚本不是产品隔离或安全修复。
 */
import fs from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'

const [format, mode, backend = 'production'] = process.argv.slice(2)
assert.ok(['png', 'jpeg', 'webp'].includes(format), '格式必须为png/jpeg/webp')
assert.ok(['encode', 'valid', 'truncated', 'sequence'].includes(mode), '诊断模式无效')
assert.ok(['production', 'load-image', 'image'].includes(backend), '解码入口无效')
const mime = `image/${format}`
const mark = (stage, details = {}) => fs.writeSync(1, JSON.stringify({ stage, format, mode, backend, ...details }) + '\n')
process.once('beforeExit', code => mark('process:beforeExit', { code }))
process.once('exit', code => mark('process:exit', { code }))
mark('canvas:import:start', { node: process.version, platform: process.platform, arch: process.arch })
const { createCanvas, loadImage, Image } = await import('@napi-rs/canvas')
const require = createRequire(import.meta.url)
mark('canvas:import:done', { entry: require.resolve('@napi-rs/canvas'), version: require('@napi-rs/canvas/package.json').version })
let validateImage
if (backend === 'production') {
  mark('production:import:start')
  ;({ validateImage } = await import('../../src/main/local-media-authorization.js'))
  const entry = require.resolve('@momentum/media-canvas')
  const version = require('@momentum/media-canvas/package.json').version
  assert.equal(version, '1.0.5')
  assert.ok(require.cache[entry], '生产入口必须已加载媒体alias，诊断不能代为加载')
  mark('production:import:done', { entry, version, nativePaths: Object.keys(require.cache).filter(file => file.endsWith('.node')) })
}
mark('canvas:create:start')
const canvas = createCanvas(8, 6)
mark('canvas:create:done')
canvas.getContext('2d').fillRect(0, 0, 8, 6)
mark('canvas:fill:done')
mark('encode:start')
const bytes = canvas.toBuffer(mime)
mark('encode:done', { length: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
const headerEnd = mime === 'image/jpeg' ? bytes.indexOf(Buffer.from([255, 218])) : 30
assert.ok(headerEnd > 0 && headerEnd < bytes.length, '截断位置必须落在合法编码数据内部')

async function decode(input, kind) {
  mark('decode:call', { kind, length: input.length })
  let result
  if (backend === 'production') result = await validateImage(input)
  else if (backend === 'load-image') result = await loadImage(input)
  else result = await new Promise((resolve, reject) => {
    mark('native:new:start', { kind })
    const image = new Image()
    mark('native:new:done', { kind })
    image.onload = () => { mark('native:onload', { kind, width: image.width, height: image.height }); resolve(image) }
    image.onerror = error => { mark('native:onerror', { kind, error: String(error) }); reject(error) }
    mark('native:src:start', { kind })
    image.src = input
    mark('native:src:return', { kind })
  })
  mark('decode:resolved', { kind, width: result.width, height: result.height })
  return result
}

if (mode === 'valid' || mode === 'sequence') {
  const image = await decode(bytes, 'valid')
  assert.equal(image.width, 8)
  assert.equal(image.height, 6)
  if (backend === 'production') assert.deepEqual(image, { mime, width: 8, height: 6, pixels: 48 })
  mark('valid:assertions:done')
}
if (mode === 'truncated' || mode === 'sequence') {
  mark('truncated:prepared', { length: headerEnd })
  await assert.rejects(async () => {
    try { return await decode(bytes.subarray(0, headerEnd), 'truncated') }
    catch (error) { mark('decode:rejected', { kind: 'truncated', error: String(error) }); throw error }
  })
  mark('truncated:assertions:done')
}
if (mode === 'sequence') {
  const image = await decode(bytes, 'valid-after-rejection')
  assert.equal(image.width, 8)
  assert.equal(image.height, 6)
  if (backend === 'production') assert.deepEqual(image, { mime, width: 8, height: 6, pixels: 48 })
  mark('recovery:assertions:done')
}
mark('script:done')
// 不强制process.exit，不延时掩盖：自然退出时的崩溃也是失败。
