/** 画布输出协调：仅负责独立预览协议与跨页面图片传递，监听和生命周期仍由页面注册。 */
import { h, ref } from 'vue'

/** 持有页面原始引用及稳定回调；初始化时不读取晚声明状态，也不创建发送状态副本。 */
export function useCanvasOutputCoordinator({ currentPsdData, canvasRef, isSendingToGenerate, message, router, perfLogger, buildSuggestedFileName, logPreviewSyncTrigger }) {
  /**
   * 打开独立画布预览窗口。
   * 处理流程：
   * 1、检查 PSD 数据并请求创建窗口
   * 2、同步主题和文件名，延迟发送画布内容
   * 3、反馈窗口创建结果
   */
  const openCanvasPreview = async () => {
    // 1、未载入 PSD 时终止创建
    if (!currentPsdData.value) {
      message.warning('请先上传PSD文件')
      return
    }

    try {
      const result = await window.electronAPI?.invoke('canvas-preview-create')
      if (result?.success) {
        // 2、立即同步当前主题到预览窗口
        const savedTheme = localStorage.getItem('theme') || 'dark'
        await window.electronAPI?.invoke('canvas-preview-sync-theme', savedTheme)

        // 立即同步当前文件名
        const fileName = buildSuggestedFileName()
        await window.electronAPI?.invoke('canvas-preview-update-filename', fileName)

        // 延迟发送画布内容，确保预览窗口完全加载
        setTimeout(async () => {
          await syncCanvasToPreview()
        }, 300)

        // 3、报告窗口创建成功
        message.success('已打开预览图窗口')
      }
    } catch (error) {
      console.error('打开预览窗口失败:', error)
      message.error('打开预览窗口失败')
    }
  }

  /**
   * 将当前画布转换为图片并交给图像处理页面。
   * 处理流程：
   * 1、校验 PSD 和画布状态，标记发送中
   * 2、导出 PNG 并转换为数据地址
   * 3、替换待处理图片缓存并跳转页面
   * 4、反馈结果并释放发送状态
   */
  const sendCanvasToGenerate = async (event) => {
    // 1、阻止事件冒泡并检查数据，避免触发画布面板折叠
    event?.stopPropagation()

    if (!currentPsdData.value) {
      message.warning('请先上传PSD文件')
      return
    }

    if (!canvasRef.value) {
      message.error('画布未就绪，请稍后再试')
      return
    }

    isSendingToGenerate.value = true
    console.log('[人物调整] 开始发送画布到图像处理插件')

    try {
      const canvas = canvasRef.value

      // 验证canvas有效性
      if (!canvas.width || !canvas.height) {
        message.error('画布尺寸无效')
        console.error('[人物调整] 画布尺寸无效:', { width: canvas.width, height: canvas.height })
        return
      }

      console.log('[人物调整] 画布尺寸:', { width: canvas.width, height: canvas.height })

      // 2、将画布转换为 PNG 二进制数据，再读取数据地址
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((createdBlob) => {
          if (!createdBlob) {
            reject(new Error('Blob结果为空'))
            return
          }
          resolve(createdBlob)
        }, 'image/png', 1.0)
      })

      if (!blob) {
        message.error('图片转换失败')
        return
      }

      console.log('[人物调整] Blob 创建成功，大小:', blob.size, 'bytes')

      // 将Blob转换为Base64 DataURL
      const reader = new FileReader()
      const dataURL = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      console.log('[人物调整] DataURL 转换成功，长度:', dataURL.length)

      // 生成文件名
      const fileName = buildSuggestedFileName() || '画布导出.png'
      console.log('[人物调整] 生成文件名:', fileName)

      // 3、先清除旧数据，再写入本次待处理图片并跳转
      const oldData = sessionStorage.getItem('pendingImageForGenerate')
      if (oldData) {
        console.log('[人物调整] 清除旧的待处理数据')
        sessionStorage.removeItem('pendingImageForGenerate')
      }

      // 将图片数据存储到 sessionStorage，供 GeneratePage 读取
      const imageData = {
        dataURL,
        fileName,
        timestamp: Date.now(),
        source: 'action-expression-canvas'
      }
      sessionStorage.setItem('pendingImageForGenerate', JSON.stringify(imageData))
      console.log('[人物调整] 新图片数据已存储到 sessionStorage，时间戳:', imageData.timestamp)

      // 跳转到图像处理页面
      console.log('[人物调整] 准备跳转到图像处理页面')
      await router.push('/image-processing')

      message.success('已发送到图像处理插件')
    } catch (error) {
      console.error('[人物调整] 发送到生成页面失败:', error)
      message.error('发送失败：' + error.message)
    } finally {
      // 4、无论成功、失败或中途返回，都释放发送状态
      isSendingToGenerate.value = false
    }
  }

  /**
   * 同步画布内容和文件名到独立预览窗口。
   * 处理流程：
   * 1、验证画布并开始耗时记录
   * 2、优先生成 PNG 二进制载荷，失败时回退数据地址
   * 3、异步发送图片与文件名并记录编码结果
   */
  const syncCanvasToPreview = async () => {
    // 1、没有画布或有效尺寸时记录跳过原因
    if (!canvasRef.value) {
      console.warn('[预览同步] Canvas引用不存在')
      logPreviewSyncTrigger('skip', { reason: 'no-canvas' })
      return
    }

    try {
      const canvas = canvasRef.value

      // 验证canvas有效性
      if (!canvas.width || !canvas.height) {
        console.warn('[预览同步] Canvas尺寸无效:', { width: canvas.width, height: canvas.height })
        logPreviewSyncTrigger('skip', { reason: 'empty-canvas' })
        return
      }

      const startTime = performance.now()
      let previewMeasurement = perfLogger.start('preview-sync:full', { threshold: 35 })

      let payload = null
      let encodingStrategy = 'blob-png'
      try {
        // 2、使用 PNG 格式保持最高画质，失败时回退数据地址
        const blob = await new Promise((resolve, reject) => {
          canvas.toBlob((createdBlob) => {
            if (!createdBlob) {
              reject(new Error('Blob结果为空'))
              return
            }
            resolve(createdBlob)
          }, 'image/png', 1.0) // PNG 格式，质量1.0保持原始画质
        })
        const arrayBuffer = await blob.arrayBuffer()
        payload = {
          buffer: arrayBuffer,
          width: canvas.width,
          height: canvas.height,
          mimeType: blob.type || 'image/png'
        }
      } catch (blobError) {
        // 兜底方案：使用 PNG dataURL
        encodingStrategy = 'dataURL-png-fallback'
        console.warn('[预览同步] toBlob 失败，使用 dataURL 兜底:', blobError)
        const dataUrl = canvas.toDataURL('image/png', 1.0)
        if (!dataUrl || dataUrl.length < 100) {
          console.error('[预览同步] Canvas数据无效或为空')
          return
        }
        payload = {
          dataUrl,
          width: canvas.width,
          height: canvas.height,
          mimeType: 'image/png'
        }
      }

      const encodeTime = performance.now() - startTime
      console.log('[预览同步] 图像编码完成:', {
        width: canvas.width,
        height: canvas.height,
        strategy: encodingStrategy,
        byteLength: payload.buffer ? payload.buffer.byteLength : payload.dataUrl.length,
        encodeTime: `${encodeTime.toFixed(1)}ms`
      })

      // 3、异步发送到预览窗口并同步文件名，不等待窗口更新结果
      window.electronAPI?.invoke('canvas-preview-update', payload).then(result => {
        if (result && !result.success) {
          console.error('[预览同步] 预览窗口更新失败:', result.error)
        } else {
          const totalTime = performance.now() - startTime
          console.log(`[预览同步] ✅ 完成 (总耗时: ${totalTime.toFixed(1)}ms)`)
        }
      }).catch(err => {
        console.error('[预览同步] 发送失败:', err)
      })

      // 异步同步文件名（不阻塞）
      const fileName = buildSuggestedFileName()
      window.electronAPI?.invoke('canvas-preview-update-filename', fileName).catch(err => {
        console.error('[预览同步] 文件名同步失败:', err)
      })

      previewMeasurement?.end({
        strategy: encodingStrategy,
        width: canvas.width,
        height: canvas.height,
        payloadBytes: payload.buffer ? payload.buffer.byteLength : payload.dataUrl?.length || 0,
        encodeTime: Number(encodeTime.toFixed(1))
      })

    } catch (error) {
      console.error('[预览同步] 同步画布到预览窗口失败:', error)
      perfLogger.logEvent('preview-sync:error', { message: error?.message })
    }
  }

  /**
   * 切换 PSD 时重置独立预览窗口的视口。
   * 处理流程：
   * 1、发送重置命令，窗口不存在时仅记录调试信息
   */
  const resetPreviewWindowViewport = async () => {
    // 1、将缩放和位置复位委托给预览窗口
    try {
      await window.electronAPI?.invoke('canvas-preview-reset-viewport')
      console.log('[预览窗口] ✅ 已发送视图重置命令')
    } catch (error) {
      // 静默失败，预览窗口可能未打开
      console.debug('[预览窗口] 视图重置调用失败（预览窗口可能未打开）:', error)
    }
  }

  /**
   * 将当前画布作为图片传递给指定工具页面。
   * 处理流程：
   * 1、验证画布并导出 PNG 数据地址
   * 2、保存临时图片并写入跨页面待处理缓存
   * 3、按菜单项跳转目标页面，最终释放发送状态
   */
  const handleJumpSelect = async (key) => {
    // 1、缺少 PSD 或画布时不启动导出
    if (!currentPsdData.value || !canvasRef.value) {
      message.warning('请先上传PSD文件')
      return
    }

    isSendingToGenerate.value = true

    try {
      const canvas = canvasRef.value

      // 验证canvas有效性
      if (!canvas.width || !canvas.height) {
        message.error('画布尺寸无效')
        console.error('[人物调整] 画布尺寸无效:', { width: canvas.width, height: canvas.height })
        isSendingToGenerate.value = false
        return
      }

      console.log(`[人物调整] 准备跳转到: ${key}`)

      // 将canvas转换为Blob
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((createdBlob) => {
          if (!createdBlob) {
            reject(new Error('Blob结果为空'))
            return
          }
          resolve(createdBlob)
        }, 'image/png', 1.0)
      })

      if (!blob) {
        message.error('图片转换失败')
        isSendingToGenerate.value = false
        return
      }

      console.log('[人物调整] Blob 创建成功，大小:', blob.size, 'bytes')

      // 将Blob转换为Base64 DataURL
      const reader = new FileReader()
      const dataURL = await new Promise((resolve, reject) => {
        reader.onload = () => resolve(reader.result)
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })

      console.log('[人物调整] DataURL 转换成功，长度:', dataURL.length)

      // 生成文件名
      const fileName = buildSuggestedFileName() || '画布导出.png'
      console.log('[人物调整] 生成文件名:', fileName)

      // 2、保存图片到临时文件，再把图片信息放入会话缓存
      const base64Data = dataURL.split(',')[1]
      const tempDir = await window.api?.getTempDir?.()
      const tempFilePath = tempDir ? `${tempDir}\\${fileName}` : fileName

      console.log('[人物调整] 保存文件到:', tempFilePath)

      try {
        await window.api?.writeFile(tempFilePath, base64Data)
        console.log('[人物调整] 文件保存成功')
      } catch (error) {
        console.error('[人物调整] 文件保存失败:', error)
        message.error('文件保存失败: ' + error.message)
        isSendingToGenerate.value = false
        return
      }

      // 先清除旧数据
      const oldData = sessionStorage.getItem('pendingImageForJump')
      if (oldData) {
        console.log('[人物调整] 清除旧的待处理数据')
        sessionStorage.removeItem('pendingImageForJump')
      }

      // 将图片信息存储到 sessionStorage，供目标页面读取
      const imageData = {
        dataURL,
        fileName,
        filePath: tempFilePath,
        timestamp: Date.now(),
        source: 'action-expression-canvas',
        targetPage: key
      }
      sessionStorage.setItem('pendingImageForJump', JSON.stringify(imageData))
      console.log('[人物调整] 图片数据已存储到 sessionStorage')

      // 3、根据选择跳转到对应工具页面，并通过最终清理释放发送状态
      let targetRoute = ''
      let successMessage = ''

      switch (key) {
        case 'removebg':
          targetRoute = '/image-processing'
          successMessage = '已跳转到抠图页面'
          break
        case 'comic':
          targetRoute = '/comic'
          successMessage = '已跳转到分格页面'
          break
        case 'dialog-frame':
          targetRoute = '/dialog-frame'
          successMessage = '已跳转到幻想框页面'
          break
        default:
          message.error('未知的跳转目标')
          isSendingToGenerate.value = false
          return
      }

      console.log('[人物调整] 准备跳转到:', targetRoute)
      await router.push(targetRoute)

      message.success(successMessage)
    } catch (error) {
      console.error('[人物调整] 跳转失败:', error)
      message.error('跳转失败：' + error.message)
    } finally {
      isSendingToGenerate.value = false
    }
  }

  return { openCanvasPreview, sendCanvasToGenerate, syncCanvasToPreview, resetPreviewWindowViewport, handleJumpSelect }
}

/** 在页面原菜单声明位置创建选项，保持原 ref、图标与分配时序。 */
export function createCanvasJumpOptions() {
  // ==================== 跳转菜单选项 ====================
  return ref([
    {
      label: '跳转到抠图',
      key: 'removebg',
      icon: () => h('span', '🎨')
    },
    {
      label: '跳转到分格',
      key: 'comic',
      icon: () => h('span', '📱')
    },
    {
      label: '跳转到幻想框',
      key: 'dialog-frame',
      icon: () => h('span', '💭')
    }
  ])
}
