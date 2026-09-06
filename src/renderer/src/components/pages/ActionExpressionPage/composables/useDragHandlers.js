/**
 * 画布拖拽处理：协调页面跟随预览、图片数据准备和跨窗口的系统拖拽。
 */
import { nextTick } from 'vue'

/**
 * 拖拽核心逻辑（事件处理与系统拖拽协作）
 * 处理流程：
 * 1、接入拖拽状态、阈值和画布依赖。
 * 2、提供数据缓存、指针判断与系统拖拽切换逻辑。
 * 3、返回拖拽事件和清理接口。
 * 依赖注入所有外部依赖，避免循环引用：
 * - state: useDragState() 返回的对象
 * - constants: FOLLOW_OFFSET_X/Y, OUTSIDE_* 等
 * - deps: { canvasRef, updateWindowBounds, windowBounds, trimWhitespace, trimWhitespaceHorizontal, drawDragPreview, MIN_DRAG_TIME_MS, OUTSIDE_SAFE_MARGIN, OUTSIDE_COUNT_THRESHOLD, OUTSIDE_DURATION_MS, message, buildSuggestedFileName, controlPriority }
 */
export function useDragHandlers({
  state,
  constants,
  deps
}) {
  // 1、解构共享状态与依赖，保持拖拽过程使用同一组引用。
  const {
    isDragging,
    dragFollowPreview,
    dragFollowCanvas,
    dragSnapshotCanvas,
    dragMouseX,
    dragMouseY,
    dragCalibration,
    hasTriggeredSystemDrag,
    isNearBoundary,
    getDragRuntime,
    setDragRuntime,
    resetOutsideCounters
  } = state

  const {
    FOLLOW_OFFSET_X,
    FOLLOW_OFFSET_Y,
    MIN_DRAG_TIME_MS,
    OUTSIDE_SAFE_MARGIN,
    OUTSIDE_COUNT_THRESHOLD,
    OUTSIDE_DURATION_MS
  } = constants

  const {
    canvasRef,
    updateWindowBounds,
    windowBounds,
    trimWhitespace,
    trimWhitespaceHorizontal,
    drawDragPreview,
    message,
    buildSuggestedFileName,
    controlPriority
  } = deps

  let dragMoveRaf = null
  let pendingMoveEvent = null

  // 🚀 性能优化：预缓存拖拽数据
  let cachedDragData = null // 缓存的base64数据和配置
  let preparingCache = false // 标记是否正在准备缓存

  // 2、准备图片缓存、指针阈值判断与系统拖拽协作方法。
  /**
   * 格式化拖拽错误消息，提供更友好的提示
   * 处理流程：
   * 1、按常见错误类型匹配提示。
   * 2、未匹配时补充图片、图标和文件名诊断信息。
   */
  const formatDragError = (error, context = {}) => {
    // 1、优先提供对应文件、权限和超时问题的提示。
    const errorStr = String(error || '未知错误')

    // 针对常见错误提供具体解决方案
    if (errorStr.includes('NativeImage') || errorStr.includes('file path')) {
      return '拖拽失败：拖拽操作速度过快，图片格式转换尚未完成'
    }

    if (errorStr.includes('ENOENT') || errorStr.includes('not found')) {
      return '拖拽失败：临时文件创建失败。请检查：\n1. 磁盘空间是否充足\n2. 临时目录权限是否正常\n3. 杀毒软件是否拦截'
    }

    if (errorStr.includes('EACCES') || errorStr.includes('permission')) {
      return '拖拽失败：文件权限不足。请尝试：\n1. 以管理员身份运行程序\n2. 检查目标文件夹权限\n3. 关闭占用文件的其他程序'
    }

    if (errorStr.includes('timeout')) {
      return '拖拽失败：操作超时。可能原因：\n1. 画布内容过大\n2. 磁盘I/O速度慢\n3. 系统资源不足'
    }

    if (errorStr.includes('画布未初始化')) {
      return '拖拽失败：画布未准备好。请等待画面加载完成后再拖拽'
    }

    // 2、默认错误消息添加当前拖拽数据的诊断信息。
    const diagnostics = []
    if (context.base64Length === 0) diagnostics.push('画布数据为空')
    if (!context.hasIconPayload) diagnostics.push('缺少拖拽图标')
    if (!context.suggestedName) diagnostics.push('文件名无效')

    const diagInfo = diagnostics.length > 0
      ? `\n诊断信息：${diagnostics.join('、')}`
      : ''

    return `拖拽失败：${errorStr}${diagInfo}`
  }

  /**
   * 根据裁边模式取得用于导出的画布。
   * 处理流程：
   * 1、按设置裁去空白，必要时缓存裁剪快照。
   * 2、无需裁剪时返回原画布并清理快照引用。
   */
  const resolveSourceCanvas = ({ cacheTrimmed = false } = {}) => {
    // 1、使用当前裁边选项选择导出内容。
    const baseCanvas = canvasRef.value
    if (!baseCanvas) return null
    const trimMode = deps.enableTrimWhitespace?.value
    if (trimMode === 'trim') {
      const trimmed = trimWhitespace(baseCanvas)
      if (trimmed && trimmed !== baseCanvas) {
        if (cacheTrimmed) dragSnapshotCanvas.value = trimmed
        return trimmed
      }
    } else if (trimMode === 'trim-horizontal') {
      const trimmed = trimWhitespaceHorizontal(baseCanvas)
      if (trimmed && trimmed !== baseCanvas) {
        if (cacheTrimmed) dragSnapshotCanvas.value = trimmed
        return trimmed
      }
    }
    // 2、没有独立裁剪结果时回退到主画布。
    if (cacheTrimmed) {
      dragSnapshotCanvas.value = null
    }
    return baseCanvas
  }

  /**
   * 释放拖拽裁剪快照引用。
   * 处理流程：
   * 1、清空当前快照，允许画布资源被回收。
   */
  const releaseSnapshotCanvas = () => {
    // 1、只在持有快照时重置引用。
    if (dragSnapshotCanvas.value) {
      dragSnapshotCanvas.value = null
    }
  }

  /**
   * 取消待执行的拖拽移动帧。
   * 处理流程：
   * 1、取消动画帧并清空待处理的指针数据。
   */
  const cancelDragMoveFrame = () => {
    // 1、防止系统拖拽开始后继续更新页面跟随位置。
    if (dragMoveRaf) {
      cancelAnimationFrame(dragMoveRaf)
      dragMoveRaf = null
    }
    pendingMoveEvent = null
  }

  /**
   * 将图片二进制对象转换为纯 Base64 内容。
   * 处理流程：
   * 1、读取数据地址，移除前缀并返回内容，读取异常时拒绝任务。
   */
  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    // 1、通过文件读取器异步完成图片编码。
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result === 'string') {
        const commaIndex = result.indexOf(',')
        resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
      } else {
        reject(new Error('无法读取文件内容'))
      }
    }
    reader.onerror = () => reject(new Error('无法读取文件内容'))
    reader.readAsDataURL(blob)
  })

  /**
   * 性能优化：预先准备拖拽数据（在拖拽开始时异步执行）
   * 这样可以避免在触发系统拖拽时才开始转换，减少卡顿
   * 处理流程：
   * 1、排除重复任务并异步获取图片字节。
   * 2、编码图片、准备图标并缓存本次拖拽数据。
   * 3、结束时释放准备标记。
   */
  const prepareDragDataAsync = async () => {
    // 1、复用已有缓存，避免重复启动图片转换。
    if (preparingCache || cachedDragData) return // 避免重复准备
    preparingCache = true

    try {
      const sourceCanvas = resolveSourceCanvas({ cacheTrimmed: false })
      if (!sourceCanvas) {
        preparingCache = false
        return
      }

      // 异步转换canvas为base64
      const blob = await new Promise(resolve => sourceCanvas.toBlob(resolve, 'image/png', 1.0))
      if (!blob) {
        preparingCache = false
        return
      }

      // 2、分块转换字节，随后缓存图片与跟随预览图标。
      const buffer = await blob.arrayBuffer()
      const bytes = new Uint8Array(buffer)
      const chunkSize = 0x8000
      let binary = ''
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
        binary += String.fromCharCode.apply(null, subArray)
      }
      const base64 = btoa(binary)

      // 准备图标
      let iconPayload = null
      try {
        if (dragFollowCanvas.value) {
          const dataURL = dragFollowCanvas.value.toDataURL('image/png')
          iconPayload = { dataURL, size: 115 }
        }
      } catch {}

      // 缓存数据
      cachedDragData = {
        base64,
        iconPayload,
        timestamp: Date.now()
      }

      console.log('✅ 拖拽数据已预缓存，大小:', Math.round(base64.length / 1024), 'KB')
    } catch (error) {
      console.error('预缓存拖拽数据失败:', error)
    } finally {
      // 3、无论编码成功与否都允许后续重新准备缓存。
      preparingCache = false
    }
  }

  /**
   * 清除缓存的拖拽数据
   * 处理流程：
   * 1、清空缓存及准备标记。
   */
  const clearDragDataCache = () => {
    // 1、让下一次拖拽重新捕获当前画布。
    cachedDragData = null
    preparingCache = false
  }

  /**
   * 判断屏幕坐标是否越过窗口安全边界。
   * 处理流程：
   * 1、根据窗口矩形与边距判断四个方向是否越界。
   */
  const checkMouseOutsideWindow = (screenX, screenY, safeMargin = OUTSIDE_SAFE_MARGIN) => {
    // 1、使用屏幕坐标系比较窗口外扩后的边界。
    const bounds = windowBounds.value
    const windowLeft = bounds.x
    const windowTop = bounds.y
    const windowRight = bounds.x + bounds.width
    const windowBottom = bounds.y + bounds.height
    return (
      screenX < (windowLeft - safeMargin) ||
      screenY < (windowTop - safeMargin) ||
      screenX > (windowRight + safeMargin) ||
      screenY > (windowBottom + safeMargin)
    )
  }

  /**
   * 初始化画布左键拖拽。
   * 处理流程：
   * 1、记录起始指针与时间并重置拖拽状态。
   * 2、等待跟随画布挂载，绘制裁剪预览。
   * 3、注册移动与退出监听并异步准备导出数据。
   */
  const handleCanvasMouseDown = async (event) => {
    // 1、仅响应鼠标左键，初始化本次拖拽运行数据。
    if (event.button !== 0) return
    try {
      event.preventDefault()

      setDragRuntime({
        dragStartTime: Date.now(),
        dragStartX: event.clientX,
        dragStartY: event.clientY,
        outsideConsecutiveCount: 0,
        outsideFirstTs: 0
      })
      isDragging.value = true
      hasTriggeredSystemDrag.value = false
      isNearBoundary.value = false

      dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
      dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y

      // 2、等待跟随预览画布出现，再绘制拖拽快照。
      await nextTick()

      try {

        const sourceCanvas = resolveSourceCanvas({ cacheTrimmed: true })

        if (dragFollowCanvas.value && sourceCanvas) {

          drawDragPreview(dragFollowCanvas.value, sourceCanvas)

          dragCalibration.value = { dx: 150 / 2, dy: 120 / 2 + 15 }

        }

      } catch (error) {

        console.error('预览图加载失败:', error)

        dragCalibration.value = { dx: 75, dy: 75 }

      }

      // 3、监听本次拖拽并提前准备系统拖拽所需图片。
      document.addEventListener('mousemove', handleMouseMoveForDrag, { passive: false })
      document.addEventListener('mouseup', handleMouseUpForDrag, { once: true })

      updateWindowBounds()
      window.addEventListener('mouseout', handleWindowMouseOut)

      // 🚀 性能优化：在后台异步预缓存拖拽数据，避免触发系统拖拽时卡顿
      prepareDragDataAsync().catch(err => console.warn('预缓存失败:', err))
    } catch (error) {
      console.error('混合拖拽初始化失败:', error)
      isDragging.value = false
    }
  }

  /**
   * 处理一次合并后的拖拽指针移动。
   * 处理流程：
   * 1、更新跟随位置并验证距离与时长阈值。
   * 2、累计窗口外的持续时间和次数。
   * 3、满足越界条件后停止页面监听并切换系统拖拽。
   */
  const processPointerMove = ({ clientX, clientY, screenX, screenY }) => {
    // 1、仅处理尚未移交系统的拖拽。
    if (!isDragging.value || hasTriggeredSystemDrag.value) return
    try {
      dragMouseX.value = clientX + FOLLOW_OFFSET_X
      dragMouseY.value = clientY + FOLLOW_OFFSET_Y

      const { dragStartX, dragStartY, dragStartTime } = getDragRuntime()
      const deltaX = clientX - dragStartX
      const deltaY = clientY - dragStartY
      const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      if (dragDistance < 5) return

      const dragDuration = Date.now() - dragStartTime
      if (dragDuration < MIN_DRAG_TIME_MS) {
        const isFastDrag = dragDistance > 50 && dragDuration > 50
        if (!isFastDrag) return
      }

      // 2、连续越界才累计触发条件，回到窗口时重置计数。
      const outsideNow = checkMouseOutsideWindow(screenX, screenY, OUTSIDE_SAFE_MARGIN)
      if (outsideNow) {
        const now = Date.now()
        let { outsideConsecutiveCount, outsideFirstTs } = getDragRuntime()
        if (outsideConsecutiveCount === 0) outsideFirstTs = now
        outsideConsecutiveCount += 1
        const outsideDuration = now - outsideFirstTs
        isNearBoundary.value = true

        if (outsideConsecutiveCount >= OUTSIDE_COUNT_THRESHOLD && outsideDuration >= OUTSIDE_DURATION_MS) {
          // 3、锁定本次移交并取消后续页面移动更新。
          hasTriggeredSystemDrag.value = true
          window.removeEventListener('mouseout', handleWindowMouseOut)
          document.removeEventListener('mousemove', handleMouseMoveForDrag)
          cancelDragMoveFrame()
          setTimeout(async () => {
            await triggerSystemDrag()
            setTimeout(() => { isDragging.value = false }, 50)
          }, 10)
          setDragRuntime({ outsideConsecutiveCount: 0 })
          return
        }
        setDragRuntime({ outsideConsecutiveCount, outsideFirstTs })
      } else {
        setDragRuntime({ outsideConsecutiveCount: 0 })
        isNearBoundary.value = false
      }
    } catch (error) {
      console.error('拖拽移动处理失败:', error)
    }
  }

  /**
   * 将密集鼠标移动合并到动画帧处理。
   * 处理流程：
   * 1、保存最新指针坐标。
   * 2、每帧最多调用一次拖拽位置处理。
   */
  const handleMouseMoveForDrag = (event) => {
    // 1、丢弃无效拖拽状态，仅缓存最新移动数据。
    if (!isDragging.value || hasTriggeredSystemDrag.value) return
    pendingMoveEvent = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY
    }
    // 2、已有待执行帧时复用该帧，避免重复调度。
    if (dragMoveRaf) return
    dragMoveRaf = requestAnimationFrame(() => {
      dragMoveRaf = null
      const payload = pendingMoveEvent
      pendingMoveEvent = null
      if (payload) {
        processPointerMove(payload)
      }
    })
  }

  /**
   * 在鼠标释放时结束页面拖拽。
   * 处理流程：
   * 1、调用统一拖拽清理入口。
   */
  const handleMouseUpForDrag = () => {
    // 1、清理状态、监听和图片缓存。
    cleanupDrag()
  }

  /**
   * 在指针离开窗口时判断是否启动系统拖拽。
   * 处理流程：
   * 1、检查拖拽时长、退出目标和窗口外坐标。
   * 2、累计越界条件，满足阈值后停止页面监听并移交系统。
   */
  const handleWindowMouseOut = (event) => {
    // 1、过滤窗口内部元素切换及尚未形成拖拽的退出事件。
    if (!isDragging.value || hasTriggeredSystemDrag.value) return

    const { dragStartTime } = getDragRuntime()
    const dragDuration = Date.now() - dragStartTime

    const deltaX = event.screenX - (windowBounds.value.x + windowBounds.value.width / 2)
    const deltaY = event.screenY - (windowBounds.value.y + windowBounds.value.height / 2)
    const distanceFromCenter = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    const isFastExit = distanceFromCenter > 100 && dragDuration > 50
    if (dragDuration < MIN_DRAG_TIME_MS && !isFastExit) return

    const toEl = event.relatedTarget || event.toElement
    if (toEl !== null) return

    const isOutsideNow = checkMouseOutsideWindow(event.screenX, event.screenY)
    if (!isOutsideNow) return

    // 2、对真实越界累计次数与持续时间，避免边界抖动触发。
    const now = Date.now()
    let { outsideConsecutiveCount, outsideFirstTs, dragStartTime: ds } = getDragRuntime()
    if (outsideConsecutiveCount === 0) outsideFirstTs = now
    outsideConsecutiveCount += 1
    const outsideDuration = now - outsideFirstTs
    const totalDragDuration = now - ds
    const isFastDrag = totalDragDuration < MIN_DRAG_TIME_MS
    const requiredDuration = isFastDrag ? 10 : OUTSIDE_DURATION_MS
    const requiredCount = OUTSIDE_COUNT_THRESHOLD
    if (outsideConsecutiveCount < requiredCount || outsideDuration < requiredDuration) {
      return
    }

    hasTriggeredSystemDrag.value = true
    window.removeEventListener('mouseout', handleWindowMouseOut)
    document.removeEventListener('mousemove', handleMouseMoveForDrag)
    setTimeout(async () => {
      await triggerSystemDrag()
      setTimeout(() => { isDragging.value = false }, 50)
    }, 10)
    setDragRuntime({ outsideConsecutiveCount: 0 })
  }

  /**
   * 发起系统拖拽并展示可理解的失败信息。
   * 处理流程：
   * 1、准备文件并调用系统拖拽入口。
   * 2、失败时结合缓存数据生成诊断提示。
   */
  const triggerSystemDrag = async () => {
    // 1、等待数据落盘和主进程拖拽结果。
    try {
      const result = await createTempFileAndDrag()
      // 2、使用本次数据准备情况补充失败原因。
      if (!(result && result.success)) {
        const errorContext = {
          base64Length: cachedDragData?.base64?.length || 0,
          hasIconPayload: !!cachedDragData?.iconPayload,
          suggestedName: buildSuggestedFileName?.()
        }
        console.error('❌ 画布拖拽失败:', {
          error: result?.error,
          ...errorContext
        })

        const friendlyError = formatDragError(result?.error, errorContext)
        deps.message?.error?.(friendlyError)
      }
    } catch (error) {
      const errorContext = {
        base64Length: cachedDragData?.base64?.length || 0,
        hasIconPayload: !!cachedDragData?.iconPayload,
        suggestedName: buildSuggestedFileName?.()
      }
      console.error('系统拖拽切换失败:', error, errorContext)

      const friendlyError = formatDragError(error.message || error, errorContext)
      deps.message?.error?.(friendlyError)
    }
  }

  /**
   * 准备图片及输出配置后调用主进程拖拽。
   * 处理流程：
   * 1、优先复用缓存，否则实时编码裁剪后的画布。
   * 2、整理文件名、PSD 分组和重名保存策略。
   * 3、调用系统拖拽接口，失败时尝试保存图片并复制路径。
   */
  const createTempFileAndDrag = async () => {
    // 1、检查画布并取得图片与图标数据。
    try {
      if (!canvasRef.value) {
        return { success: false, error: '画布未初始化' }
      }

      let base64, iconPayload

      // 🚀 性能优化：优先使用预缓存的数据
      if (cachedDragData && cachedDragData.base64) {
        console.log('⚡ 使用预缓存的拖拽数据，跳过转换步骤')
        base64 = cachedDragData.base64
        iconPayload = cachedDragData.iconPayload
      } else {
        // 降级方案：如果没有缓存，实时转换（可能会卡顿）
        console.warn('⚠️ 未找到预缓存数据，执行实时转换（可能卡顿）')
        let sourceCanvas = canvasRef.value
        if (deps.enableTrimWhitespace?.value === 'trim') {
          sourceCanvas = trimWhitespace(canvasRef.value)
        } else if (deps.enableTrimWhitespace?.value === 'trim-horizontal') {
          sourceCanvas = trimWhitespaceHorizontal(canvasRef.value)
        }

        const blob = await new Promise(resolve => sourceCanvas.toBlob(resolve, 'image/png', 1.0))
        if (!blob) return { success: false, error: '无法创建Blob对象' }

        const buffer = await blob.arrayBuffer()
        /**
         * 将图片字节分块转换为 Base64。
         * 处理流程：
         * 1、分块拼接二进制字符串，避免一次展开过多参数。
         * 2、编码并返回字符串。
         */
        const arrayBufferToBase64 = (buf) => {
          // 1、限制每次字节展开的数量。
          const bytes = new Uint8Array(buf)
          const chunkSize = 0x8000
          let binary = ''
          for (let i = 0; i < bytes.length; i += chunkSize) {
            const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
            binary += String.fromCharCode.apply(null, subArray)
          }
          // 2、将完整二进制字符串转换为编码内容。
          return btoa(binary)
        }
        base64 = arrayBufferToBase64(buffer)

        iconPayload = null
        try {
          if (dragFollowCanvas.value) {
            const dataURL = dragFollowCanvas.value.toDataURL('image/png')
            iconPayload = { dataURL, size: 115 }
          }
        } catch {}
      }

      // 2、合并保存设置，并保留完整 PSD 主名用于目录分组。
      const suggestedName = buildSuggestedFileName()

      let stickfigureConfig = {}
      try {
        const savedConfig = localStorage.getItem('stickfigure-config')
        if (savedConfig) {
          stickfigureConfig = JSON.parse(savedConfig)
        }
      } catch {}

      // 确保 createPsdFolder 有默认值
      if (stickfigureConfig.createPsdFolder === undefined) {
        stickfigureConfig.createPsdFolder = true
      }

      if (controlPriority?.value === 'layerTree') {
        stickfigureConfig = { ...stickfigureConfig, forceRename: true }
      }

      // 添加PSD原始名称，避免路径截断问题
      if (deps.currentPsdFile?.value?.name) {
        const psdNameRaw = deps.currentPsdFile.value.name
        let psdBaseName = psdNameRaw.replace(/\.(psd|PSD)$/, '')

        // 提前清理特殊符号，确保文件夹名称合法
        // 不允许的字符: \ / : * ? " < > |
        psdBaseName = psdBaseName
          .replace(/[\\/:*?"<>|]/g, '_')  // 替换非法字符为下划线
          .replace(/[\s]+/g, '_')         // 替换连续空格为单个下划线
          .replace(/_+/g, '_')            // 合并多个下划线为一个
          .replace(/^_+|_+$/g, '')        // 去除首尾下划线
          .replace(/\.+$/g, '')           // 去除尾部的点号（Windows不允许）

        stickfigureConfig.psdBaseName = psdBaseName
      }

      console.log('🎯 拖拽保存配置:', stickfigureConfig)
      console.log('📊 数据准备情况:', {
        base64Length: base64?.length || 0,
        hasIconPayload: !!iconPayload,
        iconDataURLLength: iconPayload?.dataURL?.length || 0,
        suggestedName,
        fromCache: !!cachedDragData
      })

      // 3、优先使用专用桥接接口，再兼容通用调用入口。
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
        result = { success: false, error: 'electronAPI unavailable' }
      }

      // 降级方案：如果主方法失败，尝试备用方法
      if (!(result && result.success)) {
        try {
          const fallback = await window.electronAPI?.saveDragImageAndCopy?.(base64, iconPayload, stickfigureConfig)
          if (fallback && fallback.success) {
            await window.electronAPI?.copyToClipboard?.(fallback.filePath)
          }
        } catch {}
      }

      return result
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 清理当前页面拖拽状态。
   * 处理流程：
   * 1、重置拖拽标记和越界计数，移除页面监听。
   * 2、清空图片缓存。
   */
  const cleanupDrag = () => {
    // 1、释放本次交互使用的状态和监听器。
    isDragging.value = false
    hasTriggeredSystemDrag.value = false
    isNearBoundary.value = false
    resetOutsideCounters()
    document.removeEventListener('mousemove', handleMouseMoveForDrag)
    document.removeEventListener('mouseup', handleMouseUpForDrag)
    window.removeEventListener('mouseout', handleWindowMouseOut)

    // 2、清除拖拽数据缓存。
    clearDragDataCache()
  }

  /**
   * 在系统拖拽完成后复制输出路径。
   * 处理流程：
   * 1、检查返回路径，稍后写入系统剪贴板。
   */
  const handleDragFinished = async (payload) => {
    // 1、等待系统拖拽收尾后再更新剪贴板。
    try {
      const filePath = payload?.filePath
      if (!filePath) return
      setTimeout(async () => {
        try {
          await window.electronAPI?.copyToClipboard?.(filePath)
        } catch {}
      }, 100)
    } catch (e) {
      // 忽略结束通知中的辅助复制异常。
    }
  }

  // 3、暴露页面事件入口及系统拖拽协作方法。
  return {
    handleCanvasMouseDown,
    handleMouseMoveForDrag,
    handleMouseUpForDrag,
    handleWindowMouseOut,
    triggerSystemDrag,
    createTempFileAndDrag,
    cleanupDrag,
    handleDragFinished
  }
}
