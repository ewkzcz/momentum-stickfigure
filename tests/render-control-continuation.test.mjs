import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { useCommonControlLayerSync } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/useCommonControlLayerSync.js'

for (const kind of ['session', 'newer-request']) test(`旧图层完成不得回写控件：${kind}`, async () => {
  const showBackground = ref(true), selectedPresetId = ref(null)
  const coordinator = { generation: 0, sequence: 0 }
  let release
  const sync = useCommonControlLayerSync({ showBackground, selectedPresetId, getRenderCoordinator: () => coordinator,
    originalHandleLayerVisibilityChange: () => { coordinator.sequence++; return new Promise(resolve => { release = resolve }) } })
  const work = sync.handleLayerVisibilityChange({ layerPath: '背景', visible: false })
  if (kind === 'session') coordinator.generation++
  else coordinator.sequence++
  release()
  await work
  assert.equal(showBackground.value, true)
})
