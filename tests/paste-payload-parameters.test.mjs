import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('粘贴图片载荷：拒绝非法编码且保留同名原图，拒绝后恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const save = value => desktop.page.evaluate(value => window.electronAPI.invoke('save-temp-image', value, '原图.png'), value)
    const saved = await save('aGVsbG8=')
    assert.equal(saved.success, true)
    for (const value of ['%%%=', 'data:image/png;base64,aGVsbG8=', 'a===', {}]) {
      assert.equal((await save(value)).success, false)
      assert.equal(await readFile(saved.path, 'utf8'), 'hello')
    }
    assert.equal((await save('bmV3')).success, true)
    assert.equal(await readFile(path.join(desktop.root, 'temp', 'momentum-stickfigure-paste', '原图.png'), 'utf8'), 'new')
  } finally { await desktop.close() }
})
