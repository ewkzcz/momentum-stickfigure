/** 内嵌网页会话：按初始来源隔离，危险系统权限默认拒绝。 */
import { createHash } from 'node:crypto'

export function webOrigin(url) {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('网页地址必须是无凭据的HTTP或HTTPS地址')
  return parsed.origin
}

export function sitePartition(label, url) {
  const origin = webOrigin(url)
  const prefix = label.startsWith('persist:') ? 'persist:' : ''
  const digest = createHash('sha256').update(JSON.stringify([label, origin])).digest('hex')
  return `${prefix}momentum-site-${digest}`
}

export function protectWebNavigation(contents) {
  const guard = (event, destination) => {
    try { webOrigin(typeof destination === 'string' ? destination : destination?.url) }
    catch { event.preventDefault() }
  }
  contents.on('will-navigate', guard)
  contents.on('will-redirect', guard)
  contents.on('will-frame-navigate', guard)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
  contents.once('destroyed', () => {
    contents.removeListener('will-navigate', guard)
    contents.removeListener('will-redirect', guard)
    contents.removeListener('will-frame-navigate', guard)
  })
}

const installed = new WeakSet()
export function installWebPermissions(session, initialOrigin) {
  if (installed.has(session)) return
  installed.add(session)
  const permitted = (contents, permission, requestingOrigin) => {
    try {
      return permission === 'fullscreen' && contents && !contents.isDestroyed() &&
        webOrigin(contents.getURL()) === initialOrigin && webOrigin(requestingOrigin) === initialOrigin
    } catch { return false }
  }
  session.setPermissionCheckHandler((contents, permission, requestingOrigin) => permitted(contents, permission, requestingOrigin))
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permitted(contents, permission, details?.requestingUrl || details?.securityOrigin))
  })
}
