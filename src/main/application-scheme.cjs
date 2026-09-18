/** 同步协议声明：生产ESM入口和受保护CJS启动器共用同一模块实例。 */
const APPLICATION_SCHEME = 'momentum-app'
const registeredProtocols = new WeakSet()

function registerApplicationScheme({ app, protocol }) {
  if (app.isReady()) throw new Error('应用协议必须在 app ready 前声明')
  if (registeredProtocols.has(protocol)) return
  protocol.registerSchemesAsPrivileged([{
    scheme: APPLICATION_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true }
  }])
  registeredProtocols.add(protocol)
}

/** 已在同步入口完成真实声明才可跨ready复用；未声明仍执行严格时序检查。 */
function ensureApplicationScheme({ app, protocol }) {
  if (!registeredProtocols.has(protocol)) registerApplicationScheme({ app, protocol })
}

module.exports = { APPLICATION_SCHEME, registerApplicationScheme, ensureApplicationScheme }
