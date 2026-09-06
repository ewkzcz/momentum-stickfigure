/**
 * PSD文件上传UI逻辑
 * 处理拖拽上传PSD文件的交互
 */

import { ref } from 'vue'

/**
 * 创建 PSD 拖拽上传交互。
 * 处理流程：
 * 1、维护上传中与拖拽悬停状态
 * 2、提供拖入、离开和文件放置处理入口
 * @param {Object} params
 * @param {Object} params.message - naive-ui 的 message 实例
 * @param {import('vue').Ref} params.psdFiles - PSD文件列表
 * @param {Function} params.processFile - 处理文件的方法
 */
export function usePsdUpload({ message, psdFiles, processFile }) {
  // 1、建立拖拽提示与上传进度状态
  
  const isUploading = ref(false)
  const isDragOver = ref(false)

  // ==================== 方法 ====================
  
  /**
   * 处理拖拽进入
   * 处理流程：
   * 1、接管浏览器事件并开启拖拽悬停反馈
   */
  const handleDragOver = (e) => {
    // 1、允许文件放置到当前上传区域
    e.preventDefault()
    e.stopPropagation()
    isDragOver.value = true
  }

  /**
   * 处理拖拽离开
   * 处理流程：
   * 1、阻止事件继续传播并清除悬停反馈
   */
  const handleDragLeave = (e) => {
    // 1、结束当前区域的拖拽高亮
    e.preventDefault()
    e.stopPropagation()
    isDragOver.value = false
  }

  /**
   * 处理文件拖放
   * 处理流程：
   * 1、筛选 PSD 文件，缺少真实路径时保存到临时目录
   * 2、过滤已打开及超过大小限制的文件
   * 3、依次调用文件处理入口并累计结果
   * 4、清理进度消息，汇总结果并结束上传状态
   */
  const handleDrop = async (e) => {
    // 1、接管放置事件并为有效 PSD 文件准备可访问的真实路径
    e.preventDefault()
    e.stopPropagation()
    isDragOver.value = false

    const files = Array.from(e.dataTransfer.files).filter(file =>
      file.name.toLowerCase().endsWith('.psd')
    )

    if (files.length === 0) {
      message.warning('请拖放PSD文件')
      return
    }

    console.log('📂 拖放的PSD文件:', files)

    isUploading.value = true

    // 处理每个文件，确保都有真实路径
    const filesWithPath = []
    for (let i = 0; i < files.length; i++) {
      const file = files[i]

      // 检查文件是否已经有path属性
      if (file.path) {
        console.log(`📍 文件 ${i}: ${file.name} 已有路径: ${file.path}`)
        filesWithPath.push(file)
      } else {
        console.log(`⚠️ 文件 ${i}: ${file.name} 没有路径信息，正在保存到临时目录...`)

        try {
          // 读取文件内容
          const arrayBuffer = await file.arrayBuffer()

          // 调用Electron API保存到临时目录并获取路径
          const result = await window.electronAPI?.saveDraggedFile?.(file.name, arrayBuffer)

          if (result && result.success && result.filePath) {
            console.log(`✅ 文件已保存到临时目录: ${result.filePath}`)

            // 创建新的File对象，带有真实路径
            const newFile = new File([arrayBuffer], file.name, { type: file.type })

            // 强制设置path属性
            Object.defineProperty(newFile, 'path', {
              value: result.filePath,
              writable: false,
              enumerable: true,
              configurable: false
            })

            filesWithPath.push(newFile)
          } else {
            console.error(`❌ 保存文件失败: ${file.name}`, result?.error)
            message.error(`保存文件 ${file.name} 失败`)
          }
        } catch (error) {
          console.error(`❌ 处理文件失败: ${file.name}`, error)
          message.error(`处理文件 ${file.name} 失败`)
        }
      }
    }

    if (filesWithPath.length === 0) {
      message.error('所有文件处理失败')
      isUploading.value = false
      return
    }

    // 2、获取已打开路径，过滤重复文件及超过大小限制的文件
    const openedPaths = new Set(
      psdFiles.value
        .filter(psd => psd.filePath)
        .map(psd => psd.filePath)
    )

    // 过滤出需要加载的文件
    const toLoad = []
    let alreadyOpenedCount = 0
    let tooLargeCount = 0

    for (const file of filesWithPath) {
      // 检查文件是否已经打开
      const isAlreadyOpened = file.path
        ? openedPaths.has(file.path)
        : psdFiles.value.some(psd => psd.name === file.name)

      if (isAlreadyOpened) {
        console.log(`⏭️ 文件已打开，跳过: ${file.path || file.name}`)
        alreadyOpenedCount++
        continue
      }

      // 验证文件大小
      if (file.size > 300 * 1024 * 1024) {
        console.log(`⏭️ 文件过大，跳过: ${file.name}`)
        tooLargeCount++
        continue
      }

      toLoad.push(file)
    }
    
    // 如果没有需要加载的文件
    if (toLoad.length === 0) {
      isUploading.value = false
      if (alreadyOpenedCount > 0) {
        message.info(`所有文件都已打开（${alreadyOpenedCount} 个）`)
      } else if (tooLargeCount > 0) {
        message.error(`所有文件都超过300MB限制（${tooLargeCount} 个）`)
      }
      return
    }
    
    // 3、逐个解析待加载文件，单个失败不阻断后续文件
    let successCount = 0
    let failCount = 0
    
    for (let i = 0; i < toLoad.length; i++) {
      const file = toLoad[i]
      try {
        message.loading(`正在处理 ${i + 1}/${toLoad.length}: ${file.name}`, { 
          duration: 0, 
          key: 'parse-drag' 
        })
        
        // 处理文件
        await processFile(file, false)
        successCount++
      } catch (error) {
        console.error(`处理文件失败: ${file.name}`, error)
        failCount++
      }
    }
    
    // 4、循环结束后统一清理消息并汇总全部分类结果
    message.destroyAll()
    
    // 显示最终结果
    const resultParts = []
    if (successCount > 0) {
      resultParts.push(`成功加载 ${successCount} 个`)
    }
    if (alreadyOpenedCount > 0) {
      resultParts.push(`${alreadyOpenedCount} 个已打开`)
    }
    if (tooLargeCount > 0) {
      resultParts.push(`${tooLargeCount} 个过大`)
    }
    if (failCount > 0) {
      resultParts.push(`${failCount} 个失败`)
    }
    
    if (resultParts.length > 0) {
      if (successCount > 0) {
        message.success(resultParts.join('，'))
      } else {
        message.info(resultParts.join('，'))
      }
    }
    
    isUploading.value = false
  }

  // 2、返回上传状态与拖拽事件入口供页面绑定
  
  return {
    // 状态
    isUploading,
    isDragOver,
    
    // 方法
    handleDragOver,
    handleDragLeave,
    handleDrop
  }
}
