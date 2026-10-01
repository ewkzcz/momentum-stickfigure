/** 收工门禁：状态、外部验收和当前累计证据全部满足才返回零退出码。 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { verifyManifest } from '../tests/helpers/acceptance-provenance.mjs'

const items = ['finish-psd-budgets', 'finish-performance', 'finish-python-lifecycle', 'finish-ipc-boundaries', 'finish-file-authorization', 'finish-web-permissions', 'finish-sandbox-csp', 'finish-config-sharing', 'finish-final-acceptance']
const external = ['platform-installers', 'real-system-interactions', 'third-party-and-ai-python']
export function completionBlockers(state) {
  const blockers = []
  if (state?.schema !== 1) blockers.push('状态文件格式无效')
  for (const id of items) if (state?.items?.[id] !== 'completed') blockers.push(`未完成：${id}`)
  if (!Array.isArray(state?.unresolvedFailures)) blockers.push('缺少失败项清单')
  else for (const failure of state.unresolvedFailures) blockers.push(`未解决失败：${failure}`)
  for (const id of external) {
    const entry = state?.external?.[id]
    if (entry?.status !== 'passed' || typeof entry?.evidence !== 'string' || !entry.evidence) blockers.push(`外部未验证或缺少证据：${id}`)
  }
  if (typeof state?.fullAcceptanceResult !== 'string' || !state.fullAcceptanceResult) blockers.push('缺少最终累计验收证据')
  return blockers
}

async function main() {
  const repository = fileURLToPath(new URL('../', import.meta.url))
  const state = JSON.parse(await readFile(path.join(repository, 'completion-status.json'), 'utf8'))
  const blockers = completionBlockers(state)
  if (!blockers.length) {
    try {
      for (const id of external) {
        const evidence = JSON.parse(await readFile(path.resolve(repository, state.external[id].evidence), 'utf8'))
        if (evidence.status !== 'passed' || evidence.category !== id || evidence.realEnvironment !== true) throw new Error(`外部证据无效：${id}`)
      }
      const evidence = JSON.parse(await readFile(path.resolve(repository, state.fullAcceptanceResult), 'utf8'))
      if (!evidence.passed || evidence.mode !== 'all' || !evidence.finishedAt || evidence.integrityErrors?.length !== 0) throw new Error('累计验收未完整通过')
      const labels = ['source-lint', 'lint', 'size', 'build', 'all', 'references-before', 'references-after']
      for (const label of labels) if (!evidence.commands?.some(command => command.label === label && command.status === 0 && !command.signal)) throw new Error(`累计验收缺少通过阶段：${label}`)
      if (!evidence.testSummary?.some(line => /(?:ℹ|#) tests [1-9]\d*/.test(line))) throw new Error('缺少实际测试数量')
      await verifyManifest(repository, evidence.manifest.path)
    } catch (error) { blockers.push(`证据校验失败：${error.message}`) }
  }
  console.log(JSON.stringify({ canFinish: blockers.length === 0, conclusion: blockers.length ? '还不能收工' : '全部门禁通过，证据仍须主代理审核', blockers }, null, 2))
  process.exitCode = blockers.length ? 1 : 0
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`还不能收工：${error.message}`); process.exitCode = 1 })
}
