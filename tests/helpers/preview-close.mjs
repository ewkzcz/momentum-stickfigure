/** 自关闭预览测试同步：保留真实按钮点击，以原IPC结算和目标原生销毁确认成功。 */
import assert from 'node:assert/strict'

/**
 * 点击预览关闭按钮并验证实际关闭的因果链。
 * 处理流程：
 * 1、透明包裹原关闭IPC，只观察目标sender的原处理器结果。
 * 2、真实点击，等待目标页面关闭；仅接受已证实自身关闭导致的目标关闭错误。
 * 3、核对唯一关闭请求、原结果和webContents销毁，并还原原处理器。
 */
export async function closePreviewByButton(application, preview) {
  // 1、目标必须是唯一真实预览，不以其它窗口关闭或进程断连冒充通过。
  await application.evaluate(({ BrowserWindow, ipcMain }) => {
    const targets = BrowserWindow.getAllWindows().filter(window => window.webContents.getURL().split('#')[0].endsWith('/canvas-preview.html'))
    if (targets.length !== 1) throw new Error('必须存在唯一待关闭预览')
    const original = ipcMain._invokeHandlers.get('canvas-preview-close')
    if (typeof original !== 'function') throw new Error('原预览关闭处理器不存在')
    const sender = targets[0].webContents
    const state = globalThis.__previewButtonClose = { original, sender, calls: [], destroyed: false }
    state.onDestroyed = () => { state.destroyed = true }
    sender.once('destroyed', state.onDestroyed)
    ipcMain.removeHandler('canvas-preview-close')
    ipcMain.handle('canvas-preview-close', async (...args) => {
      const call = { senderMatches: args[0].sender === sender }
      state.calls.push(call)
      const result = await original(...args)
      call.result = result
      return result
    })
  })
  try {
    // 2、页面关闭事件先订阅；点击错误转为数据后仍必须验证原处理器和原生销毁。
    const closed = preview.waitForEvent('close', { timeout: 5000 })
    const click = preview.getByRole('button', { name: '关闭', exact: true }).click().then(() => null, error => error)
    const [clickError] = await Promise.all([click, closed])
    const evidence = await application.evaluate(() => {
      const state = globalThis.__previewButtonClose
      return { calls: state.calls, destroyed: state.destroyed, senderDestroyed: state.sender.isDestroyed() }
    })
    assert.deepEqual(evidence, { calls: [{ senderMatches: true, result: { success: true } }], destroyed: true, senderDestroyed: true })
    assert.equal(preview.isClosed(), true)
    if (clickError) assert.match(clickError.message, /^locator\.click: Target page, context or browser has been closed(?:\n|$)/)
    return { ...evidence, clickClosedBeforeAcknowledgement: Boolean(clickError) }
  } finally {
    // 3、即使断言失败也还原观察器，保留原桌面helper的全部退出保护。
    await application.evaluate(({ ipcMain }) => {
      const state = globalThis.__previewButtonClose
      state.sender.removeListener('destroyed', state.onDestroyed)
      ipcMain.removeHandler('canvas-preview-close')
      ipcMain.handle('canvas-preview-close', state.original)
      delete globalThis.__previewButtonClose
    })
  }
}
