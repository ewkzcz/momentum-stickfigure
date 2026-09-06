/** PSD 标签栏行为回归：通过真实多文件导入检查滚动、切换和关闭的会话边界。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { copyFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { stableCanvas, observeImages, assertSamePixels } from './helpers/images.mjs'

test('PSD 标签栏：横向滚动、切换及关闭保持会话一致', { timeout: 120000 }, async () => {
  // 1、公开输入复制到本次隔离目录的中文空格路径，实际应用批量读取全部文件。
  const fixture = (await syntheticFixtures())[0]
  const desktop = await launchDesktop()
  console.log(`PSD标签回归证据：${desktop.root}`)
  try {
    await desktop.page.setViewportSize({ width: 1024, height: 700 })
    const files = []
    for (let index = 0; index < 10; index++) {
      const destination = path.join(desktop.root, `标签回归 ${index} 中文人物.psd`)
      await copyFile(fixture.absolutePath, destination)
      files.push(destination)
    }
    await desktop.page.evaluate(() => { location.hash = '/action-expression' })
    await desktop.page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(desktop.page)
    await desktop.application.evaluate((_electron, paths) => { globalThis.__momentumTest.openPaths = paths }, files)
    await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
    await desktop.page.waitForFunction(() => document.querySelectorAll('.psd-tab-item').length === 10)
    const initial = Buffer.from((await stableCanvas(desktop.page)).png, 'base64')

    // 2、长标签列表确实溢出，原滚轮处理器必须将纵向位移转成横向滚动。
    const container = desktop.page.locator('.psd-tabs-container')
    assert.ok(await container.evaluate((node) => node.scrollWidth > node.clientWidth), '测试必须真实覆盖溢出列表')
    await container.evaluate((node) => { node.scrollLeft = 0 })
    await container.dispatchEvent('wheel', { deltaY: 80, bubbles: true, cancelable: true })
    assert.ok(await container.evaluate((node) => node.scrollLeft > 0), '滚轮没有移动标签列表')
    const lastName = path.basename(files.at(-1))
    await desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(lastName, { exact: true })).click()
    await desktop.page.locator('.psd-tab-item.active .psd-tab-name').and(desktop.page.getByTitle(lastName, { exact: true })).waitFor()
    await assertSamePixels(Buffer.from((await stableCanvas(desktop.page)).png, 'base64'), initial, '相同素材切换标签')

    // 3、关闭非活动标签不能冒泡触发切换；关闭活动标签后应保留唯一有效会话。
    await desktop.page.locator('.psd-tab-item').first().getByTitle('移除', { exact: true }).click()
    await desktop.page.waitForFunction(() => document.querySelectorAll('.psd-tab-item').length === 9)
    assert.equal(await desktop.page.locator('.psd-tab-item.active .psd-tab-name').getAttribute('title'), lastName)
    await desktop.page.locator('.psd-tab-item.active').getByTitle('移除', { exact: true }).click()
    await desktop.page.waitForFunction(() => document.querySelectorAll('.psd-tab-item').length === 8)
    assert.equal(await desktop.page.locator('.psd-tab-item.active').count(), 1)
    assert.notEqual(await desktop.page.locator('.psd-tab-item.active .psd-tab-name').getAttribute('title'), lastName)
    await assertSamePixels(Buffer.from((await stableCanvas(desktop.page)).png, 'base64'), initial, '关闭当前标签后其它会话画布')

    // 4、逐个关闭直至空列表，确认最后一个标签移除后释放当前素材入口。
    for (let remaining = 8; remaining > 0; remaining--) {
      await desktop.page.locator('.psd-tab-item').first().getByTitle('移除', { exact: true }).click()
      await desktop.page.waitForFunction((count) => document.querySelectorAll('.psd-tab-item').length === count, remaining - 1)
    }
    assert.equal(await desktop.page.locator('.psd-tabs-bar').count(), 0)
    assert.equal(await desktop.page.getByRole('button', { name: '预览', exact: true }).isDisabled(), true)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
