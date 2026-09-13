/** 设置版本确认回归：关闭、Escape及遮罩均取消导入，只有明确继续才允许写入。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile, readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

for (const action of ['close', 'escape', 'mask', 'cancel', 'continue']) {
  test(`版本确认${action}：明确结束导入且仅继续时写入`, { timeout: 45000 }, async () => {
    // 1、启动真实隔离页面，等待初始配置加载完成。
    const desktop = await launchDesktop(undefined, 'software-layout')
    console.log(`版本确认${action}隔离目录：${desktop.root}`)
    try {
      await desktop.page.setViewportSize({ width: 1024, height: 1100 })
      const cdp = await desktop.page.context().newCDPSession(desktop.page)
      await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true })
      await desktop.page.evaluate(() => { location.hash = '/settings/about' })
      const button = desktop.page.getByRole('button', { name: '导入设置', exact: true })
      await button.waitFor()
      await desktop.page.waitForFunction(() => localStorage.getItem('hd-toolkit-config') !== null)
      const keys = ['stickfigure-config', 'gemini-image-config', 'hotkeys-config', 'hd-toolkit-config', 'dialog-config']
      const snapshot = () => desktop.page.evaluate(keys => Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys)
      const before = await snapshot()
      // 2、通过原生选择边界导入隔离夹具，确认前所有配置保持不变。
      const fixture = { version: '0.0.0-close-regression', stickfigureConfig: { outputRoot: path.join(desktop.root, 'imported'), createPsdFolder: false, enableFuzzyMatch: false } }
      const file = path.join(desktop.root, 'version.json')
      await writeFile(file, JSON.stringify(fixture))
      await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
      await button.click()
      const dialog = desktop.page.locator('.n-dialog:visible').filter({ hasText: '版本不匹配' })
      await dialog.waitFor()
      assert.deepEqual(await snapshot(), before, '确认前不得写入任何配置域')
      // 3、分别操作真实关闭入口，验证加载结束及写入权限。
      if (action === 'close') await dialog.locator('.n-dialog__close').click()
      else if (action === 'escape') await desktop.page.keyboard.press('Escape')
      else if (action === 'mask') {
        const box = await dialog.boundingBox()
        assert.ok(box && box.x > 10 && box.y > 10)
        await desktop.page.mouse.click(5, 5)
      } else await dialog.getByRole('button', { name: action === 'continue' ? '继续导入' : '取消', exact: true }).click()
      await dialog.waitFor({ state: 'hidden' })
      await desktop.page.waitForFunction(() => [...document.querySelectorAll('button')].some(node => node.textContent.trim() === '导入设置' && !node.classList.contains('n-button--loading') && !node.disabled), null, { timeout: 5000 })
      const after = await snapshot()
      assert.deepEqual(after, action === 'continue' ? { ...before, 'stickfigure-config': JSON.stringify(fixture.stickfigureConfig) } : before)
      await assert.rejects(readFile(path.join(desktop.root, 'home/Documents/MomentumStickFigure/Settings/settings-latest.json')), { code: 'ENOENT' })
      // 4、取消后必须可以再次打开确认，显式取消后仍无副作用。
      if (action !== 'continue') {
        await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, file)
        await button.click()
        await dialog.waitFor()
        await dialog.getByRole('button', { name: '取消', exact: true }).click()
        await desktop.page.waitForFunction(() => !document.querySelector('.settings-page .n-button--loading'))
        assert.deepEqual(await snapshot(), before)
      }
      assert.deepEqual(desktop.errors, [])
    } finally {
      // 5、即使正确行为断言失败，仍执行原辅助的退出与隔离检查。
      await desktop.close()
    }
  })
}
