/** 通过真实渲染模块与原生 Canvas 验证部件收尾和剪切组参数；仅替代消息、计时日志边界。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { execFileSync } from 'node:child_process'
import { build } from 'vite'
import { ref, shallowRef } from 'vue'
import { createCanvas, Image } from '@napi-rs/canvas'

const repository = fileURLToPath(new URL('../', import.meta.url))
const output = await mkdtemp(path.join(repository, 'temp/render-part-contract-'))
const renderSource = path.join(repository, 'src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasRender.js')
// 显式诊断选项读取 Git 原文，既不改源码也不通过字符串替换制造旧实现。
const originalRevision = process.env.MOMENTUM_RENDER_CONTRACT_REVISION
await build({
  configFile: false, logLevel: 'error', mode: 'production',
  define: { 'import.meta.env': JSON.stringify({ MODE: 'production' }) },
  resolve: { alias: { '@renderer': path.join(repository, 'src/renderer/src') } },
  ssr: { noExternal: ['naive-ui'] },
  plugins: [{
    name: 'render-observation-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id === 'naive-ui') return '\0render-message'
      if (id.endsWith('/performanceLogger.js')) return '\0render-metrics'
    },
    load(id) {
      if (id === renderSource && originalRevision) return execFileSync('git', ['show', `${originalRevision}:src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasRender.js`], { cwd: repository, encoding: 'utf8' })
      if (id === '\0render-message') return `export const useMessage = () => ({ warning: text => globalThis.__momentumRenderTest.messages.push(text), error: text => globalThis.__momentumRenderTest.messages.push(text), success: text => globalThis.__momentumRenderTest.messages.push(text) })`
      if (id === '\0render-metrics') return `export const createPerformanceLogger = () => ({ start: () => ({ end: meta => globalThis.__momentumRenderTest.metrics.push(meta) }) })`
    }
  }],
  build: { ssr: path.join(repository, 'src/renderer/src/components/pages/ActionExpressionPage/composables/useCanvasRender.js'), outDir: output, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'render.mjs' } } }
})
const { useCanvasRender } = await import(pathToFileURL(path.join(output, 'render.mjs')).href)

/** 每次用例拥有独立消息、画布和状态，结束后恢复全局环境。 */
function setup(t) {
  for (const key of ['document', 'Image', '__momentumRenderTest']) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  const observation = { messages: [], metrics: [], canvases: [], logs: [] }
  for (const method of ['log', 'warn', 'error']) {
    t.mock.method(console, method, (...args) => { observation.logs.push(args) })
  }
  globalThis.__momentumRenderTest = observation
  // 原生 Image 回调要求返回 undefined；浏览器允许 async onload，适配边界不改绘制算法。
  globalThis.Image = class extends Image {
    set onload(callback) { super.onload = () => { void callback() } }
    set onerror(callback) { super.onerror = error => { void callback(error) } }
  }
  globalThis.document = { createElement(name) {
    assert.equal(name, 'canvas')
    const canvas = createCanvas(8, 2)
    observation.canvases.push(canvas)
    return canvas
  } }
  const partsState = { selectedParts: ref({}), userInteracted: ref({}), selectedPart: ref({ name: '测试', path: '动作' }) }
  for (const key of ['frontHandNormal', 'frontHandRight', 'frontHandBoth', 'backHand', 'frontLayerBackHand', 'bothHands', 'upperBody', 'lowerBody', 'action']) partsState[`${key}Parts`] = ref([])
  const dynamicState = {}
  for (const key of ['Expression', 'FrontHand', 'BackHand', 'BothHands', 'UpperBody', 'LowerBody', 'Action']) {
    dynamicState[`dynamic${key}Tabs`] = ref([])
    dynamicState[`dynamic${key}Parts`] = ref({})
  }
  const commonControls = Object.fromEntries(['Background', 'BaseLayer', 'SecondBaseLayer', 'Weapon', 'BackHair', 'Front', 'Side', 'Back', 'Rear', 'Shadow', 'ShakeHead', 'HoldSword', 'BackHandSword', 'DownwardSlash'].map(key => [`show${key}`, ref(true)]))
  const deps = { canvasRef: shallowRef(createCanvas(8, 2)), canvasStyle: ref({ width: '8px', height: '2px' }), scrollMode: ref(false), canvasScale: ref(1), currentPsdData: ref({ layerHierarchy: [] }), partsState, dynamicState, commonControls }
  return { deps, observation, render: useCanvasRender(deps) }
}

/** 构建真实 PNG 输入，位置不同便于逐像素辨认每个控制位。 */
function layer(name, left) {
  const canvas = createCanvas(1, 1)
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 1, 1)
  return { name, left, top: 0, width: 1, height: 1, imageData: canvas.toDataURL(), visible: true }
}

for (const failure of ['正常', '主上下文', '离屏上下文', '分组映射']) {
  test(`部件渲染收尾：${failure}保持原错误并释放状态`, async t => {
    const { deps, observation, render } = setup(t)
    if (failure === '主上下文') deps.canvasRef.value = { width: 8, height: 2, getContext: () => null }
    if (failure === '离屏上下文') globalThis.document.createElement = () => ({ getContext: () => null })
    if (failure === '分组映射') Object.defineProperty(deps.partsState.frontHandNormalParts, 'value', { get() { throw new Error('映射原始错误') } })
    await assert.doesNotReject(render.renderPart(deps.partsState.selectedPart.value))
    assert.equal(render.isRendering.value, false)
    assert.equal(observation.metrics.length, 1)
    assert.equal(observation.metrics[0].groupsConsidered, 0)
    assert.equal(observation.metrics[0].selectedGroups, 0)
    if (failure === '正常') assert.deepEqual(observation.messages, [])
    else {
      assert.equal(observation.messages.length, 1)
      assert.match(observation.messages[0], failure === '分组映射' ? /映射原始错误/ : /上下文/)
    }
  })
}

test('部件渲染统计容器按调用隔离', async t => {
  const { deps, observation, render } = setup(t)
  deps.partsState.actionParts.value = [{ path: '动作', hidden: false }]
  const first = render.renderPart(deps.partsState.selectedPart.value)
  deps.partsState.actionParts.value = []
  const second = render.renderPart(deps.partsState.selectedPart.value)
  await Promise.all([first, second])
  assert.deepEqual(observation.metrics.map(item => [item.groupsConsidered, item.selectedGroups]), [[1, 1], [0, 0]])
})

for (const disabled of [null, 'Rear', 'Shadow', 'ShakeHead', 'HoldSword', 'BackHandSword', 'DownwardSlash']) {
  test(`受控剪切组：${disabled || '全部显示'}在内容和蒙版递归保持独立`, async t => {
    const { deps, observation, render } = setup(t)
    const names = ['普通', '后面', '阴影', '摇摇头', '持剑', '后手持剑', '下压挥剑']
    const controls = [null, 'Rear', 'Shadow', 'ShakeHead', 'HoldSword', 'BackHandSword', 'DownwardSlash']
    // 公开 renderPart 路径验证受控组的方向过滤；独立组接口验证非受控子层的后续控制位。
    deps.partsState.actionParts.value = [{ path: '动作', hidden: false }]
    deps.currentPsdData.value.layerHierarchy = [
      { name: '动作', visible: true, children: names.map(layer) },
      { name: '剪切调整', clipping: true, adjustment: {}, type: 'adjustment', visible: true }
    ]
    if (disabled) deps.commonControls[`show${disabled}`].value = false
    if (!disabled || disabled === 'Rear') {
      await assert.doesNotReject(render.renderPart(deps.partsState.selectedPart.value))
      assert.equal(observation.canvases.length, 3, '离屏、组内容、组蒙版均应真实生成')
    } else {
      const controls = ['Background', 'BaseLayer', 'SecondBaseLayer', 'Weapon', 'BackHair', 'Front', 'Side', 'Back', 'Rear', 'Shadow', 'ShakeHead', 'HoldSword', 'BackHandSword', 'DownwardSlash']
      await render.renderGroupWithClippingAdjustments(
        deps.canvasRef.value.getContext('2d'), deps.currentPsdData.value.layerHierarchy[0], [], 8, 2,
        new Set(), new Map(), deps.canvasRef.value,
        ...controls.map(key => deps.commonControls[`show${key}`].value), ''
      )
      assert.equal(observation.canvases.length, 2, '组内容和组蒙版均应真实生成')
    }
    assert.deepEqual(observation.messages, [], '内部捕获错误也必须导致测试失败')
    for (const canvas of [deps.canvasRef.value, ...observation.canvases]) {
      const pixels = canvas.getContext('2d').getImageData(0, 0, 8, 1).data
      for (let index = 0; index < names.length; index++) {
        const alpha = disabled && controls[index] === disabled ? 0 : 255
        assert.equal(pixels[index * 4 + 3], alpha, `${names[index]} 的 alpha`)
      }
    }
  })
}
