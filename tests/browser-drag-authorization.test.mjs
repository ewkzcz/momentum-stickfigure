import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { mkdir, readFile, readdir, symlink, unlink, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4N8AAAAASUVORK5CYII='
test('网页图片目录授权：拒绝输出目录和目标链接，保留覆盖恢复', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const directory = path.join(desktop.root, 'home/Pictures/MomentumStickFigure')
    const outside = path.join(desktop.root, 'temp/owned-outside')
    await mkdir(outside)
    const marker = path.join(outside, 'marker.png')
    await writeFile(marker, 'keep')
    const call = channel => desktop.page.evaluate(({ channel, png }) => window.electronAPI.invoke(channel, { base64: png, dataURL: `data:image/png;base64,${png}`, fileName: 'marker.png' }), { channel, png })
    const channels = ['doubao:prepare-file-async', 'doubao:drag-start']
    await symlink(outside, directory, 'dir')
    for (const channel of channels) {
      const result = await call(channel)
      assert.equal(result.success, false)
      assert.match(result.error, /符号链接/)
      assert.equal(await readFile(marker, 'utf8'), 'keep')
      assert.deepEqual(await readdir(outside), ['marker.png'])
    }
    await unlink(directory)
    await mkdir(directory)
    const target = path.join(directory, 'marker.png')
    await symlink(marker, target)
    for (const channel of channels) {
      assert.equal((await call(channel)).success, false)
      assert.equal(await readFile(marker, 'utf8'), 'keep')
    }
    await unlink(target)
    for (const channel of channels) {
      assert.equal((await call(channel)).success, true)
      assert.deepEqual(await readFile(target), Buffer.from(png, 'base64'))
    }
    assert.equal(await desktop.application.evaluate(() => globalThis.__momentumTest.drags.length), 1)
  } finally { await desktop.close() }
})
