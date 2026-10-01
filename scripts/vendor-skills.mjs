/**
 * 生成内置 Skills：按固定 commit 从 GitHub 下载 MIT 许可的开源 Skill，逐字写入 JS 模块（打包会排除 .md 文件，所以不直接放磁盘文件）。
 * 用法：node scripts/vendor-skills.mjs
 */
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OUTPUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/main/creative-agent/builtin-skills')

// 只收录许可证允许再分发的成熟 Skill；LICENSE 原文随 Skill 一起安装。
const SOURCES = [
  {
    id: 'gpt-image-prompting',
    category: 'image',
    repo: 'RBYHNDRDS/gpt-image-prompting-skill',
    commit: '6fc237847f303b8f6981d73d2dd6ce665b17f9a4',
    files: { 'SKILL.md': 'SKILL.md', LICENSE: 'LICENSE' }
  },
  {
    id: 'seedance-prompt',
    category: 'video',
    repo: 'zhouwei713/seedance-prompt',
    commit: 'f3336851c4eed8cdd6ce0f27df351611d4f751dd',
    files: {
      'SKILL.md': 'SKILL.md',
      'references/anti-ai-checklist.md': 'references/anti-ai-checklist.md',
      'references/atmosphere-dictionary.md': 'references/atmosphere-dictionary.md',
      'references/camera-aesthetics.md': 'references/camera-aesthetics.md',
      LICENSE: 'LICENSE'
    }
  },
  {
    id: 'short-drama',
    category: 'script',
    repo: 'dingmike/short-dramas',
    commit: '2ef8c9064c64129d734ba441788577659965afa4',
    files: {
      'SKILL.md': 'skills/short-drama/SKILL.md',
      ...Object.fromEntries(['compliance-checklist', 'genre-guide', 'hook-design', 'opening-rules', 'paywall-design', 'rhythm-curve', 'satisfaction-matrix', 'villain-design']
        .map((name) => [`references/${name}.md`, `skills/short-drama/references/${name}.md`])),
      LICENSE: 'LICENSE'
    }
  }
]

for (const source of SOURCES) {
  const files = {}
  for (const [target, remote] of Object.entries(source.files)) {
    const url = `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${remote}`
    const response = await globalThis.fetch(url)
    if (!response.ok) throw new Error(`下载失败 ${url}: HTTP ${response.status}`)
    files[target] = await response.text()
  }
  const name = `vendored-${source.id}.js`
  const header = `/** 内置 Skill（自动生成，勿手改）：${source.repo}@${source.commit.slice(0, 7)}，MIT 许可，原文逐字收录。重新生成：node scripts/vendor-skills.mjs */\n`
  const body = `export default ${JSON.stringify({ id: source.id, category: source.category, repo: source.repo, commit: source.commit, license: 'MIT', files }, null, 2)};\n`
  await writeFile(path.join(OUTPUT_DIR, name), header + body)
  console.log(`已生成 ${name}（${Object.keys(files).length} 个文件）`)
}
