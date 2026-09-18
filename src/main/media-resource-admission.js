/** 媒体链的主进程阶段准入：单例1活动、最多3个FIFO等待；尚未接入媒体入口。
 * owner只做内部结构/生命周期检查，真实性仍由可信IPC调用点保证。
 * 不使用隐式异步上下文，不持有图片缓存，不保证原生内存释放或RSS上界。
 */
const waiting = []
const leases = new WeakMap()
const destroyedOwners = new WeakSet()
let active = null
const aborted = Object.getOwnPropertyDescriptor(globalThis.AbortSignal.prototype, 'aborted').get
const abortReason = Object.getOwnPropertyDescriptor(globalThis.AbortSignal.prototype, 'reason').get
const error = (code, message) => Object.assign(new Error(message), { code })

function combined(failures) {
  const unique = failures.filter((item, index) => failures.findIndex(other => Object.is(other, item)) === index)
  return unique.length === 1 ? unique[0] : new AggregateError(unique, '媒体阶段失败，附带取消或收尾错误', { cause: unique[0] })
}

function cancel(entry, reason) {
  if (entry.phase === 'done' || entry.cancelled) return
  entry.cancelled = true
  entry.reason = reason
  // 此信号供活动操作协作取消；绝不据此提前释放活动槽。
  entry.controller.abort(reason)
  if (entry.phase === 'waiting') {
    waiting.splice(waiting.indexOf(entry), 1)
    finish(entry, undefined, [])
  }
}

function refreshCancellation(entry) {
  if (entry.cancelled || entry.phase === 'done') return
  if (destroyedOwners.has(entry.owner) || entry.owner.isDestroyed()) {
    destroyedOwners.add(entry.owner)
    cancel(entry, error('MEDIA_OWNER_DESTROYED', '媒体来源已关闭'))
  } else if (entry.signal && aborted.call(entry.signal)) cancel(entry, abortReason.call(entry.signal))
}

function check(entry) {
  if (entry.phase === 'done') throw error('MEDIA_INVALID_LEASE', '媒体额度已失效')
  refreshCancellation(entry)
  if (entry.cancelled) throw entry.reason
}

function finish(entry, value, failures) {
  if (entry.phase === 'done') return
  entry.phase = 'done'
  if (entry.lease) leases.delete(entry.lease)
  const cleanupErrors = []
  for (const remove of entry.removers.splice(0).reverse()) {
    try { remove() } catch (cause) { cleanupErrors.push(cause) }
  }
  const all = [...failures.filter(cause => !entry.cancelled || !Object.is(cause, entry.reason)),
    ...(entry.cancelled ? [entry.reason] : []), ...cleanupErrors]
  entry.run = null
  if (active === entry) active = null
  if (all.length) entry.reject(combined(all))
  else entry.resolve(value)
  pump()
}

async function execute(entry) {
  let value
  const failures = []
  try {
    check(entry)
    value = await entry.run(entry.lease)
  } catch (cause) { failures.push(cause) }
  // 回调退出即关闭登记入口；漏await的已登记操作仍必须真正结算。
  entry.phase = 'closing'
  if (entry.operation) await entry.operation.settled
  failures.push(...entry.operationErrors)
  try { check(entry) } catch (cause) { failures.push(cause) }
  finish(entry, value, failures)
}

function pump() {
  if (active || !waiting.length) return
  const entry = waiting.shift()
  active = entry
  entry.phase = 'active'
  entry.lease = Object.freeze(Object.create(null))
  leases.set(entry.lease, entry)
  // execute内部收集业务与清理错误；这里不建立独立后台任务或提前返回活动结果。
  void execute(entry)
}

/** run(lease)只在取得活动槽后执行。拒绝/取消均通过返回Promise交付。
 * signal须为真实AbortSignal；owner须为主进程提供的生命周期对象。
 * 回调/登记操作失败优先，取消其次，解除监听错误最后；多个不同原因使用AggregateError。
 */
export function withMediaAdmission({ owner, signal } = {}, run) {
  return new Promise((resolve, reject) => {
    let entry
    try {
      if (!owner || typeof owner !== 'object' || typeof owner.isDestroyed !== 'function' || typeof owner.once !== 'function' || typeof owner.removeListener !== 'function') throw error('MEDIA_INVALID_OWNER', '媒体来源生命周期对象无效')
      if (typeof run !== 'function') throw new TypeError('媒体阶段必须提供执行函数')
      if (signal !== undefined) {
        try { aborted.call(signal); abortReason.call(signal) }
        catch { throw error('MEDIA_INVALID_SIGNAL', '媒体取消信号无效') }
      }
      entry = { owner, signal, run, resolve, reject, phase: 'preparing', lease: null, operation: null,
        operationErrors: [], cancelled: false, reason: undefined, controller: new globalThis.AbortController(), removers: [] }
      // 先检查，订阅后再检查；覆盖已经取消及注册监听期间的取消/销毁。
      refreshCancellation(entry)
      if (entry.cancelled) { finish(entry, undefined, []); return }
      const onDestroyed = () => {
        destroyedOwners.add(owner)
        cancel(entry, error('MEDIA_OWNER_DESTROYED', '媒体来源已关闭'))
      }
      entry.removers.push(() => owner.removeListener('destroyed', onDestroyed))
      owner.once('destroyed', onDestroyed)
      if (signal) {
        const onAbort = () => cancel(entry, abortReason.call(signal))
        entry.removers.push(() => signal.removeEventListener('abort', onAbort))
        signal.addEventListener('abort', onAbort, { once: true })
      }
      refreshCancellation(entry)
      if (entry.cancelled) { finish(entry, undefined, []); return }
      if (active && waiting.length >= 3) {
        finish(entry, undefined, [error('MEDIA_BUSY', '媒体处理繁忙，请稍后重试')])
        return
      }
      entry.phase = 'waiting'
      waiting.push(entry)
      pump()
    } catch (cause) {
      if (entry) finish(entry, undefined, [cause])
      else reject(cause)
    }
  })
}

/** 同步校验并登记一个操作，返回其真实执行结果的Promise。
 * 伪造/过期/关闭额度及重叠调用同步抛错，避免忽略一个校验用的拒绝Promise。
 * operation({signal, check})内部可串行组合私有函数，不可再登记嵌套操作。
 * 每次操作失败都会使本阶段失败；可恢复的预期错误应在operation内部处理。
 * 已登记Promise自带不抛出的拒绝观察，即使漏await也不会产生unhandled rejection。
 */
export function runMediaOperation(lease, operation) {
  const entry = leases.get(lease)
  if (!entry) throw error('MEDIA_INVALID_LEASE', '媒体额度无效或已过期')
  if (entry.phase !== 'active') throw error('MEDIA_LEASE_CLOSED', '媒体阶段已关闭新操作入口')
  check(entry)
  if (entry.operation) throw error('MEDIA_OPERATION_OVERLAP', '同一媒体额度不允许重叠或嵌套操作')
  if (typeof operation !== 'function') throw new TypeError('媒体操作必须是函数')
  const record = {}
  entry.operation = record
  const context = Object.freeze({ signal: entry.controller.signal, check: () => check(entry) })
  const promise = Promise.resolve().then(() => {
    check(entry)
    return operation(context)
  }).then(value => {
    check(entry)
    return value
  })
  record.settled = promise.then(() => {
    if (entry.operation === record) entry.operation = null
  }, cause => {
    entry.operationErrors.push(cause)
    if (entry.operation === record) entry.operation = null
  })
  return promise
}
