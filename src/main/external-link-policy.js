/** 所有系统浏览器入口共享协议规则，不允许网页触发本地或自定义协议。 */
import { shell } from 'electron'

export function normalizeExternalUrl(value) {
  if (typeof value !== 'string' || !value) throw new Error('URL无效')
  let url
  try { url = new URL(value) } catch { throw new Error('URL格式不正确') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('只支持HTTP和HTTPS协议')
  return url.href
}

export async function openExternalUrl(value) {
  await shell.openExternal(normalizeExternalUrl(value))
}
