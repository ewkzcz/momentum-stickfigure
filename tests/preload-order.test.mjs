/** 用页面首个同步脚本观察真实生产preload，不能用页面加载后的桥接状态替代。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

test('预加载顺序：首个页面脚本执行时完整桥接已经存在', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const probe = path.join(desktop.root, 'preload-probe.html')
    await writeFile(probe, '<!doctype html><html><body><script src="preload-probe.js"></script></body></html>')
    await writeFile(path.join(desktop.root, 'preload-probe.js'), `globalThis.firstScriptBridge = {
      invoke: typeof window.electronAPI?.invoke, on: typeof window.electronAPI?.on,
      selectFile: typeof window.fileSystem?.selectFile, platform: typeof window.env?.platform
    }`)
    await desktop.application.evaluate(({ app }, probe) => {
      app.once('browser-window-created', (_event, window) => {
        const loadFile = window.loadFile.bind(window)
        // 只替换页面输入，仍使用生产窗口参数与真实预加载产物。
        window.loadFile = () => loadFile(probe)
      })
    }, probe)
    const opening = desktop.application.waitForEvent('window')
    const result = await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    assert.equal(result.success, true)
    const preview = await opening
    await preview.waitForLoadState('load')
    assert.deepEqual(await preview.evaluate(() => globalThis.firstScriptBridge), {
      invoke: 'function', on: 'function', selectFile: 'function', platform: 'string'
    })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
