/** 主画布请求的唯一归属；离屏绘制完成后，仅当前有效请求可以提交。 */
import { ref, watch, onScopeDispose } from 'vue'
import { bindRenderSignal } from '../utils/renderImageTask.js'

const coordinators = new WeakMap()

/** 同一 canvas ref 的独立组合模块也共享归属，页面可以显式注入此实例。 */
export function getCanvasRenderCoordinator(deps) {
  if (deps.renderCoordinator) return deps.renderCoordinator
  if (deps.canvasRef && coordinators.has(deps.canvasRef)) return coordinators.get(deps.canvasRef)
  const coordinator = createCanvasRenderCoordinator(deps)
  if (deps.canvasRef) coordinators.set(deps.canvasRef, coordinator)
  return coordinator
}

/** 页面会话和固有尺寸同步失效；A→B→A 每次变更都推进版本，缓存停用不销毁。 */
export function bindCanvasRenderSession(coordinator, { currentPsdData, currentPsdFile, canvasRef, canvasWidth, canvasHeight }) {
  const stop = watch([currentPsdData, currentPsdFile, canvasRef, canvasWidth, canvasHeight], () => coordinator.invalidate(), { flush: 'sync' })
  onScopeDispose(() => { stop(); coordinator.invalidate() })
}

export function createCanvasRenderCoordinator({ canvasRef, isRendering = ref(false) }) {
  let sequence = 0, generation = 0, current = null

  const isCurrent = request => Boolean(request && current === request && !request.settled &&
    !request.signal.aborted && request.generation === generation && canvasRef.value === request.canvas &&
    request.canvas.width === request.width && request.canvas.height === request.height)

  const finish = (request, status = 'stale') => {
    if (!request || request.settled) return request?.result
    request.settled = true
    clearTimeout(request.timer)
    request.result = { status, sequence: request.sequence }
    // 先确定终态再取消等待，异步 catch/finally 无权更改其他请求。
    request.controller.abort(Object.assign(new Error(`Render ${status}`), { name: status === 'timeout' ? 'TimeoutError' : 'AbortError' }))
    if (current === request) isRendering.value = false
    request.resolve(request.result)
    return request.result
  }

  const begin = () => {
    finish(current, 'stale')
    const canvas = canvasRef.value
    if (!canvas) return null
    const controller = new globalThis.AbortController()
    const request = { sequence: ++sequence, generation, canvas, width: canvas.width, height: canvas.height,
      controller, signal: controller.signal, settled: false }
    request.done = new Promise(resolve => { request.resolve = resolve })
    current = request
    isRendering.value = true
    request.timer = setTimeout(() => finish(request, 'timeout'), 10000)
    return request
  }

  const createBuffer = request => {
    if (!isCurrent(request)) throw Object.assign(new Error('Render stale'), { name: 'AbortError' })
    const canvas = document.createElement('canvas')
    canvas.width = request.width
    canvas.height = request.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('无法创建离屏Canvas上下文')
    bindRenderSignal(ctx, request.signal)
    return { canvas, ctx }
  }

  const commit = (request, buffer) => {
    if (!isCurrent(request)) { finish(request, 'stale'); return false }
    const ctx = request.canvas.getContext('2d')
    if (!ctx) throw new Error('无法获取Canvas 2D上下文')
    ctx.clearRect(0, 0, request.width, request.height)
    ctx.drawImage(buffer, 0, 0)
    finish(request, 'committed')
    return true
  }

  const invalidate = () => { generation++; finish(current, 'stale') }
  const waitForCurrent = async () => {
    while (current) {
      const request = current
      const result = await request.done
      if (current === request) return result
    }
    return { status: 'idle', sequence }
  }
  return { begin, finish, createBuffer, commit, invalidate, isCurrent, waitForCurrent, isRendering,
    get sequence() { return sequence }, get generation() { return generation } }
}
