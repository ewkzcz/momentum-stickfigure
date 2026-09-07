/** 直接调用公开composable接口，以可控Promise验证绘制完成和拒绝传播，不替换业务函数。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { build } from 'vite'
import { mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { ref } from 'vue'
import { repository } from './helpers/desktop.mjs'
import { referenceDirectory } from './helpers/reference.mjs'
import { completionOverrides, completionPsdBytes, loadCompletionReference } from './helpers/layer-render-reference.mjs'

test('PSD 图层可见性：返回原渲染Promise并传播完成/拒绝', async () => {
  // 1、用生产构建器处理别名与import.meta；不复制或字符串重写待测接口。
  await mkdir(path.join(repository, 'temp'), { recursive: true })
  const output = await mkdtemp(path.join(repository, 'temp/layer-render-contract-'))
  await build({ configFile: false, logLevel: 'error', resolve: { alias: { '@renderer': path.join(repository, 'src/renderer/src') } }, build: { ssr: path.join(repository, 'src/renderer/src/components/pages/ActionExpressionPage/composables/useLayerTree.js'), outDir: output, emptyOutDir: false, rollupOptions: { output: { entryFileNames: 'layer-tree.mjs' } } } })
  const { useLayerTree } = await import(pathToFileURL(path.join(output, 'layer-tree.mjs')).href)
  for (const type of ['group', 'layer']) {
    for (const reject of [false, true]) {
      let resolveRender, rejectRender, calls = 0
      const rendering = new Promise((resolve, fail) => { resolveRender = resolve; rejectRender = fail })
      // 先注册拒绝处理，即使旧函数丢失Promise也不制造无关的未处理拒绝。
      rendering.catch(() => {})
      const psd = ref({ layerHierarchy: [{ name: '后发', type, visible: true, children: [] }] })
      const tree = useLayerTree({ currentPsdData: psd, showFront: ref(true), onRenderTrigger: () => { calls++; return rendering } })
      tree.layerTreeData.value = tree.buildLayerTree(psd.value)
      const returned = tree.handleLayerVisibilityChange({ layerPath: '后发', visible: false })
      assert.equal(returned, rendering, `${type}必须返回注入回调的原Promise`)
      assert.equal(calls, 1)
      assert.equal(psd.value.layerHierarchy[0].visible, false)
      let finished = false
      returned.then(() => { finished = true }, () => { finished = true })
      await Promise.resolve()
      assert.equal(finished, false, '绘制未完成时调用者必须继续等待')
      if (reject) {
        const error = new Error('可控绘制拒绝')
        rejectRender(error)
        await assert.rejects(returned, (actual) => actual === error)
      } else {
        resolveRender('绘制完成')
        assert.equal(await returned, '绘制完成')
      }
      assert.equal(finished, true)
    }
  }
})

test('PSD 修复参考：显式覆盖之外保持原图，缺失或约束不符直接失败', async () => {
  const manifest = await loadCompletionReference(referenceDirectory)
  const untouched = Buffer.from('未受影响的原参考')
  assert.equal(await completionPsdBytes(referenceDirectory, { id: 'xing-kong' }, { name: 'export' }, {}, untouched), untouched)
  assert.equal(await completionPsdBytes(referenceDirectory, { id: 'other' }, { name: 'group-10-toggle' }, {}, untouched), untouched)
  for (const entry of completionOverrides) {
    const fixture = { id: entry.fixture, sha256: entry.fixtureHash }
    const scene = manifest.snapshots.find((item) => item.name === entry.name)
    const original = await readFile(path.join(referenceDirectory, entry.fixture, `${entry.name}.png`))
    const missing = await mkdtemp(path.join(repository, 'temp/missing-layer-render-reference-'))
    await assert.rejects(completionPsdBytes(missing, fixture, scene, entry.runtime, original), { code: 'ENOENT' })
    await assert.rejects(completionPsdBytes(referenceDirectory, { ...fixture, sha256: 'wrong' }, scene, entry.runtime, original), /素材哈希不符/)
    await assert.rejects(completionPsdBytes(referenceDirectory, fixture, scene, { ...entry.runtime, chrome: 'wrong' }, original), /运行环境不符/)
    await assert.rejects(completionPsdBytes(referenceDirectory, fixture, scene, entry.runtime, untouched), /原参考哈希不符/)
    await assert.rejects(completionPsdBytes(referenceDirectory, fixture, { ...scene, state: {} }, entry.runtime, original), /原DOM状态一致/)
    assert.ok((await completionPsdBytes(referenceDirectory, fixture, scene, entry.runtime, original)).length > 0)
  }
})
