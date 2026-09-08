import test from 'node:test'
import assert from 'node:assert/strict'
import { useCanvasActivationReset } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasActivationReset.js'

function setup(mode) {
  const ticks = []
  const events = []
  const scrollMode = { value: mode }
  const canvasScale = { value: 2 }
  const userHasManuallyScrolled = { value: true }
  let render = () => events.push(['old-render'])
  const snapshot = (event) => [event, scrollMode.value, canvasScale.value, userHasManuallyScrolled.value]
  const { resetCanvasOnActivated } = useCanvasActivationReset({
    nextTick: (callback) => ticks.push(callback),
    scrollMode,
    canvasScale,
    userHasManuallyScrolled,
    updateCanvasDisplaySize: () => events.push(snapshot('resize')),
    renderAllLayers: () => render()
  })
  return {
    ticks, events, scrollMode, canvasScale, userHasManuallyScrolled, resetCanvasOnActivated,
    replaceRender: () => { render = () => events.push(snapshot('render')) }
  }
}

for (const [mode, temporary, restored] of [
  ['scale', 'region', 'scale'],
  ['region', 'scale', 'region'],
  ['unknown', 'scale', 'region']
]) {
  test(`画布激活：${mode} 保留两轮更新及恢复顺序`, () => {
    const state = setup(mode)
    state.resetCanvasOnActivated()
    assert.deepEqual(state.events, [])
    assert.equal(state.scrollMode.value, mode)
    assert.equal(state.ticks.length, 1)
    state.ticks.shift()()
    assert.deepEqual(state.events, [['resize', temporary, 1, false]])
    assert.equal(state.ticks.length, 1)
    // 模拟两轮更新之间用户操作以及页面渲染入口初始化。
    state.canvasScale.value = 3
    state.userHasManuallyScrolled.value = true
    state.replaceRender()
    state.ticks.shift()()
    assert.deepEqual(state.events, [
      ['resize', temporary, 1, false],
      ['resize', restored, 1, false],
      ['render', restored, 1, false]
    ])
    assert.equal(state.ticks.length, 0)
  })
}

test('画布激活：首轮更新才读取模式，每次激活独立恢复', () => {
  const state = setup('scale')
  state.replaceRender()
  state.resetCanvasOnActivated()
  state.scrollMode.value = 'region'
  state.ticks.shift()()
  state.ticks.shift()()
  assert.equal(state.scrollMode.value, 'region')
  state.scrollMode.value = 'scale'
  state.resetCanvasOnActivated()
  state.ticks.shift()()
  state.ticks.shift()()
  assert.equal(state.scrollMode.value, 'scale')
  assert.equal(state.events.filter(([event]) => event === 'resize').length, 4)
  assert.equal(state.events.filter(([event]) => event === 'render').length, 2)
})
