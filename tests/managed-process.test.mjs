import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { runManagedProcess } from '../src/main/managed-process.mjs'

test('受控进程：退出确认错误具有稳定清理失败标识', { timeout: 10000 }, async () => {
  const kill = process.kill
  let pid
  try {
    process.kill = function (target, signal) {
      if (target === -pid && signal === 0) throw Object.assign(new Error('受控退出确认失败'), { code: 'EIO' })
      return kill.call(process, target, signal)
    }
    await assert.rejects(runManagedProcess(process.execPath, ['-e', 'process.stdout.write("done")'], {
      onSpawn: child => { pid = child.pid }
    }), error => {
      assert.equal(error.code, 'PROCESS_CLEANUP_FAILED')
      assert.equal(error.cause.code, 'EIO')
      assert.equal(error.stdout, 'done')
      return true
    })
  } finally {
    process.kill = kill
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
})

test('受控进程：真实成功失败、超时、取消及后续恢复', { timeout: 15000 }, async () => {
  assert.deepEqual(await runManagedProcess(process.execPath, ['-e', 'process.stdout.write("ok")']), { stdout: 'ok', stderr: '' })
  await assert.rejects(runManagedProcess(process.execPath, ['-e', 'process.exit(2)']), /退出码 2/)
  await assert.rejects(runManagedProcess(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 100 }), /超时/)
  const controller = new globalThis.AbortController()
  let child
  const promise = runManagedProcess(process.execPath, ['-e', 'process.stdout.write("ready");setInterval(()=>{},1000)'], { signal: controller.signal, onSpawn: value => { child = value } })
  const handled = assert.rejects(promise, { name: 'AbortError' })
  await once(child.stdout, 'data')
  controller.abort()
  await handled
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
  assert.equal((await runManagedProcess(process.execPath, ['-e', 'process.stdout.write("recovered")'])).stdout, 'recovered')
})

test('受控进程：父进程结束时清理真实后代进程组', { timeout: 10000 }, async () => {
  const script = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:"ignore"});process.stdout.write(String(c.pid));c.unref()'
  const result = await runManagedProcess(process.execPath, ['-e', script])
  assert.throws(() => process.kill(Number(result.stdout), 0), { code: 'ESRCH' })
})

test('受控进程：父进程退出后不等待继承管道的后代自行结束', { timeout: 10000 }, async () => {
  const script = 'const {spawn}=require("node:child_process");const c=spawn(process.execPath,["-e","setInterval(()=>{},1000)"],{stdio:["ignore",1,2]});process.stdout.write(String(c.pid));c.unref()'
  const result = await runManagedProcess(process.execPath, ['-e', script], { timeoutMs: 2000 })
  assert.throws(() => process.kill(Number(result.stdout), 0), { code: 'ESRCH' })
})

test('受控进程：输出有界及忽略SIGTERM时强制退出', { timeout: 10000 }, async () => {
  await assert.rejects(runManagedProcess(process.execPath, ['-e', 'process.stdout.write("a".repeat(4096))'], { maxOutputBytes: 1024 }), /输出超过限制/)
  let child
  const controller = new globalThis.AbortController()
  const promise = runManagedProcess(process.execPath, ['-e', 'process.on("SIGTERM",()=>{});process.stdout.write("ready");setInterval(()=>{},1000)'], { signal: controller.signal, onSpawn: value => { child = value } })
  const handled = assert.rejects(promise, { name: 'AbortError' })
  await once(child.stdout, 'data')
  controller.abort()
  await handled
  assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' })
})
