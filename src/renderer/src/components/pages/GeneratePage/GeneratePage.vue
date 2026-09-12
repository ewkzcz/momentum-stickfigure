<template>
  <div
    class="image-processing-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 450 } }"
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
    
    <!-- 图片悬浮放大预览 -->
    <div
      v-show="hoverPreview.visible"
      class="image-hover-preview"
      :style="{
        left: hoverPreview.x + 'px',
        top: hoverPreview.y + 'px',
        width: hoverPreview.w + 'px',
        height: hoverPreview.h + 'px'
      }"
    >
      <img :src="hoverPreview.src" alt="preview" />
    </div>
    
    <div class="page-content">
      <div class="mode-toolbar">
        <div class="mode-toolbar-left">
          <n-button
            size="large"
            round
            class="mode-button"
            :type="activeMode === 'generate' ? 'primary' : 'default'"
            :ghost="activeMode !== 'generate'"
            :loading="generateState.isProcessing"
            :disabled="generateState.isProcessing"
            @click="executeMode('generate')"
          >
            开始生图
          </n-button>
          <n-button
            size="large"
            round
            class="mode-button"
            :type="activeMode === 'remove' ? 'primary' : 'default'"
            :ghost="activeMode !== 'remove'"
            :loading="removeState.isProcessing"
            :disabled="removeState.isProcessing || !isToolkitAvailable"
            @click="executeMode('remove')"
          >
            开始抠图
          </n-button>
          <n-button
            size="large"
            round
            class="mode-button"
            :type="activeMode === 'highres' ? 'primary' : 'default'"
            :ghost="activeMode !== 'highres'"
            :loading="highresState.isProcessing"
            :disabled="highresState.isProcessing || !isToolkitAvailable"
            @click="executeMode('highres')"
          >
            开始高清
          </n-button>
        </div>
        <div class="mode-toolbar-right">
          <n-button
            size="large"
            round
            class="back-button"
            @click="backToActionExpression"
          >
            <template #icon>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
                <path d="M19 12H5M12 19l-7-7 7-7"/>
              </svg>
            </template>
            返回
          </n-button>
        </div>
      </div>

      <div class="sections-scroll">
      <div class="workspace">
        <section class="io-section">
          <div class="section input-section" :class="{ 'is-collapsed': collapsedInput }">
            <div class="section-header">
              <div class="header-left">
                <n-button
                  size="small"
                  type="primary"
                  round
                  @click="handleSelectImages"
                  :disabled="currentState.isProcessing"
                >
                  上传图片
                </n-button>
                <n-tag size="small" type="info" round>
                  {{ visibleInputFiles.length }} / {{ currentLimit }}
                </n-tag>
              </div>
              <div class="header-actions">
                <n-button
                  v-if="visibleInputFiles.length"
                  size="small"
                  quaternary
                  @click="clearInputs"
                  :disabled="currentState.isProcessing"
                >
                  清空输入
                </n-button>
                <button
                  class="collapse-btn"
                  @click="collapsedInput = !collapsedInput"
                  :title="collapsedInput ? '展开' : '收起'"
                >
                  {{ collapsedInput ? '▼' : '▲' }}
                </button>
              </div>
            </div>
            <div class="collapsible-content" v-show="!collapsedInput">
            <div
              class="media-gallery"
              :class="{ 'is-dragging': isDragging, 'is-disabled': currentState.isProcessing }"
              @dragover.prevent="handleDragOver"
              @dragleave.prevent="handleDragLeave"
              @drop.prevent="handleDrop"
            >
              <div class="media-scroll">
                <div
                  v-for="item in visibleInputFiles"
                  :key="item.id"
                  class="media-card"
                >
                  <img 
                    :src="item.url" 
                    :alt="item.name" 
                    draggable="false"
                    @mouseenter="(e) => showHoverPreview(e, item.url)"
                    @mousemove="moveHoverPreview"
                    @mouseleave="hideHoverPreview"
                  />
                  <button
                    class="media-remove"
                    :disabled="currentState.isProcessing"
                    @click.stop="removeInput(item.id)"
                  >
                    ×
                  </button>
                  <div class="media-name" :title="item.name">
                    {{ item.name }}
                  </div>
                </div>
              </div>
            </div>
            </div>
          </div>

          <div class="section output-section" :class="{ 'is-collapsed': collapsedOutput }">
            <div class="section-header">
              <div class="header-left">
                <span class="section-title">输出图片</span>
                <n-tag
                  v-if="visibleOutputFiles.length"
                  size="small"
                  type="success"
                  round
                >
                  {{ visibleOutputFiles.length }} 张
                </n-tag>
              </div>
              <div class="header-actions">
                <n-button
                  v-if="visibleOutputFiles.length"
                  size="small"
                  quaternary
                  :disabled="currentState.isProcessing"
                  @click="clearOutputs"
                >
                  清空输出
                </n-button>
                <n-button
                  v-if="visibleOutputFiles.length && activeMode === 'generate'"
                  size="small"
                  secondary
                  :loading="isSavingOutputs"
                  :disabled="currentState.isProcessing"
                  @click="saveAllOutputs"
                >
                  保存全部
                </n-button>
                <n-button
                  v-if="visibleOutputFiles.length && activeMode !== 'generate'"
                  size="small"
                  secondary
                  :disabled="!currentOutputDir || currentState.isProcessing"
                  @click="openOutputFolder"
                >
                  打开目录
                </n-button>
                <button
                  class="collapse-btn"
                  @click="collapsedOutput = !collapsedOutput"
                  :title="collapsedOutput ? '展开' : '收起'"
                >
                  {{ collapsedOutput ? '▼' : '▲' }}
                </button>
              </div>
            </div>
            <div class="collapsible-content" v-show="!collapsedOutput">
            <div class="media-gallery media-gallery--readonly">
              <div class="media-scroll">
                <div
                  v-for="(item, index) in visibleOutputFiles"
                  :key="item.id || index"
                  class="media-card media-card--readonly media-card--draggable"
                >
                  <img
                    :src="item.url"
                    :alt="item.name || `output-${index + 1}`"
                    draggable="false"
                    style="cursor: grab;"
                    @mouseenter="(e) => showHoverPreview(e, item.url)"
                    @mousemove="moveHoverPreview"
                    @mouseleave="hideHoverPreview"
                    @mousedown="(event) => handleImageMouseDown(event, item)"
                  />
                  <div class="media-name" :title="item.name">
                    {{ item.name || `输出 ${index + 1}` }}
                  </div>
                </div>
              </div>
            </div>
            <!-- 拖拽提示信息 -->
            <!-- <div 
              v-if="visibleOutputFiles.length > 0" 
              style="margin-top: 12px; padding: 10px 12px; background: rgba(79, 158, 255, 0.05); border-left: 3px solid #4f9eff; border-radius: 4px; font-size: 12px; line-height: 1.6; color: var(--n-text-color);"
            >        
              💡 <strong>拖拽导出</strong>：图片支持直接拖拽到桌面、剪映、PS等应用中使用<br/>
              ⚠️ <strong>注意</strong>：请勿随意删除/移动图片，以免导致剪映等应用图片失去链接
            </div> -->
            </div>
          </div>
        </section>
      </div>

      <footer class="control-panel" :class="{ 'is-collapsed': collapsedSettings }">
        <div class="section-header">
          <div class="header-left">
            <span class="section-title">设置面板</span>
          </div>
          <div class="header-actions">
            <button class="collapse-btn" @click="collapsedSettings = !collapsedSettings" :title="collapsedSettings ? '展开' : '收起'">
              {{ collapsedSettings ? '▼' : '▲' }}
            </button>
          </div>
        </div>
        <div class="collapsible-content" v-show="!collapsedSettings">
        <div class="prompt-mode-row">
          <div class="prompt-mode-switch">
            <n-radio-group v-model:value="activeMode" size="small">
              <n-radio-button value="generate">生图设置</n-radio-button>
              <n-radio-button value="remove" :disabled="!isToolkitAvailable">抠图设置</n-radio-button>
              <n-radio-button value="highres" :disabled="!isToolkitAvailable">高清设置</n-radio-button>
            </n-radio-group>
          </div>
        <div class="prompt-content">
          <template v-if="activeMode === 'generate'">
              <div class="model-row">
                <div class="model-field model-half">
                  <n-select
                    v-model:value="currentTemplate"
                    :options="promptTemplateOptions"
                    placeholder="模板"
                    clearable
                    class="template-select"
                    :disabled="currentState.isProcessing"
                    @update:value="applyTemplate"
                  />
                </div>
                <div class="model-field model-half">
                  <n-select
                    v-model:value="generateState.aspectRatio"
                    :options="aspectRatioOptions"
                    size="small"
                    class="ratio-select"
                    :disabled="currentState.isProcessing"
                  />
                </div>
              </div>
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <n-text depth="3" style="font-size: 13px;">图像生成提示词</n-text>
                <PromptTemplateTrigger
                  button-type="primary"
                  button-size="small"
                  :quaternary="true"
                  :circle="false"
                  button-text="模板库"
                  :show-text="true"
                  :icon-size="16"
                  shortcut="Ctrl+Shift+P"
                  :enable-shortcut="false"
                  template-type="image"
                  @select="handleTemplateSelect"
                />
              </div>
              <n-input
                v-model:value="currentPrompt"
                type="textarea"
                :rows="4"
                maxlength="1200"
                show-count
                :placeholder="promptPlaceholder"
                :disabled="currentState.isProcessing"
                class="prompt-input"
              />
            </template>
            <template v-else-if="activeMode === 'remove'">
              <div class="model-field">
                <span class="model-label">抠图模型</span>
                <n-select
                  v-model:value="removeState.selectedModel"
                  :options="removeModelOptions"
                  placeholder="选择抠图模型"
                  class="model-select"
                  size="small"
                  :disabled="currentState.isProcessing || !removeModelOptions.length"
                />
              </div>
              <n-text depth="3" style="font-size: 11px; margin-top: -8px; padding-left: 4px;">
                u2net: 通用;物品 | isnet-anime: 动漫;人像
              </n-text>
              <div class="alpha-toggle">
                <span class="alpha-label">Alpha Matting</span>
                <div class="alpha-controls">
                  <n-radio-group v-model:value="removeState.alphaMatting" size="small">
                    <n-radio-button :value="true">开启</n-radio-button>
                    <n-radio-button :value="false">关闭</n-radio-button>
                  </n-radio-group>
                </div>
              </div>
            </template>
            <template v-else-if="activeMode === 'highres'">
              <div class="model-field">
                <span class="model-label">高清模型</span>
                <n-select
                  v-model:value="highresState.selectedModel"
                  :options="highresModelOptions"
                  placeholder="选择高清模型"
                  class="model-select"
                  size="small"
                  :disabled="currentState.isProcessing || !highresModelOptions.length"
                />
              </div>
              <div class="model-field">
                <span class="model-label">放大倍数</span>
                <n-input-number
                  v-model:value="highresState.outscale"
                  :min="1"
                  :max="8"
                  size="small"
                  :disabled="currentState.isProcessing"
                />
              </div>
            </template>
            <template v-else>
              <n-input
                v-model:value="currentPrompt"
                type="textarea"
                :rows="4"
                maxlength="1200"
                show-count
                :placeholder="promptPlaceholder"
                :disabled="currentState.isProcessing"
                class="prompt-input"
              />
            </template>
          </div>
        </div>
        </div>

      </footer>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 图像处理页面：共享生图、抠图和高清输入输出，衔接处理结果与跨应用拖拽。 */
import { ref, reactive, computed, watch, onMounted, onUnmounted, onActivated, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage, useDialog, NButton, NSelect, NInput, NInputNumber, NTag, NRadioGroup, NRadioButton } from 'naive-ui'
import { useTaskStore } from '@renderer/stores/taskStore.js'
import { buildGeminiDragConfig } from '@renderer/utils/geminiOutputConfig.js'
import PromptTemplateTrigger from '@renderer/components/shared/PromptTemplateTrigger.vue'
import { useGenerateWorkflow } from './composables/useGenerateWorkflow.js'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const taskStore = useTaskStore()

const activeMode = ref('generate')
const isSavingOutputs = ref(false)
// 折叠状态
const collapsedInput = ref(false)
const collapsedOutput = ref(false)
const collapsedSettings = ref(false)

// ==================== 拖拽功能相关 ====================

// 拖拽常量
const MIN_DRAG_TIME_MS = 300
const OUTSIDE_DURATION_MS = 100
const OUTSIDE_COUNT_THRESHOLD = 2
const OUTSIDE_SAFE_MARGIN = 20
const FOLLOW_OFFSET_X = 20
const FOLLOW_OFFSET_Y = 20

// 拖拽状态
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

// 悬浮预览状态
const hoverPreview = reactive({ visible: false, src: '', x: 0, y: 0, w: 260, h: 180 })

const FILE_LIMITS = {
  generate: 3,
  remove: 30,
  highres: 30
}

const MAX_FILE_SIZE_MB_GENERATE = 10
const MAX_FILE_SIZE_BYTES_GENERATE = MAX_FILE_SIZE_MB_GENERATE * 1024 * 1024
/**
 * 构造生图输入图片超限提示。
 * 处理流程：
 * 1、将文件名和单张大小限制写入提示文本
 */
const buildGenerateOversizeMessage = (fileName) =>
  `文件 ${fileName} 超出 ${MAX_FILE_SIZE_MB_GENERATE}MB 限制（单张≤${MAX_FILE_SIZE_MB_GENERATE}MB），请压缩或更换图片后重试`
let generateOversizeDialogInstance = null
/**
 * 显示单张图片超限提示并避免重复弹窗。
 * 处理流程：
 * 1、生成提示，无弹窗服务时使用消息提示
 * 2、销毁旧弹窗并创建新提示，关闭后清理引用
 */
const showGenerateOversizeDialog = (fileName) => {
  // 1、构造当前文件的大小限制提示。
  const content = buildGenerateOversizeMessage(fileName)
  if (!dialog) {
    message.warning(content)
    return
  }
  // 2、始终只保留一个大小超限弹窗。
  if (generateOversizeDialogInstance?.destroy) {
    generateOversizeDialogInstance.destroy()
    generateOversizeDialogInstance = null
  }
  generateOversizeDialogInstance = dialog.warning({
    title: '图片大小超出限制',
    content,
    positiveText: '我知道了',
    maskClosable: true,
    onPositiveClick: () => {
      generateOversizeDialogInstance = null
    },
    onClose: () => {
      generateOversizeDialogInstance = null
    }
  })
}
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp']
const PREVIEW_LIMIT = 12

const sharedInputFiles = reactive([])
const sharedOutputFiles = reactive([])

const generateState = reactive({
  input: sharedInputFiles,
  output: sharedOutputFiles,
  isProcessing: false,
  aspectRatio: '16:9'
})

const removeState = reactive({
  input: sharedInputFiles,
  output: sharedOutputFiles,
  isProcessing: false,
  selectedModel: '',
  alphaMatting: false,
  outputDir: ''
})

const highresState = reactive({
  input: sharedInputFiles,
  output: sharedOutputFiles,
  isProcessing: false,
  selectedModel: '',
  outscale: 2,        // 默认2倍放大
  mode: 'auto',       // 自动检测GPU并优化
  outputDir: ''
})

const prompts = reactive({
  generate: '',
  remove: '',
  highres: ''
})

const selectedTemplates = reactive({
  generate: null,
  remove: null,
  highres: null
})

const aspectRatioOptions = [
  { label: '原始尺寸', value: 'original' },
  { label: '1:1 正方形', value: '1:1' },
  { label: '4:3 横版', value: '4:3' },
  { label: '3:4 竖版', value: '3:4' },
  { label: '16:9 宽屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '2:3 竖版', value: '2:3' },
  { label: '3:2 横版', value: '3:2' },
  { label: '1:2 极窄竖版', value: '1:2' }
]

const promptTemplates = [
  {
    label: '抠图',
    value: 'remove-template',
    text: '去除背景和所有字幕文字，仅保留主体，主体边缘干净清晰，白色背景'
  },
  {
    label: '提取背景',
    value: 'get-scene-template',
    text: '移除画面中的人物和字幕，提取背景，移除元素【要移除的元素】，修改元素【要修改的元素】，并添加元素【要添加的元素】'
  },
  {
    label: '人物动作表情迁移',
    value: 'qianyi-template',
    text: '在白色背景的基础上，让图1中的人物像图2一样【要模仿的动作表情】，模仿图2中人物的表情和动作，画面中不要出现其他元素'
  },
  {
    label: '三视图',
    value: '3-template',
    text: '在白色背景的基础上，参考给出的人物基础造型图，为我生成人物的三视图（正面、侧面、背面）角色设定（Character Design），画面中除了人物不要出现任何元素'
  },
  {
    label: '构图',
    value: 'goutu-template',
    text: "参考**图1**为背景图片，背景虚化，给出高斯模糊效果；\n" +
        "\n" +
        "参考**图2**中人物的裙子和鞋子服装，改为背身照、腿部特写图片，注意脚步朝向与背身照相符合；\n" +
        "\n" +
        "参考**图3**的构图，以超低角度(极端仰角)从地面或极低处向上拍摄；"
  },
  {
    label: '场景-别墅客厅内景',
    value: 'scene-template-1',
    text: '动漫风格，精美别墅客厅内景，下午时分，明媚的阳光从巨大的落地窗斜射进来，整个房间充满温暖明亮的光线。客厅宽敞通透，现代欧式装修，浅色系主调。阳光在地板上投下长长的光斑，空气中可见细微的浮尘。沙发上放着柔软的抱枕，茶几上有一杯冒着热气的茶和一本翻开的书。窗外是郁郁葱葱的花园。画面细腻、温馨，充满生活气息，电影感镜头。'
  },
  {
    label: '场景-别墅家门口',
    value: 'scene-template-2',
    text: '电影镜头感，动漫风格，别墅家门口。下午的低角度阳光拉长了建筑的影子，形成强烈的明暗对比。焦点集中在敞开的精美大门上。门前车道旁停着一辆汽车，仿佛有人刚刚归来。光线唯美，氛围宁静中带有一丝期待，新海诚风格的光影效果。'
  },
  {
    label: '场景-空荡街道樱花',
    value: 'scene-template-3',
    text: '吉卜力工作室风格，一个宁静而忧郁的动漫背景。一条空荡的街道，在落日温暖的光辉中蜿蜒向远方。樱花花瓣如同雪花般在金光中舞动，被轻风拂过。场景沐浴在怀旧、梦幻的氛围中，强调了此刻物哀的短暂之美。柔和空灵的光线，长长的影子，以及充满情感的电影级构图。人物的缺席强化了寂静告别与回忆的感觉。细节丰富的背景，鲜艳而柔和的色彩，没有角色。'
  },
  {
    label: '场景-西式小屋花园',
    value: 'scene-template-4',
    text: '吉卜力工作室风格，宫崎骏动画电影质感。一个明媚晴朗的午后，一座西式小屋的门前，开满了五彩缤纷的鲜花。白色的篱笆、红色的门和温暖的木质外墙被阳光照得发亮。一只可爱的猫咪在门廊下打盹。空气清澈，光线温暖而柔和，充满了童话般的梦幻和温馨感。'
  }
]

const promptTemplateOptions = promptTemplates.map(({ label, value }) => ({ label, value }))

const removeModelOptions = ref([])
const highresModelOptions = ref([])

const toolkitConfig = reactive({
  pythonHome: '',
  removebgWeightsDir: '',
  highresWeightsDir: '',
  outputDir: ''
})

const isToolkitAvailable = ref(false)

/**
 * 读取处理模式对应的输入数量限制。
 * 处理流程：
 * 1、生图使用固定上限，其余读取配置并提供默认值
 */
const getModeLimit = (mode) => (mode === 'generate' ? 3 : FILE_LIMITS[mode] || 10)

const currentState = computed(() => {
  if (activeMode.value === 'remove') return removeState
  if (activeMode.value === 'highres') return highresState
  return generateState
})

const visibleInputFiles = computed(() => {
  if (activeMode.value === 'generate') {
    return sharedInputFiles.slice(0, 3)
  }
  return sharedInputFiles
})

const visibleOutputFiles = computed(() => {
  if (activeMode.value === 'generate') {
    return sharedOutputFiles.slice(0, 3)
  }
  return sharedOutputFiles
})

/**
 * 获取当前模式实际参与处理的输入图片。
 * 处理流程：
 * 1、生图只取前三张，其余模式返回共享输入列表
 */
const getActiveInputFiles = () => {
  // 1、按当前模式应用输入数量范围。
  if (activeMode.value === 'generate') {
    return sharedInputFiles.slice(0, 3)
  }
  return sharedInputFiles
}

/**
 * 替换共享输出列表并保持响应式数组引用。
 * 处理流程：
 * 1、原地移除旧输出并插入新结果
 */
const replaceSharedOutput = (items) => {
  // 1、保留各处理模式共用的数组对象。
  sharedOutputFiles.splice(0, sharedOutputFiles.length, ...(items || []))
}

const currentLimit = computed(() => getModeLimit(activeMode.value))

const currentPrompt = computed({
  get: () => prompts[activeMode.value],
  set: (value) => {
    prompts[activeMode.value] = value || ''
  }
})

const currentTemplate = computed({
  get: () => selectedTemplates[activeMode.value],
  set: (value) => {
    selectedTemplates[activeMode.value] = value || null
  }
})

const promptPlaceholder = computed(() => {
  if (activeMode.value === 'remove') {
    return '可选：记录抠图备注或主体特征，便于后续检索。'
  }
  if (activeMode.value === 'highres') {
    return '可选：记录高清需求，例如目标用途、尺寸或清晰度说明。'
  }
  return '例如：一个安静的图书馆，午后阳光洒进窗户，柔和写实风格，高清细节'
})

const currentOutputDir = computed(() => {
  if (activeMode.value === 'remove') {
    return removeState.outputDir || toolkitConfig.outputDir
  }
  if (activeMode.value === 'highres') {
    return highresState.outputDir || toolkitConfig.outputDir
  }
  return ''
})

watch(() => sharedInputFiles.length, (len, prev) => {
  if (prev === 0 && len > 0) {
    generateState.aspectRatio = 'original'
  }
  if (len === 0 && prev > 0) {
    generateState.aspectRatio = '16:9'
  }
})

/**
 * 显示有效文件投放的拖拽反馈。
 * 处理流程：
 * 1、确认事件携带文件且当前模式空闲
 * 2、显示拖拽状态并设置复制效果
 */
const handleDragOver = (event) => {
  // 1、忽略无文件事件和处理中投放。
  if (!hasFileInEvent(event)) return
  if (currentState.value.isProcessing) return
  // 2、显示文件拖拽反馈。
  isDragging.value = true
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'copy'
  }
}

/**
 * 清除文件拖拽离开的界面状态。
 * 处理流程：
 * 1、关闭拖拽标记
 */
const handleDragLeave = () => {
  // 1、恢复输入区域的普通显示。
  isDragging.value = false
}

/**
 * 接收文件或文件地址列表的投放。
 * 处理流程：
 * 1、清除拖拽状态并确认当前模式空闲
 * 2、优先读取文件，缺失时解析地址列表
 * 3、交给统一文件添加流程处理
 */
const handleDrop = async (event) => {
  // 1、结束拖拽反馈并阻止处理中导入。
  isDragging.value = false
  if (currentState.value.isProcessing) return
  // 2、兼容系统文件对象和文件地址列表两种数据来源。
  let items = Array.from(event.dataTransfer?.files || [])
  if (!items.length && event?.dataTransfer) {
    const uriList = event.dataTransfer.getData('text/uri-list') || ''
    if (uriList.trim()) {
      const paths = uriList
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((uri) => decodeURI(uri.replace(/^file:\/+/, '')))
      items = paths.map((path) => ({ path }))
    }
  }
  if (!items.length) return
  // 3、复用数量限制与格式校验入口。
  await addFiles(items)
}

/**
 * 通过桌面文件选择器添加输入图片。
 * 处理流程：
 * 1、确认当前模式空闲及文件选择接口可用
 * 2、计算剩余名额并读取用户选择
 * 3、仅添加允许数量的图片并提示超出部分
 */
const handleSelectImages = async () => {
  // 1、检查当前处理状态与桌面文件选择能力。
  if (currentState.value.isProcessing) return
  if (!window?.fileSystem?.selectImageFiles) {
    message.error('当前环境不支持文件选择。')
    return
  }
  try {
    // 2、按当前模式计算剩余可添加数量。
    const limit = getModeLimit(activeMode.value)
    const currentCount = activeMode.value === 'generate'
      ? Math.min(sharedInputFiles.length, 3)
      : sharedInputFiles.length
    const remaining = limit - currentCount
    if (remaining <= 0) {
      message.warning(`已达到最大数量限制（${limit} 张）`)
      return
    }
    const result = await window.fileSystem.selectImageFiles()
    if (result?.success && Array.isArray(result.files)) {
      // 3、截取允许范围并交给统一导入流程。
      const files = result.files.slice(0, remaining)
      await addFiles(files)
      if (result.files.length > remaining) {
        message.warning(`最多添加 ${limit} 张，其余已忽略`)
      }
    }
  } catch (error) {
    console.error('[图像处理插件] 选择图片失败:', error)
    message.error('选择图片失败：' + error.message)
  }
}

/**
 * 规范化图片来源并加入共享输入列表。
 * 处理流程：
 * 1、检查来源列表并计算剩余名额
 * 2、逐项转换图片、按路径去重并加入输入
 * 3、提示实际成功添加数量
 */
const addFiles = async (sources) => {
  // 1、确认有效来源并读取当前数量限制。
  if (!Array.isArray(sources) || sources.length === 0) return
  const limit = getModeLimit(activeMode.value)
  const existingCount = activeMode.value === 'generate'
    ? Math.min(sharedInputFiles.length, limit)
    : sharedInputFiles.length
  let remainingSlots = limit - existingCount
  let added = 0
  // 2、跳过无效或重复来源，达到数量上限后停止。
  for (const source of sources) {
    if (remainingSlots <= 0) break
    const item = await normalizeToImageItem(source)
    if (!item) continue
    if (item.path) {
      const exists = sharedInputFiles.some((img) => img.path === item.path)
      if (exists) continue
    }
    sharedInputFiles.push(item)
    added += 1
    remainingSlots -= 1
  }
  // 3、只对实际新增图片显示成功提示。
  if (added > 0) {
    message.success(`成功添加 ${added} 张图片`)
  }
}

/**
 * 接收其他页面暂存的待处理图片。
 * 处理流程：
 * 1、兼容读取两种跳转暂存键
 * 2、消费数据并检查内容和过期时间
 * 3、将图片保存为临时文件并构造输入项
 * 4、检查数量上限后放到输入列表首位
 */
const checkPendingImageFromOtherPage = async () => {
  // 1、优先读取新跳转数据，缺失时兼容旧暂存键。
  try {
    // 同时检查两种 sessionStorage key（支持新旧两种跳转方式）
    let pendingData = sessionStorage.getItem('pendingImageForJump')
    let storageKey = 'pendingImageForJump'
    
    if (!pendingData) {
      pendingData = sessionStorage.getItem('pendingImageForGenerate')
      storageKey = 'pendingImageForGenerate'
    }
    
    if (!pendingData) {
      console.log('[图像处理插件] 没有待处理的图片')
      return
    }
    
    console.log('[图像处理插件] 发现待处理图片数据 (来源:', storageKey, ')')
    
    const imageData = JSON.parse(pendingData)
    
    // 2、立即清除暂存数据，避免重复处理，并验证格式及有效期。
    sessionStorage.removeItem(storageKey)
    console.log('[图像处理插件] 已清除 sessionStorage 数据')
    if (!imageData || !imageData.dataURL) {
      console.warn('[图像处理插件] 待处理图片数据格式无效:', imageData)
      return
    }
    
    // 检查数据是否过期（超过5分钟）
    const now = Date.now()
    if (imageData.timestamp && (now - imageData.timestamp) > 5 * 60 * 1000) {
      console.warn('[图像处理插件] 待处理图片数据已过期')
      return
    }
    
    console.log('[图像处理插件] 检测到来自', imageData.source, '的图片:', imageData.fileName)
    
    // 3、将图片数据保存为临时文件，以便后续处理时有文件路径。
    let filePath = ''
    if (window?.fileSystem?.saveTempImage) {
      const base64Data = imageData.dataURL.split(',')[1]
      const tempFileName = imageData.fileName || `画布导出_${Date.now()}.png`
      
      console.log('[图像处理插件] 保存临时文件:', tempFileName)
      const tempResult = await window.fileSystem.saveTempImage(base64Data, tempFileName)
      
      if (tempResult?.success && tempResult.path) {
        filePath = tempResult.path
        console.log('[图像处理插件] 临时文件已保存:', filePath)
      } else {
        console.warn('[图像处理插件] 保存临时文件失败:', tempResult)
      }
    } else {
      console.warn('[图像处理插件] window.fileSystem.saveTempImage 不可用')
    }
    
    // 将 dataURL 转换为图片对象并添加到输入列表
    const imageItem = {
      id: createImageId(),
      url: imageData.dataURL,  // DataURL 用于预览显示
      name: imageData.fileName || '画布导出.png',
      path: filePath,  // 实际文件路径，用于后续处理
      size: 0
    }
    
    console.log('[图像处理插件] 创建图片项:', {
      id: imageItem.id,
      name: imageItem.name,
      path: imageItem.path,
      urlLength: imageItem.url?.length || 0
    })
    
    // 4、直接添加到输入文件列表前先检查当前模式容量。
    const limit = getModeLimit(activeMode.value)
    const existingCount = activeMode.value === 'generate'
      ? Math.min(sharedInputFiles.length, limit)
      : sharedInputFiles.length
    
    if (existingCount >= limit) {
      message.warning(`已达到最大数量限制（${limit} 张）`)
      console.warn('[图像处理插件] 已达到数量限制')
      return
    }
    
    // 添加到列表第一项（使用 unshift）
    sharedInputFiles.unshift(imageItem)
    console.log('[图像处理插件] 成功添加图片到输入列表第1项，当前数量:', sharedInputFiles.length)
    
    // 显示成功提示
    message.success(`已接收来自人物调整插件的图片: ${imageItem.name}`)
  } catch (error) {
    console.error('[图像处理插件] 处理待处理图片失败:', error)
    message.error('接收图片失败：' + error.message)
  }
}

/**
 * 删除指定输入图片。
 * 处理流程：
 * 1、按编号定位并移除存在的图片
 */
const removeInput = (id) => {
  // 1、从共享输入中删除目标图片。
  const idx = sharedInputFiles.findIndex((item) => item.id === id)
  if (idx !== -1) {
    sharedInputFiles.splice(idx, 1)
  }
}

/**
 * 清空全部共享输入图片。
 * 处理流程：
 * 1、原地移除输入数组全部元素
 */
const clearInputs = () => {
  // 1、保留共享数组引用并清除其内容。
  sharedInputFiles.splice(0, sharedInputFiles.length)
}

/**
 * 清除处理输出及当前模式的结果目录。
 * 处理流程：
 * 1、清空共享输出
 * 2、同步清理抠图或高清模式的输出目录
 */
const clearOutputs = () => {
  // 1、清除所有可见输出结果。
  replaceSharedOutput([])
  // 2、清理当前本地处理模式的结果目录。
  if (activeMode.value === 'remove') {
    removeState.outputDir = ''
  } else if (activeMode.value === 'highres') {
    highresState.outputDir = ''
  }
}


/**
 * 将内置提示词模板应用到当前模式。
 * 处理流程：
 * 1、按模板值查找并替换当前提示词
 */
const applyTemplate = (value) => {
  // 1、仅应用存在的内置模板。
  if (!value) return
  const template = promptTemplates.find((item) => item.value === value)
  if (template) {
    currentPrompt.value = template.text
  }
}

/**
 * 接收提示词模板选择内容。
 * 处理流程：
 * 1、提示词为空时替换，否则换行追加内容
 */
const handleTemplateSelect = (content) => {
  // 1、保留已有提示词并追加有效模板内容。
  if (content) {
    // 如果当前提示词为空，直接替换；否则追加到末尾
    if (!currentPrompt.value.trim()) {
      currentPrompt.value = content
    } else {
      currentPrompt.value += '\n' + content
    }
  }
}

/**
 * 返回人物调整页面。
 * 处理流程：
 * 1、导航到人物动作表情路由
 */
const backToActionExpression = () => {
  // 1、切换到人物调整页面。
  router.push('/action-expression')
}

// 工作流复用父页面状态；后续声明的辅助函数通过闭包延迟读取，避免初始化时提前访问。
const { executeMode, loadToolkitConfig } = useGenerateWorkflow({
  activeMode,
  generateState,
  removeState,
  highresState,
  isToolkitAvailable,
  currentPrompt,
  sharedInputFiles,
  toolkitConfig,
  removeModelOptions,
  highresModelOptions,
  taskStore,
  message,
  getActiveInputFiles,
  replaceSharedOutput,
  createImageId: () => createImageId(),
  clearInputs,
  getModeLimit,
  createImageCanvas: (imageUrl) => createImageCanvas(imageUrl),
  loadPreviewImages: (files) => loadPreviewImages(files)
})

/**
 * 将生图模式的全部输出保存到用户选择的目录。
 * 处理流程：
 * 1、检查模式、输出及目录选择接口
 * 2、逐张保存图片并统计成功数量
 * 3、提示结果并按需打开目录，最终清除保存状态
 */
const saveAllOutputs = async () => {
  // 1、仅在生图模式存在输出时启用手动保存。
  if (activeMode.value !== 'generate') return
  const images = generateState.output
  if (!images.length) return
  if (!window?.fileSystem?.selectFolder) {
    message.error('当前环境不支持文件保存。')
    return
  }

  isSavingOutputs.value = true
  try {
    const result = await window.fileSystem.selectFolder()
    if (!result?.success || !result.path) {
      return
    }
    // 2、逐张处理，单张失败后继续保存其余图片。
    const targetFolder = result.path
    let savedCount = 0
    for (let i = 0; i < images.length; i += 1) {
      try {
        await saveImageToFolder(images[i], i, targetFolder)
        savedCount += 1
      } catch (error) {
        console.warn('[图像处理插件] 保存图片失败:', error)
      }
    }
    // 3、报告实际保存数量并展示输出目录。
    if (savedCount > 0) {
      message.success(`已成功保存 ${savedCount} 张图片到指定目录。`)
      if (window.fileSystem?.openFolder) {
        await window.fileSystem.openFolder(targetFolder)
      }
    } else {
      message.error('保存失败，请稍后重试。')
    }
  } catch (error) {
    console.error('[图像处理插件] 保存失败:', error)
    message.error('保存失败：' + error.message)
  } finally {
    isSavingOutputs.value = false
  }
}

/**
 * 打开当前模式的结果目录。
 * 处理流程：
 * 1、确认目录及桌面打开接口
 * 2、调用打开目录并提示失败信息
 */
const openOutputFolder = async () => {
  // 1、取得当前模式实际输出目录。
  const target = currentOutputDir.value
  if (!target) return
  if (!window?.fileSystem?.openFolder) {
    message.error('当前环境不支持打开文件夹。')
    return
  }
  try {
    // 2、请求系统文件管理器打开目录。
    const result = await window.fileSystem.openFolder(target)
    if (!result?.success) {
      message.error(result?.error || '打开文件夹失败')
    }
  } catch (error) {
    message.error('打开文件夹失败：' + error.message)
  }
}

/**
 * 将本地处理输出路径转换为预览图片列表。
 * 处理流程：
 * 1、筛选支持的图片路径
 * 2、优先读取桌面预览数据，失败响应时使用文件地址
 * 3、达到预览数量限制后返回结果
 */
const loadPreviewImages = async (files) => {
  // 1、确认文件列表并逐个筛选图片路径。
  if (!Array.isArray(files) || files.length === 0) return []
  const previews = []
  for (const filePath of files) {
    if (!isImagePath(filePath)) continue
    try {
      // 2、优先使用服务提供的数据地址预览。
      if (window?.hdToolkit?.getImagePreview) {
        const response = await window.hdToolkit.getImagePreview(filePath)
        if (response?.success && response.data?.dataUrl) {
          previews.push({
            id: createImageId(),
            path: filePath,
            url: response.data.dataUrl,
            name: extractName(filePath)
          })
        } else {
          previews.push({
            id: createImageId(),
            path: filePath,
            url: toFileUrl(filePath),
            name: extractName(filePath)
          })
        }
      } else {
        previews.push({
          id: createImageId(),
          path: filePath,
          url: toFileUrl(filePath),
          name: extractName(filePath)
        })
      }
    } catch (error) {
      console.warn('[图像处理插件] 预览加载失败:', filePath, error)
    }
    // 3、仅保留允许数量的预览结果。
    if (previews.length >= PREVIEW_LIMIT) break
  }
  return previews
}

/**
 * 将文件对象或桌面文件信息转换为统一图片项。
 * 处理流程：
 * 1、校验浏览器文件类型及生图大小限制并读取内容
 * 2、缺少真实路径时尝试保存临时文件
 * 3、对普通对象校验路径和大小并推导预览地址
 * 4、无法转换时提示错误并返回空值
 */
const normalizeToImageItem = async (source) => {
  // 1、区分文件对象与普通文件信息并执行输入校验。
  try {
    if (!source) return null
    if (source instanceof File) {
      if (!ALLOWED_MIME_TYPES.includes(source.type)) {
        message.warning(`文件 ${source.name} 格式不支持。`)
        return null
      }
      if (activeMode.value === 'generate' && source.size > MAX_FILE_SIZE_BYTES_GENERATE) {
        showGenerateOversizeDialog(source.name)
        return null
      }
      const dataUrl = await readFileAsDataUrl(source)
      // 2、补齐本地处理需要的真实文件路径。
      let filePath = source.path
      if (!filePath && window?.fileSystem?.saveTempImage) {
        const base64 = dataUrl.split(',')[1]
        const tempResult = await window.fileSystem.saveTempImage(base64, source.name || `image-${Date.now()}.png`)
        if (tempResult?.success && tempResult.path) {
          filePath = tempResult.path
        }
      }
      return {
        id: createImageId(),
        name: source.name || '未命名图片',
        path: filePath || '',
        url: dataUrl,
        size: source.size
      }
    }

    // 3、兼容桌面文件选择器或投放路径提供的普通对象。
    if (typeof source === 'object') {
      const path = source.path || ''
      const name = source.name || extractName(path) || '未命名图片'
      if (!isImagePath(path) && !source.previewUrl) {
        message.warning(`文件 ${name} 格式不支持。`)
        return null
      }
      if (source.size && activeMode.value === 'generate' && source.size > MAX_FILE_SIZE_BYTES_GENERATE) {
        showGenerateOversizeDialog(name)
        return null
      }
      let url = source.previewUrl || source.url
      if (!url) {
        if (path) {
          url = toFileUrl(path)
        } else if (source.base64) {
          url = `data:image/png;base64,${source.base64}`
        }
      }
      return {
        id: createImageId(),
        name,
        path,
        url,
        size: source.size || 0
      }
    }
  } catch (error) {
    // 4、转换异常时通知用户并忽略本项。
    console.error('[图像处理插件] 读取文件失败:', error)
    message.error('读取图片失败：' + error.message)
  }
  return null
}

/**
 * 将浏览器文件读取为图片数据地址。
 * 处理流程：
 * 1、注册读取结果回调并启动文件读取
 */
const readFileAsDataUrl = (file) => {
  // 1、将文件读取器转换为异步任务。
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('读取文件失败'))
    reader.readAsDataURL(file)
  })
}

/**
 * 将单张输出图片保存到指定目录。
 * 处理流程：
 * 1、转换图片为编码数据并生成文件名
 * 2、调用桌面写入接口，失败时向调用者抛出异常
 */
const saveImageToFolder = async (image, index, folderPath) => {
  // 1、准备待写入的图片数据和目标路径。
  try {
    const base64Data = await imageUrlToBase64(image.url)
    const fileName = generateFileName(index)
    const filePath = `${folderPath}\\${fileName}`
    // 2、检查桌面写入接口的实际保存结果。
    const result = await window.api.writeFile(filePath, base64Data)
    if (!result?.success) {
      throw new Error(result?.error || '保存失败')
    }
  } catch (error) {
    throw error
  }
}

/**
 * 将图片地址转换为不含前缀的图片编码数据。
 * 处理流程：
 * 1、加载图片并按原尺寸绘制到临时画布
 * 2、导出图片编码并传递加载或编码异常
 */
const imageUrlToBase64 = async (url) => {
  // 1、解码图片后创建原始大小的画布副本。
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
        // 2、仅返回图片数据地址中的编码部分。
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
 * 生成带时间与序号的输出文件名。
 * 处理流程：
 * 1、格式化当前时间并追加从一开始的图片序号
 */
const generateFileName = (index) => {
  // 1、组合日期时间和补零序号，区分批量输出文件。
  const now = new Date()
  const parts = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
    String(now.getHours()).padStart(2, '0'),
    String(now.getMinutes()).padStart(2, '0'),
    String(now.getSeconds()).padStart(2, '0')
  ]
  return `G_${parts.join('_')}_${String(index + 1).padStart(2, '0')}.png`
}

/**
 * 创建图片列表项编号。
 * 处理流程：
 * 1、组合当前时间戳与随机后缀
 */
const createImageId = () => `img-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

/**
 * 判断拖拽事件是否携带文件或文件地址列表。
 * 处理流程：
 * 1、检查数据传输对象的类型列表
 */
const hasFileInEvent = (event) => {
  // 1、兼容文件对象与地址列表两种拖放来源。
  if (!event?.dataTransfer) return false
  const types = Array.from(event.dataTransfer.types || [])
  return types.includes('Files') || types.includes('text/uri-list')
}

/**
 * 按扩展名检查受支持的图片路径。
 * 处理流程：
 * 1、转为小写后匹配允许的图片扩展名
 */
const isImagePath = (filePath) => {
  // 1、忽略扩展名大小写并排除空路径。
  if (!filePath) return false
  const lower = filePath.toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/**
 * 从跨平台文件路径提取文件名。
 * 处理流程：
 * 1、兼容两种路径分隔符并取最后一段
 */
const extractName = (filePath) => {
  // 1、拆分路径并返回末尾文件名。
  if (!filePath) return ''
  const parts = filePath.split(/[/\\]+/)
  return parts[parts.length - 1] || filePath
}

/**
 * 将本地路径转换为文件预览地址。
 * 处理流程：
 * 1、保留已有文件地址并规范路径分隔符
 * 2、按绝对路径形式补充文件协议前缀
 */
const toFileUrl = (path) => {
  // 1、处理空路径及已经转换的地址。
  if (!path) return ''
  if (path.startsWith('file://')) return path
  const normalized = path.replace(/\\/g, '/')
  // 2、为不同平台路径选择文件协议格式。
  if (normalized.startsWith('/')) {
    return `file://${normalized}`
  }
  return `file:///${normalized}`
}

// ==================== 拖拽功能方法 ====================

/**
 * 创建图片canvas用于拖拽
 * 处理流程：
 * 1、加载图片并绘制到同尺寸画布
 * 2、返回画布，加载失败时返回空值
 */
const createImageCanvas = (imageUrl) => {
  // 1、将图片解码并复制为拖拽可用的画布。
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
    // 2、加载失败时返回空结果交给调用者处理。
    img.onerror = () => resolve(null)
    img.src = imageUrl
  })
}

/**
 * 绘制拖拽预览图
 * 处理流程：
 * 1、清空预览画布并建立圆角裁剪区域
 * 2、等比计算图片尺寸并在底部居中绘制
 */
const drawDragPreview = (canvas, sourceCanvas) => {
  // 1、读取预览尺寸并准备裁剪区域。
  const ctx = canvas.getContext('2d')
  const canvasWidth = Number(canvas.width) || 170
  const canvasHeight = Number(canvas.height) || 150

  // 清除画布
  ctx.clearRect(0, 0, canvasWidth, canvasHeight)

  // 添加圆角裁切
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(5, 5, canvasWidth - 10, canvasHeight - 10, 12)
  ctx.clip()

  // 2、等比缩放适配并计算底部居中位置。
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
 * 1、优先读取桌面窗口边界
 * 2、接口失败或不可用时使用浏览器窗口信息
 */
const updateWindowBounds = async () => {
  // 1、优先获取主进程提供的窗口位置与大小。
  try {
    const result = await window.electronAPI?.getWindowBounds?.()
    
    if (result?.success && result?.bounds) {
      windowBounds.value = result.bounds
    } else {
      // 2、降级为浏览器窗口信息。
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
 * 1、计算带安全余量的窗口四边范围
 * 2、判断屏幕坐标是否越界
 */
const checkMouseOutsideWindow = (screenX, screenY, safeMargin = OUTSIDE_SAFE_MARGIN) => {
  // 1、读取窗口在屏幕中的矩形边界。
  const bounds = windowBounds.value
  
  const windowLeft = bounds.x
  const windowTop = bounds.y
  const windowRight = bounds.x + bounds.width
  const windowBottom = bounds.y + bounds.height
  
  // 2、加入安全余量后判断鼠标是否已离开窗口。
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
 * 1、仅接收左键并记录起始拖拽状态
 * 2、绘制应用内跟随预览并校准偏移
 * 3、注册全局移动、释放和窗口离开监听
 */
const handleImageMouseDown = async (event, imageData) => {
  // 1、只处理左键点击并建立拖拽起始信息。
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

    // 2、绘制应用内拖拽预览并校准跟随位置。
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
    
    // 3、添加全局鼠标事件监听并刷新窗口边界。
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
 * 1、确认处于应用内拖拽并更新跟随位置
 * 2、检查移动距离和最短拖拽时间
 * 3、连续越界满足阈值后切换到系统拖拽，回到窗口则重置计数
 */
const handleMouseMoveForDrag = (event) => {
  // 1、仅处理尚未交给系统的活动拖拽。
  if (!isDragging.value || hasTriggeredSystemDrag.value) return
  
  try {
    // 更新鼠标位置
    dragMouseX.value = event.clientX + FOLLOW_OFFSET_X
    dragMouseY.value = event.clientY + FOLLOW_OFFSET_Y
    
    // 2、计算拖拽距离并检查时间阈值。
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
    
    // 3、检测屏幕坐标是否连续位于窗口外。
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
 * 1、记录结束事件并统一清理拖拽
 */
const handleMouseUpForDrag = () => {
  // 1、释放本次拖拽的状态与监听。
  console.log('🖱️ 鼠标释放，结束拖拽')
  cleanupDrag()
}

/**
 * 处理窗口mouseout事件
 * 处理流程：
 * 1、确认活动拖拽且满足普通或快速退出时间条件
 * 2、验证真正离开窗口并累计越界次数和时长
 * 3、满足阈值后移除应用内监听并启动系统拖拽
 */
const handleWindowMouseOut = (event) => {
  // 1、排除非活动拖拽和未达到启动条件的短暂移动。
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

  // 2、排除内部元素切换，确认屏幕坐标越界。
  const toEl = event.relatedTarget || event.toElement
  if (toEl !== null) return

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
  
  // 3、交接给系统拖拽，避免应用内事件重复处理。
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
 * 显示图片悬浮预览。
 * 处理流程：
 * 1、更新图片和可见状态并计算预览位置
 */
const showHoverPreview = (event, src) => {
  // 1、显示目标图片并定位到鼠标附近。
  hoverPreview.src = src
  hoverPreview.visible = true
  moveHoverPreview(event)
}

/**
 * 更新悬浮预览的位置。
 * 处理流程：
 * 1、计算鼠标偏移位置并限制右侧和底部边界
 */
const moveHoverPreview = (event) => {
  // 1、将预览限制在窗口右侧和底部可显示范围内。
  if (!hoverPreview.visible) return
  const gap = 16
  const previewW = hoverPreview.w
  const previewH = hoverPreview.h
  const x = event.clientX + gap
  const y = event.clientY + gap
  const maxRight = (window.innerWidth || 1200) - previewW - 8
  const maxBottom = (window.innerHeight || 800) - previewH - 8
  hoverPreview.x = Math.min(x, maxRight)
  hoverPreview.y = Math.min(y, maxBottom)
}

/**
 * 隐藏当前悬浮预览。
 * 处理流程：
 * 1、关闭预览可见状态
 */
const hideHoverPreview = () => {
  // 1、结束本次悬浮预览。
  hoverPreview.visible = false
}

/**
 * 触发系统拖拽
 * 处理流程：
 * 1、确认当前拖拽图片有效
 * 2、创建文件并请求系统拖拽，失败时提示原因
 */
const triggerSystemDrag = async () => {
  // 1、验证交接给系统的图片仍然可用。
  try {
    console.log('🚀 启动系统级拖拽切换...')
    
    if (!currentDragImage.value || !currentDragImage.value.url) {
      message.error('没有可拖拽的图片')
      return
    }
    
    // 2、创建临时文件并启动系统级拖拽。
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
 * 1、确认图片并转换为画布
 * 2、导出图片字节并分块编码
 * 3、构建图标、文件名和保存配置后调用桌面拖拽接口
 * 4、将失败转换为结构化结果
 */
const createTempFileAndDrag = async () => {
  // 1、确认图片并解码为画布。
  try {
    if (!currentDragImage.value || !currentDragImage.value.url) {
      return { success: false, error: '图片未初始化' }
    }
    
    // 将图片URL转换为base64
    const canvas = await createImageCanvas(currentDragImage.value.url)
    if (!canvas) {
      return { success: false, error: '无法创建图片canvas' }
    }
    
    // 2、转换为二进制图片并编码。
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
           * 将二进制缓冲区分块转换为图片编码字符串。
           * 处理流程：
           * 1、分块读取字节并拼接二进制字符串
           * 2、将完整字符串编码后返回
           */
          function arrayBufferToBase64(buf) {
            // 1、限制每次字符转换的参数数量，避免调用栈溢出。
            const bytes = new Uint8Array(buf)
            const chunkSize = 0x8000 // 32KB 分块
            let binary = ''
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const subArray = bytes.subarray(i, Math.min(i + chunkSize, bytes.length))
              binary += String.fromCharCode.apply(null, subArray)
            }
            // 2、将拼接后的字节字符串编码。
            return btoa(binary)
          }
          const base64 = arrayBufferToBase64(buffer)
          
          // 3、创建拖拽图标并准备桌面拖拽参数。
          const iconPayload = {
            dataURL: canvas.toDataURL(),
            size: 64
          }
          
          // 调用主进程创建临时文件并启动拖拽
          const fileName = currentDragImage.value?.name 
            ? `${currentDragImage.value.name.replace(/\.[^/.]+$/, '')}_${Date.now()}.png`
            : `generated_image_${Date.now()}.png`
          
          const dragConfig = buildGeminiDragConfig()
          const result = await window.electronAPI?.createTempFileAndStartDrag?.(
            base64, 
            iconPayload,
            fileName,
            dragConfig
          )
          
          resolve(result)
          
        } catch (error) {
          // 4、以结构化失败结果结束异步转换。
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
 * 1、清空拖拽标记及目标图片
 * 2、移除本次拖拽的全局事件监听
 * 3、重置越界计数
 */
const cleanupDrag = () => {
  // 1、恢复空闲拖拽状态。
  isDragging.value = false
  hasTriggeredSystemDrag.value = false
  isNearBoundary.value = false
  currentDragImage.value = null
  
  // 2、移除事件监听。
  document.removeEventListener('mousemove', handleMouseMoveForDrag)
  document.removeEventListener('mouseup', handleMouseUpForDrag)
  window.removeEventListener('mouseout', handleWindowMouseOut)
  
  // 3、重置计数。
  outsideConsecutiveCount = 0
}

onMounted(async () => {
  await loadToolkitConfig()
  
  // 检查是否有从其他页面发送过来的图片
  await checkPendingImageFromOtherPage()
  
  // 监听拖拽完成事件
  const dragFinishedUnsubscribe = window.electronAPI?.onDragFinished?.((eventData) => {
    console.log('📁 拖拽完成，文件已保存:', eventData?.filePath)
    message.success('图片已保存并可拖拽到其他应用')
    setTimeout(() => cleanupDrag(), 100)
  })
  
  // 组件卸载时取消监听
  onUnmounted(() => {
    if (dragFinishedUnsubscribe) {
      dragFinishedUnsubscribe()
    }
  })
})

// keep-alive 组件激活时的钩子（每次从其他页面返回都会触发）
onActivated(async () => {
  console.log('[图像处理插件] 页面激活，检查待处理图片')
  // 每次页面激活时都检查是否有待处理的图片
  await checkPendingImageFromOtherPage()
})

onUnmounted(() => {
  // 清理拖拽状态
  cleanupDrag()
  
  // 移除所有拖拽相关的监听器
  window.electronAPI?.removeAllListeners?.('drag-finished')
})
</script>

<style scoped src="./GeneratePage.css"></style>




