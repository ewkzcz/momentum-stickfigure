import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop, repository } from './helpers/desktop.mjs'

const summarize = values => {
  const sorted = [...values].sort((a, b) => a - b)
  return { count: values.length, p50: sorted[Math.ceil(sorted.length * .5) - 1], p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }
}

test('大数据文件操作实测：六百万字符存储和8MiB读写的IPC影响', { timeout: 120000 }, async () => {
  const desktop = await launchDesktop()
  const result = { operations: {}, passed: false }
  try {
    const measured = {}
    for (const operation of ['storage', 'write', 'read']) {
      if (operation === 'read') {
        // 原生选择边界沿用隔离替身；真实生产授读发生在计时之前，不从写入隐式继承权限。
        for (let index = 0; index < 20; index++) {
          const file = path.join(desktop.root, `measure-${index}.bin`)
          await desktop.application.evaluate((_electron, selected) => { globalThis.__momentumTest.openPaths = [selected] }, file)
          assert.deepEqual(await desktop.page.evaluate(() => window.electronAPI.invoke('select-file', {})), {
            success: true, canceled: false, paths: [file], path: file
          })
        }
      }
      measured[operation] = await desktop.page.evaluate(async ({ root, operation }) => {
      const text = 'x'.repeat(6000000)
      const binary = 'a'.repeat(8 * 1024 * 1024)
      const encoded = btoa(binary)
      const durations = [], probes = []
        for (let index = 0; index < 20; index++) {
          const start = performance.now()
          const file = `${root}/measure-${index}.bin`
          const pending = operation === 'storage'
            ? window.electronAPI.storage.setItem('isolated-large-measurement', text)
            : operation === 'write'
              ? window.electronAPI.writeFile(file, encoded)
              : window.electronAPI.readFile(file)
          const probeStart = performance.now()
          const probe = window.electronAPI.storage.length().then(value => { if (!value.success) throw new Error('IPC探针失败'); probes.push(performance.now() - probeStart) })
          const value = await pending
          durations.push(performance.now() - start)
          if (operation === 'read') {
            if (!value || value.byteLength !== binary.length || value[0] !== 97 || value[value.length - 1] !== 97) throw new Error('读取字节不符')
          } else if (!value.success) throw new Error(value.error || '文件操作失败')
          await probe
        }
      return { durations, probes }
      }, { root: desktop.root, operation })
    }
    assert.equal((await desktop.page.evaluate(() => window.electronAPI.storage.removeItem('isolated-large-measurement'))).success, true, '测量键清理失败')
    for (const [name, values] of Object.entries(measured)) result.operations[name] = { duration: summarize(values.durations), ipc: summarize(values.probes), raw: values }
    result.passed = true
    console.log(JSON.stringify(Object.fromEntries(Object.entries(result.operations).map(([name, value]) => [name, { duration: value.duration, ipc: value.ipc }]))))
    assert.deepEqual(desktop.errors, [])
  } finally {
    await writeFile(path.join(repository, 'temp/file-operation-measurement-result.json'), JSON.stringify(result, null, 2))
    await desktop.close()
  }
})
