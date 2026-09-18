/** 媒体授权基线：真实页面和文件服务；拖放事件及原生选择边界受控，不代表真实OS验收。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { pngFixture } from './helpers/png-media-fixtures.mjs'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')
function png(color) {
  const canvas = createCanvas(9, 7)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(1, 2, 6, 4)
  return canvas.toBuffer('image/png')
}

async function snapshot(desktop) {
  return {
    url: desktop.page.url(),
    dialogs: await desktop.application.evaluate(() => globalThis.__localMediaDialogs),
    cards: await desktop.page.locator('.input-section .media-card').evaluateAll(cards => cards.map(card => {
      const image = card.querySelector('img')
      return { name: card.querySelector('.media-name')?.textContent.trim(), src: image?.getAttribute('src'), width: image?.naturalWidth, height: image?.naturalHeight }
    }))
  }
}

async function withDesktop(name, run) {
  const desktop = await launchDesktop()
  const child = desktop.application.process()
  const exited = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })))
  const evidence = { scenario: name, passed: false, scope: '真实业务入口；DOM拖放事件注入、bootstrap原生选择替身；未验证真实OS/Python或完整媒体能力生命周期' }
  try {
    // 只观察现有bootstrap的对话框替身，不替换业务IPC、不授予能力、不伪造成功结果。
    await desktop.application.evaluate(({ dialog }) => {
      globalThis.__localMediaDialogs = []
      const original = dialog.showOpenDialog.bind(dialog)
      dialog.showOpenDialog = async (window, options) => {
        const result = await original(window, options)
        globalThis.__localMediaDialogs.push({ ownerId: window?.id ?? null, ownerUrl: window?.webContents?.getURL() ?? null, options, result })
        return result
      }
    })
    const selected = path.join(desktop.root, '实际选择 中文 空格.png')
    const claimed = path.join(desktop.root, 'URI声称的未选择图片.png')
    const selectedBytes = png('#347ac1'), claimedBytes = png('#e66342')
    await writeFile(selected, selectedBytes)
    await writeFile(claimed, claimedBytes)
    evidence.fixtures = { selected: { path: selected, sha256: hash(selectedBytes) }, claimed: { path: claimed, sha256: hash(claimedBytes) } }
    await desktop.page.evaluate(() => { location.hash = '/image-processing' })
    await desktop.page.locator('.image-processing-page .input-section .media-gallery').waitFor()
    await run({ desktop, evidence, selected, claimed, selectedBytes, claimedBytes })
    assert.deepEqual(desktop.errors, [])
    evidence.passed = true
  } catch (error) {
    evidence.failure = { name: error.name, message: error.message }
    throw error
  } finally {
    try {
      evidence.observed = await snapshot(desktop)
    } catch (error) {
      evidence.snapshotFailure = error.message
    }
    try { await desktop.close() }
    catch (error) {
      evidence.passed = false
      evidence.closeFailure = error.message
      throw error
    } finally {
      evidence.exit = { code: child.exitCode, signal: child.signalCode }
      try {
        // close可能在隔离检查前失败；该分支保留失败证据，不能等待一个仍存活的进程。
        if (!evidence.closeFailure) {
          evidence.exit = await exited
          assert.deepEqual(evidence.exit, { code: 0, signal: null }, '必须正常退出，不能忽略原生析构崩溃')
        }
      } catch (error) {
        evidence.passed = false
        evidence.exitFailure = error.message
        throw error
      } finally {
        await writeFile(path.join(desktop.root, 'local-media-authorization.json'), JSON.stringify(evidence, null, 2))
        console.log(`媒体授权基线证据：${desktop.root}`)
      }
    }
  }
}

async function drop(page, payload) {
  await page.locator('.input-section .media-gallery').evaluate((target, payload) => {
    const transfer = new window.DataTransfer()
    if (payload.bytes) transfer.items.add(new File([new Uint8Array(payload.bytes)], payload.name, { type: 'image/png' }))
    else transfer.setData('text/uri-list', payload.uri)
    target.dispatchEvent(new window.DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  }, payload)
}

async function settleDrop(desktop) {
  // 等待业务产生可观察结果：原生选择调用或输入卡片，而不是固定sleep猜测完成。
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    const state = await snapshot(desktop)
    if (state.dialogs.length || state.cards.length) return state
    await pollDelay(25)
  }
  assert.fail('拖放未产生原生选择调用或输入结果')
}

const preview = (page, file) => page.evaluate(file => window.hdToolkit.getImagePreview(file), file)

test('媒体导入：真实File字节由原临时图片服务保存，中文空格名称和像素尺寸保留', { timeout: 60000 }, () => withDesktop('file-bytes', async ({ desktop, evidence, selectedBytes }) => {
  const name = '拖放 中文 空格.png'
  await drop(desktop.page, { bytes: [...selectedBytes], name })
  await desktop.page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.input-section .media-card img')]
    return images.length === 1 && images[0].complete && images[0].naturalWidth > 0
  })
  const actual = await readFile(path.join(desktop.root, 'temp/momentum-stickfigure-paste', name))
  evidence.savedSha256 = hash(actual)
  assert.deepEqual(actual, selectedBytes, '临时导入必须保留真实File原字节')
  const state = await snapshot(desktop)
  assert.deepEqual(state.dialogs, [], '有File字节时不应要求重复选择')
  assert.equal(state.cards.length, 1)
  assert.equal(state.cards[0].name, name)
  assert.deepEqual([state.cards[0].width, state.cards[0].height], [9, 7])
}))

test('媒体授权：未选择的精确图片路径不能通过现有预览IPC获得内容', { timeout: 60000 }, () => withDesktop('unselected-read', async ({ desktop, evidence, claimed }) => {
  const result = await preview(desktop.page, claimed)
  evidence.unselectedPreview = result
  assert.equal(result.success, false, '仅来源可信和路径存在不能授予未选择文件的读取能力')
  assert.equal(result.data?.dataUrl, undefined)
}))

test('媒体生产解码：三格式截断及无效PNG流拒绝，原生选择和预览随后恢复', { timeout: 60000 }, () => withDesktop('decode-recovery', async ({ desktop, evidence }) => {
  evidence.decodeRecovery = []
  evidence.decoder = await desktop.application.evaluate((_, repository) => new Promise((resolve, reject) => setImmediate(() => {
    try {
      const path = process.getBuiltinModule('path')
      const req = process.getBuiltinModule('module').createRequire(path.join(repository, 'package.json'))
      const entry = req.resolve('@momentum/media-canvas')
      const oldEntry = req.resolve('@napi-rs/canvas')
      const loaded = !!req.cache[entry], oldLoaded = !!req.cache[oldEntry]
      const nativePaths = Object.keys(req.cache).filter(file => file.endsWith('.node'))
      // 只检查生产导入缓存；不由诊断require解码器，避免旧构建被测试补加载而误通过。
      resolve({ entry, oldEntry, loaded, oldLoaded, nativePaths, version: req('@momentum/media-canvas/package.json').version, oldVersion: req('@napi-rs/canvas/package.json').version, electron: process.versions.electron, node: process.versions.node })
    } catch (error) { reject(error) }
  })), repository)
  assert.equal(evidence.decoder.loaded, true, '实际构建必须已经导入媒体alias')
  // PSD旧库按需导入；版本/路径必须保留，不要求打开PSD前已进入模块缓存。
  assert.equal(evidence.decoder.version, '1.0.5')
  assert.equal(evidence.decoder.oldVersion, '0.1.83')
  assert.notEqual(evidence.decoder.entry, evidence.decoder.oldEntry)
  const canvas = createCanvas(8, 6)
  canvas.getContext('2d').fillRect(0, 0, 8, 6)
  for (const format of ['png', 'jpeg', 'webp']) {
    const bytes = canvas.toBuffer(`image/${format}`)
    const truncated = bytes.subarray(0, format === 'jpeg' ? bytes.indexOf(Buffer.from([255, 218])) : 30)
    const cases = [['truncated', truncated]]
    if (format === 'png') cases.push(['invalid-zlib', pngFixture({ payload: Buffer.from([0, 0, 0, 0]) })])
    for (const [kind, invalid] of cases) {
      const file = path.join(desktop.root, `${format}-${kind}.${format}`)
      await writeFile(file, invalid)
      await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
      const selection = await desktop.page.evaluate(() => window.fileSystem.selectFile({}))
      const denied = await preview(desktop.page, file)
      evidence.decodeRecovery.push({ format, kind, sha256: hash(invalid), selection, denied })
      assert.equal(selection.success, false)
      assert.equal(denied.success, false)
      assert.equal(denied.data?.dataUrl, undefined)
    }
    const file = path.join(desktop.root, `恢复正常.${format}`)
    await writeFile(file, bytes)
    await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
    const selection = await desktop.page.evaluate(() => window.fileSystem.selectFile({}))
    assert.equal(selection.success, true)
    assert.equal(selection.path, file)
    const accepted = await preview(desktop.page, file)
    assert.equal(accepted.success, true)
    assert.deepEqual(Buffer.from(accepted.data.dataUrl.split(',')[1], 'base64'), bytes)
    const dimensions = await desktop.page.evaluate(dataUrl => new Promise((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight])
      image.onerror = () => reject(new Error('正常图片预览无法加载'))
      image.src = dataUrl
    }), accepted.data.dataUrl)
    assert.deepEqual(dimensions, [8, 6])
    evidence.decodeRecovery.push({ format, kind: 'valid-after-rejection', sha256: hash(bytes), dimensions })
  }
}))

for (const canceled of [true, false]) test(`纯URI媒体导入：${canceled ? '取消原生选择不导入不授权' : '仅原生返回精确文件可导入，不能信任URI声称路径'}`, { timeout: 60000 }, () => withDesktop(canceled ? 'uri-cancel' : 'uri-selected', async ({ desktop, evidence, selected, claimed, selectedBytes }) => {
  await desktop.application.evaluate((_, paths) => { globalThis.__momentumTest.openPaths = paths }, canceled ? [] : [selected])
  await drop(desktop.page, { uri: pathToFileURL(claimed).href })
  const state = await settleDrop(desktop)
  evidence.afterDrop = state
  // 先采集两种读取结果，即便当前没有触发选择也保存原业务接口的缺口。
  evidence.claimedPreview = await preview(desktop.page, claimed)
  if (!canceled) evidence.selectedPreview = await preview(desktop.page, selected)
  assert.equal(state.dialogs.length, 1, '纯URI必须通过原生选择确认，不能直接读取字符串路径')
  const ownerId = await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].id)
  assert.equal(state.dialogs[0].ownerId, ownerId, '原生选择必须绑定发起窗口')
  assert.deepEqual(state.dialogs[0].result.filePaths, canceled ? [] : [selected])
  assert.equal(state.dialogs[0].result.canceled, canceled)
  assert.equal(evidence.claimedPreview.success, false, 'URI声称但未选择的路径始终不得读取')
  assert.equal(evidence.claimedPreview.data?.dataUrl, undefined)
  if (canceled) {
    assert.deepEqual(state.cards, [], '取消不得留下输入或授予读取能力')
  } else {
    await desktop.page.waitForFunction(name => {
      const cards = [...document.querySelectorAll('.input-section .media-card')]
      return cards.length === 1 && cards[0].querySelector('.media-name')?.textContent.trim() === name && cards[0].querySelector('img')?.naturalWidth === 9
    }, path.basename(selected))
    assert.equal(evidence.selectedPreview.success, true, '实际原生选择结果仍须可预览')
    const bytes = Buffer.from(evidence.selectedPreview.data.dataUrl.split(',')[1], 'base64')
    assert.deepEqual(bytes, selectedBytes, '只能读取实际选择的精确文件内容')
  }
}))
