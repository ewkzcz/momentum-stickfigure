/**
 * 文件选择公开接口回归：真实运行主进程选择、图片读取和临时写入业务。
 * 处理流程：
 * 1、复用后台隔离启动器，仅记录或模拟原生对话框和系统目录打开边界。
 * 2、经公开预加载接口调用业务，完整核对返回对象、选项和实际文件字节。
 * 3、恢复原生边界方法并保留隔离目录中的测试结果和诊断记录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 调用公开预加载接口。
 * 处理流程：1、按通道选取已公开的方法；2、转发参数并返回原始业务结果。
 */
async function call(desktop, channel, ...args) {
  // 1、选择接口，不直接调用主进程处理函数或替代业务结果。
  return desktop.page.evaluate(({ channel, args }) => {
    const methods = {
      'select-psd-files': window.electronAPI.selectPsdFiles,
      'select-folder': window.fileSystem.selectFolder,
      'select-file': window.fileSystem.selectFile,
      'select-image-files': window.fileSystem.selectImageFiles,
      'save-temp-image': window.fileSystem.saveTempImage,
      'open-folder': window.fileSystem.openFolder
    }
    return methods[channel] ? methods[channel](...args) : window.electronAPI.invoke(channel, ...args)
  }, { channel, args })
}

/**
 * 准备下一次原生选择结果或异常。
 * 处理流程：1、使用已有选择边界存入路径；2、设定仅本次调用使用的原生错误。
 */
async function prepare(desktop, paths = [], error = null, savePath = null) {
  // 1、只操作测试启动器已有状态和测试局部边界记录。
  await desktop.application.evaluate((_electron, { paths, error, savePath }) => {
    globalThis.__momentumTest.openPaths = paths
    globalThis.__momentumTest.savePath = savePath
    globalThis.__momentumTest.fileSelection.error = error
  }, { paths, error, savePath })
}

/**
 * 验证对话框完整选项与请求窗口绑定。
 * 处理流程：1、取出原生边界最后记录；2、完整对比选项和窗口编号。
 */
async function checkDialog(desktop, kind, options) {
  // 1、读取记录；窗口编号取实际主窗口，避免仅断言非空。
  const recorded = await desktop.application.evaluate(() => ({
    call: globalThis.__momentumTest.fileSelection.dialogs.at(-1),
    windowId: globalThis.__momentumBackgroundElectron.BrowserWindow.getAllWindows()[0].id
  }))
  assert.deepEqual(recorded.call, { kind, windowId: recorded.windowId, options })
}

/**
 * 执行文件选择完整回归。
 * 处理流程：1、安装原生边界记录；2、验证各选择分支；3、验证真实磁盘读写与系统返回；4、恢复并保存结果。
 */
test('文件选择：完整返回、选项透传、真实图片与临时落盘、系统错误', { timeout: 60000 }, async () => {
  // 1、启动真实构建产物，所有窗口与文件写入由已有辅助方法隔离。
  const desktop = await launchDesktop()
  const { root, application } = desktop
  console.log(`file-selection results: ${root}`)
  const results = []
  let installed = false
  try {
    await application.evaluate(() => {
      const { dialog, shell } = globalThis.__momentumBackgroundElectron
      const state = globalThis.__momentumTest
      const boundary = state.fileSelection = {
        originals: { open: dialog.showOpenDialog, save: dialog.showSaveDialog, shell: shell.openPath },
        dialogs: [], shellPaths: [], error: null, shellResult: '', shellError: null
      }
      /** 记录原生打开对话框；处理流程：1、记录选项；2、抛出指定原生错误或调用已有模拟边界。 */
      dialog.showOpenDialog = async (window, options) => {
        boundary.dialogs.push({ kind: 'open', windowId: window.id, options })
        if (boundary.error) throw new Error(boundary.error)
        return boundary.originals.open(window, options)
      }
      /** 记录原生保存对话框；处理流程：1、记录选项；2、抛出指定原生错误或调用已有模拟边界。 */
      dialog.showSaveDialog = async (window, options) => {
        boundary.dialogs.push({ kind: 'save', windowId: window.id, options })
        if (boundary.error) throw new Error(boundary.error)
        return boundary.originals.save(window, options)
      }
      /** 模拟原生目录打开；处理流程：1、记录路径；2、返回或抛出系统结果，绝不打开目录。 */
      shell.openPath = async (folderPath) => {
        boundary.shellPaths.push(folderPath)
        if (boundary.shellError) throw new Error(boundary.shellError)
        return boundary.shellResult
      }
    })
    installed = true
    const folder = path.join(root, '中文 空格')
    await mkdir(folder, { recursive: true })
    const paths = [path.join(folder, '第一份.psd'), path.join(folder, '第二份.psd')]
    const encodedImages = await desktop.page.evaluate(() => {
      // 1、用真实画布编码有效 PNG 和 JPEG 测试图片。
      const canvas = document.createElement('canvas')
      canvas.width = 2
      canvas.height = 2
      canvas.getContext('2d').fillRect(0, 0, 2, 2)
      return ['image/png', 'image/jpeg'].map(type => canvas.toDataURL(type).split(',')[1])
    })
    const png = Buffer.from(encodedImages[0], 'base64')
    const jpeg = encodedImages[1]
    assert.ok(jpeg.length > 0)
    const imagePaths = [path.join(folder, '图 片.PNG'), path.join(folder, '相 片.JPEG'), path.join(folder, '另 一张.jpg')]
    const imageBytes = [png, Buffer.from(jpeg, 'base64'), Buffer.from(jpeg, 'base64')]
    for (let i = 0; i < imagePaths.length; i++) await writeFile(imagePaths[i], imageBytes[i])

    // 2、PSD 和目录选择均覆盖成功、取消、原生异常，并完整核对默认选项。
    await prepare(desktop, paths)
    assert.deepEqual(await call(desktop, 'select-psd-files'), { success: true, filePaths: paths, canceled: false })
    await checkDialog(desktop, 'open', { properties: ['openFile', 'multiSelections'], title: '选择PSD文件', filters: [{ name: 'PSD文件', extensions: ['psd'] }, { name: '所有文件', extensions: ['*'] }] })
    await prepare(desktop, [folder, root])
    assert.deepEqual(await call(desktop, 'select-folder'), { success: true, path: folder, canceled: false })
    await checkDialog(desktop, 'open', { properties: ['openDirectory'], title: '选择项目根路径', message: '请选择用于存储项目文件的根目录' })
    const cancel = {
      'select-psd-files': { success: false, canceled: true, filePaths: [] },
      'select-folder': { success: false, canceled: true },
      'select-file': { success: false, canceled: true, paths: [] },
      'show-save-dialog': { success: false, canceled: true },
      'select-image-files': { success: false, canceled: true }
    }
    for (const [channel, expected] of Object.entries(cancel)) {
      await prepare(desktop)
      assert.deepEqual(await call(desktop, channel), expected)
      await prepare(desktop, [], '原生对话框异常')
      const error = channel === 'select-psd-files'
        ? { success: false, error: '原生对话框异常', filePaths: [] }
        : { success: false, error: '原生对话框异常', canceled: false, ...(channel === 'select-file' ? { paths: [] } : {}) }
      assert.deepEqual(await call(desktop, channel), error)
    }

    // 3、通用文件和保存位置覆盖多选、单选、默认选项、筛选类型处理及完整透传。
    const options = { title: '中文 标题', defaultPath: folder, filters: [{ name: '资料', extensions: ['txt', 'psd'] }], message: '请选择 文件' }
    for (const multiple of [false, true]) {
      await prepare(desktop, paths)
      assert.deepEqual(await call(desktop, 'select-file', { ...options, multiple }), { success: true, canceled: false, paths, path: multiple ? null : paths[0] })
      await checkDialog(desktop, 'open', { properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'], ...options })
    }
    for (const input of [undefined, { title: '', filters: '错误类型' }]) {
      await prepare(desktop, [paths[0]])
      assert.deepEqual(await call(desktop, 'select-file', input), { success: true, canceled: false, paths: [paths[0]], path: paths[0] })
      await checkDialog(desktop, 'open', { properties: ['openFile'], title: '选择文件', defaultPath: undefined, filters: undefined, message: undefined })
      await prepare(desktop, [], null, paths[0])
      assert.deepEqual(await call(desktop, 'show-save-dialog', input), { success: true, canceled: false, filePath: paths[0] })
      await checkDialog(desktop, 'save', { title: '保存文件', defaultPath: undefined, filters: undefined, message: undefined })
    }
    await prepare(desktop, [], null, paths[1])
    assert.deepEqual(await call(desktop, 'show-save-dialog', options), { success: true, canceled: false, filePath: paths[1] })
    await checkDialog(desktop, 'save', options)
    await assert.rejects(stat(paths[1]), { code: 'ENOENT' })

    // 4、图片元数据和预览来自真实文件读取，覆盖扩展名大小写、缺失文件和局部预览失败。
    await prepare(desktop, imagePaths)
    const images = await call(desktop, 'select-image-files')
    assert.deepEqual(images, { success: true, canceled: false, files: imagePaths.map((filePath, i) => ({ path: filePath, name: path.basename(filePath), size: imageBytes[i].length, previewUrl: `data:image/${i === 0 ? 'png' : 'jpeg'};base64,${imageBytes[i].toString('base64')}` })) })
    await checkDialog(desktop, 'open', { properties: ['openFile', 'multiSelections'], title: '选择图片文件', filters: [{ name: '图片', extensions: ['jpg', 'jpeg', 'png'] }] })
    await prepare(desktop, [paths[0]])
    assert.deepEqual(await call(desktop, 'select-image-files'), { success: false, error: `ENOENT: no such file or directory, stat '${paths[0]}'`, canceled: false })
    await prepare(desktop, [folder])
    assert.deepEqual(await call(desktop, 'select-image-files'), { success: true, canceled: false, files: [{ path: folder, name: path.basename(folder), size: (await stat(folder)).size, previewUrl: null }] })
    results.push({ images })

    // 5、临时目录实际创建并保存完整图片字节，包含中文空格、覆盖、默认名称、空值和真实目录错误。
    const tempDir = path.join(root, 'temp', 'momentum-stickfigure-paste')
    const tempPath = path.join(tempDir, '中文 空格.png')
    for (const bytes of [png, imageBytes[1]]) {
      assert.deepEqual(await call(desktop, 'save-temp-image', bytes.toString('base64'), '中文 空格.png'), { success: true, path: tempPath })
      assert.deepEqual(await readFile(tempPath), bytes)
    }
    const defaultSaved = await call(desktop, 'save-temp-image', png.toString('base64'))
    assert.equal(typeof defaultSaved.path, 'string')
    assert.match(path.basename(defaultSaved.path), /^pasted_\d+\.png$/)
    assert.equal(path.dirname(defaultSaved.path), tempDir)
    assert.deepEqual(defaultSaved, { success: true, path: defaultSaved.path })
    assert.deepEqual(await readFile(defaultSaved.path), png)
    for (const empty of [undefined, null, '']) assert.deepEqual(await call(desktop, 'save-temp-image', empty), { success: false, error: '图片数据为空' })
    const blocked = path.join(tempDir, '父目录是文件')
    await writeFile(blocked, '占位 内容')
    const badPath = path.join(blocked, '子.png')
    assert.deepEqual(await call(desktop, 'save-temp-image', png.toString('base64'), '父目录是文件/子.png'), { success: false, error: `ENOTDIR: not a directory, open '${badPath}'` })
    assert.equal(await readFile(blocked, 'utf8'), '占位 内容')
    await assert.rejects(stat(badPath), { code: 'ENOTDIR' })
    results.push({ tempPath, defaultSaved })

    // 6、系统目录打开仅模拟原生 shell，不执行真实打开；空路径必须不抵达原生边界。
    for (const empty of [undefined, null, '']) assert.deepEqual(await call(desktop, 'open-folder', empty), { success: false, error: '文件夹路径为空' })
    assert.deepEqual(await application.evaluate(() => globalThis.__momentumTest.fileSelection.shellPaths), [])
    assert.deepEqual(await call(desktop, 'open-folder', folder), { success: true })
    await application.evaluate(() => { globalThis.__momentumTest.fileSelection.shellResult = '系统返回错误' })
    assert.deepEqual(await call(desktop, 'open-folder', folder), { success: false, error: '系统返回错误' })
    await application.evaluate(() => { globalThis.__momentumTest.fileSelection.shellError = '系统抛出异常' })
    assert.deepEqual(await call(desktop, 'open-folder', folder), { success: false, error: '系统抛出异常' })
    assert.deepEqual(await application.evaluate(() => globalThis.__momentumTest.fileSelection.shellPaths), [folder, folder, folder])
    assert.deepEqual(desktop.errors, [])
    results.push(await application.evaluate(() => ({ dialogs: globalThis.__momentumTest.fileSelection.dialogs, shellPaths: globalThis.__momentumTest.fileSelection.shellPaths })))
    await writeFile(path.join(root, 'file-selection-results.json'), JSON.stringify({ passed: true, results }, null, 2))
  } finally {
    // 7、恢复启动器的边界方法，保留诊断目录供基线与迁移后独立核验。
    try {
      if (installed) await application.evaluate(() => {
        const { dialog, shell } = globalThis.__momentumBackgroundElectron
        const boundary = globalThis.__momentumTest.fileSelection
        dialog.showOpenDialog = boundary.originals.open
        dialog.showSaveDialog = boundary.originals.save
        shell.openPath = boundary.originals.shell
        delete globalThis.__momentumTest.fileSelection
      })
    } finally { await desktop.close() }
  }
})
