import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

test('配置分享默认脱敏，显式完整备份保留假密钥', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  console.log(`配置分享证据：${desktop.root}`)
  try {
    const settings = { version: '1', geminiConfig: { apiKey: 'isolated-test-key', baseUrl: 'https://example.invalid/v1' }, falConfig: { apiKey: 'isolated-old-key' }, nested: { access_token: 'isolated-token' }, enabled: false }
    const sharePath = path.join(desktop.root, '分享 配置.json')
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.savePath = value }, sharePath)
    const share = await desktop.page.evaluate(settings => window.electronAPI.settings.exportSettings(settings), settings)
    assert.equal(share.success, true)
    const shared = JSON.parse(await readFile(sharePath, 'utf8'))
    assert.equal(shared.geminiConfig.apiKey, undefined, '默认导出不包含API密钥')
    assert.equal(shared.falConfig.apiKey, undefined)
    assert.equal(shared.nested.access_token, undefined)
    assert.equal(shared.geminiConfig.baseUrl, settings.geminiConfig.baseUrl)
    assert.equal(shared.enabled, false)
    const backupPath = path.join(desktop.root, '完整 备份.json')
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.savePath = value }, backupPath)
    const backup = await desktop.page.evaluate(settings => window.electronAPI.settings.exportSettings(settings, { includeSecrets: true }), settings)
    assert.equal(backup.success, true)
    assert.deepEqual(JSON.parse(await readFile(backupPath, 'utf8')), settings)
    await desktop.page.evaluate(() => { localStorage.setItem('gemini-image-config', JSON.stringify({ apiKey: 'local-retained-key', baseUrl: 'https://example.invalid' })); location.hash = '/settings/about' })
    await desktop.page.getByRole('button', { name: '导出设置', exact: true }).waitFor()
    const checkbox = desktop.page.getByRole('checkbox', { name: '完整备份（包含 API 密钥，请勿分享）' })
    assert.equal(await checkbox.isChecked(), false)
    const importedPath = path.join(desktop.root, '无密钥 分享.json')
    await writeFile(importedPath, JSON.stringify({ geminiConfig: { baseUrl: 'https://shared.invalid' } }))
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.openPaths = [value] }, importedPath)
    await desktop.page.getByRole('button', { name: '导入设置', exact: true }).click()
    await desktop.page.getByText('配置导入成功！所有设置已更新', { exact: true }).waitFor()
    assert.equal(await desktop.page.evaluate(() => JSON.parse(localStorage.getItem('gemini-image-config')).apiKey), 'local-retained-key')
    await checkbox.check()
    const uiBackup = path.join(desktop.root, '界面 完整备份.json')
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.savePath = value }, uiBackup)
    await desktop.page.getByRole('button', { name: '导出设置', exact: true }).click()
    await desktop.page.getByText(`配置已导出到: ${uiBackup}`, { exact: true }).waitFor()
    assert.equal(JSON.parse(await readFile(uiBackup, 'utf8')).geminiConfig.apiKey, 'local-retained-key')
    await writeFile(importedPath, JSON.stringify({ falConfig: { apiKey: 'restored-legacy-key', baseUrl: 'https://legacy.invalid' } }))
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.openPaths = [value] }, importedPath)
    await desktop.page.getByRole('button', { name: '导入设置', exact: true }).click()
    await desktop.page.waitForFunction(() => JSON.parse(localStorage.getItem('gemini-image-config')).apiKey === 'restored-legacy-key')
    await writeFile(importedPath, JSON.stringify({ geminiConfig: { apiKey: '', baseUrl: 'https://clear.invalid' } }))
    await desktop.application.evaluate((_, value) => { globalThis.__momentumTest.openPaths = [value] }, importedPath)
    await desktop.page.getByRole('button', { name: '导入设置', exact: true }).click()
    await desktop.page.waitForFunction(() => JSON.parse(localStorage.getItem('gemini-image-config')).apiKey === '')
  } finally { await desktop.close() }
})
