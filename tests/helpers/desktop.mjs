/** Electron 回归辅助：创建临时目录、启动真实程序并收集可核验结果。 */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

export const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** 创建不包含用户凭据的测试进程环境。 */
function isolatedEnvironment(root, renderMode) {
  // 1、只继承桌面启动必要的环境，不复制 API 密钥、代理和 Node 注入参数。
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'LANG', 'LC_ALL'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]))
  return { ...env, HOME: path.join(root, 'home'), USERPROFILE: path.join(root, 'home'),
    TMPDIR: path.join(root, 'temp'), TMP: path.join(root, 'temp'), TEMP: path.join(root, 'temp'),
    XDG_CONFIG_HOME: path.join(root, 'home/.config'), XDG_CACHE_HOME: path.join(root, 'cache'),
    APPDATA: path.join(root, 'app-data'), LOCALAPPDATA: path.join(root, 'app-data'),
    MOMENTUM_TEST_RENDER_MODE: renderMode,
    MOMENTUM_TEST_ROOT: root, MOMENTUM_TEST_ENTRY: path.join(repository, 'out/main/index.js') }
}

/** 启动原业务入口，返回桌面对象与隔离诊断信息。 */
export async function launchDesktop(existingRoot, renderMode = 'default') {
  // 1、先建立目录，保证 Electron 和业务静态导入均处于隔离环境。
  const root = existingRoot || await mkdtemp(path.join(os.tmpdir(), 'momentum-regression-'))
  for (const directory of ['home', 'temp', 'cache', 'app-data']) await mkdir(path.join(root, directory), { recursive: true })
  await writeFile(path.join(root, '.momentum-test-root'), 'isolated desktop regression\n')
  const application = await electron.launch({ args: [path.join(repository, 'tests/helpers/electron-bootstrap.cjs')], cwd: root, env: isolatedEnvironment(root, renderMode), timeout: 30000 })
  const errors = []
  const logs = []
  application.process().stdout?.on('data', (data) => logs.push(data.toString()))
  application.process().stderr?.on('data', (data) => logs.push(data.toString()))
  application.on('window', (window) => {
    window.on('pageerror', (error) => errors.push(error.message))
    window.on('console', (message) => logs.push(`[renderer:${message.type()}] ${message.text()}\n`))
  })
  // 2、等待实际主窗口及 Vue 挂载；不依靠固定延迟假定启动完成。
  let page
  try {
    page = await application.firstWindow()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.waitForLoadState('domcontentloaded')
    await page.waitForFunction(() => document.querySelector('#app')?.children.length > 0)
  } catch (error) {
    await writeFile(path.join(root, 'desktop.log'), logs.join(''))
    await application.close().catch(() => {})
    throw new Error(`隔离桌面启动失败，日志：${path.join(root, 'desktop.log')}\n${logs.join('')}`, { cause: error })
  }
  return { application, page, root, errors, logs,
    /** 关闭真实应用并保存脱离用户配置的诊断记录。 */
    async close() {
      // 1、先采集隔离检查结果，再让生产退出持久化正常执行。
      const safety = await application.evaluate(() => ({ violations: globalThis.__momentumTest.violations, writes: globalThis.__momentumTest.writes }))
      await application.close()
      const finalSafety = await readJson(path.join(root, 'isolation.json'))
      await writeFile(path.join(root, 'desktop.log'), logs.join(''))
      await writeFile(path.join(root, 'diagnostics.json'), JSON.stringify({ errors, safety: finalSafety }, null, 2))
      assert.deepEqual(safety.violations, [], '业务代码尝试越界写入')
      assert.deepEqual(finalSafety.violations, [], '应用退出时触发了隔离违规')
    }
  }
}

/** 从真实业务画布读取 PNG 和可观察尺寸。 */
export async function captureCanvas(page, selector = '.render-canvas') {
  // 1、从用户可见的画布取快照，而不是另写一套测试渲染器。
  return page.locator(selector).evaluate((canvas) => ({ width: canvas.width, height: canvas.height, png: canvas.toDataURL('image/png').split(',')[1] }))
}

/** 读取 JSON 诊断记录，供重启及隔离检查复用。 */
export async function readJson(filePath) {
  // 1、使用真实文件系统，不以进程内状态代替磁盘恢复。
  return JSON.parse(await readFile(filePath, 'utf8'))
}
