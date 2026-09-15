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
