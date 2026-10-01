/** 仅记录预览IPC调用和原生投递，不改变返回值、不重发、不读取Vue私有状态。 */
export async function installPreviewDeliveryTrace(application) {
  await application.evaluate(({ app, ipcMain }) => {
    const state = globalThis.__previewDeliveryTrace = { events: [], originals: [] }
    const record = (event, detail) => state.events.push({ time: Date.now(), event, ...detail })
    for (const channel of ['canvas-preview-create', 'canvas-preview-ready', 'canvas-preview-update', 'canvas-preview-sync-theme', 'canvas-preview-update-filename', 'canvas-preview-close']) {
      const original = ipcMain._invokeHandlers.get(channel)
      if (!original) continue
      state.originals.push([channel, original])
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (event, ...args) => {
        const sender = event.sender.id
        record('invoke', { channel, sender })
        try {
          const result = await original(event, ...args)
          record('resolved', { channel, sender, result })
          return result
        } catch (error) {
          record('rejected', { channel, sender, message: error.message })
          throw error
        }
      })
    }
    state.created = (_event, window) => {
      const contents = window.webContents, id = contents.id
      record('created', { id })
      for (const event of ['dom-ready', 'did-finish-load', 'destroyed', 'preload-error', 'render-process-gone']) {
        contents.on(event, () => record(event, { id }))
      }
      const send = contents.send.bind(contents)
      contents.send = (channel, ...args) => {
        record('send', { id, channel })
        return send(channel, ...args)
      }
    }
    app.on('browser-window-created', state.created)
  })
}

export async function readPreviewDeliveryTrace(application) {
  return application.evaluate(() => globalThis.__previewDeliveryTrace?.events || [])
}
