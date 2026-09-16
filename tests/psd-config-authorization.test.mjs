/** PSD 配置目录授权基线：真实 IPC 与隔离磁盘，不替换业务处理器或关闭 bootstrap 保护。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile, readdir, lstat, realpath, rename, symlink, unlink } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

const directoryCases = [
  { field: 'tempDir', parent: 'temp', constant: 'DEFAULT_TEMP_DIR' },
  { field: 'cacheDir', parent: 'cache', constant: 'DEFAULT_CACHE_DIR' },
  { field: 'outputDir', parent: 'output', constant: 'DEFAULT_OUTPUT_DIR' }
]
const markerName = '授权哨兵 中文 空格.txt'
const markerContent = '只能由本测试夹具创建，不得被 PSD 配置查询改写。\n'

/** 验证真实主进程返回的目录仍在 bootstrap 隔离根中，之后才操作测试夹具。 */
function assertInside(root, target) {
  const relative = path.relative(root, target)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `路径必须在隔离根内：${target}`)
}

/** 不把权限异常等其他错误误认为路径不存在。 */
async function exists(target) {
  try { await lstat(target); return true } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

/** 每个入口使用独立应用实例，断言失败也执行原有隔离检查和退出流程。 */
async function withDesktop(run) {
  const desktop = await launchDesktop()
  console.log(`PSD 配置授权基线隔离目录：${desktop.root}`)
  try {
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    assertInside(desktop.root, userData)
    assertInside(await realpath(desktop.root), await realpath(userData))
    await run(desktop, userData)
  } finally {
    await desktop.close()
  }
}

/** 无参分支确实省略参数，不通过测试入口直接调用主进程处理器。 */
function getConfig(desktop, options) {
  if (options === undefined) return desktop.page.evaluate(() => window.electronAPI.invoke('psd-get-config'))
  return desktop.page.evaluate(value => window.electronAPI.invoke('psd-get-config', value), options)
}

/** 成功和失败均保留原有请求元数据契约。 */
function assertEnvelope(result) {
  assert.equal(typeof result, 'object')
  assert.notEqual(result, null)
  assert.match(result.requestId, /^psd-config-\d+$/)
  assert.equal(typeof result.timestamp, 'string')
  assert.ok(Number.isFinite(Date.parse(result.timestamp)), '请求时间必须有效')
  assert.equal(typeof result.processingTime, 'number')
  assert.ok(Number.isFinite(result.processingTime) && result.processingTime >= 0)
}

/** 初始化及拒绝后恢复都检查原成功字段和三个真实目录。 */
async function assertInitialized(result, userData) {
  assertEnvelope(result)
  assert.equal(result.success, true)
  assert.equal(result.data.validation.valid, true)
  assert.deepEqual(result.data.validation.errors, [])
  assert.ok(Array.isArray(result.data.validation.warnings))
  assert.deepEqual(result.data.validation.config, result.data.config)
  for (const name of ['API_CONFIG', 'PARSE_DEFAULTS', 'STATUS', 'ERROR_MESSAGES']) {
    assert.ok(result.data.constants[name] && typeof result.data.constants[name] === 'object', `保留常量字段 ${name}`)
  }
  for (const { parent, constant } of directoryCases) {
    const directory = path.join(userData, parent, 'psd')
    assert.equal(result.data.config[constant], directory)
    const stat = await lstat(directory)
    assert.equal(stat.isSymbolicLink(), false, `默认目录不能是链接：${directory}`)
    assert.equal(stat.isDirectory(), true, `默认目录应创建成功：${directory}`)
  }
}

function assertDenied(result) {
  assertEnvelope(result)
  assert.equal(result.success, false, '未授权目录必须明确返回失败，不能仅忽略参数或记录警告')
  assert.equal(result.status, 'error')
  assert.equal(typeof result.message, 'string')
  assert.ok(result.message.length > 0, '拒绝结果须包含错误说明')
}

/** 在断言之前保存完整响应及哨兵状态，保留 before 阶段的真实失败证据。 */
async function saveEvidence(desktop, evidence) {
  await writeFile(path.join(desktop.root, 'psd-config-authorization-evidence.json'), JSON.stringify(evidence, null, 2))
}

async function createSentinel(desktop, name) {
  const sentinel = path.join(desktop.root, `PSD 授权哨兵 ${name}`)
  assertInside(desktop.root, sentinel)
  await mkdir(sentinel)
  await writeFile(path.join(sentinel, markerName), markerContent)
  return sentinel
}

async function inspectSentinel(sentinel) {
  return { entries: (await readdir(sentinel)).sort(), marker: await readFile(path.join(sentinel, markerName), 'utf8') }
}

const unchangedSentinel = { entries: [markerName], marker: markerContent }

test('PSD 配置授权：无参初始化保留返回契约并创建应用自有目录', { timeout: 90000 }, async () => {
  await withDesktop(async (desktop, userData) => {
    const result = await getConfig(desktop)
    await saveEvidence(desktop, { scenario: 'default-directories', result, userData })
    await assertInitialized(result, userData)
  })
})

for (const { field } of directoryCases) {
  test(`PSD 配置授权：拒绝未授权 ${field} 且不创建目录，拒绝后可恢复`, { timeout: 90000 }, async () => {
    await withDesktop(async (desktop, userData) => {
      await assertInitialized(await getConfig(desktop), userData)
      const sentinel = await createSentinel(desktop, field)
      const unauthorized = path.join(sentinel, '未授权目录 中文 空格')
      assert.equal(await exists(unauthorized), false, '夹具开始时未授权目标必须不存在')
      const result = await getConfig(desktop, { [field]: unauthorized })
      const state = { targetExists: await exists(unauthorized), sentinel: await inspectSentinel(sentinel) }
      // 即便 before 阶段意外成功，也查询一次正常配置，验证错误请求没有破坏后续接口。
      const recovered = await getConfig(desktop)
      await saveEvidence(desktop, { scenario: field, unauthorized, result, state, recovered })
      await assertInitialized(recovered, userData)
      assert.deepEqual(state, { targetExists: false, sentinel: unchangedSentinel }, '拒绝请求不得创建目标或改动哨兵')
      assertDenied(result)
    })
  })
}

test('PSD 配置授权：空值及相同默认路径兼容，非目录选项保持', { timeout: 90000 }, async () => {
  await withDesktop(async (desktop, userData) => {
    const evidence = []
    for (const value of [undefined, null, '', 'default']) {
      const options = { parseOptions: { extractThumbnails: true }, composeOptions: { quality: 0.75 } }
      for (const { field, parent, constant } of directoryCases) {
        const directory = value === 'default' ? path.join(userData, parent, 'psd') : value
        options[field] = directory
        options[constant] = directory
      }
      const result = await getConfig(desktop, options)
      evidence.push({ value: value ?? String(value), result })
      await saveEvidence(desktop, { scenario: 'compatible-options', evidence })
      await assertInitialized(result, userData)
      for (const { field, parent } of directoryCases) assert.equal(result.data.config[field], path.join(userData, parent, 'psd'))
      assert.equal(result.data.config.parseDefaults.extractThumbnails, true)
      assert.equal(result.data.config.composeDefaults.quality, 0.75)
    }
  })
})

test('PSD 配置授权：拒绝伪造 DEFAULT_* 常量且不触碰哨兵', { timeout: 90000 }, async () => {
  await withDesktop(async (desktop, userData) => {
    const sentinel = await createSentinel(desktop, 'forged-constants')
    const evidence = []
    for (const { constant } of directoryCases) {
      const unauthorized = path.join(sentinel, constant)
      const result = await getConfig(desktop, { [constant]: unauthorized })
      const state = { targetExists: await exists(unauthorized), sentinel: await inspectSentinel(sentinel) }
      evidence.push({ constant, result, state })
      await saveEvidence(desktop, { scenario: 'forged-constants', evidence })
      assertDenied(result)
      assert.deepEqual(state, { targetExists: false, sentinel: unchangedSentinel })
    }
    await assertInitialized(await getConfig(desktop), userData)
  })
})

for (const { field, parent } of directoryCases) {
  for (const component of ['parent', 'final']) {
    const label = component === 'parent' ? '父分量' : '最终目录'
    test(`PSD 配置授权：默认 ${field} ${label}符号链接拒绝且无副作用，移除后可恢复`, { timeout: 90000 }, async () => {
      await withDesktop(async (desktop, userData) => {
        await assertInitialized(await getConfig(desktop), userData)
        const sentinel = await createSentinel(desktop, `${field}-${component}`)
        const linkPath = component === 'parent' ? path.join(userData, parent) : path.join(userData, parent, 'psd')
        const backup = path.join(desktop.root, `PSD 原目录备份 ${field}-${component}`)
        assertInside(desktop.root, linkPath)
        assertInside(desktop.root, backup)
        assert.equal(await exists(backup), false)
        let moved = false
        let linked = false
        let result
        let state
        try {
          // 移走原隔离目录而非删除其内容；失败或取消时仍能完整还原。
          await rename(linkPath, backup)
          moved = true
          await symlink(sentinel, linkPath, 'dir')
          linked = true
          assert.equal((await lstat(linkPath)).isSymbolicLink(), true)
          assert.equal(await realpath(linkPath), await realpath(sentinel))
          result = await getConfig(desktop)
          state = await inspectSentinel(sentinel)
          await saveEvidence(desktop, { scenario: `${field}-${component}`, linkPath, sentinel, result, state })
        } finally {
          // 只解除本测试创建的链接；不递归删除链接目标或任何真实用户目录。
          try { if (linked) await unlink(linkPath) } finally {
            if (moved) await rename(backup, linkPath)
          }
        }
        const recovered = await getConfig(desktop)
        await saveEvidence(desktop, { scenario: `${field}-${component}`, linkPath, sentinel, result, state, recovered })
        await assertInitialized(recovered, userData)
        assert.deepEqual(state, unchangedSentinel, '配置查询不得在链接目标中创建 psd 等子目录或修改哨兵')
        assertDenied(result)
      })
    })
  }
}
