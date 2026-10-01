/**
 * OCR 输出授权受控基线：真实 IPC 处理器、授权策略、任务作用域与文件写入。
 * Electron 用缺失解释器验证错误优先级，保持 bootstrap 全部保护。
 * bundle 仅隔离 Electron 对话框/宿主目录/网络/解释器边界；成功路径运行真实 Node
 * 子进程输出 OCR 协议，不使用 Python，也不把它当真实 OCR/AI 外部验收。
 * 运行由主流程串行负责；此文件不要求修改用户配置或安装 Python。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'
import { launchDesktop } from './helpers/desktop.mjs'

const repo = fileURLToPath(new URL('../', import.meta.url))
const deniedMessage = /输出目录未授权/
const subtitle = '已确认目录的隔离字幕'

// 缺失解释器不是这个用例可接受的失败：必须先拒绝未经确认的输出目录。
test('OCR 输出授权：真实 Electron 在解释器检查前拒绝未确认目录', { timeout: 30000 }, async () => {
  const desktop = await launchDesktop()
  const outputDir = path.join(desktop.root, '未确认 中文输出')
  const videoPath = path.join(desktop.root, '输入.mp4')
  await writeFile(videoPath, 'isolated input, not a real video')
  try {
    await desktop.application.evaluate(() => { globalThis.__momentumTest.openPaths = [] })
    const result = await desktop.page.evaluate(payload => window.electronAPI.invoke('video-ocr:process-video', payload), {
      pythonHome: path.join(desktop.root, 'missing-python'), videoPath, outputDir,
      intervalSeconds: 1, useAI: true, apiKey: 'isolated-fake-key',
      aiModel: 'fixture', apiBaseUrl: 'http://127.0.0.1:1/v1'
    })
    const safety = await desktop.application.evaluate(() => ({
      writes: globalThis.__momentumTest.writes, violations: globalThis.__momentumTest.violations
    }))
    assert.equal(result.success, false)
    assert.match(result.message, deniedMessage, '不能以解释器无效或网络/进程保护报错冒充输出授权拒绝')
    await assert.rejects(access(outputDir), { code: 'ENOENT' })
    assert.deepEqual(safety.violations, [], '授权拒绝必须早于网络和 spawn 尝试')
    assert.deepEqual(safety.writes.filter(file => file === outputDir || file.startsWith(outputDir + path.sep) || /^video_ocr_.*\.py$/.test(path.basename(file))), [])
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})

function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

// 只用截止时间报告挂起，不用固定 sleep 决定任务是否已到达某个阶段。
async function deadline(promise, message) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 3000)
    })])
  } finally { clearTimeout(timer) }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-ocr-output-'))
  const key = `__ocrOutput_${path.basename(root)}`
  const handlers = new Map()
  const state = globalThis[key] = {
    root, handlers, writes: [], network: [], spawns: [], dialogs: [], pending: [],
    pythonHome: path.join(root, 'not-python'), allowSpawn: false,
    dialogResult: { canceled: true, filePaths: [] },
    showDialog(options) { this.dialogs.push(options); return this.dialogResult }
  }
  let service
  const owners = []
  t.after(async () => {
    for (const pending of state.pending) pending.resolve({ canceled: true, filePaths: [] })
    try {
      if (service) {
        await Promise.all(owners.map(event => service.cancelOwnedTasks(event.sender, 'ocr')))
        service.unregisterVideoOcrServiceHandlers()
        assert.equal(handlers.size, 0)
      }
    } finally {
      delete globalThis[key]
      await rm(root, { recursive: true, force: true })
    }
  })
  const entries = ['video-ocr-service.js', 'ipc-sender-policy.js', 'owned-process-tasks.mjs', 'configured-output-policy.js']
  const bundle = await build({
    stdin: { contents: entries.map(file => `export * from ${JSON.stringify(path.join(repo, 'src/main', file))};`).join('\n'), resolveDir: repo },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'ocr-output-boundaries', setup(plugin) {
      plugin.onResolve({ filter: /^(?:node:)?(?:electron|child_process|os|fs|http|https)$/ }, args => ({ path: args.path.replace(/^node:/, ''), namespace: 'fixture' }))
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, args => {
        const prelude = `const s=globalThis[${JSON.stringify(key)}];`
        if (args.path === 'electron') return { contents: prelude + `
          export const app={getPath:()=>s.root};
          export const ipcMain={handle:(name,handler)=>s.handlers.set(name,handler),removeHandler:name=>s.handlers.delete(name)};
          export const BrowserWindow={fromWebContents:owner=>owner};
          export const dialog={showOpenDialog:(_owner,options)=>s.showDialog(options)};
        ` }
        if (args.path === 'os') return { contents: prelude + `export default {...process.getBuiltinModule('os'),homedir:()=>s.root,tmpdir:()=>s.root};` }
        if (args.path === 'fs') return { contents: prelude + `
          const fs=process.getBuiltinModule('fs');
          export default new Proxy(fs,{get(target,name){
            if(['mkdirSync','writeFileSync','appendFileSync'].includes(name)) return (file,...args)=>{
              s.writes.push({operation:name,path:String(file)});return target[name](file,...args);
            };
            return target[name];
          }});
        ` }
        if (args.path === 'http' || args.path === 'https') return { contents: prelude + `
          export default {request(...args){s.network.push(${JSON.stringify(args.path)});throw new Error('夹具禁止真实网络');}};
        ` }
        return { contents: prelude + `
          const cp=process.getBuiltinModule('child_process');
          export const execFile=cp.execFile;
          export function spawn(command,args,options){
            s.spawns.push({command,args});
            if(!s.allowSpawn || command!==s.pythonHome) throw new Error('夹具禁止未授权进程');
            return cp.spawn(process.execPath,['-e',${JSON.stringify(`process.stdout.write(${JSON.stringify(`OCR_RESULT_START\n${subtitle}\nOCR_RESULT_END\nSUCCESS:1\n`)})`)}],{...options,env:{PATH:process.env.PATH}});
          }
        ` }
      })
    } }]
  })
  const entry = path.join(root, 'service.mjs')
  await writeFile(entry, bundle.outputFiles[0].text)
  await writeFile(state.pythonHome, 'not executable, never run as Python')
  const videoPath = path.join(root, '输入.mp4')
  await writeFile(videoPath, 'isolated input')
  service = await import(pathToFileURL(entry).href)
  function owner() {
    const sender = Object.assign(new EventEmitter(), {
      isDestroyed: () => false, mainFrame: { url: 'file:///trusted/index.html' }, send() {}
    })
    service.registerTrustedWindow(sender, sender.mainFrame.url, 'main')
    const event = { sender, senderFrame: sender.mainFrame }
    owners.push(event)
    return event
  }
  const event = owner()
  service.registerVideoOcrServiceHandlers()
  const payload = { pythonHome: state.pythonHome, videoPath, outputDir: path.join(root, '中文 输出'), intervalSeconds: 1, useAI: false }
  return {
    root, state, service, event, owner, payload,
    invoke(channel, value, source = event) { return handlers.get(`video-ocr:${channel}`)(source, value) }
  }
}

function assertNoEffects(f) {
  assert.deepEqual(f.state.writes, [], '授权前不得创建目录、临时脚本或字幕文件，包括后来被清理的文件')
  assert.deepEqual(f.state.network, [], '授权前不得尝试 AI 连接')
  assert.deepEqual(f.state.spawns, [], '授权前不得尝试 spawn')
}

for (const useAI of [false, true]) {
  test(`OCR 输出授权：真实 handler 拒绝未确认目录，AI=${useAI} 时均无副作用`, { timeout: 15000 }, async t => {
    const f = await fixture(t)
    const result = await f.invoke('process-video', {
      ...f.payload, useAI, apiKey: 'isolated-fake-key', aiModel: 'fixture', apiBaseUrl: 'http://127.0.0.1:1/v1'
    })
    assert.equal(result.success, false)
    assert.match(result.message, deniedMessage, `必须是输出授权拒绝；实际边界记录：${JSON.stringify({ writes: f.state.writes, network: f.state.network, spawns: f.state.spawns })}`)
    assert.equal(f.state.dialogs.length, 1, '必须实际调用配置目录确认策略')
    assert.equal(f.state.dialogs[0].defaultPath, f.payload.outputDir)
    assertNoEffects(f)
    await assert.rejects(access(f.payload.outputDir), { code: 'ENOENT' })
  })
}

test('OCR 输出授权：确认中文目录后真实 handler 保存字幕，授权不跨窗口', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await mkdir(f.payload.outputDir)
  f.state.allowSpawn = true
  f.state.dialogResult = { canceled: false, filePaths: [f.payload.outputDir] }
  const result = await f.invoke('process-video', f.payload)
  assert.equal(result.success, true, JSON.stringify(result))
  assert.equal(f.state.dialogs.length, 1, '成功必须经过真实授权策略，不预置授权或替换 handler')
  assert.equal(f.state.spawns.length, 1)
  assert.equal(path.dirname(result.data.outputPath), f.payload.outputDir)
  assert.equal(await readFile(result.data.outputPath, 'utf8'), subtitle)
  assert.deepEqual(await readdir(f.payload.outputDir), [path.basename(result.data.outputPath)])
  assert.equal((await readdir(f.root)).some(file => file.endsWith('.py')), false)

  f.state.writes.length = 0
  f.state.spawns.length = 0
  f.state.dialogResult = { canceled: true, filePaths: [] }
  const denied = await f.invoke('process-video', f.payload, f.owner())
  assert.equal(denied.success, false)
  assert.match(denied.message, deniedMessage)
  assert.equal(f.state.dialogs.length, 2)
  assertNoEffects(f)
  assert.equal(await readFile(result.data.outputPath, 'utf8'), subtitle)
})

test('OCR 输出授权：确认等待属于可取消任务，取消后迟到确认不得继续写入', { timeout: 15000 }, async t => {
  const f = await fixture(t)
  await mkdir(f.payload.outputDir)
  const entered = deferred(), answer = deferred()
  f.state.pending.push(answer)
  let signal
  f.state.showDialog = options => {
    f.state.dialogs.push(options)
    signal = f.service.currentTaskSignal()
    entered.resolve()
    return answer.promise
  }
  const task = f.invoke('process-video', f.payload)
  try {
    await deadline(Promise.race([
      entered.promise,
      task.then(result => { throw new Error(`等待目录确认前任务已结束：${JSON.stringify(result)}`) })
    ]), '未进入输出目录确认')
    assert.ok(signal, '授权等待必须在 runOwnedTask 内，继承当前任务取消信号')
    assertNoEffects(f)
    assert.deepEqual(await f.invoke('cancel', undefined, f.owner()), { success: true, cancelled: 0 })
    assert.equal(signal.aborted, false, '其它窗口不能取消本窗口授权等待')
    const duplicate = await f.invoke('process-video', f.payload)
    assert.equal(duplicate.success, false)
    assert.match(duplicate.message, /同类任务/)
    assert.equal(f.state.dialogs.length, 1)
    const cancellation = f.invoke('cancel')
    assert.equal(signal.aborted, true)
    assert.deepEqual(await deadline(cancellation, '取消不得等待用户关闭目录确认框'), { success: true, cancelled: 1 })
    const result = await task
    assert.equal(result.success, false)
    assert.match(result.message, /取消/)
    assertNoEffects(f)
  } finally {
    // 即使失败也释放模拟原生对话框，避免清理过程挂住并掩盖原失败。
    answer.resolve({ canceled: false, filePaths: [f.payload.outputDir] })
    await task
  }
  // 跨过一次事件循环以结算迟到的对话框回调，而非用 sleep 猜测结果。
  await new Promise(resolve => setImmediate(resolve))
  assertNoEffects(f)
  assert.deepEqual(await readdir(f.payload.outputDir), [])
  // 取消后的迟到确认不能留下授权；恢复任务必须重新确认。
  f.state.showDialog = options => {
    f.state.dialogs.push(options)
    return { canceled: true, filePaths: [] }
  }
  const retry = await f.invoke('process-video', f.payload)
  assert.equal(retry.success, false)
  assert.match(retry.message, deniedMessage)
  assert.equal(f.state.dialogs.length, 2)
  assertNoEffects(f)
})
