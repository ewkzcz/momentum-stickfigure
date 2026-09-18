/** 独立取消夹具：观察真实文件读取和图片src，只延后目标decode的真实结果交付。
 * 不是原生线程阻塞/真实窗口夹具，不改授权状态，不复制准入算法。
 */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { Image } from '@momentum/media-canvas'

export const digest = bytes => createHash('sha256').update(bytes).digest('hex')
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
function bounded(promise, label) {
  let timer
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}未在5秒内完成`)), 5000)
  })]).finally(() => clearTimeout(timer))
}
export function installCancellationControl(files, heldHash) {
  const restores = [], reads = [], fds = new Map(), sources = new WeakMap()
  const entered = deferred(), settled = deferred(), gate = deferred(), jobs = []
  let first = true, released = false, outcome
  const replace = (object, key, replacement) => {
    const descriptor = Object.getOwnPropertyDescriptor(object, key)
    Object.defineProperty(object, key, { ...descriptor, value: replacement })
    restores.push(() => Object.defineProperty(object, key, descriptor))
    return descriptor.value
  }
  const restore = () => {
    const errors = []
    for (const action of restores.splice(0).reverse()) { try { action() } catch (error) { errors.push(error) } }
    if (errors.length) throw new AggregateError(errors, '取消测试恢复包装失败')
  }
  try {
    const open = fs.openSync, read = fs.readSync, close = fs.closeSync
    replace(fs, 'openSync', function (file, ...args) {
      const fd = Reflect.apply(open, this, [file, ...args])
      if (typeof file === 'string' && files.includes(path.resolve(file))) fds.set(fd, path.resolve(file))
      return fd
    })
    replace(fs, 'readSync', function (...args) {
      const count = Reflect.apply(read, this, args)
      if (fds.has(args[0])) reads.push({ file: fds.get(args[0]), bytes: count, released })
      return count
    })
    replace(fs, 'closeSync', function (fd, ...args) {
      try { return Reflect.apply(close, this, [fd, ...args]) }
      finally { fds.delete(fd) }
    })
    const src = Object.getOwnPropertyDescriptor(Image.prototype, 'src')
    const decode = Object.getOwnPropertyDescriptor(Image.prototype, 'decode')
    if (!src?.configurable || typeof src.set !== 'function' || typeof decode?.value !== 'function') throw new Error('真实图片描述符不可控制')
    Object.defineProperty(Image.prototype, 'src', { ...src, set(value) {
      if (Buffer.isBuffer(value)) sources.set(this, digest(value))
      return Reflect.apply(src.set, this, [value])
    } })
    restores.push(() => Object.defineProperty(Image.prototype, 'src', src))
    replace(Image.prototype, 'decode', function (...args) {
      const result = Reflect.apply(decode.value, this, args)
      if (!first || sources.get(this) !== heldHash) return result
      first = false; entered.resolve()
      // 两条分支均保留真实value/error，不提供注入解码成功或失败的接口。
      return result.then(value => {
        outcome = { status: 'fulfilled' }; settled.resolve()
        return gate.promise.then(() => value)
      }, error => {
        outcome = { status: 'rejected', error }; settled.resolve()
        return gate.promise.then(() => { throw error })
      })
    })
    return {
      get entered() { return bounded(entered.promise, '真实decode调用信号') },
      get settled() { return bounded(settled.promise, '真实decode结算信号') },
      reads,
      get outcome() { return outcome },
      track(promise) {
        const job = { settled: false }
        job.done = promise.then(value => { job.settled = true; job.value = value }, error => { job.settled = true; job.error = error; job.failed = true })
        jobs.push(job)
        return job
      },
      release() { released = true; gate.resolve() },
      async close() {
        released = true; gate.resolve()
        try { await Promise.all(jobs.map(job => job.done)) }
        finally { restore() }
        if (fds.size) throw new Error('取消测试结束仍有目标文件描述符打开')
      }
    }
  } catch (error) {
    gate.resolve()
    try { restore() } catch (cleanup) { throw new AggregateError([error, cleanup], '取消测试安装及恢复失败') }
    throw error
  }
}

/** 透明观察原生Map.set完成的两个目标能力记录；不读取或改写私有state。
 * 匹配精确规范路径、大小身份hash和图片元数据；原set原样执行后才排微任务取消。
 * 此夹具依赖当前双用途登记实现，匹配不到必须失败，不能当作取消覆盖成功。
 */
export function cancelAfterRegistration(file, sha256, controller, reason) {
  const descriptor = Object.getOwnPropertyDescriptor(Map.prototype, 'set')
  const canonical = fs.realpathSync(file), key = path.resolve(file)
  const matched = new WeakSet()
  let count = 0, triggered = false
  Object.defineProperty(Map.prototype, 'set', { ...descriptor, value: function (entryKey, record) {
    const result = Reflect.apply(descriptor.value, this, [entryKey, record])
    if (entryKey === key && record?.canonical === canonical && typeof record.identity === 'string' && record.identity.endsWith(':' + sha256) && record.mime === 'image/png' && !matched.has(this)) {
      matched.add(this); count++
      if (count === 2) {
        triggered = true
        globalThis.queueMicrotask(() => controller.abort(reason))
      }
    }
    return result
  } })
  return { get count() { return count }, get triggered() { return triggered }, restore() { Object.defineProperty(Map.prototype, 'set', descriptor) } }
}
