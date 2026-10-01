/** PSD窗口边界回归：真实IPC验证其他窗口取消拒绝与发送窗口销毁后的线程退出。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { syntheticFixtures } from './helpers/reference.mjs'
import { verifyFixture } from './helpers/images.mjs'

/**
 * 透明记录生产线程和IPC结算，并按测试要求销毁预览窗口。
 * 处理流程：
 * 1、保持原Worker参数和IPC实现，仅记录创建、在线、退出及响应。
 * 2、在在线事件销毁指定真实窗口，验证其destroyed订阅。
 */
async function observe(desktop, destroyOn = 'online') {
  // 1、所有观察都位于原后台隔离内，不替换解析算法或模拟sender。
  await desktop.application.evaluate(({ BrowserWindow, ipcMain }, destroyOn) => {
    const threads = process.getBuiltinModule('worker_threads')
    const Original = threads.Worker
    const state = globalThis.__psdSenderProbe = { trace: [], next: 0, destroyWindow: null, settled: [], cancellations: [] }
    const parse = ipcMain._invokeHandlers.get('psd-parse-file')
    const cancel = ipcMain._invokeHandlers.get('psd-cancel-parse')
    ipcMain.removeHandler('psd-parse-file')
    ipcMain.handle('psd-parse-file', async (event, options) => {
      const sender = event.sender.id
      const result = await parse(event, options)
      state.settled.push({ sender, taskId: options.taskId, parsed: result.data?.success, error: result.data?.error })
      return result
    })
    ipcMain.removeHandler('psd-cancel-parse')
    ipcMain.handle('psd-cancel-parse', (event, taskId) => {
      state.cancellations.push({ sender: event.sender.id, taskId, settledCount: state.settled.length })
      return cancel(event, taskId)
    })
    // 2、online只证明线程启动，不冒称已进入原生readPsd内部。
    threads.Worker = class extends Original {
      constructor(...args) {
        super(...args)
        const id = ++state.next
        state.trace.push({ id, event: 'created' })
        this.once('online', () => state.trace.push({ id, event: 'online' }))
        this.once(destroyOn, () => {
          if (state.destroyWindow !== null) {
            const window = BrowserWindow.fromId(state.destroyWindow)
            state.destroyWindow = null
            window.webContents.once('destroyed', () => state.trace.push({ id, event: 'sender-destroyed' }))
            window.destroy()
          }
        })
        this.once('exit', code => state.trace.push({ id, event: 'exit', code }))
      }
    }
    process.getBuiltinModule('module').syncBuiltinESMExports()
  }, destroyOn)
}

/**
 * 创建第二个真实发送窗口。
 * 处理流程：
 * 1、调用生产预览创建IPC，并等待该窗口预加载接口就绪。
 */
async function preview(desktop) {
  // 1、保留原helper的隐藏、焦点及系统副作用保护。
  const opened = desktop.application.waitForEvent('window')
  const response = await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
  assert.equal(response.success, true)
  const page = await opened
  await page.waitForFunction(() => typeof window.electronAPI?.invoke === 'function')
  return page
}

test('PSD真实IPC拒绝其他窗口取消相同任务标识', { timeout: 90000 }, async () => {
  // 1、公开夹具由真实主窗口提交，预览窗口尝试取消同名任务。
  const desktop = await launchDesktop()
  const result = { passed: false }
  console.log(`PSD跨窗口取消证据：${desktop.root}`)
  try {
    const fixture = (await syntheticFixtures())[0]
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    const bytes = [...await readFile(fixture.absolutePath)]
    const other = await preview(desktop)
    await observe(desktop)
    await desktop.page.evaluate(bytes => {
      window.__senderParse = window.electronAPI.invoke('psd-parse-file', { fileBuffer: new Uint8Array(bytes), taskId: 'same-visible-id' })
    }, bytes)
    await desktop.application.evaluate(async () => {
      for (let i = 0; i < 1000 && globalThis.__psdSenderProbe.trace.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 1))
      if (!globalThis.__psdSenderProbe.trace.length) throw new Error('未观察到生产任务创建')
    })
    result.foreignCancel = await other.evaluate(() => window.electronAPI.invoke('psd-cancel-parse', 'same-visible-id'))
    assert.deepEqual(result.foreignCancel, { success: true, cancelled: false })
    result.cancellations = await desktop.application.evaluate(() => globalThis.__psdSenderProbe.cancellations)
    assert.equal(result.cancellations[0].settledCount, 0, '必须在原任务尚未结算时验证跨窗口取消拒绝')
    // 2、原请求仍成功，确保拒绝没有误伤其他窗口的任务。
    result.owner = await desktop.page.evaluate(async () => {
      const response = await window.__senderParse
      return { success: response.success, parsed: response.data?.success, layers: response.data?.data?.layerCount }
    })
    assert.equal(result.owner.parsed, true)
    assert.ok(result.owner.layers > 0)
    result.trace = await desktop.application.evaluate(() => globalThis.__psdSenderProbe.trace)
    assert.equal(result.trace.filter(event => event.event === 'exit').length, 1)
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'psd-cross-window-result.json'), JSON.stringify(result, null, 2)) }
  }
})

for (const destroyOn of ['online', 'message']) {
test(`PSD发送窗口销毁（${destroyOn}）终止真实活动线程，主窗口随后恢复解析`, { timeout: 90000 }, async () => {
  // 1、连续五次创建、启动解析、销毁发送窗口，再从主窗口使用相同标识恢复。
  const desktop = await launchDesktop()
  const result = { passed: false, rounds: [] }
  console.log(`PSD发送窗口销毁证据：${desktop.root}`)
  try {
    const fixture = (await syntheticFixtures())[0]
    await verifyFixture(fixture.absolutePath, fixture.sha256)
    const bytes = [...await readFile(fixture.absolutePath)]
    await observe(desktop, destroyOn)
    for (let round = 0; round < 5; round++) {
      const other = await preview(desktop)
      await desktop.application.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('canvas-preview'))
        if (!window) throw new Error('未找到真实预览窗口')
        globalThis.__psdSenderProbe.destroyWindow = window.id
      })
      const closed = other.waitForEvent('close')
      // 2、销毁后不能依靠原renderer响应，必须观测真实exit和主进程结算。
      await other.evaluate(bytes => {
        window.__destroyedParse = window.electronAPI.invoke('psd-parse-file', { fileBuffer: new Uint8Array(bytes), taskId: 'destroy-this-sender' }).catch(() => null)
      }, bytes)
      await closed
      await desktop.application.evaluate(async () => {
        const state = globalThis.__psdSenderProbe
        const id = state.next
        for (let i = 0; i < 1000 && !state.trace.some(event => event.id === id && event.event === 'exit'); i++) await new Promise(resolve => setTimeout(resolve, 1))
        if (!state.trace.some(event => event.id === id && event.event === 'exit')) throw new Error('发送窗口销毁后线程未退出')
      })
      const trace = await desktop.application.evaluate(() => {
        const state = globalThis.__psdSenderProbe
        return state.trace.filter(event => event.id === state.next)
      })
      assert.deepEqual(trace.map(event => event.event), ['created', 'online', 'sender-destroyed', 'exit'])
      const recovery = await desktop.page.evaluate(async bytes => {
        const response = await window.electronAPI.invoke('psd-parse-file', { fileBuffer: new Uint8Array(bytes), taskId: 'destroy-this-sender' })
        return { success: response.success, parsed: response.data?.success, layers: response.data?.data?.layerCount }
      }, bytes)
      assert.equal(recovery.parsed, true)
      assert.ok(recovery.layers > 0)
      const settled = await desktop.application.evaluate(() => globalThis.__psdSenderProbe.settled)
      assert.equal(settled.at(-2).parsed, false)
      assert.equal(settled.at(-2).error, 'PSD解析已取消')
      result.rounds.push({ round, trace, cancelled: settled.at(-2), recovery })
    }
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'psd-sender-destroy-result.json'), JSON.stringify(result, null, 2)) }
  }
})
}
