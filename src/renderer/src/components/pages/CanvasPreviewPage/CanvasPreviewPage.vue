<template>
  <div class="canvas-preview-page" :class="`theme-${currentTheme}`">
    <!-- 顶部工具栏 -->
    <div class="toolbar">
      <div class="toolbar-left">
        <n-button 
          size="small"
          :type="isAlwaysOnTop ? 'primary' : 'default'"
          @click="toggleAlwaysOnTop"
          :title="isAlwaysOnTop ? '点击取消置顶' : '点击窗口置顶'"
        >
          {{ isAlwaysOnTop ? '已置顶' : '未置顶' }}
        </n-button>
      </div>
      <div class="toolbar-actions">
        <!-- 缩放控制 -->
        <div v-if="hasImage" class="zoom-controls-inline">
          <n-button size="small" type="primary" @click="zoomOut" title="缩小">
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </template>
          </n-button>
          <div class="zoom-info">{{ zoomPercentage }}%</div>
          <n-button size="small" type="primary" @click="zoomIn" title="放大">
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="8" x2="12" y2="16"/>
                <line x1="8" y1="12" x2="16" y2="12"/>
              </svg>
            </template>
          </n-button>
        </div>
        
        <n-button size="small" type="primary" @click="() => fitToWindow(true)">
          适应窗口
        </n-button>
        <n-button size="small" type="error" @click="closeWindow">
          关闭
        </n-button>
      </div>
    </div>
    
    <!-- 画布容器 -->
    <div 
      class="canvas-container" 
      ref="canvasContainerRef"
      @wheel.prevent="handleWheel"
      @scroll="handleScroll"
    >
      <!-- 空状态容器 -->
      <div v-if="!hasImage" class="empty-wrapper">
        <!-- 空状态：显示透明像素背景暗示没有内容 -->
        <div class="empty-canvas-placeholder"></div>
      </div>
      
      <div v-show="hasImage" class="canvas-wrapper">
        <canvas 
          ref="canvasRef" 
          :style="canvasStyle"
          @mousedown="handleCanvasMouseDown"
          draggable="false"
        ></canvas>
      </div>
    </div>
    
    <!-- 拖拽跟随预览（与主画布一致） -->
    <teleport to="body">
      <div 
        v-if="isDragging"
        class="drag-follow-preview"
        ref="dragFollowPreview"
        :style="{ 
          left: Math.max(0, dragMouseX - dragOffsetX) + 'px',
          top: Math.max(0, dragMouseY - dragOffsetY) + 'px'
        }"
      >
        <canvas 
          ref="dragFollowCanvas" 
          width="170" 
          height="150"  
          style="pointer-events:none; width: 150px; height: 120px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);"
        ></canvas>
      </div>
    </teleport>
  </div>
</template>

<script setup>
/** 独立画布预览页：接收主窗口图像，提供缩放、置顶及系统拖出操作。 */
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { NButton } from 'naive-ui'
import { useTheme } from '../../../utils/composables/useTheme.js'

// 初始化主题（确保预览窗口也能响应主题切换）
const { currentTheme, setTheme } = useTheme()

const canvasRef = ref(null)
const canvasContainerRef = ref(null)
const currentScale = ref(1)
const hasImage = ref(false)
const isAlwaysOnTop = ref(true) // 默认置顶
const currentFileName = ref('预览.png') // 当前文件名

// 用户是否手动调整过缩放（手动调整后不再自动适应窗口）
const userHasAdjustedScale = ref(false)

// 用户是否手动滚动过（手动滚动后不再自动居中）
const userHasScrolled = ref(false)

// 程序化滚动标记（用于区分程序滚动和用户滚动）
const isProgrammaticScroll = ref(false)

// 拖拽相关状态
const isDragging = ref(false)
const dragFollowPreview = ref(null)
const dragFollowCanvas = ref(null)
const dragMouseX = ref(0)
const dragMouseY = ref(0)
const dragOffsetX = ref(75)
const dragOffsetY = ref(60)
let hasTriggeredSystemDrag = false

const zoomPercentage = computed(() => Math.round(currentScale.value * 100))

const canvasStyle = computed(() => ({
  transform: `scale(${currentScale.value})`,
  transformOrigin: 'center',
  imageRendering: 'crisp-edges'
}))

/**
 * 解析主窗口传入的图像并更新画布。
 * 处理流程：1、检查画布；2、归一化图像载荷；3、准备绘图上下文；4、加载绘制并恢复视图；5、启动加载。
 */
const updateCanvas = (imagePayload) => {
  // 1、画布尚未挂载时跳过本次更新。
  if (!canvasRef.value) {
    console.warn('[预览窗口] Canvas引用不存在')
    return
  }
  
  // 2、兼容数据地址和结构化克隆后的二进制载荷，记录临时地址用于释放。
  let imageSource = null
  let revokeUrl = null
  let widthHint = null
  let heightHint = null
  let byteLengthHint = null
  const mimeType = (typeof imagePayload === 'object' && imagePayload?.mimeType) ? imagePayload.mimeType : 'image/png'
  
  try {
    if (typeof imagePayload === 'string') {
      imageSource = imagePayload
      byteLengthHint = imagePayload.length
    } else if (imagePayload && typeof imagePayload === 'object') {
      widthHint = imagePayload.width || null
      heightHint = imagePayload.height || null
      
      if (imagePayload.dataUrl) {
        imageSource = imagePayload.dataUrl
        byteLengthHint = imagePayload.dataUrl.length
      } else if (imagePayload.buffer) {
        let arrayBuffer = null
        if (imagePayload.buffer instanceof ArrayBuffer) {
          arrayBuffer = imagePayload.buffer
        } else if (ArrayBuffer.isView(imagePayload.buffer)) {
          arrayBuffer = imagePayload.buffer.buffer
        } else if (typeof imagePayload.buffer === 'object' && Array.isArray(imagePayload.buffer.data)) {
          arrayBuffer = Uint8Array.from(imagePayload.buffer.data).buffer
        } else if (typeof imagePayload.buffer === 'object' && typeof imagePayload.buffer.byteLength === 'number') {
          // 结构化克隆后的 Node Buffer 可能表现为带 byteLength 的对象
          arrayBuffer = imagePayload.buffer
        }
        
        if (arrayBuffer) {
          const uint8 = arrayBuffer instanceof Uint8Array ? arrayBuffer : new Uint8Array(arrayBuffer)
          byteLengthHint = uint8.byteLength
          const blob = new Blob([uint8], { type: mimeType })
          imageSource = URL.createObjectURL(blob)
          revokeUrl = imageSource
        }
      }
    }
  } catch (error) {
    console.error('[预览窗口] 解析图片数据失败:', error)
  }
  
  if (!imageSource) {
    console.error('[预览窗口] 无法解析图片数据')
    hasImage.value = false
    return
  }
  
  // 3、再次确认画布可用，并创建透明二维绘图上下文。
  const canvas = canvasRef.value
  
  if (!canvas || !canvas.getContext) {
    console.error('[预览窗口] Canvas不可用')
    if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    return
  }
  
  const ctx = canvas.getContext('2d', {
    alpha: true,
    willReadFrequently: false
  })
  
  if (!ctx) {
    console.error('[预览窗口] 无法获取Canvas 2D上下文')
    if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    return
  }
  
  const img = new Image()
  
  img.onerror = (error) => {
    console.error('[预览窗口] 图片加载失败:', error)
    if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    hasImage.value = false
  }
  
  // 4、图像加载后绘制，按用户操作状态决定是否恢复缩放，并释放临时地址。
  img.onload = () => {
    try {
      if (!img.complete || img.naturalWidth === 0 || img.naturalHeight === 0) {
        console.error('[预览窗口] 图片数据无效:', {
          complete: img.complete,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight
        })
        return
      }
      
      if (!canvasRef.value || !ctx) {
        console.error('[预览窗口] Canvas或Context已失效')
        return
      }
      
      const imgWidth = widthHint || img.naturalWidth
      const imgHeight = heightHint || img.naturalHeight
      
      console.log('[预览窗口] 准备渲染图片:', {
        width: imgWidth,
        height: imgHeight,
        sourceType: revokeUrl ? 'blob' : 'dataUrl',
        mimeType,
        byteLength: byteLengthHint ?? 'unknown'
      })
      
      canvas.width = imgWidth
      canvas.height = imgHeight
      ctx.clearRect(0, 0, imgWidth, imgHeight)
      ctx.save()
      
      try {
        ctx.imageSmoothingEnabled = true
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, 0, 0, imgWidth, imgHeight)
        console.log('[预览窗口] ✅ 图片渲染成功')
      } finally {
        ctx.restore()
      }
      
      hasImage.value = true
      
      // 检查是否需要重置视图（切换PSD时）
      if (needResetViewportAfterUpdate.value) {
        console.log('[预览窗口] 检测到重置标记，将在渲染完成后重置视图')
        needResetViewportAfterUpdate.value = false
        // 在渲染动画结束后执行重置
        setTimeout(() => {
          performViewportReset()
        }, 250)
      } else if (!userHasAdjustedScale.value) {
        nextTick(() => {
          fitToWindow(false)
        })
      } else {
        console.log('[预览窗口] 用户已手动调整缩放，保持当前状态')
      }
    } catch (error) {
      console.error('[预览窗口] 渲染图片异常:', error)
      hasImage.value = false
    } finally {
      if (revokeUrl) URL.revokeObjectURL(revokeUrl)
    }
  }
  
  try {
    // 5、设置图像源触发异步加载。
    img.src = imageSource
  } catch (error) {
    console.error('[预览窗口] 设置图片源失败:', error)
    if (revokeUrl) URL.revokeObjectURL(revokeUrl)
  }
}

/**
 * 将完整图像缩放到窗口可用区域。
 * 处理流程：1、验证画布尺寸；2、计算等比缩放；3、处理手动重置标记；4、按用户滚动状态居中。
 * @param {boolean} isManualClick - 是否由适应窗口按钮触发。
 */
const fitToWindow = (isManualClick = false) => {
  // 1、容器或画布尺寸未就绪时暂不计算。
  if (!canvasRef.value || !canvasContainerRef.value) return
  
  const canvas = canvasRef.value
  const container = canvasContainerRef.value
  
  if (!canvas.width || !canvas.height) return
  
  // 2、预留少量边距，使用较小比例保证图像完整显示。
  const padding = 10
  const containerWidth = container.clientWidth - padding
  const containerHeight = container.clientHeight - padding
  
  const scaleX = containerWidth / canvas.width
  const scaleY = containerHeight / canvas.height
  
  // 使用Math.min确保图片完全显示，固定宽高比，至少一个方向填满容器
  currentScale.value = Math.min(scaleX, scaleY)
  
  console.log('📐 [预览窗口] 适应窗口计算:', {
    容器尺寸: `${container.clientWidth}x${container.clientHeight}`,
    画布尺寸: `${canvas.width}x${canvas.height}`,
    缩放X: scaleX.toFixed(2),
    缩放Y: scaleY.toFixed(2),
    最终缩放: currentScale.value.toFixed(2)
  })
  
  // 3、用户主动点击时恢复自动缩放和居中资格。
  if (isManualClick) {
    userHasAdjustedScale.value = false
    userHasScrolled.value = false
    console.log('🔄 [预览窗口] 用户点击"适应窗口"按钮，重置标志')
  }
  
  // 4、仅在用户未手动滚动时居中，避免覆盖用户浏览位置。
  if (!userHasScrolled.value) {
    // 滚动条居中（与主画布缩放模式一致）
    nextTick(() => {
      setTimeout(() => {
        if (canvasContainerRef.value) {
          const container = canvasContainerRef.value
          // 标记为程序化滚动
          isProgrammaticScroll.value = true
          container.scrollLeft = (container.scrollWidth - container.clientWidth) / 2
          container.scrollTop = (container.scrollHeight - container.clientHeight) / 2
          console.log('📍 [预览窗口] 滚动条已居中（适应窗口）')
          // 重置程序化滚动标记
          setTimeout(() => {
            isProgrammaticScroll.value = false
          }, 200)
        }
      }, 50)
    })
  } else {
    console.log('📍 [预览窗口] 用户已手动滚动过，保持当前滚动位置')
  }
}

/**
 * 放大预览图像。
 * 处理流程：1、按比例放大并限制上限；2、记录手动缩放状态。
 */
const zoomIn = () => {
  // 1、限制最大缩放倍数。
  currentScale.value = Math.min(currentScale.value * 1.2, 5)
  // 2、后续图像更新保留当前缩放。
  userHasAdjustedScale.value = true // 标记为手动调整
}

/**
 * 缩小预览图像。
 * 处理流程：1、按比例缩小并限制下限；2、记录手动缩放状态。
 */
const zoomOut = () => {
  // 1、限制最小缩放倍数。
  currentScale.value = Math.max(currentScale.value / 1.2, 0.1)
  // 2、后续图像更新保留当前缩放。
  userHasAdjustedScale.value = true // 标记为手动调整
}

/**
 * 根据滚轮方向调整预览缩放。
 * 处理流程：1、忽略空画布；2、按方向调整比例；3、记录手动操作。
 */
const handleWheel = (e) => {
  // 1、只有存在图像时才响应缩放。
  if (!hasImage.value) return
  
  // 2、根据滚轮方向缩放并约束比例。
  if (e.deltaY < 0) {
    currentScale.value = Math.min(currentScale.value * 1.1, 5)
  } else {
    currentScale.value = Math.max(currentScale.value / 1.1, 0.1)
  }
  
  // 3、标记用户已主动调整缩放。
  userHasAdjustedScale.value = true // 标记为手动调整
}

// 滚动事件处理（检测用户手动滚动）
let scrollTimer = null
/**
 * 检测用户手动滚动。
 * 处理流程：1、忽略空画布及程序滚动；2、防抖更新用户滚动标记。
 */
const handleScroll = () => {
  // 1、只处理存在图像时的用户滚动。
  if (!hasImage.value) return
  
  // 如果是程序化滚动，不标记为手动滚动
  if (isProgrammaticScroll.value) {
    console.log('📍 [预览窗口] 程序化滚动，忽略')
    return
  }
  
  // 2、通过防抖合并滚动事件，避免频繁设置状态。
  if (scrollTimer) {
    clearTimeout(scrollTimer)
  }
  
  scrollTimer = setTimeout(() => {
    // 标记用户已手动滚动
    userHasScrolled.value = true
    console.log('📍 [预览窗口] 检测到用户手动滚动')
  }, 150)
}

/**
 * 切换预览窗口置顶。
 * 处理流程：1、向主进程提交目标状态；2、成功后更新页面标记，失败时记录错误。
 */
const toggleAlwaysOnTop = async () => {
  // 1、计算目标状态并请求原生窗口更新。
  try {
    const newState = !isAlwaysOnTop.value
    const result = await window.electronAPI?.invoke('window-set-always-on-top', newState)
    // 2、以主进程成功响应为准同步按钮状态。
    if (result?.success) {
      isAlwaysOnTop.value = newState
    }
  } catch (error) {
    console.error('切换置顶失败:', error)
  }
}

/**
 * 关闭独立预览窗口。
 * 处理流程：1、请求主进程关闭窗口并记录异常。
 */
const closeWindow = async () => {
  // 1、由主进程负责原生窗口生命周期。
  try {
    await window.electronAPI?.invoke('canvas-preview-close')
  } catch (error) {
    console.error('关闭预览窗口失败:', error)
  }
}

// ==================== 拖拽功能 ====================
/**
 * 在拖拽浮层中绘制等比缩略图。
 * 处理流程：1、清理目标画布；2、计算居中位置；3、绘制缩略图。
 */
const drawDragPreview = (targetCanvas, sourceCanvas) => {
  // 1、校验两个画布并清空旧预览。
  if (!targetCanvas || !sourceCanvas) return
  
  const ctx = targetCanvas.getContext('2d')
  const w = targetCanvas.width
  const h = targetCanvas.height
  
  ctx.clearRect(0, 0, w, h)
  
  // 2、按较小缩放比计算居中绘制区域。
  const scale = Math.min(w / sourceCanvas.width, h / sourceCanvas.height)
  const drawWidth = sourceCanvas.width * scale
  const drawHeight = sourceCanvas.height * scale
  const offsetX = (w - drawWidth) / 2
  const offsetY = (h - drawHeight) / 2
  
  // 3、将源画布完整绘制到拖拽预览中。
  ctx.drawImage(sourceCanvas, offsetX, offsetY, drawWidth, drawHeight)
}

/**
 * 从预览画布开始鼠标拖拽。
 * 处理流程：1、检查左键与图像；2、初始化浮层位置；3、绘制缩略图；4、注册移动和释放监听。
 */
const handleCanvasMouseDown = async (event) => {
  // 1、仅允许左键拖出已有图像。
  if (event.button !== 0 || !hasImage.value) return
  
  event.preventDefault()
  
  // 2、记录拖拽状态并偏移浮层，避免遮挡鼠标。
  isDragging.value = true
  hasTriggeredSystemDrag = false
  
  dragMouseX.value = event.clientX + 20
  dragMouseY.value = event.clientY + 20
  
  await nextTick()
  
  // 3、等待浮层挂载后绘制拖拽预览。
  if (dragFollowCanvas.value && canvasRef.value) {
    drawDragPreview(dragFollowCanvas.value, canvasRef.value)
    dragOffsetX.value = 75
    dragOffsetY.value = 60
  }
  
  // 4、在文档级监听移动，鼠标释放只处理一次。
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp, { once: true })
}

/**
 * 更新拖拽浮层并在越界时交给系统拖拽。
 * 处理流程：1、过滤无效移动；2、更新浮层位置；3、越界后停止页面监听并启动系统拖拽。
 */
const handleMouseMove = (event) => {
  // 1、系统拖拽已接管后不再重复触发。
  if (!isDragging.value || hasTriggeredSystemDrag) return
  
  // 2、让预览浮层跟随鼠标移动。
  dragMouseX.value = event.clientX + 20
  dragMouseY.value = event.clientY + 20
  
  // 3、鼠标移出窗口边界后立即触发系统拖拽。
  if (event.clientY < 0 || event.clientX < 0 || 
      event.clientX > window.innerWidth || 
      event.clientY > window.innerHeight) {
    hasTriggeredSystemDrag = true
    document.removeEventListener('mousemove', handleMouseMove)
    
    setTimeout(async () => {
      await triggerSystemDrag()
      setTimeout(() => {
        isDragging.value = false
      }, 50)
    }, 10)
  }
}

/**
 * 结束页面内拖拽。
 * 处理流程：1、清理拖拽状态并移除移动监听。
 */
const handleMouseUp = () => {
  // 1、释放浮层状态和文档事件监听。
  isDragging.value = false
  hasTriggeredSystemDrag = false
  document.removeEventListener('mousemove', handleMouseMove)
}

/**
 * 将当前画布导出并提交原生文件拖拽。
 * 处理流程：1、取得画布图像；2、编码图像数据；3、整理预览与导出配置；4、请求主进程拖拽并返回结果。
 */
const triggerSystemDrag = async () => {
  // 1、校验画布并异步导出 PNG 数据。
  if (!canvasRef.value) return
  
  try {
    // 将canvas转为Blob，然后转为Base64
    return new Promise((resolve) => {
      canvasRef.value.toBlob(async (blob) => {
        if (!blob) {
          console.error('无法创建Blob对象')
          resolve({ success: false })
          return
        }
        
        try {
          const buffer = await blob.arrayBuffer()
          
          // 2、分块编码，避免一次展开大量字节导致调用栈溢出。
          /**
           * 将二进制数据转换为 Base64。
           * 处理流程：1、分块拼接二进制字符串；2、编码为 Base64。
           */
          const arrayBufferToBase64 = (buf) => {
            // 1、分块转换字节，控制函数调用的参数数量。
            const bytes = new Uint8Array(buf)
            const chunkSize = 0x8000
            let binary = ''
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
              binary += String.fromCharCode.apply(null, subArray)
            }
            // 2、返回可传给主进程的文本数据。
            return btoa(binary)
          }
          
          const base64 = arrayBufferToBase64(buffer)
          
          // 3、生成拖拽预览图标并沿用主画布的导出配置。
          let iconPayload = null
          try {
            if (dragFollowCanvas.value) {
              const dataURL = dragFollowCanvas.value.toDataURL('image/png')
              iconPayload = { dataURL, size: 115 }
            }
          } catch {}
          
          // 使用与主画布一致的文件名
          const fileName = currentFileName.value
          
          // 读取完整的配置（与主画布完全一致）
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
          
          // 添加PSD原始名称（从文件名中提取）
          // 文件名格式：PSD名_部件信息.png，提取第一个下划线前的部分
          if (fileName) {
            const firstUnderscoreIndex = fileName.indexOf('_')
            if (firstUnderscoreIndex > 0) {
              let psdBaseName = fileName.substring(0, firstUnderscoreIndex)
              
              // 清理特殊符号，确保文件夹名称合法
              psdBaseName = psdBaseName
                .replace(/[\\/:*?"<>|]/g, '_')  // 替换非法字符为下划线
                .replace(/[\s]+/g, '_')         // 替换连续空格为单个下划线
                .replace(/_+/g, '_')            // 合并多个下划线为一个
                .replace(/^_+|_+$/g, '')        // 去除首尾下划线
                .replace(/\.+$/g, '')           // 去除尾部的点号
              
              stickfigureConfig.psdBaseName = psdBaseName
            }
          }
          
          console.log('🎯 [预览窗口] 拖拽保存配置:', stickfigureConfig)
          
          // 4、由主进程创建文件并发起原生拖拽。
          const result = await window.electronAPI?.invoke(
            'create-temp-file-and-start-drag',
            base64,
            iconPayload,
            fileName,
            stickfigureConfig
          )
          
          if (result?.success) {
            console.log('✅ 系统拖拽已触发:', fileName)
          }
          
          resolve(result)
        } catch (error) {
          console.error('拖拽处理失败:', error)
          resolve({ success: false, error: error.message })
        }
      }, 'image/png')
    })
  } catch (error) {
    console.error('触发系统拖拽失败:', error)
    return { success: false, error: error.message }
  }
}

// 标记：是否需要在下次画布更新后重置视图
const needResetViewportAfterUpdate = ref(false)

/**
 * 标记下次图像更新需要重置视图。
 * 处理流程：1、清除手动调整状态；2、设置延迟重置标记。
 */
const resetViewport = () => {
  console.log('🔄 [预览窗口] 标记需要重置视图状态')
  
  // 1、清除用户调整标志，允许自动适应窗口。
  userHasAdjustedScale.value = false
  userHasScrolled.value = false
  
  // 2、将重置延迟到下一幅图像实际绘制完成后。
  needResetViewportAfterUpdate.value = true
}

/**
 * 在画布更新后恢复完整图像视图。
 * 处理流程：1、检查画布和容器；2、重新计算适配比例；3、等待布局更新后居中滚动条。
 */
const performViewportReset = () => {
  // 1、确认图像和有效尺寸均已就绪。
  console.log('🔄 [预览窗口] 执行视图重置')
  
  if (!hasImage.value || !canvasContainerRef.value || !canvasRef.value) {
    console.warn('[预览窗口] 无法重置视图：画布或容器不存在')
    return
  }
  
  const canvas = canvasRef.value
  const container = canvasContainerRef.value
  
  if (!canvas.width || !canvas.height) {
    console.warn('[预览窗口] 画布尺寸无效')
    return
  }
  
  // 2、一次性计算并设置缩放，避免多次触发响应式更新。
  nextTick(() => {
    // 计算最佳缩放比例（与 fitToWindow 逻辑一致）
    const padding = 10
    const containerWidth = container.clientWidth - padding
    const containerHeight = container.clientHeight - padding
    
    const scaleX = containerWidth / canvas.width
    const scaleY = containerHeight / canvas.height
    
    // 一次性设置缩放比例（只触发一次响应式更新）
    currentScale.value = Math.min(scaleX, scaleY)
    
    console.log('📐 [预览窗口] 视图重置缩放计算:', {
      容器尺寸: `${container.clientWidth}x${container.clientHeight}`,
      画布尺寸: `${canvas.width}x${canvas.height}`,
      最终缩放: currentScale.value.toFixed(2)
    })
    
    // 3、等待 DOM 更新后居中滚动条，并暂时标记为程序滚动。
    setTimeout(() => {
      if (canvasContainerRef.value) {
        isProgrammaticScroll.value = true
        const cont = canvasContainerRef.value
        cont.scrollLeft = (cont.scrollWidth - cont.clientWidth) / 2
        cont.scrollTop = (cont.scrollHeight - cont.clientHeight) / 2
        
        console.log('📍 [预览窗口] 滚动条已重置并居中', {
          scrollLeft: cont.scrollLeft,
          scrollTop: cont.scrollTop
        })
        
        setTimeout(() => {
          isProgrammaticScroll.value = false
        }, 200)
      }
      
      console.log('✅ [预览窗口] 视图重置完成')
    }, 50)
  })
}

// 监听来自主进程的更新
let unsubscribeCanvas = null
let unsubscribeTheme = null
let unsubscribeFileName = null
let unsubscribeResetViewport = null

/**
 * 初始化独立预览窗口与主编辑页面之间的状态同步。
 * 处理流程：
 * 1、订阅画布、主题、文件名和视口重置消息
 * 2、读取初始窗口置顶状态
 * 3、注册窗口尺寸监听，支持预览自适应
 */
onMounted(async () => {
  // 1、保存取消订阅入口，供页面卸载时成对清理
  if (window.electronAPI?.on) {
    // 监听画布更新
    unsubscribeCanvas = window.electronAPI.on('canvas-update', (imageData) => {
      updateCanvas(imageData)
    })
    
    // 监听主题更新
    unsubscribeTheme = window.electronAPI.on('theme-update', (theme) => {
      console.log('[预览窗口] 收到主题更新:', theme)
      setTheme(theme)
    })
    
    // 监听文件名更新（与主画布保持一致）
    unsubscribeFileName = window.electronAPI.on('canvas-filename-update', (fileName) => {
      console.log('[预览窗口] 收到文件名更新:', fileName)
      currentFileName.value = fileName
    })
    
    // 监听视图重置（切换PSD时）
    unsubscribeResetViewport = window.electronAPI.on('canvas-viewport-reset', () => {
      console.log('[预览窗口] 收到视图重置命令')
      resetViewport()
    })
  }
  
  // 2、获取初始置顶状态并同步工具栏显示
  try {
    const result = await window.electronAPI?.invoke('window-get-always-on-top')
    if (result?.success) {
      isAlwaysOnTop.value = result.alwaysOnTop
    }
  } catch (error) {
    console.error('获取置顶状态失败:', error)
  }
  
  // 3、监听窗口大小变化，按当前缩放状态更新预览
  window.addEventListener('resize', handleResize)
})

/**
 * 释放独立预览页面的消息订阅与交互资源。
 * 处理流程：
 * 1、取消画布、主题、文件名和视口重置订阅
 * 2、移除窗口及鼠标监听，并清理滚动定时器
 */
onUnmounted(() => {
  // 1、逐项调用已注册的桌面消息取消订阅函数
  if (unsubscribeCanvas) {
    unsubscribeCanvas()
  }
  if (unsubscribeTheme) {
    unsubscribeTheme()
  }
  if (unsubscribeFileName) {
    unsubscribeFileName()
  }
  if (unsubscribeResetViewport) {
    unsubscribeResetViewport()
  }
  // 2、清除浏览器事件与仍在等待的滚动状态更新
  window.removeEventListener('resize', handleResize)
  document.removeEventListener('mousemove', handleMouseMove)
  
  // 清理定时器
  if (scrollTimer) {
    clearTimeout(scrollTimer)
  }
})

/**
 * 响应预览窗口尺寸变化。
 * 处理流程：1、仅在存在图像且用户未手动缩放时重新适应窗口。
 */
const handleResize = () => {
  // 1、仅在用户未手动调整缩放时自动适应，保留手动浏览状态。
  if (hasImage.value && !userHasAdjustedScale.value) {
    fitToWindow()
    // fitToWindow 内部已经处理了滚动条居中，这里不需要重复调用
  }
}
</script>

<style scoped>
.canvas-preview-page {
  width: 100vw;
  height: 100vh;
  background: transparent; /* 移除额外背景，使窗口透明 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 顶部工具栏 */
.toolbar {
  background: var(--theme-background-secondary);
  border-bottom: 1px solid var(--theme-border);
  padding: 8px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
  -webkit-app-region: drag;
  gap: 12px;
}

.toolbar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

/* 置顶按钮文字颜色强制覆盖 */
.toolbar-left :deep(.n-button--default-type) {
  color: #2a2a2a !important; /* 白昼模式黑色文字 */
}

.theme-dark .toolbar-left :deep(.n-button--default-type) {
  color: #fff !important; /* 黑夜模式纯白文字 */
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  -webkit-app-region: no-drag;
}

/* 画布容器 - 完全复制主画布的背景样式和滚动条样式 */
.canvas-container {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: flex-start;
  padding: 20px;
  overflow: auto;
  background: transparent; /* 移除黑色背景，使用透明背景 */
}

/* 滚动条样式（与主画布完全一致） */
.canvas-container::-webkit-scrollbar {
  width: 12px;
  height: 12px;
}

.canvas-container::-webkit-scrollbar-track {
  background: transparent; /* 移除滚动条轨道背景 */
  border-radius: 6px;
}

.canvas-container::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 6px;
}

.canvas-container::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

/* 空状态容器 */
.empty-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* Canvas包装器 - 类似主画布缩放模式的布局 */
.canvas-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 添加padding确保画布周围有空间，使滚动条能访问所有像素 */
  padding: 50vh 50vw;
  box-sizing: content-box;
  min-width: 100%;
  min-height: 100%;
}

/* Canvas样式 - 与主画布完全一致的棋盘格透明背景 */
canvas {
  display: block;
  max-width: none;
  max-height: none;
  object-fit: contain;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  /* 与主画布完全相同的棋盘格透明背景（白昼模式） */
  background-image: 
    linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
    linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
    linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  background-color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  transition: transform 0.2s ease-out;
  cursor: grab;
  user-select: none;
  /* 确保flex容器不会压缩canvas */
  flex-shrink: 0;
}

canvas:active {
  cursor: grabbing;
}

/* 黑夜模式下的canvas背景 */
.theme-dark canvas {
  background-image: 
    linear-gradient(45deg, #333 25%, transparent 25%),
    linear-gradient(-45deg, #333 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #333 75%),
    linear-gradient(-45deg, transparent 75%, #333 75%);
  background-color: #222;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* 空状态：透明像素占位符（与主画布样式一致） */
.empty-canvas-placeholder {
  width: 600px;
  height: 400px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  /* 白昼模式的棋盘格 */
  background-image: 
    linear-gradient(45deg, #e0e0e0 25%, transparent 25%),
    linear-gradient(-45deg, #e0e0e0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e0e0e0 75%),
    linear-gradient(-45deg, transparent 75%, #e0e0e0 75%);
  background-size: 20px 20px;
  background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
  background-color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
}

/* 黑夜模式下的占位符 */
.theme-dark .empty-canvas-placeholder {
  background-image: 
    linear-gradient(45deg, #333 25%, transparent 25%),
    linear-gradient(-45deg, #333 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #333 75%),
    linear-gradient(-45deg, transparent 75%, #333 75%);
  background-color: #222;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* 内联缩放控制（顶部工具栏中） */
.zoom-controls-inline {
  display: flex;
  align-items: center;
  gap: 6px;
  background: var(--theme-background-accent);
  border-radius: 6px;
  padding: 2px 8px;
  border: 1px solid var(--theme-border);
  height: 28px; /* 与按钮高度对齐 */
}

.zoom-info {
  display: flex;
  align-items: center;
  justify-content: center;
  /* 黑夜模式纯白色，白昼模式深色 */
  color: #fff;
  font-size: 12px;
  min-width: 50px;
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
}

/* 拖拽跟随预览 */
.drag-follow-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  user-select: none;
}

/* 白昼模式下的文字颜色 */
.theme-light .zoom-info {
  color: #2a2a2a;
}

:deep(.n-button) {
  min-width: 32px;
  height: 32px;
}

:deep(.n-button svg) {
  width: 16px;
  height: 16px;
}
</style>
