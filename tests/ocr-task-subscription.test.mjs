/** 字幕提取订阅回归：通过受控主进程结果验证真实页面与进度IPC，不运行Python或AI。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { launchDesktop } from './helpers/desktop.mjs'

/** 投递并确认进度；处理流程：1、准备独立屏障；2、按序发送真实IPC；3、等待屏障到达。 */
async function deliver(desktop, payload) {
  // 1、屏障只用于确认消息已被处理，不替代生产进度监听。
  await desktop.page.evaluate(() => {
    window.__ocrBarrier = new Promise(resolve => {
      const stop = window.electronAPI.on('regression:ocr-barrier', () => { stop(); resolve() })
    })
  })
  // 2、同一主窗口先收进度，再收屏障。
  await desktop.application.evaluate(({ BrowserWindow }, payload) => {
    const main = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().split('#')[0].endsWith('/index.html'))
    main.webContents.send('video-ocr:progress', payload)
    main.webContents.send('regression:ocr-barrier', null)
  }, payload)
  // 3、以实际投递完成为准，不依赖固定延迟。
  await desktop.page.evaluate(() => window.__ocrBarrier)
}

for (const mode of ['reject', 'failure', 'success']) {
  test(`字幕提取${mode}：结束后解除自己的进度订阅，保留其他订阅`, { timeout: 120000 }, async () => {
    const desktop = await launchDesktop(undefined, 'software-layout')
    const evidence = { mode, cycles: [], passed: false, limits: ['主进程环境检测与提取为受控替身，不运行Python或AI', '验证任务结算后的进度清理，不代表在途卸载、安装清理或进程取消'] }
    console.log(`字幕订阅${mode}目录：${desktop.root}`)
    try {
      // 1、在进入页面之前阻断所有Python边界；生产preload与页面逻辑保持原样。
      await desktop.application.evaluate(({ ipcMain }, mode) => {
        globalThis.__ocrProbe = { calls: [], release: null }
        for (const channel of ['video-ocr:check-environment', 'video-ocr:process-video', 'video-ocr:install-environment', 'video-ocr:clean-environment']) ipcMain.removeHandler(channel)
        ipcMain.handle('video-ocr:check-environment', () => ({ success: true, data: { installed: true } }))
        for (const channel of ['video-ocr:install-environment', 'video-ocr:clean-environment']) ipcMain.handle(channel, () => { throw new Error('测试禁止安装或清理环境') })
        ipcMain.handle('video-ocr:process-video', async (_event, payload) => {
          globalThis.__ocrProbe.calls.push(payload)
          await new Promise(resolve => { globalThis.__ocrProbe.release = resolve })
          globalThis.__ocrProbe.release = null
          if (mode === 'reject') throw new Error('受控提取异常')
          return mode === 'failure' ? { success: false, message: '受控失败响应' }
            : { success: true, data: { preview: '隔离字幕结果', lineCount: 1, outputPath: '' } }
        })
      }, mode)
      await desktop.page.evaluate(root => {
        localStorage.setItem('hd-toolkit-config', JSON.stringify({ pythonHome: `${root}/fake-python` }))
        localStorage.setItem('video-ocr-api-key', 'FAKE_OCR_REGRESSION_KEY')
        localStorage.setItem('video-ocr-api-base-url', 'https://ocr-regression.invalid/v1')
        location.hash = '/video-subtitle-ocr'
      }, desktop.root)
      await desktop.page.getByText('✓ 环境已安装', { exact: true }).waitFor()
      await desktop.page.locator('.loading-overlay').waitFor({ state: 'hidden' })
      const video = path.join(desktop.root, '隔离视频.mp4')
      await writeFile(video, 'not a real video: the controlled service must not read it')
      await desktop.application.evaluate((_, file) => { globalThis.__momentumTest.openPaths = [file] }, video)
      await desktop.page.getByText('点击选择视频文件', { exact: true }).click()
      await desktop.page.getByText('隔离视频.mp4', { exact: true }).waitFor()
      await desktop.page.evaluate(() => {
        window.__ocrIndependent = []
        window.__ocrIndependentStop = window.videoOcr.onProgress(data => window.__ocrIndependent.push(data))
      })
      // 2、反复提交并在结算前后发送真实进度，公开DOM必须只响应在途任务。
      for (let cycle = 0; cycle < 20; cycle++) {
        const button = desktop.page.getByRole('button', { name: '开始提取字幕', exact: true })
        await button.click()
        const running = { percentage: 37, message: `任务中-${cycle}` }
        await deliver(desktop, running)
        await desktop.page.waitForFunction(text => document.querySelector('.progress-message')?.textContent === text, running.message)
        await desktop.application.evaluate(() => {
          if (!globalThis.__ocrProbe.release) throw new Error('任务尚未进入受控等待')
          globalThis.__ocrProbe.release()
        })
        await button.waitFor()
        const expected = mode === 'success' ? '处理完成' : mode === 'failure' ? '受控失败响应' : '处理失败'
        await desktop.page.waitForFunction(text => document.querySelector('.progress-message')?.textContent === text, expected)
        const late = { percentage: 91, message: `结算后的无关进度-${cycle}` }
        await deliver(desktop, late)
        // 屏障只保证IPC顺序，再等Vue下一次公开DOM更新任务。
        await desktop.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const actual = await desktop.page.locator('.progress-message').textContent()
        const independent = await desktop.page.evaluate(() => window.__ocrIndependent)
        assert.equal(independent.length, (cycle + 1) * 2, '组件不得清除其他消费者的进度订阅')
        assert.deepEqual(independent.slice(-2), [running, late])
        evidence.cycles.push({ cycle, expected, actual, independentCount: independent.length })
        assert.equal(actual, expected, '任务结算后的旧监听不得再修改页面进度')
        if (mode === 'success') await desktop.page.locator('.progress-container').waitFor({ state: 'hidden' })
      }
      // 3、检查受控任务参数及页面异常，取消测试自身的独立订阅。
      const calls = await desktop.application.evaluate(() => globalThis.__ocrProbe.calls)
      assert.equal(calls.length, 20)
      assert.ok(calls.every(call => call.videoPath === video && call.apiKey === 'FAKE_OCR_REGRESSION_KEY' && call.useAI === true))
      await desktop.page.evaluate(() => window.__ocrIndependentStop())
      assert.deepEqual(desktop.errors, [])
      evidence.passed = true
    } catch (error) { evidence.failure = error.message; throw error }
    finally {
      // 4、退出和隔离失败同样使本项失败，不以业务断言通过代替清理。
      try { await desktop.close() } catch (error) { evidence.passed = false; evidence.cleanupFailure = error.message; throw error }
      finally { await writeFile(path.join(desktop.root, 'ocr-subscription-result.json'), JSON.stringify(evidence, null, 2)) }
    }
  })
}
