/** 仅将构建后的 renderer 静态目录映射到固定应用源；不提供文件或网络代理。 */
import path from 'node:path'
import { realpath, stat, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
// 运行时加载独立CJS产物，与同步bootstrap共享Node模块缓存，禁止打包成第二份状态。
const applicationScheme = createRequire(import.meta.url)('./application-scheme.cjs')

export const { APPLICATION_SCHEME, registerApplicationScheme, ensureApplicationScheme } = applicationScheme
export const MAIN_APPLICATION_URL = 'momentum-app://bundle/index.html'
export const PREVIEW_APPLICATION_URL = 'momentum-app://bundle/canvas-preview.html'

// 用户 API 支持 HTTP/HTTPS、自定义端口和路径前缀；允许连接不豁免 Chromium 的 CORS 校验。
export const APPLICATION_CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' http: https:; frame-src 'self' https:; media-src 'self' data: blob: https: http://localhost:*; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';"

const MIME_TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wasm': 'application/wasm', '.mp4': 'video/mp4', '.webm': 'video/webm',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg'
})

function isInside(root, candidate) {
  const relative = path.relative(root, candidate)
  return relative !== '' && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)
}

/** 先检查原始路径，再解析 URL，避免 URL 对点段的自动归一化掩盖越界输入。 */
function staticRelativePath(value) {
  if (typeof value !== 'string' || !value.startsWith(`${APPLICATION_SCHEME}://bundle/`)) return null
  if (/[\u0000-\u0020\u007f\\?#]/.test(value)) return null
  const raw = value.slice(`${APPLICATION_SCHEME}://bundle/`.length)
  if (!raw || /%2f|%5c/i.test(raw)) return null
  let decoded
  try { decoded = decodeURIComponent(raw) } catch { return null }
  // 禁止二次编码、盘符、分隔符混淆以及空段；不允许从 renderer 指定绝对路径。
  if (/[\u0000-\u001f\u007f\\:%?#]/.test(decoded) || path.posix.isAbsolute(decoded) || path.win32.isAbsolute(decoded)) return null
  if (decoded.split('/').some(segment => !segment || segment === '.' || segment === '..')) return null
  try {
    const url = new URL(value)
    if (url.protocol !== `${APPLICATION_SCHEME}:` || url.host !== 'bundle' || url.username || url.password || url.search || url.hash) return null
  } catch { return null }
  const normalized = path.posix.normalize(decoded)
  if (normalized !== decoded) return null
  if (path.posix.extname(normalized) === '.html' && !['index.html', 'canvas-preview.html'].includes(normalized)) return null
  return MIME_TYPES[path.posix.extname(normalized)] ? normalized : null
}

/** root 只来自主进程的构建目录；canonical 检查拒绝指向该目录外的符号链接。 */
export async function resolveApplicationResource(rendererRoot, url) {
  const relative = staticRelativePath(url)
  if (relative === null) return null
  try {
    const root = await realpath(rendererRoot)
    const lexical = path.resolve(root, relative)
    if (!isInside(root, lexical)) return null
    const canonical = await realpath(lexical)
    if (!isInside(root, canonical) || !(await stat(canonical)).isFile()) return null
    return { filePath: canonical, contentType: MIME_TYPES[path.posix.extname(relative)] }
  } catch { return null }
}

/** Node fs 使用 Electron 的 ASAR 支持；不会将请求转发给 file: 或远程 URL。 */
export function createApplicationProtocolHandler(rendererRoot) {
  const root = path.resolve(rendererRoot)
  return async request => {
    const headers = {
      'Content-Security-Policy': APPLICATION_CSP,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store'
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new globalThis.Response(null, { status: 405, headers: { ...headers, Allow: 'GET, HEAD' } })
    }
    // Electron 自定义协议重载会保留 hash 路由；仅固定 HTML 入口的 #/ 路由不参与资源寻址。
    // 不归一化路径，不剥离 query，也不给其他静态资源或任意 hash 增加回退。
    const entryRoute = typeof request.url === 'string' &&
      [MAIN_APPLICATION_URL, PREVIEW_APPLICATION_URL].find(entry => request.url.startsWith(`${entry}#/`))
    const resource = await resolveApplicationResource(root, entryRoute || request.url)
    if (!resource) return new globalThis.Response(null, { status: 404, headers })
    try {
      // 同一个可信构建根也用于 HEAD；不存在任意路径兜底或 index 回退。
      const body = request.method === 'HEAD' ? null : await readFile(resource.filePath)
      return new globalThis.Response(body, { status: 200, headers: { ...headers, 'Content-Type': resource.contentType } })
    } catch {
      return new globalThis.Response(null, { status: 404, headers })
    }
  }
}

/** ready 后、创建任何特权窗口之前注册默认会话；out/main 与 out/renderer 在 ASAR 内保持同级。 */
export function installApplicationProtocol({ app, protocol, mainDirectory }) {
  if (!app.isReady()) throw new Error('应用协议 handler 必须在 app ready 后注册')
  protocol.handle(APPLICATION_SCHEME, createApplicationProtocolHandler(path.join(mainDirectory, '../renderer')))
}
