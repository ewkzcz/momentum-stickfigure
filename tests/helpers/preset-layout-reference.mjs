/** 预设页面字体参考：只覆盖 layout，固定原源码、字体、环境及全部旧参考摘要。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFile, lstat } from 'node:fs/promises'
import path from 'node:path'

export const presetLayoutReferenceName = 'preset-layout-font-20260910-v1'
export const presetOriginalReferenceName = 'preset-lifecycle-renderer1024-dpr1-focus-v1'
export const presetOriginalCommit = '6c4ec36d965734bfd38bb68df3402fe76e33509e'
export const presetOriginalTree = 'faa23cba22aef42c043958fc60f04f6bfc05a591'
export const presetOriginalLayoutHash = '794207f53f1840b83dafa4a3cc49d62810583a696295ea62c57163f651e48aa0'
export const presetFontFingerprint = { file: 'System/Library/PrivateFrameworks/FontServices.framework/Resources/Reserved/PingFangUI.ttc', sha256: '13b201d63324db59de86956c11c46d1f0ad9ac0aeaa0b9d035c012a794062db7' }
export const presetOldReferencesHash = 'e9b7c90d947bca9a4540819de20127f5993809c55ca22503c7aa5b2192145a2e'
export const presetLayoutManifestHash = 'be54fac2e15f2326df99f06fb21c89ceec2abe9d321c2f9807dfd9faa116a9e3'
export const presetSha256 = bytes => createHash('sha256').update(bytes).digest('hex')

/** 仅接受固定的原采集完整源码；候选分支、脏源码和新增源码均不能录制。 */
export function assertPresetOriginalSource(repository) {
  // 1、绑定提交与 src 树，检查工作区和索引，不使用候选产物建立参考。
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()
  git(['diff', '--exit-code', presetOriginalCommit, '--', 'src', 'electron.vite.config.mjs'])
  assert.equal(git(['rev-parse', `${presetOriginalCommit}:src`]), presetOriginalTree, '采集 src 树不符')
  assert.equal(git(['ls-files', '--others', '--exclude-standard', '--', 'src']), '', '采集源码不能包含未跟踪文件')
}

/** 拒绝可写文件和符号链接，不自动修复、生成或选择其他参考。 */
async function readonlyBytes(file, hash) {
  // 1、摘要约束的是原始文件字节；像素比较仍由原有 RGBA 断言执行。
  const stat = await lstat(file)
  assert.ok(stat.isFile() && (stat.mode & 0o222) === 0, '字体参考必须是只读普通文件')
  const bytes = await readFile(file)
  assert.equal(presetSha256(bytes), hash, '字体参考哈希不符，禁止回退或重录')
  return bytes
}

/** 核对已知系统字体内容，元数据只保存脱敏系统相对路径。 */
export async function assertPresetFont() {
  // 1、读取固定系统文件；未知平台或字体立即失败，不接受环境变量改写指纹。
  assert.equal(process.platform, 'darwin', '未知字体参考平台')
  assert.equal(process.arch, 'arm64', '未知字体参考架构')
  assert.equal(presetSha256(await readFile(path.join('/', presetFontFingerprint.file))), presetFontFingerprint.sha256, '未知系统字体指纹')
  return presetFontFingerprint
}

/** 固定全部 264 项旧参考，包含既有 260 项保护及此前追加的四个参考文件。 */
export async function assertPresetOldReferences(root, files) {
  // 1、逐项验证旧字节，新增独立目录不能削弱旧参考保护。
  assert.equal(Object.keys(files).length, 264, '旧参考清单必须完整保留 264 项')
  assert.equal(presetSha256(JSON.stringify(files)), presetOldReferencesHash, '旧参考清单哈希不符')
  for (const [file, hash] of Object.entries(files)) {
    assert.ok(!path.isAbsolute(file) && !file.split('/').includes('..'), '旧参考路径必须是安全相对路径')
    assert.equal(presetSha256(await readFile(path.join(root, file))), hash, `旧参考发生变化：${file}`)
  }
  return files
}

/** 正常测试只加载冻结清单，任何缺失或未知指纹均不能自动录制。 */
export async function loadPresetLayoutReference(root) {
  // 1、清单摘要同时固定原图、新图、字体和运行环境，防止扩大覆盖范围。
  const manifest = JSON.parse(await readonlyBytes(path.join(root, presetLayoutReferenceName, 'manifest.json'), presetLayoutManifestHash))
  assert.equal(manifest.version, 1)
  assert.equal(manifest.referenceName, presetLayoutReferenceName)
  assert.equal(manifest.sourceCommit, presetOriginalCommit)
  assert.equal(manifest.sourceTree, presetOriginalTree)
  assert.equal(manifest.originalReferenceName, presetOriginalReferenceName)
  assert.equal(manifest.originalLayoutSha256, presetOriginalLayoutHash)
  assert.deepEqual(manifest.font, presetFontFingerprint, '未知字体清单')
  assert.equal(manifest.file, 'layout.png', '只授权 layout 参考')
  await assertPresetFont()
  await assertPresetOldReferences(root, manifest.oldReferenceFiles)
  return manifest
}

/** 仅预设生命周期的 layout 可选择新图；其他场景直接返回原字节。 */
export async function presetLayoutBytes(root, referenceName, name, environment, originalBytes) {
  // 1、未授权的场景不加载新清单、不替换图片，也不放宽原有像素断言。
  if (referenceName !== presetOriginalReferenceName || name !== 'layout') return originalBytes
  const manifest = await loadPresetLayoutReference(root)
  assert.deepEqual(environment, manifest.environment, '字体参考运行环境不符')
  assert.equal(presetSha256(originalBytes), presetOriginalLayoutHash, '旧 layout 哈希不符')
  return readonlyBytes(path.join(root, presetLayoutReferenceName, 'layout.png'), manifest.pngSha256)
}
