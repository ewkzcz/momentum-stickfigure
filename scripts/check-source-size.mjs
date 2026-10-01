/** 手写源码规模检查：遗留超限持续报告，新文件及遗留增长立即失败。 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const excluded = new Set(['node_modules', '.git', 'out', 'dist', 'release', 'temp', 'output', 'cache', 'logs', '.cursor', '.agents', '.claude', '.codex'])
const legacy = new Map([
  ['src/renderer/src/components/pages/ActionExpressionPage/ActionExpressionPage.vue', 8885],
  ['src/renderer/src/components/pages/SettingsPage/SettingsPage.vue', 3064],
  ['src/main/index.js', 2948],
  ['src/renderer/src/components/pages/DialogFramePage/components/DialogFrameCanvas.vue', 2738],
  ['src/renderer/src/components/pages/ActionExpressionPage/ActionExpressionPage.css', 2721],
  ['src/renderer/src/components/pages/GeneratePage/GeneratePage.vue', 2454]
])
const violations = []
const pending = []

/** 递归检查手写源码，统计注释及空行，排除依赖与生成目录。 */
async function scan(directory) {
  // 1、逐目录遍历真实文件，不跟随符号链接进入用户数据或外部目录。
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excluded.has(entry.name)) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) await scan(absolute)
    else if (entry.isFile() && /\.(?:js|mjs|cjs|vue|css)$/.test(entry.name)) {
      const text = await readFile(absolute, 'utf8')
      const lines = text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
      const relative = path.relative(root, absolute).split(path.sep).join('/')
      if (lines > 2000) {
        const result = { path: relative, lines }
        pending.push(result)
        if (process.argv.includes('--strict') || lines > (legacy.get(relative) || 2000)) violations.push(result)
      }
    }
  }
}

// 2、迁移途中只允许原有超限范围；阶段验收必须使用严格模式清零。
await scan(root)
for (const item of pending) console.log(`待拆分 ${item.lines} 行：${item.path}`)
console.log(`超限文件 ${pending.length} 个；本次规模违规 ${violations.length} 个`)
if (violations.length) process.exitCode = 1
