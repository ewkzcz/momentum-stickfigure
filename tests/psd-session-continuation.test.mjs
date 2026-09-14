import test from 'node:test'
import assert from 'node:assert/strict'
import { effectScope, ref, shallowRef, nextTick } from 'vue'
import { usePsdSession } from '../src/renderer/src/components/pages/ActionExpressionPage/composables/usePsdSession.js'
const flush = async () => { for(let i=0;i<8;i++) await nextTick() }
function setup(t) {
  t.mock.timers.enable({apis:['setTimeout']})
  for(const key of ['log','warn','error']) t.mock.method(console,key,()=>{})
  const a={id:'A',name:'A',data:{width:2,height:2}}, b={id:'B',name:'B',data:{width:3,height:3}}
  const session={psdFiles:ref([a,b]),currentPsdFile:shallowRef(null),currentPsdData:shallowRef(null),psdPartsCache:ref({}),psdStatesCache:ref({}),currentTab:ref('left'),userInteracted:ref({})}
  const parts={dynamicExpressionParts:ref({}),initialSorted:ref(false),getFirstDefaultTabKey:()=> 'left',clearAllPartsState(){}}
  for(const key of ['dynamicExpressionTabs','dynamicFrontHandTabs','dynamicBackHandTabs','dynamicBothHandsTabs','dynamicUpperBodyTabs','dynamicLowerBodyTabs','dynamicActionTabs'])parts[key]=ref([])
  const pending=[],calls={presets:[],templates:0,renders:[]}
  const canvas={canvasRef:shallowRef(null),canvasWidth:ref(0),canvasHeight:ref(0),updateCanvasDisplaySize(){},resetPreviewWindowViewport(){},renderAllLayers:()=>calls.renders.push(session.currentPsdFile.value?.id)}
  const presetState={presets:ref([]),selectedPresetId:ref(null),editingPresetId:ref(null),loadPresets:()=>{calls.presets.push(session.currentPsdFile.value?.id);return new Promise(resolve=>pending.push(resolve))}}
  const templateState={templates:ref([]),loadTemplates:async()=>{calls.templates++}}
  for(const key of ['selectedTemplate1Id','selectedTemplate2Id','editingTemplate1Id','editingTemplate2Id'])templateState[key]=ref(null)
  const scope=effectScope()
  const module=scope.run(()=>usePsdSession({session,parts,canvas,presetState,templateState,layerTree:{layerTreeData:ref([]),buildLayerTree:()=>[]},commonControls:{getCommonControlsState:()=>({}),restoreCommonControlsState(){}},message:{success(){}}}))
  t.after(()=>scope.stop())
  return {a,b,session,canvas,module,scope,pending,calls}
}
test('nextTick尚未执行的旧切换不能启动新会话加载',async t=>{
 const f=setup(t);f.module.switchPsdFile(f.a);f.module.switchPsdFile(f.b);await flush()
 assert.deepEqual(f.calls.presets,['B'])
 for(const release of f.pending)release();await flush()
})
for(const mode of ['switch','roundtrip','unmount'])test(`预设等待期间${mode}：旧续体不加载模板或补绘`,async t=>{
 const f=setup(t);f.module.switchPsdFile(f.a);await flush()
 if(mode==='unmount')f.scope.stop();else {f.module.switchPsdFile(f.b);if(mode==='roundtrip')f.module.switchPsdFile(f.a)}
 await flush();f.pending[0]();await flush();t.mock.timers.tick(100);await flush()
 assert.equal(f.calls.templates,0);assert.deepEqual(f.calls.renders,[])
 for(const release of f.pending.slice(1))release();await flush()
})
test('已排定补绘的A→B→A仅执行新激活任务，尺寸变化不取消正常任务',async t=>{
 const f=setup(t);f.module.switchPsdFile(f.a);await flush();f.pending[0]();await flush()
 f.module.switchPsdFile(f.b);f.module.switchPsdFile(f.a);await flush()
 t.mock.timers.tick(100);await flush();assert.deepEqual(f.calls.renders,[])
 for(const release of f.pending.slice(1))release();await flush();f.canvas.canvasWidth.value=8;t.mock.timers.tick(100);await flush()
 assert.deepEqual(f.calls.renders,['A'])
})
