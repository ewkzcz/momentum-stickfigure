/** 自定义中转地址的校验与接口路径拼接工具。 */
/**
 * 统一校验用户填写的中转地址，避免静默回退到其他服务。
 * 处理流程：
 * 1、验证非空字符串并解析地址。
 * 2、限制协议及附加信息，返回移除末尾斜杠的地址。
 */
export function normalizeApiBaseUrl(value) {
  // 1、拒绝空地址并解析完整 URL。
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('请填写中转站地址')
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('中转站地址必须是完整的 HTTP 或 HTTPS 地址')
  }
  // 2、中转地址只允许 HTTP(S)，禁止凭据、查询参数和片段。
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('中转站地址仅支持 HTTP 或 HTTPS，且不能包含账号、查询参数或片段')
  }
  return url.href.replace(/\/+$/, '')
}

/**
 * 保留网关路径前缀，并兼容已经带有 /v1 或 /v1beta 的基础地址。
 * 处理流程：
 * 1、规范基础地址并提取接口版本段。
 * 2、消除重复版本段，拼接完整接口地址。
 */
export function buildApiUrl(baseUrl, endpoint) {
  // 1、校验基础地址并移除接口路径的前导斜杠。
  const base = normalizeApiBaseUrl(baseUrl)
  let relative = endpoint.replace(/^\/+/, '')
  const version = relative.split('/')[0]
  // 2、基础地址已含相同版本时，仅追加剩余路径。
  if (/^v\d+(?:beta\d*)?$/.test(version) && new URL(base).pathname.endsWith('/' + version)) {
    relative = relative.slice(version.length + 1)
  }
  return new URL(base + '/' + relative)
}
