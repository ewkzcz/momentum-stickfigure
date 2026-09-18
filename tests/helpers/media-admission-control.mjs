/** 准入before专用控制：仅延后首个目标Image.decode的真实结果交付。
 * 返回派生Promise（并非计时透明观察）；不模拟原生运行中阻塞或取消。
 * 不改bootstrap、不授能力；所有文件操作原样调用既有受保护函数。
 */
export function installAdmissionControl({ dialog, BrowserWindow }, args) {
  return new Promise((resolve, reject) => setImmediate(() => {
    const restores = []
    let releaseGate = () => {}
    try {
      const fs = process.getBuiltinModule('fs')
      const path = process.getBuiltinModule('path')
      const { createHash } = process.getBuiltinModule('crypto')
      const req = process.getBuiltinModule('module').createRequire(path.join(args.repository, 'package.json'))
      const entry = req.resolve('@momentum/media-canvas')
      if (!req.cache[entry]) throw new Error('生产入口未加载媒体alias')
      const proto = req.cache[entry].exports.Image.prototype
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'decode')
      const srcDescriptor = Object.getOwnPropertyDescriptor(proto, 'src')
      if (!descriptor || typeof descriptor.value !== 'function' || (!descriptor.configurable && !descriptor.writable)) throw new Error('真实decode不可包装')
      if (!srcDescriptor?.configurable || typeof srcDescriptor.set !== 'function') throw new Error('真实src不可观察')
      const originals = { openSync: fs.openSync, readSync: fs.readSync, closeSync: fs.closeSync, alloc: Buffer.alloc, dialog: dialog.showOpenDialog }
      const fds = new Map(), events = [], dialogs = [], sources = new WeakMap()
      const state = globalThis.__momentumTest
      const openPathsDescriptor = Object.getOwnPropertyDescriptor(state, 'openPaths')
      const writesStart = state.writes.length
      let released = false, first = true, originalSettled = false, originalOutcome = null, heldSource = null, ready
      const gate = new Promise(resolve => { releaseGate = resolve })
      const held = new Promise(resolve => { ready = resolve })
      const replace = (object, key, replacement) => {
        const original = Object.getOwnPropertyDescriptor(object, key)
        Object.defineProperty(object, key, { ...original, value: replacement })
        restores.push(() => Object.defineProperty(object, key, original))
      }
      restores.push(() => Object.defineProperty(state, 'openPaths', openPathsDescriptor))
      replace(fs, 'openSync', function (file, ...rest) {
        const fd = Reflect.apply(originals.openSync, this, [file, ...rest])
        if (typeof file === 'string' && args.files.includes(path.resolve(file))) fds.set(fd, path.resolve(file))
        return fd
      })
      replace(fs, 'readSync', function (...values) {
        const count = Reflect.apply(originals.readSync, this, values)
        if (fds.has(values[0])) events.push({ kind: 'read', file: fds.get(values[0]), bytes: count, released })
        return count
      })
      replace(fs, 'closeSync', function (fd, ...rest) {
        try { return Reflect.apply(originals.closeSync, this, [fd, ...rest]) }
        finally { fds.delete(fd) }
      })
      replace(Buffer, 'alloc', function (...values) {
        const result = Reflect.apply(originals.alloc, this, values)
        // 仅覆盖当前inspectFile的open→Buffer.alloc(size)→readSync路径，非通用分配器监控。
        for (const file of fds.values()) if (values[0] === args.sizes[args.files.indexOf(file)]) events.push({ kind: 'whole-buffer', file, bytes: values[0], released })
        return result
      })
      replace(dialog, 'showOpenDialog', async function (...values) {
        const index = dialogs.length
        if (index >= args.files.length) throw new Error('超出固定五次原生选择')
        // 原bootstrap替身同步取走openPaths；不替代业务IPC或授予授权。
        state.openPaths = [args.files[index]]
        const record = { ownerId: values[0]?.id, index }
        dialogs.push(record)
        const result = await Reflect.apply(originals.dialog, this, values)
        record.result = result
        return result
      })
      Object.defineProperty(proto, 'src', { ...srcDescriptor, set(value) {
        if (Buffer.isBuffer(value)) sources.set(this, { bytes: value.length, sha256: createHash('sha256').update(value).digest('hex') })
        return Reflect.apply(srcDescriptor.set, this, [value])
      } })
      restores.push(() => Object.defineProperty(proto, 'src', srcDescriptor))
      replace(proto, 'decode', function (...values) {
        const result = Reflect.apply(descriptor.value, this, values)
        const source = sources.get(this)
        if (!first || source?.sha256 !== args.hashes[0]) return result
        first = false
        heldSource = source
        // 两分支保留同一个真实值或错误；仅延后交付，绝不伪造解码成功。
        return result.then(value => {
          originalSettled = true; originalOutcome = 'fulfilled'; ready()
          return gate.then(() => value)
        }, error => {
          originalSettled = true; originalOutcome = 'rejected'; ready()
          return gate.then(() => { throw error })
        })
      })
      const snapshot = () => ({ released, originalSettled, originalOutcome, heldSource, events: events.map(event => ({ ...event })), dialogs,
        ownerId: BrowserWindow.getAllWindows()[0]?.id, trackedOpenFiles: [...fds.values()],
        artifactOperations: state.writes.slice(writesStart).filter(file => /(^|[\\/])momentum-(hd-|stickfigure-paste([\\/]|$))/.test(file)) })
      globalThis.__mediaAdmissionControl = {
        held,
        release() { released = true; releaseGate() },
        snapshot,
        restore() {
          released = true; releaseGate()
          const errors = []
          for (const action of restores.splice(0).reverse()) { try { action() } catch (error) { errors.push(error.message) } }
          return { ...snapshot(), restoreErrors: errors }
        }
      }
      resolve({ entry, version: req('@momentum/media-canvas/package.json').version })
    } catch (error) {
      releaseGate()
      const errors = []
      for (const action of restores.reverse()) { try { action() } catch (restoreError) { errors.push(restoreError.message) } }
      delete globalThis.__mediaAdmissionControl
      reject(new Error([error.message, ...errors].join('; '), { cause: error }))
    }
  }))
}
