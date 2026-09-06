/**
 * 部件小图拖拽导出功能
 * 支持将部件选择区域的缩略图拖拽到剪映等外部软件
 */

/**
 * 创建部件缩略图的系统拖拽导出入口。
 * 处理流程：
 * 1、维护拖拽手势标记和图片预缓存
 * 2、提供图片编码、文件命名与系统拖拽处理
 * 3、返回拖拽、点击及预缓存方法供页面绑定
 */
export function usePartImageDrag({ message, currentPsdFile, controlPriority, canvasDragState }) {
  // 1、维护点击判定：刚发生过部件拖拽时忽略一次点击
  let didDragThisGesture = false

  // 从画布拖拽状态中获取isDragging引用（如果提供）
  const canvasIsDragging = canvasDragState?.isDragging

  // 🚀 性能优化：预缓存拖拽数据
  const imageCache = new Map() // key: imgElement, value: { base64, iconPayload, timestamp }
  /**
   * 从data URL加载图片为Image对象
   * 处理流程：
   * 1、创建图片对象，加载成功返回对象，失败拒绝承诺
   */
  const loadImageFromDataURL = (dataURL) => {
    // 1、等待图片解码完成后再供画布使用
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = dataURL
    })
  }

  /**
   * 将图片绘制到canvas并转换为blob
   * 处理流程：
   * 1、按图片自然尺寸建立临时画布并绘制
   * 2、编码为 PNG 二进制数据，空结果或异常交给调用方处理
   */
  const imageToBlob = async (imgElement) => {
    // 1、优先采用图片自然尺寸，避免受到缩略图显示尺寸影响
    try {
      const canvas = document.createElement('canvas')
      canvas.width = imgElement.naturalWidth || imgElement.width
      canvas.height = imgElement.naturalHeight || imgElement.height
      
      const ctx = canvas.getContext('2d')
      ctx.drawImage(imgElement, 0, 0)
      
      // 2、等待 PNG 编码结果，空结果按错误处理
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) {
            resolve(blob)
          } else {
            reject(new Error('无法创建Blob对象'))
          }
        }, 'image/png', 0.9)
      })
    } catch (error) {
      throw new Error('图片转换失败: ' + error.message)
    }
  }

  /**
   * 🚀 预缓存图片数据（在 mouseenter 时调用）
   * 将图片提前转换为 base64，避免在 dragstart 时阻塞
   * 处理流程：
   * 1、跳过五秒内的有效缓存，否则加载并编码图片
   * 2、生成固定尺寸的系统拖拽图标
   * 3、保存图片数据、图标及缓存时间戳
   */
  const precacheImageData = async (imgElement, part) => {
    // 1、在鼠标悬停阶段提前完成图片解码和编码
    try {
      // 如果已经缓存且未过期（5秒内），则跳过
      const cached = imageCache.get(imgElement)
      if (cached && (Date.now() - cached.timestamp < 5000)) {
        return
      }

      // 加载图片
      let sourceImage = imgElement
      if (imgElement.src.startsWith('data:')) {
        sourceImage = await loadImageFromDataURL(imgElement.src)
      }

      // 转换为 blob 和 base64
      const blob = await imageToBlob(sourceImage)
      const buffer = await blob.arrayBuffer()
      /**
       * 将预缓存图片字节转换为 Base64 文本。
       * 处理流程：
       * 1、分块构建二进制字符串，再进行 Base64 编码
       */
      const arrayBufferToBase64 = (buf) => {
        // 1、分块限制字符转换参数数量，避免大图片触发参数上限
        const bytes = new Uint8Array(buf)
        const chunkSize = 0x8000
        let binary = ''
        for (let i = 0; i < bytes.length; i += chunkSize) {
          const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
          binary += String.fromCharCode.apply(null, subArray)
        }
        return btoa(binary)
      }
      const base64 = arrayBufferToBase64(buffer)

      // 2、等比缩放并居中绘制固定尺寸的拖拽图标
      let iconPayload = null
      try {
        const iconCanvas = document.createElement('canvas')
        iconCanvas.width = 115
        iconCanvas.height = 115
        const iconCtx = iconCanvas.getContext('2d')
        const scale = Math.min(115 / sourceImage.width, 115 / sourceImage.height)
        const scaledWidth = sourceImage.width * scale
        const scaledHeight = sourceImage.height * scale
        const offsetX = (115 - scaledWidth) / 2
        const offsetY = (115 - scaledHeight) / 2
        iconCtx.drawImage(sourceImage, offsetX, offsetY, scaledWidth, scaledHeight)
        iconPayload = {
          dataURL: iconCanvas.toDataURL('image/png'),
          size: 115
        }
      } catch (error) {
        console.warn('创建拖拽图标失败:', error)
      }

      // 3、缓存图片与图标，供拖拽开始时直接使用
      imageCache.set(imgElement, {
        base64,
        iconPayload,
        timestamp: Date.now()
      })

      console.log('✅ 预缓存部件图片数据完成:', part?.displayName || part?.name, Math.round(base64.length / 1024), 'KB')
    } catch (error) {
      console.warn('预缓存图片数据失败:', error)
    }
  }

  /**
   * 格式化拖拽错误消息，提供更友好的提示
   * 处理流程：
   * 1、识别格式、文件、权限或超时错误并提供对应提示
   * 2、其他错误附加图片、图标和文件名的诊断信息
   */
  const formatDragError = (error, context = {}) => {
    // 1、优先匹配已知系统拖拽错误
    const errorStr = String(error || '未知错误')

    // 针对常见错误提供具体解决方案
    if (errorStr.includes('NativeImage') || errorStr.includes('file path')) {
      return '拖拽失败：图片数据格式错误。请尝试：\n1. 刷新页面重新加载图片\n2. 切换到其他部件再切回来\n3. 如果问题持续，请联系技术支持'
    }

    if (errorStr.includes('ENOENT') || errorStr.includes('not found')) {
      return '拖拽失败：临时文件创建失败。请检查：\n1. 磁盘空间是否充足\n2. 临时目录权限是否正常\n3. 杀毒软件是否拦截'
    }

    if (errorStr.includes('EACCES') || errorStr.includes('permission')) {
      return '拖拽失败：文件权限不足。请尝试：\n1. 以管理员身份运行程序\n2. 检查目标文件夹权限\n3. 关闭占用文件的其他程序'
    }

    if (errorStr.includes('timeout')) {
      return '拖拽失败：操作超时。可能原因：\n1. 图片文件过大\n2. 磁盘I/O速度慢\n3. 系统资源不足'
    }

    // 2、默认错误消息中补充可用的载荷诊断信息
    const diagnostics = []
    if (context.base64Length === 0) diagnostics.push('图片数据为空')
    if (!context.hasIconPayload) diagnostics.push('缺少拖拽图标')
    if (!context.suggestedName) diagnostics.push('文件名无效')

    const diagInfo = diagnostics.length > 0
      ? `\n诊断信息：${diagnostics.join('、')}`
      : ''

    return `拖拽失败：${errorStr}${diagInfo}`
  }

  /**
   * 生成带时间戳的唯一文件名
   * 处理流程：
   * 1、取得 PSD 名和部件名，清理文件系统不允许的字符
   * 2、追加时间戳与 PNG 后缀，异常时使用通用部件名称
   * @param {Object} part - 部件对象
   * @returns {string} 文件名
   */
  const generatePartFileName = (part) => {
    // 1、从当前 PSD 与部件构造可用的名称片段
    try {
      const timestamp = Date.now()
      const psdNameRaw = currentPsdFile?.value?.name || 'image'
      const psdBase = psdNameRaw.replace(/\.(psd|PSD)$/, '') || 'image'
      
      // 清理PSD名称中的特殊字符
      const safePsdBase = psdBase
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\s]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/\.+$/g, '')
      
      // 清理部件名称
      const partName = (part?.displayName || part?.name || '部件')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/[\s]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
      
      // 2、格式：PSD 名称、部件名称与时间戳组合的 PNG 文件名
      return `${safePsdBase}_${partName}_${timestamp}.png`
    } catch (error) {
      console.error('生成文件名失败:', error)
      return `部件_${Date.now()}.png`
    }
  }

  /**
   * 处理部件图片拖拽开始事件（优化版：使用预缓存数据）
   * 处理流程：
   * 1、排除画布拖拽冲突并接管浏览器默认拖拽
   * 2、优先读取图片缓存，缺失时实时编码并生成图标
   * 3、读取保存目录配置，生成名称并补齐 PSD 文件夹信息
   * 4、调用系统拖拽接口，失败时尝试保存图片并复制路径
   * @param {DragEvent} event - 拖拽事件
   * @param {Object} part - 部件对象
   */
  const handlePartDragStart = async (event, part) => {
    // 1、优先检查画布是否正在拖拽，避免两种手势竞争系统拖拽
    if (canvasIsDragging?.value) {
      console.warn('⚠️ 画布正在拖拽，禁止部件拖拽')
      event.preventDefault()
      event.stopPropagation()
      return
    }

    // 彻底禁用浏览器原生拖拽默认通道，避免与 Electron startDrag 竞争
    if (event && event.preventDefault) event.preventDefault()
    if (event && event.stopPropagation) event.stopPropagation()

    // 设置透明拖拽影子，防止Chromium绘制默认影子
    try {
      const ghost = document.createElement('canvas')
      ghost.width = 1; ghost.height = 1
      event.dataTransfer?.setDragImage?.(ghost, 0, 0)
    } catch {}

    try {
      console.log('🎯 开始拖拽部件图片:', part?.displayName || part?.name)
      didDragThisGesture = false

      // 获取图片元素
      const imgElement = event.target
      if (!imgElement || imgElement.tagName !== 'IMG') {
        console.error('拖拽目标不是图片元素')
        return
      }

      // 2、优先使用预缓存的数据，缺失时实时转换图片与图标
      let base64, iconPayload
      const cached = imageCache.get(imgElement)

      if (cached && cached.base64) {
        console.log('⚡ 使用预缓存的部件图片数据，跳过转换步骤')
        base64 = cached.base64
        iconPayload = cached.iconPayload
      } else {
        // 降级方案：如果没有缓存，实时转换（可能导致拖拽失败）
        console.warn('⚠️ 未找到预缓存数据，执行实时转换（可能失败）')

        let sourceImage = imgElement
        if (imgElement.src.startsWith('data:')) {
          try {
            sourceImage = await loadImageFromDataURL(imgElement.src)
          } catch (error) {
            console.error('加载图片失败:', error)
            message?.error?.('图片加载失败')
            return
          }
        }

        const blob = await imageToBlob(sourceImage)
        const buffer = await blob.arrayBuffer()

        /**
         * 对实时生成的图片字节进行 Base64 编码。
         * 处理流程：
         * 1、分块拼接字节字符串，再编码为传输文本
         */
        const arrayBufferToBase64 = (buf) => {
          // 1、限制每块字符转换大小，兼容较大的图片数据
          const bytes = new Uint8Array(buf)
          const chunkSize = 0x8000
          let binary = ''
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
            binary += String.fromCharCode.apply(null, subArray)
          }
          return btoa(binary)
        }
        base64 = arrayBufferToBase64(buffer)

        try {
          const iconCanvas = document.createElement('canvas')
          iconCanvas.width = 115
          iconCanvas.height = 115
          const iconCtx = iconCanvas.getContext('2d')
          const scale = Math.min(115 / sourceImage.width, 115 / sourceImage.height)
          const scaledWidth = sourceImage.width * scale
          const scaledHeight = sourceImage.height * scale
          const offsetX = (115 - scaledWidth) / 2
          const offsetY = (115 - scaledHeight) / 2
          iconCtx.drawImage(sourceImage, offsetX, offsetY, scaledWidth, scaledHeight)
          iconPayload = {
            dataURL: iconCanvas.toDataURL('image/png'),
            size: 115
          }
        } catch (error) {
          console.warn('创建拖拽图标失败:', error)
        }
      }

      // 3、生成带时间戳的文件名，并读取保存目录与 PSD 文件夹配置
      const suggestedName = generatePartFileName(part)

      // 读取设置中的保存路径配置
      let stickfigureConfig = {}
      try {
        const savedConfig = localStorage.getItem('stickfigure-config')
        if (savedConfig) {
          stickfigureConfig = JSON.parse(savedConfig)
        }
      } catch (error) {
        console.warn('读取配置失败:', error)
      }

      // 确保 createPsdFolder 有默认值
      if (stickfigureConfig.createPsdFolder === undefined) {
        stickfigureConfig.createPsdFolder = true
      }

      // 添加PSD原始名称
      if (currentPsdFile?.value?.name) {
        const psdNameRaw = currentPsdFile.value.name
        let psdBaseName = psdNameRaw.replace(/\.(psd|PSD)$/, '')
        
        // 清理特殊符号，确保文件夹名称合法
        psdBaseName = psdBaseName
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/[\s]+/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_+|_+$/g, '')
          .replace(/\.+$/g, '')
        
        stickfigureConfig.psdBaseName = psdBaseName
      }

      // 部件拖拽始终强制重命名（使用时间戳），避免覆盖
      stickfigureConfig.forceRename = true

      console.log('🎯 部件拖拽保存配置:', stickfigureConfig)
      console.log('📝 生成的文件名:', suggestedName)
      console.log('📊 数据准备情况:', {
        base64Length: base64?.length || 0,
        hasIconPayload: !!iconPayload,
        iconDataURLLength: iconPayload?.dataURL?.length || 0,
        suggestedName,
        fromCache: !!cached
      })

      // 4、调用桌面系统拖拽接口，失败时尝试保存和复制路径
      let result
      if (window.electronAPI?.createTempFileAndStartDrag) {
        result = await window.electronAPI.createTempFileAndStartDrag(
          base64,
          iconPayload,
          suggestedName,
          stickfigureConfig
        )
      } else if (window.electronAPI?.invoke) {
        result = await window.electronAPI.invoke(
          'create-temp-file-and-start-drag',
          base64,
          iconPayload,
          suggestedName,
          stickfigureConfig
        )
      } else {
        throw new Error('electronAPI 不可用')
      }

      if (result && result.success) {
        console.log('✅ 部件图片拖拽成功:', result.filePath)
        didDragThisGesture = true
      } else {
        const errorContext = {
          base64Length: base64?.length || 0,
          hasIconPayload: !!iconPayload,
          suggestedName
        }
        console.error('❌ 部件图片拖拽失败:', {
          error: result?.error,
          ...errorContext
        })

        const friendlyError = formatDragError(result?.error, errorContext)
        message?.error?.(friendlyError)

        // 尝试降级方案：保存并复制到剪贴板
        try {
          console.log('🔄 尝试降级方案：保存文件到磁盘')
          const fallback = await window.electronAPI?.saveDragImageAndCopy?.(
            base64,
            iconPayload,
            stickfigureConfig
          )
          if (fallback && fallback.success) {
            await window.electronAPI?.copyToClipboard?.(fallback.filePath)
            message?.success?.('图片已保存并复制路径到剪贴板')
          }
        } catch (fallbackError) {
          console.error('降级方案失败:', fallbackError)
        }
      }
    } catch (error) {
      const errorContext = {
        base64Length: base64?.length || 0,
        hasIconPayload: !!iconPayload,
        suggestedName: generatePartFileName(part)
      }
      console.error('部件拖拽处理失败:', error, errorContext)

      const friendlyError = formatDragError(error.message || error, errorContext)
      message?.error?.(friendlyError)
    }
  }

  /**
   * 处理拖拽结束事件
   * 处理流程：
   * 1、记录系统拖拽结束，保留手势标记供后续点击判定
   */
  const handlePartDragEnd = (event) => {
    // 1、拖拽后的点击抑制由点击处理器消费
    console.log('🏁 部件拖拽结束')
  }

  /**
   * 处理小图点击：若未发生拖拽，则当作选择；若刚刚发生过拖拽，则忽略点击
   * 处理流程：
   * 1、消费已完成拖拽标记并忽略本次点击
   * 2、普通点击调用页面提供的部件选择回调
   */
  const handlePartImageClick = (part, selectPart) => {
    // 1、系统拖拽成功后的首个点击不切换部件
    if (didDragThisGesture) {
      // 刚完成拖拽，不触发选择
      didDragThisGesture = false
      return
    }
    // 2、只在提供有效回调时应用部件选择
    if (typeof selectPart === 'function') {
      selectPart(part)
    }
  }

  // 3、导出页面图片事件与鼠标悬停预缓存所需的入口
  return {
    handlePartDragStart,
    handlePartDragEnd,
    handlePartImageClick,
    precacheImageData  // 🚀 暴露预缓存函数，供组件在 mouseenter 时调用
  }
}
