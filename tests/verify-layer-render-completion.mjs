/** 显式验收入口：每轮命令前后逐项核验旧参考和新目录，命令失败绝不转为成功。 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { repository } from './helpers/desktop.mjs'
import { referenceDirectory } from './helpers/reference.mjs'
import { assertOriginalReferences, sha256 } from './helpers/layer-render-reference.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

const mode = process.argv[2] || 'references'
assert.ok(['all', 'targeted', 'references'].includes(mode), '仅支持 all、targeted 或 references；没有录制模式')
const before = await assertOriginalReferences(referenceDirectory)
const allBefore = await referenceDigest()
const started = Date.now()
let status = 0, output = ''
try {
  const command = mode === 'all' ? ['npm', ['test']] : [process.execPath, ['--test', '--test-concurrency=1', 'tests/layer-render-completion.test.mjs', 'tests/psd-session-hair.test.mjs']]
  if (mode !== 'references') {
    try { output = execFileSync(command[0], command[1], { cwd: repository, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) }
    catch (error) { status = error.status || 1; output = `${error.stdout || ''}\n${error.stderr || ''}` }
    console.log(output)
  }
} finally {
  assert.deepEqual(await assertOriginalReferences(referenceDirectory), before)
  assert.deepEqual(await referenceDigest(), allBefore, '本轮新旧参考任何文件都不得变化')
}
await mkdir(path.join(repository, 'temp'), { recursive: true })
const directory = await mkdtemp(path.join(repository, 'temp/layer-render-acceptance-'))
const summary = { mode, status, durationMs: Date.now() - started, originalReferences: before, totalReferenceFiles: Object.keys(allBefore).length, allReferenceDigestSha256: sha256(JSON.stringify(allBefore)), sourceSha256: sha256(await readFile(path.join(repository, 'src/renderer/src/components/pages/ActionExpressionPage/composables/useLayerTree.js'))), head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(), testSummary: output.split('\n').filter((line) => /^(?:ℹ|#) (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line)) }
await writeFile(path.join(directory, 'result.json'), JSON.stringify(summary, null, 2), { flag: 'wx' })
await writeFile(path.join(directory, 'test.log'), output, { flag: 'wx' })
console.log(JSON.stringify({ evidenceId: path.basename(directory), ...summary }, null, 2))
process.exitCode = status
