<template>
  <div
    class="settings-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 500 } }"
  >
    <div class="page-content">
      <!-- 简笔画人物插件设置 -->
      <div v-show="activeTab === 'stickfigure'" class="settings-tab-content">
          <div class="settings-content">
            <!-- 子级标签页 -->
            <n-tabs
              v-model:value="stickfigureSubTab"
              type="line"
              class="settings-sub-tabs"
            >
              <!-- 基础设置 -->
              <n-tab-pane name="basic" tab="基础设置">
                <StickfigureBasicSettings
                  :config="stickfigureConfig"
                  :file-naming-rule-options="fileNamingRuleOptions"
                  :canvas-hover-enabled="canvasHoverPreviewEnabled"
                  :part-hover-enabled="partHoverPreviewEnabled"
                  :is-selecting-stickfigure-folder="isSelectingStickfigureFolder"
                  :is-saving-stickfigure="isSavingStickfigure"
                  @update-field="(key, value) => { stickfigureConfig[key] = value }"
                  @update:canvas-hover-enabled="value => { canvasHoverPreviewEnabled = value }"
                  @update:part-hover-enabled="value => { partHoverPreviewEnabled = value }"
                  @select-output-folder="selectStickfigureOutputFolder"
                  @reset-output-folder="resetStickfigureOutputToDefault"
                  @save="saveStickfigureConfig"
                />
              </n-tab-pane>

              <!-- 前手特殊图层 -->
              <n-tab-pane name="fronthand" tab="前手特殊图层">
                <StickfigureFrontHandSettings
                  :config="stickfigureConfig"
                  @update-field="(key, value) => { stickfigureConfig[key] = value }"
                  @reset-both-names="resetFrontHandBothNames"
                  @reset-right-names="resetFrontHandRightNames"
                >
                  <!-- 保存按钮 -->
                  <div class="save-button-container">
                    <n-button
                      type="primary"
                      size="large"
                      @click="saveStickfigureConfig"
                      :loading="isSavingStickfigure"
                    >
                      保存配置
                    </n-button>
                  </div>
                </StickfigureFrontHandSettings>
              </n-tab-pane>

              <!-- 自定义图层名称 -->
              <n-tab-pane name="customlayers" tab="自定义图层名称">
                <StickfigureGroupNameSettings
                  :config="stickfigureConfig"
                  :default-group-names="DEFAULT_GROUP_NAMES"
                  @update-group-field="(key, value) => { stickfigureConfig.groupNames[key] = value }"
                  @reset-group-name="resetGroupName"
                >

                  <!-- 保存按钮 -->
                  <div class="save-button-container">
                    <n-button
                      type="primary"
                      size="large"
                      @click="saveStickfigureConfig"
                      :loading="isSavingStickfigure"
                    >
                      保存配置
                    </n-button>
                  </div>
                </StickfigureGroupNameSettings>
              </n-tab-pane>
            </n-tabs>
          </div>
      </div>
        
      <!-- 快捷键设置 -->
      <div v-show="activeTab === 'hotkeys'" class="settings-tab-content">
          <div class="settings-content">
            <HotkeySettings
              :config="hotkeysConfig"
              @hotkey-input="handleHotkeyInput"
              @editing-change="value => { currentEditingHotkey = value }"
              @reset="resetHotkey"
              @clear="clearHotkey"
            >
              <div class="save-button-container">
                <n-button
                  type="primary"
                  size="large"
                  @click="saveHotkeysConfig"
                  :loading="isSavingHotkeys"
                >
                  保存配置
                </n-button>
              </div>
            </HotkeySettings>
          </div>
      </div>
        
      <!-- 纳米香蕉生图设置 -->
      <div v-show="activeTab === 'gemini'" class="settings-tab-content">
          <div class="settings-content">
            <GeminiSettings
              :config="geminiConfig"
              :is-selecting-folder="isSelectingFolder"
              @update-field="(key, value) => { geminiConfig[key] = value }"
              @select-project-root="selectProjectRootFolder"
              @reset-project-root="resetProjectRootToDefault"
            >
              <div class="save-button-container">
                <n-button type="primary" size="large" @click="saveGeminiConfig" :loading="isSavingGemini">
                  保存配置
                </n-button>
              </div>
            </GeminiSettings>
          </div>
      </div>

      <!-- 抠图高清设置 -->
      <div v-show="activeTab === 'hd-toolkit'" class="settings-tab-content">
        <div class="settings-content">
          <HdToolkitSettings
            :config="hdToolkitConfig"
            :is-selecting-python="isSelectingPython"
            :is-selecting-removebg-weights="isSelectingRemovebgWeights"
            :is-selecting-highres-weights="isSelectingHighresWeights"
            :is-selecting-output="isSelectingOutput"
            @update-field="(key, value) => { hdToolkitConfig[key] = value }"
            @select-python-path="selectPythonPath"
            @select-removebg-weights-path="selectRemovebgWeightsPath"
            @select-highres-weights-path="selectHighresWeightsPath"
            @select-output-path="selectOutputPath"
          >
            <div class="save-button-container" style="display: flex; gap: 12px;">
              <n-button type="primary" size="large" @click="saveHdToolkitConfig" :loading="isSavingHdToolkit">保存设置</n-button>
            </div>
          </HdToolkitSettings>
        </div>
      </div>
        
      <!-- 对话插件设置 -->
      <div v-show="activeTab === 'dialog'" class="settings-tab-content">
          <div class="settings-content">
            <DialogSettings
              :config="dialogConfig"
              :is-selecting-folder="isSelectingDialogFolder"
              @update-field="(key, value) => { dialogConfig[key] = value }"
              @select-output-folder="selectDialogOutputFolder"
            >
              <div class="save-button-container">
                <n-button type="primary" size="large" @click="saveDialogConfig" :loading="isSavingDialog">
                  保存设置
                </n-button>
              </div>
            </DialogSettings>
          </div>
      </div>
        
      <SettingsHelpContent
        :active-tab="activeTab"
        :app-version="appVersion"
        :is-exporting-settings="isExportingSettings"
        :is-importing-settings="isImportingSettings"
        @export-settings="handleExportSettings"
        @import-settings="handleImportSettings"
      />

    </div>
    <footer class="open-source-footer">
      <span class="open-source-description">
        如果这个项目对你有帮助，欢迎 Star ⭐ 支持，也欢迎二次开发、提交 Issue 或 PR 一起改进。
        <a
          class="open-source-link"
          :href="openSourceUrl"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开 GitHub 开源仓库"
          title="打开 GitHub 开源仓库"
          @click="openSourceRepository"
        ><span aria-hidden="true">↗</span></a>
      </span>
    </footer>
  </div>
</template>

<script setup>
/** 设置页面：管理各工具参数、路径、快捷键及配置备份，按路由显示对应设置页签。 */
import { ref, reactive, onMounted, computed, watch } from 'vue'
import { useMessage, useDialog } from 'naive-ui'
import { useRoute } from 'vue-router'
import { normalizeApiBaseUrl } from '@shared/api-url.js'
import { useHoverPreviewSetting } from '../../../composables/useHoverPreviewSetting.js'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import StickfigureBasicSettings from './components/StickfigureBasicSettings.vue'
import StickfigureFrontHandSettings from './components/StickfigureFrontHandSettings.vue'
import StickfigureGroupNameSettings from './components/StickfigureGroupNameSettings.vue'
import HotkeySettings from './components/HotkeySettings.vue'
import GeminiSettings from './components/GeminiSettings.vue'
import HdToolkitSettings from './components/HdToolkitSettings.vue'
import DialogSettings from './components/DialogSettings.vue'
import { useHdToolkitSettings } from './composables/useHdToolkitSettings.js'
import { useHotkeySettings } from './composables/useHotkeySettings.js'
import {
  createGeminiBackupSnapshot,
  createStickfigureBackupSnapshot,
  createDialogBackupSnapshot,
  createSettingsArchive
} from './composables/settingsArchive.js'
import SettingsHelpContent from './components/SettingsHelpContent.vue'

const route = useRoute()
const message = useMessage()
const dialog = useDialog()

const openSourceUrl = 'https://github.com/ewkzcz/momentum-stickfigure'

const openSourceRepository = async (event) => {
  if (!window.electronAPI?.shell?.openExternal) return

  event.preventDefault()
  try {
    const result = await window.electronAPI.shell.openExternal(openSourceUrl)
    if (!result?.success) {
      message.error('打开开源仓库失败，请稍后重试')
    }
  } catch (error) {
    console.error('打开开源仓库失败:', error)
    message.error('打开开源仓库失败，请稍后重试')
  }
}

const SAVE_RESTART_HINT = '部分配置需要重启才能生效'
const SAVE_RESTART_MESSAGE = `设置已保存，${SAVE_RESTART_HINT}`
/**
 * 展示统一的配置保存提示。
 * 处理流程：
 * 1、使用统一重启提示文案，并合并调用方传入的消息选项。
 */
const showSaveRestartTip = (_baseMessage, options = {}) => {
  // 1、基础文案参数保留接口兼容性，实际内容统一使用保存提示。
  message.success(SAVE_RESTART_MESSAGE, {
    duration: 3000,
    keepAliveOnHover: true,
    ...options
  })
}

/**
 * 从路由确定当前设置页签。
 * 处理流程：
 * 1、优先读取路由元数据，缺失时显示人物插件设置。
 */
const activeTab = computed(() => {
  // 1、多个设置路由复用此组件，以元数据区分内容。
  return route.meta?.settingsTab || 'stickfigure'
})
const stickfigureSubTab = ref('basic') // 人物插件设置子标签页状态
const isSavingGemini = ref(false)
const isSelectingFolder = ref(false)
const isSavingStickfigure = ref(false)
const isSelectingStickfigureFolder = ref(false)

// 对话插件设置相关状态
const isSavingDialog = ref(false)
const isSelectingDialogFolder = ref(false)

// 配置导出所用的应用版本。
const appVersion = ref('2.0')

// 导入导出相关状态
const isExportingSettings = ref(false)
const isImportingSettings = ref(false)

/**
 * 推导默认生图项目路径。
 * 处理流程：
 * 1、读取用户目录和系统平台。
 * 2、构造图片目录中的项目路径，缺少用户目录时使用相对路径。
 */
const getDefaultProjectRoot = () => {
  // 1、桌面环境信息由预加载提供。
  const homedir = window.env?.homedir || ''
  const platform = window.env?.platform || 'win32'
  
  if (!homedir) {
    // 如果无法获取homedir，使用相对路径
    return './gemini-image'
  }
  
  // 2、按平台使用对应路径分隔符。
  if (platform === 'win32') {
    // Windows: C:\Users\{username}\Pictures\GeminiImage
    return `${homedir}\\Pictures\\GeminiImage`
  } else if (platform === 'darwin') {
    // MacOS: /Users/{username}/Pictures/GeminiImage
    return `${homedir}/Pictures/GeminiImage`
  } else {
    // Linux: /home/{username}/Pictures/GeminiImage
    return `${homedir}/Pictures/GeminiImage`
  }
}

/**
 * 推导默认人物图片导出目录。
 * 处理流程：
 * 1、读取用户目录，缺失时使用相对导出目录。
 * 2、按平台构造系统图片目录下的工具输出路径。
 */
const getDefaultPicturesPath = () => {
  // 1、为未保存输出位置的配置提供默认值。
  const homedir = window.env?.homedir || ''
  const platform = window.env?.platform || 'win32'
  
  if (!homedir) {
    // 如果无法获取homedir，使用当前目录
    return './简笔画导出'
  }
  
  // 2、构造平台对应的图片导出路径。
  if (platform === 'win32') {
    // Windows: C:\Users\{username}\Pictures\简笔画导出
    return `${homedir}\\Pictures\\简笔画导出`
  } else if (platform === 'darwin') {
    // MacOS: /Users/{username}/Pictures/简笔画导出
    return `${homedir}/Pictures/简笔画导出`
  } else {
    // Linux: /home/{username}/Pictures/简笔画导出
    return `${homedir}/Pictures/简笔画导出`
  }
}

// 导出文件名规则选项
const fileNamingRuleOptions = [
  { label: '时间戳+压缩语义信息（如：20251028142530双手惊恐.png）', value: 'timestamp-semantic' },
  { label: 'Hash+压缩语义信息（如：a3f9b2k5双手惊恐.png）', value: 'hash-semantic' },
  { label: '仅时间戳（如：20251028142530.png）', value: 'timestamp-only' },
  { label: '仅Hash（如：a3f9b2k5m7p4q8.png）', value: 'hash-only' }
]

// 前手分组配置默认值常量
const DEFAULT_FRONT_HAND_BOTH_NAMES = '交叉、合十、抱拳、结印、托脸、戳手指、双手抱臂、敲手'
const DEFAULT_FRONT_HAND_RIGHT_NAMES = '伏案右、伏案右边、拍胸、拍胸右、拍胸右边、拍胸口、拍胸口右、拍胸口右边、端起、端起右、端起右边、捂嘴右、捂嘴右边、拎东西、扶着头、摸头右、摸头右（2）、举手右、托腮（2）、擦汗、拳胸、吃东西动作、后手举起、单手结印、擦泪、比枪'

// 图组名称配置默认值常量（包含常见变体）
const DEFAULT_GROUP_NAMES = {
  frontHand: '前手、紧袖口1、古代长袖1、现代长袖1、长紧袖口1、上手、上手 副本、后手前置',
  backHand: '后手、前层后手、紧袖口2、古代长袖2、现代长袖2、长紧袖口2、下手、下手 副本、后手后置',
  bothHands: '双手、前手（双手）、前手(双手)',
  upperBody: '上身、上半身',
  lowerBody: '下身、下半身',
  action: '动作、手部',
  // 表情图组统一配置（包含所有表情变体）
  expression: '表情、表情(合并)、表情（合并）、表情1、表情2、专属表情、专属表情1、专属表情2、专属表情3、专属表情【灰豆绿色】、专属表情【粉色】、辅助表情、豆豆眼、豆豆眼1、豆豆眼2、豆豆眼表情、豆豆眼表情1、豆豆眼表情2、表情豆豆眼、帅哥眼睛、眼睛女、眼睛男、眉毛、眼睛、嘴、新表情、新新表情、脸 副本、眉毛 副本、嘴 副本、眼睛 副本、定制表情、定制表情1、定制表情2'
}

// API 配置（纳米香蕉生图）
const geminiConfig = reactive({
  apiKey: '',
  baseUrl: '',
  projectRoot: getDefaultProjectRoot(), // 提供默认的绝对路径
  outputDir: 'output',
  editOutputDir: 'output',
  logDir: 'logs'
})

/**
 * 初始化人物插件配置。
 * 处理流程：
 * 1、读取本地配置，逐字段补齐导出规则、匹配和图组名称。
 * 2、无保存值或解析失败时返回完整默认配置。
 */
const loadInitialStickfigureConfig = () => {
  // 1、布尔字段显式判断 undefined，保留用户保存的关闭状态。
  try {
    const savedConfig = localStorage.getItem('stickfigure-config')
    if (savedConfig) {
      const parsed = JSON.parse(savedConfig)
      console.log('📖 初始化加载简笔画配置:', parsed)
      console.log('📋 图组名称配置:', parsed.groupNames)
      
      // 确保必要字段存在
      return {
        outputRoot: parsed.outputRoot || getDefaultPicturesPath(),
        overwriteMode: parsed.overwriteMode || 'rename', // 保留字段以兼容旧版本
        fileNamingRule: parsed.fileNamingRule || 'timestamp-semantic', // 新的文件名规则
        duplicateFileHandling: parsed.duplicateFileHandling || 'addIndex', // 同名文件处理方式
        createPsdFolder: parsed.createPsdFolder !== undefined ? parsed.createPsdFolder : true,
        enableFuzzyMatch: parsed.enableFuzzyMatch !== undefined ? parsed.enableFuzzyMatch : true, // 默认启用模糊匹配
        frontHandBothNames: parsed.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES,
        frontHandRightNames: parsed.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES,
        groupNames: {
          frontHand: parsed.groupNames?.frontHand || DEFAULT_GROUP_NAMES.frontHand,
          backHand: parsed.groupNames?.backHand || DEFAULT_GROUP_NAMES.backHand,
          bothHands: parsed.groupNames?.bothHands || DEFAULT_GROUP_NAMES.bothHands,
          upperBody: parsed.groupNames?.upperBody || DEFAULT_GROUP_NAMES.upperBody,
          lowerBody: parsed.groupNames?.lowerBody || DEFAULT_GROUP_NAMES.lowerBody,
          action: parsed.groupNames?.action || DEFAULT_GROUP_NAMES.action,
          expression: parsed.groupNames?.expression || DEFAULT_GROUP_NAMES.expression
        }
      }
    }
  } catch (error) {
    console.error('初始化加载配置失败:', error)
  }
  
  // 2、默认配置包含完整图组结构，保证表单可直接绑定嵌套字段。
  return {
    outputRoot: getDefaultPicturesPath(),
    overwriteMode: 'rename', // 保留字段以兼容旧版本
    fileNamingRule: 'timestamp-semantic', // 新的文件名规则，默认为时间戳+语义信息
    duplicateFileHandling: 'addIndex', // 同名文件处理方式，默认添加序号
    createPsdFolder: true,
    enableFuzzyMatch: true, // 默认启用模糊匹配
    frontHandBothNames: DEFAULT_FRONT_HAND_BOTH_NAMES,
    frontHandRightNames: DEFAULT_FRONT_HAND_RIGHT_NAMES,
    groupNames: {
      frontHand: DEFAULT_GROUP_NAMES.frontHand,
      backHand: DEFAULT_GROUP_NAMES.backHand,
      bothHands: DEFAULT_GROUP_NAMES.bothHands,
      upperBody: DEFAULT_GROUP_NAMES.upperBody,
      lowerBody: DEFAULT_GROUP_NAMES.lowerBody,
      action: DEFAULT_GROUP_NAMES.action,
      expression: DEFAULT_GROUP_NAMES.expression
    }
  }
}

const stickfigureConfig = reactive(loadInitialStickfigureConfig())

// 悬浮预览设置（使用 composable 实现同步和持久化，v-model 会自动保存和广播）
// 主画布悬浮预览
const { hoverPreviewEnabled: canvasHoverPreviewEnabled } = useHoverPreviewSetting({ 
  type: 'canvas', 
  source: 'SettingsPage' 
})
// 部件悬浮预览
const { hoverPreviewEnabled: partHoverPreviewEnabled } = useHoverPreviewSetting({ 
  type: 'part', 
  source: 'SettingsPage' 
})

// 快捷键域在原配置初始化位置创建；跨域恢复、导入和模板共用同一配置对象。
const {
  hotkeysConfig,
  isSavingHotkeys,
  currentEditingHotkey,
  DEFAULT_HOTKEYS,
  persistHotkeysConfig,
  handleHotkeyInput,
  resetHotkey,
  clearHotkey,
  saveHotkeysConfig
} = useHotkeySettings({ message, showSaveRestartTip, SAVE_RESTART_HINT, appVersion, geminiConfig })

// 高清表单由 composable 管理；跨域恢复、导入和导出继续读写同一配置对象。
const {
  hdToolkitConfig,
  isSavingHdToolkit,
  isSelectingPython,
  isSelectingRemovebgWeights,
  isSelectingHighresWeights,
  isSelectingOutput,
  getDefaultHdToolkitPath,
  loadHdToolkitConfigFromBackend,
  saveHdToolkitConfig,
  selectPythonPath,
  selectRemovebgWeightsPath,
  selectHighresWeightsPath,
  selectOutputPath
} = useHdToolkitSettings({ message, showSaveRestartTip, appVersion, geminiConfig })

/**
 * 初始化对话插件输出配置。
 * 处理流程：
 * 1、存在保存值时直接解析返回。
 * 2、读取失败或未保存时使用空输出根目录和按日期分组默认值。
 */
function loadInitialDialogConfig() {
  // 1、保存对象直接使用，此处不执行字段补齐。
  try {
    const saved = localStorage.getItem('dialog-config')
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (error) {
    console.warn('加载对话插件配置失败:', error)
  }
  
  // 2、默认输出目录由用户后续选择。
  return {
    outputRoot: '',
    createDateFolder: true
  }
}

const dialogConfig = reactive(loadInitialDialogConfig())

// 表单引用
const geminiFormRef = ref(null)
const hotkeysFormRef = ref(null)
const hdToolkitFormRef = ref(null)
const dialogFormRef = ref(null)

/**
 * 恢复备份并将各类配置加载到表单。
 * 处理流程：
 * 1、尝试读取备份并写回各类本地配置，失败时沿用本地存储。
 * 2、重新加载人物和抠图高清配置，兼容旧字段名称。
 * 3、加载生图配置，修正旧路径并统一编辑输出目录。
 * 4、从主进程补充尚未定义的生图字段，不覆盖用户现值。
 */
const loadConfig = async () => {
  try {
    // 1、优先恢复用户文档目录中的配置备份。
    try {
      const restoreResult = await window.electronAPI.settings.restoreSettings()
      if (restoreResult.success && restoreResult.settings) {
        console.log('📁 从用户文档目录找到配置备份，正在恢复...')
        
        // 恢复简笔画配置
        if (restoreResult.settings.stickfigureConfig) {
          localStorage.setItem('stickfigure-config', JSON.stringify(restoreResult.settings.stickfigureConfig))
          console.log('✅ 简笔画配置已从备份恢复')
        }
        
        // 恢复纳米香蕉配置
        const restoredGeminiConfig = restoreResult.settings.geminiConfig || restoreResult.settings.falConfig
        if (restoredGeminiConfig) {
          localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(restoredGeminiConfig))
          if (localStorage.getItem('fal-config')) {
            localStorage.removeItem('fal-config')
          }
          console.log('✅ 纳米香蕉配置已从备份恢复')
        }
        
        // 恢复快捷键配置
        if (restoreResult.settings.hotkeysConfig) {
          hotkeysConfig.toggleMainWindow = restoreResult.settings.hotkeysConfig.toggleMainWindow || DEFAULT_HOTKEYS.toggleMainWindow
          hotkeysConfig.togglePreviewWindow = restoreResult.settings.hotkeysConfig.togglePreviewWindow || DEFAULT_HOTKEYS.togglePreviewWindow
          hotkeysConfig.openSearch = restoreResult.settings.hotkeysConfig.openSearch || DEFAULT_HOTKEYS.openSearch
          hotkeysConfig.toggleCanvasHover = restoreResult.settings.hotkeysConfig.toggleCanvasHover || DEFAULT_HOTKEYS.toggleCanvasHover
          persistHotkeysConfig(hotkeysConfig)
          console.log('✅ 快捷键配置已从备份恢复')
        }
        
        // 恢复抠图高清配置
        if (restoreResult.settings.hdToolkitConfig) {
          localStorage.setItem('hd-toolkit-config', JSON.stringify(restoreResult.settings.hdToolkitConfig))
          console.log('✅ 抠图高清配置已从备份恢复')
          
          // 更新到 reactive 对象，兼容旧字段名
          const cfg = restoreResult.settings.hdToolkitConfig
          hdToolkitConfig.pythonHome = cfg.pythonHome || cfg.pythonPath || ''
          hdToolkitConfig.removebgWeightsDir = cfg.removebgWeightsDir || cfg.removebgWeightsPath || ''
          hdToolkitConfig.highresWeightsDir = cfg.highresWeightsDir || cfg.highresWeightsPath || ''
          hdToolkitConfig.outputDir = cfg.outputDir || cfg.outputPath || ''
        }
      } else {
        console.log('ℹ️ 未找到配置备份，使用localStorage中的配置')
      }
    } catch (restoreError) {
      console.log('⚠️ 恢复配置备份失败，使用localStorage中的配置:', restoreError)
    }
    
    // 2、从恢复后的本地存储重新读取人物配置并更新表单。
    console.log('🔄 重新加载简笔画配置...')
    const savedStickfigureConfig = localStorage.getItem('stickfigure-config')
    if (savedStickfigureConfig) {
      const parsed = JSON.parse(savedStickfigureConfig)
      console.log('📖 从localStorage加载简笔画配置:', parsed)
      console.log('📋 图组名称配置:', parsed.groupNames)
      
      // 更新 reactive 对象的每个属性
      stickfigureConfig.outputRoot = parsed.outputRoot || getDefaultPicturesPath()
      stickfigureConfig.overwriteMode = parsed.overwriteMode || 'rename'
      stickfigureConfig.createPsdFolder = parsed.createPsdFolder !== undefined ? parsed.createPsdFolder : true
      stickfigureConfig.enableFuzzyMatch = parsed.enableFuzzyMatch !== undefined ? parsed.enableFuzzyMatch : true
      stickfigureConfig.frontHandBothNames = parsed.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES
      stickfigureConfig.frontHandRightNames = parsed.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES
      
      // 更新图组名称配置
      if (parsed.groupNames) {
        stickfigureConfig.groupNames.frontHand = parsed.groupNames.frontHand || DEFAULT_GROUP_NAMES.frontHand
        stickfigureConfig.groupNames.backHand = parsed.groupNames.backHand || DEFAULT_GROUP_NAMES.backHand
        stickfigureConfig.groupNames.bothHands = parsed.groupNames.bothHands || DEFAULT_GROUP_NAMES.bothHands
        stickfigureConfig.groupNames.upperBody = parsed.groupNames.upperBody || DEFAULT_GROUP_NAMES.upperBody
        stickfigureConfig.groupNames.lowerBody = parsed.groupNames.lowerBody || DEFAULT_GROUP_NAMES.lowerBody
        stickfigureConfig.groupNames.action = parsed.groupNames.action || DEFAULT_GROUP_NAMES.action
        stickfigureConfig.groupNames.expression = parsed.groupNames.expression || DEFAULT_GROUP_NAMES.expression
      }
      
      console.log('✅ 简笔画配置已更新到组件')
    } else {
      console.log('⚠️ localStorage中没有找到简笔画配置，使用默认值')
    }

    // 3、重新加载抠图高清路径并兼容旧字段名。
    const savedHdToolkitConfig = localStorage.getItem('hd-toolkit-config')
    if (savedHdToolkitConfig) {
      const parsed = JSON.parse(savedHdToolkitConfig)
      console.log('📖 从localStorage加载抠图高清配置:', parsed)
      
      // 兼容旧字段名
      hdToolkitConfig.pythonHome = parsed.pythonHome || parsed.pythonPath || ''
      hdToolkitConfig.removebgWeightsDir = parsed.removebgWeightsDir || parsed.removebgWeightsPath || ''
      hdToolkitConfig.highresWeightsDir = parsed.highresWeightsDir || parsed.highresWeightsPath || ''
      hdToolkitConfig.outputDir = parsed.outputDir || parsed.outputPath || ''
      
      console.log('✅ 抠图高清配置已更新到组件')
    } else {
      console.log('⚠️ localStorage中没有找到抠图高清配置，使用默认值')
    }
    
    // 4、生图配置优先使用当前存储键，缺失时读取旧键。
    const savedGeminiConfig = localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config')
    let needsSave = false
    
    if (savedGeminiConfig) {
      const parsed = JSON.parse(savedGeminiConfig)
      
      // 检查保存的projectRoot是否包含旧的硬编码用户名或不存在的路径
      if (parsed.projectRoot && 
          (parsed.projectRoot.includes('Administrator\\Pictures\\fal-project') ||
           parsed.projectRoot.includes('~/Pictures/fal-project'))) {
        // 如果是旧的硬编码路径，使用新的默认路径
        console.log('检测到旧的projectRoot路径，使用新的默认路径')
        parsed.projectRoot = getDefaultProjectRoot()
        needsSave = true
      }
      
      Object.assign(geminiConfig, parsed)
      
      // 如果projectRoot为空或无效，设置为默认值
      if (!geminiConfig.projectRoot || geminiConfig.projectRoot.trim() === '') {
        geminiConfig.projectRoot = getDefaultProjectRoot()
        needsSave = true
      }
      
      // 确保编辑图片路径与生成图片路径一致
      geminiConfig.editOutputDir = geminiConfig.outputDir
      
      // 如果检测到需要更新路径，立即保存到localStorage
      if (needsSave) {
        console.log('自动保存更新后的配置到localStorage:', geminiConfig.projectRoot)
        localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
        if (localStorage.getItem('fal-config')) {
          localStorage.removeItem('fal-config')
        }
      }
    }


    // 5、后端配置仅补充尚未定义的字段，保留表单现有用户设置。
    const result = await window.falApi?.getConfig?.()
    if (result?.success && result.data?.config) {
      // 合并配置，优先使用本地存储的用户配置
      Object.keys(result.data.config).forEach(key => {
        if (geminiConfig[key] === undefined) {
          geminiConfig[key] = result.data.config[key]
        }
      })
    }
  } catch (error) {
    console.error('加载配置失败:', error)
  }
}

/**
 * 保存生图服务配置。
 * 处理流程：
 * 1、校验密钥、中转站地址和绝对项目路径。
 * 2、统一输出目录，保存当前键并移除旧存储键。
 * 3、尝试创建目录和自动备份，再提示保存结果并解除忙碌状态。
 */
const saveGeminiConfig = async () => {
  try {
    isSavingGemini.value = true

    // 1、校验服务连接信息和项目路径后才写入配置。
    if (!geminiConfig.apiKey.trim()) {
      message.error('请输入纳米香蕉生图API密钥', {
        duration: 4000,
        keepAliveOnHover: true
      })
      return
    }

    geminiConfig.baseUrl = normalizeApiBaseUrl(geminiConfig.baseUrl)

    // 验证项目根路径
    if (!geminiConfig.projectRoot.trim()) {
      message.error('请选择项目根路径', {
        duration: 4000,
        keepAliveOnHover: true
      })
      return
    }

    if (!isAbsolutePath(geminiConfig.projectRoot)) {
      message.error('项目根路径必须是绝对路径', {
        duration: 4000,
        keepAliveOnHover: true
      })
      return
    }

    // 2、保存时统一编辑与生成结果的输出位置。
    geminiConfig.editOutputDir = geminiConfig.outputDir

    // 保存配置到本地存储（包括用户选择的baseUrl）
    localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
    if (localStorage.getItem('fal-config')) {
      localStorage.removeItem('fal-config')
    }

    // 3、目录创建失败只记录警告，不撤销已保存配置。
    try {
      await window.falApi?.createDirectories?.(JSON.parse(JSON.stringify(geminiConfig)))
    } catch (dirError) {
      console.warn('创建目录失败:', dirError)
    }

    // 4、备份当前各工具配置，备份失败不影响本地保存。
    try {
      const allSettings = createGeminiBackupSnapshot({ localStorage, appVersion, geminiConfig })
      await window.electronAPI.settings.autoBackupSettings(allSettings)
      console.log('💾 配置已自动备份到用户文档目录')
    } catch (backupError) {
      console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
    }

    showSaveRestartTip('纳米香蕉生图配置保存成功！')
  } catch (error) {
    console.error('保存纳米香蕉配置失败:', error)
    message.error('保存失败: ' + error.message, {
      duration: 5000,
      keepAliveOnHover: true
    })
  } finally {
    isSavingGemini.value = false
  }
}

/**
 * 选择生图项目根目录。
 * 处理流程：
 * 1、打开系统目录选择器，成功时更新表单，取消时保留原值。
 * 2、反馈选择失败并在结束时恢复选择按钮状态。
 */
const selectProjectRootFolder = async () => {
  // 1、目录选择仅更新表单，持久化由保存按钮执行。
  try {
    isSelectingFolder.value = true

    const result = await window.fileSystem.selectFolder()

    if (result.success && result.path) {
      geminiConfig.projectRoot = result.path
      message.success('项目根路径已设置: ' + result.path, {
        duration: 3000,
        keepAliveOnHover: true
      })
    } else if (result.canceled) {
      console.log('用户取消了文件夹选择')
    } else {
      message.error('选择文件夹失败: ' + (result.error || '未知错误'), {
        duration: 5000,
        keepAliveOnHover: true
      })
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    message.error('选择文件夹失败: ' + error.message, {
      duration: 5000,
      keepAliveOnHover: true
    })
  } finally {
    isSelectingFolder.value = false
  }
}

/** 重置生图项目路径；处理流程：1、重新推导当前系统默认路径并更新表单提示。 */
const resetProjectRootToDefault = () => {
  // 1、仅重置表单字段，用户保存后才持久化。
  const defaultPath = getDefaultProjectRoot()
  geminiConfig.projectRoot = defaultPath
  message.success('已重置为默认路径: ' + defaultPath, {
    duration: 3000,
    keepAliveOnHover: true
  })
  console.log('重置项目根路径为:', defaultPath)
}

/**
 * 判断路径是否为绝对路径。
 * 处理流程：
 * 1、拒绝空值，依次识别 Windows 盘符、UNC 和 POSIX 根路径。
 */
const isAbsolutePath = (path) => {
  // 1、仅检查格式，不检测磁盘路径是否存在。
  if (!path) return false
  
  // Windows 绝对路径模式: C:\ 或 \\server\share
  if (/^[A-Za-z]:\\/.test(path) || /^\\\\/.test(path)) {
    return true
  }
  
  // Unix/Linux/Mac 绝对路径模式: /path
  if (path.startsWith('/')) {
    return true
  }
  
  return false
}

// ==================== 简笔画人物插件配置管理 ====================

/**
 * 保存人物导出和图层匹配设置。
 * 处理流程：
 * 1、校验绝对输出目录，规范空名称并组装保存对象。
 * 2、写入配置并回读，更新表单中被默认值补齐的字段。
 * 3、尝试备份全部配置，反馈保存结果并恢复按钮状态。
 */
const saveStickfigureConfig = async () => {
  try {
    isSavingStickfigure.value = true

    // 1、保存根目录必须非空且为绝对路径。
    if (!stickfigureConfig.outputRoot.trim()) {
      message.error('请选择图片保存根目录', {
        duration: 4000,
        keepAliveOnHover: true
      })
      return
    }

    if (!isAbsolutePath(stickfigureConfig.outputRoot)) {
      message.error('图片保存根目录必须是绝对路径', {
        duration: 4000,
        keepAliveOnHover: true
      })
      return
    }

    // 2、提取普通字段并为留空名称恢复默认值。
    // 如果某个图组名称为空，使用默认值
    const configToSave = {
      outputRoot: stickfigureConfig.outputRoot,
      overwriteMode: stickfigureConfig.overwriteMode,
      fileNamingRule: stickfigureConfig.fileNamingRule || 'timestamp-semantic', // 新增：文件名规则
      duplicateFileHandling: stickfigureConfig.duplicateFileHandling || 'addIndex', // 新增：同名文件处理方式
      createPsdFolder: stickfigureConfig.createPsdFolder,
      enableFuzzyMatch: stickfigureConfig.enableFuzzyMatch !== undefined ? stickfigureConfig.enableFuzzyMatch : true,
      frontHandBothNames: stickfigureConfig.frontHandBothNames.trim() || DEFAULT_FRONT_HAND_BOTH_NAMES,
      frontHandRightNames: stickfigureConfig.frontHandRightNames.trim() || DEFAULT_FRONT_HAND_RIGHT_NAMES,
      groupNames: {
        frontHand: stickfigureConfig.groupNames.frontHand.trim() || DEFAULT_GROUP_NAMES.frontHand,
        backHand: stickfigureConfig.groupNames.backHand.trim() || DEFAULT_GROUP_NAMES.backHand,
        bothHands: stickfigureConfig.groupNames.bothHands.trim() || DEFAULT_GROUP_NAMES.bothHands,
        upperBody: stickfigureConfig.groupNames.upperBody.trim() || DEFAULT_GROUP_NAMES.upperBody,
        lowerBody: stickfigureConfig.groupNames.lowerBody.trim() || DEFAULT_GROUP_NAMES.lowerBody,
        action: stickfigureConfig.groupNames.action.trim() || DEFAULT_GROUP_NAMES.action,
        expression: stickfigureConfig.groupNames.expression.trim() || DEFAULT_GROUP_NAMES.expression
      }
    }
    
    console.log('💾 保存简笔画配置:', configToSave)
    console.log('📋 保存的图组名称:', configToSave.groupNames)
    
    // 保存前检查是否有空值被替换为默认值
    const emptyFields = []
    if (!stickfigureConfig.frontHandBothNames.trim()) emptyFields.push('前手-双手名称')
    if (!stickfigureConfig.frontHandRightNames.trim()) emptyFields.push('前手-右手名称')
    if (!stickfigureConfig.groupNames.frontHand.trim()) emptyFields.push('前手图组名称')
    if (!stickfigureConfig.groupNames.backHand.trim()) emptyFields.push('后手图组名称')
    if (!stickfigureConfig.groupNames.bothHands.trim()) emptyFields.push('双手图组名称')
    if (!stickfigureConfig.groupNames.upperBody.trim()) emptyFields.push('上身图组名称')
    if (!stickfigureConfig.groupNames.lowerBody.trim()) emptyFields.push('下身图组名称')
    if (!stickfigureConfig.groupNames.action.trim()) emptyFields.push('动作图组名称')
    if (!stickfigureConfig.groupNames.expression.trim()) emptyFields.push('表情图组名称')
    
    if (emptyFields.length > 0) {
      console.log('⚠️ 以下字段为空，已自动填充默认值:', emptyFields.join('、'))
    }
    
    localStorage.setItem('stickfigure-config', JSON.stringify(configToSave))
    
    // 3、回读已保存内容，记录实际写入结果。
    const savedCheck = localStorage.getItem('stickfigure-config')
    const parsedCheck = JSON.parse(savedCheck)
    console.log('✅ 验证保存成功，读取到的配置:', parsedCheck.groupNames)
    
    // 4、将补齐后的名称同步回表单，避免显示与保存值不一致。
    stickfigureConfig.createPsdFolder = configToSave.createPsdFolder
    stickfigureConfig.enableFuzzyMatch = configToSave.enableFuzzyMatch
    stickfigureConfig.frontHandBothNames = configToSave.frontHandBothNames
    stickfigureConfig.frontHandRightNames = configToSave.frontHandRightNames
    stickfigureConfig.groupNames.frontHand = configToSave.groupNames.frontHand
    stickfigureConfig.groupNames.backHand = configToSave.groupNames.backHand
    stickfigureConfig.groupNames.bothHands = configToSave.groupNames.bothHands
    stickfigureConfig.groupNames.upperBody = configToSave.groupNames.upperBody
    stickfigureConfig.groupNames.lowerBody = configToSave.groupNames.lowerBody
    stickfigureConfig.groupNames.action = configToSave.groupNames.action
    stickfigureConfig.groupNames.expression = configToSave.groupNames.expression

    // 5、备份失败不回滚已经保存的人物配置。
    try {
      const allSettings = createStickfigureBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
      await window.electronAPI.settings.autoBackupSettings(allSettings)
      console.log('💾 配置已自动备份到用户文档目录')
    } catch (backupError) {
      console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
    }

    showSaveRestartTip('简笔画人物插件配置保存成功！')
  } catch (error) {
    console.error('保存简笔画配置失败:', error)
    message.error('保存失败: ' + error.message, {
      duration: 5000,
      keepAliveOnHover: true
    })
  } finally {
    isSavingStickfigure.value = false
  }
}

/**
 * 选择人物图片输出目录。
 * 处理流程：
 * 1、成功选择时更新表单并提示，取消时保持原值。
 * 2、无论成功或失败都结束选择状态。
 */
const selectStickfigureOutputFolder = async () => {
  // 1、目录合法性由保存流程再次校验。
  try {
    isSelectingStickfigureFolder.value = true

    const result = await window.fileSystem.selectFolder()

    if (result.success && result.path) {
      stickfigureConfig.outputRoot = result.path
      message.success('图片保存根目录已设置: ' + result.path, {
        duration: 3000,
        keepAliveOnHover: true
      })
    } else if (result.canceled) {
      console.log('用户取消了文件夹选择')
    } else {
      message.error('选择文件夹失败: ' + (result.error || '未知错误'), {
        duration: 5000,
        keepAliveOnHover: true
      })
    }
  } catch (error) {
    console.error('选择文件夹失败:', error)
    message.error('选择文件夹失败: ' + error.message, {
      duration: 5000,
      keepAliveOnHover: true
    })
  } finally {
    isSelectingStickfigureFolder.value = false
  }
}

/** 重置人物输出路径；处理流程：1、推导默认图片目录，更新表单并提示。 */
const resetStickfigureOutputToDefault = () => {
  // 1、重置操作尚未写入持久化配置。
  const defaultPath = getDefaultPicturesPath()
  stickfigureConfig.outputRoot = defaultPath
  message.success('已重置为默认路径: ' + defaultPath, {
    duration: 3000,
    keepAliveOnHover: true
  })
  console.log('重置简笔画输出路径为:', defaultPath)
}

/** 重置前手双手名称；处理流程：1、用默认匹配名称覆盖表单字段并提示。 */
const resetFrontHandBothNames = () => {
  // 1、恢复内置名称集合，等待用户保存。
  stickfigureConfig.frontHandBothNames = DEFAULT_FRONT_HAND_BOTH_NAMES
  message.success('已重置前手-双手名称为默认值', {
    duration: 3000,
    keepAliveOnHover: true
  })
  console.log('重置前手-双手名称为:', DEFAULT_FRONT_HAND_BOTH_NAMES)
}

/** 重置前手右手名称；处理流程：1、用默认匹配名称覆盖表单字段并提示。 */
const resetFrontHandRightNames = () => {
  // 1、恢复内置右手名称集合。
  stickfigureConfig.frontHandRightNames = DEFAULT_FRONT_HAND_RIGHT_NAMES
  message.success('已重置前手-右手名称为默认值', {
    duration: 3000,
    keepAliveOnHover: true
  })
  console.log('重置前手-右手名称为:', DEFAULT_FRONT_HAND_RIGHT_NAMES)
}

/**
 * 重置指定图组的匹配名称。
 * 处理流程：
 * 1、确认图组键有默认配置，写回名称并显示对应中文提示。
 */
const resetGroupName = (groupKey) => {
  // 1、未知图组键不修改现有配置。
  if (DEFAULT_GROUP_NAMES[groupKey]) {
    stickfigureConfig.groupNames[groupKey] = DEFAULT_GROUP_NAMES[groupKey]
    const groupNameMap = {
      frontHand: '前手',
      backHand: '后手',
      bothHands: '双手',
      upperBody: '上身',
      lowerBody: '下身',
      action: '动作',
      expression: '表情'
    }
    message.success(`已重置${groupNameMap[groupKey]}图组名称为默认值`, {
      duration: 3000,
      keepAliveOnHover: true
    })
    console.log(`重置${groupNameMap[groupKey]}图组名称为:`, DEFAULT_GROUP_NAMES[groupKey])
  }
}

// ==================== 纳米香蕉配置管理 ====================

/**
 * 选择对话插件输出文件夹
 * 处理流程：
 * 1、打开系统目录选择器并更新成功选择的路径。
 * 2、报告错误并恢复选择按钮状态。
 */
const selectDialogOutputFolder = async () => {
  // 1、只更新对话工具表单，不影响其他工具的输出目录。
  try {
    isSelectingDialogFolder.value = true
    const result = await window.fileSystem.selectFolder()
    
    if (result.success && result.path) {
      dialogConfig.outputRoot = result.path
      message.success('输出文件夹已设置', { duration: 2000 })
    }
  } catch (error) {
    console.error('选择输出文件夹失败:', error)
    message.error('选择失败: ' + error.message)
  } finally {
    isSelectingDialogFolder.value = false
  }
}

/**
 * 保存对话插件配置
 * 处理流程：
 * 1、校验输出目录，保存目录和日期分组选项。
 * 2、将对话配置连同其他工具设置备份，最后反馈保存结果。
 */
const saveDialogConfig = async () => {
  // 1、空目录不保存，其他路径规则由实际输出流程处理。
  try {
    isSavingDialog.value = true
    
    // 验证必填项
    if (!dialogConfig.outputRoot || !dialogConfig.outputRoot.trim()) {
      message.error('请选择图片保存目录')
      return
    }
    
    const configToSave = {
      outputRoot: dialogConfig.outputRoot,
      createDateFolder: dialogConfig.createDateFolder
    }
    
    // 2、先写入对话工具独立配置，再尝试整体备份。
    localStorage.setItem('dialog-config', JSON.stringify(configToSave))
    
    // 自动备份配置到用户文档目录
    try {
      const allSettings = createDialogBackupSnapshot({ localStorage, appVersion, geminiConfig, configToSave })
      await window.electronAPI.settings.autoBackupSettings(allSettings)
      console.log('💾 配置已自动备份到用户文档目录')
    } catch (backupError) {
      console.warn('⚠️ 自动备份失败（不影响保存）:', backupError)
    }
    
    showSaveRestartTip('对话插件配置保存成功！')
  } catch (error) {
    console.error('保存对话插件配置失败:', error)
    message.error('保存失败: ' + error.message)
  } finally {
    isSavingDialog.value = false
  }
}

// ==================== 配置导入导出功能 ====================

// 四域草稿已初始化；工厂仅创建导出操作，导出状态仍由页面原位持有。
const { handleExportSettings } = createSettingsArchive({
  window,
  message,
  appVersion,
  isExportingSettings,
  stickfigureConfig,
  geminiConfig,
  hotkeysConfig,
  hdToolkitConfig
})

/**
 * 从JSON文件导入配置
 * 处理流程：
 * 1、请求主进程选择并读取配置文件，版本不同时等待用户确认。
 * 2、分别应用人物、生图、快捷键和抠图高清配置，兼容旧字段。
 * 3、将快捷键和环境配置同步到主进程，反馈结果并恢复按钮状态。
 */
const handleImportSettings = async () => {
  // 1、先完成文件读取和版本确认，再修改任何配置。
  try {
    isImportingSettings.value = true
    
    console.log('[设置页] 开始导入配置...')
    
    // 调用文件系统API选择文件
    const result = await window.electronAPI.settings.importSettings()
    
    if (result.success && result.settings) {
      const importedSettings = result.settings
      
      console.log('[设置页] 配置已读取:', importedSettings)
      
      // 2、版本号用于配置兼容提示，不涉及软件更新或授权校验。
      if (importedSettings.version && importedSettings.version !== appVersion.value) {
        const confirmResult = await new Promise((resolve) => {
          dialog.warning({
            title: '版本不匹配',
            content: `导入的配置来自版本 ${importedSettings.version}，当前版本是 ${appVersion.value}。配置可能不兼容，是否继续导入？`,
            positiveText: '继续导入',
            negativeText: '取消',
            onPositiveClick: () => {
              resolve(true)
            },
            onNegativeClick: () => {
              resolve(false)
            }
          })
        })
        
        if (!confirmResult) {
          console.log('[设置页] 用户取消导入')
          return
        }
      }
      
      // 3、先更新人物表单，再持久化导入的人物配置。
      if (importedSettings.stickfigureConfig) {
        const imported = importedSettings.stickfigureConfig
        
        // 更新基础配置
        stickfigureConfig.outputRoot = imported.outputRoot || getDefaultPicturesPath()
        stickfigureConfig.overwriteMode = imported.overwriteMode || 'rename'
        stickfigureConfig.fileNamingRule = imported.fileNamingRule || 'timestamp-semantic' // 新增：文件名规则
        stickfigureConfig.duplicateFileHandling = imported.duplicateFileHandling || 'addIndex' // 新增：同名文件处理方式
        stickfigureConfig.createPsdFolder = imported.createPsdFolder !== undefined ? imported.createPsdFolder : true
        stickfigureConfig.enableFuzzyMatch = imported.enableFuzzyMatch !== undefined ? imported.enableFuzzyMatch : true
        stickfigureConfig.frontHandBothNames = imported.frontHandBothNames || DEFAULT_FRONT_HAND_BOTH_NAMES
        stickfigureConfig.frontHandRightNames = imported.frontHandRightNames || DEFAULT_FRONT_HAND_RIGHT_NAMES
        
        // 更新图组名称配置
        if (imported.groupNames) {
          stickfigureConfig.groupNames.frontHand = imported.groupNames.frontHand || DEFAULT_GROUP_NAMES.frontHand
          stickfigureConfig.groupNames.backHand = imported.groupNames.backHand || DEFAULT_GROUP_NAMES.backHand
          stickfigureConfig.groupNames.bothHands = imported.groupNames.bothHands || DEFAULT_GROUP_NAMES.bothHands
          stickfigureConfig.groupNames.upperBody = imported.groupNames.upperBody || DEFAULT_GROUP_NAMES.upperBody
          stickfigureConfig.groupNames.lowerBody = imported.groupNames.lowerBody || DEFAULT_GROUP_NAMES.lowerBody
          stickfigureConfig.groupNames.action = imported.groupNames.action || DEFAULT_GROUP_NAMES.action
          stickfigureConfig.groupNames.expression = imported.groupNames.expression || DEFAULT_GROUP_NAMES.expression
        }
        
        // 保存到 localStorage
        localStorage.setItem('stickfigure-config', JSON.stringify(imported))
        console.log('[设置页] 简笔画配置已导入并更新到界面')
      }
      
      // 4、接受当前生图配置名和旧版配置名，统一写入当前存储键。
      const importedGeminiConfig = importedSettings.geminiConfig || importedSettings.falConfig
      if (importedGeminiConfig) {
        const imported = importedGeminiConfig
        
        // 更新所有属性
        geminiConfig.apiKey = imported.apiKey || ''
        geminiConfig.baseUrl = imported.baseUrl || ''
        geminiConfig.projectRoot = imported.projectRoot || getDefaultProjectRoot()
        geminiConfig.outputDir = imported.outputDir || 'output'
        geminiConfig.editOutputDir = imported.editOutputDir || imported.outputDir || 'output'
        geminiConfig.logDir = imported.logDir || 'logs'
        
        // 保存到 localStorage
        localStorage.setItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY, JSON.stringify(geminiConfig))
        if (localStorage.getItem('fal-config')) {
          localStorage.removeItem('fal-config')
        }
        console.log('[设置页] 纳米香蕉配置已导入并更新到界面')
      }
      
      // 5、保存并广播快捷键，同时尝试更新系统注册。
      if (importedSettings.hotkeysConfig) {
        const imported = importedSettings.hotkeysConfig
        
        // 更新快捷键配置
        hotkeysConfig.toggleMainWindow = imported.toggleMainWindow || DEFAULT_HOTKEYS.toggleMainWindow
        hotkeysConfig.togglePreviewWindow = imported.togglePreviewWindow || DEFAULT_HOTKEYS.togglePreviewWindow
        hotkeysConfig.openSearch = imported.openSearch || DEFAULT_HOTKEYS.openSearch
        hotkeysConfig.toggleCanvasHover = imported.toggleCanvasHover || DEFAULT_HOTKEYS.toggleCanvasHover
        
        // 保存到 localStorage
        persistHotkeysConfig(hotkeysConfig)
        
        // 通知主进程更新全局快捷键
        if (window.electronAPI?.hotkeys?.updateHotkeys) {
          try {
            await window.electronAPI.hotkeys.updateHotkeys(hotkeysConfig)
            console.log('[设置页] 快捷键配置已导入并更新到主进程')
          } catch (err) {
            console.warn('[设置页] 更新主进程快捷键失败:', err)
          }
        }
        
        console.log('[设置页] 快捷键配置已导入并更新到界面')
      }

      // 6、统一环境路径字段，再同步本地和主进程配置。
      if (importedSettings.hdToolkitConfig) {
        const imported = importedSettings.hdToolkitConfig
        
        // 统一为规范键名
        hdToolkitConfig.pythonHome = imported.pythonHome || imported.pythonPath || getDefaultHdToolkitPath('python-env\\python3\\python.exe')
        hdToolkitConfig.removebgWeightsDir = imported.removebgWeightsDir || imported.removebgWeightsPath || getDefaultHdToolkitPath('python-env\\weights\\removebg')
        hdToolkitConfig.highresWeightsDir = imported.highresWeightsDir || imported.highresWeightsPath || getDefaultHdToolkitPath('python-env\\weights\\highres')
        hdToolkitConfig.outputDir = imported.outputDir || imported.outputPath || 'C:\\Users\\Asus\\Pictures\\hd-toolkit'

        // 保存到 localStorage（用规范键名）
        localStorage.setItem('hd-toolkit-config', JSON.stringify({
          pythonHome: hdToolkitConfig.pythonHome,
          removebgWeightsDir: hdToolkitConfig.removebgWeightsDir,
          highresWeightsDir: hdToolkitConfig.highresWeightsDir,
          outputDir: hdToolkitConfig.outputDir
        }))

        // 同步到后端配置文件
        if (window.hdToolkit?.saveConfig) {
          try {
            await window.hdToolkit.saveConfig({
              pythonHome: hdToolkitConfig.pythonHome,
              removebgWeightsDir: hdToolkitConfig.removebgWeightsDir,
              highresWeightsDir: hdToolkitConfig.highresWeightsDir,
              outputDir: hdToolkitConfig.outputDir
            })
            console.log('[设置页] 抠图高清配置已导入并保存到后端')
          } catch (err) {
            console.warn('[设置页] 保存抠图高清配置到后端失败:', err)
          }
        }

        console.log('[设置页] 抠图高清配置已导入并更新到界面')
      }
      
      message.success('配置导入成功！所有设置已更新', {
        duration: 3000,
        keepAliveOnHover: true
      })
    } else if (result.canceled) {
      console.log('[设置页] 用户取消导入')
    } else {
      message.error('导入失败: ' + (result.error || '未知错误'), {
        duration: 5000
      })
    }
  } catch (error) {
    console.error('[设置页] 导入配置失败:', error)
    message.error('导入配置失败: ' + error.message, {
      duration: 5000
    })
  } finally {
    isImportingSettings.value = false
  }
}

// 初始化
onMounted(() => {
  loadConfig()
  loadHdToolkitConfigFromBackend()
  
  // 将配置暴露到全局，方便调试
  if (window) {
    window.DEBUG_SETTINGS = {
      /**
       * 查看人物设置表单状态。
       * 处理流程：
       * 1、记录普通对象快照，再返回当前响应式配置引用。
       */
      getStickfigureConfig: () => {
        // 1、供本地开发调试比较表单与保存值。
        console.log('🔍 当前简笔画配置:', JSON.parse(JSON.stringify(stickfigureConfig)))
        console.log('📋 当前图组名称:', JSON.parse(JSON.stringify(stickfigureConfig.groupNames)))
        return stickfigureConfig
      },
      /**
       * 查看已保存的人物配置。
       * 处理流程：
       * 1、读取并解析本地存储，输出诊断信息后返回解析结果。
       */
      getLocalStorageConfig: () => {
        // 1、直接查看存储值，不套用表单默认字段。
        const saved = localStorage.getItem('stickfigure-config')
        const parsed = JSON.parse(saved)
        console.log('💾 localStorage中的配置:', parsed)
        console.log('📋 localStorage中的图组名称:', parsed.groupNames)
        return parsed
      }
    }
    console.log('🛠️ 调试方法已添加: window.DEBUG_SETTINGS.getStickfigureConfig() 和 window.DEBUG_SETTINGS.getLocalStorageConfig()')
  }
})
</script>

<style scoped src="./SettingsPage.css"></style>

<style scoped>
/* 紧凑卡片样式 - 节省高度 */
.compact-card :deep(.n-card__content) {
  padding: 12px 16px !important;
}

/* 最小化自定义图组名称表单项之间的间距 */
.settings-form :deep(.n-form-item) {
  margin-bottom: 4px; /* 最小化到4px，只保留一点点间距 */
}

/* 最小化输入框标签和输入框之间的空白 */
.settings-form :deep(.n-form-item-label) {
  padding-bottom: 2px;
  margin-bottom: 0;
}

/* 移除输入框组内部多余的空白 */
.settings-form :deep(.n-input-group) {
  margin: 0;
}

/* 最小化反馈文字上方间距 */
.settings-form :deep(.n-form-item-feedback-wrapper) {
  margin-top: 0;
  padding-top: 0;
}

/* 最小化分隔线的上下边距 */
.settings-form :deep(.n-divider) {
  margin: 12px 0 8px 0 !important;
}

/* 移除表单项内部的空白 */
.settings-form :deep(.n-form-item-blank) {
  min-height: 0 !important;
}

/* 子标签页样式 */
.settings-sub-tabs {
  margin-top: 0;
}

.settings-sub-tabs :deep(.n-tabs-nav) {
  padding: 0;
  background: transparent;
}

.settings-sub-tabs :deep(.n-tabs-tab-pad) {
  border-bottom: none;
}

.settings-sub-tabs :deep(.n-tab-pane) {
  padding-top: 20px;
}
</style>
