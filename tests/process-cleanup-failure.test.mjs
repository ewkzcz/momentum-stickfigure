import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { runOwnedTask, currentTaskSignal, cancelOwnedTasks, stopOwnedTasks } from '../src/main/owned-process-tasks.mjs'

const owner = () => Object.assign(new EventEmitter(), { isDestroyed: () => false })
const cleanupFailure = () => Object.assign(new Error('受控的进程树清理失败'), { code: 'PROCESS_CLEANUP_FAILED' })
function failingTask(source, kind) {
  return runOwnedTask(source, kind, () => new Promise((resolve, reject) => {
    currentTaskSignal().addEventListener('abort', () => reject(cleanupFailure()), { once: true })
  }))
}

test('取消等待所有任务后传播清理失败，并允许后续任务恢复', async () => {
  const source = owner()
  const task = failingTask(source, 'hd')
  const rejected = assert.rejects(task, { code: 'PROCESS_CLEANUP_FAILED' })
  await assert.rejects(cancelOwnedTasks(source, 'hd'), /进程树清理失败/)
  await rejected
  assert.equal(source.listenerCount('destroyed'), 0)
  assert.equal(await runOwnedTask(source, 'hd', async () => 'recovered'), 'recovered')
})

test('应用停止等待所有任务后传播清理失败而非报告成功', async () => {
  const source = owner()
  const task = failingTask(source, 'ocr')
  const rejected = assert.rejects(task, { code: 'PROCESS_CLEANUP_FAILED' })
  await assert.rejects(stopOwnedTasks(), /进程树清理失败/)
  await rejected
  assert.equal(source.listenerCount('destroyed'), 0)
  await assert.rejects(runOwnedTask(source, 'ocr', async () => true), { name: 'AbortError' })
})
