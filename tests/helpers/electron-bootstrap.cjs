/** 桌面回归启动器：在加载生产主进程前隔离配置、文件输出和系统交互。 */
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { pathToFileURL } = require('node:url')
const { syncBuiltinESMExports } = require('node:module')
const { app, BrowserWindow, clipboard, dialog, globalShortcut, shell } = require('electron')

const root = process.env.MOMENTUM_TEST_ROOT
if (!root || !path.isAbsolute(root) || !fs.existsSync(path.join(root, '.momentum-test-root'))) {
  throw new Error('测试启动器需要预先创建的隔离目录标识')
}

// 1、在任何业务模块导入前覆盖系统目录，所有生产默认路径仍由原代码计算。
const directories = {
  home: 'home', appData: 'app-data', userData: 'user-data', sessionData: 'session-data',
  temp: 'temp', documents: 'home/Documents', downloads: 'home/Downloads',
  pictures: 'home/Pictures', videos: 'home/Videos', music: 'home/Music',
  desktop: 'home/Desktop', logs: 'logs'
}
for (const [name, relative] of Object.entries(directories)) {
  const directory = path.join(root, relative)
  fs.mkdirSync(directory, { recursive: true })
  app.setPath(name, directory)
}
process.env.HOME = path.join(root, 'home')
process.env.USERPROFILE = process.env.HOME
process.env.TMPDIR = path.join(root, 'temp')
process.env.TMP = process.env.TMPDIR
process.env.TEMP = process.env.TMPDIR
os.homedir = () => process.env.HOME
os.tmpdir = () => process.env.TMPDIR
process.chdir(root)
app.commandLine.appendSwitch('user-data-dir', app.getPath('userData'))
app.commandLine.appendSwitch('disable-background-networking')
// 布局参考使用独立且固定的软件栅格化环境，不更改原版导出像素测试的运行模式。
if (process.env.MOMENTUM_TEST_RENDER_MODE === 'software-layout') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-lcd-text')
  app.commandLine.appendSwitch('force-color-profile', 'srgb')
  app.commandLine.appendSwitch('force-device-scale-factor', '1')
}
// 测试全程离线；拒绝远程域名，避免误触真实外部服务。
app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND, EXCLUDE localhost')

// 2、保护业务文件写入边界，越界直接失败，而不是静默重定向产生假阳性。
const violations = []
const writes = []
const faults = { storageWrite: false, storageWriteFailures: 0 }
const originalRealpath = fs.realpathSync.bind(fs)
const originalExists = fs.existsSync.bind(fs)
const canonicalRoot = originalRealpath(root)
/** 验证写入路径及其已有父目录均位于本次隔离目录。 */
function assertWritable(value) {
  // 1、文件描述符由已检查的 open 调用产生；路径同时检查符号链接目标。
  if (typeof value === 'number') return
  const absolute = path.resolve(value instanceof URL ? require('node:url').fileURLToPath(value) : String(value))
  let ancestor = absolute
  while (!originalExists(ancestor) && path.dirname(ancestor) !== ancestor) ancestor = path.dirname(ancestor)
  const canonical = originalRealpath(ancestor)
  const lexicalRoot = path.resolve(root)
  const insideLexical = absolute === lexicalRoot || absolute.startsWith(lexicalRoot + path.sep)
  const insideCanonical = canonical === canonicalRoot || canonical.startsWith(canonicalRoot + path.sep)
  if (!insideLexical || !insideCanonical) {
    violations.push({ operation: 'write', path: absolute })
    throw new Error(`测试阻止隔离目录外写入：${absolute}`)
  }
  writes.push(absolute)
}
for (const name of ['writeFile', 'appendFile', 'mkdir', 'rm', 'rmdir', 'unlink', 'truncate', 'chmod', 'utimes']) {
  for (const suffix of ['', 'Sync']) {
    const original = fs[name + suffix]
    if (!original) continue
    fs[name + suffix] = function (target, ...args) {
      assertWritable(target)
      if (name === 'writeFile' && faults.storageWrite && path.basename(String(target)) === 'shared-storage.json') {
        faults.storageWriteFailures++
        const error = Object.assign(new Error('回归测试注入配置写入失败'), { code: 'EIO' })
        if (suffix === 'Sync') throw error
        process.nextTick(() => args.at(-1)(error))
        return
      }
      return original.call(fs, target, ...args)
    }
  }
  const original = fs.promises[name]
  if (original) fs.promises[name] = async (target, ...args) => {
    assertWritable(target)
    return original.call(fs.promises, target, ...args)
  }
}
for (const name of ['rename', 'copyFile', 'link', 'symlink']) {
  for (const suffix of ['', 'Sync']) {
    const original = fs[name + suffix]
    fs[name + suffix] = function (source, destination, ...args) {
      if (name !== 'copyFile') assertWritable(source)
      assertWritable(destination)
      return original.call(fs, source, destination, ...args)
    }
  }
  const original = fs.promises[name]
  fs.promises[name] = async (source, destination, ...args) => {
    if (name !== 'copyFile') assertWritable(source)
    assertWritable(destination)
    return original.call(fs.promises, source, destination, ...args)
  }
}
for (const name of ['open', 'openSync', 'createWriteStream']) {
  const original = fs[name]
  fs[name] = function (target, flags, ...args) {
    if (name === 'createWriteStream' || typeof flags === 'number' || /[wa+]/.test(flags || '')) assertWritable(target)
    return original.call(fs, target, flags, ...args)
  }
}
syncBuiltinESMExports()

// 3、仅替代原生交互边界，业务解析、图层渲染和文件写入均运行原实现。
const state = { root, violations, writes, faults, openPaths: [], savePath: null, drags: [], clipboard: '', external: [] }
globalThis.__momentumTest = state
// 子进程与 Node 网络在本地回归中没有授权用途，误触即记录并拒绝。
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  require('node:child_process')[name] = () => {
    violations.push({ operation: `child_process.${name}` })
    throw new Error('本地回归禁止启动外部进程或修改 Python 环境')
  }
}
for (const protocol of ['node:http', 'node:https']) {
  for (const name of ['request', 'get']) require(protocol)[name] = () => {
    violations.push({ operation: `${protocol}.${name}` })
    throw new Error('本地回归禁止外部网络请求')
  }
}
syncBuiltinESMExports()
process.on('exit', () => fs.writeFileSync(path.join(root, 'isolation.json'), JSON.stringify({ violations, writes }, null, 2)))
dialog.showOpenDialog = async () => {
  const filePaths = state.openPaths.splice(0)
  return { canceled: filePaths.length === 0, filePaths }
}
dialog.showSaveDialog = async () => ({ canceled: !state.savePath, filePath: state.savePath || undefined })
shell.openExternal = async (url) => { state.external.push(url) }
shell.openPath = async () => ''
clipboard.writeText = (text) => { state.clipboard = text }
clipboard.readText = () => state.clipboard
clipboard.writeImage = () => {}
globalShortcut.register = () => false
app.on('web-contents-created', (_event, contents) => {
  contents.openDevTools = () => {}
  contents.startDrag = (options) => { state.drags.push({ file: options.file, files: options.files }) }
})

// 4、导入已经构建的真实入口；测试窗口固定尺寸，失败保留非零退出状态。
app.on('browser-window-created', (_event, window) => {
  if (BrowserWindow.getAllWindows().length === 1) {
    if (process.env.MOMENTUM_TEST_RENDER_MODE === 'software-layout') {
      const setContentSize = window.setContentSize.bind(window)
      // 布局基准从首个页面脚本执行前固定尺寸，避免应用按系统工作区反复改动初始比例。
      window.setSize = () => setContentSize(1024, 700)
      window.setBounds = () => setContentSize(1024, 700)
      setContentSize(1024, 700)
    } else window.setBounds({ x: 0, y: 0, width: 1440, height: 1000 })
  }
})
import(pathToFileURL(process.env.MOMENTUM_TEST_ENTRY).href).catch((error) => {
  console.error(error)
  app.exit(1)
})
