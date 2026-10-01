/** Electron35双版本原生库诊断；仅手动串行执行，不属于默认测试集。
 * node tests/helpers/canvas-coexistence-electron.mjs png|jpeg|webp valid|truncated
 * 固定只读temp/canvas-1.0.5-evaluation，不安装依赖、不向renderer暴露加载接口。
 * 生产入口/后台/文件/网络/子进程保护全部由原launchDesktop bootstrap强制安装。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchDesktop, repository } from './desktop.mjs'

const [format, kind] = process.argv.slice(2)
assert.ok(['png', 'jpeg', 'webp'].includes(format))
assert.ok(['valid', 'truncated'].includes(kind))
const evaluation = path.join(repository, 'temp/canvas-1.0.5-evaluation')
const baseline = JSON.parse(await readFile(path.join(evaluation, 'result.json'), 'utf8'))
const require = createRequire(import.meta.url)
assert.equal(require('@napi-rs/canvas/package.json').version, '0.1.83')
const { createCanvas } = require('@napi-rs/canvas')
const canvas = createCanvas(8, 6)
canvas.getContext('2d').fillRect(0, 0, 8, 6)
const valid = canvas.toBuffer(`image/${format}`)
const input = kind === 'valid' ? valid : valid.subarray(0, format === 'jpeg' ? valid.indexOf(Buffer.from([255, 218])) : 30)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const expected = baseline.results.find(item => item.format === format && item.kind === kind)
const expectedValid = baseline.results.find(item => item.format === format && item.kind === 'valid')
assert.equal(hash(input), expected.sha256, '必须复用同hash诊断输入')
assert.equal(hash(valid), expectedValid.sha256)
const expectedPixels = JSON.parse(expectedValid.stdout.trim().split('\n').at(-1)).rgba
const desktop = await launchDesktop()
const child = desktop.application.process()
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
const evidence = { format, kind, sha256: hash(input), expectedPixels, root: desktop.root, passed: false,
  scope: '隔离Electron生产入口中的两版本共存及六个小图样本；不是alias安装、打包、PSD全量像素或内存验收' }
let failure
try {
  evidence.main = await desktop.application.evaluate((_electron, args) => new Promise((resolve, reject) => {
    // 避免inspector evaluate栈内直接进入原生库，保持正常主进程事件循环执行。
    setImmediate(async () => {
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      const crypto = process.getBuiltinModule('crypto')
      const req = process.getBuiltinModule('module').createRequire(path.join(args.repository, 'package.json'))
      const stages = []
      const mark = (stage, details = {}) => {
        stages.push({ stage, ...details })
        fs.writeFileSync(path.join(globalThis.__momentumTest.root, 'canvas-coexistence-stages.json'), JSON.stringify(stages, null, 2))
      }
      try {
        if (!globalThis.__momentumTest?.backgroundPolicy.snapshot().installed) throw new Error('强制后台保护未安装')
        const oldEntry = req.resolve('@napi-rs/canvas')
        const oldAlreadyImported = !!req.cache[oldEntry]
        mark('old:cache', { oldEntry, oldAlreadyImported })
        if (!oldAlreadyImported) throw new Error('生产入口尚未导入旧库，不能当成已导入共存场景')
        const old = req(oldEntry)
        const oldVersion = req('@napi-rs/canvas/package.json').version
        if (oldVersion !== '0.1.83') throw new Error('旧库版本意外变化')
        const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
        const valid = Buffer.from(args.valid, 'base64'), input = Buffer.from(args.input, 'base64')
        if (digest(input) !== args.sha256) throw new Error('主进程输入hash不一致')
        const decode = async (library, bytes) => {
          const image = await library.loadImage(bytes)
          const target = library.createCanvas(image.width, image.height)
          const ctx = target.getContext('2d')
          ctx.drawImage(image, 0, 0)
          return { width: image.width, height: image.height, rgba: digest(ctx.getImageData(0, 0, image.width, image.height).data) }
        }
        mark('old:before:start')
        const before = await decode(old, valid)
        mark('old:before:done', before)
        const nativeBefore = Object.keys(req.cache).filter(file => file.endsWith('.node'))
        const candidateEntry = path.join(args.evaluation, 'node_modules/@napi-rs/canvas/index.js')
        mark('candidate:import:start', { candidateEntry })
        const candidate = req(candidateEntry)
        const candidateVersion = req(path.join(args.evaluation, 'node_modules/@napi-rs/canvas/package.json')).version
        if (candidateVersion !== '1.0.5' || candidate === old) throw new Error('未独立加载精确新版')
        const nativeAfter = Object.keys(req.cache).filter(file => file.endsWith('.node'))
        mark('candidate:import:done', { candidateVersion, nativeBefore, nativeAfter })
        let outcome
        mark('candidate:decode:start', { kind: args.kind })
        try { outcome = { outcome: 'accepted', ...await decode(candidate, input) } }
        catch (error) { outcome = { outcome: 'rejected', message: error.message } }
        mark('candidate:decode:done', outcome)
        if (req(oldEntry) !== old) throw new Error('新版加载改变旧库模块身份')
        mark('old:after:start')
        const after = await decode(old, valid)
        mark('old:after:done', after)
        resolve({ versions: { electron: process.versions.electron, node: process.versions.node, napi: process.versions.napi, old: oldVersion, candidate: candidateVersion }, oldAlreadyImported, nativeBefore, nativeAfter, before, after, outcome })
      } catch (error) { mark('failure', { message: error.message }); reject(error) }
    })
  }), { repository, evaluation, valid: valid.toString('base64'), input: input.toString('base64'), sha256: hash(input), kind })
  const result = evidence.main
  assert.equal(result.versions.electron, '35.7.5')
  assert.equal(result.versions.old, '0.1.83')
  assert.equal(result.versions.candidate, '1.0.5')
  assert.equal(result.oldAlreadyImported, true)
  assert.ok(result.nativeAfter.some(file => !result.nativeBefore.includes(file) && file.startsWith(evaluation + path.sep)), '新版原生库必须从隔离安装目录独立加载')
  assert.deepEqual(result.before, { width: 8, height: 6, rgba: expectedPixels })
  assert.deepEqual(result.after, result.before, '并存后旧版实际像素保持一致')
  if (kind === 'valid') assert.deepEqual(result.outcome, { outcome: 'accepted', ...result.before })
  else {
    assert.equal(result.outcome.outcome, 'rejected')
    assert.match(result.outcome.message, /Unsupported image type/)
  }
  assert.deepEqual(desktop.errors, [])
} catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack } }
finally {
  try { await desktop.close() }
  catch (error) { evidence.closeFailure = error.message; failure ||= error; await desktop.application.close().catch(() => {}) }
  evidence.exit = await exited
  try {
    assert.deepEqual(evidence.exit, { code: 0, signal: null }, '必须正常退出；解码断言结束不等于原生析构安全')
  } catch (error) { failure ||= error; evidence.exitFailure = error.message }
  evidence.passed = !failure
  await writeFile(path.join(desktop.root, 'canvas-coexistence.json'), JSON.stringify(evidence, null, 2))
  console.log(`Electron双版本诊断证据：${desktop.root}`)
}
if (failure) throw failure
