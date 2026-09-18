import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

// 本文件仅连接真实生产 will-quit 回调和真实任务作用域。
// app 事件、PSD 停止及业务注销边界受控；不启动 Electron/Python，不改变 bootstrap。
// 真实进程树验收仍由 managed-process/owned-process-tasks 测试负责。
const entryURL = new URL('../src/main/index.js', import.meta.url)
const entrySource = await readFile(entryURL, 'utf8')
const startMarker = 'let psdShutdownStarted = false'
const endMarker = '// 崩溃监控：'
const start = entrySource.indexOf(startMarker)
const end = entrySource.indexOf(endMarker, start)
assert.ok(start >= 0 && end > start, '必须找到生产退出屏障声明及完整回调边界')
assert.equal(entrySource.indexOf(startMarker, start + startMarker.length), -1, '退出屏障声明必须唯一')
const shutdownSource = entrySource.slice(start, end)
assert.equal((shutdownSource.match(/app\.on\('will-quit'/g) || []).length, 1, '必须执行唯一的真实 will-quit 注册代码')
assert.match(shutdownSource, /stopOwnedTasks\(\)/, '真实退出入口必须连接任务停止方法')
assert.match(shutdownSource.trimEnd(), /\}\)$/, '提取范围必须包含完整退出回调')

function deferred() {
  let resolve, reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function observe(promise) {
  return promise.then(
    value => ({ status: 'fulfilled', value }),
    reason => ({ status: 'rejected', reason })
  )
}

// 事件循环检查点只排空当前微任务及生产 setImmediate，不依赖固定等待时长。
async function checkpoint() {
  await new Promise(resolve => setImmediate(resolve))
  await new Promise(resolve => setImmediate(resolve))
}

let sequence = 0
async function fixture() {
  const moduleURL = new URL('../src/main/owned-process-tasks.mjs', import.meta.url)
  moduleURL.searchParams.set('application-shutdown-test', String(++sequence))
  const service = await import(moduleURL.href)
  const app = new EventEmitter()
  const psd = deferred()
  const psdOutcome = observe(psd.promise)
  const records = [], stops = [], errors = [], events = [], unregisterCalls = []
  const immediateCallbacks = []
  const counts = { owned: 0, psd: 0, quit: 0 }
  const boundary = {
    app,
    console: { error: (...args) => errors.push(args) },
    stopOwnedTasks() {
      counts.owned++
      const stopping = service.stopOwnedTasks()
      stops.push(observe(stopping))
      return stopping
    },
    stopPSDWorkers() {
      counts.psd++
      return psd.promise
    },
    // 显式控制生产回调安排的下一轮退出，使重入前后都可观测。
    setImmediate(callback) {
      immediateCallbacks.push(callback)
      return immediateCallbacks.length
    }
  }
  // 仅替代无关业务的注销边界，不替代或重写退出条件、Promise 链和错误处理。
  const unregisterNames = [...new Set(shutdownSource.match(/\bunregister\w+(?=\(\))/g))]
  assert.ok(unregisterNames.length > 0, '必须保留生产回调的业务注销阶段')
  for (const name of unregisterNames) boundary[name] = () => unregisterCalls.push(name)
  new vm.Script(shutdownSource, {
    filename: entryURL.pathname,
    lineOffset: entrySource.slice(0, start).split('\n').length - 1
  }).runInNewContext(boundary)
  assert.equal(app.listenerCount('will-quit'), 1)

  function requestQuit() {
    const event = { prevented: 0, preventDefault() { this.prevented++ } }
    events.push(event)
    app.emit('will-quit', event)
    return event
  }
  app.quit = () => {
    counts.quit++
    requestQuit()
  }

  return {
    counts, errors, events, psd, stops, unregisterCalls, unregisterNames, immediateCallbacks,
    requestQuit,
    startTask(failure) {
      const owner = Object.assign(new EventEmitter(), { isDestroyed: () => false })
      const entered = deferred(), aborted = deferred(), release = deferred()
      const record = { owner, entered, aborted, release, outcome: null }
      records.push(record)
      record.outcome = observe(service.runOwnedTask(owner, 'application-exit-test', async () => {
        const signal = service.currentTaskSignal()
        const onAbort = () => aborted.resolve(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          if (signal.aborted) onAbort()
          entered.resolve()
          await release.promise
          if (failure) throw failure
          return 'completed'
        } finally {
          signal.removeEventListener('abort', onAbort)
        }
      }))
      return record
    },
    flushQuitCallbacks() {
      const pending = immediateCallbacks.splice(0)
      for (const callback of pending) callback()
    },
    async finish() {
      // 中途断言失败也释放全部任务、收集所有拒绝并移除事件边界。
      for (const record of records) {
        record.owner.emit('destroyed')
        record.release.resolve()
      }
      psd.resolve()
      await Promise.all(records.map(record => record.outcome))
      await Promise.all(stops)
      await psdOutcome
      await observe(service.stopOwnedTasks())
      await checkpoint()
      immediateCallbacks.length = 0
      app.removeAllListeners()
      for (const record of records) assert.equal(record.owner.listenerCount('destroyed'), 0)
    }
  }
}

function assertWaiting(subject, event) {
  assert.equal(event.prevented, 1, '在途停止请求必须同步阻止退出')
  assert.equal(subject.counts.quit, 0, '停止请求结算前不得调用 app.quit')
  assert.equal(subject.immediateCallbacks.length, 0, '停止请求结算前不得安排 app.quit')
  assert.deepEqual(subject.unregisterCalls, [], '等待期间不得进入最终注销阶段')
}

function assertSingleStop(subject) {
  assert.equal(subject.counts.owned, 1, '多次退出只能启动一次任务停止')
  assert.equal(subject.counts.psd, 1, '多次退出只能启动一次 PSD 停止')
}

test('应用退出入口：PSD 已停止仍等待在途任务结算', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const task = subject.startTask()
  try {
    await task.entered.promise
    subject.psd.resolve()
    const event = subject.requestQuit()
    assertWaiting(subject, event)
    assert.equal((await task.aborted.promise).name, 'AbortError')
    await checkpoint()
    assertWaiting(subject, event)
    assertSingleStop(subject)
    task.release.resolve()
    const outcome = await task.outcome
    assert.equal(outcome.status, 'rejected')
    assert.equal(outcome.reason.name, 'AbortError')
    assert.equal((await subject.stops[0]).status, 'fulfilled')
    await checkpoint()
    assert.equal(subject.immediateCallbacks.length, 1)
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 1)
    assert.equal(subject.events.at(-1).prevented, 0)
  } finally { await subject.finish() }
})

test('应用退出入口：任务已结算仍等待 PSD 停止', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const task = subject.startTask()
  try {
    await task.entered.promise
    const event = subject.requestQuit()
    await task.aborted.promise
    task.release.resolve()
    await task.outcome
    assert.equal((await subject.stops[0]).status, 'fulfilled')
    await checkpoint()
    assertWaiting(subject, event)
    subject.psd.resolve()
    await checkpoint()
    assert.equal(subject.immediateCallbacks.length, 1)
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 1)
    assert.equal(subject.events.at(-1).prevented, 0)
    assertSingleStop(subject)
  } finally { await subject.finish() }
})

test('应用退出入口：多次退出只停止一次，结算后 quit 恰一次且重入不拦截', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const task = subject.startTask()
  try {
    await task.entered.promise
    for (let attempt = 0; attempt < 3; attempt++) assertWaiting(subject, subject.requestQuit())
    await task.aborted.promise
    assertSingleStop(subject)
    subject.psd.resolve()
    task.release.resolve()
    await task.outcome
    await subject.stops[0]
    await checkpoint()
    assert.equal(subject.counts.quit, 0)
    assert.equal(subject.immediateCallbacks.length, 1, '只能安排一次后续退出')
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 1)
    assert.equal(subject.events.length, 4, 'app.quit 必须重新触发真实 will-quit 回调')
    assert.equal(subject.events.at(-1).prevented, 0, '成功后的重入不得再次拦截')
    assert.deepEqual(subject.unregisterCalls, subject.unregisterNames)
    assert.equal(subject.requestQuit().prevented, 0, '后续退出也不得重新打开屏障')
    await checkpoint()
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 1)
    assertSingleStop(subject)
    assert.deepEqual(subject.errors, [])
  } finally { await subject.finish() }
})

test('应用退出入口：任务清理拒绝保留原始错误，等待其他任务且持续阻止退出', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const cause = new Error('controlled observation failure')
  const failure = Object.assign(new Error('controlled cleanup failure', { cause }), { code: 'PROCESS_CLEANUP_FAILED' })
  const failed = subject.startTask(failure)
  const pending = subject.startTask()
  try {
    await Promise.all([failed.entered.promise, pending.entered.promise])
    subject.psd.resolve()
    const event = subject.requestQuit()
    await Promise.all([failed.aborted.promise, pending.aborted.promise])
    failed.release.resolve()
    assert.equal((await failed.outcome).reason, failure)
    await checkpoint()
    assertWaiting(subject, event)
    assert.deepEqual(subject.errors, [], '另一任务在途时真实 stopOwnedTasks 仍不得结算')
    pending.release.resolve()
    await pending.outcome
    const stopped = await subject.stops[0]
    assert.equal(stopped.status, 'rejected')
    assert.equal(stopped.reason.code, 'PROCESS_CLEANUP_FAILED')
    assert.ok(stopped.reason instanceof AggregateError)
    assert.deepEqual(stopped.reason.errors, [failure])
    assert.equal(stopped.reason.errors[0].cause, cause)
    await checkpoint()
    assert.equal(subject.errors.length, 1)
    assert.equal(subject.errors[0][1], stopped.reason, '生产错误处理必须保留原始聚合错误对象')
    for (let attempt = 0; attempt < 3; attempt++) assertWaiting(subject, subject.requestQuit())
    await checkpoint()
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 0)
    assert.equal(subject.errors.length, 1)
    assertSingleStop(subject)
  } finally { await subject.finish() }
})

test('应用退出入口：并行停止都拒绝时保留 PSD 与任务清理的全部原始错误', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const psdFailure = new Error('controlled first PSD failure')
  const taskFailure = Object.assign(new Error('controlled later task cleanup failure'), { code: 'PROCESS_CLEANUP_FAILED' })
  const task = subject.startTask(taskFailure)
  try {
    await task.entered.promise
    const event = subject.requestQuit()
    await task.aborted.promise
    // 明确让 PSD 先拒绝、任务后拒绝，检查 Promise.all 首次拒绝是否丢失后续诊断。
    subject.psd.reject(psdFailure)
    await checkpoint()
    assertWaiting(subject, event)
    task.release.resolve()
    assert.equal((await task.outcome).reason, taskFailure)
    const stopped = await subject.stops[0]
    assert.equal(stopped.status, 'rejected')
    assert.equal(stopped.reason.code, 'PROCESS_CLEANUP_FAILED')
    await checkpoint()
    assertWaiting(subject, subject.requestQuit())
    assertSingleStop(subject)
    const retained = new Set()
    function collect(error) {
      if (!error || typeof error !== 'object' || retained.has(error)) return
      retained.add(error)
      if (error.cause) collect(error.cause)
      // vm 聚合错误可能来自另一 realm，不以宿主 instanceof 作为收集条件。
      if (Array.isArray(error.errors)) for (const nested of error.errors) collect(nested)
    }
    for (const args of subject.errors) for (const value of args) collect(value)
    assert.ok(retained.has(psdFailure), '退出入口必须保留先发生的 PSD 停止错误')
    assert.ok(retained.has(taskFailure), '退出入口必须保留后发生的任务清理错误，不能只报告 Promise.all 首次拒绝')
  } finally { await subject.finish() }
})

test('应用退出入口：PSD 停止拒绝后任务仍须停止，错误不能被后续成功覆盖', { timeout: 10000 }, async () => {
  const subject = await fixture()
  const failure = new Error('controlled PSD shutdown failure')
  const task = subject.startTask()
  try {
    await task.entered.promise
    const event = subject.requestQuit()
    await task.aborted.promise
    subject.psd.reject(failure)
    await checkpoint()
    assertWaiting(subject, event)
    assert.equal(subject.errors.length, 1)
    assert.equal(subject.errors[0][1], failure)
    assertWaiting(subject, subject.requestQuit())
    task.release.resolve()
    await task.outcome
    assert.equal((await subject.stops[0]).status, 'fulfilled')
    await checkpoint()
    assertWaiting(subject, subject.requestQuit())
    subject.flushQuitCallbacks()
    assert.equal(subject.counts.quit, 0)
    assert.equal(subject.errors.length, 1)
    assert.equal(subject.errors[0][1], failure)
    assertSingleStop(subject)
  } finally { await subject.finish() }
})
