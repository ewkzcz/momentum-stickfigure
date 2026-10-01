/** 用页面首个同步脚本观察真实生产preload，不能用页面加载后的桥接状态替代。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { APPLICATION_SCHEME, APPLICATION_CSP, PREVIEW_APPLICATION_URL } from '../src/main/application-protocol.js'
import { launchDesktop } from './helpers/desktop.mjs'

test('预加载顺序：首个页面脚本执行时完整桥接已经存在', { timeout: 60000 }, async () => {
  const desktop = await launchDesktop()
  try {
    const scriptURL = new URL('preload-probe.js', PREVIEW_APPLICATION_URL).href
    // 主窗已完成真实生产加载；创建预览前仅在本测试进程替换两个固定资源的响应。
    // Playwright context.route 未能拦截该自定义协议，故在 Electron 协议层提供探针。
    // 保留生产入口、来源登记、窗口参数、CSP 和真实预加载产物，不写入 out。
    // 这仅验证首脚本桥接顺序，不能作为生产资源 handler 的通过证据。
    // 不向 file: 或网络回退；其余资源一律 404，finally 关闭桌面进程结束替代。
    await desktop.application.evaluate(({ protocol }, { scheme, previewURL, scriptURL, csp }) => {
      const requests = globalThis.__preloadProbeRequests = []
      const headers = {
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
      }
      const resources = new Map([
        [previewURL, { contentType: 'text/html; charset=utf-8',
          body: '<!doctype html><html><body><script src="preload-probe.js"></script></body></html>' }],
        [scriptURL, { contentType: 'text/javascript; charset=utf-8',
          body: `globalThis.firstScriptBridge = {
            invoke: typeof window.electronAPI?.invoke, on: typeof window.electronAPI?.on,
            selectFile: typeof window.fileSystem?.selectFile, platform: typeof window.env?.platform
          };
          globalThis.firstScriptContext = {
            href: location.href, scriptURL: document.currentScript.src,
            scriptCount: document.scripts.length, readyState: document.readyState
          }` }]
      ])
      protocol.unhandle(scheme)
      protocol.handle(scheme, request => {
        if (request.method !== 'GET') {
          return new globalThis.Response(null, { status: 405, headers: { ...headers, Allow: 'GET' } })
        }
        const resource = resources.get(request.url)
        if (!resource) return new globalThis.Response(null, { status: 404, headers })
        requests.push(request.url)
        return new globalThis.Response(resource.body, {
          status: 200, headers: { ...headers, 'Content-Type': resource.contentType }
        })
      })
    }, { scheme: APPLICATION_SCHEME, previewURL: PREVIEW_APPLICATION_URL, scriptURL, csp: APPLICATION_CSP })
    const opening = desktop.application.waitForEvent('window')
    const result = await desktop.page.evaluate(() => window.electronAPI.invoke('canvas-preview-create'))
    assert.equal(result.success, true)
    const preview = await opening
    await preview.waitForLoadState('load')
    assert.equal(preview.url(), PREVIEW_APPLICATION_URL)
    const requests = await desktop.application.evaluate(() => globalThis.__preloadProbeRequests)
    assert.deepEqual(requests, [PREVIEW_APPLICATION_URL, scriptURL], '必须实际交付同源页面与首个外部脚本')
    assert.deepEqual(await preview.evaluate(() => globalThis.firstScriptContext), {
      href: PREVIEW_APPLICATION_URL, scriptURL, scriptCount: 1, readyState: 'loading'
    }, '桥接快照必须在页面解析期间的首个同步外部脚本内采集')
    assert.deepEqual(await preview.evaluate(() => globalThis.firstScriptBridge), {
      invoke: 'function', on: 'function', selectFile: 'function', platform: 'string'
    })
    assert.deepEqual(desktop.errors, [])
  } finally { await desktop.close() }
})
