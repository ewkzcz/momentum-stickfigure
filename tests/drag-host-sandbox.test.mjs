import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4N8AAAAASUVORK5CYII='
test('隐藏拖拽宿主：真实创建启用沙箱且不获得应用能力', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const prepared = await desktop.page.evaluate(png => window.electronAPI.invoke('doubao:prepare-file-async', { base64: png, fileName: 'host.png' }), png)
    assert.equal(prepared.success, true)
    const result = await desktop.application.evaluate(({ BrowserWindow, ipcMain }, filePath) => new Promise(resolve => setImmediate(async () => {
      try {
        const sender = BrowserWindow.getAllWindows()[0].webContents
        const event = { sender, senderFrame: sender.mainFrame }
        ipcMain.emit('doubao:start-drag-sync', event, { filePath })
        const host = BrowserWindow.getAllWindows().find(window => window.webContents !== sender)
        const preferences = host.webContents.getLastWebPreferences()
        const denied = await ipcMain._invokeHandlers.get('copy-to-clipboard')({ sender: host.webContents, senderFrame: host.webContents.mainFrame }, 'should-deny')
        resolve({ response: event.returnValue, sandbox: preferences.sandbox, webSecurity: preferences.webSecurity, node: preferences.nodeIntegration, isolation: preferences.contextIsolation, denied })
      } catch (error) { resolve({ error: error.message }) }
    })), prepared.path)
    assert.equal(result.error, undefined)
    assert.equal(result.response.success, true)
    assert.equal(result.sandbox, true)
    assert.equal(result.webSecurity, true)
    assert.equal(result.node, false)
    assert.equal(result.isolation, true)
    assert.equal(result.denied.success, false)
  } finally { await desktop.close() }
})
