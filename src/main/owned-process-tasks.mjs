/** Python任务作用域：信号沿异步调用链传播，窗口销毁与退出都等待真实子进程结束。 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { processAbortError } from './managed-process.mjs'

const context = new AsyncLocalStorage()
const tasks = new Set()
// 退出保留全部未解决的原始错误，不截断或自动清空；仅按错误对象身份去重。
// 不额外保存 task/owner，取消索引用 WeakMap；原始错误图自身的引用仍随错误保留。
const cleanupFailures = new Set()
const ownerCleanupFailures = new WeakMap()
let stopped = false

/** 遍历原始错误图，兼容嵌套聚合和 cause；循环引用不能阻塞退出。 */
function hasCleanupFailure(reason) {
  const pending = [reason], seen = new Set()
  while (pending.length) {
    const error = pending.pop()
    if (!error || (typeof error !== 'object' && typeof error !== 'function') || seen.has(error)) continue
    seen.add(error)
    if (error.code === 'PROCESS_CLEANUP_FAILED') return true
    if (error.cause) pending.push(error.cause)
    if (error instanceof AggregateError) for (const nested of error.errors) pending.push(nested)
  }
  return false
}

function rememberCleanupFailure(owner, kind, reason) {
  if (!hasCleanupFailure(reason)) return
  cleanupFailures.add(reason)
  let kinds = ownerCleanupFailures.get(owner)
  if (!kinds) ownerCleanupFailures.set(owner, kinds = new Map())
  let failures = kinds.get(kind)
  if (!failures) kinds.set(kind, failures = new Set())
  failures.add(reason)
}

function throwCleanupFailures(failures) {
  if (!failures?.size) return
  const error = new AggregateError([...failures], '进程树清理失败')
  error.code = 'PROCESS_CLEANUP_FAILED'
  throw error
}

export function currentTaskSignal() { return context.getStore()?.signal }

export async function runOwnedTask(owner, kind, execute, timeoutMs = 30 * 60 * 1000) {
  if (stopped || owner.isDestroyed()) throw processAbortError('任务来源已关闭')
  if ([...tasks].some(task => task.owner === owner && task.kind === kind)) throw new Error('同类任务仍在执行')
  const controller = new globalThis.AbortController()
  const abort = () => controller.abort(processAbortError('任务窗口已关闭'))
  const task = { owner, kind, controller, done: null }
  tasks.add(task)
  owner.once('destroyed', abort)
  const timer = setTimeout(() => controller.abort(new Error('任务执行超时')), timeoutMs)
  task.done = context.run({ signal: controller.signal }, async () => {
    try {
      const value = await execute()
      if (controller.signal.aborted) throw controller.signal.reason
      return value
    } catch (error) {
      rememberCleanupFailure(owner, kind, error)
      throw error
    } finally {
      clearTimeout(timer)
      owner.removeListener('destroyed', abort)
      tasks.delete(task)
    }
  })
  return task.done
}

async function waitForTaskCleanup(selected) {
  // 普通业务失败不阻止退出；清理失败已在任务删除前保留，等待全部结算后由调用范围报告。
  await Promise.allSettled(selected.map(task => task.done))
}

export async function cancelOwnedTasks(owner, kind) {
  const selected = [...tasks].filter(task => task.owner === owner && task.kind === kind)
  for (const task of selected) task.controller.abort(processAbortError())
  await waitForTaskCleanup(selected)
  throwCleanupFailures(ownerCleanupFailures.get(owner)?.get(kind))
  return { success: true, cancelled: selected.length }
}

export async function stopOwnedTasks() {
  stopped = true
  const selected = [...tasks]
  for (const task of selected) task.controller.abort(processAbortError('应用正在退出'))
  await waitForTaskCleanup(selected)
  throwCleanupFailures(cleanupFailures)
}
