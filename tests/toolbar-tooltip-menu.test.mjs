import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('更多菜单：悬停提示出现后菜单项仍可真实点击', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`工具栏提示遮挡证据：${desktop.root}`)
  try {
    const { page } = desktop
    await page.evaluate(() => { location.hash = '/action-expression' })
    const button = page.getByRole('button', { name: '更多', exact: true })
    await button.waitFor()
    await button.hover()
    await page.getByText('更多功能选项', { exact: true }).waitFor({ state: 'visible' })
    await button.click()
    const option = page.getByText('切换画布缩放', { exact: true })
    await option.waitFor({ state: 'visible' })
    await page.mouse.move(0, 0)
    await page.getByText('更多功能选项', { exact: true }).waitFor({ state: 'hidden' })
    await button.hover()
    await page.getByText('更多功能选项', { exact: true }).waitFor({ state: 'visible' })
    await page.getByText('更多功能选项', { exact: true }).screenshot()
    const tooltipReceivesPointer = await page.getByText('更多功能选项', { exact: true }).evaluate(node => {
      const rect = node.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
      return node === hit || node.contains(hit)
    })
    assert.equal(tooltipReceivesPointer, false, '纯说明浮层不应拦截下方菜单的指针')
    // 验证真正的指针命中，不用force、dispatchEvent或隐藏浮层绕过遮挡。
    await option.click({ timeout: 5000 })
    await page.locator('.canvas-area.scale-mode').waitFor()
    assert.equal(await page.locator('.canvas-area.scale-mode').count(), 1)
  } finally { await desktop.close() }
})
