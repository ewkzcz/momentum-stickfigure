/** 字体布局参考边界：只允许已授权场景，拒绝缺失、篡改和环境不匹配。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import { mkdtemp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises'
import { referenceDirectory } from './helpers/reference.mjs'
import { loadPresetLayoutReference, presetLayoutBytes, presetLayoutReferenceName, presetOriginalReferenceName, assertPresetOriginalSource } from './helpers/preset-layout-reference.mjs'
import { repository } from './helpers/desktop.mjs'

test('字体布局参考：限定场景与只读摘要，拒绝未知环境及原图变更', async () => {
  // 1、非授权场景原样返回旧字节，不依赖新参考存在。
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-font-contract-'))
  const original = Buffer.from('原始未覆盖场景')
  assert.equal(await presetLayoutBytes(root, presetOriginalReferenceName, 'saved-preset', {}, original), original)
  assert.equal(await presetLayoutBytes(root, 'other-reference', 'layout', {}, original), original)
  await assert.rejects(loadPresetLayoutReference(root), { code: 'ENOENT' })
  assert.throws(() => assertPresetOriginalSource(repository), /./, '候选源码不能用于录制')

  // 2、实际冻结清单必须可读，运行环境或原始布局摘要变化直接失败。
  const manifest = await loadPresetLayoutReference(referenceDirectory)
  const oldLayout = await readFile(path.join(referenceDirectory, presetOriginalReferenceName, 'layout.png'))
  await assert.rejects(presetLayoutBytes(referenceDirectory, presetOriginalReferenceName, 'layout', { ...manifest.environment, runtime: {} }, oldLayout), /运行环境不符/)
  await assert.rejects(presetLayoutBytes(referenceDirectory, presetOriginalReferenceName, 'layout', manifest.environment, original), /旧 layout 哈希不符/)
  const expected = await readFile(path.join(referenceDirectory, presetLayoutReferenceName, 'layout.png'))
  assert.deepEqual(await presetLayoutBytes(referenceDirectory, presetOriginalReferenceName, 'layout', manifest.environment, oldLayout), expected)

  // 3、篡改字体指纹即使设置只读权限，也不能越过冻结清单摘要校验。
  const directory = path.join(root, presetLayoutReferenceName)
  await mkdir(directory)
  const file = path.join(directory, 'manifest.json')
  await writeFile(file, JSON.stringify({ ...manifest, font: { ...manifest.font, sha256: 'wrong' } }))
  await assert.rejects(loadPresetLayoutReference(root), /只读普通文件/)
  await chmod(file, 0o444)
  await assert.rejects(loadPresetLayoutReference(root), /哈希不符/)
})
