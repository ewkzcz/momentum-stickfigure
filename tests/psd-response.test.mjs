/** PSD 响应契约回归：补充包装层成功/失败分支，真实上传链路另由桌面测试覆盖。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { usePsdParser } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/usePsdParser.js'

test('PSD 解析响应：保留两种成功数据格式并传播包装层失败', async () => {
  // 1、只在本测试进程控制 IPC 返回值，验证原接口的数据格式兼容性。
  const originalWindow = globalThis.window
  const data = { width: 32, height: 32, layers: [] }
  const file = { arrayBuffer: async () => new ArrayBuffer(8) }
  const { parsePsdFile } = usePsdParser({})
  try {
    for (const response of [{ success: true, data }, { success: true, data: { success: true, data } }]) {
      globalThis.window = { electronAPI: { invoke: async (channel) => {
        assert.equal(channel, 'psd-parse-file')
        return response
      } } }
      assert.equal(await parsePsdFile(file), data, '成功时必须返回原数据而非改写或复制')
    }
    // 2、外层与内层失败都必须拒绝；错误详情优先使用服务提供的信息。
    for (const [response, message] of [
      [{ success: false, error: '外层失败' }, '外层失败'],
      [{ success: true, data: { success: false, error: '损坏PSD' } }, '损坏PSD'],
      [{ success: true, data: { success: false, message: '解析器失败' } }, '解析器失败'],
      [{ success: true, data: { success: false } }, 'PSD文件解析失败']
    ]) {
      globalThis.window = { electronAPI: { invoke: async () => response } }
      await assert.rejects(parsePsdFile(file), { message })
    }
  } finally {
    // 3、恢复测试环境，避免污染同进程的后续验证。
    if (originalWindow === undefined) delete globalThis.window
    else globalThis.window = originalWindow
  }
})
