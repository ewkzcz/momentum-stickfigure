/** 受控子进程：只在确认close后结算；超时/取消终止整个进程组并限制输出。 */
import { spawn, execFile } from 'node:child_process'
import { promisify } from 'node:util'
const execFileAsync = promisify(execFile)
import { setTimeout as pollDelay } from 'node:timers/promises'

async function waitForProcessGroup(pid) {
  if (process.platform === 'win32' || !pid) return
  const deadline = Date.now() + 5000
  while (true) {
    try { process.kill(-pid, 0) }
    catch (error) {
      if (error.code === 'ESRCH') return
      if (error.code !== 'EPERM') throw error
      // macOS可能对已消失的进程组返回EPERM；只在系统进程表确认无成员后接受退出。
      const { stdout } = await execFileAsync('/bin/ps', ['-axo', 'pgid='], { maxBuffer: 4 * 1024 * 1024 })
      if (!stdout.split(/\s+/).some(value => Number(value) === pid)) return
      throw error
    }
    if (Date.now() >= deadline) throw new Error('子进程组退出确认超时')
    await pollDelay(10)
  }
}

export function processAbortError(message = '任务已取消') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function runManagedProcess(command, args, { signal, timeoutMs = 30 * 60 * 1000, maxOutputBytes = 8 * 1024 * 1024, env, cwd, onSpawn } = {}) {
  if (signal?.aborted) return Promise.reject(signal.reason || processAbortError())
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return Promise.reject(new TypeError('无效进程超时'))
  return new Promise((resolve, reject) => {
    let child, timer, escalation, failure, cleanupFailure, stdout = '', stderr = '', outputBytes = 0
    let killer = Promise.resolve()
    const terminate = force => {
      if (!child?.pid) return
      if (process.platform === 'win32') {
        killer = killer.then(() => new Promise((done, fail) => {
          const taskkill = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
          taskkill.once('error', fail)
          taskkill.once('close', done)
        })).catch(error => { cleanupFailure ||= error })
      } else {
        try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') }
        catch (error) {
          // EPERM可能是macOS已消失的组；最终仍必须通过系统进程表确认，不能直接当作成功。
          if (error.code !== 'ESRCH' && error.code !== 'EPERM') cleanupFailure ||= error
        }
      }
    }
    const abort = reason => {
      if (failure) return
      failure = reason
      terminate(false)
      escalation = setTimeout(() => terminate(true), 500)
    }
    const onAbort = () => abort(signal.reason || processAbortError())
    const append = (kind, chunk) => {
      outputBytes += chunk.length
      if (outputBytes > maxOutputBytes) { abort(new Error('子进程输出超过限制')); return }
      if (kind === 'stdout') stdout += chunk.toString()
      else stderr += chunk.toString()
    }
    try {
      child = spawn(command, args, { env, cwd, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      child.stdout.on('data', chunk => append('stdout', chunk))
      child.stderr.on('data', chunk => append('stderr', chunk))
      child.once('error', error => { failure ||= error })
      // 后代可能继承stdout/stderr；父进程退出后立即清理，不能等后代关闭管道才触发close。
      child.once('exit', () => terminate(true))
      child.once('close', async (code, exitSignal) => {
        clearTimeout(timer)
        clearTimeout(escalation)
        signal?.removeEventListener('abort', onAbort)
        // 父进程先退出时仍清理同组后代，避免关闭管道的后台子进程残留。
        terminate(true)
        await killer
        try { await waitForProcessGroup(child.pid) } catch (error) { cleanupFailure = error }
        if (cleanupFailure) {
          failure = new Error('进程树清理失败', { cause: cleanupFailure })
          failure.code = 'PROCESS_CLEANUP_FAILED'
        }
        if (!failure && code !== 0) failure = new Error(`子进程执行失败，退出码 ${code}，信号 ${exitSignal || '无'}`)
        if (failure) {
          failure.stdout = stdout; failure.stderr = stderr
          reject(failure)
        } else resolve({ stdout, stderr })
      })
      signal?.addEventListener('abort', onAbort, { once: true })
      timer = setTimeout(() => abort(new Error('子进程执行超时')), timeoutMs)
      if (signal?.aborted) onAbort()
      onSpawn?.(child)
    } catch (error) {
      if (child) abort(error)
      else reject(error)
    }
  })
}
