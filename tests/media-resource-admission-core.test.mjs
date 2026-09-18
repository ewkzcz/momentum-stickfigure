/** 真实媒体准入核心的独立单例测试；不启动Electron/子进程，不读图片、不复制调度算法。
 * 每项通过独立ESM URL实例隔离模块单例。全部时序使用deferred/操作进入信号。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, getEventListeners } from 'node:events'

let instance = 0
const core = () => import(new URL(`../src/main/media-resource-admission.js?core-test=${++instance}`, import.meta.url).href)
function owner() {
  const value = new EventEmitter()
  value.isDestroyed = () => false
  // 特意不改变isDestroyed返回值，验证destroyed事件的持久失效记录。
  value.destroy = () => value.emit('destroyed')
  return value
}
function deferred(t) {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  // 即使断言失败也放行，不以固定延迟驱动正常测试。
  t.after(() => resolve())
  return { promise, resolve, reject }
}
function observe(promise) {
  const record = { settled: false }
  record.done = promise.then(value => { record.settled = true; record.value = value }, cause => { record.settled = true; record.error = cause; record.failed = true })
  return record
}
function tracked(t, promise) {
  const record = observe(promise)
  t.after(() => record.done)
  return record
}
const code = expected => cause => cause?.code === expected
const reasons = cause => cause instanceof AggregateError ? cause.errors : [cause]

// 1
test('准入核心：普通结果与串行操作保持原值', { timeout: 10000 }, async () => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const source = owner(), result = { ok: true }, order = []
  assert.equal(await withMediaAdmission({ owner: source }, async lease => {
    assert.equal(Object.isFrozen(lease), true)
    assert.equal('release' in lease, false)
    await runMediaOperation(lease, () => { order.push(1) })
    return runMediaOperation(lease, () => { order.push(2); return result })
  }), result)
  assert.deepEqual(order, [1, 2])
  assert.equal(source.listenerCount('destroyed'), 0)
})

// 2
test('准入核心：同步和异步业务原错误保留且异常后恢复', { timeout: 10000 }, async () => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const source = owner()
  for (const mode of ['outer', 'sync-operation', 'async-operation']) {
    const failure = new Error(mode)
    await assert.rejects(withMediaAdmission({ owner: source }, lease => {
      if (mode === 'outer') throw failure
      return runMediaOperation(lease, () => {
        if (mode === 'sync-operation') throw failure
        return Promise.reject(failure)
      })
    }), cause => cause === failure)
    assert.equal(await withMediaAdmission({ owner: source }, () => 'recovered'), 'recovered')
  }
})

// 3
test('准入核心：1活动3等待第五项繁忙并按FIFO交接', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const source = owner(), gates = Array.from({ length: 4 }, () => deferred(t)), starts = Array.from({ length: 4 }, () => deferred(t)), order = []
  const requests = gates.map((gate, index) => tracked(t, withMediaAdmission({ owner: source }, lease => runMediaOperation(lease, async () => {
    order.push(index); starts[index].resolve(); await gate.promise; return index
  }))))
  await starts[0].promise
  const refused = owner()
  await assert.rejects(withMediaAdmission({ owner: refused }, () => assert.fail('第五项不可执行')), cause => cause.code === 'MEDIA_BUSY' && /繁忙/.test(cause.message))
  assert.equal(refused.listenerCount('destroyed'), 0)
  assert.deepEqual(order, [0])
  for (let index = 0; index < 4; index++) {
    assert.deepEqual(order, Array.from({ length: index + 1 }, (_, i) => i))
    gates[index].resolve()
    await requests[index].done
    assert.equal(requests[index].value, index)
    if (index < 3) await starts[index + 1].promise
  }
  assert.equal(source.listenerCount('destroyed'), 0)
})

// 4
test('准入核心：等待取消移除监听、回收名额且从不执行', { timeout: 10000 }, async t => {
  const { withMediaAdmission } = await core()
  const gate = deferred(t), source = owner(), controller = new globalThis.AbortController(), reason = new Error('排队取消')
  const active = tracked(t, withMediaAdmission({ owner: owner() }, () => gate.promise))
  let calls = 0
  const cancelled = tracked(t, withMediaAdmission({ owner: source, signal: controller.signal }, () => { calls++ }))
  const second = tracked(t, withMediaAdmission({ owner: owner() }, () => 2))
  const third = tracked(t, withMediaAdmission({ owner: owner() }, () => 3))
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1)
  controller.abort(reason)
  await cancelled.done
  assert.equal(cancelled.error, reason)
  assert.equal(source.listenerCount('destroyed'), 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  const replacement = tracked(t, withMediaAdmission({ owner: owner() }, () => 4))
  assert.equal(replacement.settled, false)
  gate.resolve(); await Promise.all([active.done, second.done, third.done, replacement.done])
  assert.equal(replacement.value, 4)
  assert.equal(calls, 0)
})

// 5
test('准入核心：等待owner销毁移除监听并永久拒绝该来源', { timeout: 10000 }, async t => {
  const { withMediaAdmission } = await core()
  const gate = deferred(t), source = owner(), controller = new globalThis.AbortController()
  const active = tracked(t, withMediaAdmission({ owner: owner() }, () => gate.promise))
  let calls = 0
  const cancelled = tracked(t, withMediaAdmission({ owner: source, signal: controller.signal }, () => { calls++ }))
  const b = tracked(t, withMediaAdmission({ owner: owner() }, () => 'b'))
  const c = tracked(t, withMediaAdmission({ owner: owner() }, () => 'c'))
  source.destroy(); await cancelled.done
  assert.equal(cancelled.error.code, 'MEDIA_OWNER_DESTROYED')
  assert.equal(source.listenerCount('destroyed'), 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  await assert.rejects(withMediaAdmission({ owner: source }, () => { calls++ }), code('MEDIA_OWNER_DESTROYED'))
  const replacement = tracked(t, withMediaAdmission({ owner: owner() }, () => 'new'))
  gate.resolve(); await Promise.all([active.done, b.done, c.done, replacement.done])
  assert.equal(replacement.value, 'new'); assert.equal(calls, 0)
})

// 6
test('准入核心：无效owner或signal及预先取消销毁均不执行', { timeout: 10000 }, async () => {
  const { withMediaAdmission } = await core()
  const run = () => assert.fail('无效请求不得执行')
  await assert.rejects(withMediaAdmission({ owner: {} }, run), code('MEDIA_INVALID_OWNER'))
  await assert.rejects(withMediaAdmission({ owner: owner(), signal: { aborted: false } }, run), code('MEDIA_INVALID_SIGNAL'))
  const source = owner(), controller = new globalThis.AbortController(), reason = new Error('已经取消')
  controller.abort(reason)
  await assert.rejects(withMediaAdmission({ owner: source, signal: controller.signal }, run), cause => cause === reason)
  source.isDestroyed = () => true
  await assert.rejects(withMediaAdmission({ owner: source }, run), code('MEDIA_OWNER_DESTROYED'))
  assert.equal(source.listenerCount('destroyed'), 0)
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
})

// 7
test('准入核心：监听注册期间取消或销毁亦不会漏过', { timeout: 10000 }, async () => {
  const { withMediaAdmission } = await core()
  for (const mode of ['abort', 'destroy']) {
    const source = owner(), controller = new globalThis.AbortController(), reason = new Error('注册期间取消')
    const once = source.once
    source.once = function (...args) {
      const result = Reflect.apply(once, this, args)
      if (mode === 'abort') controller.abort(reason)
      else source.destroy()
      return result
    }
    await assert.rejects(withMediaAdmission({ owner: source, signal: controller.signal }, () => assert.fail('注册竞态不得执行')), cause => mode === 'abort' ? cause === reason : cause.code === 'MEDIA_OWNER_DESTROYED')
    assert.equal(source.listenerCount('destroyed'), 0)
    assert.equal(getEventListeners(controller.signal, 'abort').length, 0)
  }
})

// 8
test('准入核心：活动取消后成功操作仍须真实结算和收尾才交接', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t), cleanupEntered = deferred(t), cleanupGate = deferred(t), controller = new globalThis.AbortController(), reason = new Error('活动取消')
  let lease, context, nextStarted = false
  const first = tracked(t, withMediaAdmission({ owner: owner(), signal: controller.signal }, value => {
    lease = value
    return runMediaOperation(value, async current => {
      context = current; entered.resolve()
      try { await gate.promise; return '不得成功交付' }
      finally { cleanupEntered.resolve(); await cleanupGate.promise }
    })
  }))
  await entered.promise
  const next = tracked(t, withMediaAdmission({ owner: owner() }, () => { nextStarted = true; return 'next' }))
  controller.abort(reason)
  assert.equal(context.signal.aborted, true)
  assert.throws(() => context.check(), cause => cause === reason)
  assert.throws(() => runMediaOperation(lease, () => assert.fail()), cause => cause === reason)
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  gate.resolve(); await cleanupEntered.promise
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  cleanupGate.resolve(); await Promise.all([first.done, next.done])
  assert.equal(first.error, reason); assert.equal(next.value, 'next')
})

// 9
test('准入核心：活动取消后原操作拒绝保留原错误与取消原因', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t), controller = new globalThis.AbortController(), failure = new Error('真实操作失败'), reason = new Error('取消')
  let nextStarted = false
  const first = tracked(t, withMediaAdmission({ owner: owner(), signal: controller.signal }, lease => runMediaOperation(lease, () => { entered.resolve(); return gate.promise })))
  await entered.promise
  const next = tracked(t, withMediaAdmission({ owner: owner() }, () => { nextStarted = true }))
  controller.abort(reason)
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  gate.reject(failure); await Promise.all([first.done, next.done])
  assert.equal(nextStarted, true)
  assert.deepEqual(reasons(first.error), [failure, reason])
  assert.equal(first.error.cause, failure)
})

// 10
test('准入核心：活动owner销毁也须等待操作真正结束', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const source = owner(), entered = deferred(t), gate = deferred(t)
  let nextStarted = false
  const first = tracked(t, withMediaAdmission({ owner: source }, lease => runMediaOperation(lease, () => { entered.resolve(); return gate.promise })))
  await entered.promise
  const next = tracked(t, withMediaAdmission({ owner: owner() }, () => { nextStarted = true }))
  source.destroy()
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  gate.resolve(); await Promise.all([first.done, next.done])
  assert.equal(first.error.code, 'MEDIA_OWNER_DESTROYED')
  assert.equal(source.listenerCount('destroyed'), 0)
})

// 11
test('准入核心：伪造、跨实例和过期lease同步拒绝', { timeout: 10000 }, async () => {
  const first = await core(), second = await core()
  for (const fake of [{}, null, 'lease']) assert.throws(() => first.runMediaOperation(fake, () => assert.fail()), code('MEDIA_INVALID_LEASE'))
  let saved
  await first.withMediaAdmission({ owner: owner() }, lease => {
    saved = lease
    assert.throws(() => second.runMediaOperation(lease, () => assert.fail()), code('MEDIA_INVALID_LEASE'))
    assert.throws(() => first.runMediaOperation(lease, null), TypeError)
    return first.runMediaOperation(lease, () => 'ok')
  })
  assert.throws(() => first.runMediaOperation(saved, () => assert.fail()), code('MEDIA_INVALID_LEASE'))
})

// 12
test('准入核心：并发及嵌套操作同步拒绝且已登记操作安全收尾', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t)
  let saved, nested = false
  const request = tracked(t, withMediaAdmission({ owner: owner() }, lease => {
    saved = lease
    const operation = runMediaOperation(lease, async () => {
      assert.throws(() => runMediaOperation(lease, () => assert.fail()), code('MEDIA_OPERATION_OVERLAP'))
      nested = true; entered.resolve(); await gate.promise; return 'original'
    })
    assert.throws(() => runMediaOperation(lease, () => assert.fail()), code('MEDIA_OPERATION_OVERLAP'))
    return operation
  }))
  await entered.promise
  assert.equal(nested, true)
  assert.throws(() => runMediaOperation(saved, () => assert.fail()), code('MEDIA_OPERATION_OVERLAP'))
  assert.equal(request.settled, false)
  gate.resolve(); await request.done
  assert.equal(request.value, 'original')
})

// 13
test('准入核心：漏await成功操作仍等待且关闭后禁止新登记', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t)
  let saved, nextStarted = false
  const first = tracked(t, withMediaAdmission({ owner: owner() }, lease => {
    saved = lease
    runMediaOperation(lease, () => { entered.resolve(); return gate.promise })
    return 'outer-result'
  }))
  await entered.promise
  assert.throws(() => runMediaOperation(saved, () => assert.fail()), code('MEDIA_LEASE_CLOSED'))
  const next = tracked(t, withMediaAdmission({ owner: owner() }, () => { nextStarted = true }))
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  gate.resolve(); await Promise.all([first.done, next.done])
  assert.equal(first.value, 'outer-result')
})

// 14
test('准入核心：漏await操作错误不能吞为成功或成为未处理拒绝', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t), failure = new Error('遗漏await的原错误')
  const request = tracked(t, withMediaAdmission({ owner: owner() }, lease => {
    // 刻意不附加catch：生产核心必须同步安装拒绝观察，node:test会报告未处理拒绝。
    runMediaOperation(lease, () => { entered.resolve(); return gate.promise })
    return '不能成功'
  }))
  await entered.promise
  assert.equal(request.settled, false)
  gate.reject(failure); await request.done
  assert.equal(request.error, failure)
  assert.equal(await withMediaAdmission({ owner: owner() }, () => '恢复'), '恢复')
})

// 15
test('准入核心：外层抛错仍等待遗漏操作并保留两个错误', { timeout: 10000 }, async t => {
  const { withMediaAdmission, runMediaOperation } = await core()
  const entered = deferred(t), gate = deferred(t), outer = new Error('外层错误'), inner = new Error('在途错误')
  let nextStarted = false
  const first = tracked(t, withMediaAdmission({ owner: owner() }, lease => {
    runMediaOperation(lease, () => { entered.resolve(); return gate.promise })
    throw outer
  }))
  await entered.promise
  const next = tracked(t, withMediaAdmission({ owner: owner() }, () => { nextStarted = true }))
  assert.equal(first.settled, false); assert.equal(nextStarted, false)
  gate.reject(inner); await Promise.all([first.done, next.done])
  assert.deepEqual(reasons(first.error), [outer, inner])
  assert.equal(first.error.cause, outer)
})

// 16
test('准入核心：解除监听失败不掩盖业务错误且活动槽仍可恢复', { timeout: 10000 }, async () => {
  const { withMediaAdmission } = await core()
  const source = owner(), failure = new Error('业务错误'), cleanup = new Error('清理错误')
  const remove = source.removeListener
  source.removeListener = function (...args) { Reflect.apply(remove, this, args); throw cleanup }
  await assert.rejects(withMediaAdmission({ owner: source }, () => { throw failure }), cause => {
    assert.deepEqual(reasons(cause), [failure, cleanup]); assert.equal(cause.cause, failure); return true
  })
  assert.equal(source.listenerCount('destroyed'), 0)
  assert.equal(await withMediaAdmission({ owner: owner() }, () => '恢复'), '恢复')
})
