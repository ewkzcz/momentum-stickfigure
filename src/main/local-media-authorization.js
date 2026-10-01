/** 精确媒体能力：不依赖Electron；只有主进程可信选择/成功写入/已校验产物调用grant。 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { loadImage } from '@momentum/media-canvas'
import { validatePngStructure } from './png-media-validation.js'
import { EventEmitter } from 'node:events'
import { withMediaAdmission, runMediaOperation } from './media-resource-admission.js'
import { assertOwnedFilePath, writeOwnedFile } from './file-access-policy.js'
import { assertImageBase64 } from './template-image-parameters.js'

// 以下像素数仍是未验收候选，只有声明尺寸约束，不是有效的解码内存总预算。
// 4K×8不是历史产品承诺；单图约2GiB RGBA及files倍累计值均缺乏实际内存依据。
// 共享准入只限制在途阶段；单图与批量支持上限仍需大图/原生内存验证。
export const MEDIA_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, batchBytes: 128 * 1024 * 1024, pixels: 3840 * 2160 * 8 * 8, batchPixels: 3840 * 2160 * 8 * 8 * 10000, files: 10000 })
export function assertImageDimensions(width, height, scale = 1) {
  const outputWidth = Math.floor(width * scale), outputHeight = Math.floor(height * scale)
  const pixels = outputWidth * outputHeight
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || !Number.isFinite(scale) || scale <= 0 || !Number.isSafeInteger(pixels) || outputWidth < 1 || outputHeight < 1 || pixels > MEDIA_LIMITS.pixels) throw new Error('图片尺寸超过媒体像素预算')
  return pixels
}
const owners = new WeakMap()
const destroyedOwners = new WeakSet()
const identity = stat => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`
function state(owner) {
  if (!owner || owner.isDestroyed() || destroyedOwners.has(owner)) throw new Error('媒体来源已关闭')
  let value = owners.get(owner)
  if (!value) {
    value = { media: new Map(), inputs: new Map(), outputs: new Map() }
    owners.set(owner, value)
    owner.once('destroyed', () => { destroyedOwners.add(owner); owners.delete(owner) })
  }
  return value
}
export function canonicalFile(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.length > 32768 || value.includes('\0')) throw new Error('文件路径未授权')
  const absolute = path.resolve(value)
  let current = path.parse(absolute).root
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part)
    if (fs.lstatSync(current).isSymbolicLink()) {
      // macOS系统根别名不由应用用户控制；其余路径分量一律拒绝链接。
      const systemAlias = process.platform === 'darwin' && ['/var', '/tmp'].includes(current) && fs.realpathSync(current) === '/private' + current
      if (!systemAlias) throw new Error('不允许路径符号链接')
    }
  }
  return fs.realpathSync(absolute)
}
function inspectFile(file, maximum, check, retain = true) {
  check()
  const canonical = canonicalFile(file)
  const fd = fs.openSync(path.resolve(file), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.nlink !== 1 || before.size < 0 || before.size > maximum) throw new Error('文件类型或大小超过限制')
    // 完整复核只分配固定小块；首读仍使用生产原有Buffer.alloc(size)路径。
    const bytes = Buffer.alloc(retain ? before.size : Math.min(65536, before.size))
    const hash = createHash('sha256')
    let read = 0
    while (read < before.size) {
      check()
      const offset = retain ? read : 0
      const count = fs.readSync(fd, bytes, offset, Math.min(bytes.length - offset, before.size - read), read)
      if (!count) throw new Error('文件读取不完整')
      hash.update(bytes.subarray(offset, offset + count))
      read += count
    }
    const after = fs.fstatSync(fd)
    if (identity(before) !== identity(after) || identity(fs.statSync(file)) !== identity(after) || read !== before.size || canonicalFile(file) !== canonical) throw new Error('文件在读取期间发生变化')
    check()
    return { canonical, identity: identity(after) + ':' + hash.digest('hex'), size: before.size, ...(retain ? { bytes } : {}) }
  } finally { fs.closeSync(fd) }
}
function recheck(file, checked, maximum, check) {
  const current = inspectFile(file, maximum, check, false)
  if (current.canonical !== checked.canonical || current.identity !== checked.identity) throw new Error('文件在处理期间发生变化')
}
function ownerCheck(owner, context) {
  return () => { context.check(); state(owner) }
}
const diagnosticOwner = Object.assign(new EventEmitter(), { isDestroyed: () => false })
/** 独立诊断兼容入口：不覆盖调用前已创建的Buffer；生产消费仅走下面私有实现。 */
export function validateImage(bytes) {
  return withMediaAdmission({ owner: diagnosticOwner }, lease => runMediaOperation(lease, context => decodeImage(bytes, context)))
}
async function decodeImage(bytes, context) {
  context.check()
  try { return await decodeRaster(bytes, context) }
  catch (error) {
    context.check() // 取消保持原原因，不能误报坏图；原生运行错误也不降格为可吞格式错误。
    throw error
  }
}

/** 私有真实解码：只返回元数据，不允许额度外取得原生Image或整文件bytes。 */
async function decodeRaster(bytes, context) {
  let width, height, mime, pixels
  try {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20); mime = 'image/png'
  } else if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) break
      while (bytes[offset] === 255) offset++
      const marker = bytes[offset++]
      if (marker === 217 || marker === 218) break
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue
      if (offset + 2 > bytes.length) break
      const length = bytes.readUInt16BE(offset)
      if (length < 2 || offset + length > bytes.length) break
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker) && length >= 8) {
        height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); mime = 'image/jpeg'; break
      }
      offset += length
    }
  } else if (bytes.length >= 30 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') {
    const kind = bytes.toString('ascii', 12, 16)
    if (kind === 'VP8X') { width = 1 + bytes.readUIntLE(24, 3); height = 1 + bytes.readUIntLE(27, 3) }
    else if (kind === 'VP8 ' && bytes[23] === 157 && bytes[24] === 1 && bytes[25] === 42) {
      width = bytes.readUInt16LE(26) & 16383; height = bytes.readUInt16LE(28) & 16383
    } else if (kind === 'VP8L' && bytes[20] === 47) {
      const bits = bytes.readUInt32LE(21); width = (bits & 16383) + 1; height = ((bits >>> 14) & 16383) + 1
    }
    mime = 'image/webp'
  }
  pixels = assertImageDimensions(width, height)
  if (!mime || bytes.length > MEDIA_LIMITS.bytes) throw new Error('图片格式、尺寸或容量无效')
  if (mime === 'image/png') await validatePngStructure(bytes, { signal: context.signal })
  } catch (error) {
    context.check()
    throw Object.assign(new Error(error.message, { cause: error }), { code: 'MEDIA_INVALID_IMAGE' })
  }
  context.check()
  // 仅媒体使用独立alias（依赖锁定1.0.5）；PSD及旧渲染导入保持旧库。
  // 这里只限制在途工作；尺寸/批像素仍是未验收支持边界，不代表内存硬预算。
  // 实际解码仍必需；JPEG/WebP容错解码不等于所有编码损坏都会拒绝。
  let image
  try { image = await loadImage(bytes) }
  catch (error) {
    context.check()
    // 已锁定媒体库的明确格式拒绝；内存/运行异常不能当作非法图吞掉。
    if (error.message === 'Unsupported image type') throw Object.assign(new Error(error.message, { cause: error }), { code: 'MEDIA_INVALID_IMAGE' })
    throw error
  }
  context.check() // 原生已开始必须等待真实settle，不以取消抢先释放。
  if (image.width !== width || image.height !== height) throw Object.assign(new Error('图片解码与头部尺寸不一致'), { code: 'MEDIA_INVALID_IMAGE' })
  return { mime, width, height, pixels }
}

function registerFiles(owner, entries) {
  const value = state(owner)
  const changes = []
  for (const [file, checked, image] of entries) {
    const key = path.resolve(file)
    const record = { canonical: checked.canonical, identity: checked.identity, ...image }
    for (const map of image ? [value.inputs, value.media] : [value.inputs]) {
      changes.push({ map, key, previous: map.get(key), record })
      map.set(key, record)
    }
  }
  // 只撤销本次登记，不能覆盖并发请求后来授予的能力。
  let rolledBack = false
  return () => {
    if (rolledBack) return
    rolledBack = true
    for (const { map, key, previous, record } of [...changes].reverse()) if (map.get(key) === record) {
      if (previous) map.set(key, previous)
      else map.delete(key)
    }
  }
}
// 注册回滚在阶段成功交付前也必须可用：取消恰好落在登记后的微任务间隙仍撤销。
async function admittedGrant(owner, signal, run) {
  let result
  try { return await withMediaAdmission({ owner, signal }, async lease => { result = await run(lease); return result }) }
  catch (error) { result?.rollback(); throw error }
}
async function grantBatch(owner, files, context, { input = false, preview = false } = {}) {
  const check = ownerCheck(owner, context)
  check()
  if (!Array.isArray(files) || files.length > MEDIA_LIMITS.files) throw new Error('选择文件数量超过限制')
  const entries = [], results = []
  let totalBytes = 0, totalPixels = 0
  const maximum = input ? MEDIA_LIMITS.batchBytes : MEDIA_LIMITS.bytes
  for (const file of files) {
    const checked = inspectFile(file, Math.min(maximum, MEDIA_LIMITS.batchBytes - totalBytes), check)
    try {
      const image = !input || /\.(png|jpe?g|webp)$/i.test(file) ? await decodeImage(checked.bytes, { ...context, check }) : null
      totalBytes += checked.size; totalPixels += image?.pixels || 0
      if (totalPixels > MEDIA_LIMITS.batchPixels) throw new Error('所选图片累计像素超过限制')
      const dataUrl = preview && image ? `data:${image.mime};base64,${checked.bytes.toString('base64')}` : undefined
      recheck(file, checked, maximum, check)
      const metadata = { canonical: checked.canonical, identity: checked.identity, size: checked.size }
      entries.push([file, metadata, image])
      results.push({ path: file, ...metadata, ...image, ...(dataUrl ? { dataUrl } : {}) })
    } finally { checked.bytes = null }
  }
  for (const [file, checked] of entries) recheck(file, checked, maximum, check)
  check()
  return { files: results, rollback: registerFiles(owner, entries) }
}
async function grantOperation(lease, owner, files, options) {
  let result
  try { return await runMediaOperation(lease, async context => { result = await grantBatch(owner, files, context, options); return result }) }
  catch (error) { result?.rollback(); throw error }
}
export function grantMediaFilesInLease(lease, owner, files, { preview = false } = {}) {
  return grantOperation(lease, owner, files, { preview })
}
export function grantInputFilesInLease(lease, owner, files) {
  return grantOperation(lease, owner, files, { input: true })
}
export function grantMediaFiles(owner, files, signal, options) {
  return admittedGrant(owner, signal, lease => grantMediaFilesInLease(lease, owner, files, options))
}
export async function grantMediaFile(owner, file) {
  const result = await grantMediaFiles(owner, [file])
  return result.files[0]
}
export async function grantInputFiles(owner, files, signal) {
  return (await admittedGrant(owner, signal, lease => grantInputFilesInLease(lease, owner, files))).rollback
}
export function grantInputFile(owner, file) { return grantInputFiles(owner, [file]) }
export function revokeMediaFile(owner, file) {
  const value = owners.get(owner)
  value?.media.delete(path.resolve(file)); value?.inputs.delete(path.resolve(file))
}
/** 固定预览消费；原始bytes不离开额度，IPC字符串与GC不属于硬内存保证。 */
export function readAuthorizedImage(owner, file, signal) {
  return withMediaAdmission({ owner, signal }, lease => runMediaOperation(lease, async context => {
    const check = ownerCheck(owner, context)
    check()
    if (typeof file === 'string' && file.startsWith('file:')) {
      const url = new URL(file)
      if (url.host || url.search || url.hash) throw new Error('媒体URL不是本地精确文件')
      file = fileURLToPath(url)
    }
    const record = state(owner).media.get(path.resolve(file))
    if (!record) throw new Error('图片未授权，请先选择文件')
    const checked = inspectFile(file, MEDIA_LIMITS.bytes, check)
    try {
      if (checked.canonical !== record.canonical || checked.identity !== record.identity) throw new Error('已授权图片发生变化，请重新选择')
      const image = await decodeImage(checked.bytes, { ...context, check })
      const dataUrl = `data:${image.mime};base64,${checked.bytes.toString('base64')}`
      recheck(file, checked, MEDIA_LIMITS.bytes, check)
      if (state(owner).media.get(path.resolve(file)) !== record) throw new Error('图片授权在解码期间发生变化')
      return { canonical: checked.canonical, identity: checked.identity, size: checked.size, ...image, dataUrl }
    } finally { checked.bytes = null }
  }))
}
/** 仅缺授权/身份失效返回false；繁忙、取消、来源错误不吞掉。 */
export function hasAuthorizedInput(owner, files, signal) {
  return withMediaAdmission({ owner, signal }, lease => runMediaOperation(lease, context => {
    const check = ownerCheck(owner, context)
    const list = Array.isArray(files) ? files : [files]
    if (list.length > MEDIA_LIMITS.files) throw new Error('输入文件数量超过限制')
    for (const file of list) {
      check()
      const record = state(owner).inputs.get(path.resolve(file))
      if (!record) return false
      let current
      try { current = inspectFile(file, MEDIA_LIMITS.batchBytes, check, false) }
      catch (error) {
        check()
        if (['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code) || /文件在读取期间发生变化|符号链接|文件类型或大小/.test(error.message)) return false
        throw error
      }
      if (record.canonical !== current.canonical || record.identity !== current.identity) return false
    }
    return true
  }))
}
/** 固定写入用途：先获得额度再创建目录/base64解码；不将Buffer交给调用方。 */
export async function saveTemporaryImage(owner, temporaryRoot, base64Data, fileName) {
  let grant
  try {
    return await withMediaAdmission({ owner }, async lease => {
      const saved = await runMediaOperation(lease, async context => {
        const check = ownerCheck(owner, context)
        check(); assertImageBase64(base64Data)
        const file = assertOwnedFilePath(temporaryRoot, ['momentum-stickfigure-paste', fileName || `pasted_${Date.now()}.png`])
        fs.mkdirSync(path.dirname(file), { recursive: true })
        let bytes = Buffer.from(base64Data, 'base64')
        try { writeOwnedFile(file, bytes) } finally { bytes = null }
        // 仅格式校验错误可保留旧写入成功语义；取消/身份/额度错误继续抛出。
        try { grant = await grantBatch(owner, [file], context) }
        catch (error) { check(); if (error.code !== 'MEDIA_INVALID_IMAGE') throw error }
        check()
        return { path: file }
      })
      return saved
    })
  } catch (error) { grant?.rollback(); throw error }
}
/** HD固定快照：授权检查、真实解码、流式复核和写盘均在单个登记操作内。 */
export function snapshotInputInLease(lease, owner, file, directory, canonicalDirectory, index, budget) {
  return runMediaOperation(lease, async context => {
    const check = ownerCheck(owner, context)
    check()
    const record = state(owner).inputs.get(path.resolve(file))
    if (!record) throw new Error('输入文件未授权')
    const checked = inspectFile(file, Math.min(MEDIA_LIMITS.batchBytes, budget.bytes), check)
    try {
      if (checked.canonical !== record.canonical || checked.identity !== record.identity) throw new Error('输入文件授权已失效')
      const image = /\.(png|jpe?g|webp)$/i.test(file) ? await decodeImage(checked.bytes, { ...context, check }) : null
      if ((image?.pixels || 0) > budget.pixels) throw new Error('任务累计输入像素超过限制')
      recheck(file, checked, MEDIA_LIMITS.batchBytes, check)
      if (state(owner).inputs.get(path.resolve(file)) !== record) throw new Error('输入授权发生变化')
      const ext = image ? ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' })[image.mime] : '.bin'
      const input = assertOwnedFilePath(directory, [`input-${index}${ext}`])
      const output = assertOwnedFilePath(directory, [`output-${index}${ext}`])
      if (canonicalFile(directory) !== canonicalDirectory) throw new Error('任务目录发生变化')
      fs.writeFileSync(input, checked.bytes, { flag: 'wx', mode: 0o600 })
      if (canonicalFile(input) !== path.join(canonicalDirectory, path.basename(input))) throw new Error('任务快照路径发生变化')
      recheck(file, checked, MEDIA_LIMITS.batchBytes, check)
      return { input, output, size: checked.size, image: !!image, width: image?.width || 0, height: image?.height || 0, pixels: image?.pixels || 0 }
    } finally { checked.bytes = null }
  })
}
export function validateArtifactInLease(lease, owner, record, canonicalDirectory, budget) {
  return runMediaOperation(lease, async context => {
    const check = ownerCheck(owner, context)
    check()
    if (canonicalFile(path.dirname(record.output)) !== canonicalDirectory) throw new Error('产物目录发生变化')
    if (!record.image) {
      if (canonicalFile(record.input) !== path.join(canonicalDirectory, path.basename(record.input))) throw new Error('任务输入快照路径越界')
      fs.copyFileSync(record.input, record.output, fs.constants.COPYFILE_EXCL)
    }
    const checked = inspectFile(record.output, Math.min(MEDIA_LIMITS.batchBytes, budget.bytes), check)
    try {
      if (canonicalFile(path.dirname(record.output)) !== canonicalDirectory || checked.canonical !== path.join(canonicalDirectory, path.basename(record.output))) throw new Error('产物路径越界')
      const image = record.image ? await decodeImage(checked.bytes, { ...context, check }) : null
      if ((image?.pixels || 0) > budget.pixels) throw new Error('任务累计产物像素超过限制')
      recheck(record.output, checked, MEDIA_LIMITS.batchBytes, check)
      return { identity: checked.identity, size: checked.size, pixels: image?.pixels || 0 }
    } finally { checked.bytes = null }
  })
}
/** 发布只返回身份/路径；源Buffer销毁引用后，调用方才串行登记目标授权操作。 */
export function publishArtifactInLease(lease, owner, record, canonicalDirectory, outputDirectory, published) {
  return runMediaOperation(lease, context => {
    const check = ownerCheck(owner, context)
    check()
    const destination = authorizedOutputDirectory(owner, outputDirectory), canonicalDestination = canonicalFile(destination)
    const checked = inspectFile(record.output, MEDIA_LIMITS.batchBytes, check)
    try {
      if (checked.canonical !== path.join(canonicalDirectory, path.basename(record.output)) || checked.identity !== record.identity) throw new Error('已校验产物发生变化')
      const ext = path.extname(record.name), base = path.basename(record.name, ext)
      let target, fd
      for (let suffix = 0; ; suffix++) {
        target = assertOwnedFilePath(destination, [suffix ? `${base}_${suffix}${ext}` : record.name])
        try { fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); break }
        catch (error) { if (error.code !== 'EEXIST') throw error }
      }
      try {
        const stat = fs.fstatSync(fd)
        published.push({ path: target, dev: stat.dev, ino: stat.ino })
        fs.writeFileSync(fd, checked.bytes)
      } finally { fs.closeSync(fd) }
      const targetIdentity = inspectFile(target, MEDIA_LIMITS.batchBytes, check, false)
      if (authorizedOutputDirectory(owner, outputDirectory) !== destination || targetIdentity.canonical !== path.join(canonicalDestination, path.basename(target)) || targetIdentity.identity.split(':').at(-1) !== checked.identity.split(':').at(-1)) throw new Error('发布期间输出路径或字节发生变化')
      recheck(record.output, checked, MEDIA_LIMITS.batchBytes, check)
      return target
    } finally { checked.bytes = null }
  })
}
export function grantOutputDirectory(owner, directory) {
  const canonical = canonicalFile(directory)
  const stat = fs.statSync(canonical)
  if (!stat.isDirectory()) throw new Error('输出位置不是目录')
  const record = { canonical, dev: stat.dev, ino: stat.ino }
  const value = state(owner)
  const changes = [path.resolve(directory), canonical].filter((key, index, keys) => keys.indexOf(key) === index).map(key => ({ key, previous: value.outputs.get(key) }))
  for (const { key } of changes) value.outputs.set(key, record)
  return () => { for (const { key, previous } of changes) if (value.outputs.get(key) === record) {
    if (previous) value.outputs.set(key, previous)
    else value.outputs.delete(key)
  } }
}
export function authorizedOutputDirectory(owner, directory) {
  const record = state(owner).outputs.get(path.resolve(directory))
  if (!record || canonicalFile(directory) !== record.canonical) throw new Error('输出目录未授权')
  const stat = fs.statSync(record.canonical)
  if (!stat.isDirectory() || stat.dev !== record.dev || stat.ino !== record.ino) throw new Error('输出目录授权已失效')
  return path.resolve(directory)
}
