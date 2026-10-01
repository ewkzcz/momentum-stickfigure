import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { runManagedProcess } from '../src/main/managed-process.mjs'
import { currentTaskSignal, runOwnedTask, cancelOwnedTasks, stopOwnedTasks } from '../src/main/owned-process-tasks.mjs'

const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false })
test('任务作用域：取消隔离、窗口销毁及退出等待真实进程', { timeout: 15000 }, async () => {
  const first = owner(), other = owner()
  let child
  const task = runOwnedTask(first, 'hd', () => runManagedProcess(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { signal: currentTaskSignal(), onSpawn: value => { child = value } }))
  const rejected = assert.rejects(task, { name: 'AbortError' })
  await once(child.stdout, 'data')
  assert.equal((await cancelOwnedTasks(other, 'hd')).cancelled, 0)
  assert.equal((await cancelOwnedTasks(first, 'hd')).cancelled, 1)
  await rejected
  assert.equal(first.listenerCount('destroyed'), 0)
  const closing = runOwnedTask(first, 'hd', () => runManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: currentTaskSignal() }))
  const closed = assert.rejects(closing, { name: 'AbortError' })
  first.emit('destroyed')
  await closed
  assert.equal(await runOwnedTask(other, 'hd', async () => 'recovered'), 'recovered')
  const exiting = runOwnedTask(other, 'hd', () => runManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: currentTaskSignal() }))
  const exited = assert.rejects(exiting, { name: 'AbortError' })
  await stopOwnedTasks()
  await exited
  await assert.rejects(runOwnedTask(first, 'hd', async () => true), { name: 'AbortError' })
})

// 以下仅注入任务执行错误，不启动进程，不代表真实 Electron/Python 清理验收。
let controlledModuleSequence = 0
function deferredTaskGate() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

/** 立即旁听拒绝，返回永不拒绝的结果，断言失败时也能完整收尾。 */
function observeTask(promise, settled = () => {}) {
  return promise.then(value => {
    settled()
    return { status: 'fulfilled', value }
  }, reason => {
    settled()
    return { status: 'rejected', reason }
  })
}

async function controlledTasks() {
  const url = new URL('../src/main/owned-process-tasks.mjs', import.meta.url)
  url.searchParams.set('controlled-task-test', String(++controlledModuleSequence))
  const service = await import(url.href)
  const records = [], stops = [], events = []
  return {
    events,
    start(name, failure, { sender = Object.assign(new EventEmitter(), {
      destroyed: false,
      isDestroyed() { return this.destroyed }
    }), kind = 'controlled-unit' } = {}) {
      const entered = deferredTaskGate(), aborted = deferredTaskGate(), release = deferredTaskGate()
      const record = { sender, kind, entered, aborted, release, outcome: null }
      records.push(record)
      record.outcome = observeTask(service.runOwnedTask(sender, kind, async () => {
        const signal = service.currentTaskSignal()
        const onAbort = () => { events.push(`${name}:aborted`); aborted.resolve() }
        signal.addEventListener('abort', onAbort, { once: true })
        try {
          if (signal.aborted) onAbort()
          events.push(`${name}:entered`)
          entered.resolve()
          await release.promise
          if (failure) throw failure
          return name
        } finally {
          signal.removeEventListener('abort', onAbort)
        }
      }), () => events.push(`${name}:settled`))
      return record
    },
    cancel(record) {
      const outcome = observeTask(service.cancelOwnedTasks(record.sender, record.kind))
      stops.push(outcome)
      return outcome
    },
    stop() {
      const outcome = observeTask(service.stopOwnedTasks(), () => events.push('stop:settled'))
      stops.push(outcome)
      return outcome
    },
    async finish() {
      // 断言中途失败也销毁所有来源、释放全部握手并等待任务及停止请求。
      for (const record of records) {
        record.sender.destroyed = true
        record.sender.emit('destroyed')
        record.entered.resolve()
        record.aborted.resolve()
        record.release.resolve()
      }
      await Promise.all(records.map(record => record.outcome))
      await Promise.all(stops)
      await observeTask(service.stopOwnedTasks())
      for (const record of records) assert.equal(record.sender.listenerCount('destroyed'), 0)
    }
  }
}

function controlledCleanupFailure() {
  const cause = Object.assign(new Error('controlled process observation failure'), { code: 'EIO' })
  const error = Object.assign(new Error('controlled cleanup failure', { cause }), { code: 'PROCESS_CLEANUP_FAILED' })
  return { error, cause }
}

/** 允许聚合层级变化，但必须保留原始清理错误及其 cause 对象。 */
function assertCleanupResult(result, failure) {
  assert.equal(result.status, 'rejected', '未解决的清理失败必须拒绝停止请求')
  assert.ok(result.reason instanceof AggregateError)
  assert.equal(result.reason.code, 'PROCESS_CLEANUP_FAILED')
  const seen = new Set()
  function collect(error) {
    if (!error || seen.has(error)) return
    seen.add(error)
    if (error.cause) collect(error.cause)
    if (error instanceof AggregateError) for (const nested of error.errors) collect(nested)
  }
  collect(result.reason)
  assert.ok(seen.has(failure.error), '聚合结果必须保留原始清理错误对象')
  assert.ok(seen.has(failure.cause), '聚合结果必须保留原始 cause 对象')
  assert.equal(failure.error.cause, failure.cause)
}

test('任务机制单测：清理失败仍等待其他在途任务结算再聚合', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const failure = controlledCleanupFailure()
  const first = fixture.start('failed', failure.error)
  const second = fixture.start('pending')
  try {
    await Promise.all([first.entered.promise, second.entered.promise])
    const stopped = fixture.stop()
    await Promise.all([first.aborted.promise, second.aborted.promise])
    first.release.resolve()
    assert.equal((await first.outcome).reason, failure.error)
    // 显式经过事件循环检查点，排空首任务拒绝的微任务链；第二任务仍由 gate 持有。
    await new Promise(resolve => setImmediate(resolve))
    fixture.events.push('pending:checkpoint')
    assert.ok(!fixture.events.includes('pending:settled'))
    assert.ok(!fixture.events.includes('stop:settled'), '另一任务未结算时停止请求不得结算')
    fixture.events.push('pending:released')
    second.release.resolve()
    const secondResult = await second.outcome
    assert.equal(secondResult.status, 'rejected')
    assert.equal(secondResult.reason.name, 'AbortError')
    assertCleanupResult(await stopped, failure)
    const position = name => fixture.events.indexOf(name)
    assert.ok(position('failed:settled') < position('pending:checkpoint'))
    assert.ok(position('pending:checkpoint') < position('pending:released'))
    assert.ok(position('pending:released') < position('pending:settled'))
    assert.ok(position('pending:settled') < position('stop:settled'))
  } finally { await fixture.finish() }
})

test('任务机制单测：来源销毁后已结算的清理失败仍阻止停止成功', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const failure = controlledCleanupFailure()
  const task = fixture.start('destroyed', failure.error)
  try {
    await task.entered.promise
    task.sender.destroyed = true
    task.sender.emit('destroyed')
    await task.aborted.promise
    task.release.resolve()
    const result = await task.outcome
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, failure.error)
    assert.equal(task.sender.listenerCount('destroyed'), 0)
    assertCleanupResult(await fixture.stop(), failure)
  } finally { await fixture.finish() }
})

test('任务机制单测：停止快照内嵌套聚合的清理失败不能被吞掉', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const failure = controlledCleanupFailure()
  const ordinary = new Error('controlled file cleanup failure')
  const nested = new AggregateError([ordinary, new AggregateError([failure.error], 'inner failure')], 'combined failure')
  const task = fixture.start('nested', nested)
  try {
    await task.entered.promise
    const stopped = fixture.stop()
    await task.aborted.promise
    task.release.resolve()
    const result = await task.outcome
    assert.equal(result.status, 'rejected')
    assert.equal(result.reason, nested)
    assertCleanupResult(await stopped, failure)
  } finally { await fixture.finish() }
})

test('任务机制单测：已结算及在途普通业务失败不误报进程清理失败', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const completedError = new Error('controlled completed business failure')
  const activeError = new AggregateError([new Error('controlled active business failure')], 'ordinary aggregate')
  const completed = fixture.start('completed', completedError)
  const active = fixture.start('active', activeError)
  try {
    await Promise.all([completed.entered.promise, active.entered.promise])
    completed.release.resolve()
    const completedResult = await completed.outcome
    assert.equal(completedResult.status, 'rejected')
    assert.equal(completedResult.reason, completedError)
    const stopped = fixture.stop()
    await active.aborted.promise
    active.release.resolve()
    const activeResult = await active.outcome
    assert.equal(activeResult.status, 'rejected')
    assert.equal(activeResult.reason, activeError)
    assert.equal((await stopped).status, 'fulfilled')
  } finally { await fixture.finish() }
})

test('任务机制单测：历史失败与在途失败合并且重复停止持续拒绝', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const historical = controlledCleanupFailure(), current = controlledCleanupFailure()
  const first = fixture.start('historical', historical.error)
  const active = fixture.start('current', current.error)
  try {
    await Promise.all([first.entered.promise, active.entered.promise])
    first.release.resolve()
    assert.equal((await first.outcome).reason, historical.error)
    const stopped = fixture.stop()
    await active.aborted.promise
    await new Promise(resolve => setImmediate(resolve))
    assert.ok(!fixture.events.includes('stop:settled'), '历史失败不能使停止绕过当前在途任务')
    active.release.resolve()
    assert.equal((await active.outcome).reason, current.error)
    const result = await stopped
    assertCleanupResult(result, historical)
    assertCleanupResult(result, current)
    assert.deepEqual(result.reason.errors, [historical.error, current.error])
    const repeated = await fixture.stop()
    assertCleanupResult(repeated, historical)
    assertCleanupResult(repeated, current)
    assert.deepEqual(repeated.reason.errors, result.reason.errors)
    const refused = fixture.start('after-stop')
    const refusal = await refused.outcome
    assert.equal(refusal.status, 'rejected')
    assert.equal(refusal.reason.name, 'AbortError')
    assert.ok(!fixture.events.includes('after-stop:entered'))
  } finally { await fixture.finish() }
})

test('任务机制单测：循环聚合及 cause 中的清理失败保留原始错误图', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const failure = controlledCleanupFailure()
  const wrapper = new Error('cause wrapper', { cause: failure.error })
  const nested = new AggregateError([], 'cyclic aggregate')
  nested.cause = nested
  nested.errors.push(wrapper, nested)
  failure.cause.cause = nested
  const task = fixture.start('cyclic', nested)
  try {
    await task.entered.promise
    const stopped = fixture.stop()
    await task.aborted.promise
    task.release.resolve()
    assert.equal((await task.outcome).reason, nested)
    const result = await stopped
    assertCleanupResult(result, failure)
    assert.equal(result.reason.errors[0], nested)
    assert.equal(wrapper.cause, failure.error)
    assert.equal(failure.cause.cause, nested)
    assertCleanupResult(await fixture.stop(), failure)
  } finally { await fixture.finish() }
})

test('任务机制单测：不含清理失败的循环聚合不误报且遍历结束', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const nested = new AggregateError([], 'ordinary cyclic aggregate')
  const ordinary = new Error('ordinary cause', { cause: nested })
  nested.cause = ordinary
  nested.errors.push(nested, ordinary)
  const task = fixture.start('ordinary-cycle', nested)
  try {
    await task.entered.promise
    const stopped = fixture.stop()
    await task.aborted.promise
    task.release.resolve()
    assert.equal((await task.outcome).reason, nested)
    assert.equal((await stopped).status, 'fulfilled')
    assert.equal((await fixture.stop()).status, 'fulfilled')
  } finally { await fixture.finish() }
})

test('任务机制单测：历史清理失败的取消保持 owner 和 kind 隔离', { timeout: 10000 }, async () => {
  const fixture = await controlledTasks()
  const failure = controlledCleanupFailure()
  const failed = fixture.start('failed-owner', failure.error, { kind: 'hd' })
  const otherOwner = fixture.start('other-owner', undefined, { kind: 'hd' })
  const otherKind = fixture.start('other-kind', undefined, { sender: failed.sender, kind: 'ocr' })
  try {
    await Promise.all([failed.entered.promise, otherOwner.entered.promise, otherKind.entered.promise])
    failed.release.resolve()
    assert.equal((await failed.outcome).reason, failure.error)
    assertCleanupResult(await fixture.cancel(failed), failure)
    assert.ok(!fixture.events.includes('other-owner:aborted'))
    assert.ok(!fixture.events.includes('other-kind:aborted'))
    const cancelOwner = fixture.cancel(otherOwner)
    await otherOwner.aborted.promise
    assert.ok(!fixture.events.includes('other-kind:aborted'))
    otherOwner.release.resolve()
    assert.equal((await otherOwner.outcome).reason.name, 'AbortError')
    assert.deepEqual(await cancelOwner, { status: 'fulfilled', value: { success: true, cancelled: 1 } })
    const cancelKind = fixture.cancel(otherKind)
    await otherKind.aborted.promise
    otherKind.release.resolve()
    assert.equal((await otherKind.outcome).reason.name, 'AbortError')
    assert.deepEqual(await cancelKind, { status: 'fulfilled', value: { success: true, cancelled: 1 } })
    assertCleanupResult(await fixture.cancel(failed), failure)
    assertCleanupResult(await fixture.stop(), failure)
  } finally { await fixture.finish() }
})
