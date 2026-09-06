<template>
  <div
    class="hd-toolkit"
    v-motion
    :initial="{ opacity: 0, y: 8 }"
    :enter="{ opacity: 1, y: 0, transition: { duration: 300 } }"
    @dragenter.prevent="handleFileDragOver"
    @dragover.prevent="handleFileDragOver"
    @dragleave.prevent="handleFileDragLeave"
    @drop.prevent="handleFileDrop"
  >
    <div
      v-show="isFileDragging"
      class="file-drag-overlay"
    >
      <div class="drag-content">
        <div class="drag-icon">📂</div>
        <div class="drag-text">拖放图片到这里</div>
        <div class="drag-hint">支持 JPG/PNG/WebP，支持拖拽文件夹批量处理</div>
      </div>
    </div>
    <canvas
      v-show="isDraggingPreview && !hasTriggeredSystemDrag"
      ref="dragFollowCanvas"
      width="170"
      height="150"
      class="drag-follow-canvas"
      :style="{
        left: (dragMouseX - dragCalibration.dx) + 'px',
        top: (dragMouseY - dragCalibration.dy) + 'px',
        border: isNearBoundary ? '2px solid #18a058' : '2px solid #ddd'
      }"
    />
    <n-tabs
      v-model:value="activeSubTab"
      type="segment"
      size="large"
      justify-content="space-evenly"
      class="hd-subtabs"
      :class="{ 'hd-subtabs--no-nav': hideTabs }"
    >
      <n-tab-pane name="remove" tab="抠图">
        <div
          class="hd-pane"
        >
          <div class="hd-panel">
            <n-card title="抠图任务" :loading="loadingInitial" class="hd-card">
              <template #header-extra>
                <n-space size="small">
                  <n-button size="small" quaternary @click="clearFiles('remove')" :disabled="removeState.files.length === 0">
                    清空列表
                  </n-button>
                  <n-button size="small" quaternary @click="goSettings">
                    设置
                  </n-button>
                </n-space>
              </template>
              <n-space vertical :size="18">
                <div class="hd-field">
                  <n-text strong>抠图模型</n-text>
                  <n-select
                    v-model:value="removeState.selectedModel"
                    :options="removeModelOptions"
                    :disabled="loadingInitial"
                  />
                  <n-text depth="3" style="font-size: 12px;">
                    u2net: 通用;物品 | isnet-anime: 动漫;人像
                  </n-text>
                </div>
                <div class="hd-field">
                  <n-checkbox v-model:checked="removeState.alphaMatting">
                    启用 Alpha Matting（边缘更细腻，速度稍慢）
                  </n-checkbox>
                </div>
                <div class="hd-upload-wrapper" :class="{ 'is-dragging': removeState.isDragging }">
                  <div class="hd-upload-area" @click="handleSelectImages('remove')">
                    <div class="hd-upload-icon">✨</div>
                    <div class="hd-upload-text">
                      <div>点击或拖拽图片/文件夹到此处</div>
                      <n-text depth="3" style="font-size: 12px;">
                        支持 JPG/PNG/WebP，多选及原文件夹批量处理
                      </n-text>
                    </div>
                    <n-button type="primary" quaternary size="small">
                      选择图片
                    </n-button>
                  </div>
                </div>
                <div v-if="removeState.files.length > 0" class="hd-file-list">
                  <div
                    v-for="file in removeState.files"
                    :key="file.path || file.name"
                    class="hd-file-item"
                  >
                    <div class="hd-file-thumb">
                      <img v-if="file.url" :src="file.url" alt="" />
                      <div v-else class="hd-file-placeholder">📁</div>
                    </div>
                    <div class="hd-file-info">
                      <n-text strong>{{ file.name }}</n-text>
                      <n-text depth="3">{{ file.path || '临时文件' }}</n-text>
                    </div>
                    <n-button size="tiny" text @click="removeFile('remove', file)">
                      移除
                    </n-button>
                  </div>
                </div>
                <div class="hd-action-row">
                  <n-space :size="12">
                    <n-button
                      type="primary"
                      size="large"
                      :loading="removeState.isProcessing"
                      @click="runRemoveTask"
                    >
                      {{ removeState.isProcessing ? '正在抠图...' : '开始抠图' }}
                    </n-button>
                    <n-button
                      v-if="removeState.outputDirUsed"
                      secondary
                      size="large"
                      @click="openOutputFolder(removeState.outputDirUsed)"
                    >
                      打开输出目录
                    </n-button>
                  </n-space>
                </div>
              </n-space>
            </n-card>
          </div>
          <div class="hd-panel">
            <n-card title="输出预览" class="hd-card" :loading="removeState.isProcessing">
              <template #header-extra>
                <n-space :size="8" align="center">
                  <n-tag v-if="removeResultCount > 0" type="success" size="small">
                    {{ removeResultCount }} 张
                  </n-tag>
                  <n-button
                    v-if="removeState.results.length > 0"
                    size="tiny"
                    text
                    @click="clearResults('remove')"
                  >
                    清空预览
                  </n-button>
                </n-space>
              </template>
              <div v-if="removeState.results.length === 0" class="hd-empty">
                <div class="hd-empty-icon">🪄</div>
                <n-text depth="3">等待处理完成后展示图片预览</n-text>
              </div>
              <div v-else class="hd-result-grid">
                <div v-for="item in removeState.results" :key="item.path" class="hd-result-item">
                  <img :src="item.url" :alt="item.name" @mousedown="(event) => handleResultMouseDown(event, item)" />
                  <div class="hd-result-name">{{ item.name }}</div>
                  <n-button size="tiny" text @click="openOutputFolder(removeState.outputDirUsed, item.path)">
                    查看文件
                  </n-button>
                </div>
              </div>
            </n-card>
          </div>
        </div>
      </n-tab-pane>

      <n-tab-pane name="highres" tab="高清">
        <div
          class="hd-pane"
        >
          <div class="hd-panel">
            <n-card title="高清放大" :loading="loadingInitial" class="hd-card">
              <template #header-extra>
                <n-space size="small">
                  <n-button size="small" quaternary @click="clearFiles('highres')" :disabled="highresState.files.length === 0">
                    清空列表
                  </n-button>
                  <n-button size="small" quaternary @click="goSettings">
                    设置
                  </n-button>
                </n-space>
              </template>
              <n-space vertical :size="18">
                <div class="hd-field">
                  <n-text strong>选择模型</n-text>
                  <n-select
                    v-model:value="highresState.selectedModel"
                    :options="highresModelOptions"
                    :disabled="loadingInitial"
                  />
                </div>
                <div class="hd-field">
                  <n-text strong>性能模式</n-text>
                  <n-select
                    v-model:value="highresState.mode"
                    :options="performanceModeOptions"
                    :disabled="loadingInitial"
                  />
                  <n-text depth="3" style="font-size: 12px;">
                    auto: 自动检测GPU并优化 | gpu: 强制GPU模式 | cpu: 强制CPU模式 | fast: 快速2倍放大
                  </n-text>
                </div>
                <div class="hd-field">
                  <n-space :size="16">
                    <div class="hd-number-input">
                      <n-text depth="3">放大倍数</n-text>
                      <n-input-number v-model:value="highresState.outscale" :min="1" :max="8" />
                    </div>
                  </n-space>
                  <n-text depth="3" style="font-size: 12px;">
                    提示: 分块处理已自动优化，GPU模式更快（约10-100倍）
                  </n-text>
                </div>
                <div class="hd-upload-wrapper" :class="{ 'is-dragging': highresState.isDragging }">
                  <div class="hd-upload-area" @click="handleSelectImages('highres')">
                    <div class="hd-upload-icon">🚀</div>
                    <div class="hd-upload-text">
                      <div>点击或拖拽图片/文件夹到此处</div>
                      <n-text depth="3" style="font-size: 12px;">
                        支持批量高清放大，保持原文件名输出
                      </n-text>
                    </div>
                    <n-button type="primary" quaternary size="small">
                      选择图片
                    </n-button>
                  </div>
                </div>
                <div v-if="highresState.files.length > 0" class="hd-file-list">
                  <div
                    v-for="file in highresState.files"
                    :key="file.path || file.name"
                    class="hd-file-item"
                  >
                    <div class="hd-file-thumb">
                      <img v-if="file.url" :src="file.url" alt="" />
                      <div v-else class="hd-file-placeholder">📁</div>
                    </div>
                    <div class="hd-file-info">
                      <n-text strong>{{ file.name }}</n-text>
                      <n-text depth="3">{{ file.path || '临时文件' }}</n-text>
                    </div>
                    <n-button size="tiny" text @click="removeFile('highres', file)">
                      移除
                    </n-button>
                  </div>
                </div>
                <div class="hd-action-row">
                  <n-space :size="12">
                    <n-button
                      type="primary"
                      size="large"
                      :loading="highresState.isProcessing"
                      @click="runHighresTask"
                    >
                      {{ highresState.isProcessing ? '正在高清放大...' : '开始高清放大' }}
                    </n-button>
                    <n-button
                      v-if="highresState.outputDirUsed"
                      secondary
                      size="large"
                      @click="openOutputFolder(highresState.outputDirUsed)"
                    >
                      打开输出目录
                    </n-button>
                  </n-space>
                </div>
              </n-space>
            </n-card>
          </div>
          <div class="hd-panel">
            <n-card title="输出预览" class="hd-card" :loading="highresState.isProcessing">
              <template #header-extra>
                <n-space :size="8" align="center">
                  <n-tag v-if="highresResultCount > 0" type="success" size="small">
                    {{ highresResultCount }} 张
                  </n-tag>
                  <n-button
                    v-if="highresState.results.length > 0"
                    size="tiny"
                    text
                    @click="clearResults('highres')"
                  >
                    清空预览
                  </n-button>
                </n-space>
              </template>
              <div v-if="highresState.results.length === 0" class="hd-empty">
                <div class="hd-empty-icon">🖼️</div>
                <n-text depth="3">等待高清放大完成后展示预览</n-text>
              </div>
              <div v-else class="hd-result-grid">
                <div v-for="item in highresState.results" :key="item.path" class="hd-result-item">
                  <img :src="item.url" :alt="item.name" @mousedown="(event) => handleResultMouseDown(event, item)" />
                  <div class="hd-result-name">{{ item.name }}</div>
                  <n-button size="tiny" text @click="openOutputFolder(highresState.outputDirUsed, item.path)">
                    查看文件
                  </n-button>
                </div>
              </div>
            </n-card>
          </div>
        </div>
      </n-tab-pane>

      
    </n-tabs>
  </div>
</template>

<script setup>
/** 抠图高清面板：管理输入文件、模型参数、批量处理结果以及预览跨应用拖拽。 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, onActivated, watch, nextTick } from 'vue'
import { useMessage, NTabs, NTabPane, NCard, NSpace, NText, NButton, NSelect, NCheckbox, NInputNumber, NTag } from 'naive-ui'
import { useRouter } from 'vue-router'
import { buildGeminiDragConfig } from '@renderer/utils/geminiOutputConfig.js'

const message = useMessage()
const router = useRouter()

const ACTIVE_TABS = ['remove', 'highres']
const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const MAX_PREVIEW_ITEMS = 12
const MIN_DRAG_TIME_MS = 300
const OUTSIDE_DURATION_MS = 120
const OUTSIDE_COUNT_THRESHOLD = 2
const OUTSIDE_SAFE_MARGIN = 20
const FOLLOW_OFFSET_X = 20
const FOLLOW_OFFSET_Y = 20

const defaultConfig = {
  pythonHome: '',
  removebgWeightsDir: '',
  highresWeightsDir: '',
  outputDir: '',
  removebg: {
    modelId: 'isnet-anime（动漫；人像）',
    alphaMatting: false
  },
  highres: {
    modelId: 'RealESRGAN_x4plus_anime_6B',
    outscale: 2,        // 默认2倍放大
    mode: 'auto'        // 性能模式：auto自动检测GPU并优化参数
  }
}

const props = defineProps({
  modelValue: {
    type: String,
    default: null
  },
  hideTabs: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue'])

const config = reactive(deepClone(defaultConfig))

const removebgModels = ref([])
const highresModels = ref([])

/** 规范工具页签；处理流程：1、仅接受抠图和高清页签，其余返回空值。 */
const normalizeTab = (tab) => (ACTIVE_TABS.includes(tab) ? tab : null)

const activeSubTab = ref(normalizeTab(props.modelValue) || 'remove')
const hideTabs = computed(() => props.hideTabs)
const loadingInitial = ref(false)
const savingConfig = ref(false)
let autoSaveTimer = null

/**
 * 合并连续的参数保存请求。
 * 处理流程：
 * 1、取消旧延时任务，等待最后一次参数变化后静默保存。
 */
function scheduleAutoSave() {
  // 1、避免拖动参数控件时每次变化都立即写入配置。
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer)
    autoSaveTimer = null
  }
  autoSaveTimer = setTimeout(() => {
    persistConfig(false)
  }, 600)
}

const removeState = reactive({
  files: [],
  isDragging: false,
  isProcessing: false,
  selectedModel: defaultConfig.removebg.modelId,
  alphaMatting: defaultConfig.removebg.alphaMatting,
  outputDirUsed: '',
  results: []
})

const highresState = reactive({
  files: [],
  isDragging: false,
  isProcessing: false,
  selectedModel: defaultConfig.highres.modelId,
  outscale: defaultConfig.highres.outscale,
  mode: defaultConfig.highres.mode,
  outputDirUsed: '',
  results: []
})

const isFileDragging = ref(false)
let dragLeaveTimer = null

const isDraggingPreview = ref(false)
const hasTriggeredSystemDrag = ref(false)
const isNearBoundary = ref(false)
const dragMouseX = ref(0)
const dragMouseY = ref(0)
const dragCalibration = ref({ dx: 85, dy: 85 })
const windowBounds = ref({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight })
const dragFollowCanvas = ref(null)
const currentDragImage = ref(null)

let dragStartTime = 0
let dragStartX = 0
let dragStartY = 0
let outsideConsecutiveCount = 0
let outsideFirstTs = 0

let dragFinishedUnsubscribe = null

const removeModelOptions = computed(() =>
  removebgModels.value.map((model) => ({
    label: model.display,
    value: model.id
  }))
)

const highresModelOptions = computed(() =>
  highresModels.value.map((model) => ({
    label: model.display,
    value: model.id
  }))
)

const performanceModeOptions = [
  { label: '🚀 自动优化 (推荐)', value: 'auto' },
  { label: '⚡ GPU模式', value: 'gpu' },
  { label: '💻 CPU模式', value: 'cpu' },
  { label: '🏃 快速模式 (2倍)', value: 'fast' }
]

const removeResultCount = computed(() => removeState.results.length)
const highresResultCount = computed(() => highresState.results.length)


/**
 * 初始化抠图高清工具的配置和图片交互。
 * 处理流程：
 * 1、加载初始配置，注册粘贴与窗口尺寸监听并更新窗口边界
 * 2、订阅系统拖拽完成事件，反馈保存结果并延迟清理预览拖拽
 */
onMounted(async () => {
  // 1、先准备配置与窗口边界，再接收后续图片交互
  await loadInitialData()
  window.addEventListener('paste', handlePaste)
  window.addEventListener('resize', updateWindowBounds)
  await updateWindowBounds()

  // 2、系统拖拽完成后提示结果，并等待手势结束再清理浮层
  if (window.electronAPI?.onDragFinished) {
    dragFinishedUnsubscribe = window.electronAPI.onDragFinished((eventData) => {
      if (eventData?.filePath) {
        message.success('图片已保存，可拖拽到其他应用')
      }
      setTimeout(() => cleanupPreviewDrag(), 100)
    })
  }
})

onActivated(async () => {
  console.log('[HD Toolkit] 页面激活，重新加载配置...')
  await loadInitialData()
})

/**
 * 在抠图高清工具卸载前清理事件和拖拽状态。
 * 处理流程：
 * 1、解除粘贴、窗口尺寸及系统拖拽完成监听
 * 2、清除拖拽离开定时器，重置文件拖入和预览拖拽状态
 */
onBeforeUnmount(() => {
  // 1、成对移除挂载阶段注册的事件
  window.removeEventListener('paste', handlePaste)
  window.removeEventListener('resize', updateWindowBounds)
  if (dragFinishedUnsubscribe) {
    dragFinishedUnsubscribe()
    dragFinishedUnsubscribe = null
  }
  // 2、停止延迟回调并恢复各面板的拖拽状态
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  isFileDragging.value = false
  setActivePaneDragging(false)
  cleanupPreviewDrag()
})

watch(
  () => props.modelValue,
  (newValue) => {
    const normalized = normalizeTab(newValue)
    if (normalized && normalized !== activeSubTab.value) {
      activeSubTab.value = normalized
    }
  }
)

watch(activeSubTab, (newValue) => {
  const normalized = normalizeTab(props.modelValue)
  if (normalized !== newValue) {
    emit('update:modelValue', newValue)
  }
})

watch(() => removeState.selectedModel, (val) => {
  config.removebg.modelId = val
  scheduleAutoSave()
})

watch(() => removeState.alphaMatting, (val) => {
  config.removebg.alphaMatting = val
  scheduleAutoSave()
})

watch(
  () => [
    highresState.selectedModel,
    highresState.outscale,
    highresState.mode
  ],
  () => {
    config.highres.modelId = highresState.selectedModel
    config.highres.outscale = Number(highresState.outscale) || 4
    config.highres.mode = highresState.mode || 'auto'
    scheduleAutoSave()
  },
  { deep: true }
)

/** 复制普通配置；处理流程：1、通过 JSON 序列化生成独立对象。 */
function deepClone(obj) {
  // 1、仅用于可 JSON 序列化的配置值。
  return JSON.parse(JSON.stringify(obj))
}

/** 提取文件名；处理流程：1、按两种路径分隔符拆分，返回最后一段。 */
function extractName(filePath) {
  // 1、兼容 Windows 与 POSIX 路径。
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]+/)
  return parts[parts.length - 1] || filePath
}

/**
 * 判断是否为文件类拖拽。
 * 处理流程：
 * 1、无拖拽数据时沿用当前状态，否则识别文件或 URI 列表类型。
 */
function isFileDragEvent(event) {
  // 1、兼容系统文件管理器使用 URI 列表传递文件的情况。
  if (!event || !event.dataTransfer) return isFileDragging.value
  const types = Array.from(event.dataTransfer.types || [])
  return types.includes('Files') || types.includes('text/uri-list')
}

/** 获取投放目标；处理流程：1、按当前页签返回抠图或高清状态，无匹配时返回 null。 */
function getActiveDropState() {
  // 1、文件只进入当前活动工具的输入列表。
  if (activeSubTab.value === 'remove') return removeState
  if (activeSubTab.value === 'highres') return highresState
  return null
}

/**
 * 更新投放区域高亮。
 * 处理流程：
 * 1、开启时仅高亮当前页签，关闭或未知页签时清除两侧高亮。
 */
function setActivePaneDragging(active) {
  // 1、两个工具的投放遮罩互斥显示。
  if (active) {
    if (activeSubTab.value === 'remove') {
      removeState.isDragging = true
      highresState.isDragging = false
    } else if (activeSubTab.value === 'highres') {
      highresState.isDragging = true
      removeState.isDragging = false
    } else {
      removeState.isDragging = false
      highresState.isDragging = false
    }
  } else {
    removeState.isDragging = false
    highresState.isDragging = false
  }
}

/** 拆分文件名与扩展名；处理流程：1、按最后一个点分割，无点时保留完整名称。 */
function splitFileName(name) {
  // 1、扩展名保留点号，便于后续拼接重名序号。
  const lastDot = name.lastIndexOf('.')
  if (lastDot === -1) {
    return { basename: name, extension: '' }
  }
  const basename = name.slice(0, lastDot)
  const extension = name.slice(lastDot)
  return { basename, extension }
}

/**
 * 为输入列表生成不重复的显示名。
 * 处理流程：
 * 1、原名称未占用时直接使用。
 * 2、在扩展名前依次附加序号，直到找到空闲名称。
 */
function generateUniqueName(existingNames, originalName) {
  // 1、仅处理列表显示名，不重命名磁盘源文件。
  let candidate = originalName
  if (!existingNames.has(candidate)) return candidate

  // 2、递增序号并保留原扩展名。
  const { basename, extension } = splitFileName(originalName)
  let index = 1
  while (true) {
    candidate = `${basename}_${index}${extension}`
    if (!existingNames.has(candidate)) {
      return candidate
    }
    index += 1
  }
}

/** 判断可预览图片路径；处理流程：1、转为小写后检查支持的扩展名。 */
function isImagePath(filePath) {
  // 1、按路径后缀筛选，不读取文件内容判断格式。
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  return IMAGE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * 加载主进程工具配置与模型列表。
 * 处理流程：
 * 1、请求初始数据，将保存配置与默认参数合并。
 * 2、更新模型选项和两类工具状态，结束时解除加载标志。
 */
async function loadInitialData() {
  // 1、页面初次挂载和缓存激活均使用此入口恢复设置。
  if (!window?.hdToolkit?.getInitialData) return
  loadingInitial.value = true
  try {
    console.log('[HD Toolkit] 开始加载配置...')
    const response = await window.hdToolkit.getInitialData()
    if (response?.success) {
      const data = response.data || {}
      const cfg = data.config || {}
      console.log('[HD Toolkit] 收到配置:', {
        pythonHome: cfg.pythonHome,
        removebgWeightsDir: cfg.removebgWeightsDir,
        highresWeightsDir: cfg.highresWeightsDir,
        outputDir: cfg.outputDir
      })
      
      config.pythonHome = cfg.pythonHome || defaultConfig.pythonHome
      config.removebgWeightsDir = cfg.removebgWeightsDir || defaultConfig.removebgWeightsDir
      config.highresWeightsDir = cfg.highresWeightsDir || defaultConfig.highresWeightsDir
      config.outputDir = cfg.outputDir || defaultConfig.outputDir
      Object.assign(config.removebg, deepClone(defaultConfig.removebg), cfg.removebg || {})
      Object.assign(config.highres, deepClone(defaultConfig.highres), cfg.highres || {})

      // 2、模型列表用于选择器，实际选择优先使用保存的模型标识。
      removebgModels.value = Array.isArray(data.removebgModels) ? data.removebgModels : []
      highresModels.value = Array.isArray(data.highresModels) ? data.highresModels : []

      removeState.selectedModel =
        config.removebg.modelId ||
        (removebgModels.value[0] ? removebgModels.value[0].id : defaultConfig.removebg.modelId)
      removeState.alphaMatting = Boolean(config.removebg.alphaMatting)

      highresState.selectedModel =
        config.highres.modelId ||
        (highresModels.value[0] ? highresModels.value[0].id : defaultConfig.highres.modelId)
      highresState.outscale = config.highres.outscale ?? defaultConfig.highres.outscale
      highresState.mode = config.highres.mode ?? defaultConfig.highres.mode
      
      console.log('[HD Toolkit] ✅ 配置加载成功')
    } else {
      message.error(response?.message || '读取抠图高清配置失败')
    }
  } catch (error) {
    console.error('[HD Toolkit] 加载失败:', error)
    message.error('加载抠图高清配置失败: ' + error.message)
  } finally {
    loadingInitial.value = false
  }
}

/**
 * 接收文件拖入并显示投放区域。
 * 处理流程：
 * 1、确认文件类型，取消旧离开计时并高亮当前工具。
 */
function handleFileDragOver(event) {
  // 1、进入子元素产生的重复事件不会叠加计时器。
  if (!isFileDragEvent(event)) return
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  isFileDragging.value = true
  setActivePaneDragging(true)
}

/**
 * 延迟隐藏文件投放高亮。
 * 处理流程：
 * 1、替换旧计时任务，短暂等待后清空拖入状态与高亮。
 */
function handleFileDragLeave(event) {
  // 1、延迟用于消除跨子元素时的高亮闪烁。
  if (!isFileDragging.value && !dragLeaveTimer) return
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  dragLeaveTimer = setTimeout(() => {
    isFileDragging.value = false
    setActivePaneDragging(false)
    dragLeaveTimer = null
  }, 80)
}

/**
 * 将落下的文件登记到当前工具。
 * 处理流程：
 * 1、清除遮罩，优先读取文件列表，空列表时尝试解析 URI 列表。
 * 2、有路径的条目直接使用，无路径的 File 先保存为临时图片。
 * 3、规范列表记录并交给统一添加入口处理重名。
 */
async function handleFileDrop(event) {
  // 1、落下后立即解除拖入状态，避免异步读取期间仍显示遮罩。
  if (dragLeaveTimer) {
    clearTimeout(dragLeaveTimer)
    dragLeaveTimer = null
  }
  isFileDragging.value = false
  setActivePaneDragging(false)

  let files = Array.from(event.dataTransfer?.files || [])

  if (!files.length && event?.dataTransfer) {
    const uriList = event.dataTransfer.getData('text/uri-list') || ''
    if (uriList.trim()) {
      const paths = uriList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((uri) => decodeURI(uri.replace(/^file:\/+/, '')))
      files = paths.map((filePath) => ({
        path: filePath,
        name: extractName(filePath)
      }))
    }
  }

  if (!files.length) return

  const state = getActiveDropState()
  if (!state) return

  // 2、逐条准备路径和可选预览，单张失败不阻断其他条目。
  const formatted = []
  for (const file of files) {
    if (!file) continue

    if (file.path) {
      const item = {
        name: file.name || extractName(file.path),
        path: file.path,
        size: file.size
      }
      if (file.type && file.type.startsWith('image/')) {
        try {
          const dataUrl = await readFileAsDataUrl(file)
          item.url = dataUrl
        } catch {
          // 预览读取失败时仍保留源路径，允许后续处理。
        }
      }
      formatted.push(item)
      continue
    }

    if (file instanceof File) {
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const base64Data = dataUrl.split(',')[1]
        const tempName = file.name || `拖拽图片-${Date.now()}.png`
        const result = await window.fileSystem.saveTempImage(base64Data, tempName)
        if (result?.success && result.path) {
          formatted.push({
            name: tempName,
            path: result.path,
            url: dataUrl,
            size: file.size
          })
        }
      } catch (error) {
        console.warn('[HD Toolkit] 保存拖拽图片失败:', error)
      }
    }
  }

  if (formatted.length === 0) return

  // 3、统一登记输入项并避免显示名重复。
  addFilesToState(state, formatted)
  message.success(`已添加 ${formatted.length} 个条目`)
}

/** 读取文件预览数据；处理流程：1、通过 FileReader 返回数据地址，失败时拒绝 Promise。 */
function readFileAsDataUrl(file) {
  // 1、异步读取结果供预览或临时文件保存复用。
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (event) => resolve(event.target.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 选择指定工具的输入图片。
 * 处理流程：
 * 1、调用系统图片选择器，将成功结果加入目标工具并提示数量。
 */
async function handleSelectImages(target) {
  // 1、取消选择不会清空已添加文件。
  if (!window?.fileSystem?.selectImageFiles) return
  try {
    const result = await window.fileSystem.selectImageFiles()
    if (result?.success && Array.isArray(result.files)) {
      const state = target === 'remove' ? removeState : highresState
      addFilesToState(state, result.files)
      if (result.files.length > 0) {
        message.success(`已选择 ${result.files.length} 张图片`)
      }
    }
  } catch (error) {
    console.error('[HD Toolkit] 选择图片失败:', error)
    message.error('选择图片失败: ' + error.message)
  }
}

/**
 * 将文件条目加入目标输入列表。
 * 处理流程：
 * 1、收集已用名称，忽略缺少路径的条目。
 * 2、分配唯一显示名，保留原名称、路径和预览信息。
 */
function addFilesToState(state, items) {
  // 1、同路径可多次加入，但列表显示名保持可区分。
  if (!Array.isArray(items) || items.length === 0) return
  const existingNames = new Set(state.files.map((item) => item.name))

  // 2、每次添加后更新名称集合，防止本批次内部重名。
  for (const item of items) {
    if (!item || !item.path) continue

    const baseName = item.name || extractName(item.path)
    const uniqueName = generateUniqueName(existingNames, baseName)

    state.files.push({
      name: uniqueName,
      originalName: baseName,
      path: item.path,
      url: item.url || null,
      size: item.size,
      isTemp: item.isTemp || false
    })

    existingNames.add(uniqueName)
  }
}

/** 清空工具输入；处理流程：1、定位目标列表并原地删除全部条目。 */
function clearFiles(target) {
  // 1、保持响应式数组引用，不删除磁盘文件。
  const state = target === 'remove' ? removeState : highresState
  state.files.splice(0, state.files.length)
}

/** 移除单个输入条目；处理流程：1、按对象引用定位目标列表中的记录并删除。 */
function removeFile(target, fileToRemove) {
  // 1、条目不存在时保留列表原样。
  if (!fileToRemove) return
  const state = target === 'remove' ? removeState : highresState
  const index = state.files.indexOf(fileToRemove)
  if (index !== -1) {
    state.files.splice(index, 1)
  }
}

/**
 * 执行批量抠图。
 * 处理流程：
 * 1、检查输入、解释器、权重和输出目录，缺配置时引导到设置页。
 * 2、提交模型与输入路径，成功后加载结果并静默保存参数。
 * 3、失败时提示原因，结束时恢复处理按钮。
 */
async function runRemoveTask() {
  // 1、前置校验完成前不进入忙碌状态。
  if (!window?.hdToolkit?.runRemovebg) return
  if (removeState.files.length === 0) {
    message.warning('请先选择至少一张图片或文件夹')
    return
  }
  if (!config.pythonHome) {
    message.error('请先在设置页配置 Python 解释器路径')
    router.push('/settings/hd-toolkit')
    return
  }
  if (!config.removebgWeightsDir) {
    message.error('请配置去背景模型权重目录')
    router.push('/settings/hd-toolkit')
    return
  }
  if (!config.outputDir) {
    message.error('请设置输出图片保存目录')
    router.push('/settings/hd-toolkit')
    return
  }
  // 2、只锁定抠图操作，高清面板有独立处理状态。
  removeState.isProcessing = true
  try {
    const payload = {
      inputPaths: removeState.files.map((item) => item.path).filter(Boolean),
      modelId: removeState.selectedModel,
      alphaMatting: removeState.alphaMatting,
      outputDir: config.outputDir
    }
    const response = await window.hdToolkit.runRemovebg(payload)
    if (response?.success) {
      await handleRunSuccess('remove', response.data)
      message.success('抠图处理完成')
      await persistConfig(false)
    } else {
      message.error(response?.message || '抠图处理失败')
    }
  } catch (error) {
    console.error('[HD Toolkit] 去背景失败:', error)
    message.error('抠图处理失败: ' + error.message)
  } finally {
    removeState.isProcessing = false
  }
}

/**
 * 执行批量高清放大。
 * 处理流程：
 * 1、检查输入和运行路径，缺配置时引导用户设置。
 * 2、提交模型、倍率和性能模式，成功后刷新结果并保存参数。
 * 3、处理失败提示，结束时解除忙碌状态。
 */
async function runHighresTask() {
  // 1、分块大小与硬件参数由主进程根据性能模式决定。
  if (!window?.hdToolkit?.runHighres) return
  if (highresState.files.length === 0) {
    message.warning('请先选择至少一张图片或文件夹')
    return
  }
  if (!config.pythonHome) {
    message.error('请先在设置页配置 Python 解释器路径')
    router.push('/settings/hd-toolkit')
    return
  }
  if (!config.highresWeightsDir) {
    message.error('请配置高清模型权重目录')
    router.push('/settings/hd-toolkit')
    return
  }
  if (!config.outputDir) {
    message.error('请设置输出图片保存目录')
    router.push('/settings/hd-toolkit')
    return
  }
  // 2、只传入用户选项，具体模型执行交给主进程服务。
  highresState.isProcessing = true
  try {
    const payload = {
      inputPaths: highresState.files.map((item) => item.path).filter(Boolean),
      modelId: highresState.selectedModel,
      outputDir: config.outputDir,
      outscale: Number(highresState.outscale) || 4,
      mode: highresState.mode || 'auto'
      // tile, tilePad, prePad, half 全部由后端根据mode自动优化
    }
    const response = await window.hdToolkit.runHighres(payload)
    if (response?.success) {
      await handleRunSuccess('highres', response.data)
      message.success('高清放大完成')
      await persistConfig(false)
    } else {
      message.error(response?.message || '高清放大失败')
    }
  } catch (error) {
    console.error('[HD Toolkit] 高清失败:', error)
    message.error('高清放大失败: ' + error.message)
  } finally {
    highresState.isProcessing = false
  }
}

/**
 * 将处理成功结果同步到对应工具。
 * 处理流程：
 * 1、提取输出文件并加载有限数量的图片预览。
 * 2、更新目标结果列表，有可用预览时保留输出目录入口。
 */
async function handleRunSuccess(type, data) {
  // 1、输出文件列表可能包含非图片，预览加载器负责过滤。
  if (!data) return
  const files = Array.isArray(data.files) ? data.files : []
  const outputDir = typeof data.outputDir === 'string' ? data.outputDir : ''
  const results = await loadLimitedPreviews(files)

  // 2、两类工具分别维护结果与本次输出目录。
  if (type === 'remove') {
    removeState.results = results
    removeState.outputDirUsed = results.length > 0 ? outputDir : ''
  } else {
    highresState.results = results
    highresState.outputDirUsed = results.length > 0 ? outputDir : ''
  }
}

/**
 * 加载有限数量的处理结果预览。
 * 处理流程：
 * 1、按扩展名筛选图片，逐张请求主进程读取预览。
 * 2、只累计成功预览，达到数量上限后停止。
 */
async function loadLimitedPreviews(files) {
  // 1、限制成功预览数量，避免大批次结果同时占用过多内存。
  if (!Array.isArray(files) || files.length === 0) return []
  const previews = []
  for (const filePath of files) {
    if (!isImagePath(filePath)) continue
    try {
      const response = await window.hdToolkit.getImagePreview(filePath)
      if (response?.success && response.data?.dataUrl) {
        previews.push({
          path: filePath,
          url: response.data.dataUrl,
          name: extractName(filePath)
        })
        if (previews.length >= MAX_PREVIEW_ITEMS) {
          break
        }
      }
    } catch (error) {
      console.warn('[HD Toolkit] 预览失败:', filePath, error)
    }
  }
  return previews
}

/**
 * 更新拖拽使用的窗口边界。
 * 处理流程：
 * 1、尝试从接口返回对象读取位置与尺寸字段。
 * 2、无法读取对象时回退到浏览器屏幕坐标和窗口尺寸。
 */
const updateWindowBounds = async () => {
  // 1、此读取路径按返回对象的顶层字段取值，缺失字段使用默认值。
  try {
    if (window.electronAPI?.getWindowBounds) {
      const bounds = await window.electronAPI.getWindowBounds()
      if (bounds && typeof bounds === 'object') {
        windowBounds.value = {
          x: bounds.x ?? 0,
          y: bounds.y ?? 0,
          width: bounds.width ?? window.innerWidth,
          height: bounds.height ?? window.innerHeight
        }
        return
      }
    }
  } catch (error) {
    console.warn('[HD Toolkit] 获取窗口边界失败，使用默认值', error)
  }
  windowBounds.value = {
    x: window.screenX || 0,
    y: window.screenY || 0,
    width: window.outerWidth || window.innerWidth,
    height: window.outerHeight || window.innerHeight
  }
}

/** 检查拖拽出窗；处理流程：1、将屏幕坐标与扩展安全边距后的窗口四边比较。 */
const checkMouseOutsideWindow = (screenX, screenY, safeMargin = OUTSIDE_SAFE_MARGIN) => {
  // 1、窗口边缘的小幅波动不直接触发系统拖拽。
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
 * 加载图片到原尺寸画布。
 * 处理流程：
 * 1、图片加载成功时绘制并返回画布，失败时返回 null。
 */
const createImageCanvas = (imageUrl) => {
  // 1、画布既用于预览也用于拖拽导出。
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
 * 绘制跟随指针的拖拽缩略图。
 * 处理流程：
 * 1、清空旧内容并建立圆角裁切。
 * 2、计算等比缩放，水平居中、靠底部绘制源图片。
 */
const drawDragPreview = (canvas, sourceCanvas) => {
  // 1、预览不改变源图片画布。
  const ctx = canvas.getContext('2d')
  const canvasWidth = Number(canvas.width) || 170
  const canvasHeight = Number(canvas.height) || 150

  ctx.clearRect(0, 0, canvasWidth, canvasHeight)
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(5, 5, canvasWidth - 10, canvasHeight - 10, 12)
  ctx.clip()

  // 2、按两边可用空间中较小的比例缩放，保留预览边距。
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
 * 清理结果拖拽交互。
 * 处理流程：
 * 1、重置预览图片、标志和面板高亮。
 * 2、释放全局鼠标监听并清空出窗计数。
 */
const cleanupPreviewDrag = () => {
  // 1、先复位标志，后续事件不会继续推进旧拖拽。
  isDraggingPreview.value = false
  hasTriggeredSystemDrag.value = false
  isNearBoundary.value = false
  currentDragImage.value = null
  setActivePaneDragging(false)
  document.removeEventListener('mousemove', handleMouseMoveForPreview)
  document.removeEventListener('mouseup', handlePreviewMouseUp)
  window.removeEventListener('mouseout', handleWindowMouseOut)
  outsideConsecutiveCount = 0
}

/**
 * 开始拖动处理结果。
 * 处理流程：
 * 1、仅接受带图片的左键事件，记录起点和拖拽状态。
 * 2、等待预览画布挂载后绘制，再注册全局监听并更新窗口边界。
 */
const handleResultMouseDown = async (event, imageData) => {
  // 1、先记录状态，使跟随画布可以通过响应式条件渲染。
  if (!imageData || event.button !== 0) return
  try {
    event.preventDefault()
    dragStartTime = Date.now()
    dragStartX = event.clientX
    dragStartY = event.clientY
    isDraggingPreview.value = true
    hasTriggeredSystemDrag.value = false
    isNearBoundary.value = false
    currentDragImage.value = imageData
    dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
    dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y

    // 2、等待画布节点创建，再准备预览和跨元素鼠标监听。
    await nextTick()
    try {
      if (dragFollowCanvas.value && imageData.url) {
        const sourceCanvas = await createImageCanvas(imageData.url)
        if (sourceCanvas) {
          drawDragPreview(dragFollowCanvas.value, sourceCanvas)
          dragCalibration.value = { dx: 170 / 2, dy: 150 / 2 + 15 }
        }
      }
    } catch (error) {
      console.warn('[HD Toolkit] 预览绘制失败', error)
      dragCalibration.value = { dx: 85, dy: 85 }
    }

    document.addEventListener('mousemove', handleMouseMoveForPreview, { passive: false })
    document.addEventListener('mouseup', handlePreviewMouseUp, { once: true })
    window.addEventListener('mouseout', handleWindowMouseOut)
    await updateWindowBounds()
  } catch (error) {
    console.error('[HD Toolkit] 初始化混合拖拽失败:', error)
    cleanupPreviewDrag()
  }
}

/**
 * 跟随指针并检测结果是否拖出窗口。
 * 处理流程：
 * 1、更新预览位置，过滤短距离与保护期内的移动。
 * 2、连续出窗达到次数和时间阈值时转入系统拖拽。
 * 3、重新进入窗口时重置出窗计数。
 */
const handleMouseMoveForPreview = (event) => {
  // 1、系统拖拽接管后不再处理应用内移动。
  if (!isDraggingPreview.value || hasTriggeredSystemDrag.value) return
  try {
    dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
    dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y

    const deltaX = event.clientX - dragStartX
    const deltaY = event.clientY - dragStartY
    const dragDistance = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    if (dragDistance < 5) return

    const dragDuration = Date.now() - dragStartTime
    if (dragDuration < MIN_DRAG_TIME_MS) {
      const isFastDrag = dragDistance > 50 && dragDuration > 50
      if (!isFastDrag) return
    }

    // 2、次数与持续时间共同抑制窗口边界抖动。
    const outsideNow = checkMouseOutsideWindow(event.screenX, event.screenY, OUTSIDE_SAFE_MARGIN)
    if (outsideNow) {
      const now = Date.now()
      if (outsideConsecutiveCount === 0) outsideFirstTs = now
      outsideConsecutiveCount += 1
      const outsideDuration = now - outsideFirstTs
      isNearBoundary.value = true
      if (outsideConsecutiveCount >= OUTSIDE_COUNT_THRESHOLD && outsideDuration >= OUTSIDE_DURATION_MS) {
        hasTriggeredSystemDrag.value = true
        window.removeEventListener('mouseout', handleWindowMouseOut)
        document.removeEventListener('mousemove', handleMouseMoveForPreview)
        setTimeout(async () => {
          await triggerSystemDrag()
          setTimeout(() => cleanupPreviewDrag(), 50)
        }, 10)
        outsideConsecutiveCount = 0
        return
      }
    } else {
      outsideConsecutiveCount = 0
      isNearBoundary.value = false
    }
  } catch (error) {
    console.error('[HD Toolkit] 混合拖拽move处理失败:', error)
  }
}

/** 结束预览拖动；处理流程：1、鼠标释放时调用统一清理入口。 */
const handlePreviewMouseUp = () => {
  // 1、释放全局监听并移除跟随预览。
  cleanupPreviewDrag()
}

/**
 * 处理拖拽期间的窗口离开事件。
 * 处理流程：
 * 1、过滤非拖动、保护期内和元素间移动。
 * 2、复核屏幕越界，累计次数与时长后转入系统拖拽。
 */
const handleWindowMouseOut = (event) => {
  // 1、快速拖出允许较短保护期，仍需满足连续越界条件。
  if (!isDraggingPreview.value || hasTriggeredSystemDrag.value) return
  const dragDuration = Date.now() - dragStartTime
  const deltaX = event.screenX - (windowBounds.value.x + windowBounds.value.width / 2)
  const deltaY = event.screenY - (windowBounds.value.y + windowBounds.value.height / 2)
  const distanceFromCenter = Math.sqrt(deltaX * deltaX + deltaY * deltaY)
  const isFastExit = distanceFromCenter > 100 && dragDuration > 50

  if (dragDuration < MIN_DRAG_TIME_MS && !isFastExit) return
  const toEl = event.relatedTarget || event.toElement
  if (toEl !== null) return

  if (!checkMouseOutsideWindow(event.screenX, event.screenY)) return
  const now = Date.now()
  if (outsideConsecutiveCount === 0) outsideFirstTs = now
  outsideConsecutiveCount += 1
  const outsideDuration = now - outsideFirstTs
  const totalDragDuration = now - dragStartTime
  const isFastDrag = totalDragDuration < MIN_DRAG_TIME_MS
  const requiredDuration = isFastDrag ? 10 : OUTSIDE_DURATION_MS

  if (outsideConsecutiveCount < OUTSIDE_COUNT_THRESHOLD || outsideDuration < requiredDuration) return

  hasTriggeredSystemDrag.value = true
  window.removeEventListener('mouseout', handleWindowMouseOut)
  document.removeEventListener('mousemove', handleMouseMoveForPreview)
  setTimeout(async () => {
    await triggerSystemDrag()
    setTimeout(() => cleanupPreviewDrag(), 50)
  }, 10)
  outsideConsecutiveCount = 0
}

/**
 * 将结果图片转为本地文件并开始系统拖拽。
 * 处理流程：
 * 1、加载预览图片，编码 PNG 并分块转换 Base64。
 * 2、准备图标、建议文件名和导出配置。
 * 3、优先调用专用拖拽桥接方法，缺失时尝试通用 IPC。
 */
const createTempFileAndDrag = async () => {
  // 1、所有失败分支返回结果对象，由上层统一提示。
  if (!currentDragImage.value) return { success: false, error: '缺少图像数据' }
  const imageUrl = currentDragImage.value.url
  if (!imageUrl) return { success: false, error: '图像预览不存在' }
  try {
    const canvas = await createImageCanvas(imageUrl)
    if (!canvas) return { success: false, error: '无法创建图像canvas' }
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve({ success: false, error: '无法创建图像Blob' })
          return
        }
        try {
          const buffer = await blob.arrayBuffer()
          const base64 = (() => {
            const bytes = new Uint8Array(buffer)
            const chunkSize = 0x8000
            let binary = ''
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const sub = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
              binary += String.fromCharCode.apply(null, sub)
            }
            return btoa(binary)
          })()

          // 2、系统拖拽图标与实际导出文件使用同一画布来源。
          const iconPayload = {
            dataURL: canvas.toDataURL(),
            size: 64
          }

          const suggestedName = currentDragImage.value.name || `hd-image-${Date.now()}.png`
          const dragConfig = buildGeminiDragConfig()
          let result
          // 3、兼容专用桥接和通用调用两种预加载接口。
          if (window.electronAPI?.createTempFileAndStartDrag) {
            result = await window.electronAPI.createTempFileAndStartDrag(base64, iconPayload, suggestedName, dragConfig)
          } else if (window.electronAPI?.invoke) {
            result = await window.electronAPI.invoke('create-temp-file-and-start-drag', base64, iconPayload, suggestedName, dragConfig)
          } else {
            result = { success: false, error: 'electronAPI不可用' }
          }
          resolve(result)
        } catch (error) {
          resolve({ success: false, error: error.message })
        }
      }, 'image/png', 1)
    })
  } catch (error) {
    return { success: false, error: error.message }
  }
}

/**
 * 发起系统拖拽并提示失败。
 * 处理流程：
 * 1、调用文件生成与拖拽入口，将失败结果或异常转换为消息。
 */
const triggerSystemDrag = async () => {
  // 1、成功反馈由主进程拖拽完成事件负责。
  try {
    const result = await createTempFileAndDrag()
    if (!result?.success) {
      message.error('图片保存失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    message.error('拖拽失败: ' + error.message)
  }
}

/** 打开结果位置；处理流程：1、优先使用具体文件路径，否则打开输出目录。 */
async function openOutputFolder(folderPath, filePath) {
  // 1、系统打开行为由主进程文件接口执行。
  if (!window?.fileSystem?.openFolder) return
  const targetPath = filePath || folderPath
  if (!targetPath) return
  try {
    const result = await window.fileSystem.openFolder(targetPath)
    if (!result?.success) {
      message.error(result?.error || '打开文件夹失败')
    }
  } catch (error) {
    message.error('打开文件夹失败: ' + error.message)
  }
}

/**
 * 将剪贴板图片加入当前工具。
 * 处理流程：
 * 1、确认当前为处理页签，筛选剪贴板图片。
 * 2、读取图片并保存临时文件，成功后加入对应输入列表。
 */
async function handlePaste(event) {
  // 1、仅拦截图片项，保留普通文本粘贴。
  if (!ACTIVE_TABS.includes(activeSubTab.value)) return
  if (activeSubTab.value === 'settings') return
  const items = event.clipboardData?.items
  if (!items) return

  for (const item of items) {
    if (item.type.indexOf('image') !== -1) {
      event.preventDefault()
      const file = item.getAsFile()
      if (!file) continue
      try {
        const dataUrl = await readFileAsDataUrl(file)
        const base64Data = dataUrl.split(',')[1]
        const tempName = `粘贴图片-${Date.now()}.png`
        const result = await window.fileSystem.saveTempImage(base64Data, tempName)
        if (result?.success && result.path) {
          const targetState = activeSubTab.value === 'remove' ? removeState : highresState
          targetState.files.push({
            name: tempName,
            path: result.path,
            url: dataUrl,
            size: file.size,
            isTemp: true
          })
          message.success('已添加粘贴图片')
        } else {
          message.error(result?.error || '保存粘贴图片失败')
        }
      } catch (error) {
        console.error('[HD Toolkit] 粘贴处理失败:', error)
        message.error('处理粘贴图片失败: ' + error.message)
      }
    }
  }
}

/** 打开环境设置；处理流程：1、导航到抠图高清专用设置路由。 */
function goSettings() {
  // 1、环境路径与模型位置在统一设置页管理。
  router.push('/settings/hd-toolkit')
}

/**
 * 选择 Python 解释器。
 * 处理流程：
 * 1、Windows 设置可执行文件筛选，其他平台不限制扩展名。
 * 2、选择成功后更新配置字段。
 */
async function selectPython() {
  // 1、仅修改表单路径，实际运行时由主进程检查解释器。
  if (!window?.fileSystem?.selectFile) return
  try {
    const filters = window?.env?.platform === 'win32'
      ? [{ name: 'Python 可执行文件', extensions: ['exe'] }]
      : undefined
    const result = await window.fileSystem.selectFile({
      title: '选择 Python 解释器',
      filters
    })
    if (result?.success && result.path) {
      config.pythonHome = result.path
    }
  } catch (error) {
    message.error('选择 Python 解释器失败: ' + error.message)
  }
}

/**
 * 选择模型或输出目录。
 * 处理流程：
 * 1、请求系统选择目录，根据目标类型更新对应配置字段。
 */
async function selectFolder(type) {
  // 1、未知类型不修改任何目录设置。
  if (!window?.fileSystem?.selectFolder) return
  try {
    const result = await window.fileSystem.selectFolder()
    if (result?.success && result.path) {
      if (type === 'removebg') {
        config.removebgWeightsDir = result.path
      } else if (type === 'highres') {
        config.highresWeightsDir = result.path
      } else if (type === 'output') {
        config.outputDir = result.path
      }
    }
  } catch (error) {
    message.error('选择文件夹失败: ' + error.message)
  }
}

/**
 * 将工具参数持久化到主进程。
 * 处理流程：
 * 1、复制当前配置为普通对象并提交保存。
 * 2、按选项显示成功消息，失败始终提示，最后解除保存状态。
 */
async function persistConfig(showMessage = true) {
  // 1、静默保存仅省略成功提示，不隐藏失败原因。
  if (!window?.hdToolkit?.saveConfig) return
  savingConfig.value = true
  try {
    const payload = deepClone(config)
    const response = await window.hdToolkit.saveConfig(payload)
    if (response?.success) {
      if (showMessage) {
        message.success('设置已保存')
      }
    } else {
      throw new Error(response?.message || '保存失败')
    }
  } catch (error) {
    message.error('保存设置失败: ' + error.message)
  } finally {
    savingConfig.value = false
  }
}

/** 清除指定工具结果；处理流程：1、重置预览列表和输出目录入口，不删除输出文件。 */
function clearResults(type) {
  // 1、两个工具独立清理，互不影响输入和参数。
  if (type === 'remove') {
    removeState.results = []
    removeState.outputDirUsed = ''
  } else if (type === 'highres') {
    highresState.results = []
    highresState.outputDirUsed = ''
  }
}
</script>

<style scoped>
.hd-toolkit {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.file-drag-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(24, 160, 88, 0.15);
  backdrop-filter: blur(8px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeIn 0.2s ease;
  pointer-events: none;
}

@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.drag-content {
  background: white;
  border: 3px dashed #18a058;
  border-radius: 16px;
  padding: 60px 80px;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
  transform: scale(1);
  animation: bounceIn 0.3s ease;
}

@keyframes bounceIn {
  0% {
    transform: scale(0.9);
    opacity: 0;
  }
  50% {
    transform: scale(1.05);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}

.drag-icon {
  font-size: 72px;
  margin-bottom: 16px;
  animation: float 2s ease-in-out infinite;
}

@keyframes float {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-10px);
  }
}

.drag-text {
  font-size: 24px;
  font-weight: 600;
  color: #18a058;
  margin-bottom: 8px;
}

.drag-hint {
  font-size: 14px;
  color: #666;
  line-height: 1.5;
}

.drag-follow-canvas {
  position: fixed;
  width: 170px;
  height: 150px;
  pointer-events: none;
  z-index: 10000;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
  transition: transform 0.12s ease;
}

.hd-subtabs {
  width: 100%;
}

.hd-subtabs--no-nav :deep(.n-tabs-nav) {
  display: none;
}

.hd-subtabs--no-nav :deep(.n-tabs-content) {
  padding: 0;
}

.hd-subtabs--no-nav .hd-pane {
  margin-top: 2px;
}

.hd-pane {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
  margin-top: 16px;
}

.hd-panel {
  display: flex;
  flex-direction: column;
}

.hd-card {
  flex: 1;
  min-height: auto;
}

.hd-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hd-upload-wrapper {
  border: 1px dashed var(--n-border-color);
  border-radius: 12px;
  transition: all 0.2s ease;
}

.hd-upload-wrapper.is-dragging {
  border-color: var(--primary-color);
  background: rgba(24, 160, 88, 0.08);
}

.hd-upload-area {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  cursor: pointer;
  gap: 16px;
}

.hd-upload-icon {
  font-size: 28px;
}

.hd-upload-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hd-file-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.hd-file-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px;
  border: 1px solid var(--n-border-color);
  border-radius: 10px;
}

.hd-file-thumb {
  width: 44px;
  height: 44px;
  border-radius: 8px;
  overflow: hidden;
  background: rgba(0, 0, 0, 0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
}

.hd-file-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.hd-file-placeholder {
  font-size: 18px;
}

.hd-file-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.hd-file-info n-text {
  word-break: break-all;
}

.hd-action-row {
  display: flex;
  justify-content: flex-start;
}

.hd-result-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
}

.hd-result-item {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 12px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  align-items: center;
}

.hd-result-item img {
  width: 100%;
  border-radius: 10px;
  object-fit: cover;
}

.hd-result-name {
  font-size: 12px;
  line-height: 1.3;
  text-align: center;
  word-break: break-all;
}

.hd-empty {
  min-height: 220px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--n-text-color-3);
}

.hd-empty-icon {
  font-size: 32px;
}

.hd-settings {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 16px;
  margin-top: 12px;
}

.hd-number-input {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1 1 25%;
  min-width: 140px;
  align-items: flex-start;
  text-align: left;
}

.hd-number-input :deep(.n-input-number) {
  width: 100%;
}

.hd-settings-actions {
  display: flex;
  justify-content: flex-start;
}

.hd-action-button {
  border-radius: 10px;
  padding: 0 18px;
}



.hd-browse-button {
  padding: 0 12px;
}

.hd-browse-button :deep(.n-button__content) {
  font-weight: 500;
}
</style>
