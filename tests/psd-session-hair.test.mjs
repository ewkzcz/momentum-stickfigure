/** 后发会话严格验收：编辑/首次返回/六秒多帧均须独立原算法canonical零差异。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { fixtures, referenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, verifyFixture } from './helpers/images.mjs'
import { assertOriginalReferences, completionHairBytes } from './helpers/layer-render-reference.mjs'
import { prepareHairEnvironment, runHairScenario } from './scenarios/psd-session-hair.mjs'

test('PSD 后发严格会话：原编辑、首次返回、六秒观察及独立规范图一致', { timeout: 120000 }, async () => {
  const samples = await fixtures()
  for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
  const before = await assertOriginalReferences(referenceDirectory)
  const desktop = await launchDesktop(undefined, 'software-layout')
  console.log(`后发严格回归证据：${desktop.root}`)
  try {
    const environment = await prepareHairEnvironment(desktop)
    const expected = await completionHairBytes(referenceDirectory, samples, environment)
    const result = await runHairScenario(desktop, samples)
    await writeFile(path.join(desktop.root, 'hair-strict-result.json'), JSON.stringify({ environment, observations: result.observations, states: result.states }, null, 2))
    assert.deepEqual(result.states['round-0-1'], result.states['edited-1'], '公开DOM完整恢复')
    await assertSamePixels(result.images['round-0-1'], result.images['edited-1'], '首次返回星空应恢复原编辑画布')
    await assertSamePixels(result.images['round-0-1-late'], result.images['edited-1-late'], '持续六秒后星空仍应恢复原编辑画布')
    for (const name of ['edited-1', 'round-0-1']) assert.deepEqual(result.states[name], expected.state, `${name}：与独立规范对照DOM一致`)
    for (const name of ['edited-1', 'edited-1-late', 'round-0-1', 'round-0-1-late']) await assertSamePixels(result.images[name], expected.image, `${name}：与原算法公开串行重绘规范图一致`)
    console.log(`后发严格断言通过：完整DOM恢复、早期/六秒恢复、2项规范DOM、4项规范RGBA；观察 ${JSON.stringify(result.observations)}`)
  } finally {
    await desktop.close()
    for (const fixture of samples) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await assertOriginalReferences(referenceDirectory), before)
  }
})
