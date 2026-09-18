/** PSD 历史保留 before：直接导入真实无依赖模块；受控读取/解析结果是单元夹具，不是后端 IPC 授权证据。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { File as NodeFile } from 'node:buffer'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { usePsdHistory } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/usePsdHistory.js'

const historyKey = 'psd-file-history'
const options = { timeout: 10000, concurrency: false }

/** 独立内存存储，不访问 Node/浏览器已有 localStorage；保留原始文本以发现意外重写。 */
function memoryStorage(initial) {
  const values = new Map([[historyKey, initial]])
  const writes = []
  return {
    writes,
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem(key, value) { writes.push(['set', String(key), String(value)]); values.set(String(key), String(value)) },
    removeItem(key) { writes.push(['remove', String(key)]); values.delete(String(key)) }
  }
}

/** 仅在调用真实模块期间提供其三个浏览器依赖，finally 精确恢复描述符；不触碰 document 或注册事件。 */
async function withHistory(t, scenario, run) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-history-retention-'))
  const first = path.join(root, '历史 人物 中文.psd')
  const second = path.join(root, '第二 人物.psd')
  const firstBytes = Buffer.from([0, 1, 127, 128, 255, ...Buffer.from('历史字节')])
  const secondBytes = Buffer.from('第二份隔离字节')
  await writeFile(first, firstBytes, { flag: 'wx' })
  await writeFile(second, secondBytes, { flag: 'wx' })
  const paths = scenario === 'mixed' ? [first, second] : [first]
  const original = JSON.stringify(paths, null, 2)
  const storage = memoryStorage(original)
  const calls = []
  const messages = []
  const failures = []
  const message = Object.fromEntries(['warning', 'error', 'info', 'success', 'loading', 'destroyAll'].map(name => [name, (...args) => messages.push({ name, args })]))
  const browser = {
    electronAPI: {
      async checkFileExists(filePath) {
        calls.push(['check', filePath])
        assert.ok(paths.includes(filePath), '单元夹具不得访问历史以外的路径')
        if (scenario === 'cancelled') throw Object.assign(new Error('受控读取取消'), { name: 'AbortError' })
        return scenario !== 'check-false' && !(scenario === 'mixed' && filePath === first)
      },
      async readFile(filePath) {
        calls.push(['read', filePath])
        assert.ok(paths.includes(filePath), '单元夹具不得访问历史以外的路径')
        if (scenario === 'read-null') return null
        return new Uint8Array(filePath === first ? firstBytes : secondBytes)
      }
    }
  }
  const processed = []
  const processFile = async (file, flag) => {
    calls.push(['process', file.path])
    processed.push({ path: file.path, name: file.name, type: file.type, flag, bytes: [...new Uint8Array(await file.arrayBuffer())] })
    if (scenario === 'process-fails') throw new Error('受控解析失败：不运行 PSD 引擎')
  }
  const replacements = { window: browser, localStorage: storage, File: NodeFile }
  const descriptors = new Map(Object.keys(replacements).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  const installed = []
  try {
    for (const [key, value] of Object.entries(replacements)) {
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
      installed.push(key)
    }
    const history = usePsdHistory({
      psdFiles: { value: scenario === 'opened' ? [{ filePath: first, name: path.basename(first) }] : [] },
      processFile,
      message
    })
    t.diagnostic(`仅历史模块单元测试；隔离原文件：${root}；check/read/process 为受控边界，不是后端授权通过。`)
    await run({ history, storage, original, first, second, firstBytes, secondBytes, calls, processed, messages })
  } catch (error) { failures.push(error) }
  finally {
    for (const key of installed.reverse()) {
      try {
        const descriptor = descriptors.get(key)
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else delete globalThis[key]
      } catch (error) { failures.push(error) }
    }
    // 历史文本删除与磁盘文件删除分别断言；即使历史断言失败也检查原文件。
    for (const [filePath, bytes] of [[first, firstBytes], [second, secondBytes]]) {
      try { assert.deepEqual(await readFile(filePath), bytes, '原 PSD 夹具必须保留且字节不变') }
      catch (error) { failures.push(error) }
    }
  }
  if (failures.length === 1) throw failures[0]
  if (failures.length) throw new AggregateError(failures, failures.map(error => error.message).join('\n'))
}

function retained(storage, original) {
  assert.equal(storage.getItem(historyKey), original, '读取或解析失败不能删除或重写原历史文本')
  assert.deepEqual(storage.writes, [], '失败加载不能静默缩减历史')
}

for (const [scenario, label, operations] of [
  ['check-false', '受控 check=false（未授权或不可用）', ['check']],
  ['cancelled', '受控读取 AbortError（非未来重选 UI）', ['check']],
  ['read-null', '受控 read=null', ['check', 'read']],
  ['process-fails', '受控 processFile 拒绝', ['check', 'read', 'process']]
]) {
  test(`PSD 历史保留：${label}后保留原始历史文本`, options, t => withHistory(t, scenario, async context => {
    await context.history.loadPsdFromHistory()
    assert.deepEqual(context.calls, operations.map(operation => [operation, context.first]), '必须执行真实历史加载分支')
    assert.ok(context.messages.some(item => item.name === 'destroyAll'), '加载结算后应清理消息')
    assert.equal(context.messages.some(item => item.name === 'success'), false, '失败不能报告成功加载')
    retained(context.storage, context.original)
  }))
}

test('PSD 历史保留：一项失败一项成功时两条原历史均保留', options, t => withHistory(t, 'mixed', async context => {
  await context.history.loadPsdFromHistory()
  assert.deepEqual(context.calls, [['check', context.first], ['check', context.second], ['read', context.second], ['process', context.second]])
  assert.equal(context.processed.length, 1)
  assert.deepEqual(context.processed[0].bytes, [...context.secondBytes])
  assert.ok(context.messages.some(item => item.name === 'success'))
  retained(context.storage, context.original)
}))

test('PSD 历史控制：加载成功保持完整字节、路径与原历史文本', options, t => withHistory(t, 'success', async context => {
  await context.history.loadPsdFromHistory()
  assert.deepEqual(context.calls, [['check', context.first], ['read', context.first], ['process', context.first]])
  assert.deepEqual(context.processed, [{
    path: context.first, name: path.basename(context.first), type: 'application/octet-stream', flag: false, bytes: [...context.firstBytes]
  }])
  assert.ok(context.messages.some(item => item.name === 'success' && item.args[0].includes('成功加载 1 个')))
  retained(context.storage, context.original)
}))

test('PSD 历史控制：已打开路径无需读取或重复解析且历史保留', options, t => withHistory(t, 'opened', async context => {
  await context.history.loadPsdFromHistory()
  assert.deepEqual(context.calls, [])
  assert.deepEqual(context.processed, [])
  assert.ok(context.messages.some(item => item.name === 'info' && item.args[0].includes('所有历史文件都已打开')))
  retained(context.storage, context.original)
}))

test('PSD 历史控制：明确清空只移除历史项而保留原文件', options, t => withHistory(t, 'clear', async context => {
  context.history.clearPsdHistory()
  assert.equal(context.storage.getItem(historyKey), null)
  assert.deepEqual(context.storage.writes, [['remove', historyKey]])
  assert.deepEqual(context.calls, [])
  assert.ok(context.messages.some(item => item.name === 'success' && item.args[0] === '历史记录已清空'))
}))
