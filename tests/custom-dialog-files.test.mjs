/** 自定义对话框文件回归：通过公开桥接验证真实图片字节、目录失败与重启恢复。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 核验失败返回的完整字段与原生错误类别。
 * 处理流程：
 * 1、比较返回字段并检查错误信息，不把调用异常当作业务失败返回。
 */
function assertFailure(result, pattern, scan = false) {
  // 1、失败不得携带成功路径，扫描失败必须返回空列表。
  assert.deepEqual(Object.keys(result).sort(), scan ? ['dialogs', 'error', 'success'] : ['error', 'success'])
  assert.equal(result.success, false)
  assert.match(result.error, pattern)
  if (scan) assert.deepEqual(result.dialogs, [])
}

/**
 * 运行自定义图片的真实磁盘与公开桥接回归。
 * 处理流程：
 * 1、启动隔离桌面并从渲染进程画布编码真实 PNG。
 * 2、验证保存、扩展名、修改时间排序及失败返回。
 * 3、完整重启后比较扫描结果，并验证缺失目录行为。
 */
test('自定义对话框文件：公开保存、扫描、删除与重启保持原语义', { timeout: 120000 }, async () => {
  // 1、所有业务及夹具仅使用启动器提供的临时目录，不替换文件系统方法。
  let desktop = await launchDesktop()
  const root = desktop.root
  console.log(`自定义对话框回归目录：${root}`)
  let expectedDialogs
  let directory
  let png
  try {
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    assert.equal(userData, path.join(root, 'app-data/momentum-stick-figure-open'))
    directory = path.join(userData, 'custom-dialogs')
    assert.equal((await stat(directory)).isDirectory(), true, '注册时应创建图片目录')
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: [] })
    png = await desktop.page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 3
      canvas.height = 2
      const context = canvas.getContext('2d')
      context.fillStyle = '#1864ab'
      context.fillRect(0, 0, 3, 2)
      context.fillStyle = '#f08c00'
      context.fillRect(1, 0, 1, 1)
      return canvas.toDataURL('image/png').split(',')[1]
    })
    const bytes = Buffer.from(png, 'base64')
    assert.deepEqual([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10])

    // 2、公开保存保留中文空格、时间戳名称与所有原始编码字节。
    const beforeSave = await desktop.application.evaluate(() => Date.now())
    const saved = await desktop.page.evaluate((data) => window.customDialog.save('中文 对话框.png', data), png)
    const afterSave = await desktop.application.evaluate(() => Date.now())
    assert.equal(saved.success, true)
    assert.match(saved.fileName, /^\d+_中文 对话框\.png$/)
    const timestamp = Number(saved.fileName.split('_')[0])
    assert.ok(timestamp >= beforeSave && timestamp <= afterSave)
    assert.deepEqual(saved, { success: true, fileName: saved.fileName, filePath: path.join(directory, saved.fileName) })
    assert.deepEqual(await readFile(saved.filePath), bytes)

    // 3、注册后改变应用数据路径，已有处理器仍使用注册时捕获的目录。
    const alternate = path.join(root, 'alternate-user-data')
    await mkdir(alternate)
    await desktop.application.evaluate(({ app }, value) => app.setPath('userData', value), alternate)
    try {
      const captured = await desktop.page.evaluate((data) => window.customDialog.save('捕获 目录.png', data), png)
      assert.equal(captured.success, true)
      assert.equal(captured.filePath, path.join(directory, captured.fileName))
      assert.deepEqual(await readFile(captured.filePath), bytes)
      assert.deepEqual(await readdir(alternate), [])
      assert.deepEqual(await desktop.page.evaluate((name) => window.customDialog.delete(name), captured.fileName), { success: true })
    } finally {
      await desktop.application.evaluate(({ app }, value) => app.setPath('userData', value), userData)
    }

    // 4、扫描只按扩展名接受文件，不解码图片；固定修改时间验证倒序而不用等待。
    const names = [saved.fileName, '扩展 大写.JPG', '扩展.jpeg', '扩展.webp', '扩展.gif', '扩展 混合.PnG']
    const offsets = [20, 60, 10, 50, 30, 40]
    expectedDialogs = []
    for (const [index, fileName] of names.entries()) {
      const filePath = path.join(directory, fileName)
      if (index > 0) await writeFile(filePath, bytes)
      const modified = new Date(Date.UTC(2024, 0, 1, 0, 0, offsets[index]))
      await utimes(filePath, modified, modified)
      const actualStat = await stat(filePath)
      assert.equal(actualStat.mtimeMs, modified.getTime())
      expectedDialogs.push({ fileName, filePath, dataURL: `data:image/${path.extname(fileName).slice(1).toLowerCase()};base64,${png}`, timestamp: actualStat.mtimeMs })
    }
    expectedDialogs.sort((a, b) => b.timestamp - a.timestamp)
    for (const name of ['忽略.txt', '忽略.svg', '忽略.bmp', '无扩展名']) await writeFile(path.join(directory, name), bytes)
    await mkdir(path.join(directory, '普通目录'))
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: expectedDialogs })

    // 5、非法参数必须被原处理器捕获；原有宽松内容与扩展名策略保持不变。
    const beforeInvalid = (await readdir(directory)).sort()
    for (const args of [[null, png], [42, png], ['错误.png', null], ['错误.png', 42], ['错误.png']]) {
      const result = await desktop.page.evaluate((values) => window.customDialog.save(...values), args)
      assertFailure(result, /must be of type string|must be of type string or an instance/)
    }
    assert.deepEqual((await readdir(directory)).sort(), beforeInvalid)
    const permissive = await desktop.page.evaluate(() => window.customDialog.save('原有行为.txt', ''))
    assert.equal(permissive.success, true)
    assert.match(permissive.fileName, /^\d+_原有行为\.txt$/)
    assert.equal(permissive.filePath, path.join(directory, permissive.fileName))
    assert.deepEqual(await readFile(permissive.filePath), Buffer.alloc(0))
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: expectedDialogs })
    assert.deepEqual(await desktop.page.evaluate((name) => window.customDialog.delete(name), permissive.fileName), { success: true })
    await assert.rejects(stat(permissive.filePath), { code: 'ENOENT' })
    assert.deepEqual(await desktop.page.evaluate((name) => window.customDialog.delete(name), permissive.fileName), { success: false, error: '文件不存在' })
    assertFailure(await desktop.page.evaluate(() => window.customDialog.delete(null)), /must be of type string/)

    // 6、真实目录假冒图片触发读取失败，整个扫描返回失败和空列表，不跳过错误项。
    const fakeName = '读取失败.png'
    await mkdir(path.join(directory, fakeName))
    assertFailure(await desktop.page.evaluate(() => window.customDialog.scan()), /EISDIR/, true)
    assertFailure(await desktop.page.evaluate((name) => window.customDialog.delete(name), fakeName), /EISDIR|EPERM/)
    assert.equal((await stat(path.join(directory, fakeName))).isDirectory(), true)
    await rm(path.join(directory, fakeName), { recursive: true })
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: expectedDialogs })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }

  // 7、重启同一隔离目录，完整结果须来自旧磁盘文件，不依赖原进程缓存。
  desktop = await launchDesktop(root)
  try {
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: expectedDialogs })
    const first = expectedDialogs[0]
    assert.deepEqual(await desktop.page.evaluate((name) => window.customDialog.delete(name), first.fileName), { success: true })
    await assert.rejects(stat(first.filePath), { code: 'ENOENT' })
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: expectedDialogs.slice(1) })

    // 8、目录运行中缺失时扫描返回空列表，保存返回原生失败而不会自动重建。
    await rm(directory, { recursive: true })
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: [] })
    assertFailure(await desktop.page.evaluate((data) => window.customDialog.save('目录缺失.png', data), png), /ENOENT/)
    await assert.rejects(stat(directory), { code: 'ENOENT' })
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.delete('目录缺失.png')), { success: false, error: '文件不存在' })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }

  // 9、再次启动才重新创建目录，保留注册时机的目录语义。
  desktop = await launchDesktop(root)
  try {
    assert.equal((await stat(directory)).isDirectory(), true)
    assert.deepEqual(await desktop.page.evaluate(() => window.customDialog.scan()), { success: true, dialogs: [] })
    assert.deepEqual(desktop.errors, [])
    console.log(`自定义对话框回归证据：${root}`)
  } finally { await desktop.close() }
})
