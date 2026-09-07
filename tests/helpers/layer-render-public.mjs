/** 图层绘制完成的公开对照：只读取 DOM，并用互斥开关往返触发串行原算法重绘。 */
import assert from 'node:assert/strict'
import { stableCanvas } from './images.mjs'

/** 记录完整展开树、文件、部件、预设、全部通用开关和当前面板。 */
export async function layerPublicState(page) {
  return page.evaluate(() => ({
    files: [...document.querySelectorAll('.psd-tab-item')].map((node) => ({ name: node.querySelector('.psd-tab-name').getAttribute('title'), active: node.classList.contains('active') })),
    layers: [...document.querySelectorAll('.layer-item')].map((node) => ({ name: node.querySelector('.layer-name').textContent.trim(), group: node.classList.contains('is-group'), depth: node.style.paddingLeft, checked: node.querySelector('input').checked })),
    tabs: [...document.querySelectorAll('.part-tab')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active') })),
    selectedParts: [...document.querySelectorAll('.parts-virtual-items .part-item.active .part-name')].map((node) => node.textContent.trim()),
    selectedPresets: document.querySelectorAll('.preset-item.active').length,
    controls: [...document.querySelectorAll('.common-controls label')].filter((label) => label.querySelector('input[type=checkbox]')).map((label) => ({ name: label.textContent.trim(), checked: label.querySelector('input').checked })),
    panel: [...document.querySelectorAll('.panel-tab-button')].map((node) => ({ name: node.textContent.trim(), active: node.classList.contains('active') }))
  }))
}

/** 中性对照必须严格恢复全部公开状态；发生 DOM 改变就失败，不得采为参考。 */
export async function publicSerialRedraw(page) {
  const before = await layerPublicState(page)
  assert.ok(before.layers.length && before.controls.length && before.panel.length, '对照必须观察完整树与控制状态')
  const panel = before.panel.find((item) => item.active).name
  await page.getByRole('button', { name: '通用', exact: true }).click()
  const control = page.getByRole('checkbox', { name: '表情互斥', exact: true })
  assert.equal(await control.isChecked(), true, '只批准已验证的表情互斥 true→false→true 对照')
  await control.uncheck()
  await stableCanvas(page, '.render-canvas', false)
  await control.check()
  await stableCanvas(page, '.render-canvas', false)
  await page.getByRole('button', { name: panel, exact: true }).click()
  const image = await stableCanvas(page, '.render-canvas', false)
  const after = await layerPublicState(page)
  assert.deepEqual(after, before, '串行重绘前后完整 DOM/控制状态必须不变，禁止采集非中性结果')
  return { image: Buffer.from(image.png, 'base64'), state: after, operations: ['表情互斥 true→false', '完整画布十二帧稳定', '表情互斥 false→true', '完整画布十二帧稳定'], domEqual: true }
}
