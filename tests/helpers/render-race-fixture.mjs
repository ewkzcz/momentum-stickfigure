/** 真实模块、原生画布与可控图片完成顺序；只替换浏览器/UI 边界。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mkdtemp } from 'node:fs/promises'
import { build } from 'vite'
import { ref, shallowRef } from 'vue'
import { createCanvas, loadImage } from '@napi-rs/canvas'

const root = fileURLToPath(new URL('../../', import.meta.url))
const directory = path.join(root, 'src/renderer/src/components/pages/ActionExpressionPage')
const output = await mkdtemp(path.join(root, 'temp/render-race-contract-'))
await build({
  configFile: false, logLevel: 'error', define: { 'import.meta.env': JSON.stringify({ MODE: 'production' }) },
  resolve: { alias: { '@renderer': path.join(root, 'src/renderer/src') } },
  plugins: [{ name: 'render-race-boundaries', enforce: 'pre',
    resolveId(id) {
      if (id === 'race-entry' || id === path.resolve('race-entry')) return '\0race-entry'
      if (id === 'naive-ui') return '\0race-ui'
      if (id.endsWith('/performanceLogger.js')) return '\0race-metrics'
    },
    load(id) {
      if (process.env.MOMENTUM_RACE_REVISION && id.startsWith(directory)) return execFileSync('git', ['show', `${process.env.MOMENTUM_RACE_REVISION}:${path.relative(root, id)}`], { cwd: root, encoding: 'utf8' })
      if (id === '\0race-entry') return ['useCanvasRender', 'useLayerTree', 'usePresetData', 'usePresetUI'].map(name => `export { ${name} } from ${JSON.stringify(path.join(directory, `composables/${name}.js`))}`).join('\n') + `\nexport * from ${JSON.stringify(path.join(directory, 'utils/layerRenderUtils.js'))}` + (process.env.MOMENTUM_RACE_REVISION ? '' : `\nexport * from ${JSON.stringify(path.join(directory, 'composables/useCanvasRenderCoordinator.js'))}`)
      if (id === '\0race-ui') return 'export const useMessage = () => new Proxy({}, {get: () => (...args) => globalThis.__raceMessages.push(args)}); export const useDialog = () => ({})'
      if (id === '\0race-metrics') return 'export const createPerformanceLogger = () => ({start: () => ({end() {}}), logEvent() {}})'
    }
  }],
  build: { ssr: 'race-entry', outDir: output, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'modules.mjs' } } }
})
export const modules = await import(pathToFileURL(path.join(output, 'modules.mjs')).href)
export const flush = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)) }
export function setup(t) {
  const images = [], messages = []
  for (const [key, value] of Object.entries({ __raceMessages: messages, document: { createElement: () => createCanvas(2, 1) }, Image: class {
    constructor() {
      const image = createCanvas(2, 1)
      image.onload = null
      image.onerror = null
      Object.defineProperty(image, 'src', { set(source) {
        image.decoded = loadImage(source).then(decoded => {
          image.width = decoded.width; image.height = decoded.height
          image.getContext('2d').drawImage(decoded, 0, 0)
        })
      } })
      image.release = async () => {
        await image.decoded
        await image.onload?.()
        await flush()
      }
      images.push(image)
      return image
    }
  } })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key)
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true })
    t.after(() => previous ? Object.defineProperty(globalThis, key, previous) : delete globalThis[key])
  }
  for (const name of ['log', 'warn', 'error']) t.mock.method(console, name, () => {})
  const canvasRef = shallowRef(createCanvas(2, 1)), isRendering = ref(false), currentPsdData = shallowRef({ layerHierarchy: [] })
  const partsState = { selectedParts: ref({}), userInteracted: ref({}), selectedPart: ref({ name: 'test', path: 'test' }) }
  for (const name of ['frontHandNormal', 'frontHandRight', 'frontHandBoth', 'backHand', 'frontLayerBackHand', 'bothHands', 'upperBody', 'lowerBody', 'action']) partsState[`${name}Parts`] = ref([])
  const dynamicState = {}
  for (const name of ['Expression', 'FrontHand', 'BackHand', 'BothHands', 'UpperBody', 'LowerBody', 'Action']) { dynamicState[`dynamic${name}Tabs`] = ref([]); dynamicState[`dynamic${name}Parts`] = ref({}) }
  const commonControls = Object.fromEntries(['Background', 'BaseLayer', 'SecondBaseLayer', 'Weapon', 'BackHair', 'Front', 'Side', 'Back', 'Rear', 'Shadow', 'ShakeHead', 'HoldSword', 'BackHandSword', 'DownwardSlash'].map(name => [`show${name}`, ref(true)]))
  const deps = { canvasRef, isRendering, currentPsdData, canvasStyle: ref({ width: '2px', height: '1px' }), scrollMode: ref(false), canvasScale: ref(1), canvasWidth: ref(2), canvasHeight: ref(1), partsState, dynamicState, commonControls }
  const tree = modules.useLayerTree({ ...deps, ...commonControls, selectedParts: partsState.selectedParts, message: { error: value => messages.push(value) }, ...Object.fromEntries(['drawLayerImage', 'applyLayerMask', 'findClippingGroup', 'renderClippingGroup'].map(name => [name, modules[name]])) })
  const preset = modules.usePresetData({ ...deps, currentPsdFile: ref(null), syncCanvasToPreview: async () => {} })
  const render = modules.useCanvasRender({ ...deps, selectedPresetId: preset.selectedPresetId, presets: preset.presets, renderPreset: preset.renderPreset, renderByLayerTree: tree.renderByLayerTree, updateSelectedLayersMap: tree.updateSelectedLayersMap })
  function select(color) {
    const image = createCanvas(2, 1), ctx = image.getContext('2d')
    ctx.fillStyle = color; ctx.fillRect(0, 0, 2, 1)
    const layer = { name: 'test', uniqueName: 'test', visible: true, opacity: 255, left: 0, top: 0, width: 2, height: 1, imageData: image.toDataURL() }
    currentPsdData.value = { layerHierarchy: [layer] }
    tree.layerTreeData.value = [{ ...layer, children: [] }]
    return { id: color, name: color, base64Image: layer.imageData }
  }
  function start(kind, color) {
    const item = select(color)
    if (kind === 'preset') { preset.selectedPresetId.value = item.id; return preset.renderPreset(item) }
    if (kind === 'tree') return tree.renderByLayerTree()
    return render.renderPart(partsState.selectedPart.value)
  }
  const pixel = () => Array.from(canvasRef.value.getContext('2d').getImageData(0, 0, 1, 1).data)
  return { deps, images, messages, tree, preset, render, start, select, pixel }
}
