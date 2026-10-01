/** 共享存储原子性回归：真实IPC、实际磁盘读者和原保存计时；不放宽JSON解析断言。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/**
 * 获取隔离共享存储路径。
 * 处理流程：
 * 1、仅使用原helper提供的隔离home，不读取用户配置。
 */
function storageFile(desktop) {
  // 1、与原生产共享目录约定保持一致。
  return path.join(desktop.root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
}

test('共享存储原子替换：连续写入期间读者只看到完整JSON', { timeout: 90000 }, async () => {
  // 1、使用可公开重复生成的大字符串，不包含私人素材或密钥。
  const desktop = await launchDesktop()
  const result = { passed: false, reads: 0, rounds: [], invalid: [] }
  const file = storageFile(desktop)
  console.log(`共享存储原子性证据：${desktop.root}`)
  try {
    for (let round = 0; round < 3; round++) {
      const value = `${round}:` + '公开隔离数据'.repeat(1000000)
      assert.deepEqual(await desktop.page.evaluate(value => window.electronAPI.invoke('storage:setItem', 'regression-atomicity', value), value), { success: true })
      let completed = false
      const deadline = Date.now() + 15000
      // 2、记录任意一次非法读，不通过忽略解析异常或重试来把失败改成通过。
      while (Date.now() < deadline) {
        let bytes
        try { bytes = await readFile(file) } catch (error) { if (error.code !== 'ENOENT') throw error }
        if (bytes) {
          result.reads++
          try { if (JSON.parse(bytes.toString())['regression-atomicity'] === value) completed = true } catch (error) {
            result.invalid.push({ round, byteLength: bytes.length, error: error.message })
          }
        }
        if (completed) break
        await delay(1)
      }
      result.rounds.push({ round, completed })
      assert.equal(completed, true, '生产保存应按原计时在15秒内完成')
    }
    assert.deepEqual(result.invalid, [], '实际读者不应看到截断或尚未写完的共享JSON')
    assert.deepEqual((await readdir(path.dirname(file))).filter(name => name.startsWith('.storage-write-')), [], '成功替换后回收本次临时目录')
    assert.deepEqual(desktop.errors, [])
    result.passed = true
  } finally {
    // 3、正常生产退出后仍执行原helper写入边界及后台保护核验。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'storage-atomicity-result.json'), JSON.stringify(result, null, 2)) }
  }
})

test('共享存储退出：旧异步回调不得覆盖退出时最新同步快照', { timeout: 30000 }, async () => {
  // 1、只在真实异步写入完成后暂存回调，实际写入字节和生产计时均保持不变。
  const desktop = await launchDesktop()
  const result = { passed: false }
  let closed = false
  console.log(`共享存储退出顺序证据：${desktop.root}`)
  try {
    await desktop.application.evaluate(({ app }) => {
      const fs = process.getBuiltinModule('fs')
      const original = fs.writeFile
      const state = globalThis.__storageExitOrder = { release: null, held: false, before: null, after: null }
      fs.writeFile = function (file, data, encoding, callback) {
        if (state.held || !String(file).endsWith('shared-storage.json')) return original.call(this, file, data, encoding, callback)
        state.held = true
        return original.call(this, file, data, encoding, (...args) => { state.release = () => callback(...args) })
      }
      // 2、原storage will-quit监听先同步保存；此观察随后释放旧回调并立即读取实际文件。
      app.on('will-quit', () => {
        if (!state.release) return
        const file = `${process.env.HOME}/.config/momentum-stickfigure-open/shared-storage.json`
        state.before = JSON.parse(fs.readFileSync(file, 'utf8'))['regression-exit-order']
        state.release()
        state.release = null
        state.after = JSON.parse(fs.readFileSync(file, 'utf8'))['regression-exit-order']
        fs.writeFileSync(`${globalThis.__momentumTest.root}/storage-exit-order-observation.json`, JSON.stringify({ before: state.before, after: state.after }))
      })
    })
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('storage:setItem', 'regression-exit-order', 'old-async')), { success: true })
    await desktop.application.evaluate(async () => {
      for (let i = 0; i < 1500 && !globalThis.__storageExitOrder.release; i++) await new Promise(resolve => setTimeout(resolve, 10))
      if (!globalThis.__storageExitOrder.release) throw new Error('未观察到生产异步保存完成')
    })
    assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('storage:setItem', 'regression-exit-order', 'latest-sync')), { success: true })
    await desktop.close()
    closed = true
    result.observed = JSON.parse(await readFile(path.join(desktop.root, 'storage-exit-order-observation.json'), 'utf8'))
    assert.deepEqual(result.observed, { before: 'latest-sync', after: 'latest-sync' })
    assert.equal(JSON.parse(await readFile(storageFile(desktop), 'utf8'))['regression-exit-order'], 'latest-sync')
    assert.deepEqual((await readdir(path.dirname(storageFile(desktop)))).filter(name => name.startsWith('.storage-write-')), [])
    result.passed = true
  } finally {
    try { if (!closed) await desktop.close() } finally { await writeFile(path.join(desktop.root, 'storage-exit-order-result.json'), JSON.stringify(result, null, 2)) }
  }
})
