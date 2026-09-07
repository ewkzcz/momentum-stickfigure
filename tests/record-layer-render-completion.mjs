/** 显式录制经授权的有限修复参考：只能用 a33579b 原算法的公开串行重绘，绝不覆盖旧文件。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fixtures, referenceDirectory } from './helpers/reference.mjs'
import { launchDesktop, repository, readJson } from './helpers/desktop.mjs'
import { assertSamePixels, verifyFixture } from './helpers/images.mjs'
import { publicSerialRedraw } from './helpers/layer-render-public.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'
import { runPsdScenario } from './scenarios/psd.mjs'
import { prepareHairEnvironment, runHairScenario } from './scenarios/psd-session-hair.mjs'

const originalHead = 'a33579beab6ee821c76f025287916cf1a6064979'
const sourceFile = 'src/renderer/src/components/pages/ActionExpressionPage/composables/useLayerTree.js'
const referenceName = 'layer-render-completion-v1'
const affectedNames = ['group-10-toggle', 'group-10-restore']
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')
const input = path.resolve(process.argv[2] || '')
assert.ok(process.argv[2], '必须显式提供候选完整100场景与后发结果所在的隔离调查目录')
assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), originalHead)
assert.equal(execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src', 'electron.vite.config.mjs'], { cwd: repository, encoding: 'utf8' }).trim(), '', '录制要求原业务源码及未跟踪源码均干净')
const originalSource = await readFile(path.join(repository, sourceFile), 'utf8')
const oldCall = "      debugLog('🎨 [图层树] 调用 onRenderTrigger()')\n      onRenderTrigger()"
const fixedCall = "      debugLog('🎨 [图层树] 调用 onRenderTrigger()')\n      return onRenderTrigger() // 等待绘制完成后再反向同步，避免共享画布并发重绘。"
assert.equal(originalSource.split(oldCall).length, 2, '原算法源码不符，不能自动扩大例外')
const before = await readJson(path.join(input, 'original-reference-digest.json'))
assert.deepEqual(await referenceDigest(), before, '旧参考必须在录制前逐项未变')
const samples = await fixtures()
const impact = await readJson(path.join(input, 'impact.json'))
assert.equal(impact.scenes.length, 100)
assert.deepEqual(impact.affected.map(({ fixture, name }) => `${fixture}/${name}`), affectedNames.map((name) => `xing-kong/${name}`))
const outputs = []
const manifest = { version: 1, referenceName, originalHead, originalSourceTree: execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repository, encoding: 'utf8' }).trim(), sourceFile, originalSourceSha256: sha(originalSource), fixedSourceSha256: sha(originalSource.replace(oldCall, fixedCall)), node: process.version, authorization: '仅修复渲染Promise返回；旧参考永久只读，只有独立原算法串行对照核验的两个分组场景可覆盖；后发另建严格回归参考；其余场景零差异', oldReferenceFiles: before, oldReferenceDigestSha256: sha(JSON.stringify(before)), snapshots: [] }
try {
  // 1、重新构建已经校验为旧版的源码，禁止拿候选程序现场输出充当规范对照。
  execFileSync('npm', ['run', 'build'], { cwd: repository, stdio: 'inherit' })
  for (const fixture of samples) {
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    const expected = await readJson(path.join(referenceDirectory, fixture.id, 'manifest.json'))
    const candidate = impact.scenes.filter((scene) => scene.fixture === fixture.id)
    assert.equal(candidate.length, expected.snapshots.length)
    assert.equal(impact.fixtureHashes[fixture.id], fixture.sha256)
    assert.deepEqual(impact.runtime, expected.environment)
    for (const [index, scene] of candidate.entries()) {
      assert.deepEqual({ name: scene.name, state: scene.state }, expected.snapshots[index], '每项DOM与顺序仍须原参考一致')
      if (fixture.id === 'xing-kong' && affectedNames.includes(scene.name)) continue
      await assertSamePixels(await readFile(path.join(input, 'candidate', fixture.id, `${scene.name}.png`)), await readFile(path.join(referenceDirectory, fixture.id, `${scene.name}.png`)), `${fixture.id}/${scene.name} 未受影响必须零差异`)
    }
  }
  // 2、每个受影响场景各开一个旧版进程，完整重放原操作；避免前项对照污染后项。
  const fixture = samples.find((item) => item.id === 'xing-kong')
  assert.ok(fixture)
  for (const target of affectedNames) {
    const desktop = await launchDesktop()
    try {
      let found = false
      const runtime = await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome }))
      assert.deepEqual(runtime, impact.runtime)
      await runPsdScenario(desktop, fixture, async (name, image, state) => {
        if (name !== target) return
        found = true
        const oldPng = await readFile(path.join(referenceDirectory, fixture.id, `${name}.png`))
        await assertSamePixels(Buffer.from(image.png, 'base64'), oldPng, '旧程序原操作必须先复现旧参考')
        const canonical = await publicSerialRedraw(desktop.page)
        const candidatePng = await readFile(path.join(input, 'candidate', fixture.id, `${name}.png`))
        await assertSamePixels(canonical.image, candidatePng, '旧算法公开串行对照必须等于候选完整RGBA')
        const file = `${fixture.id}-${name}.png`
        outputs.push({ file, image: canonical.image })
        manifest.snapshots.push({ fixture: fixture.id, fixtureHash: fixture.sha256, name, runtime, originalReferenceSha256: sha(oldPng), pngSha256: sha(canonical.image), candidatePngSha256: sha(candidatePng), file, state, canonical: { operations: canonical.operations, domEqual: canonical.domEqual, state: canonical.state, source: '原版独立进程重放后公开串行重绘；不是修复版输出' } })
        console.log(`独立规范对照通过 ${fixture.id}/${name}`)
      })
      assert.ok(found)
    } finally { await desktop.close(); await verifyFixture(fixture.absolutePath, fixture.sha256) }
  }
  // 3、后发在任何PSD切换前采样原算法中性重绘，再与候选早期/六秒/首次返回逐一核验。
  const desktop = await launchDesktop(undefined, 'software-layout')
  try {
    const environment = await prepareHairEnvironment(desktop)
    const candidate = await readJson(path.join(input, 'candidate/hair/result.json'))
    assert.deepEqual(environment, candidate.environment)
    const result = await runHairScenario(desktop, samples, true)
    const canonical = result.canonical
    assert.deepEqual(canonical.state, candidate.states['edited-1'])
    for (const name of ['edited-1', 'edited-1-late', 'round-0-1', 'round-0-1-late']) await assertSamePixels(canonical.image, await readFile(path.join(input, 'candidate/hair', `${name}.png`)), `后发原算法规范对照/${name}`)
    assert.notEqual(sha(result.images['edited-1']), sha(canonical.image), '必须独立复现旧编辑画布被中性重绘纠正')
    await assertSamePixels(result.images['round-0-1'], canonical.image, '旧版切换返回也须符合独立重绘，而非以旧返回图充当依据')
    outputs.push({ file: 'xing-kong-hair-edited.png', image: canonical.image })
    manifest.hair = { fixtureHashes: Object.fromEntries(samples.map((item) => [item.id, item.sha256])), environment, state: canonical.state, file: 'xing-kong-hair-edited.png', pngSha256: sha(canonical.image), originalEditedPngSha256: sha(result.images['edited-1']), originalReturnedPngSha256: sha(result.images['round-0-1']), canonical: { operations: canonical.operations, domEqual: true, beforeAnyPsdSwitch: true, source: '原版原编辑操作后的公开串行重绘' }, observations: { original: result.observations, candidate: candidate.observations } }
    console.log('独立规范对照通过 后发编辑/六秒/首次返回/返回六秒')
  } finally { await desktop.close() }
  for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  assert.deepEqual(await referenceDigest(), before)
  // 4、全部依据已独立验证后独占创建新目录；只写canonical字节，绝不复制候选图片。
  const directory = path.join(referenceDirectory, referenceName)
  await mkdir(directory)
  for (const { file, image } of outputs) {
    await writeFile(path.join(directory, file), image, { flag: 'wx' })
    await chmod(path.join(directory, file), 0o444)
  }
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' })
  await chmod(path.join(directory, 'manifest.json'), 0o444)
  console.log(JSON.stringify({ referenceName, manifestSha256: sha(await readFile(path.join(directory, 'manifest.json'))), snapshots: manifest.snapshots.map(({ fixture, fixtureHash, name, runtime, originalReferenceSha256, pngSha256, file }) => ({ fixture, fixtureHash, name, runtime, originalReferenceSha256, pngSha256, file })), hair: { pngSha256: manifest.hair.pngSha256, originalEditedPngSha256: manifest.hair.originalEditedPngSha256 }, fixedSourceSha256: manifest.fixedSourceSha256, oldReferenceDigestSha256: manifest.oldReferenceDigestSha256, oldReferenceCount: Object.keys(before).length }, null, 2))
} finally {
  const after = await referenceDigest()
  for (const [name, hash] of Object.entries(before)) assert.equal(after[name], hash, `旧参考不可改写：${name}`)
}
