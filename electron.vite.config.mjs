/** 桌面应用构建配置：拆分主进程、预加载和双渲染入口，并复制运行时 API 模块。 */
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { copyFileSync, existsSync, mkdirSync } from 'fs'


/**
 * 创建运行时 API 模块复制插件。
 * 处理流程：
 * 1、返回构建结束钩子，在主进程打包完成后复制共享地址和 API 源文件。
 */
function copyApiModulesPlugin() {
  // 1、复制行为绑定构建结束阶段，避免输出目录清理后文件丢失。
  return {
    name: 'copy-api-modules',
    /**
     * 补齐构建产物中按文件路径加载的模块。
     * 处理流程：
     * 1、创建共享模块目录并复制地址解析工具。
     * 2、复制生图 API 模块。
     * 3、复制 PSD API 模块与其包配置。
     */
    closeBundle() {
      // 1、原样复制的 API 模块也需要共享地址处理模块。
      mkdirSync('out/shared', { recursive: true })
      copyFileSync('src/shared/api-url.js', 'out/shared/api-url.js')
      // 2、保留生图模块相对路径结构，供运行时直接导入。
      const geminiSourceDir = 'src/main/gemini-image-api'
      const geminiTargetDir = 'out/main/gemini-image-api'
      
      if (!existsSync(geminiTargetDir)) {
        mkdirSync(geminiTargetDir, { recursive: true })
      }
      
      const geminiFiles = [
        'gemini-image-client.js',
        'gemini-image-config.js',
        'gemini-image-ipc.js',
        'gemini-image-service.js',
        'gemini-image-utils.js'
      ]
      geminiFiles.forEach(file => {
        const source = `${geminiSourceDir}/${file}`
        const target = `${geminiTargetDir}/${file}`
        if (existsSync(source)) {
          copyFileSync(source, target)
        }
      })
      
      // 3、PSD API 同时复制包配置，保持其模块解释方式。
      const psdSourceDir = 'src/main/psd-api'
      const psdTargetDir = 'out/main/psd-api'
      
      if (!existsSync(psdTargetDir)) {
        mkdirSync(psdTargetDir, { recursive: true })
      }
      
      const psdFiles = ['config.js', 'psd_client.js', 'psd_utils.js', 'main_api.js', 'package.json', 'index.js']
      psdFiles.forEach(file => {
        const source = `${psdSourceDir}/${file}`
        const target = `${psdTargetDir}/${file}`
        if (existsSync(source)) {
          copyFileSync(source, target)
          console.log(`复制PSD API文件: ${file}`)
        }
      })
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyApiModulesPlugin()],
    build: {
      rollupOptions: {
        external: [
          'ag-psd', 
          '@napi-rs/canvas'

        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    server: {
      host: '127.0.0.1', // 只使用 IPv4，避免 IPv6 权限问题
      port: 5555 // 更换端口避免权限问题
    },
    build: {
      minify: 'esbuild', // 使用 esbuild 压缩（Vite 内置，更快）
      target: 'esnext', // 现代浏览器目标
      chunkSizeWarningLimit: 1000, // 代码块大小警告阈值1MB
      rollupOptions: { // Rollup高级配置
        input: { 
          index: resolve('src/renderer/index.html'),
          'canvas-preview': resolve('src/renderer/canvas-preview.html')  // 添加预览窗口入口
        },
        output: {
          manualChunks: { // 按依赖拆分代码
            'vue-vendor': ['vue', 'vue-router', 'pinia'], // Vue生态系统库独立打包
            'ui-vendor': ['naive-ui', '@vueuse/motion'], // UI组件库独立打包
            'utils-vendor': ['axios'] // 工具库独立打包
          }
        },

      }
    },
    resolve: { alias: { '@renderer': resolve('src/renderer/src'), '@shared': resolve('src/shared') } },
    plugins: [
      vue({
        template: {
          compilerOptions: {
            isCustomElement: (tag) => tag === 'webview'
          }
        }
      })
    ]
  }
})
