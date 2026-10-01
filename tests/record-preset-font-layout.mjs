/** 显式采集字体环境布局：只允许原始源码，旧画布参考继续逐像素核验，禁止覆盖目录。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, writeFile, chmod } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { repository } from './helpers/desktop.mjs'
import { referenceDirectory } from './helpers/reference.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'
import { captureOriginalPresetLayout } from './scenarios/presets.mjs'
import { assertPresetOriginalSource, assertPresetFont, assertPresetOldReferences, presetLayoutReferenceName, presetOriginalReferenceName, presetOriginalCommit, presetOriginalTree, presetOriginalLayoutHash, presetSha256 } from './helpers/preset-layout-reference.mjs'

// 1、原始完整源码和字体均固定，先重新构建，避免用候选产物采集。
assert.equal(process.argv.length, 2, '不接受改写来源或输出位置的参数')
assertPresetOriginalSource(repository)
const font = await assertPresetFont()
const oldReferenceFiles = await referenceDigest()
await assertPresetOldReferences(referenceDirectory, oldReferenceFiles)
execFileSync('npm', ['run', 'build'], { cwd: repository, stdio: 'inherit' })
let image, environment
try {
  // 2、只在原版场景到达 layout 时保存内存图；其余场景仍验证全部原参考。
  await captureOriginalPresetLayout(async (bytes, actualEnvironment, originalBytes) => {
    assert.equal(image, undefined, '只允许一次 layout 采样')
    assert.equal(presetSha256(originalBytes), presetOriginalLayoutHash)
    image = bytes
    environment = actualEnvironment
  })
  assert.ok(image && environment, '原始场景未完整产生布局')
  assertPresetOriginalSource(repository)
  assert.deepEqual(await referenceDigest(), oldReferenceFiles)
  // 3、全部场景通过后独占创建新目录，只有一张布局图和冻结清单。
  const directory = path.join(referenceDirectory, presetLayoutReferenceName)
  await mkdir(directory)
  const manifest = { version: 1, referenceName: presetLayoutReferenceName, sourceCommit: presetOriginalCommit, sourceTree: presetOriginalTree, originalReferenceName: presetOriginalReferenceName, originalLayoutSha256: presetOriginalLayoutHash, font, environment, file: 'layout.png', pngSha256: presetSha256(image), oldReferenceFiles }
  await writeFile(path.join(directory, 'layout.png'), image, { flag: 'wx' })
  const json = JSON.stringify(manifest, null, 2)
  await writeFile(path.join(directory, 'manifest.json'), json, { flag: 'wx' })
  for (const name of ['layout.png', 'manifest.json']) await chmod(path.join(directory, name), 0o444)
  console.log(JSON.stringify({ referenceName: presetLayoutReferenceName, manifestHash: presetSha256(json), pngHash: manifest.pngSha256 }))
} finally {
  // 4、无论结果如何，逐项核验全部旧文件不变。
  await assertPresetOldReferences(referenceDirectory, oldReferenceFiles)
}
