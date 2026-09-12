/** 图像处理工作流回归：真实 Electron 公开界面与真实磁盘，服务替身不验证真实 AI 或 Python。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { setTimeout as pollDelay } from 'node:timers/promises'
import { createCanvas } from '@napi-rs/canvas'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { assertSamePixels, decodePng } from './helpers/images.mjs'

const sourcePath = 'src/renderer/src/components/pages/GeneratePage'
const fakeKey = 'local-only-generate-workflow-fake-key-never-send'
const channels = ['fal-generate-image', 'fal-edit-image', 'hd:get-initial-data', 'hd:run-removebg', 'hd:run-highres']

/** 计算证据摘要；1、对字节或字符串计算 SHA-256，不包含外部素材。 */
function hash(value) { return createHash('sha256').update(value).digest('hex') }

/** 构造可重复的 PNG；1、保留透明区域、半透明区域和不对称色块。 */
function fixture(color) {
  const canvas = createCanvas(96, 64)
  const context = canvas.getContext('2d')
  context.fillStyle = color
  context.fillRect(7, 9, 58, 41)
  context.fillStyle = '#efb943'
  context.fillRect(12, 15, 11, 17)
  context.fillStyle = 'rgba(71,121,200,0.5)'
  context.fillRect(62, 32, 25, 22)
  return canvas.toBuffer('image/png')
}

/** 有界等待异步公开结果；1、轮询真实文件或服务记录，失败保留最后原因。 */
async function eventually(read, accept, label) {
  const deadline = Date.now() + 15000
  let last
  while (Date.now() < deadline) {
    try {
      last = await read()
      if (accept(last)) return last
    } catch (error) { last = error.message }
    await pollDelay(40)
  }
  assert.fail(`${label}：等待超时，最后结果 ${JSON.stringify(last)}`)
}

/** 规范化隔离路径和图片编码；1、保留业务参数，2、只替换根目录、导出文件名时间和长图片编码。 */
function normalize(value, root) {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/')) return { dataUrlSha256: hash(value) }
    return value.split(root).join('<ROOT>').replace(/G_\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_(\d{2})\.png/g, 'G_<TIME>_$1.png')
  }
  if (Array.isArray(value)) return value.map(item => normalize(item, root))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item, root)]))
  return value
}

/** 读取真实共享任务文件；1、等待完整 JSON 和指定任务状态，不读取 Vue 实例或直接调用任务方法。 */
async function diskTasks(root, count, status) {
  const file = path.join(root, 'home/.config/momentum-stickfigure-open/shared-storage.json')
  return eventually(async () => {
    const storage = JSON.parse(await readFile(file, 'utf8'))
    return JSON.parse(storage['fal-tasks'] || '{"tasks":[],"activeTasks":[]}')
  }, data => data.tasks.length === count && (!count || data.tasks.at(-1)[1].status === status), '任务必须由原存储实现写入磁盘')
}

/** 规范化任务记录；1、映射随机编号，2、将时间转为是否存在，保留所有其余任务字段。 */
function normalizeTasks(data, root) {
  const ids = new Map(data.tasks.map(([id], index) => [id, `task-${index + 1}`]))
  return {
    tasks: data.tasks.map(([id, task]) => {
      const result = task.result?.map(({ id: imageId, ...image }) => ({ ...image, hasId: typeof imageId === 'string' && imageId.length > 0 })) ?? null
      const { id: taskId, startTime, endTime, createdAt, updatedAt, ...rest } = task
      assert.equal(id, taskId)
      assert.ok(startTime > 0 && createdAt > 0 && updatedAt >= createdAt)
      if (['completed', 'failed'].includes(task.status)) assert.ok(endTime >= startTime)
      return { id: ids.get(id), ...normalize({ ...rest, result }, root), hasStartTime: startTime > 0, hasEndTime: endTime !== null, hasCreatedAt: createdAt > 0, hasUpdatedAt: updatedAt > 0 }
    }),
    activeTasks: data.activeTasks.map(id => { assert.ok(ids.has(id)); return ids.get(id) })
  }
}

/** 采集页面公开状态；1、只读取实际 DOM、输入值、按钮及图片解码尺寸。 */
async function publicState(page) {
  return page.locator('.image-processing-page').evaluate(root => ({
    text: root.innerText.replace(/\s+/g, ' ').trim(),
    prompt: root.querySelector('textarea')?.value ?? null,
    buttons: [...root.querySelectorAll('button')].map(button => ({ text: button.textContent.trim(), disabled: button.disabled, loading: button.classList.contains('n-button--loading') })),
    radios: [...root.querySelectorAll('.n-radio-button')].map(node => ({ text: node.textContent.trim(), checked: node.classList.contains('n-radio-button--checked') })),
    inputs: [...root.querySelectorAll('input')].map(node => ({ value: node.value, disabled: node.disabled, role: node.getAttribute('role') })),
    images: ['input', 'output'].map(kind => ({ kind, items: [...root.querySelectorAll(`.${kind}-section .media-card`)].map(node => {
      const image = node.querySelector('img')
      return { name: node.querySelector('.media-name').textContent.trim(), src: image.getAttribute('src'), complete: image.complete, width: image.naturalWidth, height: image.naturalHeight }
    }) }))
  }))
}

/** 获取稳定界面截图；1、等待真实图像和消息结束，2、逐次解码比较三张连续 RGBA，不掩盖页面内容。 */
async function screenshot(page) {
  await page.mouse.move(1, 1)
  await page.evaluate(() => { document.activeElement?.blur(); return document.fonts.ready })
  await page.waitForFunction(() => !document.querySelector('.n-message') && !document.querySelector('.image-processing-page .n-base-wave--active') && [...document.querySelectorAll('.image-processing-page .media-card img')].every(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 15000 })
  let previous
  let stable = 0
  let png
  await eventually(async () => {
    png = await page.locator('.image-processing-page').screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' })
    const decoded = await decodePng(png)
    const current = `${decoded.width}:${decoded.height}:${hash(decoded.rgba)}`
    stable = previous === current ? stable + 1 : 0
    previous = current
    return stable
  }, count => count >= 2, '页面截图必须连续三张 RGBA 一致')
  return png
}

/** 安装五个受控服务边界；1、只替换明确授权的 IPC，2、未知调用默认失败，3、保留文件和后台保护原实现。 */
async function installServices(application, config) {
  await application.evaluate(({ ipcMain }, config) => {
    const state = { calls: [], plans: {}, pending: {}, initial: config.initial }
    globalThis.__generateWorkflow = state
    for (const channel of config.channels) {
      ipcMain.removeHandler(channel)
      ipcMain.handle(channel, async (_event, params) => {
        state.calls.push({ channel, params: params ?? null })
        if (channel === 'hd:get-initial-data') return { success: true, data: state.initial }
        const plan = state.plans[channel]?.shift()
        if (!plan) throw new Error(`未安排的受控服务调用：${channel}`)
        if (plan.hold) await new Promise(resolve => { state.pending[channel] = resolve })
        if (plan.throwMessage) throw new Error(plan.throwMessage)
        return plan.response
      })
    }
  }, { ...config, channels })
}

/** 安排一次服务结果；1、仅向服务替身排队，调用必须由真实页面点击触发。 */
async function plan(application, channel, response, extra = {}) {
  await application.evaluate((_, value) => {
    const plans = globalThis.__generateWorkflow.plans
    ;(plans[value.channel] ||= []).push(value.plan)
  }, { channel, plan: { response, ...extra } })
}

/** 读取受控服务实参；1、不读取任何页面内部实现状态。 */
async function calls(application) {
  return application.evaluate(() => globalThis.__generateWorkflow.calls)
}

/** 解除服务延迟；1、只完成服务边界 Promise，不人为改变页面忙碌或任务状态。 */
async function release(application, channel) {
  await application.evaluate((_, channel) => {
    const state = globalThis.__generateWorkflow
    const resolve = state.pending[channel]
    if (!resolve) throw new Error(`服务未处于等待状态：${channel}`)
    delete state.pending[channel]
    resolve()
  }, channel)
}

test('GeneratePage：原任务持久化、共享输入输出、生成编辑恢复、抠图高清与链式真实文件', { timeout: 360000 }, async () => {
  // 1、源码来源在测试运行时记录；本文件编写阶段不执行 git、构建或 Electron。
  const root = await mkdtemp(path.join(os.tmpdir(), 'momentum-generate-workflow-'))
  const evidence = { schema: 1, passed: false, scope: '仅验证真实页面、任务存储和文件链路；受控服务不验证真实 AI、网络或 Python', scenes: [], busy: [], files: [], gaps: [], sourcePath }
  let desktop
  let stage = 'source-provenance'
  let before
  let beforeRoot
  try {
    evidence.head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim()
    evidence.sourceStatus = execFileSync('git', ['status', '--porcelain', '--', 'src'], { cwd: repository, encoding: 'utf8' })
    evidence.generatePageStatus = execFileSync('git', ['status', '--porcelain', '--', sourcePath], { cwd: repository, encoding: 'utf8' })
    console.log(`图像处理工作流证据：${root}`)
    evidence.sourceSha256 = hash(await readFile(path.join(repository, sourcePath, 'GeneratePage.vue')))
    evidence.mainBuildSha256 = hash(await readFile(path.join(repository, 'out/main/index.js')))
    const beforeLocation = process.env.MOMENTUM_GENERATE_WORKFLOW_BEFORE
    if (beforeLocation) {
      const beforeFile = beforeLocation.endsWith('.json') ? path.resolve(beforeLocation) : path.join(path.resolve(beforeLocation), 'generate-workflow-result.json')
      beforeRoot = path.dirname(beforeFile)
      before = JSON.parse(await readFile(beforeFile, 'utf8'))
      assert.equal(before.schema, evidence.schema)
      assert.equal(before.passed, true, '只接受完整通过的原版证据')
      assert.equal(before.sourcePath, sourcePath)
      assert.equal(before.sourceStatus, '', '基线 git status src 必须为空')
      assert.equal(before.generatePageStatus, '', '基线 GeneratePage 源码目录必须干净')
    } else {
      assert.equal(evidence.sourceStatus, '', '建立基线前必须保持 src 干净')
      assert.equal(evidence.generatePageStatus, '', '建立基线前必须保持 GeneratePage 源码目录干净')
    }
    stage = 'launch'
    desktop = await launchDesktop(root, 'software-layout')
    const { page, application } = desktop
    evidence.runtime = await application.evaluate(() => ({ versions: process.versions, platform: process.platform, arch: process.arch }))
    if (before) assert.deepEqual(evidence.runtime, before.runtime)
    await page.setViewportSize({ width: 1024, height: 1000 })
    const outputDir = path.join(root, 'controlled-output')
    await mkdir(outputDir)
    const generated = fixture('#963655')
    const edited = fixture('#337b65')
    const removed = fixture('#5566a7')
    const highres = fixture('#ad6535')
    const uploadPath = path.join(root, 'upload.png')
    const removePath = path.join(outputDir, 'removed.png')
    const highresPath = path.join(outputDir, 'highres.png')
    await writeFile(uploadPath, generated)
    await writeFile(removePath, removed)
    await writeFile(highresPath, highres)
    evidence.fixtures = Object.fromEntries(Object.entries({ generated, edited, removed, highres }).map(([name, bytes]) => [name, hash(bytes)]))
    if (before) assert.deepEqual(evidence.fixtures, before.fixtures)
    const generatedUrl = `data:image/png;base64,${generated.toString('base64')}`
    const editedUrl = `data:image/png;base64,${edited.toString('base64')}`
    await installServices(application, { initial: {
      config: { pythonHome: path.join(root, 'never-executed-python'), outputDir, removebgWeightsDir: path.join(root, 'fake-remove-weights'), highresWeightsDir: path.join(root, 'fake-highres-weights'), removebg: { modelId: 'u2net', alphaMatting: false }, highres: { modelId: 'real-esrgan', outscale: 2 } },
      removebgModels: [{ id: 'u2net', name: 'u2net' }], highresModels: [{ id: 'real-esrgan', name: 'real-esrgan' }]
    } })
    // 2、隔离 localStorage 只注入本地假配置；没有真实网络地址或用户密钥。
    await page.evaluate(() => { localStorage.removeItem('gemini-image-config'); localStorage.removeItem('fal-config'); location.hash = '/image-processing' })
    const panel = page.locator('.image-processing-page')
    await panel.waitFor()
    await eventually(() => calls(application), items => items.some(item => item.channel === 'hd:get-initial-data'), '等待页面加载受控本地配置')
    /** 按公开按钮名称定位；1、将查找范围限制为当前图像处理页面。 */
    const button = name => panel.locator('button').filter({ has: page.locator('.n-button__content').getByText(name, { exact: true }) })
    const prompt = panel.locator('textarea')
    let taskCount = 0
    let lastStatus

    /** 保存一个可比较场景；1、等待原任务写盘，2、保存公开状态、完整实参与 RGBA 截图，3、严格比较基线。 */
    async function scene(name) {
      stage = name
      const tasks = normalizeTasks(await diskTasks(root, taskCount, lastStatus), root)
      const png = await screenshot(page)
      const state = normalize(await publicState(page), root)
      const serviceCalls = normalize(await calls(application), root)
      const decoded = await decodePng(png)
      const record = { name, state, tasks, serviceCalls, width: decoded.width, height: decoded.height, rgbaSha256: hash(decoded.rgba) }
      evidence.scenes.push(record)
      await writeFile(path.join(root, `${name}.png`), png, { flag: 'wx' })
      if (before) {
        const expected = before.scenes.find(item => item.name === name)
        assert.ok(expected, `基线缺少场景 ${name}`)
        assert.deepEqual(record, expected, `${name}：规范化公开状态、任务、服务参数或截图发生变化`)
        await assertSamePixels(png, await readFile(path.join(beforeRoot, `${name}.png`)), name)
      }
      return record
    }

    /** 点击生成并等待提示与磁盘终态；1、验证新增任务数，2、确认界面解除忙碌。 */
    async function generate(text, expectedMessage, status) {
      stage = text
      await prompt.fill(text)
      await button('开始生图').click()
      await page.getByText(expectedMessage, { exact: true }).last().waitFor()
      taskCount++
      lastStatus = status
      await diskTasks(root, taskCount, status)
      await eventually(() => button('开始生图').isDisabled(), disabled => !disabled, '生成结束须恢复按钮')
    }

    /** 验证真实链式文件；1、从生产路径读回 PNG，2、按字节及 RGBA 验证不是替身伪造的路径。 */
    async function verifyFile(name, file, expected, requireOriginalBytes = true) {
      assert.ok(file.startsWith(root + path.sep), '链式文件必须位于隔离目录')
      const bytes = await readFile(file)
      // 1、链式 dataURL 必须原样保存；手动导出经过真实浏览器重新编码，仅要求 RGBA 相同。
      if (requireOriginalBytes) assert.deepEqual(bytes, expected, `${name}：必须保存原始 PNG 字节`)
      await assertSamePixels(bytes, expected, name)
      evidence.files.push({ name, path: normalize(file, root), sha256: hash(bytes), rgbaSha256: hash((await decodePng(bytes)).rgba) })
    }

    /** 检查同模式忙碌保护；1、真实重复点击禁用按钮，2、确认服务调用及任务数不变，3、记录取消能力缺口。 */
    async function checkBusy(channel, label, count, status) {
      await eventually(() => calls(application), items => items.filter(item => item.channel === channel).length === count, '服务调用进入受控等待')
      assert.equal(await button(label).isDisabled(), true)
      assert.equal(await button('上传图片').isDisabled(), true)
      for (const name of ['清空输入', '清空输出', '保存全部', '打开目录']) {
        const control = button(name)
        if (await control.count()) assert.equal(await control.isDisabled(), true, `${name} 在忙碌时必须禁用`)
      }
      if (await prompt.count()) assert.equal(await prompt.isDisabled(), true)
      for (const control of await panel.locator('.media-remove').all()) assert.equal(await control.isDisabled(), true)
      const beforeCalls = await calls(application)
      await button(label).click({ force: true })
      // 1、等待真实主进程与页面完成两轮事件循环，不以固定长延迟代替确认。
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.deepEqual(await calls(application), beforeCalls, '同模式忙碌时不得重复调用服务')
      const tasks = await diskTasks(root, taskCount, status)
      assert.equal(await panel.getByRole('button', { name: /取消|停止/ }).count(), 0)
      evidence.busy.push({ channel, state: normalize(await publicState(page), root), tasks: normalizeTasks(tasks, root), calls: normalize(beforeCalls, root), cancelButtonCount: 0 })
    }

    // 3、空提示不建任务；缺 Key 建立原失败任务，但不触发服务。
    stage = 'empty-prompt'
    await prompt.fill('   ')
    await button('开始生图').click()
    await page.getByText('请输入提示词后再尝试生成。', { exact: true }).waitFor()
    assert.equal((await calls(application)).filter(item => item.channel.startsWith('fal-')).length, 0)
    await scene('empty-prompt')
    await generate('missing-key', '请先在设置页配置 API Key。', 'failed')
    let record = await scene('missing-key')
    assert.equal(record.tasks.tasks.at(-1).error, '未配置 API Key')
    assert.equal((await calls(application)).filter(item => item.channel.startsWith('fal-')).length, 0)
    const userConfig = { apiKey: fakeKey, baseUrl: '', projectRoot: path.join(root, 'fake-project'), outputDir: 'generated', editOutputDir: 'edited', logDir: 'logs' }
    await page.evaluate(config => localStorage.setItem('gemini-image-config', JSON.stringify(config)), userConfig)

    // 4、生成失败、抛异常以及随后恢复，错误过滤仍由原页面执行。
    await plan(application, 'fal-generate-image', { success: false, message: 'Token quota exhausted' })
    await generate('generate-failure', '当前令牌额度已耗尽', 'failed')
    record = await scene('generate-service-failure')
    assert.equal(record.tasks.tasks.at(-1).error, '当前令牌额度已耗尽')
    await plan(application, 'fal-generate-image', null, { throwMessage: 'Connection error' })
    await generate('generate-exception', '生成失败：上游API网络连接错误，请检查代理或者切换热备', 'failed')
    await scene('generate-exception')
    await plan(application, 'fal-generate-image', { success: true, data: [generatedUrl] }, { hold: true })
    stage = 'generate-busy'
    await prompt.fill('  generate-recovery  ')
    await button('开始生图').click()
    taskCount++
    await checkBusy('fal-generate-image', '开始生图', 3, 'running')
    await release(application, 'fal-generate-image')
    await page.getByText('生成完成，得到 1 张图片', { exact: true }).waitFor()
    lastStatus = 'completed'
    await eventually(() => button('开始生图').isDisabled(), disabled => !disabled, '链式保存完成')
    const chainPath = path.join(root, 'temp/momentum-stickfigure-paste/自动保存_gen_.png')
    await verifyFile('generated-chain', chainPath, generated)
    record = await scene('generate-recovered')
    assert.equal(record.state.images[0].items.length, 1)
    assert.deepEqual(record.state.images[0].items, record.state.images[1].items)
    const generateCall = (await calls(application)).filter(item => item.channel === 'fal-generate-image').at(-1)
    assert.deepEqual(generateCall.params, { prompt: 'generate-recovery', apiKey: fakeKey, baseUrl: '', projectRoot: userConfig.projectRoot, outputDir: 'generated', logDir: 'logs', model: 'gemini-2.5-flash-image', aspectRatio: '16:9' })

    // 5、共享输入送到编辑服务；通过公开上传添加第二张图，验证输入顺序、提示词去空白与原始尺寸分支。
    stage = 'edit-inputs'
    await application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, uploadPath)
    await button('上传图片').click()
    await page.getByText('成功添加 1 张图片', { exact: true }).waitFor()
    assert.equal(await panel.locator('.input-section .media-card').count(), 2)
    await panel.locator('.ratio-select').click()
    await page.getByText('原始尺寸', { exact: true }).last().click()
    await plan(application, 'fal-edit-image', { success: true, data: [editedUrl] }, { hold: true })
    await prompt.fill('  edit-original  ')
    await button('开始生图').click()
    taskCount++
    await checkBusy('fal-edit-image', '开始生图', 1, 'running')
    const editCall = (await calls(application)).filter(item => item.channel === 'fal-edit-image').at(-1)
    assert.deepEqual(editCall.params, { prompt: 'edit-original', inputImages: [chainPath, uploadPath], apiKey: fakeKey, baseUrl: '', model: 'gemini-2.5-flash-image', projectRoot: userConfig.projectRoot, editOutputDir: 'edited', logDir: 'logs' })
    await release(application, 'fal-edit-image')
    await page.getByText('编辑完成，得到 1 张图片', { exact: true }).waitFor()
    lastStatus = 'completed'
    await eventually(() => button('开始生图').isDisabled(), disabled => !disabled, '编辑链式保存完成')
    await verifyFile('edited-chain', chainPath, edited)
    record = await scene('edit-success')
    assert.equal(record.tasks.tasks.at(-1).type, 'edit')
    assert.deepEqual(record.tasks.tasks.at(-1).config, normalize({ prompt: 'edit-original', inputImages: [chainPath, uploadPath] }, root))
    assert.ok(record.state.text.includes('16:9 宽屏'), '编辑结束恢复默认比例')
    const successfulImages = record.state.images
    for (const [name, response, extra, message] of [
      ['edit-failure', { success: false, message: '受控编辑失败' }, {}, '受控编辑失败'],
      ['edit-exception', null, { throwMessage: 'Connection error' }, '生成失败：上游API网络连接错误，请检查代理或者切换热备'],
      ['edit-recovered', { success: true, data: [editedUrl] }, {}, '编辑完成，得到 1 张图片']
    ]) {
      await plan(application, 'fal-edit-image', response, extra)
      await generate(name, message, name === 'edit-recovered' ? 'completed' : 'failed')
      record = await scene(name)
      assert.deepEqual(record.state.images, successfulImages, '失败应保留共享图片，恢复后继续使用同一输入')
    }

    // 6、保存全部的目录选择取消不得写图，随后正常导出必须使用原文件服务。
    stage = 'export-cancel'
    const writesBefore = await application.evaluate(() => globalThis.__momentumTest.writes.filter(file => file.endsWith('.png')))
    const stateBeforeCancel = normalize(await publicState(page), root)
    await application.evaluate(() => { globalThis.__momentumTest.openPaths = [] })
    await button('保存全部').click()
    record = await scene('export-cancel')
    assert.deepEqual(record.state, stateBeforeCancel, '取消目录选择必须恢复按钮并保留共享输入输出')
    assert.deepEqual(await application.evaluate(() => globalThis.__momentumTest.writes.filter(file => file.endsWith('.png'))), writesBefore, '取消目录选择不得保存 PNG')
    const exportDir = path.join(root, 'exported')
    await mkdir(exportDir)
    await application.evaluate((_, directory) => { globalThis.__momentumTest.openPaths = [directory] }, exportDir + path.sep)
    await button('保存全部').click()
    await page.getByText('已成功保存 1 张图片到指定目录。', { exact: true }).waitFor()
    const exported = (await readdir(exportDir)).filter(file => file.endsWith('.png'))
    assert.equal(exported.length, 1)
    await verifyFile('manual-export', path.join(exportDir, exported[0]), edited, false)
    await scene('export-success')

    // 7、抠图高清保持同一共享输入输出；本地任务不向原生图任务表新增记录。
    let previousImages = (await publicState(page)).images
    for (const [mode, channel, label, successMessage, file, bytes] of [
      ['remove', 'hd:run-removebg', '开始抠图', '抠图处理完成，得到 1 张图片', removePath, removed],
      ['highres', 'hd:run-highres', '开始高清', '高清处理完成，得到 1 张图片', highresPath, highres]
    ]) {
      stage = `${mode}-settings`
      await panel.getByText(mode === 'remove' ? '抠图设置' : '高清设置', { exact: true }).click()
      assert.deepEqual((await publicState(page)).images, previousImages, '切换设置必须保留共享输入输出')
      if (mode === 'remove') await panel.getByText('开启', { exact: true }).click()
      else {
        const scale = panel.locator('.n-input-number input')
        await scale.fill('3')
        await scale.press('Tab')
      }
      await plan(application, channel, { success: false, message: `受控${mode}失败` })
      await button(label).click()
      await page.getByText(`受控${mode}失败`, { exact: true }).waitFor()
      record = await scene(`${mode}-failure`)
      assert.deepEqual(record.state.images, normalize(previousImages, root))
      await plan(application, channel, { success: true, data: { outputDir, files: [file] } }, { hold: true })
      await button(label).click()
      await checkBusy(channel, label, 2, 'completed')
      const actual = (await calls(application)).filter(item => item.channel === channel).at(-1).params
      const expected = mode === 'remove'
        ? { inputPaths: [chainPath], modelId: 'u2net', alphaMatting: true, outputDir }
        : { inputPaths: [removePath], modelId: 'real-esrgan', outputDir, outscale: 3, mode: 'auto' }
      assert.deepEqual(actual, expected)
      await release(application, channel)
      await page.getByText(successMessage, { exact: true }).waitFor()
      await eventually(() => button(label).isDisabled(), disabled => !disabled, '本地处理须解除忙碌')
      await verifyFile(`${mode}-chain`, file, bytes)
      record = await scene(`${mode}-success`)
      assert.deepEqual(record.state.images[0].items, record.state.images[1].items)
      assert.equal(record.state.images[0].items[0].name, path.basename(file))
      previousImages = (await publicState(page)).images
    }
    evidence.gaps.push('GeneratePage 处理中没有取消或停止按钮；只验证目录选择取消，不虚构处理取消 API。')
    await panel.getByText('生图设置', { exact: true }).click()
    record = await scene('shared-final')
    assert.deepEqual(record.state.images, normalize(previousImages, root))
    assert.equal(record.tasks.tasks.length, 8)
    assert.deepEqual(record.tasks.tasks.map(task => [task.type, task.status]), [['generate', 'failed'], ['generate', 'failed'], ['generate', 'failed'], ['generate', 'completed'], ['edit', 'completed'], ['edit', 'failed'], ['edit', 'failed'], ['edit', 'completed']])
    assert.deepEqual(record.tasks.activeTasks, [])
    assert.deepEqual(desktop.errors, [])
    evidence.safety = await application.evaluate(() => ({ violations: globalThis.__momentumTest.violations, external: globalThis.__momentumTest.external, pending: Object.keys(globalThis.__generateWorkflow.pending), queued: Object.values(globalThis.__generateWorkflow.plans).reduce((total, plans) => total + plans.length, 0) }))
    assert.deepEqual(evidence.safety, { violations: [], external: [], pending: [], queued: 0 })
    if (before) {
      assert.deepEqual(evidence.scenes, before.scenes)
      assert.deepEqual(evidence.busy, before.busy)
      assert.deepEqual(evidence.files, before.files)
      assert.deepEqual(evidence.gaps, before.gaps)
      evidence.beforeResult = path.join(beforeRoot, 'generate-workflow-result.json')
      evidence.differentPixels = 0
    }
    evidence.passed = true
  } catch (error) {
    evidence.failure = { stage, message: error.message, stack: error.stack }
    if (desktop) {
      await desktop.page.screenshot({ path: path.join(root, 'generate-workflow-failure.png') }).catch(() => {})
      evidence.failure.publicState = await publicState(desktop.page).then(value => normalize(value, root)).catch(() => null)
      evidence.failure.calls = await calls(desktop.application).then(value => normalize(value, root)).catch(() => null)
    }
    throw error
  } finally {
    // 8、失败也关闭后台桌面并保存已有证据；保留隔离目录供主助手核验，不删除失败截图。
    try {
      if (desktop) await desktop.close()
    } catch (error) {
      evidence.passed = false
      evidence.cleanupFailure = error.message
      throw error
    } finally {
      await writeFile(path.join(root, 'generate-workflow-result.json'), JSON.stringify(evidence, null, 2), { flag: 'wx' })
    }
  }
})
