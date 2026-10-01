const renderSignals = new WeakMap()

/** 将渲染任务的取消信号关联到上下文，不修改 Canvas 原生对象。 */
export const bindRenderSignal = (ctx, signal) => {
  if (signal) renderSignals.set(ctx, signal)
  else renderSignals.delete(ctx)
  return ctx
}

export const getRenderSignal = ctx => renderSignals.get(ctx)

const taskError = (name, message) => Object.assign(new Error(message), { name })

const abortError = signal => {
  if (signal.reason instanceof Error && signal.reason.name === 'AbortError') return signal.reason
  const error = taskError('AbortError', '渲染图像加载已取消')
  if (signal.reason !== undefined) error.cause = signal.reason
  return error
}

/** 每次异步等待后检查，避免已失效的任务继续写入画布。 */
export const assertRenderActive = ctx => {
  const signal = getRenderSignal(ctx)
  if (signal?.aborted) throw abortError(signal)
}

/** Image 事件仅负责一次性结算；绘制业务必须在 await 后运行。 */
export const loadRenderImage = (source, { signal, timeout = 5000 } = {}) => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError(signal))
    return
  }

  let image
  let timer
  let settled = false
  const finish = error => {
    if (settled) return
    settled = true
    if (image) {
      image.onload = null
      image.onerror = null
    }
    if (timer !== undefined) clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
    if (error) reject(error)
    else resolve(image)
  }
  const onAbort = () => finish(abortError(signal))

  try {
    image = new Image()
    image.onload = () => finish()
    image.onerror = () => finish(taskError('ImageLoadError', '图像加载失败'))
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(taskError('TimeoutError', '图像加载超时')), timeout)
    // 注册完成后再检查一次，兼容在注册期间已取消的信号。
    if (signal?.aborted) onAbort()
    if (!settled) image.src = source
  } catch (error) {
    finish(error instanceof Error ? error : new Error(String(error)))
  }
})
