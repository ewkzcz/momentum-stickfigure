import test from 'node:test'
import assert from 'node:assert/strict'
import { completionBlockers } from '../scripts/check-completion-gate.mjs'
import { readFile } from 'node:fs/promises'

test('收工门禁：任一未完成、失败或外部未验均不能通过', async () => {
  const current = JSON.parse(await readFile(new URL('../completion-status.json', import.meta.url), 'utf8'))
  const ready = {
    schema: 1,
    items: Object.fromEntries(Object.keys(current.items).map(id => [id, 'completed'])),
    unresolvedFailures: [],
    external: Object.fromEntries(Object.keys(current.external).map(id => [id, { status: 'passed', evidence: 'external-evidence.json' }])),
    fullAcceptanceResult: 'full-result.json'
  }
  assert.deepEqual(completionBlockers(ready), [])
  for (const id of Object.keys(ready.items)) {
    const state = globalThis.structuredClone(ready)
    state.items[id] = 'in_progress'
    assert.ok(completionBlockers(state).some(value => value.includes(id)))
  }
  for (const id of Object.keys(ready.external)) {
    const state = globalThis.structuredClone(ready)
    state.external[id].status = 'unverified'
    assert.ok(completionBlockers(state).some(value => value.includes(id)))
  }
  assert.ok(completionBlockers({ ...ready, unresolvedFailures: ['negative failed'] }).some(value => value.includes('negative failed')))
  assert.ok(completionBlockers({ ...ready, fullAcceptanceResult: null }).length)
  assert.ok(completionBlockers({}).length)
})
