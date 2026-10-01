/** 对话画布交互回归：真实鼠标命中、平移、手柄缩放旋转、删除与重新加载。 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng, observeImages, stableCanvas } from './helpers/images.mjs'

/** 生成透明外缘、不对称颜色及中心实心的自制素材；1、直接输出可公开重建的PNG。 */
function fixture(frame) {
  const canvas = createCanvas(400, 240)
  const context = canvas.getContext('2d')
  context.fillStyle = frame ? '#fafafa' : '#963f73'
  context.fillRect(30, 20, 340, 200)
  context.fillStyle = frame ? '#1976a3' : '#eec046'
  context.fillRect(30, 20, 35, 80)
  return canvas.toBuffer('image/png')
}

/** 等待原图像及帧任务稳定；1、保留选框并返回原画布PNG。 */
async function image(page) {
  return Buffer.from((await stableCanvas(page, '.dialog-frame-canvas .main-canvas')).png, 'base64')
}

/** 转换指定画布比例位置到真实CSS坐标；1、只读取用户可见画布边界。 */
async function point(page, x, y) {
  const bounds = await page.locator('.dialog-frame-canvas .main-canvas').boundingBox()
  return { x: bounds.x + bounds.width * x, y: bounds.y + bounds.height * y }
}

/** 用真实鼠标拖拽；1、按下后等待原异步命中完成；2、移动并松开后等待原重绘。 */
async function drag(page, start, end) {
  await page.mouse.move(start.x, start.y)
  await image(page)
  await page.mouse.down()
  await image(page)
  await page.mouse.move(end.x, end.y, { steps: 1 })
  await image(page)
  await page.mouse.up()
  return image(page)
}

test('对话画布交互：像素命中、平移及双对象手柄变换保持一致', { timeout: 240000 }, async () => {
  // 1、仅使用隔离生产桌面与公开素材，迁移前必须保留干净源码基线。
  const desktop = await launchDesktop()
  const { page, root } = desktop
  const beforeRoot = process.env.MOMENTUM_DIALOG_INTERACTION_BEFORE
  const evidence = {
    head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--porcelain', '--', 'src/renderer/src/components/pages/DialogFramePage'], { cwd: repository, encoding: 'utf8' }),
    scenes: [], passed: false
  }
  let stage = 'startup'
  console.log(`对话画布交互证据：${root}`)
  try {
    const before = beforeRoot ? JSON.parse(await readFile(path.join(beforeRoot, 'dialog-interaction-result.json'), 'utf8')) : null
    if (before) {
      assert.equal(before.passed, true)
      assert.equal(before.sourceStatus, '')
    }
    await observeImages(page)
    await page.evaluate(() => { location.hash = '/dialog-frame' })
    await page.locator('.dialog-frame-canvas .main-canvas').waitFor()
    const inputs = page.locator('.dialog-frame-manager input[type=file]')
    await inputs.nth(0).setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: fixture(true) })
    await page.locator('.frame-preview').waitFor()
    await image(page)
    await inputs.nth(1).setInputFiles({ name: 'character.png', mimeType: 'image/png', buffer: fixture(false) })
    await page.locator('.character-item.active').waitFor()
    await image(page)
    const toolbar = page.locator('.canvas-toolbar')

    /** 保存实际画布及选中对象；1、前后比较全部RGBA；2、仅记录可观察状态。 */
    async function scene(name, png = null) {
      stage = name
      png ||= await image(page)
      const rgba = (await decodePng(png)).rgba
      const state = await page.evaluate(() => ({
        frame: document.querySelector('.frame-preview')?.classList.contains('active') || false,
        characters: [...document.querySelectorAll('.character-item')].map(node => node.classList.contains('active')),
        cursor: document.querySelector('.main-canvas').style.cursor
      }))
      const record = { name, state, rgbaSha256: createHash('sha256').update(rgba).digest('hex') }
      evidence.scenes.push(record)
      await writeFile(path.join(root, `${name}.png`), png, { flag: 'wx' })
      if (before) await assertSamePixels(png, await readFile(path.join(beforeRoot, `${name}.png`)), name)
      return record.rgbaSha256
    }

    // 2、选框缩到画布内，以真实指针分别操作人物和对话框。
    for (const target of ['character', 'frame']) {
      stage = target
      await page.locator(target === 'frame' ? '.frame-preview' : '.character-item').click()
      await toolbar.getByRole('button', { name: '重置', exact: true }).click()
      for (let count = 0; count < 3; count++) await toolbar.getByTitle('缩小', { exact: true }).click()
      const initial = await scene(`${target}-scaled`)
      // 人物素材为5:3，contain后宽1800；框素材处理后宽高以实际缩略图尺寸计算。
      const geometry = await page.locator(target === 'frame' ? '.frame-preview img' : '.character-item img').evaluate(img => ({ width: img.naturalWidth, height: img.naturalHeight }))
      const ratio = Math.min(1920 / geometry.width, 1080 / geometry.height)
      const halfWidth = geometry.width * ratio * 0.7 / 1920 / 2
      const halfHeight = geometry.height * ratio * 0.7 / 1080 / 2
      const start = await point(page, 0.5 + halfWidth, 0.5 + halfHeight)
      const end = await point(page, 0.5 + halfWidth * 0.85, 0.5 + halfHeight * 0.85)
      const corner = await scene(`${target}-corner`, await drag(page, start, end))
      assert.notEqual(corner, initial, '角手柄真实改变画布')
      await toolbar.getByRole('button', { name: '重置', exact: true }).click()
      for (let count = 0; count < 3; count++) await toolbar.getByTitle('缩小', { exact: true }).click()
      await image(page)
      const canvasBounds = await page.locator('.main-canvas').boundingBox()
      const top = await point(page, 0.5, 0.5 - halfHeight)
      const rotationStart = { x: top.x, y: top.y - 32 }
      const rotationEnd = { x: rotationStart.x + 28, y: rotationStart.y + 8 }
      const rotated = await scene(`${target}-rotated`, await drag(page, rotationStart, rotationEnd))
      assert.notEqual(rotated, initial, '旋转手柄真实改变画布')
      assert.ok(rotationStart.y > canvasBounds.y, '旋转操作始终位于应用画布内')
      await toolbar.getByRole('button', { name: '重置', exact: true }).click()
      await image(page)
    }
    // 3、中心有真实人物像素，平移必须选中人物并改变最终图像。
    await page.locator('.frame-preview').click()
    const beforeMove = await scene('before-pixel-hit')
    const center = await point(page, 0.5, 0.5)
    const moved = await scene('character-translated', await drag(page, center, { x: center.x + 30, y: center.y + 20 }))
    assert.notEqual(moved, beforeMove)
    assert.equal(await page.locator('.character-item.active').count(), 1)
    await page.locator('.character-item .btn-delete').click()
    await page.waitForFunction(() => !document.querySelector('.character-item'))
    await scene('character-deleted')
    // 4、重新加载真实页面，验证旧素材不从已销毁实例串入新画布。
    await page.reload()
    await page.locator('.dialog-frame-canvas .main-canvas').waitFor()
    assert.equal(await page.locator('.character-item').count(), 0)
    assert.equal(await page.locator('.frame-preview').count(), 0)
    await scene('reloaded-empty')
    assert.deepEqual(desktop.errors, [])
    if (before) {
      assert.deepEqual(evidence.scenes, before.scenes)
      evidence.beforeDesktopId = path.basename(beforeRoot)
      evidence.differentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { stage, message: error.message }
    await page.screenshot({ path: path.join(root, 'interaction-failure.png') }).catch(() => {})
    throw error
  } finally {
    try { await desktop.close() } catch (error) {
      evidence.passed = false
      evidence.cleanupFailure = error.message
      throw error
    } finally {
      await writeFile(path.join(root, 'dialog-interaction-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
