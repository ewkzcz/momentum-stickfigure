/** 预设文件回归：验证公开接口的路径选择、原文读写、错误返回与重启读取。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/** 调整原生对话框边界。处理流程：1、提供隔离路径或取消选择。 */
async function select(desktop, savePath = null, openPaths = []) {
  // 1、只替代原生选择，不替代预设处理器和文件操作。
  await desktop.application.evaluate((_electron, selection) => {
    globalThis.__momentumTest.savePath = selection.savePath
    globalThis.__momentumTest.openPaths = selection.openPaths
  }, { savePath, openPaths })
}

/** 核对失败契约。处理流程：1、检查完整字段集合；2、保留原生错误码。 */
function failure(result, canceled, pattern) {
  // 1、保存失败没有取消字段，导入导出失败保留该字段。
  assert.deepEqual(Object.keys(result).sort(), canceled ? ['canceled', 'error', 'success'] : ['error', 'success'])
  assert.equal(result.success, false)
  if (canceled) assert.equal(result.canceled, false)
  // 2、错误必须来自实际操作，不能为空或伪装成功。
  assert.match(result.error, pattern)
}

test('预设文件：选择与写入分离、原文导入、取消和失败后重启读取', { timeout: 60000 }, async () => {
  // 1、使用真实应用和隔离文件，保持旧预设内容及换行原样传递。
  let desktop = await launchDesktop()
  const root = desktop.root
  console.log(`预设文件验证目录：${root}`)
  const filePath = path.join(root, '中文 空格', '嵌套 目录', '预设.json')
  const content = '{\r\n  "name": "旧预设 中文", "enabled": false, "extra": [null, 0]\r\n}\n'
  try {
    await select(desktop, filePath)
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.export()), { success: true, filePath, canceled: false })
    await assert.rejects(stat(filePath), { code: 'ENOENT' })
    const save = (filePath, content) => desktop.page.evaluate(({ filePath, content }) => window.electronAPI.preset.saveFile(filePath, content), { filePath, content })
    assert.deepEqual(await save(filePath, content), { success: true, filePath })
    assert.equal(await readFile(filePath, 'utf8'), content)
    await select(desktop, null, [filePath])
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.import()), { success: true, filePath, content, canceled: false })

    // 2、取消不得改写文件；导入保持文本契约，不在主进程解析 JSON。
    await select(desktop)
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.export()), { success: false, canceled: true })
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.import()), { success: false, canceled: true })
    assert.equal(await readFile(filePath, 'utf8'), content)
    for (const text of ['非 JSON 文本 {', '']) {
      const rawPath = path.join(root, '原文.json')
      await writeFile(rawPath, text)
      await select(desktop, null, [rawPath])
      assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.import()), { success: true, filePath: rawPath, content: text, canceled: false })
    }

    // 3、通过真实缺失文件和目录冲突验证失败，不替换文件系统。
    await select(desktop, null, [path.join(root, '缺失.json')])
    failure(await desktop.page.evaluate(() => window.electronAPI.preset.import()), true, /ENOENT/)
    const blocked = path.join(root, '普通 文件')
    await writeFile(blocked, '保留')
    failure(await save(path.join(blocked, '预设.json'), content), false, /ENOTDIR/)
    failure(await save(path.dirname(filePath), content), false, /EISDIR/)
    assert.equal(await readFile(blocked, 'utf8'), '保留')

    // 4、导出对话框异常只在原生边界注入，并在 finally 恢复原方法。
    const exportedFailure = await desktop.application.evaluate(async ({ dialog, BrowserWindow }) => {
      const original = dialog.showSaveDialog
      dialog.showSaveDialog = async () => { throw new Error('可控预设对话框失败') }
      try {
        return await BrowserWindow.getAllWindows()[0].webContents.executeJavaScript('window.electronAPI.preset.export()')
      } finally { dialog.showSaveDialog = original }
    })
    failure(exportedFailure, true, /可控预设对话框失败/)
    await select(desktop, filePath)
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.export()), { success: true, filePath, canceled: false })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }

  // 5、完全重启后读取同一磁盘文件，验证业务路径和返回内容不依赖进程内存。
  desktop = await launchDesktop(root)
  try {
    await select(desktop, null, [filePath])
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.preset.import()), { success: true, filePath, content, canceled: false })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
