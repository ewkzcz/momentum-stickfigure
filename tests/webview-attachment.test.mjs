import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('webview附加策略：危险配置覆盖、实际会话隔离及本地入口拒绝', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const observed = await desktop.application.evaluate(({ BrowserWindow, session }) => {
      const main = BrowserWindow.getAllWindows()[0].webContents
      // 强制后台保护禁止真实webview。仅直接调用生产监听，绝不移除或关闭保护。
      const attach = main.listeners('will-attach-webview').find(listener => listener.name === 'attach')
      if (!attach) throw new Error('生产webview附加策略尚未安装')
      const probe = (src, partition = 'persist:probe') => {
        const prefs = { nodeIntegration: true, nodeIntegrationInSubFrames: true, sandbox: false, contextIsolation: false, webSecurity: false, preload: '/forbidden/preload.cjs' }
        let denied = false
        attach({ preventDefault: () => { denied = true } }, prefs, { src, partition })
        return { prefs, denied }
      }
      const first = probe('http://localhost:12341/site')
      const second = probe('http://localhost:12342/site')
      const again = probe('http://localhost:12341/another')
      const firstSession = session.fromPartition(first.prefs.partition)
      return {
        first, second, again,
        separate: firstSession !== session.defaultSession && firstSession !== session.fromPartition(second.prefs.partition),
        rejected: ['file:///forbidden.html', 'data:text/html,probe', 'https://user:password@example.invalid/'].map(src => probe(src).denied),
        invalidPartition: probe('http://localhost:12341/site', {}).denied,
        protectionInstalled: globalThis.__momentumTest.backgroundPolicy.snapshot().installed
      }
    })
    assert.equal(observed.first.denied, false)
    assert.equal(observed.second.denied, false)
    assert.equal(observed.first.prefs.sandbox, true)
    assert.equal(observed.first.prefs.webSecurity, true)
    assert.equal(observed.first.prefs.contextIsolation, true)
    assert.equal(observed.first.prefs.nodeIntegration, false)
    assert.equal(observed.first.prefs.nodeIntegrationInSubFrames, false)
    assert.equal(observed.first.prefs.nodeIntegrationInWorker, false)
    assert.equal(observed.first.prefs.preload, undefined)
    assert.equal(observed.first.prefs.disablePopups, true)
    assert.equal(observed.first.prefs.webviewTag, false)
    assert.equal(observed.first.prefs.partition, observed.again.prefs.partition)
    assert.notEqual(observed.first.prefs.partition, observed.second.prefs.partition)
    assert.equal(observed.separate, true)
    assert.deepEqual(observed.rejected, [true, true, true])
    assert.equal(observed.invalidPartition, true)
    assert.equal(observed.protectionInstalled, true)
    const opening = desktop.application.waitForEvent('window')
    await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    const preview = await opening
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    const previewDenied = await desktop.application.evaluate(({ BrowserWindow }) => {
      const preview = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('canvas-preview.html')).webContents
      let denied = false
      preview.listeners('will-attach-webview').find(fn => fn.name === 'attach')({ preventDefault: () => { denied = true } }, {}, { src: 'http://localhost:12341/site' })
      return denied
    })
    assert.equal(previewDenied, true)
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.storage.length())).success, true)
  } finally { await desktop.close() }
})
