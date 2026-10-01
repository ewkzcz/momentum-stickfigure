import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { callLlm } from '../src/main/creative-agent/llm-client.js'
import { listSkills, installBuiltinSkills, readSkillFile, buildSkillContext } from '../src/main/creative-agent/skill-store.js'
import { runCreativeAgent } from '../src/main/creative-agent/agent-runner.js'
import { saveProject, listProjects, loadProject, deleteProject } from '../src/main/creative-agent/script-store.js'

/** 启动本地模拟网关；1、按顺序返回预设响应并记录请求体。 */
async function mockGateway(routes) {
  const requests = []
  const server = http.createServer(async (req, res) => {
    let body = ''
    for await (const chunk of req) body += chunk
    requests.push({ url: req.url, body: body ? JSON.parse(body) : null })
    const route = routes.find((item) => req.url.startsWith(item.path))
    const reply = route ? route.replies.shift() : null
    if (!reply) { res.writeHead(404).end('{}'); return }
    if (reply.sse) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      for (const event of reply.sse) res.write(`data: ${JSON.stringify(event)}\n\n`)
      res.end('data: [DONE]\n\n')
      return
    }
    res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() }
}

function tempDir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'creative-agent-')) }

test('Skills：内置安装不覆盖用户修改，列表/引用/上下文读取受限于根目录', () => {
  const root = tempDir()
  const first = installBuiltinSkills(root)
  assert.deepEqual(first.installed, ['gpt-image-prompting', 'seedance-prompt', 'short-drama'])
  assert.match(fs.readFileSync(path.join(root, 'short-drama', 'LICENSE'), 'utf8'), /MIT License/)
  fs.writeFileSync(path.join(root, 'seedance-prompt', 'SKILL.md'), '---\nname: 我的版本\n---\n用户改过')
  assert.equal(installBuiltinSkills(root).installed.length, 0)
  fs.mkdirSync(path.join(root, 'my-skill'))
  fs.writeFileSync(path.join(root, 'my-skill', 'SKILL.md'), '---\nname: 自定义\ndescription: |\n  多行\n  描述\ncategory: image\n---\n正文')
  fs.mkdirSync(path.join(root, 'novel-helper'))
  fs.writeFileSync(path.join(root, 'novel-helper', 'SKILL.md'), '---\nname: novel-helper\ndescription: 长篇小说写作助手\n---\n正文')
  const skills = listSkills(root)
  assert.equal(skills.find((item) => item.id === 'novel-helper').category, 'script')
  assert.equal(skills.find((item) => item.id === 'short-drama').category, 'script')
  assert.equal(skills.find((item) => item.id === 'seedance-prompt').category, 'video')
  assert.equal(skills.find((item) => item.id === 'my-skill').description, '多行 描述')
  assert.equal(skills.find((item) => item.id === 'seedance-prompt').name, '我的版本')
  assert.ok(skills.find((item) => item.id === 'short-drama').references.includes('references/villain-design.md'))
  assert.ok(readSkillFile(root, 'short-drama', 'references/villain-design.md').length > 100)
  assert.throws(() => readSkillFile(root, 'short-drama', '../../etc/passwd'))
  assert.throws(() => readSkillFile(root, 'short-drama', 'SKILL.md'))
  assert.throws(() => readSkillFile(root, 'short-drama', 'LICENSE'))
  assert.match(buildSkillContext(root, ['my-skill', 'missing'], { mode: 'index' }), /my-skill：多行 描述/)
})

test('剧本项目：保存生成ID、列表倒序、拒绝路径穿越ID', () => {
  const root = tempDir()
  const saved = saveProject(root, { title: '测试剧本', stages: { logline: 'x' } })
  assert.match(saved.id, /^[\w-]+$/)
  assert.equal(loadProject(root, saved.id).stages.logline, 'x')
  assert.equal(listProjects(root)[0].title, '测试剧本')
  assert.throws(() => loadProject(root, '../x'))
  deleteProject(root, saved.id)
  assert.equal(listProjects(root).length, 0)
})

test('文本模型：chat 与 responses 流式增量拼接', async () => {
  const gateway = await mockGateway([
    { path: '/v1/chat/completions', replies: [{ sse: [{ choices: [{ delta: { content: '你' } }] }, { choices: [{ delta: { content: '好' } }] }] }] },
    { path: '/v1/responses', replies: [{ sse: [{ type: 'response.output_text.delta', delta: 'ok' }, { type: 'response.completed' }] }] }
  ])
  try {
    const deltas = []
    const chat = await callLlm({ baseUrl: gateway.baseUrl, apiKey: 'k', model: 'm', protocol: 'chat' }, { instructions: '系统', messages: [{ role: 'user', content: 'hi' }], stream: true, onDelta: (d) => deltas.push(d) })
    assert.equal(chat.text, '你好')
    assert.deepEqual(deltas, ['你', '好'])
    assert.equal(gateway.requests[0].body.messages[0].role, 'system')
    const responses = await callLlm({ baseUrl: gateway.baseUrl, apiKey: 'k', model: 'm', protocol: 'responses' }, { instructions: '系统', messages: [{ role: 'user', content: 'hi' }], stream: true })
    assert.equal(responses.text, 'ok')
    assert.equal(gateway.requests[1].body.instructions, '系统')
  } finally { gateway.close() }
})

test('视频 Agent（chat 协议）：加载 Skill → 提交并轮询视频 → 总结，未启用 Skill 被拒绝', async () => {
  const root = tempDir()
  installBuiltinSkills(root)
  const gateway = await mockGateway([
    {
      path: '/v1/chat/completions',
      replies: [
        { choices: [{ message: { content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'load_skill', arguments: '{"name":"seedance-prompt"}' } }, { id: 'c2', type: 'function', function: { name: 'load_skill', arguments: '{"name":"gpt-image-prompting"}' } }] } }] },
        { choices: [{ message: { content: '', tool_calls: [{ id: 'c3', type: 'function', function: { name: 'generate_video', arguments: '{"prompt":"小人挥手","duration":4}' } }] } }] },
        { choices: [{ message: { content: '完成，使用了 Seedance Skill' } }] }
      ]
    },
    { path: '/v1/video/generations/task_1', replies: [{ code: 'success', data: { task_id: 'task_1', status: 'SUCCESS', progress: '100%', video_url: 'https://media.example/v.mp4' } }] },
    { path: '/v1/video/generations', replies: [{ task_id: 'task_1', status: 'queued', progress: 0 }] }
  ])
  try {
    const events = []
    const result = await runCreativeAgent({
      mode: 'video',
      llm: { baseUrl: gateway.baseUrl, apiKey: 'k', model: 'm', protocol: 'chat' },
      skillsRoot: root,
      skillIds: ['seedance-prompt'],
      history: [{ role: 'user', content: '做一个小人挥手的视频' }],
      videoConfig: { baseUrl: gateway.baseUrl, apiKey: 'k', model: 'seedance-2.0-fast', resolution: '480p', duration: 5, aspectRatio: '16:9' },
      allowGenerate: true
    }, (event) => events.push(event), new globalThis.AbortController().signal)
    assert.equal(result.text, '完成，使用了 Seedance Skill')
    assert.ok(events.some((e) => e.type === 'video' && e.url === 'https://media.example/v.mp4'))
    const second = gateway.requests.filter((r) => r.url === '/v1/chat/completions')[1].body
    assert.match(second.messages.find((m) => m.tool_call_id === 'c1').content, /references\/camera-aesthetics\.md/)
    assert.match(second.messages.find((m) => m.tool_call_id === 'c2').content, /未启用/)
    const submit = gateway.requests.find((r) => r.url === '/v1/video/generations').body
    assert.equal(submit.duration, 4)
    assert.equal(submit.metadata.aspect_ratio, '16:9')
  } finally { gateway.close() }
})

test('图片 Agent（responses 协议、只写提示词）：不提供生成工具，function_call_output 回传', async () => {
  const root = tempDir()
  installBuiltinSkills(root)
  const gateway = await mockGateway([{
    path: '/v1/responses',
    replies: [
      { output: [{ type: 'function_call', call_id: 'r1', name: 'load_skill', arguments: '{"name":"gpt-image-prompting"}' }] },
      { output: [{ type: 'message', content: [{ type: 'output_text', text: '最终提示词：纯白背景简笔画' }] }] }
    ]
  }])
  try {
    const result = await runCreativeAgent({
      mode: 'image',
      llm: { baseUrl: gateway.baseUrl, apiKey: 'k', model: 'm', protocol: 'responses' },
      skillsRoot: root, skillIds: ['gpt-image-prompting'],
      history: [{ role: 'user', content: '画个火柴人' }],
      imageConfig: {}, allowGenerate: false
    }, () => {}, new globalThis.AbortController().signal)
    assert.match(result.text, /最终提示词/)
    const [first, second] = gateway.requests.map((r) => r.body)
    assert.deepEqual(first.tools.map((t) => t.name), ['load_skill', 'read_skill_reference'])
    assert.equal(second.input.find((i) => i.type === 'function_call_output').call_id, 'r1')
  } finally { gateway.close() }
})

test('生成记录：保存原图与缩略图、筛选搜索、置顶排序、收藏、改名、批量删除并清理文件', async () => {
  const { addRecord, listRecords, updateRecord, deleteRecords, readMedia } = await import('../src/main/creative-agent/history-store.js')
  const { createCanvas } = await import('@momentum/media-canvas')
  const root = tempDir()
  const canvas = createCanvas(800, 450)
  canvas.getContext('2d').fillRect(0, 0, 800, 450)
  const png = `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`
  const first = await addRecord(root, { kind: 'image', mode: 'direct', prompt: '红裙女主站在车前', images: [png], params: { model: 'gpt-image-2' } })
  const second = await addRecord(root, { kind: 'image', mode: 'agent', input: '帮我画分镜第一镜', prompt: 'cinematic', reply: '已生成', images: [png] })
  await addRecord(root, { kind: 'video', mode: 'direct', prompt: '挥手', videos: ['https://media.example/v.mp4'] })
  assert.equal(first.title, '红裙女主站在车前')
  assert.match(first.media[0].thumb, /^data:image\/jpeg;base64,/)
  assert.equal(first.media[0].file, undefined)
  assert.equal(listRecords(root, { kind: 'image' }).length, 2)
  assert.equal(listRecords(root, { kind: 'image', mode: 'agent' })[0].id, second.id)
  assert.equal(listRecords(root, { kind: 'image', keyword: '女主' })[0].id, first.id)
  await updateRecord(root, first.id, { pinned: true, favorite: true, title: '女主概念图' })
  const sorted = listRecords(root, { kind: 'image' })
  assert.deepEqual([sorted[0].id, sorted[0].title, sorted[0].favorite], [first.id, '女主概念图', true])
  assert.deepEqual(listRecords(root, { kind: 'image', favoriteOnly: true }).map((item) => item.id), [first.id])
  assert.equal(readMedia(root, first.id, 0).url, png)
  assert.throws(() => updateRecord(root, first.id, { title: '   ' }))
  assert.equal(deleteRecords(root, [first.id, second.id, '../x']), 2)
  assert.equal(listRecords(root, { kind: 'image' }).length, 0)
  assert.deepEqual(fs.readdirSync(path.join(root, 'media')), [])
})
