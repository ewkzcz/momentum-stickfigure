/** 真实高清处理器及真实进程管理，只将Python脚本边界替为无依赖Node夹具。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { createCanvas } from '@napi-rs/canvas'
import { build } from 'esbuild'

test('高清真实处理器：取消终止执行进程且后续任务可恢复', { timeout: 20000 }, async () => {
  await mkdir(path.join(process.cwd(), 'temp'), { recursive: true })
  const root = await mkdtemp(path.join(process.cwd(), 'temp/momentum-hd-process-'))
  const handlers = new Map()
  const state = globalThis.__hdProcessBoundary = { root, handlers, pid: null, hold: true, ready: null, spawns: 0 }
  const ready = new Promise(resolve => { state.ready = resolve })
  const entry = path.resolve('src/main/hd-service.js'), policy = path.resolve('src/main/ipc-sender-policy.js')
  const bundled = await build({ stdin: { contents: `export * from ${JSON.stringify(entry)}; export * from ${JSON.stringify(policy)};`, resolveDir: process.cwd() }, bundle: true, packages: 'external', platform: 'node', format: 'esm', write: false, plugins: [{ name: 'isolated-hd-boundary', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }))
    plugin.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'process', namespace: 'test' }))
    plugin.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'electron'
      ? 'const s=globalThis.__hdProcessBoundary;export const app={getPath:()=>s.root};export const BrowserWindow={fromWebContents:owner=>({owner})};export const dialog={showOpenDialog:async(window,options)=>{if(window.owner!==s.owner)throw Error("选择来源错误");return {canceled:!options.properties.includes("openFile")&&!!s.cancelOutput,filePaths:options.properties.includes("openFile")?[s.input]:[s.output]}}};export const ipcMain={handle:(k,v)=>s.handlers.set(k,v),removeHandler:k=>s.handlers.delete(k)};'
      : 'export const execFile=process.getBuiltinModule("child_process").execFile;export function spawn(command,args,options){const s=globalThis.__hdProcessBoundary;s.spawns++;const script=s.hold ? `process.stdout.write("ready");setInterval(()=>{},1000)` : `const fs=require("fs");const entries=JSON.parse(fs.readFileSync(${JSON.stringify(args[2])},"utf8"));for(const entry of entries){fs.copyFileSync(entry.input,entry.output);process.stdout.write("MOMENTUM_ARTIFACT "+entry.id+String.fromCharCode(10))}`;const c=process.getBuiltinModule("child_process").spawn(process.execPath,["-e",script],options);s.pid=c.pid;c.stdout.once("data",()=>s.ready());return c}' }))
  } }] })
  const file = path.join(root, 'service.mjs')
  await writeFile(file, bundled.outputFiles[0].text)
  const service = await import(pathToFileURL(file).href)
  const sender = Object.assign(new EventEmitter(), { isDestroyed: () => false, mainFrame: { url: 'file:///trusted/index.html' } })
  service.registerTrustedWindow(sender, 'file:///trusted/index.html', 'main')
  const event = { sender, senderFrame: sender.mainFrame }
  service.registerHdServiceHandlers()
  await mkdir(path.join(root, 'weights'))
  const input = path.join(root, 'input.png')
  const canvas = createCanvas(8, 6)
  canvas.getContext('2d').fillRect(1, 1, 4, 3)
  await writeFile(input, canvas.toBuffer('image/png'))
  state.input = input; state.output = path.join(root, 'output'); state.owner = sender
  await mkdir(state.output)
  await handlers.get('hd:save-config')(event, { pythonHome: process.execPath, removebgWeightsDir: path.join(root, 'weights'), outputDir: path.join(root, 'output') })
  try {
    state.cancelOutput = true
    const cancelledSelection = await handlers.get('hd:run-removebg')(event, { inputPaths: [input] })
    assert.equal(cancelledSelection.success, false)
    assert.match(cancelledSelection.message, /取消输出选择/)
    assert.equal(state.spawns, 0)
    assert.equal((await handlers.get('hd:get-image-preview')(event, input)).success, false, '输出选择取消应回滚本次输入授权')
    state.cancelOutput = false
    const task = handlers.get('hd:run-removebg')(event, { inputPaths: [input] })
    await ready
    const pid = state.pid
    // 真实处理器已进入受控模型进程；准备阶段额度必须已释放，预览不得等待模型退出。
    const duringModel = await handlers.get('hd:get-image-preview')(event, input)
    assert.equal(duringModel.success, true)
    assert.deepEqual(Buffer.from(duringModel.data.dataUrl.split(',')[1], 'base64'), canvas.toBuffer('image/png'))
    assert.equal((await handlers.get('hd:cancel')(event)).cancelled, 1)
    const result = await task
    assert.equal(result.success, false)
    assert.match(result.message, /取消/)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    state.hold = false
    assert.equal((await handlers.get('hd:run-removebg')(event, { inputPaths: [input] })).success, true)
    const batch = path.join(root, 'batch')
    await mkdir(batch)
    await writeFile(path.join(batch, '一.png'), canvas.toBuffer('image/png'))
    await writeFile(path.join(batch, '二.png'), canvas.toBuffer('image/png'))
    state.input = batch
    const before = state.spawns
    const batchResult = await handlers.get('hd:run-removebg')(event, { inputPaths: [batch] })
    assert.equal(batchResult.success, true)
    assert.equal(batchResult.data.files.length, 2)
    assert.equal(state.spawns - before, 1, '目录批量只启动一个模型处理进程')
    assert.deepEqual(batchResult.data.tasks, [{ input: batch, outputDir: batchResult.data.outputDir }])
  } finally {
    await handlers.get('hd:cancel')(event)
    service.unregisterHdServiceHandlers()
    delete globalThis.__hdProcessBoundary
  }
})
