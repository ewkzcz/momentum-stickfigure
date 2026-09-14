/** PSD会话身份只随文件/数据切换推进；画布挂载、尺寸变化和缓存停用不使其失效。 */
import { watch, onScopeDispose } from 'vue'

const guards = new WeakMap()

/** 同一页面文件ref共享唯一会话版本，真正作用域销毁后拒绝所有旧续体。 */
export function usePsdSessionGuard({ currentPsdFile, currentPsdData }) {
  if (guards.has(currentPsdFile)) return guards.get(currentPsdFile)
  let version = 0, disposed = false
  const stop = watch([currentPsdFile, currentPsdData], () => { version++ }, { flush: 'sync' })
  const guard = {
    get disposed() { return disposed },
    capture() {
      const captured = version
      return () => !disposed && version === captured
    }
  }
  guards.set(currentPsdFile, guard)
  onScopeDispose(() => { disposed = true; version++; stop() })
  return guard
}
