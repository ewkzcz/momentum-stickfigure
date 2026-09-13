/** 漫画公开导出桌面回归：仅使用既有后台隔离启动器，需先构建对应源码。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'
import { decodePng } from './helpers/images.mjs'

for (const [button, success, count] of [
  ['导出整体', '整体视角导出成功', 1],
  ['导出拆分', '视角导出成功，共 2 个视角', 2]
]) {
  test(`漫画公开${button}：取消不写文件，重试生成透明 PNG`, {
    timeout: 60000
  }, async () => {
    const desktop = await launchDesktop()
    try {
      const { page, application, root } = desktop
      await page.evaluate(() => { location.hash = '/comic' })
      const exportButton = page.locator('.comic-page .canvas-toolbar').getByRole('button', { name: button, exact: true })
      await exportButton.waitFor()
      await page.waitForFunction(() => {
        const canvas = document.querySelector('.comic-page canvas')
        return canvas?.width === 1920 && canvas?.height === 1080
      })
      const directory = path.join(root, 'comic-export')
      await mkdir(directory)
      const before = await application.evaluate(() => globalThis.__momentumTest.writes.filter(name => name.endsWith('.png')))
      await application.evaluate(() => { globalThis.__momentumTest.openPaths = [] })
      const canceled = page.waitForEvent('console', { predicate: message => message.text().includes('用户取消了文件夹选择') })
      await exportButton.click()
      // 等待生产目录选择取消分支的反馈，不用固定睡眠或替换渲染器桥接。
      await canceled
      assert.deepEqual(await application.evaluate(() => globalThis.__momentumTest.writes.filter(name => name.endsWith('.png'))), before)
      assert.deepEqual(await readdir(directory), [])
      // 此用例限定目录末尾已有平台分隔符；无末尾分隔符的 POSIX 路径仍需独立回归。
      await application.evaluate((_, folder) => { globalThis.__momentumTest.openPaths = [folder] }, directory + path.sep)
      await exportButton.click()
      await page.getByText(success, { exact: true }).waitFor()
      const files = (await readdir(directory)).filter(name => name.endsWith('.png'))
      assert.equal(files.length, count)
      for (const file of files) {
        const image = await decodePng(await readFile(path.join(directory, file)))
        assert.equal(image.width, 1920)
        assert.equal(image.height, 1080)
        assert.ok(image.rgba.some((value, index) => index % 4 === 3 && value === 0), '默认空模板保留透明背景')
        assert.ok(image.rgba.some((value, index) => index % 4 === 3 && value > 0), '导出保留多边形边框')
      }
      assert.deepEqual(desktop.errors, [])
      console.log(`漫画导出证据：${root}`)
    } finally {
      await desktop.close()
    }
  })
}
