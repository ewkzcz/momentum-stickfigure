/** 网页图片写入路径回归：隔离自有哨兵验证拒绝路径，原helper记录拖拽而不触真实系统。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a4N8AAAAASUVORK5CYII='
for (const channel of ['doubao:prepare-file-async', 'doubao:drag-start']) {
  test(`网页图片路径：${channel}拒绝路径名称并保留正常与默认写入`, { timeout: 60000 }, async () => {
    // 1、自有哨兵位于隔离Pictures内，但在业务MomentumStickFigure子目录之外。
    const desktop = await launchDesktop()
    const result = { channel, passed: false, rejected: [], accepted: [] }
    console.log(`网页图片路径证据：${desktop.root}`)
    try {
      const paths = await desktop.application.evaluate(({ app }) => {
        const fs = process.getBuiltinModule('fs')
        const path = process.getBuiltinModule('path')
        const marker = path.join(app.getPath('pictures'), 'regression-owned-marker.txt')
        fs.writeFileSync(marker, 'owned-marker-original')
        return { marker, target: path.join(app.getPath('pictures'), 'MomentumStickFigure') }
      })
      const payload = { base64: png, dataURL: `data:image/png;base64,${png}`, mimeType: 'image/png' }
      const rejectedNames = ['../regression-owned-marker.txt', '..\\regression-owned-marker.txt', './nested.png', 'nested/file.png', 'nested\\file.png', '.', '..', paths.marker, 'C:\\temp\\owned.png']
      for (const fileName of rejectedNames) {
        const before = await desktop.application.evaluate(() => ({ writes: globalThis.__momentumTest.writes.length, drags: globalThis.__momentumTest.drags.length }))
        const response = await desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload: { ...payload, fileName } })
        assert.deepEqual(response, { success: false, error: '文件名不能包含路径' })
        const after = await desktop.application.evaluate((_electron, marker) => ({ writes: globalThis.__momentumTest.writes.length, drags: globalThis.__momentumTest.drags.length, marker: process.getBuiltinModule('fs').readFileSync(marker, 'utf8') }), paths.marker)
        assert.equal(after.marker, 'owned-marker-original')
        assert.equal(after.writes, before.writes, '拒绝名称不得先创建目录或写文件')
        assert.equal(after.drags, before.drags, '拒绝名称不得发起拖拽')
        result.rejected.push({ fileName: fileName === paths.marker ? '<isolated-absolute-marker>' : fileName, response })
      }
      // 2、保留中文空格、去首尾空白、数值转字符串和缺省命名的旧语义。
      for (const fileName of ['合法 图片.png', '  去空白.png  ', '', '   ', 42, false, null]) {
        const before = await desktop.application.evaluate(() => globalThis.__momentumTest.drags.length)
        const response = await desktop.page.evaluate(({ channel, payload }) => window.electronAPI.invoke(channel, payload), { channel, payload: { ...payload, fileName } })
        assert.equal(response.success, true)
        assert.equal(path.dirname(response.path), paths.target)
        if (fileName && String(fileName).trim()) assert.equal(path.basename(response.path), String(fileName).trim())
        else assert.match(path.basename(response.path), /^doubao_\d+\.png$/)
        const actual = await desktop.application.evaluate((_electron, file) => ({ bytes: process.getBuiltinModule('fs').readFileSync(file).toString('base64'), drags: globalThis.__momentumTest.drags.length, lastDrag: globalThis.__momentumTest.drags.at(-1) }), response.path)
        assert.equal(actual.bytes, png)
        assert.equal(actual.drags - before, channel === 'doubao:drag-start' ? 1 : 0)
        if (channel === 'doubao:drag-start') assert.equal(actual.lastDrag.file, response.path)
        result.accepted.push({ fileName, success: response.success, basename: path.basename(response.path) })
      }
      assert.deepEqual(desktop.errors, [])
      result.passed = true
    } catch (error) { result.failure = error.message; throw error }
    finally {
      // 3、执行原后台窗口和磁盘隔离退出检查，不改保护策略。
      try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'browser-image-path-result.json'), JSON.stringify(result, null, 2)) }
    }
  })
}
