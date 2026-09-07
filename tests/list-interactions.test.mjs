/** 列表交互的真实 UI 回归：原提交先运行，出现原有业务错误时保留失败并阻止迁移。 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { readFile, writeFile, access } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { launchDesktop, repository } from './helpers/desktop.mjs'
import { syntheticFixtures, syntheticReferenceDirectory } from './helpers/reference.mjs'
import { assertSamePixels, observeImages, stableCanvas, verifyFixture } from './helpers/images.mjs'
import { referenceDigest } from './scenarios/canvas-preset-hover.mjs'

/** 选择公开标签，保留真实点击的单击与双击处理。 */
async function selectTab(page, name) {
  // 1、只在当前标签不同的情况下点击，避免测试自行引入双击。
  const tab = page.locator('.part-tab').filter({ hasText: new RegExp(`^${name}$`) })
  if (!(await tab.evaluate(element => element.classList.contains('active')))) await tab.click()
}

/** 由原上传按钮读取真实 PSD 文件，返回稳定画布。 */
async function upload(desktop, fixture) {
  // 1、只提供文件对话框结果，不注入 Vue 状态或写入业务存储。
  await desktop.application.evaluate((_electron, filePath) => { globalThis.__momentumTest.openPaths = [filePath] }, fixture.absolutePath)
  await desktop.page.getByRole('button', { name: '上传', exact: true }).click()
  const tab = desktop.page.locator('.psd-tab-name').and(desktop.page.getByTitle(path.basename(fixture.absolutePath), { exact: true }))
  await tab.waitFor()
  await tab.click()
  await desktop.page.locator('.psd-tab-item.active .psd-tab-name').and(desktop.page.getByTitle(path.basename(fixture.absolutePath), { exact: true })).waitFor()
  return Buffer.from((await stableCanvas(desktop.page)).png, 'base64')
}

/** 只读真实存储输出，验证 UI 创建结果包含实际预览文件。 */
async function templateOutput(desktop, type, count) {
  // 1、等待持久化完成；存储读取仅作输出断言，不用于构造输入或修改业务状态。
  const key = `stickfigure-${type}-templates`
  await desktop.page.waitForFunction(({ key, count }) => {
    const output = JSON.parse(localStorage.getItem(key) || '{}')
    return output.templates?.length === count && output.image_file_paths?.length === count
  }, { key, count })
  const output = await desktop.page.evaluate(key => JSON.parse(localStorage.getItem(key)), key)
  const userData = await desktop.application.evaluate(({ app }) => app.getPath('userData'))
  for (const item of output.image_file_paths) {
    const filename = path.join(userData, item.file_path)
    await access(filename)
    assert.ok((await readFile(filename)).length > 0, '模板预览必须真实落盘')
  }
  return output
}

/** 获取卡片的用户可见名称与选择状态。 */
async function cards(page) {
  // 1、只读取已渲染 DOM，不依赖组件实例、setupState 或内部 ref。
  return page.locator('.template-item').evaluateAll(nodes => nodes.map(node => ({
    name: node.querySelector('.template-card-title').textContent.trim(),
    active: node.classList.contains('active'), multiSelected: node.classList.contains('multi-selected')
  })))
}

/** 使用真实鼠标拖动排序手柄，不触发操作系统原生拖出。 */
async function reorder(page) {
  // 1、拖动严格限制在模板列表内；通过公开类名和实际顺序确认事件确实生效。
  const source = page.locator('.template-card-drag-handle').first()
  const target = page.locator('.template-item').last()
  const from = await source.boundingBox()
  const to = await target.boundingBox()
  assert.ok(from && to, '排序目标必须真实可见')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2, { steps: 6 })
  await page.locator('.template-item.template-dragging').waitFor()
  await page.mouse.move(to.x + to.width - 8, to.y + to.height / 2, { steps: 12 })
  await page.mouse.move(to.x + to.width - 7, to.y + to.height / 2)
  await page.mouse.up()
  await page.locator('.template-item.template-dragging').waitFor({ state: 'detached' })
}

test('模板列表：真实创建、重命名、排序、多选与右键删除', { timeout: 120000 }, async () => {
  // 1、保护全部参考和输入文件，不新增图像基线，以本次真实输入输出及旧不可变参考进行对照。
  const before = await referenceDigest()
  const fixtures = (await syntheticFixtures()).slice(0, 2)
  const desktop = await launchDesktop()
  const { page } = desktop
  const result = { head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
    sourceStatus: execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', 'src'], { cwd: repository, encoding: 'utf8' }).trim(),
    fixtureHashes: fixtures.map(fixture => fixture.sha256), scenes: [], completed: false }
  console.log(`列表交互回归证据：${desktop.root}`)
  try {
    result.environment = await desktop.application.evaluate(() => ({ platform: process.platform, arch: process.arch, electron: process.versions.electron, chrome: process.versions.chrome }))
    await page.evaluate(() => { location.hash = '/action-expression' })
    await page.getByRole('button', { name: '上传', exact: true }).waitFor()
    await observeImages(page)
    const initial = await upload(desktop, fixtures[0])
    await assertSamePixels(initial, await readFile(path.join(syntheticReferenceDirectory, fixtures[0].id, 'initial.png')), '原版 synthetic 初始画布')
    await writeFile(path.join(desktop.root, 'initial.png'), initial, { flag: 'wx' })
    result.scenes.push('synthetic-initial-existing-reference')

    // 2、创建动作与表情模板均走工具栏，等待真实预览落盘并验证生成前后主画布不变。
    for (const [type, label] of [['action', '动作'], ['expression', '表情']]) {
      for (let count = 1; count <= 2; count++) {
        await page.getByTitle(`保存当前${label}配置为${label}模板`, { exact: true }).click()
        const output = await templateOutput(desktop, type, count)
        assert.ok(output.templates.every(template => template.config.length > 0), `${label}模板必须保留非空配置`)
        await assertSamePixels(Buffer.from((await stableCanvas(page)).png, 'base64'), initial, `${label}模板创建前后主画布`)
      }
      await selectTab(page, `${label}模板`)
      assert.equal((await cards(page)).length, 2)
      result.scenes.push(`${type}-create-and-preview-files`)
    }

    // 3、第二份真实输入应共享模板列表；预设则仍由原有跨 PSD 测试覆盖分文件语义。
    const second = await upload(desktop, fixtures[1])
    await assertSamePixels(second, await readFile(path.join(syntheticReferenceDirectory, fixtures[1].id, 'initial.png')), '第二份 synthetic 初始画布')
    await selectTab(page, '动作模板')
    const originalNames = (await cards(page)).map(card => card.name)
    assert.equal(originalNames.length, 2)
    await selectTab(page, '表情模板')
    assert.equal((await cards(page)).length, 2)
    result.scenes.push('templates-global-across-two-psds')
    await selectTab(page, '动作模板')

    // 4、双击名称走当前对话框实现，保留验证空名称的正确断言。
    await page.locator('.template-card-title').first().dblclick()
    const rename = page.locator('.n-dialog').filter({ hasText: '重命名模板' })
    await rename.locator('input').fill('')
    await rename.getByRole('button', { name: '确定', exact: true }).click()
    assert.equal(await rename.isVisible(), true, '空名称必须阻止对话框提交')
    await rename.locator('input').fill('动作列表回归')
    await rename.getByRole('button', { name: '确定', exact: true }).click()
    await rename.waitFor({ state: 'detached' })
    assert.equal((await cards(page))[0].name, '动作列表回归')
    result.scenes.push('rename-dialog-and-empty-validation')

    // 5、真实拖动手柄调整同类型顺序，再以公开 DOM 与存储输出校验一致。
    await reorder(page)
    assert.deepEqual((await cards(page)).map(card => card.name), [originalNames[1], '动作列表回归'])
    result.scenes.push('template-real-mouse-sort')

    // 6、修饰键多选及右键菜单必须不产生运行错误；原提交若失败即阻止后续迁移。
    await page.locator('.template-item').first().click({ modifiers: ['Meta'] })
    await page.locator('.template-item').last().click({ modifiers: ['Meta'] })
    assert.equal((await cards(page)).filter(card => card.multiSelected).length, 2)
    await page.locator('.template-item').first().click({ button: 'right' })
    await page.locator('.template-context-menu.detail-mode').waitFor()
    result.menu = await page.locator('.template-context-menu').innerText()
    result.scenes.push('template-multiselect-context-menu')
    result.rendererErrors = desktop.logs.filter(line => /\[renderer:error\].*VueError:/.test(line))
    assert.equal(await page.locator('.template-context-menu').getByRole('button', { name: '应用', exact: true }).isDisabled(), true)
    assert.equal(await page.locator('.template-context-menu').getByRole('button', { name: '重命名', exact: true }).isDisabled(), true)
    await page.locator('.template-context-menu').getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.n-dialog').filter({ hasText: '确认删除' }).getByRole('button', { name: '删除', exact: true }).click()
    await page.locator('.template-item').waitFor({ state: 'detached' })
    result.scenes.push('template-batch-delete-confirmed')
    assert.deepEqual(desktop.errors, [], '模板右键菜单不得产生未捕获的业务运行错误')
    assert.deepEqual(result.rendererErrors, [], '模板右键菜单不得产生被 Vue 错误处理器捕获的业务运行错误')
    result.completed = true
  } catch (error) {
    result.failure = { name: error.name, message: error.message, stack: error.stack }
    throw error
  } finally {
    // 7、即使原版失败也保留原断言、截图、日志、输入哈希与全部参考保护结果。
    result.errors = [...desktop.errors]
    await page.screenshot({ path: path.join(desktop.root, 'list-interactions-final.png') }).catch(() => {})
    await desktop.close()
    for (const fixture of fixtures) await verifyFixture(fixture.absolutePath, fixture.sha256)
    assert.deepEqual(await referenceDigest(), before, '测试前后全部参考内容必须不变')
    result.referenceFiles = Object.keys(before).length
    result.referenceDigest = createHash('sha256').update(JSON.stringify(before)).digest('hex')
    result.closedAndIsolated = true
    await writeFile(path.join(desktop.root, 'list-interactions-result.json'), JSON.stringify(result, null, 2), { flag: 'wx' })
  }
})
