/** Python任务作用域：信号沿异步调用链传播，窗口销毁与退出都等待真实子进程结束。 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { processAbortError } from './managed-process.mjs'

const context = new AsyncLocalStorage()
const tasks = new Set()
let stopped = false

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
    } finally {
      clearTimeout(timer)
      owner.removeListener('destroyed', abort)
      tasks.delete(task)
    }
  })
  return task.done
}

async function waitForTaskCleanup(selected) {
  const results = await Promise.allSettled(selected.map(task => task.done))
  const failures = results.filter(result => result.status === 'rejected' && result.reason?.code === 'PROCESS_CLEANUP_FAILED')
  if (failures.length) {
    const error = new AggregateError(failures.map(result => result.reason), '进程树清理失败')
    error.code = 'PROCESS_CLEANUP_FAILED'
    throw error
  }
}

export async function cancelOwnedTasks(owner, kind) {
  const selected = [...tasks].filter(task => task.owner === owner && task.kind === kind)
  for (const task of selected) task.controller.abort(processAbortError())
  await waitForTaskCleanup(selected)
  return { success: true, cancelled: selected.length }
}

export async function stopOwnedTasks() {
  stopped = true
  const selected = [...tasks]
  for (const task of selected) task.controller.abort(processAbortError('应用正在退出'))
  await waitForTaskCleanup(selected)
}
