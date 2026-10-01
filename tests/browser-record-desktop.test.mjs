/** 真实网页独立销毁后，原IPC必须识别失效记录；不增加调试接口。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { launchDesktop } from './helpers/desktop.mjs'

test('网页独立销毁：失效记录拒绝操作且同键可恢复', { timeout: 90000 }, async () => {
  const server = createServer((_request, response) => response.end('<!doctype html><title>record</title>'))
  server.listen(0, 'localhost')
  await once(server, 'listening')
  let desktop
  try {
    desktop = await launchDesktop()
    const input = { url: `http://localhost:${server.address().port}/record`, partition: 'persist:record-cleanup' }
    const invoke = channel => desktop.page.evaluate(({ channel, input }) => window.electronAPI.invoke(channel, input), { channel, input })
    for (let round = 0; round < 20; round++) {
      assert.deepEqual(await invoke('browserview:open'), { success: true })
      await desktop.application.evaluate(async ({ webContents }) => {
        const target = webContents.getAllWebContents().find(item => item.getType() === 'browserView')
        await new Promise(resolve => { target.once('destroyed', resolve); target.close() })
      })
      assert.deepEqual(await invoke('browserview:setBounds'), { success: false, error: '视图不存在' })
      assert.deepEqual(await invoke('browserview:reload'), { success: false, error: '视图不存在' })
      assert.deepEqual(await invoke('browserview:close'), { success: true })
    }
    assert.deepEqual(desktop.errors, [])
  } finally {
    try { if (desktop) await desktop.close() } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
  }
})
