/** 导出日志不得包含配置密钥；边界观察仍核对实际导出/备份参数未丢失。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createSettingsArchive } from '../src/renderer/src/components/pages/SettingsPage/composables/settingsArchive.js'

test('设置导出日志不包含配置密钥，原导出和备份数据保持完整', async () => {
  const secret = 'isolated-export-secret-do-not-log'
  const logs = [], calls = [], exporting = { value: false }
  const original = console.log
  console.log = (...args) => logs.push(args)
  try {
    const { handleExportSettings } = createSettingsArchive({
      window: { electronAPI: { settings: {
        exportSettings: async settings => { calls.push(settings); return { success: true, filePath: 'isolated.json' } },
        autoBackupSettings: async settings => { calls.push(settings); return { success: true } }
      } } },
      message: { success() {}, error(message) { assert.fail(message) } },
      appVersion: { value: 'test' }, isExportingSettings: exporting,
      stickfigureConfig: { outputName: '中文 空格' }, geminiConfig: { apiKey: secret }, hotkeysConfig: {}, hdToolkitConfig: {}
    })
    await handleExportSettings()
    assert.equal(JSON.stringify(logs).includes(secret), false, '日志不能包含导出配置中的密钥')
    assert.equal(calls.length, 2)
    for (const value of calls) assert.equal(value.geminiConfig.apiKey, secret)
    assert.equal(exporting.value, false)
  } finally { console.log = original }
})
