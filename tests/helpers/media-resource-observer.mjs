/** 资源基线专用观察器；函数由application.evaluate序列化到正常main loop。
 * v2观察实际Image.src设置及Image.decode Promise，不修改事件回调或ESM捕获的loadImage。
 */
export function installMediaResourceObserver({ dialog, BrowserWindow }, repository) {
  return new Promise((resolve, reject) => setImmediate(async () => {
    const restores = []
    let state
    try {
      const path = process.getBuiltinModule('path')
      const crypto = process.getBuiltinModule('crypto')
      const req = process.getBuiltinModule('module').createRequire(path.join(repository, 'package.json'))
      const entry = req.resolve('@momentum/media-canvas')
      if (!req.cache[entry]) throw new Error('生产构建未加载媒体alias')
      const library = req.cache[entry].exports
      // 只检查已加载CJS对应ESM命名导出的快照语义；不调用探针、不改变生产解码。
      const namespace = await req('./tests/helpers/media-resource-namespace.cjs')(entry)
      const loadDescriptor = Object.getOwnPropertyDescriptor(library, 'loadImage')
      const captured = namespace.loadImage
      let esmSnapshotVerified = false
      try {
        const probe = function (...args) { return Reflect.apply(captured, this, args) }
        Object.defineProperty(library, 'loadImage', { ...loadDescriptor, value: probe })
        esmSnapshotVerified = namespace.loadImage === captured && library.loadImage === probe && namespace.loadImage !== library.loadImage
      } finally { Object.defineProperty(library, 'loadImage', loadDescriptor) }
      const bindingEntry = req.resolve(path.join(path.dirname(entry), 'js-binding.js'))
      const loaderEntry = req.resolve(path.join(path.dirname(entry), 'load-image.js'))
      if (!req.cache[bindingEntry] || !req.cache[loaderEntry] || req.cache[bindingEntry].exports.Image !== library.Image || req.cache[loaderEntry].exports !== captured) throw new Error('捕获的loadImage/Image依赖身份不符')
      const prototype = library.Image.prototype
      const src = Object.getOwnPropertyDescriptor(prototype, 'src')
      const decode = Object.getOwnPropertyDescriptor(prototype, 'decode')
      if (!src?.configurable || typeof src.set !== 'function' || !decode || typeof decode.value !== 'function' || (!decode.configurable && !decode.writable)) throw new Error('原生Image边界不可透明包装；拒绝报告有效计数')
      const clock = () => Number(process.hrtime.bigint()) / 1e6
      const memory = () => ({ atMs: clock(), ...process.memoryUsage() })
      const images = new WeakMap() // 不保留Image或输入Buffer的强引用。
      state = { active: 0, total: 0, sourceSets: [], calls: [], dialogs: [], phase: null, timer: null, observerErrors: [] }
      const observe = action => { try { action() } catch (error) { state.observerErrors.push(String(error)) } }
      const sample = () => {
        if (!state.phase) return
        const value = memory(), phase = state.phase
        phase.sampleCount++
        for (const key of ['rss', 'heapUsed', 'heapTotal', 'external', 'arrayBuffers']) phase.sampledMax[key] = Math.max(phase.sampledMax[key] || 0, value[key])
        if (phase.samples.length < 256) phase.samples.push(value)
        else phase.omittedSamples++
      }
      function observedSrc(...args) {
        let source
        observe(() => {
          const bytes = args[0]
          source = { id: state.sourceSets.length + 1, phase: state.phase?.label ?? null, startMs: clock(), before: memory(),
            encodedBytes: Buffer.isBuffer(bytes) ? bytes.length : null,
            sha256: Buffer.isBuffer(bytes) ? crypto.createHash('sha256').update(bytes).digest('hex') : null }
          state.sourceSets.push(source); images.set(this, source); sample()
        })
        try {
          const result = Reflect.apply(src.set, this, args)
          observe(() => { source.setterElapsedMs = clock() - source.startMs; source.outcome = 'returned'; sample() })
          return result
        } catch (error) {
          observe(() => { source.outcome = 'threw'; source.error = String(error) })
          throw error
        }
      }
      function observedDecode(...args) {
        let call
        observe(() => {
          const source = images.get(this)
          call = { id: ++state.total, sourceId: source?.id ?? null, phase: state.phase?.label ?? null, startMs: clock(), before: memory() }
          state.calls.push(call); state.active++
          if (state.phase) state.phase.observedPeakDecodePromises = Math.max(state.phase.observedPeakDecodePromises, state.active)
          sample()
        })
        // 回调完全不抛出；不用finally创建一个可能未处理拒绝的派生Promise。
        const finish = outcome => observe(() => {
          if (!call) return
          state.active--
          call.outcome = outcome; call.elapsedMs = clock() - call.startMs; call.after = memory(); sample()
        })
        let result
        try { result = Reflect.apply(decode.value, this, args) }
        catch (error) { finish('threw'); throw error }
        observe(() => {
          if (!(result instanceof Promise)) throw new Error('Image.decode未返回原生Promise，观察无效')
          Promise.prototype.then.call(result, () => finish('resolved'), () => finish('rejected'))
        })
        return result // 同一Promise、同一this/参数，不读取或替换解码结果。
      }
      const originalDialog = Object.getOwnPropertyDescriptor(dialog, 'showOpenDialog')
      const dialogFunction = dialog.showOpenDialog
      async function observedDialog(...args) {
        const result = await Reflect.apply(dialogFunction, this, args)
        state.dialogs.push({ ownerId: args[0]?.id ?? null, result })
        return result
      }
      const replace = (object, key, descriptor, replacement) => {
        Object.defineProperty(object, key, replacement)
        restores.push(() => {
          if (descriptor) Object.defineProperty(object, key, descriptor)
          else delete object[key]
        })
      }
      replace(prototype, 'src', src, { ...src, set: observedSrc })
      replace(prototype, 'decode', decode, { ...decode, value: observedDecode })
      replace(dialog, 'showOpenDialog', originalDialog, { configurable: true, enumerable: true, writable: true, value: observedDialog })
      const restore = () => {
        const errors = []
        for (const action of restores.splice(0).reverse()) { try { action() } catch (error) { errors.push(String(error)) } }
        return errors
      }
      state.begin = label => {
        if (state.phase || state.timer || state.active) throw new Error('前一测量阶段尚未结束')
        state.phase = { label, startMs: clock(), callStart: state.calls.length, sourceStart: state.sourceSets.length, activeStart: state.active,
          observedPeakDecodePromises: 0, samples: [], sampleCount: 0, omittedSamples: 0, sampledMax: {}, before: memory() }
        sample(); state.timer = setInterval(() => observe(sample), 10)
      }
      state.end = () => {
        clearInterval(state.timer); state.timer = null
        if (!state.phase) return null
        const phase = state.phase
        try {
          sample(); phase.after = memory(); phase.elapsedMs = clock() - phase.startMs
          phase.observedDecodeCalls = state.calls.length - phase.callStart
          phase.observedSourceSets = state.sourceSets.length - phase.sourceStart
          phase.activeEnd = state.active
          phase.calls = state.calls.slice(phase.callStart).map(call => ({ ...call }))
          phase.sourceSets = state.sourceSets.slice(phase.sourceStart).map(source => ({ ...source }))
          return phase
        } finally { state.phase = null }
      }
      state.cleanup = () => {
        let unfinished
        try { unfinished = state.end() }
        finally {
          clearInterval(state.timer); state.timer = null
          state.observerErrors.push(...restore())
        }
        return { unfinished, active: state.active, total: state.total, sourceSets: state.sourceSets, calls: state.calls, dialogs: state.dialogs, observerErrors: state.observerErrors }
      }
      globalThis.__mediaResourceBaseline = state
      resolve({ entry, bindingEntry, loaderEntry, esmSnapshotVerified, version: req('@momentum/media-canvas/package.json').version,
        ownerId: BrowserWindow.getAllWindows()[0].id, electron: process.versions.electron, node: process.versions.node, platform: process.platform, arch: process.arch,
        memory: memory(), samplingIntervalMs: 10, storedSamplesPerPhase: 256,
        method: 'v2 Image.prototype.src setter + Image.prototype.decode原Promise观察',
        measurementLimits: 'src设置不是完成解码；decode只在onload后调用，其Promise活动窗口不覆盖src至onload，不能当成loadImage全程活动数或原生线程并行数。RSS/heap仅主进程采样，可能漏峰；包含hash/观察开销，不强制GC。' })
    } catch (error) {
      clearInterval(state?.timer)
      const cleanupErrors = []
      for (const action of restores.reverse()) { try { action() } catch (restoreError) { cleanupErrors.push(String(restoreError)) } }
      delete globalThis.__mediaResourceBaseline
      reject(cleanupErrors.length ? new Error(`${error.message}; 恢复失败：${cleanupErrors.join('; ')}`, { cause: error }) : error)
    }
  }))
}
