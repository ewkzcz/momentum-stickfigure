/** 协议迁移兼容：仅使用隔离旧共享配置，验证新来源挂载、公开保存和独立重启。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as poll } from 'node:timers/promises'
import { launchDesktop } from './helpers/desktop.mjs'
import { MAIN_APPLICATION_URL } from '../src/main/application-protocol.js'

async function openSettings(desktop) {
  await desktop.page.evaluate(() => { location.hash = '/settings/stickfigure' })
  const item = desktop.page.locator('.n-tab-pane:visible .n-form-item').filter({
    has: desktop.page.locator('.n-form-item-label').getByText('图片保存根目录', { exact: true })
  })
  await item.locator('input').waitFor()
  return item
}

test('应用协议：隔离旧共享配置在新来源恢复、公开保存后独立进程重启一致', { timeout: 90000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-protocol-storage-'))
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const oldOutput = path.join(root, '原配置 中文目录')
  const newOutput = path.join(root, '重新选择 中文目录')
  for (const directory of [path.dirname(file), oldOutput, newOutput]) await mkdir(directory, { recursive: true })
  const oldConfig = { outputRoot: oldOutput, fileNamingRule: 'hash-only', createPsdFolder: false, enableFuzzyMatch: false }
  const retained = JSON.stringify({ name: '旧配置保留字段', enabled: false })
  await writeFile(file, JSON.stringify({ 'stickfigure-config': JSON.stringify(oldConfig), 'protocol-migration-retained': retained }))
  const evidence = { root, entry: MAIN_APPLICATION_URL, passed: false, scope: '隔离共享JSON；不读取真实配置或迁移旧file来源LevelDB' }
  let desktop
  try {
    desktop = await launchDesktop(root)
    assert.equal(desktop.page.url().split('#')[0], MAIN_APPLICATION_URL)
    // launchDesktop已等待真实Vue挂载；此时磁盘快照应已同步到新的应用来源。
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config'))), oldConfig)
    assert.equal(await desktop.page.evaluate(() => localStorage.getItem('protocol-migration-retained')), retained)
    const item = await openSettings(desktop)
    assert.equal(await item.locator('input').inputValue(), oldOutput)
    await desktop.application.evaluate((_, selected) => { globalThis.__momentumTest.openPaths = [selected] }, newOutput)
    await item.getByRole('button', { name: '选择文件夹', exact: true }).click()
    assert.equal(await item.locator('input').inputValue(), newOutput)
    await desktop.page.locator('.n-tab-pane:visible').getByRole('button', { name: '保存配置', exact: true }).click()
    await desktop.page.locator('.n-message--success-type').filter({ hasText: '设置已保存' }).waitFor()
    const saved = await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config')))
    assert.equal(saved.outputRoot, newOutput)
    assert.equal(saved.createPsdFolder, false)
    assert.equal(saved.enableFuzzyMatch, false)
    let disk
    const deadline = Date.now() + 15000
    do {
      disk = JSON.parse(await readFile(file, 'utf8'))
      if (JSON.parse(disk['stickfigure-config']).outputRoot === newOutput) break
      await poll(25)
    } while (Date.now() < deadline)
    assert.deepEqual(JSON.parse(disk['stickfigure-config']), saved)
    assert.equal(disk['protocol-migration-retained'], retained)
    assert.deepEqual(desktop.errors, [])
    await desktop.close()
    desktop = null
    desktop = await launchDesktop(root)
    assert.equal(desktop.page.url().split('#')[0], MAIN_APPLICATION_URL)
    assert.deepEqual(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('stickfigure-config'))), saved)
    assert.equal(await desktop.page.evaluate(() => localStorage.getItem('protocol-migration-retained')), retained)
    assert.equal(await (await openSettings(desktop)).locator('input').inputValue(), newOutput)
    assert.deepEqual(desktop.errors, [])
    evidence.saved = saved
    evidence.passed = true
  } finally {
    try { if (desktop) await desktop.close() } finally {
      await writeFile(path.join(root, 'application-protocol-storage.json'), JSON.stringify(evidence, null, 2))
      console.log(`应用协议存储恢复证据：${root}`)
    }
  }
})
