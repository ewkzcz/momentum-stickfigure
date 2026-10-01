/** 后台 ESM 导入器：把业务的 Electron 命名导入连接到测试保护外观。 */
let names = []
export function initialize(data) {
  // 1、接收安全的静态导出名，禁止动态拼接外部内容。
  names = data.names.filter(name => /^[A-Za-z_$][\w$]*$/.test(name))
}
export async function resolve(specifier, context, nextResolve) {
  // 1、覆盖业务使用的 Electron 模块别名。
  if (['electron', 'electron/main', 'electron/common', 'electron/renderer'].includes(specifier)) return { url: 'momentum-background:electron', shortCircuit: true }
  return nextResolve(specifier, context)
}
export async function load(url, context, nextLoad) {
  // 1、只对 Electron 外观生成受保护绑定，其余模块原样加载。
  if (url === 'momentum-background:electron') return { format: 'module', shortCircuit: true, source: [
    'const electron = globalThis.__momentumBackgroundElectron',
    "if (!electron) throw new Error('后台测试保护未安装')",
    'export default electron',
    ...names.map(name => `export const ${name} = electron.${name}`)
  ].join('\n') }
  return nextLoad(url, context)
}
