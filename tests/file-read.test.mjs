/** 文件读取契约：真实 Electron preload 到隔离磁盘，覆盖二进制、空文件和读取失败。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { acceptanceMode, verifyManifest } from './helpers/acceptance-provenance.mjs'

/** 通过公开预加载接口查询存在性与读取原始字节。 */
async function probe(page, filePath) {
  return page.evaluate(async filePath => {
    const exists = await window.electronAPI.checkFileExists(filePath)
    const bytes = await window.electronAPI.readFile(filePath)
    return { exists, bytes: bytes === null ? null : Array.from(bytes) }
  }, filePath)
}

test('文件读取：中文空格、二进制、空文件、缺失和非法路径及目录错误', { timeout: 60000 }, async () => {
  // 1、运行原桌面入口，所有样本仅写本轮隔离目录。
  const desktop = await launchDesktop()
  const { root, page } = desktop
  const evidence = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    mainSourceStatus: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src/main'], { cwd: repository, encoding: 'utf8' }),
    mainBundleSha256: createHash('sha256').update(await readFile(path.join(repository, 'out/main/index.js'))).digest('hex'),
    scenes: [], passed: false
  }
  console.log(`文件读取证据：${root}`)
  try {
    const beforeRoot = process.env.MOMENTUM_FILE_READ_BEFORE
    const before = beforeRoot ? JSON.parse(await readFile(path.join(beforeRoot, 'file-read-result.json'), 'utf8')) : null
    evidence.mode = acceptanceMode(beforeRoot, process.env.MOMENTUM_ACCEPTANCE_MANIFEST)
    if (evidence.mode === 'regression') evidence.manifest = await verifyManifest(repository, process.env.MOMENTUM_ACCEPTANCE_MANIFEST)
    else if (before) {
      assert.equal(before.passed, true)
      assert.equal(before.mainSourceStatus, '')
    } else assert.equal(evidence.mainSourceStatus, '', '原版主进程必须洁净')
    const directory = path.join(root, '中文 空格', '嵌套目录')
    await mkdir(directory, { recursive: true })
    const binary = path.join(directory, '二进制.bin')
    const empty = path.join(directory, '空文件.txt')
    const text = path.join(directory, '中文资料.txt')
    const bytes = Buffer.from([0, 1, 2, 127, 128, 254, 255, 10])
    const textBytes = Buffer.from('中文资料\n第二行🙂')
    await writeFile(binary, bytes)
    await writeFile(empty, '')
    await writeFile(text, textBytes)
    // 授权契约变更：正例经真实生产选择通道，不直接 grant；目录不再泄漏存在性。
    await desktop.application.evaluate((_electron, files) => { globalThis.__momentumTest.openPaths = files }, [binary, empty, text])
    assert.deepEqual(await page.evaluate(() => window.fileSystem.selectFile({ multiple: true })), {
      success: true, canceled: false, paths: [binary, empty, text], path: null
    })
    // 2、保留非法参数的失败形态与合法字节断言。
    for (const [name, input, expected] of [
      ['binary', binary, { exists: true, bytes: [...bytes] }],
      ['empty', empty, { exists: true, bytes: [] }],
      ['utf8', text, { exists: true, bytes: [...textBytes] }],
      ['missing', path.join(directory, '不存在.bin'), { exists: false, bytes: null }],
      ['directory', directory, { exists: false, bytes: null }],
      ['null', null, { exists: false, bytes: null }],
      ['number', 123, { exists: false, bytes: null }],
      ['object', {}, { exists: false, bytes: null }],
      ['empty-path', '', { exists: false, bytes: null }],
      ['nul-path', 'invalid\u0000path', { exists: false, bytes: null }]
    ]) {
      const actual = await probe(page, input)
      assert.deepEqual(actual, expected, name)
      evidence.scenes.push({ name, actual })
    }
    const omitted = await page.evaluate(async () => ({ exists: await window.electronAPI.checkFileExists(), bytes: await window.electronAPI.readFile() }))
    assert.deepEqual(omitted, { exists: false, bytes: null })
    evidence.scenes.push({ name: 'omitted', actual: omitted })
    // 3、重复读取保持源文件原字节，失败后仍可正常处理下一项。
    assert.deepEqual(await probe(page, binary), { exists: true, bytes: [...bytes] })
    assert.deepEqual(await readFile(binary), bytes)
    assert.deepEqual(desktop.errors, [])
    if (before) {
      // 仅目录存在性是有意收紧的权限差异，其他历史字节及返回形态逐项不变。
      assert.deepEqual(evidence.scenes.filter(item => item.name !== 'directory'), before.scenes.filter(item => item.name !== 'directory'))
    }
    if (evidence.manifest) assert.deepEqual(await verifyManifest(repository, process.env.MOMENTUM_ACCEPTANCE_MANIFEST), evidence.manifest)
    evidence.passed = true
  } catch (error) {
    evidence.failure = error.message
    throw error
  } finally {
    try { await desktop.close() } catch (error) {
      evidence.passed = false
      evidence.cleanupFailure = error.message
      throw error
    } finally {
      await writeFile(path.join(root, 'file-read-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
