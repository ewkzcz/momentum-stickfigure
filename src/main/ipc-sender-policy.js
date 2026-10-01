/** 由主进程创建窗口时授予身份；仅固定入口的顶层frame可使用对应能力。 */
const trustedWindows = new WeakMap()

export function registerTrustedWindow(contents, entryUrl, role) {
  const entry = new URL(entryUrl)
  trustedWindows.set(contents, { entry, role })
  contents.once('destroyed', () => trustedWindows.delete(contents))
}

export function isTrustedIpcSender(event, roles = ['main']) {
  try {
    const sender = event?.sender, frame = event?.senderFrame
    if (!sender || sender.isDestroyed() || !frame || frame !== sender.mainFrame) return false
    const trusted = trustedWindows.get(sender)
    if (!trusted || !roles.includes(trusted.role)) return false
    const actual = new URL(frame.url), entry = trusted.entry
    return actual.protocol === entry.protocol && actual.host === entry.host && actual.pathname === entry.pathname &&
      actual.username === entry.username && actual.password === entry.password
  } catch { return false }
}
