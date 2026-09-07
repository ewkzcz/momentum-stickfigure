/** 已独立核验的有限参考覆盖；只有两个确切场景可读取新目录，其余保持原参考零容差。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, lstat } from 'node:fs/promises'
import path from 'node:path'

export const completionReferenceName = 'layer-render-completion-v1'
export const completionManifestHash = 'd23db7d6b03c64e5ad838c368e885b8a9e33aeacad7fc386f315c5523f9354ad'
export const originalReferencesHash = '0149579e558783473c00392ce0d69b9e736f40ac0e2f711fd3e645a296c26fde'
const fixtureHash = 'a1cd270115d88bbf715ce1786f87e6d8a36bb6790db168542ae2ccb732300435'
const runtime = { platform: 'darwin', arch: 'arm64', electron: '35.7.5', chrome: '134.0.6998.205' }
export const completionOverrides = [
  { fixture: 'xing-kong', fixtureHash, name: 'group-10-toggle', runtime, originalReferenceSha256: '19ba3cf72c4af75c4d34fdd26c5da977bed98a96de5e52d5eca4b4bf43464838', pngSha256: '5cc35dc565487d5e59e70614ea91d3777b8dd8cf0b29746004d7727cc7737e8e', file: 'xing-kong-group-10-toggle.png' },
  { fixture: 'xing-kong', fixtureHash, name: 'group-10-restore', runtime, originalReferenceSha256: '3591aa50395d2086856e5b4cc19f8b18a9ae9860a13ebc9d0dbcdf7b7b4ab644', pngSha256: 'fe8c9cc63be0aa09ea0b9ca6ef84fba18f8da702b54c630f484471379d32c09f', file: 'xing-kong-group-10-restore.png' }
]
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

/** 参考须为已有只读普通文件；缺失、链接、权限或摘要变化都立即失败。 */
async function readonlyBytes(file, hash) {
  const stat = await lstat(file)
  assert.ok(stat.isFile() && (stat.mode & 0o222) === 0, '新参考必须是只读普通文件')
  const bytes = await readFile(file)
  assert.equal(sha256(bytes), hash, '独立参考摘要不符，禁止自动更新或回退')
  return bytes
}

/** 固定清单摘要防止扩大两个覆盖项或改写规范对照来源。 */
export async function loadCompletionReference(root) {
  const manifest = JSON.parse(await readonlyBytes(path.join(root, completionReferenceName, 'manifest.json'), completionManifestHash))
  assert.equal(manifest.oldReferenceDigestSha256, originalReferencesHash)
  assert.equal(sha256(JSON.stringify(manifest.oldReferenceFiles)), originalReferencesHash)
  assert.deepEqual(manifest.snapshots.map((scene) => Object.fromEntries(Object.keys(completionOverrides[0]).map((key) => [key, scene[key]]))), completionOverrides)
  return manifest
}

/** 未授权场景直接用原图；命中名称后任何约束失败均报错，绝不宽泛fallback。 */
export async function completionPsdBytes(root, fixture, scene, environment, originalBytes) {
  const override = completionOverrides.find((item) => item.fixture === fixture.id && item.name === scene.name)
  if (!override) return originalBytes
  assert.equal(fixture.sha256, override.fixtureHash, '覆盖清单素材哈希不符')
  assert.deepEqual(environment, override.runtime, '覆盖清单运行环境不符')
  assert.equal(sha256(originalBytes), override.originalReferenceSha256, '覆盖清单原参考哈希不符')
  const manifest = await loadCompletionReference(root)
  assert.deepEqual(scene.state, manifest.snapshots.find((item) => item.name === scene.name).state, '覆盖仍要求原DOM状态一致')
  return readonlyBytes(path.join(root, completionReferenceName, override.file), override.pngSha256)
}

/** 后发只读规范图来源于原算法在切换前的公开中性重绘，而非两幅候选图相等。 */
export async function completionHairBytes(root, samples, environment) {
  const manifest = await loadCompletionReference(root)
  assert.deepEqual(Object.fromEntries(samples.map((item) => [item.id, item.sha256])), manifest.hair.fixtureHashes)
  assert.deepEqual(environment, manifest.hair.environment)
  return { image: await readonlyBytes(path.join(root, completionReferenceName, manifest.hair.file), manifest.hair.pngSha256), state: manifest.hair.state }
}

/** 按冻结清单逐项保护全部旧参考，允许存在新的独立目录但绝不允许旧文件变动。 */
export async function assertOriginalReferences(root) {
  const manifest = await loadCompletionReference(root)
  for (const [file, hash] of Object.entries(manifest.oldReferenceFiles)) assert.equal(sha256(await readFile(path.join(root, file))), hash, `旧参考发生变化：${file}`)
  return { files: Object.keys(manifest.oldReferenceFiles).length, sha256: originalReferencesHash }
}
