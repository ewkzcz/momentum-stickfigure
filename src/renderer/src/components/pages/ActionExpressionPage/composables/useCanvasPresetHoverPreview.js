/** 主画布及预设悬浮预览：维护两种浮层状态，保留原有快照、裁边、缩放及鼠标定位处理。 */
import { reactive } from 'vue'
import { trimWhitespace } from '../utils/canvasUtils.js'

/**
 * 创建主画布和预设悬浮预览的状态与处理器。
 * 处理流程：
 * 1、持有页面传入的画布和开关原始引用，创建两种浮层状态
 * 2、保留各自的快照、异步图片加载、缩放和定位流程
 * 3、返回状态及原处理器，开关监听仍由页面注册
 */
export function useCanvasPresetHoverPreview({ canvasRef, enableCanvasHover, enablePresetHover }) {
  // 1、每种浮层仅维护一个响应式对象，不复制画布或配置状态。
  const hoverPreview = reactive({ visible: false, src: '', x: 0, y: 0, width: 0, height: 0 })
  const presetHoverPreview = reactive({
    visible: false,
    src: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0
  })

  // 2、主画布与预设各自保留原处理流程，不合并裁边、缩放或定位算法。
  /**
   * 获取当前画布的 PNG 快照。
   * 处理流程：
   * 1、检查画布尺寸并编码，缺失或失败时返回空字符串
   */
  const buildCanvasDataUrl = () => {
    // 1、仅对有效画布导出快照，编码异常交由调用方按空值处理
    try {
      const canvas = canvasRef.value
      if (!canvas || !canvas.width || !canvas.height) return ''
      // 2、保留当前画布的无损像素内容并编码为 PNG
      return canvas.toDataURL('image/png')
    } catch (e) {
      console.warn('预览快照失败:', e)
      return ''
    }
  }

  /**
   * 创建主画布的悬浮预览。
   * 处理流程：
   * 1、检查开关并复制画布，裁除透明留白
   * 2、按窗口限制缩放预览尺寸
   * 3、显示预览并更新鼠标附近的位置
   */
  const handleCanvasHoverEnter = (event) => {
    // 1、开关关闭或画布未就绪时跳过快照
    if (!enableCanvasHover.value) return
    if (!canvasRef.value) return

    try {
      // 2、创建临时画布并复制原始像素
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = canvasRef.value.width
      tempCanvas.height = canvasRef.value.height
      const tempCtx = tempCanvas.getContext('2d')
      tempCtx.drawImage(canvasRef.value, 0, 0)

      // 3、裁剪空白像素并编码为 PNG
      const trimmed = trimWhitespace(tempCanvas)
      const dataUrl = trimmed.toDataURL('image/png')

      // 4、计算缩放后的尺寸，保持宽高比
      const maxWidth = Math.min(window.innerWidth * 0.5, 800)
      const maxHeight = Math.min(window.innerHeight * 0.7, 600)

      let width = trimmed.width
      let height = trimmed.height

      // 5、按比例约束宽度，再约束高度
      if (width > maxWidth) {
        height = (maxWidth / width) * height
        width = maxWidth
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width
        height = maxHeight
      }

      // 6、提交预览数据并定位浮层
      hoverPreview.src = dataUrl
      hoverPreview.visible = true
      hoverPreview.width = width
      hoverPreview.height = height

      handleCanvasHoverMove(event)
    } catch (error) {
      console.error('生成画布预览失败:', error)
    }
  }

  /**
   * 更新主画布悬浮预览的位置。
   * 处理流程：
   * 1、读取预览尺寸并计算鼠标偏移位置
   * 2、约束窗口边界后写入浮层坐标
   */
  const handleCanvasHoverMove = (event) => {
    // 1、隐藏时无需更新位置
    if (!hoverPreview.visible) return

    const gap = 12
    const width = hoverPreview.width || 400
    const height = hoverPreview.height || 300

    // 2、计算鼠标右下方的候选位置
    let x = event.clientX + gap
    let y = event.clientY + gap

    // 3、如果右侧空间不足，显示在左侧，再约束其他边界
    if (x + width > window.innerWidth - 8) {
      x = event.clientX - width - gap
    }

    // 4、如果下方空间不足，向上调整
    if (y + height > window.innerHeight - 8) {
      y = window.innerHeight - height - 8
    }

    // 5、确保不超出左侧和顶部，再提交浮层坐标
    x = Math.max(8, x)
    y = Math.max(8, y)

    hoverPreview.x = x
    hoverPreview.y = y
  }

  /**
   * 隐藏主画布悬浮预览。
   * 处理流程：
   * 1、关闭浮层显示状态
   */
  const handleCanvasHoverLeave = () => {
    // 1、保留快照数据，仅隐藏浮层
    hoverPreview.visible = false
  }

  /**
   * 加载预设图片并展示悬浮预览。
   * 处理流程：
   * 1、检查预览开关和图片数据，再开始加载
   * 2、裁除留白并按窗口限制缩放图片
   * 3、写入预览状态并定位浮层
   */
  const handlePresetHoverEnter = (event, preset) => {
    // 1、无图片或开关关闭时不触发预览
    if (!enablePresetHover.value) return
    if (!preset.base64Image) return

    // 2、创建图片并保留异步加载处理
    const img = new Image()
    /**
     * 处理已加载的预设图片。
     * 处理流程：
     * 1、复制图片并裁边，按窗口限制计算尺寸
     * 2、写入预览状态并按原鼠标事件定位
     */
    img.onload = () => {
      try {
        // 1、通过临时画布复制图片像素
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = img.width
        tempCanvas.height = img.height
        const tempCtx = tempCanvas.getContext('2d')
        tempCtx.drawImage(img, 0, 0)

        // 2、裁剪空白像素并编码为 PNG
        const trimmed = trimWhitespace(tempCanvas)
        const dataUrl = trimmed.toDataURL('image/png')

        // 3、计算缩放后的尺寸，保持宽高比
        const maxWidth = Math.min(window.innerWidth * 0.5, 800)
        const maxHeight = Math.min(window.innerHeight * 0.7, 600)

        let width = trimmed.width
        let height = trimmed.height

        // 4、按比例约束宽度，再约束高度
        if (width > maxWidth) {
          height = (maxWidth / width) * height
          width = maxWidth
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width
          height = maxHeight
        }

        // 5、提交预览图片及尺寸，按鼠标位置显示
        presetHoverPreview.src = dataUrl
        presetHoverPreview.visible = true
        presetHoverPreview.width = width
        presetHoverPreview.height = height

        handlePresetHoverMove(event)
      } catch (error) {
        console.error('生成预设预览失败:', error)
      }
    }
    // 3、设置原预设图片地址，触发异步加载
    img.src = preset.base64Image
  }

  /**
   * 让预设悬浮预览跟随鼠标。
   * 处理流程：
   * 1、计算鼠标右下方的候选坐标
   * 2、修正窗口边界后更新浮层位置
   */
  const handlePresetHoverMove = (event) => {
    // 1、读取浮层尺寸并确定候选位置
    if (!presetHoverPreview.visible) return

    const gap = 12
    const width = presetHoverPreview.width || 400
    const height = presetHoverPreview.height || 300

    // 2、计算鼠标右下方的候选位置
    let x = event.clientX + gap
    let y = event.clientY + gap

    // 3、修正右侧边界，空间不足时显示在左侧
    if (x + width > window.innerWidth - 8) {
      x = event.clientX - width - gap
    }

    // 4、如果下方空间不足，向上调整
    if (y + height > window.innerHeight - 8) {
      y = window.innerHeight - height - 8
    }

    // 5、确保不超出左侧和顶部，再提交浮层坐标
    x = Math.max(8, x)
    y = Math.max(8, y)

    presetHoverPreview.x = x
    presetHoverPreview.y = y
  }

  /**
   * 关闭预设悬浮预览。
   * 处理流程：
   * 1、将预设浮层设为隐藏
   */
  const handlePresetHoverLeave = () => {
    // 1、隐藏当前预设浮层
    presetHoverPreview.visible = false
  }

  // 3、保留未使用的快照入口，返回原状态与处理器供页面接入。
  return {
    hoverPreview,
    presetHoverPreview,
    buildCanvasDataUrl,
    handleCanvasHoverEnter,
    handleCanvasHoverMove,
    handleCanvasHoverLeave,
    handlePresetHoverEnter,
    handlePresetHoverMove,
    handlePresetHoverLeave
  }
}
