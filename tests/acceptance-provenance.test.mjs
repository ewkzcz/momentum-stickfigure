/** 验收模式契约：真实临时仓库验证文件清单，不启动桌面或修改项目 Git。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { acceptanceMode, assertBaselineEvidence, captureInputs, gitIdentity, inventory, verifyManifest } from './helpers/acceptance-provenance.mjs'

test('验收模式：基线、对照及回归独立，拒绝冲突参数', () => {
  assert.equal(acceptanceMode(null, null), 'baseline')
  assert.equal(acceptanceMode('before.json', null), 'comparison')
  assert.equal(acceptanceMode(null, 'build.json'), 'regression')
  assert.throws(() => acceptanceMode('before.json', 'build.json'), /不能同时启用/)
})

test('验收模式：回归和对照证据不能充当原版基线', () => {
  assertBaselineEvidence({ passed: true, mode: 'baseline' })
  assertBaselineEvidence({ passed: true })
  for (const evidence of [{ passed: false, mode: 'baseline' }, { passed: true, mode: 'regression' }, { passed: true, mode: 'comparison' }, { passed: true, beforeResult: 'before.json' }]) {
    assert.throws(() => assertBaselineEvidence(evidence))
  }
})

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-provenance-contract-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  git(['init', '--quiet'])
  git(['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '--allow-empty', '-m', 'isolated fixture'])
  for (const folder of ['src', 'tests', 'scripts', 'out']) {
    await mkdir(path.join(root, folder))
    await writeFile(path.join(root, folder, 'fixture.txt'), folder)
  }
  for (const file of ['package.json', 'package-lock.json', 'electron.vite.config.mjs', 'electron-builder.yml', 'eslint.config.mjs']) await writeFile(path.join(root, file), '{}')
  const filename = path.join(root, '.git', 'manifest.json')
  const manifest = { schema: 1, mode: 'regression', repository: root, git: gitIdentity(root), inputs: await captureInputs(root), outputs: await inventory(root, ['out']), build: { command: 'npm run build', status: 0 } }
  const save = () => writeFile(filename, JSON.stringify(manifest))
  await save()
  return { root, filename, manifest, save, git }
}

test('清单：真实记录非洁净源码，未发生变化时前后验证通过', async t => {
  const { root, filename, manifest } = await fixture(t)
  assert.notEqual(manifest.git.status, '')
  const initial = await verifyManifest(root, filename)
  assert.deepEqual(await verifyManifest(root, filename), initial)
})

test('清单：缺失、无效JSON、失败构建和字段缺失均拒绝', async t => {
  const { root, filename, manifest, save } = await fixture(t)
  await assert.rejects(verifyManifest(root, filename + '.missing'), /ENOENT/)
  await writeFile(filename, '{')
  await assert.rejects(verifyManifest(root, filename), SyntaxError)
  manifest.build.status = 1
  await save()
  await assert.rejects(verifyManifest(root, filename), /构建必须成功/)
  manifest.build.status = 0
  delete manifest.inputs
  await save()
  await assert.rejects(verifyManifest(root, filename), /源码、测试或配置/)
})

for (const folder of ['src', 'tests', 'scripts', 'out']) {
  test(`清单：拒绝运行期间${folder}文件内容变化`, async t => {
    const { root, filename } = await fixture(t)
    await verifyManifest(root, filename)
    await writeFile(path.join(root, folder, 'fixture.txt'), 'changed')
    await assert.rejects(verifyManifest(root, filename), folder === 'out' ? /构建产物/ : /源码、测试或配置/)
  })
}

test('清单：拒绝清单身份、模式、HEAD及工作区状态不匹配', async t => {
  const { root, filename, manifest, save } = await fixture(t)
  for (const [key, value] of [['repository', root + '/other'], ['mode', 'baseline'], ['schema', 99], ['git', { ...manifest.git, head: '0'.repeat(40) }], ['git', { ...manifest.git, status: '' }]]) {
    const original = manifest[key]
    manifest[key] = value
    await save()
    await assert.rejects(verifyManifest(root, filename))
    manifest[key] = original
  }
})

test('清单：新增或删除产物不能遗漏', async t => {
  const { root, filename } = await fixture(t)
  await rm(path.join(root, 'out', 'fixture.txt'))
  await assert.rejects(verifyManifest(root, filename))
  await writeFile(path.join(root, 'out', 'fixture.txt'), 'out')
  await writeFile(path.join(root, 'out', 'extra.txt'), 'extra')
  await assert.rejects(verifyManifest(root, filename))
})
