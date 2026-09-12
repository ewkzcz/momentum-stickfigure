/** 拖拽订阅所有权回归：真实订阅模块只能清理自身监听，不能移除同通道的其他消费者。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { EventEmitter } from 'node:events'
import { useDragFinishedSubscription } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useDragFinishedSubscription.js'

test('拖拽订阅清理：取消自身监听并保留独立消费者，重复清理无副作用', () => {
  // 1、受控事件边界沿用预加载的按回调取消契约，执行真实业务模块。
  const events = new EventEmitter()
  const calls = []
  const api = {
    on(channel, handler) {
      events.on(channel, handler)
      return () => events.off(channel, handler)
    },
    removeAllListeners: channel => events.removeAllListeners(channel)
  }
  const independent = value => calls.push(['independent', value])
  const stopIndependent = api.on('drag-finished', independent)
  const subscription = useDragFinishedSubscription({ electronApi: () => api })
  for (let index = 0; index < 20; index++) {
    assert.equal(subscription.registerDragFinished(value => calls.push(['page', value])), true)
    events.emit('drag-finished', index)
    assert.deepEqual(calls.slice(-2), [['independent', index], ['page', index]])
    // 2、实际清理后只有独立消费者仍接收；重复清理保持幂等。
    subscription.cleanupDragFinished()
    subscription.cleanupDragFinished()
    assert.equal(events.listenerCount('drag-finished'), 1)
    events.emit('drag-finished', `after-${index}`)
    assert.deepEqual(calls.at(-1), ['independent', `after-${index}`])
  }
  stopIndependent()
  assert.equal(events.listenerCount('drag-finished'), 0)
})
