/** 读取授权 before：真实 Electron/preload/业务 IPC；仅原生对话框使用既有隔离替身，不验证真实系统交互。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, writeFile, realpath } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

const denied = { exists: false, bytes: null }

/** 两个调用都走生产 preload；先取得两项结果，避免首个断言失败隐藏读取结果。 */
async function probe(page, filePath) {
  return page.evaluate(async filePath => {
    const exists = await window.electronAPI.checkFileExists(filePath)
    const bytes = await window.electronAPI.readFile(filePath)
    return { exists, bytes: bytes === null ? null : Array.from(bytes) }
  }, filePath)
}

/** 只设置 bootstrap 已有的原生选择返回值，不替换 IPC、来源登记或授权实现。 */
async function selectPsd(desktop, paths) {
  await desktop.application.evaluate((_electron, paths) => { globalThis.__momentumTest.openPaths = paths }, paths)
  const result = await desktop.page.evaluate(() => window.electronAPI.selectPsdFiles())
  assert.deepEqual(await desktop.application.evaluate(() => globalThis.__momentumTest.openPaths), [], '选择结果必须由生产入口消费')
  return result
}

/** 每项独立隔离；失败也检查原文件未被删改，并执行正常关闭及既有后台/网络/进程保护检查。 */
async function withFiles(t, run) {
  const desktop = await launchDesktop()
  const child = desktop.application.process()
  const failures = []
  const directory = path.join(desktop.root, '读取授权 中文 空格')
  const files = {
    selected: path.join(directory, '选择 人物.psd'),
    sibling: path.join(directory, '未选择 兄弟.psd'),
    empty: path.join(directory, '空 文件.psd')
  }
  const bytes = {
    selected: Buffer.from([0, 1, 2, 10, 127, 128, 254, 255, ...Buffer.from('中文 空格🙂')]),
    sibling: Buffer.from('隔离哨兵：禁止凭路径读出'),
    empty: Buffer.alloc(0)
  }
  const created = []
  try {
    await mkdir(directory, { recursive: true })
    for (const key of Object.keys(files)) {
      await writeFile(files[key], bytes[key], { flag: 'wx' })
      created.push(key)
    }
    t.diagnostic(`隔离目录：${desktop.root}；字节夹具不执行 PSD 解析；原生选择仅 bootstrap 替身。`)
    await run({ desktop, files, bytes })
  } catch (error) { failures.push(error) }
  finally {
    for (const key of created) {
      try { assert.deepEqual(await readFile(files[key]), bytes[key], `${key} 原文件必须保留且字节不变`) }
      catch (error) { failures.push(error) }
    }
    try { assert.deepEqual(desktop.errors, [], '页面不能产生未捕获异常') }
    catch (error) { failures.push(error) }
    try {
      await desktop.close()
      assert.equal(child.exitCode, 0, '桌面必须正常退出')
      assert.equal(child.signalCode, null, '桌面不能以信号退出')
    } catch (error) { failures.push(error) }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
}

/** 诊断保留两个真实结果；拒绝必须保持 false/null，而不是任意失败包络。 */
async function expectDenied(t, page, filePath) {
  const actual = await probe(page, filePath)
  t.diagnostic(`真实读取结果：${JSON.stringify(actual)}`)
  assert.deepEqual(actual, denied)
}

const options = { timeout: 60000, concurrency: false }

test('读取授权：未原生选择的隔离哨兵不能检查或读取', options, t => withFiles(t, async ({ desktop, files }) => {
  await expectDenied(t, desktop.page, files.sibling)
}))

test('读取授权控制：原生选择中文空格文件后完整二进制、空文件和重复读取保持一致', options, t => withFiles(t, async ({ desktop, files, bytes }) => {
  assert.deepEqual(await selectPsd(desktop, [files.selected, files.empty]), {
    success: true, filePaths: [files.selected, files.empty], canceled: false
  })
  for (const key of ['selected', 'empty', 'selected']) {
    assert.deepEqual(await probe(desktop.page, files[key]), { exists: true, bytes: [...bytes[key]] })
  }
}))

test('读取授权：选择一个文件不能授予同目录兄弟文件', options, t => withFiles(t, async ({ desktop, files, bytes }) => {
  assert.deepEqual(await selectPsd(desktop, [files.selected]), { success: true, filePaths: [files.selected], canceled: false })
  assert.deepEqual(await probe(desktop.page, files.selected), { exists: true, bytes: [...bytes.selected] })
  await expectDenied(t, desktop.page, files.sibling)
}))

test('读取授权：原生取消保留取消包络且不授予文件', options, t => withFiles(t, async ({ desktop, files }) => {
  assert.deepEqual(await selectPsd(desktop, []), { success: false, canceled: true, filePaths: [] })
  await expectDenied(t, desktop.page, files.sibling)
}))

test('读取授权：写入共享历史和输出目录配置不构成文件授权', options, t => withFiles(t, async ({ desktop, files }) => {
  const entries = [
    ['psd-file-history', JSON.stringify([files.sibling])],
    ['stickfigure-config', JSON.stringify({ outputRoot: path.dirname(files.sibling) })]
  ]
  const results = await desktop.page.evaluate(async entries => {
    const results = []
    for (const [key, value] of entries) {
      results.push({ saved: await window.electronAPI.storage.setItem(key, value), loaded: await window.electronAPI.storage.getItem(key) })
    }
    return results
  }, entries)
  assert.deepEqual(results, entries.map(([, value]) => ({ saved: { success: true }, loaded: { success: true, value } })))
  await expectDenied(t, desktop.page, files.sibling)
}))

test('读取授权：打开及保存对话框的默认路径在取消后均不构成授权', options, t => withFiles(t, async ({ desktop, files }) => {
  await desktop.application.evaluate(() => {
    globalThis.__momentumTest.openPaths = []
    globalThis.__momentumTest.savePath = null
  })
  const results = await desktop.page.evaluate(async filePath => ({
    open: await window.fileSystem.selectFile({ defaultPath: filePath }),
    save: await window.electronAPI.invoke('show-save-dialog', { defaultPath: filePath })
  }), files.sibling)
  assert.deepEqual(results, {
    open: { success: false, canceled: true, paths: [] },
    save: { success: false, canceled: true }
  })
  await expectDenied(t, desktop.page, files.sibling)
}))

test('读取授权：相对于隔离工作目录的现存路径不能绕过授权', options, t => withFiles(t, async ({ desktop, files, bytes }) => {
  const cwd = await desktop.application.evaluate(() => process.cwd())
  // macOS cwd会规范为/private/var，而夹具路径可能使用/var系统别名；先统一实际路径。
  const relative = path.relative(await realpath(cwd), await realpath(files.sibling))
  assert.deepEqual(await readFile(path.resolve(cwd, relative)), bytes.sibling, '相对路径必须实际命中隔离哨兵')
  assert.equal(path.isAbsolute(relative), false)
  assert.ok(relative && relative !== '..' && !relative.startsWith(`..${path.sep}`), '相对夹具必须仍指向隔离目录内部')
  await expectDenied(t, desktop.page, relative)
}))

test('读取授权参数控制：NUL、空路径和非字符串仍返回 false/null', options, t => withFiles(t, async ({ desktop, files }) => {
  // -1 不可能是有效文件描述符；不传任何真实或潜在可用的进程描述符。
  for (const filePath of [null, undefined, -1, {}, [], '', `${files.sibling}\0suffix`]) {
    await expectDenied(t, desktop.page, filePath)
  }
}))
