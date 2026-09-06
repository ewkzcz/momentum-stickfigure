/** 关键业务回归：真实 Electron 图像链路与磁盘配置恢复，失败统一返回非零状态。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { launchDesktop, readJson } from './helpers/desktop.mjs'
import { fixtures, checkPsdFixture, syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { checkPresetLifecycle } from './scenarios/presets.mjs'

/** 在有界时间内反复检查可观察条件，不以等待时长代替成功。 */
async function until(predicate, description, timeout = 15000) {
  // 1、成功条件由调用方实际读取磁盘或任务终态决定。
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (await predicate()) return
    await pollDelay(25)
  }
  assert.fail(`等待失败：${description}`)
}

test('PSD 合成与导出：指定素材操作和 RGBA 参考一致', { timeout: 600000 }, async (context) => {
  // 1、缺素材或缺参考直接失败，不把缺失场景当成成功跳过。
  for (const fixture of await fixtures()) await context.test(fixture.id, () => checkPsdFixture(fixture))
})

test('PSD 自制素材：蒙版、剪切组和混合模式保持一致', { timeout: 180000 }, async (context) => {
  // 1、实际输入每次重新生成，预期仍只读取业务修改前保存的图像参考。
  for (const fixture of await syntheticFixtures()) await context.test(fixture.id, () => checkPsdFixture(fixture, false, syntheticReferenceDirectory))
})

test('PSD 预设生命周期：跨素材恢复、删除与重启一致', { timeout: 120000 }, () => checkPresetLifecycle())

test('配置持久化：实际磁盘保存、重启恢复与写入失败保护', { timeout: 90000 }, async () => {
  // 1、通过实际存储 IPC 写入代表性设置及预设字符串，等待磁盘完成保存。
  let desktop = await launchDesktop()
  const root = desktop.root
  console.log(`配置回归目录：${root}`)
  const storagePath = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  const values = {
    'regression:settings': JSON.stringify({ theme: 'dark', outputName: '中文 空格', enableTrimWhitespace: 'trim' }),
    'regression:presets': JSON.stringify([{ name: '回归预设', parts: ['左手', '眉毛'], enabled: true }])
  }
  try {
    // 持续提交无关字段，验证设置保存不会被其他模块的更新无限推迟。
    await desktop.page.evaluate(() => {
      window.__regressionStorageWriter = setInterval(() => {
        window.electronAPI.invoke('storage:setItem', 'regression:continuous', String(Date.now()))
      }, 250)
    })
    for (const [key, value] of Object.entries(values)) {
      const result = await desktop.page.evaluate(([k, v]) => window.electronAPI.invoke('storage:setItem', k, v), [key, value])
      assert.equal(result.success, true)
    }
    await until(async () => {
      const data = await readJson(storagePath).catch(() => ({}))
      return Object.entries(values).every(([key, value]) => data[key] === value)
    }, '真实配置文件写入')
  } finally { await desktop.close() }

  // 2、完全关闭进程后重建实际服务，核验数据来自旧磁盘文件。
  desktop = await launchDesktop(root)
  try {
    for (const [key, value] of Object.entries(values)) {
      const restored = await desktop.page.evaluate((k) => window.electronAPI.invoke('storage:getItem', k), key)
      assert.equal(restored.value, value, '重启后配置或预设字符串丢失')
    }
    // 3、仅在真实写入边界注入 EIO，保持已有文件不变，并等待故障确实发生。
    await desktop.application.evaluate(() => { globalThis.__momentumTest.faults.storageWrite = true })
    await desktop.page.evaluate(() => window.electronAPI.invoke('storage:setItem', 'regression:settings', '写入失败时不应替换旧文件'))
    await until(() => desktop.application.evaluate(() => globalThis.__momentumTest.faults.storageWriteFailures > 0), '配置写入故障触发')
    const afterFailure = await readJson(storagePath)
    assert.equal(afterFailure['regression:settings'], values['regression:settings'])
  } finally { await desktop.close() }

  // 4、故障后的新进程仍须读取旧数据；不以旧实例内存缓存证明恢复成功。
  desktop = await launchDesktop(root)
  try {
    const result = await desktop.page.evaluate(() => window.electronAPI.invoke('storage:getItem', 'regression:settings'))
    assert.equal(result.value, values['regression:settings'])
    assert.deepEqual(desktop.errors, [])
    console.log(`配置回归证据：${root}`)
  } finally { await desktop.close() }
})
