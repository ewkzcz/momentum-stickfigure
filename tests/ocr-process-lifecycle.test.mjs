/** 真实 OCR 处理器与受管进程；仅将 Python 边界替换成隔离的真实 Node 子进程。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { EventEmitter } from 'node:events'
import { build } from 'esbuild'

const repo = fileURLToPath(new URL('../', import.meta.url))
const resultOutput = 'PROGRESS:40\nOCR_RESULT_START\n隔离字幕\nOCR_RESULT_END\nSUCCESS:1\n'
const holdScript = `process.stdout.write(${JSON.stringify(resultOutput)});setInterval(()=>{},1000)`

function stageFor(args) {
  if (args[0] === '-c') return 'model'
  if (args[0] !== '-m') return 'video'
  if (args[2] === 'show') return `check:${args[3]}`
  if (args[2] === 'uninstall') return 'uninstall'
  if (args.includes('--upgrade')) return 'upgrade'
  return 'install'
}

function normalScript(stage, args) {
  if (stage.startsWith('check:')) {
    const pkg = args[3]
    return `process.stdout.write(${JSON.stringify(`Name: ${pkg}\nVersion: ${pkg === 'paddleocr' ? '2.7.0.0' : '2.6.2'}\n`)})`
  }
  if (stage === 'video') return `process.stdout.write(${JSON.stringify(resultOutput)})`
  if (stage === 'model') return 'process.stdout.write("OK\\n");process.stderr.write("model download 100%\\n")'
  return 'process.stderr.write("Successfully installed isolated-fixture\\n")'
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-ocr-process-'))
  const key = `__ocrProcessBoundary_${path.basename(root)}`
  const handlers = new Map()
  const state = globalThis[key] = { root, pythonHome: path.join(root, 'python-fixture'), handlers, records: [], script: normalScript, ready: () => {}, stageFor }
  let service
  const owners = []
  t.after(async () => {
    if (service) {
      await Promise.all(owners.map(owner => service.cancelOwnedTasks(owner, 'ocr')))
      service.unregisterVideoOcrServiceHandlers()
      assert.equal(handlers.size, 0, '注销包括取消接口在内的全部处理器')
    }
    delete globalThis[key]
    await rm(root, { recursive: true, force: true })
  })
  const entry = path.join(repo, 'src/main/video-ocr-service.js')
  const policy = path.join(repo, 'src/main/ipc-sender-policy.js')
  const owned = path.join(repo, 'src/main/owned-process-tasks.mjs')
  const bundled = await build({
    stdin: { contents: `export * from ${JSON.stringify(entry)};export * from ${JSON.stringify(policy)};export * from ${JSON.stringify(owned)};`, resolveDir: repo },
    bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'isolated-ocr-boundary', setup(plugin) {
      plugin.onResolve({ filter: /^(?:node:)?(?:electron|child_process|os)$/ }, args => ({ path: args.path.replace(/^node:/, ''), namespace: 'test' }))
      plugin.onLoad({ filter: /.*/, namespace: 'test' }, args => {
        const prelude = `const s=globalThis[${JSON.stringify(key)}];`
        if (args.path === 'electron') return { contents: prelude + 'export const app={getPath:()=>s.root};export const ipcMain={handle:(k,v)=>s.handlers.set(k,v),removeHandler:k=>s.handlers.delete(k)};' }
        if (args.path === 'os') return { contents: prelude + 'export default {homedir:()=>s.root};' }
        return { contents: prelude + `
          const cp=process.getBuiltinModule('child_process');
          export const execFile=cp.execFile;
          export function spawn(command,args,options){
            if(command==='taskkill') return cp.spawn(command,args,options);
            if(command!==s.pythonHome) throw new Error('禁止启动非夹具解释器');
            const stage=s.stageFor(args);
            const script=s.script(stage,args);
            const child=cp.spawn(process.execPath,['-e',script],{...options,env:{PATH:process.env.PATH}});
            const record={stage,args,pid:child.pid,closed:false};
            s.records.push(record);
            child.once('close',()=>{record.closed=true});
            child.stdout.once('data',()=>s.ready(record));
            return child;
          }
        ` }
      })
    } }]
  })
  const file = path.join(root, 'service.mjs')
  await writeFile(file, bundled.outputFiles[0].text)
  service = await import(pathToFileURL(file).href)
  const pythonHome = path.join(root, 'python-fixture')
  const videoPath = path.join(root, 'input.mp4')
  const outputDir = path.join(root, 'output')
  await writeFile(pythonHome, '不是 Python，不可执行')
  await writeFile(videoPath, 'isolated input')
  const cache = path.join(root, '.paddlex', 'official_models')
  await mkdir(cache, { recursive: true })
  await writeFile(path.join(cache, 'sentinel'), '保留缓存')
  function owner() {
    const sender = Object.assign(new EventEmitter(), {
      destroyed: false, isDestroyed() { return this.destroyed },
      mainFrame: { url: 'file:///trusted/index.html' }, progress: [],
      send(channel, value) { this.progress.push({ channel, ...value }) }
    })
    service.registerTrustedWindow(sender, sender.mainFrame.url, 'main')
    owners.push(sender)
    return { sender, senderFrame: sender.mainFrame }
  }
  const event = owner()
  service.registerVideoOcrServiceHandlers()
  const payload = { pythonHome, videoPath, outputDir, intervalSeconds: 1, useAI: false }
  return {
    root, cache, state, event, owner, service, handlers, pythonHome, payload,
    invoke(channel, ...args) { return handlers.get(`video-ocr:${channel}`)(event, ...args) },
    readyFor(stage) { return new Promise(resolve => { state.ready = record => { if (record.stage === stage) resolve(record) } }) }
  }
}

function assertExited(record) {
  assert.equal(record.closed, true, '取消响应必须晚于子进程 close')
  assert.throws(() => process.kill(record.pid, 0), { code: 'ESRCH' })
}

for (const scenario of [
  { name: '环境检查', channel: 'check-environment', stage: 'check:paddleocr' },
  { name: '环境清理', channel: 'clean-environment', stage: 'uninstall' },
  { name: '安装工具升级', channel: 'install-environment', stage: 'upgrade' },
  { name: '安装前卸载', channel: 'install-environment', stage: 'uninstall' },
  { name: '依赖安装', channel: 'install-environment', stage: 'install' },
  { name: '模型初始化', channel: 'install-environment', stage: 'model' },
  { name: '视频识别', channel: 'process-video', stage: 'video' }
]) {
  test(`OCR ${scenario.name}：取消等待真实退出，阻止后续步骤且允许恢复`, { timeout: 20000 }, async t => {
    const f = await fixture(t)
    f.state.script = (stage, args) => stage === scenario.stage
      ? (stage === 'model' ? `process.stdout.write("OK\\n");${holdScript}` : holdScript)
      : normalScript(stage, args)
    const ready = f.readyFor(scenario.stage)
    const task = f.invoke(scenario.channel, scenario.channel === 'process-video' ? f.payload : f.pythonHome)
    const record = await ready
    const count = f.state.records.length
    const cancellation = await f.invoke('cancel')
    assert.deepEqual(cancellation, { success: true, cancelled: 1 })
    const result = await task
    assert.equal(result.success, false)
    assert.match(result.message, /取消/)
    assertExited(record)
    assert.equal(f.state.records.length, count, '取消不得继续卸载、安装或切换来源')
    assert.equal(await readFile(path.join(f.cache, 'sentinel'), 'utf8'), '保留缓存')
    assert.equal((await readdir(f.root)).some(name => name.endsWith('.py')), false)
    if (scenario.channel === 'process-video') assert.deepEqual(await readdir(f.payload.outputDir), [])
    f.state.script = normalScript
    const restored = await f.invoke('check-environment', f.pythonHome)
    assert.equal(restored.success, true)
    assert.equal(restored.data.installed, true)
  })
}

test('OCR 来源校验、同类互斥及窗口归属隔离', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = () => holdScript
  const ready = f.readyFor('video')
  const task = f.invoke('process-video', f.payload)
  const record = await ready
  const duplicate = await f.invoke('check-environment', f.pythonHome)
  assert.equal(duplicate.success, false)
  assert.match(duplicate.message, /同类任务/)
  const forged = { sender: f.event.sender, senderFrame: { url: f.event.senderFrame.url } }
  for (const channel of ['check-environment', 'clean-environment', 'install-environment', 'process-video', 'cancel']) {
    const denied = await f.handlers.get(`video-ocr:${channel}`)(forged, f.pythonHome)
    assert.equal(denied.success, false)
    assert.match(denied.message, /未授权/)
  }
  const other = f.owner()
  assert.deepEqual(await f.handlers.get('video-ocr:cancel')(other), { success: true, cancelled: 0 })
  assert.equal(record.closed, false)
  assert.equal(f.state.records.length, 1)
  f.event.sender.destroyed = true
  f.event.sender.emit('destroyed')
  const result = await task
  assert.equal(result.success, false)
  assert.match(result.message, /窗口已关闭/)
  assertExited(record)
  assert.deepEqual(await readdir(f.payload.outputDir), [])
})

test('OCR 应用退出等待真实进程结束并拒绝新任务', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = () => holdScript
  const ready = f.readyFor('video')
  const task = f.invoke('process-video', f.payload)
  const record = await ready
  await f.service.stopOwnedTasks()
  const result = await task
  assert.equal(result.success, false)
  assert.match(result.message, /应用正在退出/)
  assertExited(record)
  assert.equal((await f.invoke('check-environment', f.pythonHome)).success, false)
  assert.equal(f.state.records.length, 1)
  assert.deepEqual(await readdir(f.payload.outputDir), [])
})

test('OCR 检查超时：进程关闭后才检查下一包，保留未安装回退', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = (stage, args) => {
    if (stage === 'check:paddleocr') return holdScript
    assertExited(f.state.records[0])
    return normalScript(stage, args)
  }
  const result = await f.invoke('check-environment', f.pythonHome)
  assert.equal(result.success, true)
  assert.equal(result.data.installed, false)
  assert.equal(result.data.details.paddleocr.installed, false)
  assert.equal(result.data.details.paddlepaddle.installed, true)
  assert.equal(f.state.records.length, 2)
  assertExited(f.state.records[0])
})

test('OCR 普通失败回退：升级/卸载失败继续，模型 OK 标记仍成功', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = (stage, args) => {
    if (stage === 'upgrade' || stage === 'uninstall') return 'process.exit(1)'
    if (stage === 'model') return 'process.stdout.write("OK\\n");process.exitCode=1'
    return normalScript(stage, args)
  }
  assert.equal((await f.invoke('install-environment', f.pythonHome)).success, true)
  assert.deepEqual(f.state.records.map(r => r.stage), ['upgrade', 'uninstall', 'install', 'install', 'install', 'model'])
  assert.ok(f.event.sender.progress.some(p => p.log?.includes('安装中')))
})

test('OCR 清理普通卸载失败仍清理隔离缓存', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = () => 'process.exit(1)'
  assert.equal((await f.invoke('clean-environment', f.pythonHome)).success, true)
  assert.equal(f.state.records.length, 4)
  await assert.rejects(readFile(path.join(f.cache, 'sentinel')), { code: 'ENOENT' })
})

test('OCR 依赖正常失败返回原错误，不启动模型初始化', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = (stage, args) => stage === 'install' ? 'process.exit(1)' : normalScript(stage, args)
  const result = await f.invoke('install-environment', f.pythonHome)
  assert.equal(result.success, false)
  assert.equal(result.message, '字幕提取引擎安装失败')
  assert.deepEqual(f.state.records.map(r => r.stage), ['upgrade', 'uninstall', 'install'])
})

test('OCR 视频跨块 UTF-8 输出保留进度，非零退出保留已有识别结果', { timeout: 20000 }, async t => {
  const f = await fixture(t)
  f.state.script = () => `
    const bytes=Buffer.from(${JSON.stringify(resultOutput)});let i=0;
    const timer=setInterval(()=>{if(i<bytes.length){process.stdout.write(bytes.subarray(i,i+1));i+=1}else{clearInterval(timer);process.exitCode=1}},2);
  `
  const result = await f.invoke('process-video', f.payload)
  assert.equal(result.success, true)
  assert.equal(result.data.preview, '隔离字幕')
  assert.equal(result.data.lineCount, 1)
  assert.equal(await readFile(result.data.outputPath, 'utf8'), '隔离字幕')
  assert.ok(f.event.sender.progress.some(p => p.percentage === 39))
  assert.equal((await readdir(f.root)).some(name => name.endsWith('.py')), false)
})
