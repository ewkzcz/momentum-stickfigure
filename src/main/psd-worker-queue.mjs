/** PSD单活动队列：每项使用独立工作线程，确认退出后才结算并启动下一项。 */
import { Worker } from 'node:worker_threads'
import { PSD_ERROR_MESSAGES } from './psd-api/psd-constants.mjs'

const pending = []
let active = null
let stopped = false

/**
 * 创建取消错误。
 * 处理流程：
 * 1、用独立错误名区分主动取消和解析失败。
 */
function cancellationError() {
  // 1、错误名称仅供任务控制，不改变原解析错误包装。
  const error = new Error('PSD解析已取消')
  error.name = 'AbortError'
  return error
}

/**
 * 释放任务持有的输入与订阅并结算一次。
 * 处理流程：
 * 1、解除取消监听和定时器，清空大对象引用。
 * 2、按已确定的结果完成或拒绝调用。
 */
function settle(job, error, value) {
  // 1、已结算任务不再处理迟到的取消或退出。
  if (job.settled) return
  job.settled = true
  clearTimeout(job.timer)
  job.signal?.removeEventListener('abort', job.abort)
  job.fileBuffer = null
  job.options = null
  // 2、只在工作线程已经退出或从未启动时释放调用方；结算前取消仍拒绝迟到成功。
  if (!error && job.signal?.aborted) error = cancellationError()
  job.signal = null
  if (error) job.reject(error)
  else job.resolve(value)
}

/**
 * 启动下一项等待任务。
 * 处理流程：
 * 1、保持单活动线程，复制输入但不分离调用方缓冲区。
 * 2、在主进程监督超时、取消、消息和异常。
 * 3、确认线程退出后结算，并继续先入先出的队列。
 */
function startNext() {
  // 1、关闭中的队列不接受新的活动任务。
  if (active || stopped || pending.length === 0) return
  const job = pending.shift()
  active = job
  let worker
  let outcome = null

  /**
   * 确定本项最终结果并请求真实终止。
   * 处理流程：
   * 1、首个结果生效，清理超时并终止线程；退出事件负责结算。
   */
  const finish = (error, value) => {
    // 1、迟到的成功不能覆盖取消或超时。
    if (outcome) return
    outcome = { error, value }
    clearTimeout(job.timer)
    // terminate拒绝时仍等待exit，禁止在旧线程未退出时启动下一项。
    void worker.terminate().catch(terminationError => {
      console.error('PSD工作线程终止失败:', terminationError)
    })
  }

  try {
    // 2、路径相对于实际主进程产物，不依赖工作目录。
    worker = new Worker(new URL('./psd-api/psd-worker.mjs', import.meta.url), {
      workerData: { fileBuffer: job.fileBuffer, options: job.options },
      execArgv: []
    })
    job.fileBuffer = null
    job.options = null
    job.cancelActive = () => finish(cancellationError())
    job.timer = setTimeout(() => finish(new Error(PSD_ERROR_MESSAGES.TIMEOUT)), job.timeout)
    worker.once('message', message => {
      if (message?.success === true) finish(null, message.result)
      else finish(new Error(message?.error || 'PSD工作线程返回无效结果'))
    })
    worker.once('error', error => finish(error))
    worker.once('exit', code => {
      // 3、退出确认是释放活动槽的唯一正常入口。
      clearTimeout(job.timer)
      worker.removeAllListeners()
      job.cancelActive = null
      active = null
      settle(job, outcome ? outcome.error : new Error(`PSD工作线程意外退出: ${code}`), outcome?.value)
      startNext()
    })
  } catch (error) {
    // 4、构造线程失败时没有活动线程，直接释放并继续下一项。
    active = null
    settle(job, error)
    startNext()
  }
}

/**
 * 将一次解析加入队列。
 * 处理流程：
 * 1、拒绝关闭后或已取消的请求。
 * 2、订阅本项取消并排队，运行超时从实际启动起计算。
 */
export function parsePSDInWorker(fileBuffer, options = {}, timeout = 30000, signal) {
  // 1、关闭后拒绝新任务，避免退出期间重新创建线程。
  if (stopped || signal?.aborted) return Promise.reject(cancellationError())
  return new Promise((resolve, reject) => {
    const job = { fileBuffer, options, timeout, signal, resolve, reject, settled: false }
    /**
     * 取消等待或运行中的本项任务。
     * 处理流程：
     * 1、活动任务实际终止，等待任务移出队列并立即释放。
     */
    job.abort = () => {
      // 1、活动任务必须等待exit，不能只拒绝外层Promise。
      if (active === job) job.cancelActive?.()
      else {
        const index = pending.indexOf(job)
        if (index >= 0) pending.splice(index, 1)
        settle(job, cancellationError())
      }
    }
    // 2、任务先进入队列，取消回调始终可以找到所属记录。
    pending.push(job)
    signal?.addEventListener('abort', job.abort, { once: true })
    startNext()
  })
}

/**
 * 停止接收解析并终止全部未完成任务。
 * 处理流程：
 * 1、取消等待项和活动项，返回活动任务退出后的完成屏障。
 */
export function stopPSDWorkers() {
  // 1、入口永久关闭；应用退出后无需复用队列。
  stopped = true
  for (const job of pending.splice(0)) settle(job, cancellationError())
  if (!active) return Promise.resolve()
  const job = active
  return new Promise(resolve => {
    const originalResolve = job.resolve
    const originalReject = job.reject
    job.resolve = value => { originalResolve(value); resolve() }
    job.reject = error => { originalReject(error); resolve() }
    job.cancelActive?.()
  })
}
