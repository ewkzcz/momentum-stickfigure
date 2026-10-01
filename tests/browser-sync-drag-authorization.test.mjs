import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile, readFile, symlink, unlink } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4N8AAAAASUVORK5CYII='
test('同步网页拖拽：来源与已准备单文件授权先于隐藏窗口及系统调用', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invokeSync = payload => desktop.application.evaluate(({ BrowserWindow, ipcMain }, payload) => new Promise(resolve => setImmediate(() => {
      const sender = BrowserWindow.getAllWindows()[0].webContents
      const event = { sender, senderFrame: sender.mainFrame }
      try { ipcMain.emit('doubao:start-drag-sync', event, payload); resolve({ result: event.returnValue }) }
      catch (error) { resolve({ thrown: error.message }) }
    })), payload)
    const invalid = await invokeSync(null)
    assert.equal(invalid.thrown, undefined, '错误载荷必须转为失败包络而非抛出同步监听器')
    assert.equal(invalid.result.success, false)
    const file = path.join(desktop.root, 'temp/unselected.png')
    await writeFile(file, Buffer.from(png, 'base64'))
    assert.equal((await invokeSync({ filePath: file })).result.success, false)
    const prepared = await desktop.page.evaluate(png => window.electronAPI.invoke('doubao:prepare-file-async', { base64: png, fileName: '同步 中文.png' }), png)
    assert.equal(prepared.success, true)
    const denied = await desktop.application.evaluate(({ BrowserWindow, ipcMain }, filePath) => new Promise(resolve => setImmediate(() => {
      const main = BrowserWindow.getAllWindows()[0].webContents
      const foreign = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } })
      try {
        resolve([
          { sender: foreign.webContents, senderFrame: foreign.webContents.mainFrame },
          { sender: main, senderFrame: { url: main.mainFrame.url } }
        ].map(event => { ipcMain.emit('doubao:start-drag-sync', event, { filePath }); return event.returnValue }))
      } finally { foreign.destroy() }
    })), prepared.path)
    assert.ok(denied.every(result => result.success === false))
    await unlink(prepared.path)
    await symlink(file, prepared.path)
    assert.equal((await invokeSync({ filePath: prepared.path })).result.success, false)
    await unlink(prepared.path)
    await writeFile(prepared.path, Buffer.from(png, 'base64'))
    assert.equal(await desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1)
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.drags.length), 0)
    assert.equal((await invokeSync({ filePath: prepared.path })).result.success, true)
    assert.deepEqual(await readFile(file), Buffer.from(png, 'base64'))
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.drags.at(-1).file), prepared.path)
  } finally { await desktop.close() }
})
