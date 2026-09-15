/** 真实高清处理器及真实进程管理，只将Python脚本边界替为无依赖Node夹具。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'

test('高清真实处理器：取消终止执行进程且后续任务可恢复', { timeout: 20000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-hd-process-'))
  const handlers = new Map()
  const state = globalThis.__hdProcessBoundary = { root, handlers, pid: null, hold: true, ready: null }
  const ready = new Promise(resolve => { state.ready = resolve })
  const entry = path.resolve('src/main/hd-service.js'), policy = path.resolve('src/main/ipc-sender-policy.js')
  const bundled = await build({ stdin: { contents: `export * from ${JSON.stringify(entry)}; export * from ${JSON.stringify(policy)};`, resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'esm', write: false, plugins: [{ name: 'isolated-hd-boundary', setup(plugin) {
    plugin.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }))
    plugin.onResolve({ filter: /^node:child_process$/ }, () => ({ path: 'process', namespace: 'test' }))
    plugin.onLoad({ filter: /.*/, namespace: 'test' }, args => ({ contents: args.path === 'electron'
      ? 'const s=globalThis.__hdProcessBoundary;export const app={getPath:()=>s.root};export const ipcMain={handle:(k,v)=>s.handlers.set(k,v),removeHandler:k=>s.handlers.delete(k)};'
      : 'export const execFile=process.getBuiltinModule("child_process").execFile;export function spawn(command,args,options){const s=globalThis.__hdProcessBoundary;const script=s.hold ? `process.stdout.write("ready");setInterval(()=>{},1000)` : `process.exit(0)`;const c=process.getBuiltinModule("child_process").spawn(process.execPath,["-e",script],options);s.pid=c.pid;c.stdout.once("data",()=>s.ready());return c}' }))
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
  await writeFile(input, 'isolated input')
  await handlers.get('hd:save-config')(event, { pythonHome: process.execPath, removebgWeightsDir: path.join(root, 'weights'), outputDir: path.join(root, 'output') })
  try {
    const task = handlers.get('hd:run-removebg')(event, { inputPaths: [input] })
    await ready
    const pid = state.pid
    assert.equal((await handlers.get('hd:cancel')(event)).cancelled, 1)
    const result = await task
    assert.equal(result.success, false)
    assert.match(result.message, /取消/)
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
    state.hold = false
    assert.equal((await handlers.get('hd:run-removebg')(event, { inputPaths: [input] })).success, true)
  } finally {
    await handlers.get('hd:cancel')(event)
    service.unregisterHdServiceHandlers()
    delete globalThis.__hdProcessBoundary
  }
})
