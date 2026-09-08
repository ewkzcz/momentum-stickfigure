/** 人物页业务场景：通过页面操作重放导入、选择、预设、预览及实际 PNG 导出。 */
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { stableCanvas, observeImages, assertSamePixels } from '../helpers/images.mjs'

/** 读取用户可见的图层、标签和部件选择，避免绑定组件私有状态。 */
async function visibleState(page) {
  // 1、记录名称、顺序、层级和显隐，不记录运行时随机 ID。
  return page.evaluate(() => ({
    layers: [...document.querySelectorAll('.layer-item')].map((node) => ({
      name: node.querySelector('.layer-name').textContent.trim(),
      group: node.classList.contains('is-group'),
      depth: node.style.paddingLeft,
      visible: node.querySelector('input').checked
    })),
    tabs: [...document.querySelectorAll('.part-tab')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active') })),
    selectedParts: [...document.querySelectorAll('.parts-virtual-items .part-item.active .part-name')].map((node) => node.textContent.trim())
  }))
}

/** 触发真实页面拖出链路，仅在操作系统接收文件的位置截取结果。 */
async function exportByDrag(desktop) {
  // 1、模拟持续越界指针事件，让原业务完成裁边、命名与主进程落盘。
  const { page, application } = desktop
  const count = await application.evaluate(() => globalThis.__momentumTest.drags.length)
  const bounds = await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getBounds())
  await page.locator('.render-canvas').dispatchEvent('mousedown', { button: 0, buttons: 1, clientX: 100, clientY: 100 })
  await page.evaluate((windowBounds) => {
    window.__regressionDragFrame = null
    const move = () => {
      document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, buttons: 1, clientX: 500, clientY: 500, screenX: windowBounds.x + windowBounds.width + 200, screenY: windowBounds.y + 100 }))
      window.__regressionDragFrame = requestAnimationFrame(move)
    }
    move()
  }, bounds)
  let result
  try {
    // 2、等待实际 startDrag 边界产生文件记录，使用有界条件轮询。
    const handle = await application.evaluateHandle(() => globalThis.__momentumTest)
    const startedAt = Date.now()
    while (Date.now() - startedAt < 30000) {
      result = await handle.evaluate((state, index) => state.drags[index], count)
      if (result) break
      await page.evaluate(() => new Promise(requestAnimationFrame))
    }
    await handle.dispose()
    assert.ok(result?.file, '真实拖出未产生 PNG 文件')
    assert.ok(path.relative(desktop.root, result.file) && !path.relative(desktop.root, result.file).startsWith('..'), '导出文件越过隔离目录')
    return await readFile(result.file)
  } finally {
    await page.evaluate(() => {
      cancelAnimationFrame(window.__regressionDragFrame)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
  }
}

/** 为单份素材运行固定业务操作，回调负责记录或比较参考图。 */
export async function runPsdScenario(desktop, fixture, snapshot) {
  const { page, application } = desktop
  // 1、使用真实文件对话框调用入口上传，等待业务完成与画布稳定。
  await page.evaluate(() => { location.hash = '/action-expression' })
  await page.getByRole('button', { name: '上传', exact: true }).waitFor()
  await observeImages(page)
  await application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
  await page.getByRole('button', { name: '上传', exact: true }).click()
  await page.locator('.psd-tab-name').and(page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor({ timeout: 60000 })
  await stableCanvas(page)
  await page.getByRole('button', { name: '图层', exact: true }).click()
  let previousLayerCount = -1
  for (let depth = 0; depth < 100; depth++) {
    await page.getByRole('button', { name: '展开', exact: true }).click()
    await page.evaluate(() => new Promise(requestAnimationFrame))
    const count = await page.locator('.layer-item').count()
    if (count === previousLayerCount) break
    previousLayerCount = count
    assert.ok(depth < 99, '图层递归展开未在上限内完成')
  }
  const initial = await stableCanvas(page)
  assert.ok((await visibleState(page)).layers.length > 0, '未显示实际图层树')
  await snapshot('initial', initial, await visibleState(page))

  // 2、逐组切换显隐并恢复；参考记录原版真实结果，不假定恢复算法与其他软件一致。
  const groups = page.locator('.layer-item.is-group')
  const groupCount = await groups.count()
  assert.ok(groupCount > 0, '指定素材未提供可验证分组')
  for (let index = 0; index < groupCount; index++) {
    const checkbox = groups.nth(index).locator('input[type=checkbox]')
    const checked = await checkbox.isChecked()
    await checkbox.setChecked(!checked)
    await snapshot(`group-${index}-toggle`, await stableCanvas(page, '.render-canvas', false), await visibleState(page))
    await checkbox.setChecked(checked)
    await snapshot(`group-${index}-restore`, await stableCanvas(page, '.render-canvas', false), await visibleState(page))
  }

  // 3、选择可见的未选部件，再保存画布快照预设并验证恢复。
  await page.getByTitle('点击折叠/展开', { exact: true }).click()
  const part = page.locator('.parts-virtual-items .part-item:not(.active)').first()
  const selectedName = await part.locator('.part-name').innerText()
  await part.click()
  await snapshot('part-selected', await stableCanvas(page), { ...(await visibleState(page)), selectedName })
  await page.getByTitle('添加当前画布为预设', { exact: true }).click()
  await page.locator('.part-tab').filter({ hasText: /^预设$/ }).click()
  const preset = page.locator('.preset-item').last()
  await preset.waitFor()
  await preset.click()
  const presetImage = await stableCanvas(page)
  await snapshot('preset-restored', presetImage, await visibleState(page))

  // 4、缩放仅影响显示比例，原始画布像素必须保持一致。
  const styleBefore = await page.locator('.render-canvas').getAttribute('style')
  await page.locator('.render-canvas').dispatchEvent('wheel', { deltaY: -120, bubbles: true })
  await page.waitForFunction((previous) => document.querySelector('.render-canvas').getAttribute('style') !== previous, styleBefore)
  const zoomed = await stableCanvas(page)
  await assertSamePixels(Buffer.from(zoomed.png, 'base64'), Buffer.from(presetImage.png, 'base64'), '缩放前后画布')
  await snapshot('zoomed', zoomed, await visibleState(page))

  // 5、通过原创建入口打开独立预览，读取预览实际画布；关闭后继续导出。
  const newWindow = application.waitForEvent('window')
  await page.getByRole('button', { name: '预览', exact: true }).click()
  const preview = await newWindow
  await preview.locator('.canvas-wrapper canvas').waitFor()
  const previewImage = await stableCanvas(preview, '.canvas-wrapper canvas')
  await snapshot('preview', previewImage, {})
  await preview.getByRole('button', { name: '关闭', exact: true }).click()
  // 后台测试只通过已连接的渲染器发送输入，不激活原生窗口。
  const exported = await exportByDrag(desktop)
  await snapshot('export', { png: exported.toString('base64') }, {})
  assert.deepEqual(desktop.errors, [], '页面产生未捕获运行错误')
}
