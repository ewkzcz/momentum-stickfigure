/** PSD 上传协调回归：真实按钮及合成拖放输入沿用生产读盘、解析、渲染与消息实现。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { copyFile, readFile, writeFile, stat } from 'node:fs/promises'
import { launchDesktop, readJson } from './helpers/desktop.mjs'
import { syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { stableCanvas, observeImages, assertSamePixels, verifyFixture } from './helpers/images.mjs'

/**
 * 通过实际上传按钮选择路径。
 * 处理流程：
 * 1、仅设置原生对话框的公开测试边界，页面与文件 IPC 保持原实现。
 */
async function selectPaths(desktop, paths) {
  // 1、对话框清空路径表示取消；不替换渲染进程 API 或调用组件私有方法。
  await desktop.application.evaluate((_electron, selected) => { globalThis.__momentumTest.openPaths = selected }, paths)
  await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
}

/**
 * 核验上传结束时的消息和实际标签。
 * 处理流程：
 * 1、等待指定类型的汇总消息，并确认处理消息已清理。
 * 2、读取标签顺序和活动标签，防止成功提示掩盖会话丢失。
 */
async function expectResult(page, text, type, names, active) {
  // 1、使用用户可见消息判断真实异步操作完成，不用固定延迟猜测结束。
  await page.locator(`.n-message--${type}-type`).filter({ hasText: text }).waitFor()
  await page.waitForFunction(() => ![...document.querySelectorAll('.n-message')].some((node) => /正在处理|正在解析/.test(node.textContent)))
  // 2、标签名称来自 DOM，不从业务内部文件列表推算。
  assert.deepEqual(await page.locator('.psd-tab-name').evaluateAll((nodes) => nodes.map((node) => node.title)), names)
  assert.equal(await page.locator('.psd-tab-item.active .psd-tab-name').getAttribute('title'), active)
  assert.equal(await page.getByRole('button', { name: '预览', exact: true }).isDisabled(), false)
}

/**
 * 比较当前真实画布和已经核验的输入对应像素。
 * 处理流程：
 * 1、等待真实图像解码及画布稳定，逐字节比较 RGBA 并输出可计数结果。
 */
async function expectPixels(page, expected, label) {
  // 1、expected 只来自只读原版参考或同输入会话；不现场生成参考图。
  const actual = Buffer.from((await stableCanvas(page)).png, 'base64')
  await assertSamePixels(actual, expected, label)
  console.log(`上传像素一致：${label}`)
  return actual
}

/**
 * 以无路径 File 触发桌面页面的拖放入口。
 * 处理流程：
 * 1、使用真实 PSD 字节构造浏览器 File 与 DataTransfer。
 * 2、向实际画布区域发送合成事件，业务自行保存文件及读取解析。
 */
async function dropBytes(page, bytes, name) {
  // 1、这里只合成输入事件，不伪造 Electron 保存结果或 PSD 解析返回值。
  return page.locator('.canvas-area').evaluate((area, input) => {
    const file = new window.File([new Uint8Array(input.bytes)], input.name, { type: 'application/octet-stream' })
    const transfer = new window.DataTransfer()
    transfer.items.add(file)
    const event = new window.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer })
    const hadPath = Boolean(file.path)
    area.dispatchEvent(event)
    return { hadPath, prevented: event.defaultPrevented, size: file.size }
  }, { bytes: [...bytes], name })
}

test('PSD 上传协调：原生选择边界、批量失败隔离及合成拖放保持标签和像素', { timeout: 120000 }, async () => {
  // 1、生成公开输入并核对既有参考的素材哈希、运行环境和只读权限。
  const fixtures = (await syntheticFixtures()).slice(0, 2)
  const desktop = await launchDesktop()
  const { page, application } = desktop
  console.log(`上传回归证据：${desktop.root}`)
  const evidence = { input: '真实上传按钮及合成 DataTransfer 事件，非操作系统原生拖放验收', scenes: [] }
  try {
    const references = []
    for (const fixture of fixtures) {
      await verifyFixture(fixture.absolutePath, fixture.sha256)
      const directory = path.join(syntheticReferenceDirectory, fixture.id)
      const manifest = await readJson(path.join(directory, 'manifest.json'))
      assert.equal(manifest.fixtureHash, fixture.sha256)
      assert.deepEqual(manifest.environment, await application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome })))
      const file = path.join(directory, 'initial.png')
      assert.equal((await stat(file)).mode & 0o222, 0, '原版参考必须只读')
      references.push(await readFile(file))
    }
    const first = path.join(desktop.root, '原始人物 中文.psd')
    const second = path.join(desktop.root, '批量人物 中文.psd')
    const third = path.join(desktop.root, '解析失败后人物.psd')
    const missing = path.join(desktop.root, '不存在的人物.psd')
    const invalid = path.join(desktop.root, '损坏的人物.psd')
    await copyFile(fixtures[0].absolutePath, first)
    await copyFile(fixtures[1].absolutePath, second)
    await copyFile(fixtures[1].absolutePath, third)
    await writeFile(invalid, '公开测试输入：这不是有效的 PSD 字节', { flag: 'wx' })
    const names = [path.basename(first)]
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    // 首个损坏文件必须拒绝，后续有效文件仍应成为首个正常会话。
    await selectPaths(desktop, [invalid])
    await page.locator('.n-message--error-type').filter({ hasText: '1 个失败' }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.n-message--loading-type').length === 0)
    assert.equal(await page.locator('.psd-tab-item').count(), 0, '损坏PSD不能创建无效标签')
    assert.equal(await page.getByRole('button', { name: '预览', exact: true }).isDisabled(), true)
    evidence.scenes.push({ name: '首个损坏文件拒绝', message: '1 个失败', type: 'error', tabs: 0 })
    await selectPaths(desktop, [first])
    await expectResult(page, '成功上传 1 个', 'success', names, names[0])
    const initial = await expectPixels(page, references[0], '按钮导入对应原版参考')
    evidence.scenes.push({ name: '按钮导入', message: '成功上传 1 个', type: 'success', tabs: 1 })

    // 2、重复已打开路径只提示已打开；取消返回空路径时也不能改变标签或画布。
    await selectPaths(desktop, [first])
    await expectResult(page, '1 个已打开', 'info', names, names[0])
    await expectPixels(page, initial, '重复选择不覆盖原始画布')
    await page.waitForFunction(() => document.querySelectorAll('.n-message').length === 0)
    await selectPaths(desktop, [])
    await expectPixels(page, initial, '取消及空路径不覆盖原始画布')
    assert.deepEqual(await page.locator('.psd-tab-name').evaluateAll((nodes) => nodes.map((node) => node.title)), names)
    assert.equal(await page.locator('.n-message').count(), 0, '取消不应产生失败或加载消息')
    evidence.scenes.push({ name: '重复已打开路径', message: '1 个已打开', type: 'info', tabs: 1 }, { name: '取消并返回空路径', messages: 0, tabs: 1 })

    // 3、实际不存在文件返回 null，循环继续读取有效文件，当前画布保持原会话。
    await selectPaths(desktop, [missing, second])
    names.push(path.basename(second))
    await expectResult(page, '成功上传 1 个，1 个失败', 'success', names, names[0])
    await expectPixels(page, initial, '读取失败混合导入保留原始画布')
    await page.getByTitle(names[1], { exact: true }).click()
    const secondCanvas = await expectPixels(page, references[1], '混合导入的有效文件对应原版参考')
    await page.getByTitle(names[0], { exact: true }).click()
    await expectPixels(page, initial, '切回原文件没有被批量读取覆盖')
    evidence.scenes.push({ name: '不存在与有效文件混合', message: '成功上传 1 个，1 个失败', type: 'success', tabs: 2, readFailure: '生产 read-file 返回 null' })

    // 4、内层解析失败必须传播到批量计数，同时继续处理后续有效文件。
    await page.waitForFunction(() => document.querySelectorAll('.n-message').length === 0)
    await selectPaths(desktop, [invalid, third])
    names.push(path.basename(third))
    await expectResult(page, '成功上传 1 个，1 个失败', 'success', names, names[0])
    await expectPixels(page, initial, '拒绝损坏文件不覆盖已有画布')
    await page.getByTitle(names[2], { exact: true }).click()
    await expectPixels(page, secondCanvas, '损坏文件之后仍处理相同有效输入')
    await page.getByTitle(names[0], { exact: true }).click()
    await expectPixels(page, initial, '损坏文件之后原始会话仍可恢复')
    evidence.scenes.push({ name: '损坏与有效文件混合', message: '成功上传 1 个，1 个失败', type: 'success', tabs: 3 })

    // 5、原拖入和离开事件应切换高亮，两个阶段都不改变已有会话像素。
    const area = page.locator('.canvas-area')
    assert.equal(await area.evaluate((node) => node.classList.contains('drag-over')), false)
    await area.dispatchEvent('dragover', { bubbles: true, cancelable: true })
    await page.waitForFunction(() => document.querySelector('.canvas-area').classList.contains('drag-over'))
    await expectPixels(page, initial, '拖入高亮保留画布')
    await area.dispatchEvent('dragleave', { bubbles: true, cancelable: true })
    await page.waitForFunction(() => !document.querySelector('.canvas-area').classList.contains('drag-over'))
    await expectPixels(page, initial, '拖离高亮清除后保留画布')

    // 同一失败响应也必须让无路径拖放失败，不能新增会话或覆盖当前图像。
    await dropBytes(page, await readFile(invalid), '拖放损坏人物.psd')
    await expectResult(page, '1 个失败', 'info', names, names[0])
    await expectPixels(page, initial, '损坏PSD拖放不创建会话或改变像素')
    evidence.scenes.push({ name: '损坏PSD拖放拒绝', message: '1 个失败', type: 'info', tabs: 3 })

    // 6、无 path 的真实 PSD 字节必须经过 saveDraggedFile，检查隔离目录实际落盘字节。
    const draggedName = '拖放人物 中文.psd'
    const bytes = await readFile(fixtures[1].absolutePath)
    const dropped = await dropBytes(page, bytes, draggedName)
    assert.deepEqual(dropped, { hadPath: false, prevented: true, size: bytes.length })
    names.push(draggedName)
    await expectResult(page, '成功加载 1 个', 'success', names, names[0])
    const savedPath = path.join(desktop.root, 'temp/momentum-stickfigure/dragged-files', draggedName)
    assert.ok((await readFile(savedPath)).equals(bytes), '真实保存的 PSD 字节必须与拖入输入完全一致')
    const writes = await application.evaluate(() => globalThis.__momentumTest.writes)
    assert.ok(writes.includes(savedPath), '真实主进程必须记录拖入文件写盘')
    await expectPixels(page, initial, '拖放新增标签保留原始画布')
    await page.getByTitle(draggedName, { exact: true }).click()
    await expectPixels(page, secondCanvas, '无路径拖放和按钮导入的相同输入一致')
    await expectPixels(page, references[1], '无路径拖放对应只读原版参考')
    evidence.scenes.push({ name: '合成拖入及拖离', highlight: [true, false] }, { name: '无路径 File 合成 drop', message: '成功加载 1 个', type: 'success', tabs: 4, bytesEqual: true, savedByProductionIpc: true })

    // 7、非 PSD 拖放必须拒绝，不保存文件、不增加标签，也不改变当前画布。
    await page.waitForFunction(() => document.querySelectorAll('.n-message').length === 0)
    await area.dispatchEvent('dragover', { bubbles: true, cancelable: true })
    await dropBytes(page, Buffer.from('公开的非 PSD 拖放输入'), '不应保存.txt')
    await expectResult(page, '请拖放PSD文件', 'warning', names, draggedName)
    assert.equal(await area.evaluate((node) => node.classList.contains('drag-over')), false)
    await assert.rejects(stat(path.join(desktop.root, 'temp/momentum-stickfigure/dragged-files/不应保存.txt')), { code: 'ENOENT' })
    await expectPixels(page, secondCanvas, '非 PSD 拖放不改变当前会话')
    evidence.scenes.push({ name: '非 PSD 拖放拒绝', message: '请拖放PSD文件', type: 'warning', tabs: 4, noSavedFile: true })
    assert.deepEqual(desktop.errors, [], '页面不能产生未捕获异常')
    evidence.loadingMessagesRemaining = await page.locator('.n-message--loading-type').count()
    assert.equal(evidence.loadingMessagesRemaining, 0)
    evidence.passed = true
  } finally {
    await writeFile(path.join(desktop.root, 'upload-result.json'), JSON.stringify(evidence, null, 2))
    await desktop.close()
    for (const fixture of fixtures) await verifyFixture(fixture.absolutePath, fixture.sha256)
  }
})
