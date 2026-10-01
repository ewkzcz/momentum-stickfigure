/** 剧本创作台状态：项目列表、当前项目、自动保存，以及把流式生成结果写回指定字段。 */
import { ref, watch, onBeforeUnmount } from 'vue'
import { useCreativeConfig, createRequestId } from '@renderer/components/creative/useCreativeConfig.js'
import { createEmptyProject } from './scriptPrompts.js'

const AUTOSAVE_DELAY_MS = 1500

/**
 * 创建剧本工作台控制器。
 * 处理流程：
 * 1、项目：列表、新建、打开、保存（防抖自动保存）、删除、导出。
 * 2、生成：按目标路径（如 stages.logline / episodes.2.content）流式写入，可随时停止。
 */
export function useScriptStudio(message) {
  const { config, saveConfig, enabledSkillsFor } = useCreativeConfig()
  const scriptSkills = enabledSkillsFor('script')
  const projects = ref([])
  const project = ref(null)
  const dirty = ref(false)
  const saving = ref(false)
  const generating = ref('')
  let requestId = ''
  let saveTimer = null
  let suppressDirty = false

  const rootParams = () => ({ projectsRoot: config.projectsRoot || undefined })

  /** 刷新项目列表；处理流程：1、读取授权文件夹，回填实际路径。 */
  const refreshProjects = async () => {
    // 1、未选择文件夹时使用默认目录。
    const result = await window.creativeApi.listScripts(rootParams())
    if (!result?.success) {
      message.error(`读取剧本项目失败：${result?.message || '未知错误'}`)
      return
    }
    projects.value = result.data.projects
    if (!config.projectsRoot) {
      config.projectsRoot = result.data.root
      saveConfig()
    }
  }

  /** 替换当前项目；处理流程：1、替换时不触发自动保存。 */
  const setProject = (value) => {
    // 1、加载不是修改。
    suppressDirty = true
    project.value = value
    dirty.value = false
    Promise.resolve().then(() => { suppressDirty = false })
  }

  /** 保存；处理流程：1、序列化当前项目，2、回填 ID 与时间并刷新列表。 */
  const save = async () => {
    // 1、生成中也允许保存（保存的是已写入的部分）。
    if (!project.value) return
    clearTimeout(saveTimer)
    saving.value = true
    try {
      const result = await window.creativeApi.saveScript({ ...rootParams(), project: JSON.parse(JSON.stringify(project.value)) })
      if (!result?.success) {
        message.error(`保存失败：${result?.message || '未知错误'}`)
        return
      }
      // 2、只回填元数据，避免覆盖保存期间的新输入。
      suppressDirty = true
      Object.assign(project.value, { id: result.data.id, createdAt: result.data.createdAt, updatedAt: result.data.updatedAt })
      Promise.resolve().then(() => { suppressDirty = false })
      dirty.value = false
      await refreshProjects()
    } finally {
      saving.value = false
    }
  }

  // 任何修改都安排一次防抖保存。
  watch(project, () => {
    if (suppressDirty || !project.value) return
    dirty.value = true
    // 流式生成期间不反复写盘，生成结束时统一保存。
    if (generating.value) return
    clearTimeout(saveTimer)
    saveTimer = setTimeout(save, AUTOSAVE_DELAY_MS)
  }, { deep: true })

  /** 新建项目；处理流程：1、先保存当前项目，2、默认勾选已启用的剧本 Skills。 */
  const createProject = async (type) => {
    // 1、未保存的修改先落盘。
    if (dirty.value) await save()
    const fresh = createEmptyProject(type)
    fresh.skillIds = scriptSkills.value.map((item) => item.id)
    setProject(fresh)
    await save()
  }

  /** 打开项目；处理流程：1、保存当前，2、读取目标项目并补齐新字段。 */
  const openProject = async (id) => {
    // 1、切换前保存。
    if (dirty.value) await save()
    const result = await window.creativeApi.loadScript({ ...rootParams(), id })
    if (!result?.success) {
      message.error(`打开失败：${result?.message || '未知错误'}`)
      return
    }
    // 2、旧项目缺少的字段用默认值补齐。
    const base = createEmptyProject(result.data.type)
    setProject({ ...base, ...result.data, stages: { ...base.stages, ...(result.data.stages || {}) } })
  }

  /** 删除项目；处理流程：1、删除文件，2、若删的是当前项目则清空编辑区。 */
  const removeProject = async (id) => {
    // 1、删除由用户在确认框中确认后调用。
    const result = await window.creativeApi.deleteScript({ ...rootParams(), id })
    if (!result?.success) {
      message.error(`删除失败：${result?.message || '未知错误'}`)
      return
    }
    if (project.value?.id === id) setProject(null)
    await refreshProjects()
  }

  /** 按路径读写字段；处理流程：1、支持 a.b.0.c 形式。 */
  const setByPath = (path, value) => {
    // 1、路径由界面内部生成，可信。
    const keys = path.split('.')
    let target = project.value
    for (const key of keys.slice(0, -1)) target = target[key]
    target[keys[keys.length - 1]] = value
  }

  /**
   * 流式生成到指定字段。
   * 处理流程：
   * 1、校验文本模型配置，清空目标字段。
   * 2、订阅增量写入；结束后用完整结果校正并保存。
   */
  const generate = async (path, prompt) => {
    // 1、同一时间只运行一个生成。
    if (generating.value || !project.value) return
    if (!config.llm.apiKey || !config.llm.model) {
      message.error('请先在「设置 → Skills与模型设置」中配置文本模型')
      return
    }
    generating.value = path
    requestId = createRequestId('script')
    const currentId = requestId
    let text = ''
    setByPath(path, '')
    const unsubscribe = window.creativeApi.onTextDelta((event) => {
      if (event.requestId !== currentId) return
      text += event.delta
      setByPath(path, text)
    })
    try {
      const result = await window.creativeApi.generateText({
        requestId: currentId,
        llm: { ...config.llm },
        instructions: project.value.systemPrompt || '',
        prompt,
        skillsRoot: config.skillsRoot || undefined,
        skillIds: (project.value.skillIds || []).filter((id) => scriptSkills.value.some((item) => item.id === id))
      })
      // 2、非流式网关只在最后返回全文。
      if (result?.success) {
        if (result.data.text) setByPath(path, result.data.text)
      } else if (!result?.canceled) {
        message.error(`生成失败：${result?.message || '未知错误'}`, { duration: 6000 })
      }
    } finally {
      unsubscribe?.()
      generating.value = ''
      await save()
    }
  }

  /** 停止生成；处理流程：1、通知主进程中止请求，已生成的内容保留。 */
  const stop = () => {
    // 1、只取消当前请求。
    if (requestId) window.creativeApi.cancel({ id: requestId })
  }

  /** 选择项目文件夹；处理流程：1、系统对话框授权，2、刷新列表并关闭当前项目。 */
  const selectFolder = async () => {
    // 1、授权用途 script-projects 允许读写该目录。
    const result = await window.fileSystem.selectFolder({ purpose: 'script-projects' })
    if (!result?.success || !result.path) return
    if (dirty.value) await save()
    config.projectsRoot = result.path
    saveConfig()
    setProject(null)
    await refreshProjects()
  }

  onBeforeUnmount(() => {
    stop()
    if (dirty.value) save()
  })

  return { config, scriptSkills, projects, project, dirty, saving, generating, refreshProjects, createProject, openProject, removeProject, save, generate, stop, selectFolder }
}
