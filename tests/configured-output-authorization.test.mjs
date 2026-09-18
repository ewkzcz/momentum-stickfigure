import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { access, mkdir, readdir, readFile, symlink } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

for (const kind of ['drag', 'gemini']) {
  test(`配置目录授权：${kind}的路径文本不能直接获得写入权限`, { timeout: 30000 }, async () => {
    const desktop = await launchDesktop()
    const directory = path.join(desktop.root, '未授权 中文输出')
    await mkdir(directory)
    try {
      const result = await desktop.page.evaluate(async ({ kind, directory }) => {
        if (kind === 'drag') return window.electronAPI.invoke('save-drag-image-and-copy', 'aGVsbG8=', null, { outputRoot: directory })
        return window.electronAPI.invoke('fal-create-directories', { projectRoot: directory })
      }, { kind, directory })
      assert.equal(result.success, false, '仅配置字符串不能授予目录写入权限')
      assert.deepEqual(await readdir(directory), [], '拒绝时不得创建输出或日志')
      assert.deepEqual(desktop.errors, [])
    } finally { await desktop.close() }
  })
}

test('配置目录授权：Gemini子路径不得逃出已确认的项目根', { timeout: 30000 }, async () => {
  const desktop = await launchDesktop()
  const root = path.join(desktop.root, '已选项目')
  const escaped = path.join(desktop.root, '越界输出')
  await mkdir(root)
  try {
    await desktop.application.evaluate((_electron, root) => { globalThis.__momentumTest.openPaths = [root] }, root)
    const selected = await desktop.page.evaluate(() => window.fileSystem.selectFolder({ purpose: 'export' }))
    assert.equal(selected.success, true)
    const result = await desktop.page.evaluate(({ root, escaped }) => window.electronAPI.invoke('fal-create-directories', { projectRoot: root, outputDir: escaped }), { root, escaped })
    assert.equal(result.success, false, '原生选择根目录也不能授权根外子路径')
    await assert.rejects(access(escaped), { code: 'ENOENT' })
  } finally { await desktop.close() }
})

for (const purpose of ['canvas-output', 'gemini-output']) {
  test(`配置目录授权：${purpose}原生确认后可输出中文目录且不授通用写`, { timeout: 30000 }, async () => {
    const desktop = await launchDesktop()
    const root = path.join(desktop.root, '中文 项目输出')
    await mkdir(root)
    try {
      await desktop.application.evaluate((_electron, root) => { globalThis.__momentumTest.openPaths = [root] }, root)
      assert.equal((await desktop.page.evaluate(purpose => window.fileSystem.selectFolder({ purpose }), purpose)).success, true)
      const result = await desktop.page.evaluate(({ purpose, root }) => purpose === 'canvas-output'
        ? window.electronAPI.invoke('save-drag-image-and-copy', 'aGVsbG8=', null, { outputRoot: root })
        : window.electronAPI.invoke('fal-create-directories', { projectRoot: root, outputDir: '中文 结果' }), { purpose, root })
      assert.equal(result.success, true, JSON.stringify(result))
      if (purpose === 'canvas-output') assert.equal(await readFile(result.filePath, 'utf8'), 'hello')
      else assert.deepEqual((await readdir(root)).sort(), ['logs', 'output', '中文 结果'].sort())
      const generic = await desktop.page.evaluate(file => window.electronAPI.writeFile(file, 'aGVsbG8='), path.join(root, '通用.txt'))
      assert.equal(generic.success, false)
      assert.deepEqual(desktop.errors, [])
    } finally { await desktop.close() }
  })
}

test('配置目录授权：根内链接拒绝后正常目录仍可用', { timeout: 30000 }, async () => {
  const desktop = await launchDesktop()
  const root = path.join(desktop.root, '项目'), outside = path.join(desktop.root, '外部')
  await mkdir(root); await mkdir(outside)
  await symlink(outside, path.join(root, '链接'))
  try {
    await desktop.application.evaluate((_electron, root) => { globalThis.__momentumTest.openPaths = [root] }, root)
    assert.equal((await desktop.page.evaluate(() => window.fileSystem.selectFolder({ purpose: 'gemini-output' }))).success, true)
    const rejected = await desktop.page.evaluate(root => window.electronAPI.invoke('fal-create-directories', { projectRoot: root, outputDir: '链接/输出' }), root)
    assert.equal(rejected.success, false)
    assert.deepEqual(await readdir(outside), [])
    const success = await desktop.page.evaluate(root => window.electronAPI.invoke('fal-create-directories', { projectRoot: root }), root)
    assert.equal(success.success, true)
  } finally { await desktop.close() }
})

