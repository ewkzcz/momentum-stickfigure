/** 公开桌面回归入口：固定公开测试清单，保留真实Electron启动失败与隔离诊断。 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, copyFile, mkdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const evidenceDirectory = path.join(repository, 'temp/public-desktop-ci')
// 1、此集合不调用私人fixtures或读取冻结截图，不能替代本机完整RGBA回归。
const files = [
  'tests/psd-worker-queue.test.mjs',
  'tests/psd-sender-boundaries.test.mjs',
  'tests/psd-cancellation.test.mjs',
  'tests/browser-load-failure.test.mjs',
  'tests/browser-pending-close.test.mjs',
  'tests/browser-view-disposal.test.mjs',
  'tests/browser-owner.test.mjs',
  'tests/custom-dialog-files.test.mjs',
  'tests/custom-dialog-path.test.mjs',
  'tests/drag-start-failure.test.mjs',
  'tests/storage-atomicity.test.mjs',
  'tests/storage-mode.test.mjs'
]
for (const file of ['out/main/index.js', ...files]) await access(path.join(repository, file))
await mkdir(evidenceDirectory, { recursive: true })
const args = ['--test', '--test-concurrency=1', ...files]
const child = spawn(process.execPath, args, { cwd: repository, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
let output = ''
for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; process.stdout.write(data) })
const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', resolve) })
await writeFile(path.join(evidenceDirectory, 'run.log'), output)
// 2、只拷贝本轮输出列举的隔离目录内文本诊断，不递归打包用户目录或素材。
const roots = [...new Set([...output.matchAll(/momentum-regression-[\w-]+/g)].map(match => match[0]))]
for (const root of roots) {
  const destination = path.join(evidenceDirectory, root)
  await mkdir(destination, { recursive: true })
  for (const file of ['desktop.log', 'diagnostics.json', 'isolation.json']) {
    try { await copyFile(path.join(os.tmpdir(), root, file), path.join(destination, file)) } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
await writeFile(path.join(evidenceDirectory, 'summary.json'), JSON.stringify({ files, code, roots, platform: process.platform, arch: process.arch, node: process.version, limits: ['公开夹具子集，不是私人PSD零差异或跨平台安装验收', '渐进lint不是全仓src lint', 'Electron启动失败保持非零，不跳过桌面测试'] }, null, 2))
// 3、必须确实启动过桌面测试；原子测试失败或环境不足都向CI返回失败。
assert.ok(roots.length > 0, '未运行真实桌面测试')
process.exitCode = code ?? 1
