<template>
  <div class="video-ocr-page" :class="`theme-${currentTheme}`">
    <!-- 初始化加载遮罩 -->
    <div v-if="loadingInitial" class="loading-overlay">
      <div class="loading-content">
        <div class="loading-spinner"></div>
        <div class="loading-text">正在检查环境...</div>
        <div class="loading-hint">请稍候</div>
      </div>
    </div>
    
    <!-- 主布局 -->
    <div class="page-content">
      <div class="main-layout">
        <!-- 左侧控制面板 -->
        <aside class="left-sidebar">
          <!-- 环境状态卡片 -->
          <div class="control-card">
            <div class="control-card-title">
              <span>⚙️</span>
              环境状态
            </div>
            <div class="control-section">
              <div class="control-field">
                <n-space align="center">
                  <n-tag :type="envStatus.installed ? 'success' : 'warning'" size="medium">
                    {{ envStatus.installed ? '✓ 环境已安装' : '✗ 环境未安装' }}
                  </n-tag>
                  <n-button 
                    v-if="!envStatus.installed"
                    size="small"
                    type="primary"
                    :loading="envStatus.installing"
                    @click="installEnvironment"
                  >
                    {{ envStatus.installing ? '安装中...' : '一键安装环境' }}
                  </n-button>
                  <n-button 
                    v-if="envStatus.installed"
                    size="small"
                    type="error"
                    ghost
                    :loading="envStatus.cleaning"
                    @click="cleanAndReinstall"
                  >
                    {{ envStatus.cleaning ? '清理中...' : '清理环境' }}
                  </n-button>
                </n-space>
                <span class="control-field-hint">
                  首次使用需要先安装字幕提取工具
                </span>
              </div>

              <!-- 下载模式 -->
              <div class="control-field">
                <label class="control-field-label">下载模式</label>
                <n-select
                  v-model:value="settings.useMirror"
                  :options="downloadModeOptions"
                  @update:value="saveUseMirror"
                />
              </div>

              <!-- Python环境说明 -->
              <n-alert type="info" size="small" :bordered="false">
                <template #icon>
                  <span>🐍</span>
                </template>
                <div style="font-size: 12px;">
                  Python环境复用自【设置 > 抠图高清设置】
                  <template v-if="config.pythonHome">
                    <br />
                    <span style="opacity: 0.7; font-size: 11px;">{{ config.pythonHome }}</span>
                  </template>
                </div>
              </n-alert>
            </div>
          </div>

          <!-- 参数配置卡片 -->
          <div class="control-card">
            <div class="control-card-title">
              <span>🎛️</span>
              参数配置
            </div>
            <div class="control-section">
              <!-- 输出目录 -->
              <div class="control-field">
                <label class="control-field-label">输出目录</label>
                <n-input-group>
                  <n-input 
                    v-model:value="config.outputDir" 
                    placeholder="默认：Documents/VideoSubtitles"
                    @blur="saveOutputDir"
                  />
                  <n-button @click="selectOutputDir">
                    选择
                  </n-button>
                </n-input-group>
              </div>
            </div>
          </div>

          <!-- AI配置卡片 -->
          <div class="control-card ai-config-section">
            <div class="ai-config-title">
              <span>🤖</span>
              AI纠错配置
              <span class="required-mark">*</span>
            </div>
            <div class="control-section">
              <!-- 自定义中转地址 -->
              <div class="control-field">
                <label class="control-field-label">
                  API地址
                </label>
                <n-input 
                  v-model:value="config.apiBaseUrl"
                  placeholder="请输入中转站地址"
                  @blur="saveApiBaseUrl"
                >
                  <template #prefix>
                    <span style="font-size: 16px;">☁️</span>
                  </template>
                </n-input>
              </div>

              <div class="control-field">
                <label class="control-field-label">
                  API密钥 <span class="required-mark">*</span>
                </label>
                <n-input 
                  v-model:value="config.apiKey" 
                  type="password"
                  placeholder="请输入 API 密钥"
                  show-password-on="click"
                  @blur="saveApiKey"
                >
                  <template #prefix>
                    <span style="font-size: 16px;">🔑</span>
                  </template>
                </n-input>
              </div>

              <div class="control-field">
                <label class="control-field-label">
                  AI模型 <span class="required-mark">*</span>
                </label>
                <n-select
                  v-model:value="config.aiModel"
                  :options="modelOptions"
                  filterable
                  tag
                  @update:value="saveAiModel"
                />
                <span class="control-field-hint">
                  💡 推荐使用 gpt-4.1-Mini（快速经济）
                </span>
              </div>
            </div>
          </div>
        </aside>

        <!-- 右侧工作区 -->
        <div class="main-workspace">
          <!-- 工作区头部 -->
          <div class="workspace-header">
            <div class="workspace-header-title">视频字幕高精度提取</div>
            <n-space>
              <n-button
                type="primary"
                size="large"
                :loading="isProcessing"
                :disabled="!selectedVideo || !envStatus.installed"
                @click="startProcess"
              >
                {{ isProcessing ? '处理中...' : '开始提取字幕' }}
              </n-button>
              <n-button
                v-if="outputPath"
                secondary
                size="large"
                @click="openOutputFile"
              >
                打开输出文件
              </n-button>
            </n-space>
          </div>

          <!-- 工作区内容 -->
          <div class="workspace-content">
            <!-- 视频选择区域 -->
            <div v-if="!selectedVideo" class="video-upload-zone" @click="selectVideo">
              <div class="video-upload-icon">🎬</div>
              <div class="video-upload-text">点击选择视频文件</div>
              <div class="video-upload-hint">支持 MP4/AVI/MOV 等常见视频格式</div>
            </div>

            <!-- 已选视频预览 -->
            <div v-else class="video-preview-card">
              <div class="video-preview-icon">🎥</div>
              <div class="video-preview-info">
                <div class="video-preview-name">{{ selectedVideo.name }}</div>
                <div class="video-preview-path">{{ selectedVideo.path }}</div>
              </div>
              <n-button size="small" text @click="clearVideo">
                移除
              </n-button>
            </div>

            <!-- 进度显示 -->
            <div v-if="processProgress.show" class="progress-container">
              <div class="progress-title">
                <span>⏳</span>
                {{ envStatus.installing ? '安装进度' : '处理进度' }}
              </div>
              <n-progress 
                type="line" 
                :percentage="processProgress.percentage"
                :status="processProgress.status"
              />
              <div class="progress-message">{{ processProgress.message }}</div>
              
              <!-- 首次运行提示 -->
              <div 
                v-if="!envStatus.installing && processProgress.percentage < 20 && processProgress.percentage > 0" 
                class="progress-hint"
              >
                💡 <strong>提示：</strong>正在初始化处理环境，请稍候...
              </div>
              
              <!-- 安装日志 -->
              <div v-if="processProgress.logs.length > 0" class="install-logs">
                <div class="install-logs-header">
                  <span>📋 安装日志</span>
                  <n-button 
                    size="tiny" 
                    text 
                    @click="processProgress.logs = []"
                  >
                    清空
                  </n-button>
                </div>
                <div class="install-logs-content">
                  <div 
                    v-for="(log, index) in processProgress.logs" 
                    :key="index"
                    class="log-line"
                  >
                    {{ log }}
                  </div>
                </div>
              </div>
            </div>

            <!-- 结果显示 -->
            <div v-if="result.show" class="result-container">
              <div class="result-header">
                <div class="result-title">
                  <span>✨</span>
                  最终结果{{ settings.useAI ? '（AI已纠错）' : '' }}
                </div>
                <n-space>
                  <n-tag type="success" size="small">
                    {{ result.lineCount }} 行字幕
                  </n-tag>
                  <n-button size="tiny" text @click="copyResult">
                    复制结果
                  </n-button>
                </n-space>
              </div>
              <div class="result-content">
                {{ result.preview }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 视频字幕提取页面：复用 Python 环境，管理依赖安装、OCR 进度及 AI 纠错输出。 */
import { normalizeApiBaseUrl } from '@shared/api-url.js'
import { ref, reactive, onMounted, onActivated, onBeforeUnmount } from 'vue'
import { 
  NSpace, NText, NButton, NTag, NInputNumber, 
  NSelect, NCheckbox, NProgress, NAlert, NInput, NInputGroup,
  useMessage 
} from 'naive-ui'
import { useRouter } from 'vue-router'
import { useTheme } from '../../../utils/composables/useTheme'
import './VideoSubtitleOcrPage.css'

// 使用主题
const { currentTheme } = useTheme()

const message = useMessage()
const router = useRouter()

// 环境状态
const envStatus = reactive({
  installed: false,
  installing: false,
  cleaning: false
})

// 加载状态
const loadingInitial = ref(false)

// 选中的视频
const selectedVideo = ref(null)

// 配置（从localStorage读取）
const config = reactive({
  pythonHome: '', // 从hd-toolkit-config复用
  outputDir: localStorage.getItem('video-ocr-output-dir') || '',
  apiKey: localStorage.getItem('video-ocr-api-key') || '',
  apiBaseUrl: localStorage.getItem('video-ocr-api-base-url') || '',
  aiModel: localStorage.getItem('video-ocr-ai-model') || 'gpt-4o-mini'
})

/**
 * 从抠图高清配置恢复 Python 路径。
 * 处理流程：
 * 1、解析共享配置中的解释器路径。
 * 2、路径改变时更新页面配置并重新检查 OCR 依赖。
 */
function loadPythonHome() {
  // 1、只在保存配置存在时读取，解析失败保留当前状态。
  try {
    const hdConfig = localStorage.getItem('hd-toolkit-config')
    if (hdConfig) {
      const parsed = JSON.parse(hdConfig)
      const newPythonHome = parsed.pythonHome || ''
      
      // 2、路径变化后重新探测，不沿用旧解释器的安装状态。
      if (newPythonHome !== config.pythonHome) {
        console.log('[Video OCR] Python路径已更新:', newPythonHome)
        config.pythonHome = newPythonHome
        // 路径变化后重新检查环境
        checkEnvironmentStatus()
      }
    }
  } catch (e) {
    console.error('[Video OCR] 读取Python路径失败:', e)
  }
}

// 设置
const settings = reactive({
  intervalSeconds: parseFloat(localStorage.getItem('video-ocr-interval') || '0.34'),
  useMirror: localStorage.getItem('video-ocr-use-mirror') !== 'false' // 默认使用镜像
})

// 下载模式选项
const downloadModeOptions = [
  { label: '镜像加速（关闭代理时使用）', value: true },
  { label: '直连模式（开启代理时使用）', value: false }
]

// AI模型选项
const modelOptions = [
  { label: 'gpt-4o-mini', value: 'gpt-4o-mini' },
  { label: 'gpt-4.1-mini', value: 'gpt-4.1-mini' }
]

// 处理状态
const isProcessing = ref(false)

// 进度信息
const processProgress = reactive({
  show: false,
  percentage: 0,
  status: 'default',
  message: '',
  logs: [] // 安装日志
})

// 结果
const result = reactive({
  show: false,
  preview: '',
  lineCount: 0
})

// 输出路径
const outputPath = ref('')

// 通过定时读取配置检测 Python 路径变化，句柄在卸载时释放。
let configCheckInterval = null

// 初始化加载环境状态
onMounted(async () => {
  loadPythonHome()
  await checkEnvironmentStatus()
  
  // 启动配置监听（每2秒检查一次配置是否变化）
  configCheckInterval = setInterval(() => {
    loadPythonHome()
  }, 2000)
})

// 组件激活时重新加载配置
onActivated(() => {
  console.log('[Video OCR] 组件激活，重新加载配置')
  loadPythonHome()
})

// 组件卸载时清理定时器
onBeforeUnmount(() => {
  if (configCheckInterval) {
    clearInterval(configCheckInterval)
    configCheckInterval = null
  }
})

/**
 * 检查当前解释器是否安装 OCR 依赖。
 * 处理流程：
 * 1、确认路径和桥接接口可用，显示检查中状态。
 * 2、请求主进程检测，更新安装标志并反馈缺失依赖。
 * 3、无论结果如何都结束加载状态。
 */
async function checkEnvironmentStatus() {
  // 1、没有解释器路径时明确标记为未安装。
  if (!config.pythonHome) {
    envStatus.installed = false
    return
  }
  
  if (!window?.videoOcr?.checkEnvironment) return
  
  console.log('[Video OCR] 开始检查环境...')
  loadingInitial.value = true
  
  // 2、创建持续提示，成功响应或异常时主动销毁。
  const loadingMsg = message.loading('正在检查环境...', {
    duration: 0
  })
  
  try {
    const response = await window.videoOcr.checkEnvironment(config.pythonHome)
    loadingMsg.destroy()
    
    if (response?.success) {
      envStatus.installed = response.data.installed || false
      if (response.data.installed) {
        console.log('[Video OCR] 环境检查完成 - 已安装')
      } else {
        console.log('[Video OCR] 环境检查完成 - 未安装')
        message.info('环境未安装，请点击"一键安装环境"按钮')
      }
    } else {
      envStatus.installed = false
      message.warning(response?.message || '请配置Python环境路径')
    }
  } catch (error) {
    loadingMsg.destroy()
    console.error('[Video OCR] 检查环境失败:', error)
    envStatus.installed = false
    message.error('环境检查失败: ' + error.message)
  } finally {
    loadingInitial.value = false
  }
}

/**
 * 清理 OCR 环境，为用户后续重新安装做准备。
 * 处理流程：
 * 1、确认解释器路径、用户确认和清理接口。
 * 2、订阅进度日志后清理依赖，成功时重新检查环境。
 * 3、结束清理状态并释放订阅；此方法不自动启动安装。
 */
async function cleanAndReinstall() {
  // 1、用户取消确认或缺少接口时不开始清理。
  if (!config.pythonHome) {
    message.error('请先配置Python路径')
    return
  }
  
  // 确认对话框
  if (!confirm('确定要清理并重装环境吗？')) {
    return
  }
  
  if (!window?.videoOcr?.cleanEnvironment) {
    message.error('清理功能不可用')
    return
  }
  
  // 2、重置进度和日志，避免混入上次安装的显示内容。
  envStatus.cleaning = true
  processProgress.show = true
  processProgress.percentage = 0
  processProgress.status = 'default'
  processProgress.message = '正在清理环境...'
  processProgress.logs = [] // 清空日志
  
  /**
   * 更新环境清理进度与日志。
   * 处理流程：
   * 1、同步百分比和状态文本。
   * 2、收到日志时追加内容，并在界面更新后滚动到底部。
   */
  const progressHandler = (data) => {
    // 1、缺少进度字段时使用清理中的默认显示。
    processProgress.percentage = data.percentage || 0
    processProgress.message = data.message || '清理中...'
    
    // 2、延后滚动，等待新日志节点渲染。
    if (data.log) {
      processProgress.logs.push(data.log)
      
      // 自动滚动到底部
      setTimeout(() => {
        const logContainer = document.querySelector('.install-logs-content')
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight
        }
      }, 50)
    }
  }
  
  let unsubscribe = null
  if (window.videoOcr.onProgress) {
    unsubscribe = window.videoOcr.onProgress(progressHandler)
  }
  
  try {
    // 3、执行主进程清理，并用重新探测的结果刷新环境状态。
    const response = await window.videoOcr.cleanEnvironment(config.pythonHome)
    
    if (response?.success) {
      message.success('环境清理成功！现在可以重新安装')
      envStatus.installed = false
      await checkEnvironmentStatus()
      processProgress.status = 'success'
      processProgress.percentage = 100
      processProgress.message = '清理完成'
    } else {
      message.error(response?.message || '环境清理失败')
      processProgress.status = 'error'
      processProgress.message = response?.message || '环境清理失败'
    }
  } catch (error) {
    console.error('[Video OCR] 清理失败:', error)
    message.error('环境清理失败: ' + error.message)
    processProgress.status = 'error'
    processProgress.message = '环境清理失败'
  } finally {
    envStatus.cleaning = false
    // 4、成功或失败都解除本次进度监听。
    if (unsubscribe) {
      unsubscribe()
    }
  }
}

/**
 * 安装 OCR 所需依赖。
 * 处理流程：
 * 1、确认解释器和接口，重置安装进度。
 * 2、订阅安装日志，按镜像选项请求主进程安装。
 * 3、成功后复查环境，结束时清理安装标志与订阅。
 */
async function installEnvironment() {
  // 1、前置条件不满足时保留原安装状态。
  if (!config.pythonHome) {
    message.error('请先配置Python路径')
    return
  }
  
  if (!window?.videoOcr?.installEnvironment) {
    message.error('安装功能不可用')
    return
  }
  
  envStatus.installing = true
  processProgress.show = true
  processProgress.percentage = 0
  processProgress.status = 'default'
  processProgress.message = '正在安装环境...'
  processProgress.logs = [] // 清空日志
  
  /**
   * 更新依赖安装进度。
   * 处理流程：
   * 1、同步进度文本和百分比。
   * 2、追加安装日志并延迟滚动到最新内容。
   */
  const progressHandler = (data) => {
    // 1、安装日志与百分比共用主进程进度事件。
    processProgress.percentage = data.percentage || 0
    processProgress.message = data.message || '安装中...'
    
    // 2、日志追加后等待布局刷新再滚动。
    if (data.log) {
      processProgress.logs.push(data.log)
      
      // 自动滚动到底部
      setTimeout(() => {
        const logContainer = document.querySelector('.install-logs-content')
        if (logContainer) {
          logContainer.scrollTop = logContainer.scrollHeight
        }
      }, 50)
    }
  }
  
  let unsubscribe = null
  if (window.videoOcr.onProgress) {
    unsubscribe = window.videoOcr.onProgress(progressHandler)
  }
  
  try {
    // 2、镜像选项直接交给主进程选择依赖下载来源。
    const response = await window.videoOcr.installEnvironment(config.pythonHome, settings.useMirror)
    
    if (response?.success) {
      message.success('环境安装成功！')
      envStatus.installed = true
      await checkEnvironmentStatus()
      processProgress.status = 'success'
      processProgress.percentage = 100
      processProgress.message = '环境安装完成'
      
      // 保持日志显示，不自动关闭
      // setTimeout(() => {
      //   processProgress.show = false
      // }, 2000)
    } else {
      message.error(response?.message || '环境安装失败')
      processProgress.status = 'error'
      processProgress.message = response?.message || '环境安装失败'
    }
  } catch (error) {
    console.error('[Video OCR] 安装失败:', error)
    message.error('环境安装失败: ' + error.message)
    processProgress.status = 'error'
    processProgress.message = '环境安装失败'
  } finally {
    envStatus.installing = false
    // 3、安装结束后解除订阅，保留本次日志供查看。
    if (unsubscribe) {
      unsubscribe()
    }
  }
}

/**
 * 选择待识别的视频文件。
 * 处理流程：
 * 1、打开带视频扩展名筛选的系统选择器。
 * 2、选择成功后保存完整路径和用于显示的文件名。
 */
async function selectVideo() {
  // 1、取消选择时保持当前视频不变。
  if (!window?.fileSystem?.selectFile) return
  try {
    const result = await window.fileSystem.selectFile({
      title: '选择视频文件',
      filters: [
        { name: '视频文件', extensions: ['mp4', 'avi', 'mov', 'mkv', 'flv', 'wmv'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    
    if (result?.success && result.path) {
      selectedVideo.value = {
        name: result.path.split(/[/\\]/).pop(),
        path: result.path
      }
      message.success('已选择视频文件')
    }
  } catch (error) {
    console.error('[Video OCR] 选择视频失败:', error)
    message.error('选择视频失败: ' + error.message)
  }
}

/**
 * 清除当前视频与结果入口。
 * 处理流程：
 * 1、清空选择，隐藏旧结果并移除输出文件路径。
 */
function clearVideo() {
  // 1、清除界面引用，不删除磁盘上的视频或字幕文件。
  selectedVideo.value = null
  result.show = false
  outputPath.value = ''
}

/**
 * 提交视频字幕识别与 AI 纠错任务。
 * 处理流程：
 * 1、校验视频、Python 依赖、中转站地址、密钥和模型。
 * 2、保存采样间隔，重置界面并订阅处理进度。
 * 3、提交主进程任务，成功后显示预览和输出路径，失败时显示原因。
 * 4、结束处理状态，成功结果延迟收起进度条。
 */
async function startProcess() {
  // 1、前置校验通过前不锁定处理按钮。
  if (!selectedVideo.value) {
    message.warning('请先选择视频文件')
    return
  }
  
  if (!config.pythonHome) {
    message.error('Python环境未配置，请先在【设置 > 抠图高清设置】中配置Python路径')
    router.push('/settings')
    return
  }
  
  if (!envStatus.installed) {
    message.warning('请先安装字幕提取工具')
    return
  }

  // 2、当前提交路径固定启用 AI 纠错，因此地址、密钥和模型均需填写。
  try {
    config.apiBaseUrl = normalizeApiBaseUrl(config.apiBaseUrl)
    saveApiBaseUrl()
  } catch (error) {
    message.error(error.message)
    return
  }

  if (!config.apiKey || !config.apiKey.trim()) {
    message.error('请配置AI API密钥')
    return
  }
  
  if (!config.aiModel || !config.aiModel.trim()) {
    message.error('请配置AI模型名称')
    return
  }
  
  if (!window?.videoOcr?.processVideo) {
    message.error('处理功能不可用')
    return
  }
  
  // 3、保存本次采样间隔并进入处理状态。
  localStorage.setItem('video-ocr-interval', String(settings.intervalSeconds))
  
  isProcessing.value = true
  processProgress.show = true
  processProgress.percentage = 0
  processProgress.status = 'default'
  processProgress.message = '正在初始化...'
  result.show = false
  
  try {
    const payload = {
      pythonHome: config.pythonHome,
      videoPath: selectedVideo.value.path,
      outputDir: config.outputDir,
      intervalSeconds: settings.intervalSeconds,
      useAI: true, // AI纠错必选
      apiKey: config.apiKey,
      apiBaseUrl: config.apiBaseUrl,
      aiModel: config.aiModel
    }
    
    /**
     * 更新字幕处理进度。
     * 处理流程：
     * 1、将主进程进度映射到页面百分比和提示文本。
     */
    const progressHandler = (data) => {
      // 1、缺失字段使用处理中默认值。
      processProgress.percentage = data.percentage || 0
      processProgress.message = data.message || '处理中...'
    }
    
    if (window.videoOcr.onProgress) {
      const unsubscribe = window.videoOcr.onProgress(progressHandler)
      // 保存取消订阅函数，处理完成后调用
      window.__videoOcrUnsubscribe = unsubscribe
    }
    
    // 4、订阅完成后提交任务，避免漏掉初始化进度。
    const response = await window.videoOcr.processVideo(payload)
    
    // 5、正常收到响应后解除订阅，再按响应结果更新界面。
    if (window.__videoOcrUnsubscribe) {
      window.__videoOcrUnsubscribe()
      window.__videoOcrUnsubscribe = null
    }
    
    if (response?.success) {
      message.success('字幕提取完成')
      processProgress.status = 'success'
      processProgress.percentage = 100
      processProgress.message = '处理完成'
      
      // 显示结果
      result.show = true
      result.preview = response.data.preview || '无内容'
      result.lineCount = response.data.lineCount || 0
      outputPath.value = response.data.outputPath || ''
      
      setTimeout(() => {
        processProgress.show = false
      }, 2000)
    } else {
      message.error(response?.message || '处理失败')
      processProgress.status = 'error'
      processProgress.message = response?.message || '处理失败'
    }
  } catch (error) {
    console.error('[Video OCR] 处理失败:', error)
    message.error('处理失败: ' + error.message)
    processProgress.status = 'error'
    processProgress.message = '处理失败'
  } finally {
    isProcessing.value = false
  }
}

/**
 * 打开生成的字幕输出路径。
 * 处理流程：
 * 1、确认路径和系统打开接口存在，转交主进程打开并反馈失败。
 */
async function openOutputFile() {
  // 1、使用实际返回的输出路径，不重新推导文件位置。
  if (!outputPath.value) return
  if (!window?.fileSystem?.openFolder) return
  
  try {
    const result = await window.fileSystem.openFolder(outputPath.value)
    if (!result?.success) {
      message.error(result?.error || '打开文件失败')
    }
  } catch (error) {
    message.error('打开文件失败: ' + error.message)
  }
}

/**
 * 复制字幕预览文本。
 * 处理流程：
 * 1、有预览内容时调用桌面剪贴板接口并显示结果。
 */
async function copyResult() {
  // 1、复制的是页面预览，不重新读取字幕文件。
  if (!result.preview) return
  
  try {
    await window.electronAPI.copyToClipboard(result.preview)
    message.success('已复制到剪贴板')
  } catch (error) {
    console.error('复制失败:', error)
    message.error('复制失败: ' + error.message)
  }
}

/**
 * 选择字幕输出目录。
 * 处理流程：
 * 1、打开系统目录选择器，选择成功后更新配置并保存。
 */
async function selectOutputDir() {
  // 1、用户取消时不覆盖已保存目录。
  if (!window?.fileSystem?.selectFolder) return
  try {
    const result = await window.fileSystem.selectFolder()
    
    if (result?.success && result.path) {
      config.outputDir = result.path
      saveOutputDir()
    }
  } catch (error) {
    message.error('选择输出目录失败: ' + error.message)
  }
}

/** 保存输出目录；处理流程：1、将当前目录写入字幕工具独立配置键。 */
function saveOutputDir() {
  // 1、目录值由选择器或输入框提供。
  localStorage.setItem('video-ocr-output-dir', config.outputDir)
}

/** 保存中转站地址；处理流程：1、去除首尾空白后写入本地配置。 */
function saveApiBaseUrl() {
  // 1、完整地址校验在提交任务前执行。
  localStorage.setItem('video-ocr-api-base-url', config.apiBaseUrl.trim())
}

/** 保存用户 API 密钥；处理流程：1、写入本机字幕工具配置。 */
function saveApiKey() {
  // 1、此操作仅保存配置，请求时由主进程读取参数使用。
  localStorage.setItem('video-ocr-api-key', config.apiKey)
}

/** 保存纠错模型；处理流程：1、将当前模型名称写入本地配置。 */
function saveAiModel() {
  // 1、模型是否可用由用户配置的服务决定。
  localStorage.setItem('video-ocr-ai-model', config.aiModel)
}

/** 保存依赖下载模式；处理流程：1、将镜像开关转为字符串后持久化。 */
function saveUseMirror() {
  // 1、读取配置时再按字符串还原布尔状态。
  localStorage.setItem('video-ocr-use-mirror', String(settings.useMirror))
}
</script>
