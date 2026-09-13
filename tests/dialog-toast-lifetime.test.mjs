/** 对话提示计时回归：真实公开选择操作连续触发，旧定时器不得提前隐藏新提示。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { createCanvas } from '@napi-rs/canvas'

test('对话画布重复提示：最后一次操作后保持原三秒提示时长', { timeout: 30000 }, async () => {
  // 1、原辅助启动真实隔离桌面，用公开上传创建可选择的对话框。
  const desktop = await launchDesktop(undefined, 'software-layout')
  console.log(`对话提示重复计时目录：${desktop.root}`)
  try {
    await desktop.page.evaluate(() => { location.hash = '/dialog-frame' })
    const canvas = createCanvas(80, 50)
    canvas.getContext('2d').fillRect(10, 10, 60, 30)
    await desktop.page.locator('.dialog-frame-manager input[type=file]').first().setInputFiles({ name: 'frame.png', mimeType: 'image/png', buffer: canvas.toBuffer('image/png') })
    const button = desktop.page.locator('.frame-preview')
    const toast = desktop.page.locator('.dialog-frame-page .toast')
    await button.waitFor()
    await toast.waitFor({ state: 'hidden' })
    // 2、间隔两秒重复提示，在旧期限之后、最新期限之前验证仍然可见。
    await button.click()
    await toast.waitFor()
    assert.equal(await toast.textContent(), '已选中对话框，可以进行调整')
    await delay(2000)
    await button.click()
    const lastClick = Date.now()
    await delay(1400)
    assert.ok(Date.now() - lastClick < 2600, '本轮调度过慢，不能判断提示是否被提前关闭')
    assert.equal(await toast.isVisible(), true, '最后一次提示不足三秒，旧提示计时器不得将其隐藏')
    // 3、仍需自动消失，不以永久显示规避计时回归。
    await toast.waitFor({ state: 'hidden', timeout: 4000 })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
