/** 系统拖拽失败回归：受控原生边界抛错，不实际启动系统拖拽或改变后台保护。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 查询当前主窗口焦点监听数。
 * 处理流程：
 * 1、只读原生EventEmitter计数，不触发原生聚焦事件。
 */
async function focusCount(desktop) {
  // 1、原后台保护自身的订阅也计入原始基线。
  return desktop.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].listenerCount('focus'))
}

test('系统拖拽启动失败：20轮不残留焦点订阅并保持写入和成功路径', { timeout: 30000 }, async () => {
  // 1、只把原helper已替代的系统入口切换为受控异常，未执行真实startDrag。
  const desktop = await launchDesktop()
  const result = { passed: false, rounds: [] }
  console.log(`拖拽启动失败证据：${desktop.root}`)
  try {
    const baseline = await focusCount(desktop)
    await desktop.application.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      globalThis.__originalTestStartDrag = window.webContents.startDrag
      window.webContents.startDrag = () => { throw new Error('受控系统拖拽启动失败') }
    })
    const root = path.join(desktop.root, 'drag-output')
    for (let round = 0; round < 20; round++) {
      const response = await desktop.page.evaluate(({ root, round }) => window.electronAPI.invoke('create-temp-file-and-start-drag', 'aXNvbGF0ZWQ=', null, `failed-${round}.png`, { outputRoot: root }), { root, round })
      assert.deepEqual(response, { success: false, error: '受控系统拖拽启动失败' })
      const listeners = await focusCount(desktop)
      assert.equal(listeners, baseline, '失败的原生启动不应保留拖拽结束监听')
      assert.equal(await readFile(path.join(root, `failed-${round}.png`), 'utf8'), 'isolated', '保持启动前已落盘内容，不混改文件语义')
      result.rounds.push({ round, baseline, listeners })
    }
    // 2、恢复原helper记录入口，成功请求仍新增一次性回焦监听并记录实际文件路径。
    await desktop.application.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].webContents.startDrag = globalThis.__originalTestStartDrag
    })
    result.recovery = await desktop.page.evaluate(root => window.electronAPI.invoke('create-temp-file-and-start-drag', 'aXNvbGF0ZWQ=', null, 'recovery.png', { outputRoot: root }), root)
    assert.deepEqual(result.recovery, { success: true, filePath: path.join(root, 'recovery.png') })
    assert.equal(await focusCount(desktop), baseline + 1)
    const drags = await desktop.application.evaluate(() => globalThis.__momentumTest.drags)
    assert.equal(drags.length, 1)
    assert.equal(drags[0].file, result.recovery.filePath)
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    // 3、保持原退出隔离检查，不人为emit focus绕过后台保护。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'drag-start-failure-result.json'), JSON.stringify(result, null, 2)) }
  }
})
