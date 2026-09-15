import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

const image = 'data:image/png;base64,aGVsbG8='
const templateType = 'actionTemplate'
const invoke = (page, channel, ...args) => page.evaluate(
  ({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args }
)

function assertDenied(result, channel) {
  assert.equal(result?.success, false, `${channel} 必须拒绝预览来源`)
  assert.match(result.error || '', /未授权/, `${channel} 必须返回来源拒绝，而非业务参数失败`)
  assert.deepEqual(Object.keys(result).sort(), channel === 'prompt-templates:get'
    ? ['error', 'success', 'templates'] : ['error', 'success'])
  if (channel === 'prompt-templates:get') assert.deepEqual(result.templates, [])
}

// 使用原隔离启动器运行真实 Electron 窗口和生产 IPC，不替换来源策略或业务 handler。
// 修复前：主窗正向用例应正常，预览拒绝和广播隔离用例应暴露当前缺口。
test('模板 IPC 来源基线：真实主窗、真实预览及提示词广播', { timeout: 120000 }, async t => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    await invoke(desktop.page, 'canvas-preview-create')
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const main = (channel, ...args) => invoke(desktop.page, channel, ...args)
    const storage = (name, payload) => main(`template-storage-${name}`, payload)
    const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
    const promptFile = path.join(desktop.root, 'home', '.config', 'momentum-stickfigure-open', 'prompt-templates.json')

    await t.test('主窗：提示词 get/save 与模板图片九个接口保持可用', async () => {
      const templates = [{ id: 'main-prompt', content: 'isolated main prompt' }]
      assert.deepEqual(await main('prompt-templates:save', { type: 'image', templates }), { success: true })
      const prompt = await main('prompt-templates:get', 'image')
      assert.equal(prompt.success, true)
      assert.equal(prompt.templates[0].content, templates[0].content)
      assert.equal(JSON.parse(await readFile(promptFile, 'utf8')).image[0].content, templates[0].content)

      const saved = await storage('save-image', { templateType, templateId: 'main-single', base64Data: image })
      assert.equal(saved.success, true)
      assert.equal(await readFile(path.join(userData, saved.filePath), 'utf8'), 'hello')
      assert.deepEqual(await storage('load-image', { relativePath: saved.filePath }), { success: true, base64Data: image })
      const batch = await storage('batch-save', {
        templateType, imagePreviews: [{ id: 'main-batch', base64_data: image }]
      })
      assert.equal(batch.success, true)
      assert.equal(batch.results.length, 1)
      assert.deepEqual(await storage('batch-load', { filePathsData: batch.results }), {
        success: true, results: [{ id: 'main-batch', base64_data: image }]
      })
      const directory = await storage('get-dir')
      assert.equal(directory.success, true)
      assert.equal(directory.dir, path.join(userData, 'templates'))
      const stats = await storage('stats')
      assert.equal(stats.success, true)
      assert.ok(stats.stats && typeof stats.stats === 'object')
      assert.deepEqual(await storage('delete-image', { relativePath: saved.filePath }), { success: true })
      assert.deepEqual(await storage('batch-delete', { filePathsData: batch.results }), { success: true, deleteCount: 1 })
      assert.equal((await storage('save-image', { templateType, templateId: 'main-cleanup', base64Data: image })).success, true)
      assert.deepEqual(await storage('cleanup', { templateType, validTemplateIds: [] }), { success: true, cleanCount: 1 })
    })

    const cases = [
      ['prompt-templates:get', () => 'image'],
      ['prompt-templates:save', () => ({ type: 'image', templates: [{ id: 'preview-prompt', content: 'must not persist' }] })],
      ['template-storage-save-image', id => ({ templateType, templateId: id, base64Data: image })],
      ['template-storage-load-image', (_id, relativePath) => ({ relativePath })],
      ['template-storage-batch-save', id => ({ templateType, imagePreviews: [{ id, base64_data: image }] })],
      ['template-storage-batch-load', (id, file_path) => ({ filePathsData: [{ id, file_path }] })],
      ['template-storage-delete-image', (_id, relativePath) => ({ relativePath })],
      ['template-storage-batch-delete', (id, file_path) => ({ filePathsData: [{ id, file_path }] })],
      ['template-storage-cleanup', () => ({ templateType, validTemplateIds: [] })],
      ['template-storage-stats', () => undefined],
      ['template-storage-get-dir', () => undefined]
    ]
    for (const [index, [channel, payload]] of cases.entries()) {
      await t.test(`预览：${channel} 在读写或目录副作用前拒绝`, async () => {
        const id = `preview-guard-${index}`
        const saved = await storage('save-image', { templateType, templateId: id, base64Data: image })
        assert.equal(saved.success, true, '先用合法主窗准备独立的可读删图片')
        const beforePrompt = await readFile(promptFile, 'utf8')
        const beforeWrites = await desktop.application.evaluate(() => globalThis.__momentumTest.writes.filter(
          value => /[\\/]templates(?:[\\/]|$)|[\\/]prompt-templates\.json$/.test(value)
        ))
        const result = await invoke(preview, channel, payload(id, saved.filePath))
        assertDenied(result, channel)
        const afterWrites = await desktop.application.evaluate(() => globalThis.__momentumTest.writes.filter(
          value => /[\\/]templates(?:[\\/]|$)|[\\/]prompt-templates\.json$/.test(value)
        ))
        assert.deepEqual(afterWrites, beforeWrites, '拒绝期间不得写入、删除或创建模板目录')
        assert.equal(await readFile(promptFile, 'utf8'), beforePrompt, '提示词磁盘内容保持不变')
        assert.equal(await readFile(path.join(userData, saved.filePath), 'utf8'), 'hello')
      })
    }

    for (const channel of [
      'prompt-templates:save',
      'template-storage-save-image', 'template-storage-load-image',
      'template-storage-batch-save', 'template-storage-batch-load',
      'template-storage-delete-image', 'template-storage-batch-delete', 'template-storage-cleanup'
    ]) {
      await t.test(`预览：${channel} 的 null 载荷先判来源再解构`, async () => {
        assertDenied(await invoke(preview, channel, null), channel)
      })
    }

    await t.test('主窗保存提示词只向可信主窗广播，预览不接收', async () => {
      // 仅记录真实 webContents.send 的收件窗口并继续原发送，避免用等待超时证明未广播。
      const recipients = await desktop.application.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows()
        globalThis.__templateBroadcastProbe = { deliveries: [], restore: [] }
        for (const win of windows) {
          const contents = win.webContents
          const original = contents.send
          contents.send = function (channel, ...args) {
            if (channel === 'prompt-templates-updated') {
              globalThis.__templateBroadcastProbe.deliveries.push({ id: contents.id, payload: args[0] })
            }
            return original.call(this, channel, ...args)
          }
          globalThis.__templateBroadcastProbe.restore.push(() => { contents.send = original })
        }
        return windows.map(win => ({ id: win.webContents.id, url: win.webContents.getURL() }))
      })
      try {
        const mainId = recipients.find(item => item.url === desktop.page.url())?.id
        const previewId = recipients.find(item => item.url === preview.url())?.id
        assert.ok(mainId && previewId && mainId !== previewId, '真实主窗和预览应对应不同接收者')
        await desktop.page.evaluate(() => {
          window.__templateBroadcasts = []
          window.__stopTemplateBroadcast = window.electronAPI.on('prompt-templates-updated', payload => window.__templateBroadcasts.push(payload))
        })
        assert.deepEqual(await main('prompt-templates:save', {
          type: 'image', templates: [{ id: 'broadcast-probe', content: 'main-only broadcast' }]
        }), { success: true })
        await desktop.page.waitForFunction(() => window.__templateBroadcasts.some(payload => payload.templates.some(item => item.id === 'broadcast-probe')))
        const deliveries = await desktop.application.evaluate(() => globalThis.__templateBroadcastProbe.deliveries)
        assert.deepEqual(deliveries.map(item => item.id), [mainId], '广播只能发送给可信主窗，不能包含预览窗口')
        assert.equal(deliveries[0].payload.templates[0].content, 'main-only broadcast')
      } finally {
        await desktop.page.evaluate(() => window.__stopTemplateBroadcast?.())
        await desktop.application.evaluate(() => {
          for (const restore of globalThis.__templateBroadcastProbe.restore) restore()
          delete globalThis.__templateBroadcastProbe
        })
      }
    })
  } finally {
    await desktop.close()
  }
})
