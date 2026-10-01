/** 手动mac-arm64打包依赖诊断，不在默认测试集内。
 * node tests/helpers/canvas-packaged-asar-electron.mjs png|jpeg|webp valid|truncated
 * 仅沿launchDesktop强制bootstrap启动工作区入口，再加载固定app.asar内的库。
 * 不启动打包应用入口；不代表安装产物功能、签名、系统交互或资源预算通过。
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import { launchDesktop, repository } from './desktop.mjs'

const [format, kind, ...extra] = process.argv.slice(2)
assert.ok(['png', 'jpeg', 'webp'].includes(format))
assert.ok(['valid', 'truncated'].includes(kind))
assert.deepEqual(extra, [])
assert.equal(process.platform, 'darwin')
assert.equal(process.arch, 'arm64')
const archive = path.join(repository, 'temp/media-canvas-package-evaluation/mac-arm64/时刻简笔画免登录版本.app/Contents/Resources/app.asar')
const archiveStat = await stat(archive)
assert.ok(archiveStat.isFile())
const baseline = JSON.parse(await readFile(path.join(repository, 'temp/canvas-1.0.5-evaluation/result.json'), 'utf8'))
const req = createRequire(import.meta.url)
assert.equal(req('@napi-rs/canvas/package.json').version, '0.1.83')
// 工作区旧库只用于生成已知合法输入，绝不向它提交截断数据。
const canvas = req('@napi-rs/canvas').createCanvas(8, 6)
canvas.getContext('2d').fillRect(0, 0, 8, 6)
const valid = canvas.toBuffer(`image/${format}`)
const headerEnd = format === 'jpeg' ? valid.indexOf(Buffer.from([255, 218])) : 30
assert.ok(headerEnd > 0 && headerEnd < valid.length)
const input = kind === 'valid' ? valid : valid.subarray(0, headerEnd)
const hash = bytes => createHash('sha256').update(bytes).digest('hex')
const expected = baseline.results.find(item => item.format === format && item.kind === kind)
const expectedValid = baseline.results.find(item => item.format === format && item.kind === 'valid')
assert.ok(expected && expectedValid)
assert.equal(hash(input), expected.sha256)
assert.equal(hash(valid), expectedValid.sha256)
const expectedPixels = JSON.parse(expectedValid.stdout.trim().split('\n').at(-1)).rgba
const desktop = await launchDesktop()
const child = desktop.application.process()
const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
const evidence = { format, kind, archive, archiveStat: { size: archiveStat.size, mtimeMs: archiveStat.mtimeMs },
  sha256: hash(input), validSha256: hash(valid), expectedPixels, root: desktop.root, passed: false,
  scope: '工作区Electron/生产入口及强制bootstrap中加载打包ASAR依赖；非打包可执行文件或打包应用入口启动，非安装产物功能验收' }
let failure
try {
  evidence.main = await desktop.application.evaluate((_electron, args) => new Promise((resolve, reject) => {
    setImmediate(async () => {
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      const crypto = process.getBuiltinModule('crypto')
      const createRequire = process.getBuiltinModule('module').createRequire
      const stages = []
      const mark = (stage, details = {}) => {
        stages.push({ stage, ...details })
        fs.writeFileSync(path.join(globalThis.__momentumTest.root, 'canvas-packaged-asar-stages.json'), JSON.stringify(stages, null, 2))
      }
      const check = (condition, message) => { if (!condition) throw new Error(message) }
      try {
        check(globalThis.__momentumTest?.backgroundPolicy.snapshot().installed, '强制bootstrap保护未安装')
        check(process.platform === 'darwin' && process.arch === 'arm64', '仅允许darwin arm64')
        check(!process.noAsar, 'ASAR支持不得关闭')
        check(!process.env.NAPI_RS_NATIVE_LIBRARY_PATH && !process.env.NAPI_RS_FORCE_WASI, '不得重定向原生库')
        const archive = args.archive, unpacked = archive + '.unpacked'
        const packedRequire = createRequire(path.join(archive, 'package.json'))
        const isInside = (file, root) => file.startsWith(root + path.sep)
        const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex')
        const valid = Buffer.from(args.valid, 'base64'), input = Buffer.from(args.input, 'base64')
        check(digest(valid) === args.validSha256 && digest(input) === args.sha256, '输入hash不一致')
        const nativeBefore = Object.keys(packedRequire.cache).filter(file => file.endsWith('.node'))
        const sharedBefore = process.report.getReport().sharedObjects
        mark('environment', { electron: process.versions.electron, node: process.versions.node, napi: process.versions.napi,
          archive, nativeBefore, sharedBefore, execPath: process.execPath })

        function locate(name, version) {
          const root = path.join(archive, 'node_modules', name)
          const entry = packedRequire.resolve(name)
          const packageFile = packedRequire.resolve(name + '/package.json')
          check(isInside(entry, root) && packageFile === path.join(root, 'package.json'), 'JS解析脱离打包包目录')
          check(packedRequire(packageFile).version === version, '打包JS版本不符')
          const localRequire = createRequire(packageFile)
          const platformRoot = path.join(root, 'node_modules/@napi-rs/canvas-darwin-arm64')
          const native = localRequire.resolve('@napi-rs/canvas-darwin-arm64')
          const platformPackage = localRequire.resolve('@napi-rs/canvas-darwin-arm64/package.json')
          check(isInside(native, platformRoot) && native.endsWith('.node'), '平台库解析脱离该版本的嵌套目录')
          check(platformPackage === path.join(platformRoot, 'package.json'), '平台包发生工作区/其他版本兜底')
          check(localRequire(platformPackage).version === version, '打包平台包版本不符')
          const physicalNative = unpacked + native.slice(archive.length)
          const physicalPackage = unpacked + platformPackage.slice(archive.length)
          check(fs.statSync(physicalNative).isFile(), 'unpacked原生文件不存在')
          check(JSON.parse(fs.readFileSync(physicalPackage, 'utf8')).version === version, 'unpacked平台版本不符')
          const realNative = fs.realpathSync(physicalNative)
          check(isInside(realNative, fs.realpathSync(unpacked)), '原生文件真实路径脱离unpacked')
          check(!packedRequire.cache[entry] && !packedRequire.cache[native], '诊断前打包库已加载，不能证明本次独立加载')
          return { name, version, root, entry, packageFile, native, platformPackage, physicalNative, realNative }
        }
        const oldLocation = locate('@napi-rs/canvas', '0.1.83')
        const mediaLocation = locate('@momentum/media-canvas', '1.0.5')
        check(oldLocation.native !== mediaLocation.native, '两版本原生解析相同')
        mark('resolved', { oldLocation, mediaLocation })

        // 只检查本库的实际模块依赖图，不把已经加载的工作区生产模块当成打包证据。
        function verifyLoaded(location) {
          const seen = new Set(), files = []
          function visit(module) {
            if (!module || seen.has(module.id)) return
            seen.add(module.id)
            check(isInside(module.filename, location.root), `打包库依赖图出现外部兜底：${module.filename}`)
            files.push(module.filename)
            for (const child of module.children) visit(child)
          }
          visit(packedRequire.cache[location.entry])
          check(files.includes(location.entry) && files.includes(location.native), '未实际加载所解析的JS/原生模块')
          const natives = files.filter(file => file.endsWith('.node'))
          check(natives.length === 1 && natives[0] === location.native, '实际原生库不是预定的唯一版本')
          const sharedObjects = process.report.getReport().sharedObjects
          check(sharedObjects.some(file => {
            try { return fs.realpathSync(file) === location.realNative } catch { return false }
          }), '进程已加载动态库清单缺少对应unpacked原生文件')
          return { files, sharedObjects }
        }
        const decode = async (library, bytes) => {
          const image = await library.loadImage(bytes)
          check(image.width === 8 && image.height === 6, '解码尺寸不符')
          const target = library.createCanvas(8, 6)
          const context = target.getContext('2d')
          context.drawImage(image, 0, 0)
          return { width: image.width, height: image.height, rgba: digest(context.getImageData(0, 0, 8, 6).data) }
        }
        mark('old:load:start')
        const old = packedRequire(oldLocation.entry)
        const oldLoaded = verifyLoaded(oldLocation)
        mark('old:load:done', oldLoaded)
        const before = await decode(old, valid)
        mark('old:decode:done', before)
        mark('media:load:start')
        const media = packedRequire(mediaLocation.entry)
        check(media !== old, '两版本JS对象必须独立')
        const mediaLoaded = verifyLoaded(mediaLocation)
        mark('media:load:done', mediaLoaded)
        let outcome
        mark('media:decode:start', { kind: args.kind })
        try { outcome = { outcome: 'accepted', ...await decode(media, input) } }
        catch (error) { outcome = { outcome: 'rejected', message: error.message } }
        mark('media:decode:done', outcome)
        const recovery = await decode(media, valid)
        mark('media:recovery:done', recovery)
        check(packedRequire(oldLocation.entry) === old, '加载媒体库改变了旧库模块身份')
        const after = await decode(old, valid)
        mark('old:after:done', after)
        resolve({ versions: { electron: process.versions.electron, node: process.versions.node, napi: process.versions.napi },
          oldLocation, mediaLocation, oldLoaded, mediaLoaded, before, outcome, recovery, after })
      } catch (error) { mark('failure', { message: error.message }); reject(error) }
    })
  }), { archive, valid: valid.toString('base64'), input: input.toString('base64'), sha256: hash(input), validSha256: hash(valid), kind })
  const result = evidence.main
  assert.equal(result.versions.electron, '35.7.5')
  assert.equal(result.versions.node, '22.16.0')
  const pixels = { width: 8, height: 6, rgba: expectedPixels }
  assert.deepEqual(result.before, pixels)
  assert.deepEqual(result.after, pixels, '加载新版后旧库像素不得变化')
  assert.deepEqual(result.recovery, pixels, '新版解码后仍须正常恢复')
  if (kind === 'valid') assert.deepEqual(result.outcome, { outcome: 'accepted', ...pixels })
  else {
    assert.equal(result.outcome.outcome, 'rejected')
    assert.match(result.outcome.message, /Unsupported image type/)
  }
  assert.deepEqual(desktop.errors, [])
  const after = await stat(archive)
  assert.deepEqual({ size: after.size, mtimeMs: after.mtimeMs }, evidence.archiveStat, '诊断期间打包ASAR不得改动')
} catch (error) { failure = error; evidence.failure = { message: error.message, stack: error.stack } }
finally {
  try { await desktop.close() }
  catch (error) {
    evidence.closeFailure = error.message
    failure ||= error
    try { await desktop.application.close() } catch (closeError) { evidence.fallbackCloseFailure = closeError.message }
  }
  // exit监听在诊断开始前注册；不以进程内断言成功代替正常退出。
  if (child.exitCode !== null || child.signalCode !== null) evidence.exit = await exited
  else {
    evidence.exit = { code: child.exitCode, signal: child.signalCode }
    failure ||= new Error('关闭后进程仍未退出；诊断失败，不强制杀进程伪装自然退出')
  }
  try { assert.deepEqual(evidence.exit, { code: 0, signal: null }, '原生库必须随应用正常退出') }
  catch (error) { failure ||= error; evidence.exitFailure = error.message }
  evidence.passed = !failure
  await writeFile(path.join(desktop.root, 'canvas-packaged-asar.json'), JSON.stringify(evidence, null, 2))
}
if (failure) throw failure
