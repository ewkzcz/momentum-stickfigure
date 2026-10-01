import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readdir, readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=='
test('网页图片拖拽：副作用前拒绝错误编码及参数并恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const invoke = (channel, payload) => desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload })
    const directory = path.join(desktop.root, 'home/Pictures/MomentumStickFigure')
    for (const channel of ['doubao:drag-start', 'doubao:prepare-file-async']) {
      const field = channel === 'doubao:drag-start' ? 'dataURL' : 'base64'
      const value = field === 'dataURL' ? `data:image/png;base64,${png}` : png
      for (const payload of [
        { [field]: '%%%', fileName: 'bad.png' },
        [],
        { [field]: value, fileName: {} },
        { [field]: value, fileName: 'a'.repeat(256) },
        { [field]: value, mimeType: [] },
        { [field]: value, iconSize: 1000000 },
        { [field]: value, fileName: '../escape.png' }
      ]) {
        const result = await invoke(channel, payload)
        assert.equal(result.success, false)
        assert.match(result.error, /参数|文件名不能包含路径/)
        assert.deepEqual(await readdir(directory).catch(error => { if (error.code === 'ENOENT') return []; throw error }), [])
      }
    }
    const direct = await invoke('doubao:drag-start', { dataURL: `data:image/png;base64,${png}`, fileName: '中文 直接.png', iconSize: 96, mimeType: 'image/png' })
    assert.equal(direct.success, true)
    assert.deepEqual(await readFile(direct.path), Buffer.from(png, 'base64'))
    const prepared = await invoke('doubao:prepare-file-async', { base64: png, fileName: '中文 准备.png', mimeType: 'image/png' })
    assert.equal(prepared.success, true)
    assert.deepEqual(await readFile(prepared.path), Buffer.from(png, 'base64'))
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.drags.length), 1)
  } finally { await desktop.close() }
})
