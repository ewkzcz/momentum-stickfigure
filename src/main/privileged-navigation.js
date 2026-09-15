/** 特权窗口仅在固定应用入口内导航，来源不根据当前页面动态扩大。 */
export function protectPrivilegedNavigation(contents, entryUrl) {
  const entry = new URL(entryUrl)
  const allowed = value => {
    try {
      const target = new URL(value)
      return target.protocol === entry.protocol && target.host === entry.host &&
        target.pathname === entry.pathname && target.username === entry.username && target.password === entry.password
    } catch { return false }
  }
  const block = (event, url) => { if (!allowed(url)) event.preventDefault() }
  contents.on('will-navigate', block)
  contents.on('will-redirect', block)
  contents.once('destroyed', () => {
    contents.removeListener('will-navigate', block)
    contents.removeListener('will-redirect', block)
  })
}
