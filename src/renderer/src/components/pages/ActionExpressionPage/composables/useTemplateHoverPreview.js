/** 模板悬浮预览：唯一维护浮层状态，保留原异步加载顺序、隐藏延迟和边界计算。 */
import { reactive } from 'vue'

/**
 * 创建模板悬浮预览。
 * 处理流程：
 * 1、创建唯一浮层与延迟隐藏状态。
 * 2、按原顺序加载预览、定位浮层及延迟隐藏。
 * 3、返回原页面使用的状态与处理器；后方初始化的数据在事件触发时读取。
 */
export function useTemplateHoverPreview({ enablePresetHover, getTemplatePreview, getActiveTemplateType }) {
  // 1、只在本模块维护浮层状态，模板数据仍由原数据模块维护。
  const templateHoverPreview = reactive({
    visible: false,
    src: '',
    x: 0,
    y: 0,
    width: 0,
    height: 0
  })
  let templateHoverTimer = null
  let currentHoverTemplateId = null

  /**
   * 获取模板预览并显示悬浮图片。
   * 处理流程：
   * 1、检查开关并清理隐藏定时器，同一模板直接更新位置。
   * 2、按模板自身类型获取预览图。
   * 3、图片加载后检查悬停目标，缩放并显示浮层。
   */
  const handleTemplateHoverEnter = async (event, template) => {
    // 1、检查开关，取消尚未执行的隐藏操作。
    if (!enablePresetHover.value) return
    if (templateHoverTimer) {
      clearTimeout(templateHoverTimer)
      templateHoverTimer = null
    }
    if (currentHoverTemplateId === template.id && templateHoverPreview.visible) {
      handleTemplateHoverMove(event)
      return
    }
    currentHoverTemplateId = template.id

    // 2、优先使用模板自身类型，缺失时才读取当前活动类型。
    // 延迟取得预览函数，避免模块创建时访问父页面尚未初始化的绑定。
    const templateType = template.templateType || getActiveTemplateType()
    const base64Data = await getTemplatePreview()(template.id, templateType)
    if (!base64Data) {
      console.log('⚠️ 模板无预览图:', template.name)
      return
    }

    try {
      const img = new Image()
      // 保留原先先设置 src、再绑定 onload 的顺序，不在职责迁移中改变加载时序。
      img.src = base64Data
      img.onload = () => {
        // 3、检查是否仍悬停同一模板，避免异步结果覆盖新目标。
        if (currentHoverTemplateId !== template.id) {
          return
        }
        let width = img.width
        let height = img.height
        const maxWidth = Math.min(window.innerWidth * 0.5, 800)
        const maxHeight = Math.min(window.innerHeight * 0.7, 600)

        // 按原比例缩放到窗口允许的范围。
        if (width > maxWidth) {
          height = (maxWidth / width) * height
          width = maxWidth
        }
        if (height > maxHeight) {
          width = (maxHeight / height) * width
          height = maxHeight
        }
        templateHoverPreview.src = base64Data
        templateHoverPreview.visible = true
        templateHoverPreview.width = width
        templateHoverPreview.height = height
        handleTemplateHoverMove(event)
      }
    } catch (error) {
      console.error('生成模板预览失败:', error)
    }
  }

  /**
   * 更新模板浮层的鼠标跟随位置。
   * 处理流程：
   * 1、读取浮层尺寸并计算候选坐标。
   * 2、约束窗口边界并提交位置。
   */
  const handleTemplateHoverMove = (event) => {
    // 1、隐藏时跳过定位，显示时使用当前图片尺寸。
    if (!templateHoverPreview.visible) return
    const gap = 12
    const width = templateHoverPreview.width || 400
    const height = templateHoverPreview.height || 300
    let x = event.clientX + gap
    let y = event.clientY + gap

    // 2、右侧不足时放左侧，下方不足时向上调整，再限制左上边界。
    if (x + width > window.innerWidth - 8) {
      x = event.clientX - width - gap
    }
    if (y + height > window.innerHeight - 8) {
      y = window.innerHeight - height - 8
    }
    x = Math.max(8, x)
    y = Math.max(8, y)
    templateHoverPreview.x = x
    templateHoverPreview.y = y
  }

  /**
   * 延迟关闭模板悬浮预览。
   * 处理流程：
   * 1、替换已有隐藏定时器。
   * 2、延迟清理浮层及当前模板标识，减少子元素切换闪烁。
   */
  const handleTemplateHoverLeave = () => {
    // 1、保留最后一次离开事件对应的隐藏任务。
    if (templateHoverTimer) {
      clearTimeout(templateHoverTimer)
    }
    // 2、保留原 100ms 延迟，不在本次迁移中修改开关和异步加载竞争行为。
    templateHoverTimer = setTimeout(() => {
      templateHoverPreview.visible = false
      currentHoverTemplateId = null
      templateHoverTimer = null
    }, 100)
  }

  // 3、保持父页面模板与开关监听使用的原绑定名称。
  return {
    templateHoverPreview,
    handleTemplateHoverEnter,
    handleTemplateHoverMove,
    handleTemplateHoverLeave
  }
}
