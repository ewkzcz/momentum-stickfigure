<template>
  <div 
    class="image-generate-component"
    @dragover.prevent="handleFileDragOver"
    @dragleave.prevent="handleFileDragLeave"
    @drop.prevent="handleFileDrop"
  >
    <!-- 拖拽应用内预览 -->
    <canvas
      v-show="isDragging && !hasTriggeredSystemDrag"
      ref="dragFollowCanvas"
      width="170"
      height="150"
      class="drag-follow-canvas"
      :style="{
        position: 'fixed',
        left: (dragMouseX - dragCalibration.dx) + 'px',
        top: (dragMouseY - dragCalibration.dy) + 'px',
        pointerEvents: 'none',
        zIndex: 999999,
        borderRadius: '12px',
        background: 'rgba(255, 255, 255, 0.95)',
        backdropFilter: 'blur(8px)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
        border: isNearBoundary ? '2px solid #18a058' : '2px solid #ddd'
      }"
    />
    
    <!-- 文件拖拽遮罩层 -->
    <div 
      v-show="isFileDragging" 
      class="file-drag-overlay"
    >
      <div class="drag-content">
        <div class="drag-icon">📂</div>
        <div class="drag-text">拖放图片到这里</div>
        <div class="drag-hint">支持 JPG、PNG 格式，最多3张，每张≤10MB</div>
      </div>
    </div>
    
    <div class="generate-layout">
      <!-- 左侧：参数配置 -->
      <div class="generate-left">
        <n-card title="" :bordered="false" class="config-card">
          <n-space vertical :size="16">
            <!-- 提示词 -->
            <div>
              <n-space justify="space-between" align="center" style="margin-bottom: 8px;">
                <n-text strong>提示词</n-text>
                <PromptTemplateTrigger
                  button-type="primary"
                  button-size="small"
                  :quaternary="true"
                  :circle="false"
                  button-text="模板库"
                  :show-text="true"
                  :icon-size="16"
                  shortcut="Ctrl+Shift+P"
                  :enable-shortcut="true"
                  @select="handleTemplateSelect"
                />
              </n-space>
              <n-input
                v-model:value="formData.prompt"
                type="textarea"
                :placeholder="fileList.length > 0 ? '描述你想要的编辑效果...' : '描述你想要生成的图像...'"
                :rows="6"
                :maxlength="10000"
                show-count
              />
            </div>
            
            <!-- 图片上传按钮（可选） -->
            <div>
              <n-button
                type="primary"
                size="large"
                @click="handleNativeFileSelect"
                :disabled="fileList.length >= MAX_FILES"
                block
              >
                <template #icon>
                  <n-icon>
                    <span>📂</span>
                  </n-icon>
                </template>
                选择图片文件（可选）
              </n-button>
              <n-text depth="3" style="font-size: 11px; text-align: center; display: block; margin-top: 4px; line-height: 1.4;">
                JPG/PNG, 最多3张, ≤10MB | 支持粘贴、<strong>拖拽</strong>上传 | 图片生成/编辑双模式
              </n-text>
            </div>
            
            <!-- 已选择的文件列表 -->
            <div v-if="fileList.length > 0" class="file-list-display">
              <div
                v-for="(file, index) in fileList"
                :key="index"
                class="file-item"
                style="display: flex; align-items: center; margin-bottom: 8px; padding: 8px; background: var(--n-color); border-radius: 4px;"
              >
                <img
                  v-if="file.url"
                  :src="file.url"
                  style="width: 48px; height: 48px; object-fit: cover; border-radius: 4px; margin-right: 12px;"
                />
                <div style="flex: 1; overflow: hidden;">
                  <n-text style="display: block; font-weight: 500;">{{ file.name }}</n-text>
                  <n-text depth="3" style="font-size: 12px;">{{ file.path || '路径未知' }}</n-text>
                </div>
                <n-button
                  size="small"
                  quaternary
                  circle
                  @click="removeFile(index)"
                >
                  <template #icon>
                    <n-icon>
                      <span>✕</span>
                    </n-icon>
                  </template>
                </n-button>
              </div>
            </div>

            <!-- 灵感、比例和生成按钮 -->
            <div>
              <n-space :size="12" align="center" style="width: 100%;">
                <n-text strong style="white-space: nowrap;">灵感</n-text>
                <n-select
                  v-model:value="selectedTemplate"
                  :options="promptTemplates"
                  placeholder="选择灵感（可选）"
                  @update:value="handleTemplateChange"
                  clearable
                  style="flex: 1; min-width: 100px;"
                />
                <n-text strong style="white-space: nowrap;">比例</n-text>
                <n-select
                  v-model:value="formData.aspectRatio"
                  :options="aspectRatioOptions"
                  style="flex: 1; min-width: 100px;"
                />
                <n-button
                  type="primary"
                  size="large"
                  :disabled="!canGenerate || isGenerating"
                  @click="handleGenerate"
                  style="flex: 1; min-width: 50px;"
                >
                  {{ generateButtonText }}
                </n-button>
              </n-space>
            </div>
          </n-space>
        </n-card>
      </div>

      <!-- 右侧：生成结果 -->
      <div class="generate-right">
        <n-card title="结果" :bordered="false" class="result-card">
          <template #header-extra>
            <n-space>
              <n-button
                v-if="generatedImages.length > 0"
                size="small"
                type="primary"
                @click="saveAsAllImages"
                :loading="isDownloading"
                strong
                secondary
              >
                📥 另存为
              </n-button>
              <n-button
                v-if="generatedImages.length > 0"
                size="small"
                @click="clearResults"
                quaternary
              >
                🗑️ 清空
              </n-button>
            </n-space>
          </template>

          <div class="result-content">
            <!-- 空状态 -->
            <div v-if="generatedImages.length === 0" class="empty-state">
              <div class="empty-icon">
                <n-icon :size="48">
                  <span>🎨</span>
                </n-icon>
              </div>
              <n-text depth="3">生成的图像将显示在这里</n-text>
            </div>

            <!-- 图像网格 - 向左对齐 -->
            <div v-else class="image-grid-container" style="text-align: left;">
              <div class="image-grid" style="justify-content: flex-start;">
                <div
                  v-for="(image, index) in generatedImages"
                  :key="index"
                  class="image-item"
                >
                  <div class="image-wrapper">
                    <img
                      :src="image.url"
                      :alt="`Generated ${index + 1}`"
                      class="generated-image draggable-image"
                      style="cursor: grab;"
                      @mousedown="(event) => handleImageMouseDown(event, image)"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          <!-- 提示信息 - 移到图片下方，紧贴图片 -->
          <div v-if="generatedImages.length > 0" style="margin-top: 0; padding: 10px; background: rgba(79, 158, 255, 0.05); border-left: 3px solid #4f9eff; border-radius: 4px;">
            <n-text depth="3" style="font-size: 12px; line-height: 1.6;">
              💡 <strong>建议垫图</strong>；纳米香蕉存在一定概率"不返回图片"或"不按照要求比例返回图片"<br/>
              🎬 <strong>拖拽功能</strong>：图片支持直接拖拽到桌面/剪映/PS中使用<br/>
              ⚠️ <strong>注意</strong>：请勿随意删除/移动图片，以免导致剪映图片失去链接
            </n-text>
          </div>
        </n-card>
      </div>
    </div>

  </div>
</template>

<script setup>
/** 生图与编辑面板：接收图片和提示词，维护任务结果，并支持批量保存和跨应用拖拽。 */
import { ref, reactive, computed, onMounted, onUnmounted, onActivated, nextTick, watch } from 'vue'
import { useTaskStore, TaskType, TaskStatus } from '../../../../stores/taskStore.js'
import { useMessage, useDialog } from 'naive-ui'
import { sanitizeFileName } from '../../ActionExpressionPage/utils/stringUtils.js'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import { buildGeminiDragConfig } from '@renderer/utils/geminiOutputConfig.js'
import { filterGeminiExceptionMessage } from '@renderer/utils/errorFilters.js'
import PromptTemplateTrigger from '@renderer/components/shared/PromptTemplateTrigger.vue'

// 定义事件
const emit = defineEmits(['generated', 'edited'])

// 消息组件
const message = useMessage()
const dialog = useDialog()

// 任务管理
const taskStore = useTaskStore()
const currentTaskId = ref(null)
const taskCheckInterval = ref(null)

// 响应式数据
const isGenerating = ref(false)
const isDownloading = ref(false)
const generatedImages = ref([])

// ==================== 拖拽功能相关 ====================

// 拖拽常量
const MIN_DRAG_TIME_MS = 300
const OUTSIDE_DURATION_MS = 100
const OUTSIDE_COUNT_THRESHOLD = 2
const OUTSIDE_SAFE_MARGIN = 20
const FOLLOW_OFFSET_X = 20
const FOLLOW_OFFSET_Y = 20

// 拖拽状态（用于生成结果的拖拽）
const isDragging = ref(false)
const hasTriggeredSystemDrag = ref(false)
const isNearBoundary = ref(false)
const dragMouseX = ref(0)
const dragMouseY = ref(0)
const windowBounds = ref({ x: 0, y: 0, width: 1200, height: 800 })
const dragCalibration = ref({ dx: 75, dy: 75 })
const currentDragImage = ref(null)

// 拖拽跟踪变量
let dragStartTime = 0
let dragStartX = 0
let dragStartY = 0
let outsideConsecutiveCount = 0
let outsideFirstTs = 0

// DOM引用
const dragFollowCanvas = ref(null)

// 文件拖拽状态（用于上传图片）
const isFileDragging = ref(false)
let dragLeaveTimeout = null

// 文件上传常量
const MAX_FILES = 3
const MAX_FILE_SIZE_MB = 10
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024

/** 生成超限提示；处理流程：1、将文件名与单图大小上限组合成用户提示。 */
const buildOversizeMessage = (fileName) =>
  `文件 ${fileName} 超出 ${MAX_FILE_SIZE_MB}MB 限制（单张图片≤${MAX_FILE_SIZE_MB}MB），请压缩或更换图片后重试`

let oversizeDialogInstance = null

/**
 * 展示单张图片超限提示。
 * 处理流程：
 * 1、构造提示内容，弹窗接口不可用时降级为消息提示。
 * 2、关闭已存在的超限弹窗，再展示新的确认弹窗。
 */
const showOversizeAlert = (fileName, level = 'warning') => {
  // 1、多个文件超限时始终只保留一个确认弹窗。
  const content = buildOversizeMessage(fileName)
  const globalMessage = typeof window !== 'undefined' ? window.$message : null

  /**
   * 使用消息组件报告文件超限。
   * 处理流程：
   * 1、按等级选择错误或警告入口，优先使用全局消息组件。
   */
  const showToastFallback = () => {
    // 1、全局消息不可用时使用当前组件的消息实例。
    if (level === 'error') {
      if (globalMessage?.error) {
        globalMessage.error(content)
      } else {
        message?.error?.(content)
      }
    } else if (globalMessage?.warning) {
      globalMessage.warning(content)
    } else {
      message?.warning?.(content)
    }
  }

  if (!dialog) {
    showToastFallback()
    return
  }

  // 2、替换旧弹窗，关闭后释放实例引用。
  if (oversizeDialogInstance?.destroy) {
    oversizeDialogInstance.destroy()
    oversizeDialogInstance = null
  }

  oversizeDialogInstance = dialog.warning({
    title: '图片大小超出限制',
    content,
    positiveText: '我知道了',
    maskClosable: true,
    onPositiveClick: () => {
      oversizeDialogInstance = null
    },
    onClose: () => {
      oversizeDialogInstance = null
    }
  })
}

// 文件列表
const fileList = ref([])

// 表单数据
const formData = reactive({
  prompt: '',
  aspectRatio: '16:9' // 默认16:9宽屏，每次初始化都重置
})

// 提示词模板选项
const promptTemplates = [
  { label: '无', value: '' },
  { 
    label: '别墅客厅内景', 
    value: '动漫风格，精美别墅客厅内景，下午时分，明媚的阳光从巨大的落地窗斜射进来，整个房间充满温暖明亮的光线。客厅宽敞通透，现代欧式装修，浅色系主调。阳光在地板上投下长长的光斑，空气中可见细微的浮尘。沙发上放着柔软的抱枕，茶几上有一杯冒着热气的茶和一本翻开的书。窗外是郁郁葱葱的花园。画面细腻、温馨，充满生活气息，电影感镜头。'
  },
  { 
    label: '别墅家门口', 
    value: '电影镜头感，动漫风格，别墅家门口。下午的低角度阳光拉长了建筑的影子，形成强烈的明暗对比。焦点集中在敞开的精美大门上。门前车道旁停着一辆汽车，仿佛有人刚刚归来。光线唯美，氛围宁静中带有一丝期待，新海诚风格的光影效果。'
  },
  { 
    label: '空荡街道樱花', 
    value: '吉卜力工作室风格，一个宁静而忧郁的动漫背景。一条空荡的街道，在落日温暖的光辉中蜿蜒向远方。樱花花瓣如同雪花般在金光中舞动，被轻风拂过。场景沐浴在怀旧、梦幻的氛围中，强调了此刻物哀的短暂之美。柔和空灵的光线，长长的影子，以及充满情感的电影级构图。人物的缺席强化了寂静告别与回忆的感觉。细节丰富的背景，鲜艳而柔和的色彩，没有角色。'
  },
  { 
    label: '西式小屋花园', 
    value: '吉卜力工作室风格，宫崎骏动画电影质感。一个明媚晴朗的午后，一座西式小屋的门前，开满了五彩缤纷的鲜花。白色的篱笆、红色的门和温暖的木质外墙被阳光照得发亮。一只可爱的猫咪在门廊下打盹。空气清澈，光线温暖而柔和，充满了童话般的梦幻和温馨感。'
  }
]

// 宽高比选项配置
const aspectRatioOptions = [
  { label: '原始尺寸', value: 'original' },
  { label: '1:1 (正方形)', value: '1:1' },
  { label: '4:3 (横版)', value: '4:3' },
  { label: '3:4 (竖版)', value: '3:4' },
  { label: '16:9 (宽屏)', value: '16:9' },
  { label: '9:16 (竖屏)', value: '9:16' },
  { label: '2:3 (竖版)', value: '2:3' },
  { label: '3:2 (横版)', value: '3:2' },
  { label: '1:2 (竖版)', value: '1:2' }
]

// 当前选中的模板
const selectedTemplate = ref('')

/** 判断能否提交；处理流程：1、提示词非空且没有进行中请求时允许提交。 */
const canGenerate = computed(() => {
  // 1、上传图片不是文生图的必选条件。
  return formData.prompt.trim() && !isGenerating.value
})

/** 生成提交按钮文案；处理流程：1、按是否有输入图和运行状态选择生成或编辑文案。 */
const generateButtonText = computed(() => {
  // 1、输入图决定请求类型，忙碌状态决定进行时文案。
  if (isGenerating.value) {
    return fileList.value.length > 0 ? '编辑中...' : '生成中...'
  }
  return fileList.value.length > 0 ? '编辑' : '生成'
})

/** 应用预置提示词；处理流程：1、非空模板值直接替换当前提示词。 */
const handleTemplateChange = (value) => {
  // 1、选择空项时保留已经输入的内容。
  if (value) {
    formData.prompt = value
  }
}

/**
 * 应用模板库选择的内容。
 * 处理流程：
 * 1、当前提示词为空时替换，否则换行追加模板内容。
 */
const handleTemplateSelect = (content) => {
  // 1、保留用户已经编辑的非空提示词。
  if (content) {
    // 如果当前提示词为空，直接替换；否则追加到末尾
    if (!formData.prompt.trim()) {
      formData.prompt = content
    } else {
      formData.prompt += '\n' + content
    }
  }
}

// 监听文件列表变化，上传图片后自动切换到原始尺寸
watch(() => fileList.value.length, (newLength, oldLength) => {
  // 当从0变为有文件时，自动切换到原始尺寸
  if (oldLength === 0 && newLength > 0) {
    formData.aspectRatio = 'original'
    console.log('检测到上传图片，自动切换到原始尺寸')
  }
  // 当文件列表清空时，重置为默认16:9
  if (newLength === 0 && oldLength > 0) {
    formData.aspectRatio = '16:9'
    console.log('文件列表已清空，重置为默认16:9')
  }
})

/**
 * 通过系统文件选择器添加输入图片。
 * 处理流程：
 * 1、读取选择结果并按剩余数量截取文件。
 * 2、逐张检查大小，保存主进程返回的路径与预览地址。
 */
const handleNativeFileSelect = async () => {
  // 1、取消选择和空结果不改变原列表。
  try {
    const result = await window.fileSystem.selectImageFiles()
    
    if (result.canceled || !result.success) {
      return
    }
    
    const selectedFiles = result.files || []
    
    if (selectedFiles.length === 0) {
      return
    }
    
    const remainingSlots = MAX_FILES - fileList.value.length
    if (selectedFiles.length > remainingSlots) {
      window.$message?.warning(`最多只能选择 ${remainingSlots} 张图片`)
    }
    
    const filesToAdd = selectedFiles.slice(0, remainingSlots)
    
    // 2、超限文件跳过，其他文件继续添加。
    for (const file of filesToAdd) {
      // 验证文件大小
      if (file.size > MAX_FILE_SIZE_BYTES) {
        showOversizeAlert(file.name)
        continue
      }
      
      fileList.value.push({
        name: file.name,
        path: file.path,
        url: file.previewUrl || '',  // 使用主进程返回的预览URL
        size: file.size
      })
      
      console.log('添加文件:', file.name, '路径:', file.path)
    }
    
    if (filesToAdd.length > 0) {
      window.$message?.success(`已选择 ${filesToAdd.length} 张图片`)
    }
  } catch (error) {
    console.error('文件选择失败:', error)
    window.$message?.error('文件选择失败: ' + error.message)
  }
}

/** 移除输入图片；处理流程：1、按当前下标从输入列表删除记录。 */
const removeFile = (index) => {
  // 1、只移除界面记录，不删除源文件。
  fileList.value.splice(index, 1)
}

/**
 * 将剪贴板图片加入输入列表。
 * 处理流程：
 * 1、筛选图片项并检查数量与大小限制。
 * 2、读取为预览数据，保存临时图片后登记可供主进程使用的路径。
 */
const handlePaste = async (event) => {
  // 1、非图片剪贴板内容保留原有粘贴行为。
  const items = event.clipboardData?.items
  if (!items) return
  
  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      event.preventDefault()
      
      if (fileList.value.length >= MAX_FILES) {
        window.$message?.warning(`最多只能选择${MAX_FILES}张图片`)
        return
      }
      
      const file = item.getAsFile()
      if (file) {
        // 检查文件大小
        if (file.size > MAX_FILE_SIZE_BYTES) {
          showOversizeAlert(file.name, 'error')
          return
        }
        
        // 2、剪贴板图片没有可靠磁盘路径，先保存为临时文件。
        const reader = new FileReader()
        reader.onload = async (e) => {
          const base64 = e.target.result
          const base64Data = base64.split(',')[1]
          const tempFileName = `粘贴的图片-${Date.now()}.png`
          
          try {
            // 立即保存为临时文件
            const tempFileResult = await window.fileSystem.saveTempImage(base64Data, tempFileName)
            
            if (tempFileResult.success && tempFileResult.path) {
              // 使用临时文件路径
              fileList.value.push({
                name: tempFileName,
                path: tempFileResult.path,  // 使用临时文件路径
                url: base64,  // 保留base64用于预览
                size: file.size
              })
              console.log('粘贴图片已保存为临时文件:', tempFileResult.path)
              window.$message?.success('成功添加粘贴的图片')
            } else {
              console.error('保存临时文件失败:', tempFileResult.error)
              window.$message?.error('保存粘贴图片失败: ' + (tempFileResult.error || '未知错误'))
            }
          } catch (error) {
            console.error('处理粘贴图片失败:', error)
            window.$message?.error('处理粘贴图片失败: ' + error.message)
          }
        }
        reader.onerror = () => {
          window.$message?.error('读取粘贴图片失败')
        }
        reader.readAsDataURL(file)
      }
    }
  }
}

// ==================== 文件拖拽事件处理 ====================

/**
 * 处理文件拖拽进入
 * 处理流程：
 * 1、仅对文件拖拽取消离开延时，显示复制投放遮罩。
 */
const handleFileDragOver = (event) => {
  // 1、文本或页面内部拖动不显示文件投放遮罩。
  if (event.dataTransfer && event.dataTransfer.types.includes('Files')) {
    // 清除之前的定时器
    if (dragLeaveTimeout) {
      clearTimeout(dragLeaveTimeout)
      dragLeaveTimeout = null
    }
    
    // 显示拖拽遮罩
    isFileDragging.value = true
    event.dataTransfer.dropEffect = 'copy'
  }
}

/**
 * 处理文件拖拽离开
 * 处理流程：
 * 1、替换旧延时任务，短暂等待后隐藏遮罩以避免子元素切换闪烁。
 */
const handleFileDragLeave = (event) => {
  // 1、真正离开与进入子元素共用事件，延迟隐藏减少闪烁。
  if (dragLeaveTimeout) {
    clearTimeout(dragLeaveTimeout)
  }
  
  dragLeaveTimeout = setTimeout(() => {
    isFileDragging.value = false
  }, 50)
}

/**
 * 处理文件放下
 * 处理流程：
 * 1、清除投放状态并检查剩余图片容量。
 * 2、逐张验证格式与大小，异步读取并保存临时文件。
 * 3、保存成功的图片进入输入列表，单张失败独立提示。
 */
const handleFileDrop = async (event) => {
  // 1、落下后立即清除遮罩与离开定时器。
  isFileDragging.value = false
  
  if (dragLeaveTimeout) {
    clearTimeout(dragLeaveTimeout)
    dragLeaveTimeout = null
  }
  
  // 获取拖拽的文件
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) {
    return
  }
  
  console.log('拖拽文件数量:', files.length)
  
  // 检查文件数量限制
  const remainingSlots = MAX_FILES - fileList.value.length
  if (remainingSlots <= 0) {
    window.$message?.warning(`最多只能选择${MAX_FILES}张图片`)
    return
  }
  
  // 2、按剩余名额逐张校验；读取回调中才实际添加记录。
  let addedCount = 0
  for (let i = 0; i < files.length && addedCount < remainingSlots; i++) {
    const file = files[i]
    
    // 验证文件类型
    if (!file.type.startsWith('image/')) {
      window.$message?.warning(`文件 ${file.name} 不是图片格式`)
      continue
    }
    
    // 验证文件格式
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png']
    if (!validTypes.includes(file.type.toLowerCase())) {
      window.$message?.warning(`文件 ${file.name} 格式不支持，仅支持 JPG/PNG`)
      continue
    }
    
    // 验证文件大小
    if (file.size > MAX_FILE_SIZE_BYTES) {
      showOversizeAlert(file.name)
      continue
    }
    
    try {
      // 3、落盘后保留路径供图片编辑接口读取。
      const reader = new FileReader()
      reader.onload = async (e) => {
        const base64 = e.target.result
        const base64Data = base64.split(',')[1]
        // 过滤文件名中的特殊字符，避免文件系统不支持的字符导致保存失败
        const tempFileName = sanitizeFileName(file.name, `拖拽的图片-${Date.now()}.png`)
        
        try {
          // 保存为临时文件
          const tempFileResult = await window.fileSystem.saveTempImage(base64Data, tempFileName)
          
          if (tempFileResult.success && tempFileResult.path) {
            // 添加到文件列表
            fileList.value.push({
              name: tempFileName,
              path: tempFileResult.path,
              url: base64,
              size: file.size
            })
            console.log('拖拽图片已保存为临时文件:', tempFileResult.path)
          } else {
            console.error('保存拖拽图片失败:', tempFileResult.error)
            window.$message?.error(`保存 ${file.name} 失败: ` + (tempFileResult.error || '未知错误'))
          }
        } catch (error) {
          console.error('处理拖拽图片失败:', error)
          window.$message?.error(`处理 ${file.name} 失败: ` + error.message)
        }
      }
      reader.onerror = () => {
        window.$message?.error(`读取 ${file.name} 失败`)
      }
      reader.readAsDataURL(file)
      
      addedCount++
    } catch (error) {
      console.error('处理文件失败:', error)
      window.$message?.error(`处理 ${file.name} 失败: ` + error.message)
    }
  }
  
  if (addedCount > 0) {
    window.$message?.success(`成功添加 ${addedCount} 张图片`)
  }
}

/**
 * 提交图片生成或编辑任务。
 * 处理流程：
 * 1、检查提示词，按输入图片选择任务类型并登记运行状态。
 * 2、读取服务配置和项目目录，准备生成或编辑参数。
 * 3、请求主进程，成功时登记结果并通知父组件，失败时记录友好提示。
 * 4、结束忙碌状态并将宽高比重置为默认值。
 */
const handleGenerate = async () => {
  // 1、输入图片存在时走编辑接口，否则走文生图接口。
  if (!canGenerate.value) {
    window.$message?.warning('请输入提示词')
    return
  }

  // 根据是否有文件判断是生成还是编辑
  const hasFiles = fileList.value.length > 0
  const taskType = hasFiles ? TaskType.EDIT : TaskType.GENERATE

  // 创建任务配置
  const taskConfig = {
    prompt: formData.prompt,
    ...(hasFiles && { inputImages: fileList.value.map(f => f.path).filter(Boolean) })
  }
  
  // 只有当不是原始尺寸时才传递aspectRatio参数
  if (formData.aspectRatio !== 'original') {
    taskConfig.aspectRatio = formData.aspectRatio
  }

  // 创建任务
  const task = taskStore.createTask(taskType, taskConfig)
  
  currentTaskId.value = task.id
  isGenerating.value = true
  
  // 更新任务状态为运行中
  taskStore.updateTaskStatus(task.id, TaskStatus.RUNNING)
  
  console.log(hasFiles ? '开始编辑图片:' : '开始生成图片:', {
    prompt: formData.prompt,
    aspectRatio: formData.aspectRatio === 'original' ? '原始尺寸（不传参）' : formData.aspectRatio,
    hasFiles,
    fileCount: fileList.value.length,
    taskId: task.id
  })

  try {
    // 2、兼容旧配置键，并在缺少密钥时将任务标记失败。
    const savedConfig = localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config')
    const userConfig = savedConfig ? JSON.parse(savedConfig) : {}
    
    // 检查是否配置了API密钥
    if (!userConfig.apiKey) {
      window.$message?.error('请先在设置页面配置API密钥')
      taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, { 
        error: '未配置API密钥' 
      })
      return
    }
    
    /**
     * 推导本次请求的默认项目目录。
     * 处理流程：
     * 1、优先使用系统用户图片目录，缺少环境信息时回退相对路径。
     */
    const getDefaultProjectRoot = () => {
      // 1、按平台构造本组件使用的生图项目路径。
      const homedir = window.env?.homedir || ''
      const platform = window.env?.platform || 'win32'
      
      if (!homedir) {
        return './gemini-image'
      }
      
      if (platform === 'win32') {
        return `${homedir}\\Pictures\\gemini-image`
      } else if (platform === 'darwin') {
        return `${homedir}/Pictures/gemini-image`
      } else {
        return `${homedir}/Pictures/gemini-image`
      }
    }
    const projectRoot = userConfig.projectRoot || getDefaultProjectRoot()
    
    let result
    
    // 3、有输入图片时传递有效文件路径；原始比例不发送宽高比参数。
    if (hasFiles) {
      // 准备输入图片路径（所有图片都已经有路径了）
      const inputImages = fileList.value
        .filter(file => file.path)
        .map(file => file.path)
      
      if (inputImages.length === 0) {
        window.$message?.error('无法获取图片文件路径，请重新选择文件')
        taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, { 
          error: '无法获取图片路径' 
        })
        return
      }
      
      console.log('准备编辑的图片路径:', inputImages)
      
      // 构建编辑参数
      const editParams = {
        prompt: formData.prompt,
        inputImages: inputImages,
        // 传递API配置
        apiKey: userConfig.apiKey,
        baseUrl: userConfig.baseUrl,
        model: 'gemini-2.5-flash-image',
        projectRoot: projectRoot,
        editOutputDir: userConfig.editOutputDir || 'output',
        logDir: userConfig.logDir || 'logs'
      }
      
      // 只有当不是原始尺寸时才传递aspectRatio参数
      if (formData.aspectRatio !== 'original') {
        editParams.aspectRatio = formData.aspectRatio
      }
      
      // 调用图片编辑 API
      result = await window.falApi.editImage(editParams)
    } else {
      // 构建生成参数
      const generateParams = {
        prompt: formData.prompt,
        // 传递API配置
        apiKey: userConfig.apiKey,
        baseUrl: userConfig.baseUrl,
        model: 'gemini-2.5-flash-image',
        projectRoot: projectRoot,
        outputDir: userConfig.outputDir || 'output',
        logDir: userConfig.logDir || 'logs'
      }
      
      // 只有当不是原始尺寸时才传递aspectRatio参数
      if (formData.aspectRatio !== 'original') {
        generateParams.aspectRatio = formData.aspectRatio
      }
      
      // 调用图片生成 API
      result = await window.falApi.generateImage(generateParams)
    }

    console.log('API返回结果:', result)

    // 4、结果统一为图片记录，并同步到任务仓库和父组件。
    if (result && result.success) {
      // 处理生成结果 - main_api.js直接返回URL数组
      const images = Array.isArray(result.data) ? result.data : []
      const imageData = images.map((url, index) => ({
        url,
        alt: `Generated image ${index + 1}`,
        timestamp: Date.now()
      }))
      
      generatedImages.value = imageData

      // 更新任务状态为完成
      taskStore.updateTaskStatus(task.id, TaskStatus.COMPLETED, { 
        result: imageData 
      })

      // 根据任务类型发送不同的事件给父组件
      if (hasFiles) {
        emit('edited', result)
      } else {
        emit('generated', result)
      }

      // 显示成功消息
      const successMsg = hasFiles ? `成功编辑 ${images.length} 张图片` : `成功生成 ${images.length} 张图片`
      window.$message?.success(successMsg)
    } else {
      const rawError = result?.message || '生成失败'
      const friendlyError = filterGeminiExceptionMessage(rawError)
      
      // 更新任务状态为失败
      taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, { 
        error: friendlyError 
      })
      
      // 显示错误消息
      window.$message?.error(friendlyError)
    }
  } catch (error) {
    console.error('生成图片失败:', error)
    
    const friendlyError = filterGeminiExceptionMessage(error)
    
    // 更新任务状态为失败
    taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, { 
      error: friendlyError 
    })
    
    window.$message?.error('生成失败: ' + friendlyError)
  } finally {
    isGenerating.value = false
    currentTaskId.value = null
    
    // 5、无论请求成功与否都恢复默认比例并解除任务占用。
    formData.aspectRatio = '16:9'
    console.log('生成/编辑完成，比例已重置为16:9')
  }
}

/**
 * 将图片地址转换为 PNG 的 Base64 内容。
 * 处理流程：
 * 1、跨域加载图片并绘制到等尺寸画布。
 * 2、编码后移除数据地址前缀，加载或编码失败时拒绝 Promise。
 */
const imageUrlToBase64 = async (url) => {
  // 1、画布编码可能受跨域限制，错误交由保存流程处理。
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'Anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      try {
        const base64 = canvas.toDataURL('image/png').split(',')[1]
        resolve(base64)
      } catch (error) {
        reject(error)
      }
    }
    img.onerror = reject
    img.src = url
  })
}

/**
 * 生成结果图片文件名。
 * 处理流程：
 * 1、格式化本地时间，并附加从一开始的批次序号。
 */
const generateFileName = (index) => {
  // 1、前缀标识生图结果，序号区分同一批输出。
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  const second = String(now.getSeconds()).padStart(2, '0')
  const timestamp = `${year}_${month}_${day}_${hour}_${minute}_${second}`
  
  // G 表示图片生成
  return `G_${timestamp}_${String(index + 1).padStart(2, '0')}.png`
}

/**
 * 将一张结果图片写入指定目录。
 * 处理流程：
 * 1、本地路径读取原始数据，其他地址经画布转换成 PNG。
 * 2、生成文件名并请求主进程写入，失败时向批量保存流程传递异常。
 */
const saveImageToFolder = async (image, index, folderPath) => {
  // 1、按来源选择读取方式，保留现有输出路径拼接约定。
  try {
    // 如果是文件路径，直接读取
    if (image.url.startsWith('file://') || image.url.startsWith('/') || /^[a-zA-Z]:\\/.test(image.url)) {
      const response = await fetch(image.url)
      const blob = await response.blob()
      const reader = new FileReader()
      
      return new Promise((resolve, reject) => {
        reader.onloadend = async () => {
          const base64Data = reader.result.split(',')[1]
          const fileName = generateFileName(index)
          const filePath = `${folderPath}\\${fileName}`
          
          const result = await window.api.writeFile(filePath, base64Data)
          if (result.success) {
            resolve()
          } else {
            reject(new Error(result.error || '保存失败'))
          }
        }
        reader.onerror = reject
        reader.readAsDataURL(blob)
      })
    } else {
      const base64Data = await imageUrlToBase64(image.url)
      const fileName = generateFileName(index)
      const filePath = `${folderPath}\\${fileName}`
      
      const result = await window.api.writeFile(filePath, base64Data)
      if (!result.success) {
        throw new Error(result.error || '保存失败')
      }
    }
  } catch (error) {
    console.error('保存图片失败:', error)
    throw error
  }
}

/**
 * 批量另存为当前结果图片。
 * 处理流程：
 * 1、选择目标目录，取消时结束操作。
 * 2、逐张保存并统计成功数量，单张失败不打断其他图片。
 * 3、有成功结果时尝试打开目录，最后解除下载状态。
 */
const saveAsAllImages = async () => {
  // 1、批量保存期间锁定另存为按钮。
  isDownloading.value = true

  try {
    // 调用electron文件夹选择对话框
    const folderResult = await window.fileSystem.selectFolder()
    
    if (folderResult.canceled || !folderResult.success) {
      isDownloading.value = false
      return
    }
    
    const selectedFolder = folderResult.path
    console.log('选择的保存文件夹:', selectedFolder)
    
    // 2、按顺序保存并稍作间隔，分别记录单张失败。
    let savedCount = 0
    for (let i = 0; i < generatedImages.value.length; i++) {
      try {
        await saveImageToFolder(generatedImages.value[i], i, selectedFolder)
        savedCount++
        await new Promise(resolve => setTimeout(resolve, 100))
      } catch (err) {
        console.error(`保存第 ${i + 1} 张图片失败:`, err)
      }
    }
    
    if (savedCount > 0) {
      window.$message?.success(`成功保存 ${savedCount} 张图片到指定文件夹`)
      
      // 自动打开保存的文件夹
      try {
        const openResult = await window.fileSystem.openFolder(selectedFolder)
        if (!openResult.success) {
          console.warn('打开文件夹失败:', openResult.error)
        }
      } catch (err) {
        console.warn('打开文件夹时出错:', err)
      }
    } else {
      window.$message?.error('所有图片保存失败')
    }
  } catch (error) {
    console.error('批量保存失败:', error)
    window.$message?.error('保存失败: ' + error.message)
  } finally {
    isDownloading.value = false
  }
}


/** 清空结果展示；处理流程：1、清除图片列表并提示，不删除任务历史或磁盘文件。 */
const clearResults = () => {
  // 1、历史任务仍可通过任务恢复流程读取。
  generatedImages.value = []
  window.$message?.info('已清空结果')
}


/**
 * 从任务仓库恢复生成状态与最近结果。
 * 处理流程：
 * 1、查找活跃生成任务并恢复当前任务标识。
 * 2、没有显示结果时使用最近已完成生成任务的结果。
 */
const restoreTaskState = () => {
  // 1、此恢复入口仅筛选生成类型，不恢复编辑类型。
  const activeTasks = taskStore.getActiveTasks()
  const generateTasks = activeTasks.filter(task => task.type === TaskType.GENERATE)
  
  if (generateTasks.length > 0) {
    // 恢复最近的生成任务状态
    const latestTask = generateTasks[generateTasks.length - 1]
    currentTaskId.value = latestTask.id
    isGenerating.value = latestTask.status === TaskStatus.RUNNING
    
    // 如果任务已完成，恢复结果
    if (latestTask.status === TaskStatus.COMPLETED && latestTask.result) {
      generatedImages.value = latestTask.result
    }
    
    console.log('恢复生成任务状态:', latestTask.id, latestTask.status)
  }
  
  // 2、已完成记录按创建时间倒序查找，已有显示结果时不覆盖。
  const completedTasks = taskStore.getTasksByType(TaskType.GENERATE)
    .filter(task => task.status === TaskStatus.COMPLETED && task.result)
    .slice(0, 5) // 只显示最近5个完成的任务结果
  
  if (completedTasks.length > 0 && generatedImages.value.length === 0) {
    // 如果当前没有结果，恢复最近完成任务的结果
    const latestCompleted = completedTasks[0]
    generatedImages.value = latestCompleted.result || []
    console.log('恢复最近完成的生成结果:', latestCompleted.id)
  }
}

/**
 * 同步当前任务的结束状态。
 * 处理流程：
 * 1、当前记录缺失时解除忙碌状态。
 * 2、完成时恢复结果，失败时展示原因，并清除当前任务标识。
 */
const checkTaskStatus = () => {
  // 1、无当前任务时不扫描全部历史。
  if (!currentTaskId.value) return
  
  const task = taskStore.getTask(currentTaskId.value)
  if (!task) {
    currentTaskId.value = null
    isGenerating.value = false
    return
  }
  
  // 2、仅处理完成和失败，等待或运行状态继续交给下一次检查。
  if (task.status === TaskStatus.COMPLETED) {
    isGenerating.value = false
    if (task.result && task.result.length > 0) {
      generatedImages.value = task.result
      window.$message?.success(`任务完成！生成了 ${task.result.length} 张图片`)
    }
    currentTaskId.value = null
  } else if (task.status === TaskStatus.FAILED) {
    isGenerating.value = false
    window.$message?.error(`任务失败：${task.error || '未知错误'}`)
    currentTaskId.value = null
  }
}

// ==================== 拖拽功能方法 ====================

/**
 * 创建图片canvas用于拖拽
 * 处理流程：
 * 1、加载图片并绘制到等尺寸画布，加载失败时返回 null。
 */
const createImageCanvas = (imageUrl) => {
  // 1、保留原图像素大小供保存与拖拽图标生成。
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0)
      resolve(canvas)
    }
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

/**
 * 绘制拖拽预览图
 * 处理流程：
 * 1、清空预览并设置圆角裁切。
 * 2、按容器等比缩放图片，水平居中并靠底部绘制。
 */
const drawDragPreview = (canvas, sourceCanvas) => {
  const ctx = canvas.getContext('2d')
  const canvasWidth = Number(canvas.width) || 170
  const canvasHeight = Number(canvas.height) || 150

  // 1、清除上一张图片并建立本次圆角裁切。
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // 添加圆角裁切
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(5, 5, canvasWidth - 10, canvasHeight - 10, 12)
  ctx.clip()

  // 2、保留边距，按宽高中较小缩放比适配预览。
  const padding = 8
  const contentW = Math.max(1, canvasWidth - padding * 2)
  const contentH = Math.max(1, canvasHeight - padding * 2)
  const scale = Math.min(contentW / sourceCanvas.width, contentH / sourceCanvas.height)
  const destW = Math.max(1, Math.round(sourceCanvas.width * scale))
  const destH = Math.max(1, Math.round(sourceCanvas.height * scale))
  const dx = Math.round((canvasWidth - destW) / 2)
  const dy = Math.round(canvasHeight - padding - destH)

  ctx.drawImage(sourceCanvas, dx, dy, destW, destH)
  ctx.restore()
}

/**
 * 更新窗口边界
 * 处理流程：
 * 1、优先读取主进程窗口矩形。
 * 2、接口失败时回退到浏览器提供的屏幕位置和外部尺寸。
 */
const updateWindowBounds = async () => {
  // 1、窗口矩形与鼠标屏幕坐标配套使用。
  try {
    const result = await window.electronAPI?.getWindowBounds?.()
    
    if (result?.success && result?.bounds) {
      windowBounds.value = result.bounds
    } else {
      // 降级方案
      windowBounds.value = {
        x: window.screenX || 0,
        y: window.screenY || 0,
        width: window.outerWidth || 1200,
        height: window.outerHeight || 800
      }
    }
  } catch (error) {
    console.warn('⚠️ 无法获取窗口边界，使用默认值', error)
    windowBounds.value = {
      x: window.screenX || 0,
      y: window.screenY || 0,
      width: window.outerWidth || 1200,
      height: window.outerHeight || 800
    }
  }
}

/**
 * 检查鼠标是否在窗口外
 * 处理流程：
 * 1、计算窗口四边并向外扩展安全距离，再判断屏幕坐标是否越界。
 */
const checkMouseOutsideWindow = (screenX, screenY, safeMargin = OUTSIDE_SAFE_MARGIN) => {
  // 1、边缘容差减少窗口边框附近的误触发。
  const bounds = windowBounds.value
  
  const windowLeft = bounds.x
  const windowTop = bounds.y
  const windowRight = bounds.x + bounds.width
  const windowBottom = bounds.y + bounds.height
  
  const isOutside = (
    screenX < (windowLeft - safeMargin) ||
    screenY < (windowTop - safeMargin) ||
    screenX > (windowRight + safeMargin) ||
    screenY > (windowBottom + safeMargin)
  )
  
  return isOutside
}

/**
 * 处理图片鼠标按下事件
 * 处理流程：
 * 1、仅接受左键，记录拖动起点和当前图片。
 * 2、等待跟随画布出现，加载并绘制预览。
 * 3、安装全局移动、释放与出窗监听，并刷新窗口边界。
 */
const handleImageMouseDown = async (event, imageData) => {
  // 1、初始化当前拖拽的时间、位置和图片状态。
  if (event.button !== 0) return
  
  try {
    event.preventDefault()
    
    // 记录拖拽开始信息
    dragStartTime = Date.now()
    dragStartX = event.clientX
    dragStartY = event.clientY
    isDragging.value = true
    hasTriggeredSystemDrag.value = false
    isNearBoundary.value = false
    currentDragImage.value = imageData
    
    // 初始化鼠标位置
    dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
    dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y

    // 2、等响应式界面渲染后再访问跟随画布。
    await nextTick()
    try {
      if (dragFollowCanvas.value && imageData.url) {
        // 创建图片canvas
        const sourceCanvas = await createImageCanvas(imageData.url)
        
        if (sourceCanvas) {
          drawDragPreview(dragFollowCanvas.value, sourceCanvas)
          
          // 设置校准为Canvas中心
          dragCalibration.value = { dx: 170 / 2, dy: 150 / 2 + 15 }
        }
      }
    } catch (error) {
      console.error('❌ 应用内预览图绘制失败:', error)
      dragCalibration.value = { dx: 85, dy: 85 }
    }
    
    // 3、全局监听使指针离开图片元素后仍能继续拖动。
    document.addEventListener('mousemove', handleMouseMoveForDrag, { passive: false })
    document.addEventListener('mouseup', handleMouseUpForDrag, { once: true })

    // 刷新窗口边界
    updateWindowBounds()

    // 监听离开窗口事件
    window.addEventListener('mouseout', handleWindowMouseOut)
    
  } catch (error) {
    console.error('❌ 混合拖拽初始化失败:', error)
    isDragging.value = false
  }
}

/**
 * 处理鼠标移动事件
 * 处理流程：
 * 1、更新跟随坐标，过滤短距离点击和未满足保护期的移动。
 * 2、累计连续越界次数和时间，达到阈值后转入系统拖拽。
 * 3、回到窗口内部时清零越界计数。
 */
const handleMouseMoveForDrag = (event) => {
  // 1、转入系统拖拽后不再处理应用内移动。
  if (!isDragging.value || hasTriggeredSystemDrag.value) return
  
  try {
    // 更新鼠标位置
    dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
    dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y
    
    // 计算拖拽距离
    const deltaX = event.clientX - dragStartX
    const deltaY = event.clientY - dragStartY
    const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    
    // 只有拖拽距离超过5px才开始处理
    if (dragDistance < 5) {
      return
    }
    
    // 检查拖拽时间 - 保护期
    const dragDuration = Date.now() - dragStartTime
    
    if (dragDuration < MIN_DRAG_TIME_MS) {
      // 快速拖拽检测
      const isFastDrag = dragDistance > 50 && dragDuration > 50
      
      if (!isFastDrag) {
        return
      }
    }
    
    // 2、次数和持续时间同时达标才触发跨应用拖拽。
    const outsideNow = checkMouseOutsideWindow(event.screenX, event.screenY, OUTSIDE_SAFE_MARGIN)
    if (outsideNow) {
      const now = Date.now()
      if (outsideConsecutiveCount === 0) outsideFirstTs = now
      outsideConsecutiveCount += 1
      const outsideDuration = now - outsideFirstTs
      isNearBoundary.value = true

      if (outsideConsecutiveCount >= OUTSIDE_COUNT_THRESHOLD && outsideDuration >= OUTSIDE_DURATION_MS) {
        console.log('🔄 连续处于窗口外，触发系统拖拽...')
        hasTriggeredSystemDrag.value = true
        window.removeEventListener('mouseout', handleWindowMouseOut)
        document.removeEventListener('mousemove', handleMouseMoveForDrag)
        
        // 无缝切换：立即触发系统拖拽
        setTimeout(async () => {
          await triggerSystemDrag()
          setTimeout(() => { isDragging.value = false }, 50)
        }, 10)
        
        outsideConsecutiveCount = 0
        return
      }
    } else {
      // 回到窗口内则重置计数
      outsideConsecutiveCount = 0
      isNearBoundary.value = false
    }
    
  } catch (error) {
    console.error('❌ 混合拖拽移动处理失败:', error)
  }
}

/**
 * 处理鼠标释放事件
 * 处理流程：
 * 1、调用统一清理入口解除拖拽状态与事件监听。
 */
const handleMouseUpForDrag = () => {
  // 1、释放鼠标即结束应用内拖动。
  console.log('🖱️ 鼠标释放，结束拖拽')
  cleanupDrag()
}

/**
 * 处理窗口mouseout事件
 * 处理流程：
 * 1、过滤未拖动、保护期内和仍有目标元素的事件。
 * 2、通过屏幕坐标复核越界，满足时间与次数阈值后切换系统拖拽。
 */
const handleWindowMouseOut = (event) => {
  // 1、元素间移动不视为离开窗口。
  if (!isDragging.value || hasTriggeredSystemDrag.value) return

  const dragDuration = Date.now() - dragStartTime
  
  // 快速拖拽支持
  const deltaX = event.screenX - (windowBounds.value.x + windowBounds.value.width / 2)
  const deltaY = event.screenY - (windowBounds.value.y + windowBounds.value.height / 2)
  const distanceFromCenter = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const isFastExit = distanceFromCenter > 100 && dragDuration > 50
  
  if (dragDuration < MIN_DRAG_TIME_MS && !isFastExit) {
    return
  }

  const toEl = event.relatedTarget || event.toElement
  if (toEl !== null) return

  // 2、真实屏幕越界才参与系统拖拽触发计数。
  const isOutsideNow = checkMouseOutsideWindow(event.screenX, event.screenY)
  if (!isOutsideNow) return
  
  const now = Date.now()
  if (outsideConsecutiveCount === 0) outsideFirstTs = now
  outsideConsecutiveCount += 1
  
  const outsideDuration = now - outsideFirstTs
  const totalDragDuration = now - dragStartTime
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
  
  outsideConsecutiveCount = 0
}

/**
 * 触发系统拖拽
 * 处理流程：
 * 1、确认当前图片存在，调用保存并拖拽流程。
 * 2、失败时展示原因，成功状态由主进程拖拽事件反馈。
 */
const triggerSystemDrag = async () => {
  // 1、系统拖拽需要先生成可被其他应用接收的本地文件。
  try {
    console.log('🚀 启动系统级拖拽切换...')
    
    if (!currentDragImage.value || !currentDragImage.value.url) {
      message.error('没有可拖拽的图片')
      return
    }
    
    // 创建临时文件并启动系统级拖拽
    const result = await createTempFileAndDrag()
    if (!(result && result.success)) {
      console.error('❌ 系统拖拽失败:', result?.error)
      message.error('图片保存失败: ' + (result?.error || '未知错误'))
    }
    
  } catch (error) {
    console.error('❌ 系统拖拽切换失败:', error)
    message.error('拖拽失败: ' + error.message)
  }
}

/**
 * 创建临时文件并启动系统拖拽
 * 处理流程：
 * 1、将当前图片加载到画布并编码为 PNG 数据。
 * 2、分块转换 Base64，组装图标与用户输出配置。
 * 3、请求主进程保存文件并发起拖拽，异常统一返回失败对象。
 */
const createTempFileAndDrag = async () => {
  // 1、画布或图片数据无效时不调用桌面拖拽接口。
  try {
    if (!currentDragImage.value || !currentDragImage.value.url) {
      return { success: false, error: '图片未初始化' }
    }
    
    // 将图片URL转换为base64
    const canvas = await createImageCanvas(currentDragImage.value.url)
    if (!canvas) {
      return { success: false, error: '无法创建图片canvas' }
    }
    
    // 转换为Blob
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve({ success: false, error: '无法创建Blob对象' })
          return
        }
        
        try {
          // 转换为Base64
          const buffer = await blob.arrayBuffer()
          
          /**
           * 将图片字节分块转换为 Base64。
           * 处理流程：
           * 1、每次处理有限字节生成二进制字符串，最后统一编码。
           */
          function arrayBufferToBase64(buf) {
            // 1、限制单次 apply 参数数量，避免大图片导致调用栈溢出。
            const bytes = new Uint8Array(buf)
            const chunkSize = 0x8000 // 32KB 分块
            let binary = ''
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
              binary += String.fromCharCode.apply(null, subArray)
            }
            return btoa(binary)
          }
          const base64 = arrayBufferToBase64(buffer)
          
          // 创建拖拽图标
          const iconPayload = {
            dataURL: canvas.toDataURL(),
            size: 64
          }
          
          // 2、携带用户导出配置，将文件生成和系统拖拽交给主进程。
          const dragConfig = buildGeminiDragConfig()
          const result = await window.electronAPI?.createTempFileAndStartDrag?.(
            base64, 
            iconPayload,
            `generated_image_${Date.now()}.png`,
            dragConfig
          )
          
          resolve(result)
          
        } catch (error) {
          console.error('❌ Base64转换失败:', error)
          resolve({ success: false, error: 'Base64转换失败: ' + error.message })
        }
      }, 'image/png', 1.0)
    })
    
  } catch (error) {
    console.error('❌ 创建拖拽文件失败:', error)
    return { success: false, error: error.message }
  }
}

/**
 * 清理拖拽状态
 * 处理流程：
 * 1、清空图片与拖拽标志。
 * 2、移除全局鼠标监听并重置越界计数。
 */
const cleanupDrag = () => {
  // 1、先复位状态，避免清理期间的后续事件继续触发拖拽。
  isDragging.value = false
  hasTriggeredSystemDrag.value = false
  isNearBoundary.value = false
  currentDragImage.value = null
  
  // 2、统一释放拖动期间安装的监听。
  document.removeEventListener('mousemove', handleMouseMoveForDrag)
  document.removeEventListener('mouseup', handleMouseUpForDrag)
  window.removeEventListener('mouseout', handleWindowMouseOut)
  
  // 重置计数
  outsideConsecutiveCount = 0
}

// ==================== 生命周期管理 ====================

/**
 * 挂载生图组件时恢复任务并注册图片交互。
 * 处理流程：
 * 1、恢复默认比例和已有任务状态
 * 2、启动任务检查定时器并监听粘贴与拖拽完成事件
 * 3、注册拖拽订阅的卸载清理回调
 */
onMounted(() => {
  // 1、每次挂载恢复默认比例，再还原已有任务状态
  formData.aspectRatio = '16:9'
  console.log('页面挂载，比例已重置为16:9')
  
  // 恢复任务状态
  restoreTaskState()
  
  // 2、启动任务状态检查，并接收图片粘贴与系统拖拽事件
  taskCheckInterval.value = setInterval(checkTaskStatus, 2000)
  
  // 添加粘贴事件监听
  window.addEventListener('paste', handlePaste)
  
  // 监听拖拽完成事件
  const dragFinishedUnsubscribe = window.electronAPI?.onDragFinished?.((eventData) => {
    console.log('📁 拖拽完成，文件已保存:', eventData?.filePath)
    message.success('图片已保存并可拖拽到其他应用')
    setTimeout(() => cleanupDrag(), 100)
  })
  
  // 3、组件卸载时取消本次创建的系统拖拽订阅
  onUnmounted(() => {
    if (dragFinishedUnsubscribe) {
      dragFinishedUnsubscribe()
    }
  })
})

// ✅ keep-alive 激活时重置比例（解决路由缓存问题）
onActivated(() => {
  formData.aspectRatio = '16:9'
  console.log('页面激活(onActivated)，比例已重置为16:9')
})

/**
 * 卸载生图组件时停止轮询并释放交互资源。
 * 处理流程：
 * 1、停止任务检查定时器并解除粘贴监听
 * 2、清理拖拽状态与文件离开定时器
 * 3、移除系统拖拽完成事件监听
 */
onUnmounted(() => {
  // 1、停止任务检查，避免组件卸载后继续更新状态
  if (taskCheckInterval.value) {
    clearInterval(taskCheckInterval.value)
  }
  
  // 移除粘贴事件监听
  window.removeEventListener('paste', handlePaste)
  
  // 2、清理拖拽状态与文件拖入提示的延迟任务
  cleanupDrag()
  
  // 清理文件拖拽定时器
  if (dragLeaveTimeout) {
    clearTimeout(dragLeaveTimeout)
    dragLeaveTimeout = null
  }
  
  // 3、系统拖拽监听由注册处的取消函数处理，不清空共享通道。
})

/** 重置图片比例；处理流程：1、恢复默认 16:9，供父组件显式调用。 */
const resetAspectRatio = () => {
  // 1、只影响后续请求的比例选择。
  formData.aspectRatio = '16:9'
  console.log('外部调用：比例已重置为16:9')
}

defineExpose({
  resetAspectRatio
})
</script>

<style scoped src="./ImageGenerateComponent.css"></style>




