/** Agent 对话状态：维护界面时间线与发给模型的对话历史，订阅主进程推送的运行事件。 */
import { ref, onBeforeUnmount } from 'vue'
import { useCreativeConfig, createRequestId } from './useCreativeConfig.js'

const MAX_HISTORY = 20

/**
 * 创建 Agent 运行控制器。
 * 处理流程：
 * 1、send：记录用户消息，带上已启用 Skills 和生成参数发起运行。
 * 2、运行中把事件追加到时间线（加载的 Skill、状态、图片、视频、回复）。
 * 3、stop 取消当前运行；组件卸载时退订事件。
 */
export function useAgentRun(mode, message) {
  const { config, enabledSkillsFor, buildAgentImageConfig, buildAgentVideoConfig } = useCreativeConfig()
  const enabledSkills = enabledSkillsFor(mode)
  const timeline = ref([])
  const history = []
  const running = ref(false)
  let runId = ''

  /** 追加时间线条目；处理流程：1、带自增 key，便于列表渲染。 */
  const push = (entry) => timeline.value.push({ key: `${Date.now()}-${timeline.value.length}`, ...entry })

  // 2、事件只处理当前运行的。
  const unsubscribe = window.creativeApi?.onAgentEvent((event) => {
    if (event.runId !== runId) return
    if (event.type === 'skill') push({ type: 'skill', text: `已加载 Skill：${event.name}` })
    else if (event.type === 'tool' && /^generate_/.test(event.name)) push({ type: 'prompt', text: event.args?.prompt || '' })
    else if (event.type === 'status') push({ type: 'status', text: event.text })
    else if (event.type === 'progress') {
      const last = timeline.value[timeline.value.length - 1]
      const text = `视频任务 ${event.taskId}：${event.status} ${Math.round(event.progress)}%`
      if (last?.type === 'progress') last.text = text
      else push({ type: 'progress', text })
    } else if (event.type === 'images') push({ type: 'images', images: event.images, prompt: event.prompt })
    else if (event.type === 'video') push({ type: 'video', url: event.url, taskId: event.taskId })
    else if (event.type === 'message' && event.text) push({ type: 'assistant', text: event.text })
  })

  /** 发送需求；处理流程：1、校验文本模型配置，2、发起运行，3、记录最终回复进历史。 */
  const send = async (text, { allowGenerate, aspectRatio }) => {
    // 1、配置检查。
    if (running.value || !text.trim()) return
    if (!config.llm.apiKey || !config.llm.model) {
      message.error('请先在「设置 → Skills与模型设置」中配置文本模型（地址、密钥、模型名）')
      return
    }
    push({ type: 'user', text })
    history.push({ role: 'user', content: text })
    running.value = true
    runId = createRequestId(`agent-${mode}`)
    try {
      // 2、生成参数从 AI 生图设置与视频页选择中读取。
      const result = await window.creativeApi.runAgent({
        runId,
        mode,
        llm: { ...config.llm },
        skillsRoot: config.skillsRoot || undefined,
        skillIds: enabledSkills.value.map((item) => item.id),
        history: history.slice(-MAX_HISTORY),
        allowGenerate,
        ...(mode === 'image' ? { imageConfig: buildAgentImageConfig(aspectRatio) } : { videoConfig: buildAgentVideoConfig() })
      })
      // 3、只有最终回复进入历史，工具细节留在主进程本轮上下文中。
      if (result?.success) history.push({ role: 'assistant', content: result.data.text || '' })
      else if (!result?.canceled) push({ type: 'error', text: result?.message || '运行失败' })
      else push({ type: 'status', text: '已停止' })
    } finally {
      running.value = false
    }
  }

  /** 停止运行；处理流程：1、通知主进程中止网络请求和轮询。 */
  const stop = () => {
    // 1、只取消当前运行。
    if (runId) window.creativeApi.cancel({ id: runId })
  }

  /** 清空对话；处理流程：1、运行中不允许清空，2、清空时间线和历史。 */
  const clear = () => {
    // 1、避免运行中的事件写进已清空的列表。
    if (running.value) return
    timeline.value = []
    history.length = 0
  }

  onBeforeUnmount(() => {
    stop()
    unsubscribe?.()
  })

  return { timeline, running, enabledSkills, send, stop, clear }
}
