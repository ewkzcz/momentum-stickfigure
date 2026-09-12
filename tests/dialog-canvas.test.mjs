/** 对话画布回归：通过真实上传、变换、模式选择与磁盘导出建立零容差迁移证据。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas } from './helpers/images.mjs'

const hash = value => createHash('sha256').update(value).digest('hex')

/**
 * 创建公开可重建的非对称素材。
 * 处理流程：
 * 1、构造带白色、彩色、半透明及透明区域的对话框
 * 2、构造非对称人物以区分旋转、翻转及多人物叠加
 */
function fixture(kind) {
  // 1、所有素材均在内存中生成，不读取私人图像。
  const canvas = createCanvas(480, 320)
  const context = canvas.getContext('2d')
  if (kind === 'frame') {
    context.fillStyle = '#ffffff'
    context.fillRect(36, 90, 404, 190)
    context.fillStyle = '#18496d'
    context.fillRect(36, 90, 404, 16)
    context.fillRect(36, 90, 16, 190)
    context.fillStyle = '#da7953'
    context.fillRect(380, 106, 60, 174)
    context.clearRect(200, 230, 60, 50)
    context.fillStyle = 'rgba(70,120,180,0.5)'
    context.fillRect(70, 200, 60, 60)
  } else {
    // 2、两个不同颜色人物均保留透明外缘和半透明内部。
    context.fillStyle = kind === 'first' ? '#a83266' : '#247b65'
    context.fillRect(160, 22, 100, 110)
    context.fillRect(110, 120, 200, 130)
    context.fillRect(220, 250, 70, 64)
    context.fillStyle = '#f4b94c'
    context.fillRect(160, 36, 25, 35)
    context.fillStyle = 'rgba(35,65,200,0.4)'
    context.fillRect(260, 120, 80, 100)
  }
  return canvas.toBuffer('image/png')
}

/**
 * 读取一幅稳定的真实合成画布。
 * 处理流程：
 * 1、等待上传后的实际绘制及异步图像完成
 * 2、保留画布原始尺寸及像素
 */
async function capture(page) {
  // 1、稳定采样包含原有选框，不隐藏任何界面元素。
  return Buffer.from((await stableCanvas(page, '.dialog-frame-canvas .main-canvas')).png, 'base64')
}

test('对话画布：六种嵌入、三种渐变、双对象变换和真实 PNG 导出一致', { timeout: 360000 }, async () => {
  // 1、在新隔离桌面运行真实生产构建，保存源码与构建来源。
  const desktop = await launchDesktop()
  const { page, application, root } = desktop
  const evidence = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: repository, encoding: 'utf8' }),
    mainBuildSha256: hash(await readFile(path.join(repository, 'out/main/index.js'))),
    runtime: await application.evaluate(() => ({ versions: process.versions, platform: process.platform, arch: process.arch })),
    fixtures: {}, scenes: [], passed: false
  }
  let stage = 'startup'
  console.log(`对话画布证据：${root}`)
  const beforeRoot = process.env.MOMENTUM_DIALOG_CANVAS_BEFORE
  const before = beforeRoot ? JSON.parse(await readFile(path.join(beforeRoot, 'dialog-canvas-result.json'), 'utf8')) : null
  try {
    if (before) {
      assert.equal(before.passed, true)
      assert.equal(before.sourceStatus, '', '基线必须来自干净业务源码')
      assert.deepEqual(evidence.runtime, before.runtime)
    }
    await observeImages(page)
    await page.evaluate(() => { location.hash = '/dialog-frame' })
    await page.locator('.dialog-frame-canvas .main-canvas').waitFor()
    const inputs = page.locator('.dialog-frame-manager input[type=file]')
    for (const [index, kind] of ['frame', 'first', 'second'].entries()) {
      stage = `upload-${kind}`
      const buffer = fixture(kind)
      evidence.fixtures[kind] = hash(buffer)
      await inputs.nth(index === 0 ? 0 : 1).setInputFiles({ name: `${kind}.png`, mimeType: 'image/png', buffer })
      if (index === 0) await page.locator('.frame-preview img').waitFor()
      else await page.waitForFunction(count => document.querySelectorAll('.character-item').length === count && document.querySelectorAll('.character-item')[count - 1].classList.contains('active'), index)
      await capture(page)
    }
    if (before) assert.deepEqual(evidence.fixtures, before.fixtures)

    /**
     * 保存场景画布并通过公开按钮执行真实目录选择与写入。
     * 处理流程：
     * 1、记录稳定画布及公开界面状态
     * 2、仅控制目录选择边界，等待实际 PNG 文件写入和成功反馈
     * 3、按需与干净源码基线逐像素比较
     */
    async function scene(name) {
      // 1、每个场景使用独立目录，避免秒级文件名重复掩盖输出。
      stage = name
      const screen = await capture(page)
      const exportDirectory = path.join(root, name)
      await mkdir(exportDirectory)
      await application.evaluate((_electron, directory) => { globalThis.__momentumTest.openPaths = [directory] }, exportDirectory + path.sep)
      await page.locator('.canvas-toolbar').getByRole('button', { name: '导出', exact: true }).click()
      // 2、等待真实写入完成；不替换 renderer 桥接或文件服务。
      await page.getByText('导出成功', { exact: true }).waitFor()
      const files = (await readdir(exportDirectory)).filter(name => name.endsWith('.png'))
      assert.equal(files.length, 1, `${name} 必须生成一个真实文件`)
      const output = await readFile(path.join(exportDirectory, files[0]))
      const decoded = await decodePng(output)
      assert.equal(decoded.width, 1920)
      assert.equal(decoded.height, 1080)
      assert.ok(decoded.rgba.some((value, index) => index % 4 === 3 && value > 0))
      assert.ok(decoded.rgba.some((value, index) => index % 4 === 3 && value === 0), '导出保留透明背景')
      const state = await page.evaluate(() => ({
        mode: document.querySelector('.embed-mode-selector select').value,
        gradient: document.querySelector('.opacity-gradient-selector select')?.value ?? null,
        activeFrame: document.querySelector('.frame-preview').classList.contains('active'),
        characters: [...document.querySelectorAll('.character-item')].map(node => ({ text: node.querySelector('.character-name').textContent, active: node.classList.contains('active') }))
      }))
      await writeFile(path.join(root, `${name}-canvas.png`), screen, { flag: 'wx' })
      await writeFile(path.join(root, `${name}-export.png`), output, { flag: 'wx' })
      evidence.scenes.push({ name, state, canvasRgbaSha256: hash((await decodePng(screen)).rgba), exportRgbaSha256: hash(decoded.rgba) })
      // 3、画布与导出分别比较，不要求二者像素相同。
      if (before) {
        for (const [suffix, bytes] of [['canvas', screen], ['export', output]]) {
          await assertSamePixels(bytes, await readFile(path.join(beforeRoot, `${name}-${suffix}.png`)), `${name}-${suffix}`)
        }
      }
      await page.getByText('导出成功', { exact: true }).waitFor({ state: 'hidden' })
    }

    // 2、在真实下拉框穷举六种嵌入模式与全部渐变组合。
    for (const mode of ['direct', 'opacity', 'protrude', 'combined', 'opacity-colored', 'combined-colored']) {
      await page.locator('.embed-mode-selector select').selectOption(mode)
      const gradients = ['direct', 'protrude'].includes(mode) ? [null] : ['default', 'fast', 'early']
      for (const gradient of gradients) {
        if (gradient) await page.locator('.opacity-gradient-selector select').selectOption(gradient)
        await scene(`${mode}-${gradient || 'none'}`)
      }
    }
    // 3、分别操作人物和对话框，保留原选框、变换及重置逻辑。
    await page.locator('.embed-mode-selector select').selectOption('direct')
    for (const target of ['character', 'frame']) {
      if (target === 'frame') await page.locator('.frame-preview').click()
      else await page.locator('.character-item').first().click()
      for (const title of ['放大', '顺时针旋转', '水平翻转']) {
        await page.locator('.canvas-toolbar').getByTitle(title, { exact: true }).click()
        await capture(page)
      }
      await scene(`${target}-transformed`)
      await page.locator('.canvas-toolbar').getByRole('button', { name: '重置', exact: true }).click()
      await scene(`${target}-reset`)
    }
    assert.equal(evidence.scenes.length, 18)
    assert.deepEqual(desktop.errors, [])
    evidence.safety = await application.evaluate(() => ({ violations: globalThis.__momentumTest.violations, external: globalThis.__momentumTest.external }))
    assert.deepEqual(evidence.safety, { violations: [], external: [] })
    if (before) {
      assert.deepEqual(evidence.scenes, before.scenes)
      evidence.beforeDesktopId = path.basename(beforeRoot)
      evidence.differentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { stage, message: error.message }
    await page.screenshot({ path: path.join(root, 'dialog-canvas-failure.png') }).catch(() => {})
    throw error
  } finally {
    try { await desktop.close() } catch (error) {
      evidence.passed = false
      evidence.cleanupFailure = error.message
      throw error
    } finally {
      await writeFile(path.join(root, 'dialog-canvas-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
