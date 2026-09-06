/** 基础质量检查：先覆盖新增验证工具，业务模块迁移后逐项纳入检查命令。 */
import vue from 'eslint-plugin-vue'

const nodeGlobals = Object.fromEntries(['Buffer', 'URL', 'console', 'process', 'global', 'require', 'module', '__dirname', '__filename', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate'].map((name) => [name, 'readonly']))
const browserGlobals = Object.fromEntries(['window', 'document', 'location', 'navigator', 'btoa', 'atob', 'Image', 'HTMLImageElement', 'MouseEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'FileReader', 'File', 'Blob', 'localStorage', 'sessionStorage', 'ResizeObserver', 'MutationObserver', 'IntersectionObserver'].map((name) => [name, 'readonly']))

export default [
  { ignores: ['node_modules/**', 'out/**', 'dist/**', 'temp/**', 'release/**'] },
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.{js,mjs,cjs,vue}'],
    languageOptions: { ecmaVersion: 'latest', globals: nodeGlobals },
    rules: { 'no-undef': 'error', 'no-unreachable': 'error', 'no-dupe-args': 'error', 'no-dupe-keys': 'error', 'valid-typeof': 'error' }
  },
  { files: ['src/renderer/**/*.{js,vue}', 'tests/**/*.mjs'], languageOptions: { globals: browserGlobals } },
  { files: ['src/main/**/*.js', 'src/preload/**/*.js'], languageOptions: { globals: { ...nodeGlobals } } }
]
