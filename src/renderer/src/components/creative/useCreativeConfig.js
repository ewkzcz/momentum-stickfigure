/** 创作工作台共享配置：文本模型、Skills 文件夹与启用状态、剧本项目文件夹；全局单例，存于 localStorage。 */
import { reactive, ref, computed } from 'vue'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import { resolveGeminiProjectRoot } from '@renderer/utils/geminiOutputConfig.js'
import { buildImageModelParams } from '@renderer/utils/imageRequestOptions.js'

export const CREATIVE_CONFIG_STORAGE_KEY = 'creative-config'
export const VIDEO_OPTIONS_STORAGE_KEY = 'video-generate-options'

const DEFAULT_CONFIG = {
  llm: { baseUrl: 'https://api.aixoras.com', apiKey: '', model: '', protocol: 'chat' },
  skillsRoot: '',
  projectsRoot: '',
  enabledSkills: []
}

/** 读取 JSON 配置；处理流程：1、解析失败或存储不可用时返回空对象。 */
function readJson(key) {
  // 1、隐私模式下存储可能不可用。
  try {
    return JSON.parse(localStorage.getItem(key) || '{}') || {}
  } catch {
    return {}
  }
}

const saved = readJson(CREATIVE_CONFIG_STORAGE_KEY)
const config = reactive({
  ...DEFAULT_CONFIG,
  ...saved,
  llm: { ...DEFAULT_CONFIG.llm, ...(saved.llm || {}) },
  enabledSkills: Array.isArray(saved.enabledSkills) ? saved.enabledSkills : []
})
const skills = ref([])
const skillsError = ref('')
const skillsLoading = ref(false)

/** 保存配置；处理流程：1、深拷贝后写入存储，返回是否成功。 */
function saveConfig() {
  // 1、reactive 对象不能直接序列化代理以外的引用，先转普通对象。
  try {
    localStorage.setItem(CREATIVE_CONFIG_STORAGE_KEY, JSON.stringify(JSON.parse(JSON.stringify(config))))
    return true
  } catch {
    return false
  }
}

/**
 * 刷新 Skills 列表。
 * 处理流程：
 * 1、请求主进程扫描授权文件夹，回填实际根路径。
 * 2、清理已被删除的启用项，保证启用列表与磁盘一致。
 */
async function refreshSkills() {
  // 1、扫描。
  skillsLoading.value = true
  try {
    const result = await window.creativeApi.listSkills({ skillsRoot: config.skillsRoot || undefined })
    if (!result?.success) {
      skillsError.value = result?.message || '读取 Skills 失败'
      return
    }
    skillsError.value = ''
    skills.value = result.data.skills
    if (!config.skillsRoot) config.skillsRoot = result.data.root
    // 2、移除已不存在的启用项。
    const ids = new Set(skills.value.map((item) => item.id))
    config.enabledSkills = config.enabledSkills.filter((id) => ids.has(id))
    saveConfig()
  } finally {
    skillsLoading.value = false
  }
}

/** 切换启用状态；处理流程：1、增删启用列表并立即保存。 */
function toggleSkill(id, enabled) {
  // 1、启用状态是用户显式选择，立刻持久化。
  const set = new Set(config.enabledSkills)
  if (enabled) set.add(id)
  else set.delete(id)
  config.enabledSkills = [...set]
  saveConfig()
}

/** 按分类取已启用 Skills；处理流程：1、通用类 Skill 对所有入口可见。 */
function enabledSkillsFor(category) {
  // 1、错误的 Skill 不参与。
  return computed(() => skills.value.filter((item) => !item.error && config.enabledSkills.includes(item.id) && (item.category === category || item.category === 'general')))
}

/** 读取 AI 生图设置（密钥、地址、输出目录）；处理流程：1、与生图插件共用同一份配置。 */
function loadImageSettings() {
  // 1、兼容旧版存储键。
  const stored = readJson(GEMINI_IMAGE_CONFIG_STORAGE_KEY)
  return Object.keys(stored).length ? stored : readJson('fal-config')
}

/** 组装 Agent 图片参数；处理流程：1、合并连接信息、模型参数和输出目录。 */
function buildAgentImageConfig(aspectRatio) {
  // 1、输出目录由主进程授权校验。
  const settings = loadImageSettings()
  return {
    apiKey: settings.apiKey || '',
    baseUrl: settings.baseUrl || '',
    ...buildImageModelParams(settings),
    ...(aspectRatio && aspectRatio !== 'original' ? { aspectRatio } : {}),
    projectRoot: resolveGeminiProjectRoot(settings),
    outputDir: settings.outputDir || 'output',
    editOutputDir: settings.outputDir || 'output',
    logDir: settings.logDir || 'logs'
  }
}

/** 组装 Agent 视频参数；处理流程：1、连接信息来自生图设置，模型参数来自视频页上次选择。 */
function buildAgentVideoConfig() {
  // 1、视频页的参数选择持久化在单独的键里。
  const settings = loadImageSettings()
  const options = readJson(VIDEO_OPTIONS_STORAGE_KEY)
  return {
    apiKey: settings.apiKey || '',
    baseUrl: settings.baseUrl || '',
    model: options.model || 'seedance-2.0-fast',
    resolution: options.resolution || '720p',
    duration: Number.isInteger(options.duration) ? options.duration : 5,
    aspectRatio: options.aspectRatio || '16:9',
    ...(typeof options.generateAudio === 'boolean' ? { generateAudio: options.generateAudio } : {})
  }
}

/** 生成请求 ID；处理流程：1、时间戳加随机数，满足主进程的 ID 格式。 */
export function createRequestId(prefix) {
  // 1、只含字母数字和连字符。
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 对外暴露共享状态与操作；处理流程：1、所有页面拿到同一个单例。 */
export function useCreativeConfig() {
  // 1、单例：Skills 页修改后，其他入口立即生效。
  return { config, skills, skillsError, skillsLoading, saveConfig, refreshSkills, toggleSkill, enabledSkillsFor, buildAgentImageConfig, buildAgentVideoConfig, loadImageSettings }
}
