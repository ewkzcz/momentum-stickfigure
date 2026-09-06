/** PSD 参考管理：显式首次采集，回归只读参考且严格校验素材与运行环境。 */
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir, chmod, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import { generatePsdFixtures } from '../fixtures/generate-psd.mjs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { launchDesktop, repository, readJson } from './desktop.mjs'
import { verifyFixture, assertSamePixels } from './images.mjs'
import { runPsdScenario } from '../scenarios/psd.mjs'

export const referenceDirectory = path.resolve(process.env.MOMENTUM_REFERENCE_DIR || path.join(repository, 'temp/regression-reference-v2'))
export const syntheticReferenceDirectory = path.join(referenceDirectory, 'synthetic-preview-range-fixed')

/** 加载独立素材清单，支持外部授权素材与自定义存放目录。 */
export async function fixtures() {
  // 1、默认使用本地指定素材，路径不绑定开发者机器。
  const manifest = await readJson(process.env.MOMENTUM_FIXTURE_MANIFEST || path.join(repository, 'tests/fixtures/local-psd.json'))
  assert.equal(manifest.version, 1, '不支持的素材清单版本')
  assert.ok(manifest.fixtures.length > 0, '素材清单为空，不能跳过图像回归')
  return manifest.fixtures.map((fixture) => ({ ...fixture, absolutePath: path.resolve(process.env.MOMENTUM_FIXTURE_ROOT || repository, fixture.path) }))
}

/** 每次在新目录生成公开小素材，字节确定性由生成器内部验证。 */
export async function syntheticFixtures() {
  // 1、生成结果是输入素材，不是待测图像的预期输出。
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-synthetic-'))
  const directory = path.join(root, 'fixtures')
  const list = await generatePsdFixtures(directory)
  return list.map((fixture) => ({ ...fixture, absolutePath: path.join(directory, fixture.path) }))
}

/** 运行单素材参考采集或验证，任何差异均保留为失败。 */
export async function checkPsdFixture(fixture, record = false, rootDirectory = referenceDirectory) {
  // 1、采集参考要求业务源码干净，目录只允许创建一次，杜绝覆盖旧参考。
  await verifyFixture(fixture.absolutePath, fixture.sha256)
  const directory = path.join(rootDirectory, fixture.id)
  if (record) {
    execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'src', 'electron.vite.config.mjs'], { cwd: repository })
    await mkdir(rootDirectory, { recursive: true })
    await mkdir(directory)
  }
  const expected = record ? null : await readJson(path.join(directory, 'manifest.json')).catch((error) => {
    throw new Error('未运行：缺少完整且已核验的原版参考；回归命令不会现场生成预期结果', { cause: error })
  })
  const desktop = await launchDesktop()
  const actual = { version: 1, fixtureHash: fixture.sha256, environment: await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })), snapshots: [] }
  if (record) actual.sourceTree = execFileSync('git', ['rev-parse', 'HEAD:src'], { cwd: repository, encoding: 'utf8' }).trim()
  try {
    if (expected) {
      assert.equal(expected.fixtureHash, actual.fixtureHash, '参考素材哈希不一致')
      assert.deepEqual(actual.environment, expected.environment, '运行时改变，需要明确建立独立平台参考，不能覆盖现有基线')
    }
    // 2、每个场景输出实际图片与状态，验证时只读对应的原版参考。
    await runPsdScenario(desktop, fixture, async (name, image, state) => {
      const bytes = Buffer.from(image.png, 'base64')
      const scene = { name, state }
      actual.snapshots.push(scene)
      await writeFile(path.join(desktop.root, `${name}.png`), bytes)
      if (record) {
        const filename = path.join(directory, `${name}.png`)
        await writeFile(filename, bytes, { flag: 'wx' })
        await chmod(filename, 0o444)
      } else {
        const reference = expected.snapshots[actual.snapshots.length - 1]
        assert.deepEqual(scene, reference, `${fixture.id}/${name}：业务状态或操作顺序发生变化`)
        await assertSamePixels(bytes, await readFile(path.join(directory, `${name}.png`)), `${fixture.id}/${name}`)
      }
      console.log(`${record ? '参考采集' : '像素一致'} ${fixture.id}/${name}`)
    })
    if (expected) assert.equal(actual.snapshots.length, expected.snapshots.length, '场景数量改变，不能静默遗漏回归')
  } finally {
    // 3、保留失败现场，验证素材未改动，关闭应用后检查全部隔离记录。
    console.log(`验证证据：${desktop.root}`)
    await writeFile(path.join(desktop.root, 'result.json'), JSON.stringify(actual, null, 2))
    await desktop.close()
    await verifyFixture(fixture.absolutePath, fixture.sha256)
  }
  // 4、所有场景、退出隔离和素材复核均通过后，才写入完整参考标记。
  if (record) {
    await writeFile(path.join(directory, 'manifest.json'), JSON.stringify(actual, null, 2), { flag: 'wx' })
    await chmod(path.join(directory, 'manifest.json'), 0o444)
  }
}
