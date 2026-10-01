import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { launchDesktop } from './helpers/desktop.mjs'

const shotDir = process.env.CREATIVE_SHOT_DIR

/** 截图（仅在提供目录时）；1、便于人工检查布局。 */
async function shot(page, name) {
  if (shotDir) await page.screenshot({ path: path.join(shotDir, `${name}.png`) })
}

/** 当前可见页面内的标签；1、keep-alive 页面会同时存在多个同名标签。 */
function visibleTab(page, name) {
  return page.locator('.n-tabs-tab:visible', { hasText: name }).first()
}

test('创作工作台：内置 Skills 安装与启用、获取指引、剧本项目保存、图片/视频 Agent 增强与分镜交接', { timeout: 120000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const page = desktop.page
    await page.setViewportSize({ width: 1400, height: 900 })

    // 1、设置 → Skills设置：安装内置（开源原文 + LICENSE），默认不启用，手动启用一个。
    await page.evaluate(() => { location.hash = '/settings/creative' })
    await page.getByRole('button', { name: '安装内置 Skills' }).click()
    await page.locator('.skill-item').filter({ hasText: 'short-drama' }).waitFor()
    const skillsDir = path.join(desktop.root, 'home/Documents/MomentumCreative/skills')
    assert.ok(fs.existsSync(path.join(skillsDir, 'short-drama/references/villain-design.md')))
    assert.ok(fs.existsSync(path.join(skillsDir, 'seedance-prompt/LICENSE')))
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('creative-config')).enabledSkills), [])
    await page.locator('.skill-item').filter({ hasText: 'short-drama' }).locator('.n-switch').click()
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('creative-config')).enabledSkills), ['short-drama'])
    await shot(page, 'skills-installed')
    await visibleTab(page, '获取更多 Skills').click()
    await page.locator('.skill-guide .n-tabs-tab', { hasText: '视频' }).click()
    await page.getByText('github.com/songguoxs/seedance-prompt-skill', { exact: false }).waitFor()
    await shot(page, 'skills-discover')

    // 2、剧本创作台：新建短剧项目，默认系统提示词，已启用剧本 Skill 默认勾选，修改自动保存。
    await page.evaluate(() => { location.hash = '/script-studio' })
    await page.getByRole('button', { name: '新建项目' }).click()
    await page.getByText('竖屏短剧', { exact: true }).last().click()
    await page.getByText('① 项目设定').waitFor()
    assert.match(await page.locator('textarea').first().inputValue(), /微短剧编剧/)
    await page.getByPlaceholder('暂定名').fill('冒烟测试剧本')
    await page.waitForFunction(() => document.querySelector('.project-title')?.textContent === '冒烟测试剧本', undefined, { timeout: 10000 })
    const scriptsDir = path.join(desktop.root, 'home/Documents/MomentumCreative/scripts')
    const file = fs.readdirSync(scriptsDir).find((name) => name.endsWith('.script.json'))
    const saved = JSON.parse(fs.readFileSync(path.join(scriptsDir, file), 'utf8'))
    assert.equal(saved.title, '冒烟测试剧本')
    assert.deepEqual(saved.skillIds, ['short-drama'])
    await shot(page, 'script-settings')

    // 3、图片 Agent 内置在 AI 生图页的子标签；示例句子可一键填入；未配置文本模型时明确提示。
    await page.evaluate(() => { location.hash = '/generate' })
    await visibleTab(page, 'Agent 增强').click()
    await page.locator('.try-prompts:visible .n-tag').first().click()
    assert.match(await page.locator('.agent-input:visible textarea').inputValue(), /火柴人电影海报/)
    await shot(page, 'image-agent')
    await page.locator('.agent-input:visible').getByRole('button', { name: '发送' }).click()
    await page.getByText(/请先在「设置 → 文本模型设置」中配置文本模型/).waitFor()

    // 4、生图历史记录：直接生成后自动保存，可收藏、置顶、重命名、批量删除（生成接口在隔离环境中拦截）。
    const { createCanvas } = await import('@momentum/media-canvas')
    const canvas = createCanvas(320, 180)
    canvas.getContext('2d').fillRect(0, 0, 320, 180)
    await desktop.application.evaluate(({ ipcMain }, dataUrl) => {
      ipcMain.removeHandler('fal-generate-image')
      ipcMain.handle('fal-generate-image', () => ({ success: true, data: [dataUrl], message: '请求成功' }))
    }, `data:image/png;base64,${canvas.toBuffer('image/png').toString('base64')}`)
    await page.evaluate(() => localStorage.setItem('gemini-image-config', JSON.stringify({ ...JSON.parse(localStorage.getItem('gemini-image-config') || '{}'), apiKey: 'local-fake-key', baseUrl: 'https://gateway.invalid' })))
    await visibleTab(page, '直接生成').click()
    for (const prompt of ['第一张测试图', '第二张测试图']) {
      await page.locator('.generate-page textarea:visible').first().fill(prompt)
      await page.locator('.generate-page button:visible', { hasText: '生成' }).last().click()
      await page.locator('.history-item:visible', { hasText: prompt }).waitFor()
    }
    const first = page.locator('.history-item:visible', { hasText: '第一张测试图' })
    await first.locator('button[title="收藏"]').click()
    await first.locator('button[title="取消收藏"]').waitFor()
    await first.locator('button[title="置顶"]').click()
    await page.waitForFunction(() => document.querySelector('.history-item .history-name')?.textContent === '第一张测试图')
    await first.locator('button[title="重命名"]').click()
    await page.locator('.history-item:visible input').fill('收藏的测试图')
    await page.locator('.history-item:visible input').press('Enter')
    await page.locator('.history-item:visible', { hasText: '收藏的测试图' }).waitFor()
    await page.locator('.history-panel:visible').getByText('只看收藏').click()
    await page.waitForFunction(() => [...document.querySelectorAll('.history-item')].filter((node) => node.offsetParent).length === 1)
    await page.locator('.history-panel:visible').getByText('只看收藏').click()
    await page.locator('.history-panel:visible').getByRole('button', { name: '全选' }).click()
    await page.locator('.history-panel:visible').getByRole('button', { name: /删除（2）/ }).click()
    await page.getByRole('button', { name: '确认' }).click()
    await page.locator('.history-panel:visible').getByText('暂无生成记录').waitFor()

    // 5、AI视频设置：保存后视频创作台使用同一份参数。
    await page.evaluate(() => { location.hash = '/settings/video' })
    await page.getByRole('button', { name: '获取模型列表' }).waitFor()
    await page.locator('.settings-form:visible .n-input-number input').fill('7')
    await page.locator('.settings-form:visible .n-input-number input').blur()
    await page.getByRole('button', { name: '保存配置' }).click()
    await page.getByText('AI视频设置已保存').waitFor()
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('video-generate-config')).duration), 7)

    // 6、视频页默认直接生成；剧本分镜交接过来时自动切到 Agent 增强并填入内容。
    await page.evaluate(() => { location.hash = '/video-studio' })
    await page.locator('.studio-page:visible').getByRole('button', { name: '生成视频' }).waitFor()
    assert.equal(await page.locator('.studio-page:visible .params-bar .n-input-number input').first().inputValue(), '7')
    await page.evaluate(() => { location.hash = '/home' })
    await page.evaluate(() => localStorage.setItem('creative-handoff', JSON.stringify({ mode: 'video', text: '分镜表：镜1 小人挥手' })))
    await page.evaluate(() => { location.hash = '/video-studio' })
    await page.waitForFunction(() => [...document.querySelectorAll('.agent-input textarea')].some((node) => node.value.includes('镜1 小人挥手')), undefined, { timeout: 10000 })
    assert.equal(await page.evaluate(() => localStorage.getItem('creative-handoff')), null)
    await shot(page, 'video-agent-handoff')
    assert.deepEqual(desktop.errors, [])
  } finally {
    await desktop.close()
  }
})
