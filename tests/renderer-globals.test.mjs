/** renderer静态全局回归：验证真实浏览器API存在且ESLint声明不扩散到主进程。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { ESLint } from 'eslint'
import { launchDesktop } from './helpers/desktop.mjs'

const names = ['TextEncoder', 'crypto', 'alert', 'fetch', 'confirm', 'CustomEvent', 'requestIdleCallback']

test('renderer全局能力：真实Electron存在标准API且静态声明仅用于renderer', async () => {
  // 1、真实页面只读API类型，不调用弹窗、网络或空闲调度。
  const desktop = await launchDesktop()
  const result = { passed: false }
  console.log(`浏览器全局能力证据：${desktop.root}`)
  try {
    result.types = await desktop.page.evaluate(names => Object.fromEntries(names.map(name => [name, typeof window[name]])), names)
    assert.deepEqual(result.types, { TextEncoder: 'function', crypto: 'object', alert: 'function', fetch: 'function', confirm: 'function', CustomEvent: 'function', requestIdleCallback: 'function' })
    // 2、检查有效配置和实际lintText，未定义的非标准名字仍必须报错。
    const eslint = new ESLint()
    const renderer = await eslint.calculateConfigForFile('src/renderer/src/utils/global-probe.js')
    const main = await eslint.calculateConfigForFile('src/main/global-probe.js')
    for (const name of names) {
      assert.equal(renderer.languageOptions.globals[name], 'readonly')
      assert.equal(main.languageOptions.globals[name], undefined)
    }
    const [valid] = await eslint.lintText(names.map(name => `void ${name};`).join('\n'), { filePath: 'src/renderer/src/utils/global-probe.js' })
    assert.equal(valid.errorCount, 0)
    const [unknown] = await eslint.lintText('void regressionUnknownBrowserGlobal;', { filePath: 'src/renderer/src/utils/global-probe.js' })
    assert.equal(unknown.errorCount, 1)
    assert.equal(unknown.messages[0].ruleId, 'no-undef')
    result.passed = true
  } finally {
    // 3、沿用未修改的后台与文件隔离退出检查。
    try { await desktop.close() } finally { await writeFile(path.join(desktop.root, 'renderer-globals-result.json'), JSON.stringify(result, null, 2)) }
  }
})
