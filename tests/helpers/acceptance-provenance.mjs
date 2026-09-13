/** 工作区回归溯源：显式构建清单，不替代历史基线的洁净检查。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

const configuration = ['package.json', 'package-lock.json', 'electron.vite.config.mjs', 'electron-builder.yml', 'eslint.config.mjs']
const digest = bytes => createHash('sha256').update(bytes).digest('hex')

/** 记录完整文件集合；新增、删除及修改均影响结果，不接受符号链接。 */
export async function inventory(repository, directories) {
  const files = {}
  async function visit(relative) {
    for (const entry of (await readdir(path.join(repository, relative), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = path.posix.join(relative, entry.name)
      if (entry.isDirectory()) await visit(child)
      else {
        assert.ok(entry.isFile(), `溯源目录不接受符号链接：${child}`)
        files[child] = digest(await readFile(path.join(repository, child)))
      }
    }
  }
  for (const directory of directories) await visit(directory)
  return files
}

export async function captureInputs(repository) {
  const files = await inventory(repository, ['src', 'tests', 'scripts'])
  for (const name of configuration) files[name] = digest(await readFile(path.join(repository, name)))
  return files
}

export function gitIdentity(repository) {
  const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trimEnd()
  return { head: git(['rev-parse', 'HEAD']), status: git(['status', '--porcelain=v1', '--untracked-files=all']) }
}

export function acceptanceMode(before, manifest) {
  assert.ok(!(before && manifest), '历史对照与工作区回归清单不能同时启用')
  return manifest ? 'regression' : before ? 'comparison' : 'baseline'
}

export function assertBaselineEvidence(evidence) {
  assert.equal(evidence.passed, true, '只接受完整通过的原版证据')
  // 旧 GeneratePage 证据未标 mode；旧对照结果通过 beforeResult 区分。
  assert.ok(evidence.mode === 'baseline' || (evidence.mode === undefined && !evidence.beforeResult), '回归或对照证据不能充当原版基线')
}

/** 只接受外部构建入口生成的完整清单，调用前后均逐文件复核。 */
export async function verifyManifest(repository, filename) {
  const bytes = await readFile(filename)
  const manifest = JSON.parse(bytes)
  assert.equal(manifest.schema, 1, '不支持的构建清单版本')
  assert.equal(manifest.mode, 'regression', '构建清单必须明确标记 regression')
  assert.equal(manifest.repository, path.resolve(repository), '构建清单属于其他工作区')
  assert.equal(manifest.build?.command, 'npm run build')
  assert.equal(manifest.build?.status, 0, '构建必须成功')
  assert.deepEqual(gitIdentity(repository), manifest.git, 'HEAD 或真实 Git 修改状态不匹配')
  assert.deepEqual(await captureInputs(repository), manifest.inputs, '源码、测试或配置与构建清单不匹配')
  assert.deepEqual(await inventory(repository, ['out']), manifest.outputs, '构建产物与清单不匹配')
  return { path: path.resolve(filename), sha256: digest(bytes), head: manifest.git.head }
}
