/** 配置分享只删除敏感字段；完整备份由可信调用方显式选择。 */
const secretKeys = new Set(['apikey', 'token', 'accesstoken', 'refreshtoken', 'secret', 'clientsecret', 'password', 'authorization'])

export function redactSettingsForSharing(settings) {
  const copy = (value, depth = 0) => {
    if (depth > 64) throw new Error('配置嵌套超过限制')
    if (!value || typeof value !== 'object') return value
    if (Array.isArray(value)) return value.map(item => copy(item, depth + 1))
    return Object.fromEntries(Object.entries(value)
      .filter(([key]) => !secretKeys.has(key.replace(/[-_]/g, '').toLowerCase()))
      .map(([key, item]) => [key, copy(item, depth + 1)]))
  }
  return copy(settings)
}
