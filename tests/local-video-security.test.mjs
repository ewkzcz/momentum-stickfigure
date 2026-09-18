import test from 'node:test'
import assert from 'node:assert/strict'
import { launchDesktop } from './helpers/desktop.mjs'

test('本地视频媒体兼容：主窗和预览可解码本地生成的WebM字节', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const opening = desktop.application.waitForEvent('window')
    const [created, preview] = await Promise.all([desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create')), opening])
    assert.equal(created.success, true)
    await preview.getByRole('button', { name: '关闭', exact: true }).waitFor()
    for (const page of [desktop.page, preview]) {
      const result = await page.evaluate(async () => {
        const canvas = document.createElement('canvas')
        canvas.width = 32; canvas.height = 24
        const context = canvas.getContext('2d')
        context.fillStyle = '#ff0000'; context.fillRect(0, 0, 32, 24)
        const stream = canvas.captureStream(0)
        const track = stream.getVideoTracks()[0]
        const recorder = new window.MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' })
        const chunks = []
        const recorded = new Promise((resolve, reject) => {
          recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data) }
          recorder.onerror = event => reject(new Error(event.error?.message || '录制失败'))
          recorder.onstop = resolve
        })
        let frames = 0
        const firstData = new Promise(resolve => {
          recorder.addEventListener('dataavailable', event => { if (event.data.size) resolve() }, { once: true })
        })
        // 持续产生不同画面，等编码器交付数据后停止；四次绘制并不保证编码已完成。
        recorder.start(100)
        let drawing = true
        const draw = () => {
          if (!drawing) return
          context.fillStyle = frames++ % 2 ? '#00ff00' : '#0000ff'
          context.fillRect(0, 0, 32, 24)
          track.requestFrame()
          requestAnimationFrame(draw)
        }
        requestAnimationFrame(draw)
        await firstData
        drawing = false
        recorder.stop()
        await recorded
        stream.getTracks().forEach(track => track.stop())
        const blob = new Blob(chunks, { type: 'video/webm' })
        const url = URL.createObjectURL(blob)
        const video = document.createElement('video')
        video.muted = true; video.preload = 'auto'
        try {
          const loaded = new Promise((resolve, reject) => {
            video.onloadeddata = resolve
            video.onerror = () => reject(new Error(`本地视频加载失败 code=${video.error?.code} message=${video.error?.message} bytes=${blob.size}`))
          })
          video.src = url
          video.load()
          await loaded
          return { bytes: blob.size, width: video.videoWidth, height: video.videoHeight, readyState: video.readyState }
        } finally { video.removeAttribute('src'); video.load(); URL.revokeObjectURL(url) }
      })
      assert.ok(result.bytes > 0)
      assert.deepEqual([result.width, result.height], [32, 24])
      assert.ok(result.readyState >= 2)
    }
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
