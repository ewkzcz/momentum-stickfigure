/** 视频任务状态：提交任务、定时轮询、下载结果；任务由渲染进程持有，主进程保持无状态。 */
import { ref, reactive, onBeforeUnmount } from 'vue'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import { resolveGeminiProjectRoot } from '@renderer/utils/geminiOutputConfig.js'

const POLL_INTERVAL_MS = 4000
const MAX_POLL_MINUTES = 30

/** 读取生图设置中的连接与目录配置；处理流程：1、解析本地存储，失败时返回空配置。 */
function loadConnectionConfig() {
  // 1、与生图共用同一份设置，视频不再单独配置密钥。
  try {
    return JSON.parse(localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config') || '{}')
  } catch {
    return {}
  }
}

/**
 * 创建视频任务控制器。
 * 处理流程：
 * 1、submit 校验配置后提交任务，随后按间隔查询状态。
 * 2、任务完成时记录视频地址，失败或超时记录原因。
 * 3、组件卸载或手动停止时清理定时器。
 */
export function useVideoTask(message) {
  const task = reactive({ taskId: '', status: 'idle', progress: 0, url: '', error: '', savedPath: '' })
  const isBusy = ref(false)
  let timer = null
  let deadline = 0

  /** 停止轮询；处理流程：1、清除定时器并释放忙碌状态。 */
  const stopPolling = () => {
    // 1、重复调用安全。
    if (timer) clearTimeout(timer)
    timer = null
    isBusy.value = false
  }

  /** 组装带连接信息的基础参数；处理流程：1、合并密钥、地址和输出目录。 */
  const baseParams = () => {
    // 1、输出目录交给主进程做授权校验。
    const config = loadConnectionConfig()
    return {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
      projectRoot: resolveGeminiProjectRoot(config),
      outputDir: config.outputDir || 'output',
      logDir: config.logDir || 'logs'
    }
  }

  /** 单次轮询；处理流程：1、查询状态，2、终态结束轮询，3、否则安排下一次。 */
  const poll = async () => {
    // 1、超时保护，避免任务无限轮询。
    if (Date.now() > deadline) {
      task.status = 'failed'
      task.error = '等待视频生成超时，可稍后在平台查询该任务'
      stopPolling()
      return
    }
    const result = await window.videoApi.query({ ...baseParams(), taskId: task.taskId })
    if (!result?.success) {
      // 2、网络抖动不终止任务，只提示并继续。
      message.warning(`查询任务状态失败，将重试：${result?.message || '未知错误'}`)
    } else {
      Object.assign(task, { status: result.data.status, progress: result.data.progress })
      if (result.data.status === 'completed') {
        task.url = result.data.url
        if (!task.url) task.error = '任务已完成但未返回视频地址'
        stopPolling()
        return
      }
      if (result.data.status === 'failed') {
        task.error = result.data.error || '视频生成失败'
        stopPolling()
        return
      }
    }
    // 3、继续下一轮。
    timer = setTimeout(poll, POLL_INTERVAL_MS)
  }

  /** 提交视频任务；处理流程：1、校验密钥和提示词，2、重置状态并提交，3、开始轮询。 */
  const submit = async (options) => {
    // 1、前置校验。
    if (isBusy.value) return
    const base = baseParams()
    if (!base.apiKey) {
      message.error('请先在「AI生图设置」中配置 API 密钥')
      return
    }
    if (!options.prompt?.trim()) {
      message.warning('请输入提示词')
      return
    }
    // 2、清空上一次结果。
    Object.assign(task, { taskId: '', status: 'queued', progress: 0, url: '', error: '', savedPath: '' })
    isBusy.value = true
    const result = await window.videoApi.submit({ ...base, ...options })
    if (!result?.success) {
      task.status = 'failed'
      task.error = result?.message || '提交失败'
      isBusy.value = false
      return
    }
    // 3、记录任务并进入轮询。
    task.taskId = result.data.taskId
    deadline = Date.now() + MAX_POLL_MINUTES * 60000
    timer = setTimeout(poll, POLL_INTERVAL_MS)
  }

  /** 下载视频到输出目录；处理流程：1、调用主进程下载，2、记录保存路径并提示。 */
  const save = async () => {
    // 1、没有结果时不请求。
    if (!task.url) return
    const result = await window.videoApi.download({ ...baseParams(), url: task.url, taskId: task.taskId })
    // 2、失败原因直接反馈给用户。
    if (result?.success) {
      task.savedPath = result.data.path
      message.success(`已保存：${result.data.path}`)
    } else {
      message.error(`保存失败：${result?.message || '未知错误'}`)
    }
  }

  onBeforeUnmount(stopPolling)

  return { task, isBusy, submit, save, stopPolling }
}
