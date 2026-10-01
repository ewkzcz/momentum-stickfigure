/** 串行验收入口：工作区清单、生产构建绑定和只读参考；支持 all / targeted。 */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureInputs, gitIdentity, inventory, verifyManifest } from '../tests/helpers/acceptance-provenance.mjs'

const repository = path.resolve(fileURLToPath(new URL('../', import.meta.url)))
const mode = process.argv[2] || 'all'
assert.ok(['targeted', 'all'].includes(mode), '仅支持 all 或 targeted')
assert.ok(!process.env.MOMENTUM_ACTION_LIFECYCLE_BEFORE && !process.env.MOMENTUM_GENERATE_WORKFLOW_BEFORE && !process.env.MOMENTUM_ACCEPTANCE_MANIFEST, '验收入口不得继承历史对照或外部清单')
await mkdir(path.join(repository, 'temp'), { recursive: true })
const root = await mkdtemp(path.join(repository, 'temp/remaining-defects-acceptance-'))
const result = { mode, git: gitIdentity(repository), startedAt: new Date().toISOString(), passed: false, commands: [], inputs: await captureInputs(repository), runnerSha256: createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex') }
await writeFile(path.join(root, 'started.json'), JSON.stringify(result, null, 2))
console.log(`验收目录：${root}`)

async function checked(label, command, args, extraEnvironment = {}) {
  const started = Date.now()
  const child = spawnSync(command, args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ...extraEnvironment } })
  const output = `${child.stdout || ''}\n${child.stderr || ''}`
  result.commands.push({ label, command: [command, ...args], status: child.status, signal: child.signal, durationMs: Date.now() - started })
  await writeFile(path.join(root, `${label}.log`), output)
  if (label === 'all' || label === 'targeted') {
    console.log(output)
    result.testSummary = output.split('\n').filter(line => /^(?:ℹ|#) (?:tests|suites|pass|fail|cancelled|skipped|todo|duration_ms)\b/.test(line))
  }
  assert.equal(child.status, 0, `${label} 失败：${child.error || output.slice(-2000)}`)
  console.log(`${label} 通过`)
}

let manifestPath
let referencesCaptured = false
try {
  for (const [label, command, args] of [
    ['source-lint', 'npx', ['eslint', 'src']], ['lint', 'npm', ['run', 'lint']],
    ['size', 'npm', ['run', 'check:size']], ['whitespace', 'git', ['diff', '--check']],
    ['staged-whitespace', 'git', ['diff', '--cached', '--check']],
    ['references-before', process.execPath, ['tests/verify-layer-render-completion.mjs', 'references']],
    ['build', 'npm', ['run', 'build']]
  ]) {
    await checked(label, command, args)
    if (label === 'references-before') referencesCaptured = true
  }
  assert.deepEqual(await captureInputs(repository), result.inputs, '构建期间输入发生变化')
  assert.deepEqual(gitIdentity(repository), result.git, '构建期间 Git 状态发生变化')
  result.outputs = await inventory(repository, ['out'])
  manifestPath = path.join(root, 'manifest.json')
  const manifest = { schema: 1, mode: 'regression', repository, git: result.git, inputs: result.inputs, outputs: result.outputs, build: { command: 'npm run build', status: 0 }, createdAt: new Date().toISOString() }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), { flag: 'wx' })
  result.manifest = await verifyManifest(repository, manifestPath)
  await writeFile(path.join(root, 'built.json'), JSON.stringify(result, null, 2))
  const environment = { MOMENTUM_ACCEPTANCE_MANIFEST: manifestPath }
  if (mode === 'all') await checked('all', process.execPath, ['tests/verify-layer-render-completion.mjs', 'all'], environment)
  else await checked('targeted', process.execPath, ['--test', '--test-concurrency=1', 'tests/acceptance-provenance.test.mjs', 'tests/action-page-lifecycle.test.mjs', 'tests/generate-workflow.test.mjs'], environment)
  result.passed = true
} catch (error) {
  result.error = error.stack
  console.error(error.message)
} finally {
  // 失败也复核来源与参考；保留原始失败，不以清理错误替换原始原因。
  result.integrityErrors = []
  try {
    if (result.manifest) assert.deepEqual(await verifyManifest(repository, manifestPath), result.manifest, '运行期间清单变化')
    else {
      assert.deepEqual(await captureInputs(repository), result.inputs, '运行期间输入发生变化')
      assert.deepEqual(gitIdentity(repository), result.git, '运行期间 Git 状态发生变化')
    }
  } catch (error) { result.integrityErrors.push(error.stack) }
  if (referencesCaptured) {
    try {
      await checked('references-after', process.execPath, ['tests/verify-layer-render-completion.mjs', 'references'])
      const before = JSON.parse(await readFile(path.join(root, 'references-before.log'), 'utf8'))
      const after = JSON.parse(await readFile(path.join(root, 'references-after.log'), 'utf8'))
      assert.equal(after.allReferenceDigestSha256, before.allReferenceDigestSha256, '参考摘要变化')
      assert.equal(after.totalReferenceFiles, before.totalReferenceFiles, '参考文件集合变化')
      assert.deepEqual(after.originalReferences, before.originalReferences)
    } catch (error) { result.integrityErrors.push(error.stack) }
  }
  if (result.integrityErrors.length) {
    result.passed = false
    console.error(result.integrityErrors.join('\n'))
  }
  process.exitCode = result.passed ? 0 : 1
  result.finishedAt = new Date().toISOString()
  await writeFile(path.join(root, 'result.json'), JSON.stringify(result, null, 2))
  console.log(`验收${result.passed ? '通过' : '失败'}：${root}`)
}
