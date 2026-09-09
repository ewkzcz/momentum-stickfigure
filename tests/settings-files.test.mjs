/** 设置文件回归：通过公开设置接口验证真实文件读写、历史备份和完整重启恢复，全程保持后台隔离。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, readdir, rmdir, stat, unlink, writeFile } from 'node:fs/promises'
import { launchDesktop, readJson } from './helpers/desktop.mjs'

/**
 * 调用预加载公开的设置接口，不访问主进程处理器或渲染组件私有状态。
 * 处理流程：
 * 1、从页面公开对象调用指定方法，并返回真实进程通信结果。
 */
async function settingsCall(desktop, method, settings) {
  // 1、四个设置接口均返回调用结果，原版没有额外的设置事件订阅契约。
  return desktop.page.evaluate(({ method, settings }) => window.electronAPI.settings[method](settings), { method, settings })
}

/**
 * 设置现有原生对话框替代边界的选择结果。
 * 处理流程：
 * 1、只调整保存路径和打开文件列表，不替换业务读写实现。
 */
async function chooseFiles(desktop, savePath = null, openPaths = []) {
  // 1、空保存路径或空打开列表表示用户取消，不显示真实原生对话框。
  await desktop.application.evaluate((_electron, selection) => {
    globalThis.__momentumTest.savePath = selection.savePath
    globalThis.__momentumTest.openPaths = selection.openPaths
  }, { savePath, openPaths })
}

/**
 * 检查失败响应的完整字段和原生错误消息。
 * 处理流程：
 * 1、严格核对字段集合以及失败、取消状态。
 * 2、检查错误类型，不固定运行时或平台相关的完整文案。
 */
function assertFailure(result, hasCanceled, errorPattern) {
  // 1、导出导入错误包含 canceled，备份恢复错误没有该字段。
  assert.deepEqual(Object.keys(result).sort(), hasCanceled ? ['canceled', 'error', 'success'] : ['error', 'success'])
  assert.equal(result.success, false)
  if (hasCanceled) assert.equal(result.canceled, false)
  // 2、保留系统错误码或 JSON 解析错误，不接受空错误或笼统成功状态。
  assert.equal(typeof result.error, 'string')
  assert.match(result.error, errorPattern)
}

/**
 * 核对当前页面异常和外部打开请求。
 * 处理流程：
 * 1、检查运行异常和外部请求记录；写入边界及后台窗口由原辅助工具在关闭时检查。
 */
async function assertDesktopSafety(desktop) {
  // 1、不启用窗口、不调用网络、不修改既有隔离和后台保护实现。
  assert.deepEqual(desktop.errors, [])
  assert.deepEqual(await desktop.application.evaluate(() => globalThis.__momentumTest.external), [])
}

test('设置文件四通道：真实导入导出、备份轮换、失败契约与完整重启', { timeout: 120000 }, async t => {
  // 1、使用同一个隔离根和一份输入夹具，不缓存另一套应用配置或复制生产处理逻辑。
  let desktop = await launchDesktop()
  const root = desktop.root
  console.log(`设置文件验证目录：${root}`)
  const settings = {
    outputRoot: path.join(root, '图片 输出目录'),
    fileNamingRule: 'hash-only',
    createPsdFolder: false,
    groupNames: { frontHand: '旧版 前手' },
    legacyExtension: { enabled: false, count: 0, text: '', nullable: null, entries: ['中文 空格', 7] }
  }
  const exportedPath = path.join(root, '中文 空格目录', '新建 子目录', '配置 导出.json')
  const legacyPath = path.join(root, '旧格式 配置.json')
  const invalidPath = path.join(root, '无效 配置.json')
  const missingPath = path.join(root, '不存在 配置.json')
  const backupDir = path.join(root, 'home', 'Documents', 'MomentumStickFigure', 'Settings')
  const latestPath = path.join(backupDir, 'settings-latest.json')
  const invalidJson = '{ "broken": '
  try {
    await writeFile(legacyPath, JSON.stringify(settings))
    await writeFile(invalidPath, invalidJson)

    await t.test('中文空格路径导出实际 JSON，导入兼容旧格式对象全部字段', async () => {
      // 1、让生产代码创建缺失的多级导出目录，检查落盘内容而不是只检查成功字段。
      await chooseFiles(desktop, exportedPath)
      assert.deepEqual(await settingsCall(desktop, 'exportSettings', settings), { success: true, filePath: exportedPath, canceled: false })
      assert.deepEqual(await readJson(exportedPath), settings)
      assert.match(await readFile(exportedPath, 'utf8'), /^\{\n  "outputRoot":/)
      // 2、导入导出产物和无版本封装的旧对象，保持未知字段、嵌套值及假值原样返回。
      for (const filePath of [exportedPath, legacyPath]) {
        await chooseFiles(desktop, null, [filePath])
        assert.deepEqual(await settingsCall(desktop, 'importSettings'), { success: true, filePath, settings, canceled: false })
      }
    })

    await t.test('导出导入取消只返回原版取消字段，不触发文件写入', async () => {
      // 1、截取已有写入计数，只验证本次设置调用未产生文件写入。
      await chooseFiles(desktop)
      const before = await desktop.application.evaluate(() => globalThis.__momentumTest.writes.length)
      assert.deepEqual(await settingsCall(desktop, 'exportSettings', settings), { success: false, canceled: true })
      assert.deepEqual(await settingsCall(desktop, 'importSettings'), { success: false, canceled: true })
      assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.writes.length), before)
      assert.deepEqual(await readJson(exportedPath), settings)
    })

    await t.test('导入缺失文件与无效 JSON，以及导出文件父目录冲突', async () => {
      // 1、缺失路径和无效文本均通过真实文件选择和读取入口处理。
      await chooseFiles(desktop, null, [missingPath])
      assertFailure(await settingsCall(desktop, 'importSettings'), true, /ENOENT/)
      await chooseFiles(desktop, null, [invalidPath])
      assertFailure(await settingsCall(desktop, 'importSettings'), true, /JSON|Unexpected/i)
      // 2、以真实普通文件作为父目录制造 ENOTDIR，不修改文件系统函数。
      const blockedParent = path.join(root, '普通文件 不是目录')
      await writeFile(blockedParent, '保留原文件')
      await chooseFiles(desktop, path.join(blockedParent, '配置.json'))
      assertFailure(await settingsCall(desktop, 'exportSettings', settings), true, /ENOTDIR/)
      assert.equal(await readFile(blockedParent, 'utf8'), '保留原文件')
    })

    await t.test('恢复缺失副本与无效 JSON 均保留原版失败字段', async () => {
      // 1、全新隔离根不存在最新副本；恢复读取不应提前创建备份目录。
      assert.deepEqual(await settingsCall(desktop, 'restoreSettings'), { success: false, error: '未找到备份文件' })
      await assert.rejects(stat(backupDir), { code: 'ENOENT' })
      // 2、在真实最新副本写入无效文本，验证解析失败不会改写内容。
      await mkdir(backupDir, { recursive: true })
      await writeFile(latestPath, invalidJson)
      assertFailure(await settingsCall(desktop, 'restoreSettings'), false, /JSON|Unexpected/i)
      assert.equal(await readFile(latestPath, 'utf8'), invalidJson)
      await unlink(latestPath)
    })

    await t.test('自动备份真实归档和最新副本，并准确保留最近五份', async () => {
      // 1、预置明确早于当前时间的六份历史文件，不等待时间片或修改生产时钟。
      const oldNames = [
        'settings-backup_2000-01-01T00-00-00.json',
        'settings-backup_2000-01-02T00-00-00.json',
        'settings-backup_2000-01-03T00-00-00.json',
        'settings-backup_2000-01-04T00-00-00.json',
        'settings-backup_2000-01-05T00-00-00.json',
        'settings-backup_2000-01-06T00-00-00.json'
      ]
      for (const name of oldNames) await writeFile(path.join(backupDir, name), `{"历史文件":"${name}"}`)
      await writeFile(path.join(backupDir, '保留说明.txt'), '不参与备份轮换')
      // 2、直接读取返回的真实归档路径，同时检查保留和删除的具体历史文件。
      const result = await settingsCall(desktop, 'autoBackupSettings', settings)
      assert.deepEqual(Object.keys(result).sort(), ['backupPath', 'success'])
      assert.equal(result.success, true)
      assert.equal(path.dirname(result.backupPath), backupDir)
      const archiveName = path.basename(result.backupPath)
      assert.match(archiveName, /^settings-backup_\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.json$/)
      assert.deepEqual((await readdir(backupDir)).sort(), [...oldNames.slice(2), archiveName, 'settings-latest.json', '保留说明.txt'].sort())
      for (const name of oldNames.slice(2)) assert.equal(await readFile(path.join(backupDir, name), 'utf8'), `{"历史文件":"${name}"}`)
      assert.equal(await readFile(path.join(backupDir, '保留说明.txt'), 'utf8'), '不参与备份轮换')
      assert.deepEqual(await readJson(result.backupPath), settings)
      assert.deepEqual(await readJson(latestPath), settings)
      assert.equal(await readFile(result.backupPath, 'utf8'), await readFile(latestPath, 'utf8'))
      assert.deepEqual(await settingsCall(desktop, 'restoreSettings'), { success: true, settings, backupPath: latestPath })
    })

    await t.test('最新副本目录冲突产生真实备份写入失败，移除冲突后可恢复备份', async () => {
      // 1、只把固定最新副本路径变成目录，制造可控 EISDIR，不预测动态归档名。
      await unlink(latestPath)
      await mkdir(latestPath)
      assertFailure(await settingsCall(desktop, 'autoBackupSettings', settings), false, /EISDIR/)
      assert.equal((await stat(latestPath)).isDirectory(), true)
      // 2、原实现先写归档再写最新副本，失败不是事务回滚，实际归档仍保留五份。
      const archives = (await readdir(backupDir)).filter(name => name.startsWith('settings-backup_') && name.endsWith('.json'))
      assert.equal(archives.length, 5)
      assert.deepEqual(await readJson(path.join(backupDir, archives.sort().at(-1))), settings)
      await rmdir(latestPath)
      const result = await settingsCall(desktop, 'autoBackupSettings', settings)
      assert.deepEqual(Object.keys(result).sort(), ['backupPath', 'success'])
      assert.equal(result.success, true)
      assert.deepEqual(await readJson(result.backupPath), settings)
      assert.deepEqual(await readJson(latestPath), settings)
    })
    await assertDesktopSafety(desktop)
  } finally {
    await desktop.close()
  }

  // 2、彻底关闭 Electron 后复用隔离根重启，不把上一进程内存当成恢复来源。
  desktop = await launchDesktop(root)
  try {
    await t.test('完整重启后从实际最新副本恢复，并可再次导入磁盘导出文件', async () => {
      // 1、同时核对重启后的磁盘和公开恢复结果，原接口返回数据而非自动应用到界面。
      assert.deepEqual(await readJson(latestPath), settings)
      assert.deepEqual(await settingsCall(desktop, 'restoreSettings'), { success: true, settings, backupPath: latestPath })
      await chooseFiles(desktop, null, [exportedPath])
      assert.deepEqual(await settingsCall(desktop, 'importSettings'), { success: true, filePath: exportedPath, settings, canceled: false })
    })
    await assertDesktopSafety(desktop)
  } finally {
    await desktop.close()
  }
})
