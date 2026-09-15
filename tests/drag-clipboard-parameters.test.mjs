import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('拖拽图片参数：副作用前拒绝错误载荷、路径文件名和配置，随后恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const outputRoot = path.join(desktop.root, 'temp', '中文 拖拽输出')
    const invoke = (channel, args) => desktop.page.evaluate(({ channel, args }) => window.electronAPI.invoke(channel, ...args), { channel, args })
    const config = { outputRoot, overwriteMode: 'rename', createPsdFolder: false }
    for (const [data, icon, name, options] of [
      ['%%%=', null, '图.png', config],
      ['data:image/png;base64,eA==', null, '图.png', config],
      ['eA==', null, '../越界.png', config],
      ['eA==', null, '目录\\越界.png', config],
      ['eA==', null, '图.png', []],
      ['eA==', null, '图.png', { ...config, createPsdFolder: 'true' }],
      ['eA==', null, '图.png', { ...config, overwriteMode: 'unknown' }],
      ['eA==', { dataURL: 'data:image/png;base64,eA==', size: 1000000 }, '图.png', config],
      ['eA==', { dataURL: '%%%' }, '图.png', config]
    ]) {
      const result = await invoke('create-temp-file-and-start-drag', [data, icon, name, options])
      assert.equal(result.success, false)
      assert.match(result.error, /参数/)
      assert.deepEqual(await readdir(outputRoot).catch(error => { if (error.code === 'ENOENT') return []; throw error }), [])
    }
    const copied = await invoke('save-drag-image-and-copy', ['%%%', null, config])
    assert.equal(copied.success, false)
    assert.match(copied.error, /参数/)
    for (const text of [{}, ['text'], 'a\0b', 'x'.repeat(1024 * 1024 + 1)]) {
      assert.equal((await invoke('copy-to-clipboard', [text])).success, false)
    }
    assert.equal((await invoke('copy-to-clipboard', ['中文 text'])).success, true)
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.clipboard), '中文 text')
    for (let round = 0; round < 2; round++) {
      const result = await invoke('create-temp-file-and-start-drag', ['aGVsbG8=', null, '中文 空格.png', config])
      assert.equal(result.success, true)
      assert.equal(await readFile(result.filePath, 'utf8'), 'hello')
    }
    assert.equal((await readdir(outputRoot)).length, 2)
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.drags.length), 2)
    const saved = await invoke('save-drag-image-and-copy', ['aGVsbG8=', null, config])
    assert.equal(saved.success, true)
    assert.equal(await readFile(saved.filePath, 'utf8'), 'hello')
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.clipboard), saved.filePath)
  } finally { await desktop.close() }
})
