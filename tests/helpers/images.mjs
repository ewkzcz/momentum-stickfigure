/** 图像回归辅助：等待解码与可观察画布稳定，逐字节比较 RGBA。 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createCanvas, loadImage } from '@napi-rs/canvas'

/** 安装仅观察图像完成事件的探针，不替换解码和绘图结果。 */
export async function observeImages(page) {
  // 1、跟踪 DOM 外的 Image 对象，避免只等待页面 img 而提前采样。
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    const pending = new Set()
    window.__regressionImages = pending
    Object.defineProperty(HTMLImageElement.prototype, 'src', {
      ...descriptor,
      set(value) {
        pending.add(this)
        const done = () => { pending.delete(this); this.removeEventListener('load', done); this.removeEventListener('error', done) }
        this.addEventListener('load', done)
        this.addEventListener('error', done)
        descriptor.set.call(this, value)
      }
    })
  })
}

/** 在有界时间内等待画布像素和图像解码达到稳定状态。 */
export async function stableCanvas(page, selector = '.render-canvas', requireVisiblePixels = true) {
  // 1、逐帧比较实际画布，并检查解码和加载提示；超时返回失败。
  return page.locator(selector).evaluate(async (canvas, requireVisible) => {
    await document.fonts.ready
    const deadline = performance.now() + 30000
    let previous = ''
    let unchanged = 0
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame)
      const pending = [...(window.__regressionImages || [])].some((image) => !image.complete)
      const loading = [...document.querySelectorAll('.n-message')].some((node) => /正在处理|正在解析/.test(node.textContent))
      const png = canvas.toDataURL('image/png')
      const nonempty = !requireVisible || canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 === 3 && value > 0)
      unchanged = !pending && !loading && nonempty && png === previous ? unchanged + 1 : 0
      previous = png
      if (unchanged >= 12) return { width: canvas.width, height: canvas.height, png: png.split(',')[1] }
    }
    throw new Error('画布或图像解码未在时限内稳定')
  }, requireVisiblePixels)
}

/** 解码 PNG 后取得原始 RGBA，避免将编码差异误报为渲染差异。 */
export async function decodePng(bytes) {
  // 1、使用真实解码器读取图像尺寸和全部像素。
  const image = await loadImage(bytes)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return { width: image.width, height: image.height, rgba: Buffer.from(context.getImageData(0, 0, image.width, image.height).data) }
}

/** 比较同平台图像的全部 RGBA 字节，固定采用零容差。 */
export async function assertSamePixels(actual, expected, label) {
  // 1、先检查尺寸，再比较全部像素，不提供容差或自动更新选项。
  const [left, right] = await Promise.all([decodePng(actual), decodePng(expected)])
  assert.equal(left.width, right.width, `${label}：宽度改变`)
  assert.equal(left.height, right.height, `${label}：高度改变`)
  assert.ok(left.rgba.equals(right.rgba), `${label}：RGBA 存在差异，禁止替换参考图消除失败`)
}

/** 核验素材字节未变化，缺失时明确标记未运行并返回失败。 */
export async function verifyFixture(filePath, expectedHash) {
  // 1、只读原素材，不写回或修补文件。
  let bytes
  try { bytes = await readFile(filePath) } catch (error) { throw new Error(`未运行：缺少指定 PSD 素材 ${filePath}`, { cause: error }) }
  const hash = createHash('sha256').update(bytes).digest('hex')
  assert.equal(hash, expectedHash, 'PSD 素材哈希改变，必须重新核验场景与原始参考')
  return hash
}
