/** 人物页快捷键提示回归：验证默认值、配置广播、主动清空及存储回读。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

/** 读取工具栏实际提示。处理流程：1、悬停目标；2、等待对应文字并检查快捷键。 */
async function tooltip(page, label, expected) {
  // 1、使用真实鼠标进入复选框，不读取 Vue 私有状态。
  await page.getByText(label, { exact: true }).hover()
  // 2、限定已显示的提示气泡，保留未设置的显示语义。
  const text = label === '预览1' ? '开启鼠标悬浮预览效果（主画布）' : '开启鼠标悬浮预览效果（预设列表、模板列表）'
  const tip = page.locator('.n-tooltip:visible').filter({ hasText: text })
  await tip.waitFor()
  assert.ok((await tip.innerText()).includes(`快捷键: ${expected}`))
  await page.mouse.move(1, 1)
  await tip.waitFor({ state: 'hidden' })
}

test('人物页快捷键提示：默认、广播更新、清空和损坏配置回退', { timeout: 60000 }, async () => {
  // 1、隔离运行真实界面，广播使用项目原公开事件，不触发系统快捷键。
  const desktop = await launchDesktop(undefined, 'software-layout')
  const { page } = desktop
  try {
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await tooltip(page, '预览1', 'Alt+C')
    await tooltip(page, '预览2', 'Alt+V')
    const stored = await page.evaluate(() => localStorage.getItem('hotkeys-config'))
    await page.evaluate(() => window.dispatchEvent(new window.CustomEvent('hotkeys-config-updated', { detail: { toggleCanvasHover: 'Ctrl+Shift+C', togglePartHover: '' } })))
    await tooltip(page, '预览1', 'Ctrl+Shift+C')
    await tooltip(page, '预览2', '未设置')
    assert.equal(await page.evaluate(() => localStorage.getItem('hotkeys-config')), stored, '提示更新不得持久化配置')
    // 2、未携带事件数据时重新读存储，缺失值和 null 回退，主动清空不回退。
    await page.evaluate(() => {
      localStorage.setItem('hotkeys-config', JSON.stringify({ toggleCanvasHover: null, togglePartHover: 'Shift+V' }))
      window.dispatchEvent(new window.CustomEvent('hotkeys-config-updated'))
    })
    await tooltip(page, '预览1', 'Alt+C')
    await tooltip(page, '预览2', 'Shift+V')
    await page.evaluate(() => {
      localStorage.setItem('hotkeys-config', '{broken')
      window.dispatchEvent(new window.CustomEvent('hotkeys-config-updated'))
    })
    await tooltip(page, '预览1', 'Alt+C')
    await tooltip(page, '预览2', 'Alt+V')
    // 3、还原测试配置，检查异常收集与既有后台隔离保护。
    await page.evaluate(stored => {
      if (stored === null) localStorage.removeItem('hotkeys-config')
      else localStorage.setItem('hotkeys-config', stored)
    }, stored)
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
