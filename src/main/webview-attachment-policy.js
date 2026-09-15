import { session } from 'electron'
import { isTrustedIpcSender } from './ipc-sender-policy.js'
import { assertText } from './ipc-parameter-policy.js'
import { installWebPermissions, protectWebNavigation, sitePartition, webOrigin } from './web-session-policy.js'

/** webview仅允许可信主窗附加无预加载的HTTP(S)页面。 */
export function protectWebviewAttachment(contents) {
  const attach = (event, preferences, params) => {
    try {
      if (!isTrustedIpcSender({ sender: contents, senderFrame: contents.mainFrame })) throw new Error('未授权的webview宿主')
      assertText(params.src, 32768, '网页地址')
      const origin = webOrigin(params.src)
      const label = params.partition || 'webview'
      assertText(label, 256, '网页分区')
      const partition = sitePartition(label, params.src)
      delete preferences.preload
      delete preferences.preloadURL
      delete preferences.session
      Object.assign(preferences, {
        partition, sandbox: true, contextIsolation: true, webSecurity: true,
        nodeIntegration: false, nodeIntegrationInSubFrames: false, nodeIntegrationInWorker: false,
        webviewTag: false, allowRunningInsecureContent: false, disablePopups: true
      })
      installWebPermissions(session.fromPartition(partition), origin)
    } catch (error) {
      console.warn('webview附加被拒绝:', error.message)
      event.preventDefault()
    }
  }
  const attached = (_event, guest) => protectWebNavigation(guest)
  contents.on('will-attach-webview', attach)
  contents.on('did-attach-webview', attached)
  contents.once('destroyed', () => {
    contents.removeListener('will-attach-webview', attach)
    contents.removeListener('did-attach-webview', attached)
  })
}
