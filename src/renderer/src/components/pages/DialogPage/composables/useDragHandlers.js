/** 对话图片拖拽处理：连接页面浮层拖动、越界判断与主进程文件拖出。 */
import { nextTick } from 'vue'

/**
 * 对话框插件拖拽核心逻辑（事件处理与系统拖拽协作）
 * 基于 ActionExpressionPage 的混合拖拽功能
 * 处理流程：1、接入状态与平台依赖；2、定义页面及系统拖拽操作；3、返回事件处理接口。
 */
export function useDragHandlers({
  state,
  constants,
  deps
}) {
  // 1、复用传入状态、阈值和窗口操作，保持页面与系统拖拽协作。
  const {
    isDragging,
    dragFollowPreview,
    dragFollowCanvas,
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
    message,
    buildSuggestedFileName
  } = deps

  // 2、定义拖拽过程的越界检测、图像保存及清理操作。
  /**
   * 判断屏幕坐标是否越过窗口安全边界。
   * 处理流程：1、计算窗口四边；2、比较包含容差的外部区域。
   */
  const checkMouseOutsideWindow = (screenX, screenY, safeMargin = OUTSIDE_SAFE_MARGIN) => {
    // 1、使用主进程提供的屏幕坐标边界。
    const bounds = windowBounds.value
    const windowLeft = bounds.x
    const windowTop = bounds.y
    const windowRight = bounds.x + bounds.width
    const windowBottom = bounds.y + bounds.height
    // 2、任一方向超出安全边距即认为越界。
    return (
      screenX < (windowLeft - safeMargin) ||
      screenY < (windowTop - safeMargin) ||
      screenX > (windowRight + safeMargin) ||
      screenY > (windowBottom + safeMargin)
    )
  }

  /**
   * 开始对话图片拖拽。
   * 处理流程：1、限制左键操作；2、初始化运行时状态；3、生成跟随预览；4、注册拖拽事件。
   */
  const handleImageMouseDown = async (event, canvas) => {
    // 1、忽略右键和中键按下。
    if (event.button !== 0) return
    try {
      event.preventDefault()

      // 2、记录起点与时间，并清空上一轮越界状态。
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

      // 临时保存当前画布引用
      deps.currentCanvas = canvas

      // 3、等待浮层挂载后绘制缩略图，并校准鼠标相对偏移。
      await nextTick()
      try {
        if (dragFollowCanvas.value && canvas) {
          // 绘制预览
          const ctx = dragFollowCanvas.value.getContext('2d')
          const maxWidth = 150
          const scale = Math.min(maxWidth / canvas.width, 1)
          dragFollowCanvas.value.width = canvas.width * scale
          dragFollowCanvas.value.height = canvas.height * scale
          ctx.imageSmoothingEnabled = false
          ctx.drawImage(canvas, 0, 0, dragFollowCanvas.value.width, dragFollowCanvas.value.height)
          dragCalibration.value = { dx: dragFollowCanvas.value.width / 2, dy: dragFollowCanvas.value.height / 2 + 15 }
        }
      } catch (error) {
        console.error('预览图绘制失败:', error)
        dragCalibration.value = { dx: 75, dy: 75 }
      }

      // 4、注册文档级拖拽事件，并同步原生窗口边界。
      document.addEventListener('mousemove', handleMouseMoveForDrag, { passive: false })
      document.addEventListener('mouseup', handleMouseUpForDrag, { once: true })

      updateWindowBounds()
      window.addEventListener('mouseout', handleWindowMouseOut)
    } catch (error) {
      console.error('混合拖拽初始化失败:', error)
      isDragging.value = false
    }
  }

  /**
   * 跟随鼠标移动并在稳定越界后启动系统拖拽。
   * 处理流程：1、更新预览位置；2、过滤短距离和短时移动；3、累计越界时间与次数；4、满足条件后移交系统。
   */
  const handleMouseMoveForDrag = (event) => {
    // 1、系统尚未接管时更新页面拖拽浮层。
    if (!isDragging.value || hasTriggeredSystemDrag.value) return
    try {
      dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
      dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y

      // 2、过滤点击抖动，允许满足距离条件的快速拖动。
      const { dragStartX, dragStartY, dragStartTime } = getDragRuntime()
      const deltaX = event.clientX - dragStartX
      const deltaY = event.clientY - dragStartY
      const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
      if (dragDistance < 5) return

      const dragDuration = Date.now() - dragStartTime
      if (dragDuration < MIN_DRAG_TIME_MS) {
        const isFastDrag = dragDistance > 50 && dragDuration > 50
        if (!isFastDrag) return
      }

      // 3、连续越界才累计确认时间，回到窗口时清零次数。
      const outsideNow = checkMouseOutsideWindow(event.screenX, event.screenY, OUTSIDE_SAFE_MARGIN)
      if (outsideNow) {
        const now = Date.now()
        let { outsideConsecutiveCount, outsideFirstTs } = getDragRuntime()
        if (outsideConsecutiveCount === 0) outsideFirstTs = now
        outsideConsecutiveCount += 1
        const outsideDuration = now - outsideFirstTs
        isNearBoundary.value = true

        // 4、达到次数和持续时间阈值后，先停止页面监听再发起原生拖拽。
        if (outsideConsecutiveCount >= OUTSIDE_COUNT_THRESHOLD && outsideDuration >= OUTSIDE_DURATION_MS) {
          hasTriggeredSystemDrag.value = true
          window.removeEventListener('mouseout', handleWindowMouseOut)
          document.removeEventListener('mousemove', handleMouseMoveForDrag)
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
      console.error('混合拖拽移动处理失败:', error)
    }
  }

  /**
   * 结束鼠标释放对应的页面拖拽。
   * 处理流程：1、统一清理状态和事件监听。
   */
  const handleMouseUpForDrag = () => {
    // 1、复用统一清理入口。
    cleanupDrag()
  }

  /**
   * 通过窗口移出事件补充越界确认。
   * 处理流程：1、过滤未开始或已接管状态；2、判断真实移出与速度；3、确认越界阈值；4、移交系统拖拽。
   */
  const handleWindowMouseOut = (event) => {
    // 1、只处理页面拖拽仍在进行的移出事件。
    if (!isDragging.value || hasTriggeredSystemDrag.value) return

    // 2、根据持续时间和离窗口中心距离允许快速移出，并排除元素之间移动。
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

    // 3、应用越界次数及持续时间阈值，快速拖动使用较短确认时间。
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

    // 4、避免重复接管，关闭页面监听后异步发起系统拖拽。
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
   * 发起系统拖拽并显示保存失败信息。
   * 处理流程：1、创建文件并拖出；2、统一反馈失败响应或异常。
   */
  const triggerSystemDrag = async () => {
    // 1、等待主进程文件保存和拖拽请求结果。
    try {
      const result = await createTempFileAndDrag()
      // 2、将失败响应转成页面提示。
      if (!(result && result.success)) {
        deps.message?.error?.('图片保存失败: ' + (result?.error || '未知错误'))
      }
    } catch (error) {
      console.error('系统拖拽切换失败:', error)
      deps.message?.error?.('拖拽失败: ' + error.message)
    }
  }

  /**
   * 导出当前画布并请求系统文件拖拽。
   * 处理流程：1、校验并编码画布；2、准备预览和命名；3、加载导出配置；4、请求原生拖拽；5、失败时尝试保存复制。
   */
  const createTempFileAndDrag = async () => {
    // 1、把当前拖拽源画布转换为可跨进程传递的 PNG 数据。
    try {
      const sourceCanvas = deps.currentCanvas
      if (!sourceCanvas) {
        return { success: false, error: '画布未初始化' }
      }
      
      return new Promise((resolve) => {
        sourceCanvas.toBlob(async (blob) => {
          if (!blob) return resolve({ success: false, error: '无法创建Blob对象' })
          try {
            const buffer = await blob.arrayBuffer()
            /**
             * 将画布二进制数据编码为 Base64。
             * 处理流程：1、分块拼接字节；2、编码为文本载荷。
             */
            const arrayBufferToBase64 = (buf) => {
              // 1、分块展开字节，避免超出单次函数参数数量限制。
              const bytes = new Uint8Array(buf)
              const chunkSize = 0x8000
              let binary = ''
              for (let i = 0; i < bytes.length; i += chunkSize) {
                const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
                binary += String.fromCharCode.apply(null, subArray)
              }
              // 2、输出主进程可接收的 Base64 字符串。
              return btoa(binary)
            }
            const base64 = arrayBufferToBase64(buffer)
            
            // 2、准备原生拖拽图标和页面建议文件名。
            let iconPayload = null
            try {
              if (dragFollowCanvas.value) {
                const dataURL = dragFollowCanvas.value.toDataURL('image/png')
                iconPayload = { dataURL, size: 115 }
              }
            } catch {}

            const suggestedName = buildSuggestedFileName()

            // 3、读取对话框导出设置，缺少输出目录时保留默认选择。
            let dialogConfig = {}
            try {
              const savedConfig = localStorage.getItem('dialog-config')
              if (savedConfig) {
                dialogConfig = JSON.parse(savedConfig)
              }
            } catch {}

            // 确保有默认的输出路径
            if (!dialogConfig.outputRoot) {
              dialogConfig.outputRoot = ''
            }

            console.log('🎯 对话框拖拽保存配置:', dialogConfig)

            // 4、优先调用专用桥接方法，兼容通用 IPC 入口。
            let result
            if (window.electronAPI?.createTempFileAndStartDrag) {
              result = await window.electronAPI.createTempFileAndStartDrag(
                base64,
                iconPayload,
                suggestedName,
                dialogConfig
              )
            } else if (window.electronAPI?.invoke) {
              result = await window.electronAPI.invoke(
                'create-temp-file-and-start-drag',
                base64,
                iconPayload,
                suggestedName,
                dialogConfig
              )
            } else {
              result = { success: false, error: 'electronAPI unavailable' }
            }

            // 5、原生拖拽失败时尝试保存图像并复制文件路径。
            if (!(result && result.success)) {
              try {
                const fallback = await window.electronAPI?.saveDragImageAndCopy?.(base64, iconPayload, dialogConfig)
                if (fallback && fallback.success) {
                  await window.electronAPI?.copyToClipboard?.(fallback.filePath)
                }
              } catch {}
            }
            resolve(result)
          } catch (error) {
            resolve({ success: false, error: error.message })
          }
        }, 'image/png', 1.0)
      })
    } catch (error) {
      return { success: false, error: error.message }
    }
  }

  /**
   * 清理本轮页面拖拽。
   * 处理流程：1、恢复状态与计数；2、移除事件监听并释放画布引用。
   */
  const cleanupDrag = () => {
    // 1、清空拖拽标记和越界记录。
    isDragging.value = false
    hasTriggeredSystemDrag.value = false
    isNearBoundary.value = false
    resetOutsideCounters()
    // 2、解除文档与窗口监听，释放当前拖拽源。
    document.removeEventListener('mousemove', handleMouseMoveForDrag)
    document.removeEventListener('mouseup', handleMouseUpForDrag)
    window.removeEventListener('mouseout', handleWindowMouseOut)
    deps.currentCanvas = null
  }

  /**
   * 在原生拖拽结束后复制生成文件路径。
   * 处理流程：1、读取完成事件的路径；2、延迟复制并容忍剪贴板异常。
   */
  const handleDragFinished = async (payload) => {
    // 1、没有生成文件路径时不执行复制。
    try {
      const filePath = payload?.filePath
      if (!filePath) return
      // 2、等待原生拖拽结束后再访问剪贴板。
      setTimeout(async () => {
        try {
          await window.electronAPI?.copyToClipboard?.(filePath)
        } catch {}
      }, 100)
    } catch (e) {
      // 剪贴板补充操作失败不影响已经完成的文件拖拽。
    }
  }

  // 3、向页面暴露事件绑定与清理入口。
  return {
    handleImageMouseDown,
    handleMouseMoveForDrag,
    handleMouseUpForDrag,
    handleWindowMouseOut,
    triggerSystemDrag,
    createTempFileAndDrag,
    cleanupDrag,
    handleDragFinished
  }
}
