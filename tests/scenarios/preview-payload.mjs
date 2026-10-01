/** 独立预览二进制回归：真实 IPC 传输必须只解码视图指定的 PNG 字节。 */
import assert from 'node:assert/strict'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop } from '../helpers/desktop.mjs'
import { stableCanvas, assertSamePixels } from '../helpers/images.mjs'

/** 验证小图片、带偏移视图及旧数据地址在真实预览窗口中逐像素一致。 */
export async function checkPreviewPayload() {
  // 1、独立生成输入 PNG；期望值来自发送前输入，不从待测预览反向采集。
  const canvas = createCanvas(32, 32)
  const context = canvas.getContext('2d')
  context.fillStyle = '#336699'
  context.fillRect(3, 5, 21, 19)
  const png = canvas.toBuffer('image/png')
  assert.ok(png.length < 4096, '必须覆盖 Node Buffer 小块内存池分配路径')
  const desktop = await launchDesktop()
  console.log(`预览载荷验证证据：${desktop.root}`)
  try {
    for (const format of ['array-buffer', 'offset-view', 'data-url']) {
      const opening = desktop.application.waitForEvent('window')
      await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
      const preview = await opening
      await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
      // 2、每种格式使用新窗口，等待真实 Vue 订阅挂载且初始画布为空。
      await preview.evaluate(() => new Promise(requestAnimationFrame))
      assert.equal(await preview.locator('.canvas-wrapper').isVisible(), false)
      const result = await desktop.page.evaluate(({ bytes, format }) => {
        let payload
        if (format === 'data-url') {
          payload = `data:image/png;base64,${window.btoa(String.fromCharCode(...bytes))}`
        } else {
          const storage = new Uint8Array(bytes.length + (format === 'offset-view' ? 37 : 0))
          storage.fill(0x7f)
          const view = format === 'offset-view' ? storage.subarray(13, 13 + bytes.length) : storage
          view.set(bytes)
          payload = { buffer: format === 'array-buffer' ? storage.buffer : view, width: 32, height: 32, mimeType: 'image/png' }
        }
        return window.electronAPI.invoke('canvas-preview-update', payload)
      }, { bytes: [...png], format })
      assert.equal(result.success, true)
      // 每次都要求新图片成功解码；发送前隐藏的旧画布不能构成通过证据。
      const image = await stableCanvas(preview, '.canvas-wrapper canvas')
      await assertSamePixels(Buffer.from(image.png, 'base64'), png, `预览载荷 ${format}`)
      const closed = preview.waitForEvent('close')
      await preview.getByRole('button', { name: '关闭', exact: true }).click()
      await closed
    }
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
}
