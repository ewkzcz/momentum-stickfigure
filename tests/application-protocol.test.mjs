import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, realpath, symlink, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL, APPLICATION_CSP,
  resolveApplicationResource, createApplicationProtocolHandler,
  registerApplicationScheme, ensureApplicationScheme, installApplicationProtocol
} from '../src/main/application-protocol.js'

test('应用协议映射：固定静态根、规范路径、响应与注册顺序', async context => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), 'momentum-application-protocol-'))
  const root = path.join(temporary, 'renderer')
  await mkdir(path.join(root, 'assets'), { recursive: true })
  const files = {
    'index.html': '<div id="app">main fixture</div>',
    'canvas-preview.html': '<div id="app">preview fixture</div>',
    'assets/app.js': 'export const fixture = true',
    'assets/app.css': 'body { color: black }',
    'assets/中文 font.woff2': 'font fixture',
    'other.html': 'not an entry'
  }
  try {
    for (const [name, contents] of Object.entries(files)) await writeFile(path.join(root, name), contents)
    const handler = createApplicationProtocolHandler(root)
    await context.test('两个固定入口与实际静态文件可映射，缺失文件不回退入口', async () => {
      for (const [name, contents] of Object.entries(files).filter(([name]) => name !== 'other.html')) {
        const url = `momentum-app://bundle/${name.split('/').map(encodeURIComponent).join('/')}`
        const resource = await resolveApplicationResource(root, url)
        assert.equal(resource.filePath, await realpath(path.join(root, name)))
        const response = await handler({ url, method: 'GET' })
        assert.equal(response.status, 200)
        assert.equal(await response.text(), contents)
      }
      for (const name of ['missing.js', 'assets', 'other.html', 'unknown']) {
        assert.equal((await handler({ url: `momentum-app://bundle/${name}`, method: 'GET' })).status, 404)
      }
    })
    await context.test('拒绝错误源、点段、绝对路径、编码混淆、query 与 hash', async () => {
      const invalid = [
        'file:///index.html', 'https://bundle/index.html', 'momentum-app://evil/index.html',
        'momentum-app://bundle.evil/index.html', 'momentum-app://user@bundle/index.html',
        'momentum-app://bundle:123/index.html', 'momentum-app://bundle/',
        'momentum-app://bundle/../index.html', 'momentum-app://bundle/assets/../../index.html',
        'momentum-app://bundle/%2e%2e/index.html', 'momentum-app://bundle/assets/%2E%2E/index.html',
        'momentum-app://bundle/%252e%252e/index.html', 'momentum-app://bundle/./index.html',
        'momentum-app://bundle//index.html', 'momentum-app://bundle/%2Findex.html',
        'momentum-app://bundle/C:/index.html', 'momentum-app://bundle/C%3a/index.html',
        'momentum-app://bundle/assets%2fapp.js', 'momentum-app://bundle/assets%5capp.js',
        'momentum-app://bundle/assets\\app.js', 'momentum-app://bundle/index.html?path=/etc/passwd',
        'momentum-app://bundle/index.html#other', 'momentum-app://bundle/index.html?',
        'momentum-app://bundle/index.html#', 'momentum-app://bundle/index.html%00',
        'momentum-app://bundle/index.html\0', 'momentum-app://bundle/%zz.js',
        'momentum-app://bundle/assets/%23app.js', 'momentum-app://bundle/assets/%3fapp.js',
        'momentum-app://bundle/assets/../index.html'
      ]
      for (const url of invalid) {
        assert.equal(await resolveApplicationResource(root, url), null, url)
        assert.equal((await handler({ url, method: 'GET' })).status, 404, url)
      }
    })
    await context.test('canonical 边界拒绝目录符号链接越界并允许根内资源', async () => {
      const outside = path.join(temporary, 'renderer-outside')
      await mkdir(outside)
      await writeFile(path.join(outside, 'secret.js'), 'outside private fixture')
      // Windows 使用不要求开发者模式的目录 junction；所有目标均位于本测试临时目录。
      await symlink(outside, path.join(root, 'escaped'), process.platform === 'win32' ? 'junction' : 'dir')
      await symlink(path.join(root, 'assets'), path.join(root, 'internal'), process.platform === 'win32' ? 'junction' : 'dir')
      assert.equal(await resolveApplicationResource(root, 'momentum-app://bundle/escaped/secret.js'), null)
      assert.equal((await handler({ url: 'momentum-app://bundle/escaped/secret.js', method: 'GET' })).status, 404)
      assert.equal((await handler({ url: 'momentum-app://bundle/internal/app.js', method: 'GET' })).status, 200)
    })
    await context.test('响应包含明确 CSP、正确 MIME，HEAD 无正文且其他方法返回 405', async () => {
      for (const [url, type] of [[MAIN_APPLICATION_URL, 'text/html; charset=utf-8'],
        [PREVIEW_APPLICATION_URL, 'text/html; charset=utf-8'],
        ['momentum-app://bundle/assets/app.js', 'text/javascript; charset=utf-8'],
        ['momentum-app://bundle/assets/app.css', 'text/css; charset=utf-8']]) {
        const get = await handler({ url, method: 'GET' })
        const head = await handler({ url, method: 'HEAD' })
        assert.equal(get.headers.get('Content-Type'), type)
        assert.equal(get.headers.get('Content-Security-Policy'), APPLICATION_CSP)
        assert.equal(get.headers.get('X-Content-Type-Options'), 'nosniff')
        assert.equal(head.status, 200)
        assert.deepEqual([...head.headers], [...get.headers])
        assert.equal(await head.text(), '')
      }
      for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) {
        const response = await handler({ url: MAIN_APPLICATION_URL, method })
        assert.equal(response.status, 405)
        assert.equal(response.headers.get('Allow'), 'GET, HEAD')
        assert.equal(response.headers.get('Content-Security-Policy'), APPLICATION_CSP)
      }
      assert.equal((await handler({ url: 'momentum-app://bundle/missing.js', method: 'HEAD' })).status, 404)
      const directives = new Map(APPLICATION_CSP.split(';').map(value => value.trim()).filter(Boolean).map(value => {
        const [name, ...sources] = value.split(/\s+/)
        return [name, sources]
      }))
      assert.deepEqual(directives.get('connect-src'), ["'self'", 'http:', 'https:'], '自定义 API 的协议、端口与路径不得被 localhost 白名单替代')
      assert.deepEqual(directives.get('script-src'), ["'self'"], '允许 HTTP API 不得同时放宽 inline/eval 脚本')
      for (const directive of ["default-src 'self'", "script-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"]) assert.ok(APPLICATION_CSP.includes(directive))
    })
    await context.test('scheme 仅 ready 前声明、handler 仅 ready 后注册到构建根', async () => {
      const registrations = []
      let ready = false
      const app = { isReady: () => ready }
      const protocol = {
        registerSchemesAsPrivileged: schemes => registrations.push(schemes),
        handle: (scheme, handler) => registrations.push({ scheme, handler })
      }
      registerApplicationScheme({ app, protocol })
      assert.deepEqual(registrations[0], [{ scheme: 'momentum-app', privileges: {
        standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true
      } }])
      assert.throws(() => installApplicationProtocol({ app, protocol, mainDirectory: path.join(temporary, 'main') }), /ready/)
      ready = true
      assert.throws(() => registerApplicationScheme({ app, protocol }), /ready/)
      ensureApplicationScheme({ app, protocol })
      assert.equal(registrations.length, 1, 'ready后仅可复用该protocol已成功声明的状态')
      assert.throws(() => ensureApplicationScheme({ app, protocol: { ...protocol } }), /ready/, '未声明的新protocol不能绕过ready检查')
      installApplicationProtocol({ app, protocol, mainDirectory: path.join(temporary, 'main') })
      assert.equal(registrations[1].scheme, 'momentum-app')
      assert.equal((await registrations[1].handler({ url: MAIN_APPLICATION_URL, method: 'GET' })).status, 200)
    })
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
})
