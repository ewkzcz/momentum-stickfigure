/**
 * 任务管理Store - 支持异步任务状态持久化
 */
import { ref, reactive, watch, readonly } from 'vue'

// 任务状态枚举
export const TaskStatus = {
  PENDING: 'pending',      // 等待中
  RUNNING: 'running',      // 运行中
  COMPLETED: 'completed',  // 已完成
  FAILED: 'failed',        // 失败
  CANCELLED: 'cancelled'   // 已取消
}

// 任务类型枚举
export const TaskType = {
  GENERATE: 'generate',  // 图片生成
  EDIT: 'edit'          // 图片编辑
}

// 全局任务存储 - 添加初始化保护
const tasks = ref(new Map())
const activeTasks = ref(new Set())

// 确保响应式对象正确初始化
if (!tasks.value || typeof tasks.value.set !== 'function') {
  console.warn('tasks响应式对象初始化异常，重新创建')
  tasks.value = new Map()
}

if (!activeTasks.value || typeof activeTasks.value.add !== 'function') {
  console.warn('activeTasks响应式对象初始化异常，重新创建')  
  activeTasks.value = new Set()
}

// 持久化配置
const STORAGE_KEY = 'fal-tasks'
const AUTO_SAVE_INTERVAL = 5000 // 5秒自动保存

// 🚀 性能优化：保存节流控制
let saveScheduled = false
let saveTimeoutId = null

/**
 * 任务记录：维护状态、结果和计时信息，状态变更后安排持久化。
 */
class Task {
  /**
   * 创建待执行任务。
   * 处理流程：
   * 1、保存标识和配置，初始化进度、结果以及时间字段。
   */
  constructor(id, type, config) {
    // 1、新任务从等待状态开始，开始时间取创建时刻。
    this.id = id
    this.type = type
    this.status = TaskStatus.PENDING
    this.config = config
    this.result = null
    this.error = null
    this.progress = 0
    this.startTime = Date.now()
    this.endTime = null
    this.createdAt = Date.now()
    this.updatedAt = Date.now()
  }

  /**
   * 更新任务状态与附加数据。
   * 处理流程：
   * 1、更新状态，完成或失败时记录结束时间并移出活跃集合。
   * 2、应用结果、错误和进度，再安排异步保存。
   */
  updateStatus(status, data = {}) {
    // 1、完成和失败是此处负责收尾的两种状态。
    this.status = status
    this.updatedAt = Date.now()
    
    if (status === TaskStatus.COMPLETED || status === TaskStatus.FAILED) {
      this.endTime = Date.now()
      activeTasks.value.delete(this.id)
    }
    
    // 2、只更新本次携带的字段，进度允许显式设置为零。
    if (data.result) {
      this.result = data.result
    }
    
    if (data.error) {
      this.error = data.error
    }
    
    if (data.progress !== undefined) {
      this.progress = data.progress
    }
    
    // 3、多个连续状态更新会由保存入口合并调度。
    saveToStorage()
  }

  /**
   * 获取任务已持续的毫秒数。
   * 处理流程：
   * 1、有结束时间时取固定区间，否则计算到当前时刻。
   */
  getDuration() {
    // 1、未结束任务的耗时随查询时间增长。
    if (this.endTime) {
      return this.endTime - this.startTime
    }
    return Date.now() - this.startTime
  }

  /**
   * 判断任务是否仍可继续执行。
   * 处理流程：
   * 1、仅等待和运行状态视为活跃。
   */
  isActive() {
    // 1、界面查询以状态为准，过滤已结束或取消的记录。
    return this.status === TaskStatus.PENDING || this.status === TaskStatus.RUNNING
  }
}

/**
 * 创建新任务
 * 处理流程：
 * 1、生成标识并创建任务记录。
 * 2、加入任务表和活跃集合，安排保存后返回任务。
 */
export function createTask(type, config) {
  // 1、生成标识并初始化等待状态。
  const id = generateTaskId()
  const task = new Task(id, type, config)
  
  // 2、同时登记完整记录和活跃索引。
  tasks.value.set(id, task)
  activeTasks.value.add(id)
  
  console.log(`创建任务: ${id} (${type})`, config)
  saveToStorage()
  
  return task
}

/**
 * 获取任务
 * 处理流程：
 * 1、按标识查询任务表，不存在时返回 undefined。
 */
export function getTask(id) {
  // 1、直接返回响应式任务记录。
  return tasks.value.get(id)
}

/**
 * 获取所有任务
 * 处理流程：
 * 1、将任务表转换为数组并按创建时间倒序排列。
 */
export function getAllTasks() {
  // 1、排序新数组，不改变任务表的存储顺序。
  return Array.from(tasks.value.values()).sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * 获取活跃任务
 * 处理流程：
 * 1、从活跃索引读取任务，过滤失效标识和非活跃状态。
 */
export function getActiveTasks() {
  // 1、用任务状态复核索引，避免将结束记录返回给恢复流程。
  return Array.from(activeTasks.value)
    .map(id => tasks.value.get(id))
    .filter(task => task && task.isActive())
}

/**
 * 获取特定类型的任务
 * 处理流程：
 * 1、从倒序任务列表中筛选指定类型。
 */
export function getTasksByType(type) {
  // 1、保留统一查询结果的时间顺序。
  return getAllTasks().filter(task => task.type === type)
}

/**
 * 更新任务状态
 * 处理流程：
 * 1、找到任务后交由实例更新，不存在时返回 null。
 */
export function updateTaskStatus(id, status, data = {}) {
  // 1、由实例方法统一维护收尾和保存行为。
  const task = tasks.value.get(id)
  if (task) {
    task.updateStatus(status, data)
    return task
  }
  return null
}

/**
 * 删除任务
 * 处理流程：
 * 1、确认记录存在，同时移除任务和活跃索引。
 * 2、安排保存并返回是否发生删除。
 */
export function deleteTask(id) {
  // 1、任务不存在时不触发存储写入。
  const task = tasks.value.get(id)
  if (task) {
    tasks.value.delete(id)
    activeTasks.value.delete(id)
    // 2、同步保存两个集合的删除结果。
    saveToStorage()
    console.log(`删除任务: ${id}`)
    return true
  }
  return false
}

/**
 * 清理旧任务（保留最近100个）
 * 处理流程：
 * 1、按创建时间确定保留范围。
 * 2、仅删除范围外的非活跃任务，活跃任务不受数量上限影响。
 */
export function cleanupOldTasks(maxTasks = 100) {
  // 1、最近记录优先保留。
  const allTasks = getAllTasks()
  if (allTasks.length <= maxTasks) return
  
  // 2、清理旧记录时不打断仍在执行的任务。
  const tasksToDelete = allTasks.slice(maxTasks)
  tasksToDelete.forEach(task => {
    if (!task.isActive()) {
      deleteTask(task.id)
    }
  })
}

/**
 * 生成任务ID
 * 处理流程：
 * 1、拼接时间戳与随机后缀，降低同一时刻任务的标识冲突概率。
 */
function generateTaskId() {
  // 1、标识用于本地任务索引，不承担安全凭据用途。
  return `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * 保存到本地存储（同步版本，仅在必要时使用）
 * 处理流程：
 * 1、确认任务表和活跃集合仍可遍历。
 * 2、提取可序列化字段，连同活跃索引一起写入本地存储。
 */
function saveToStorageSync() {
  try {
    // 1、响应式集合失效时跳过保存，避免覆盖已有快照。
    if (!tasks.value || typeof tasks.value.entries !== 'function') {
      console.warn('tasks.value无效，跳过保存')
      return
    }

    if (!activeTasks.value || typeof activeTasks.value[Symbol.iterator] !== 'function') {
      console.warn('activeTasks.value无效，跳过保存')
      return
    }

    // 2、提取任务字段为普通对象，不序列化实例方法。
    const serializedTasks = []
    for (const [id, task] of tasks.value.entries()) {
      if (!task) continue
      serializedTasks.push([
        id,
        {
          id: task.id,
          type: task.type,
          status: task.status,
          config: task.config ?? null,
          result: task.result ?? null,
          error: task.error ?? null,
          progress: task.progress ?? 0,
          startTime: task.startTime ?? Date.now(),
          endTime: task.endTime ?? null,
          createdAt: task.createdAt ?? Date.now(),
          updatedAt: task.updatedAt ?? Date.now()
        }
      ])
    }

    // 3、任务记录与活跃索引存入同一份快照。
    const data = {
      tasks: serializedTasks,
      activeTasks: Array.from(activeTasks.value),
      savedAt: Date.now()
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch (error) {
    console.error('保存任务状态失败:', error)
  }
}

/**
 * 🚀 性能优化：使用 requestIdleCallback 异步保存
 * 在浏览器空闲时执行保存操作，避免阻塞主线程
 * 处理流程：
 * 1、合并已经排队的保存请求。
 * 2、优先安排空闲回调，不支持时使用下一轮定时回调。
 */
function saveToStorage() {
  // 1、同一等待周期只排队一次，执行时读取最新状态。
  if (saveScheduled) return

  saveScheduled = true

  // 2、优先使用空闲回调，并设置最长等待时间。
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(() => {
      saveScheduled = false
      saveToStorageSync()
    }, { timeout: 2000 }) // 最多延迟2秒
  } else {
    // 降级方案：使用 setTimeout 延迟到下一个宏任务
    setTimeout(() => {
      saveScheduled = false
      saveToStorageSync()
    }, 0)
  }
}

/**
 * 从本地存储加载
 * 处理流程：
 * 1、读取快照并重建带实例方法的任务记录。
 * 2、将上次未完成任务标记为失败，避免重启后界面一直等待。
 * 3、替换响应式集合并清理旧记录。
 */
function loadFromStorage() {
  try {
    // 1、无快照或缺少任务列表时保留当前集合。
    const data = localStorage.getItem(STORAGE_KEY)
    if (!data) return
    
    const parsed = JSON.parse(data)
    if (!parsed.tasks) return
    
    // 2、在临时集合中恢复实例，完成后再整体替换。
    const taskMap = new Map()
    const activeTaskSet = new Set()
    
    parsed.tasks.forEach(([id, taskData]) => {
      // 重建任务对象
      const task = Object.assign(new Task(id, taskData.type, taskData.config), taskData)
      
      // 【关键修复】如果任务状态是RUNNING或PENDING，说明上次异常退出
      // 将这些任务标记为FAILED，避免按钮永久锁定
      if (task.status === TaskStatus.RUNNING || task.status === TaskStatus.PENDING) {
        console.warn(`检测到未完成的任务 ${id}，状态: ${task.status}，标记为失败`)
        task.status = TaskStatus.FAILED
        task.error = '应用重启，任务已取消'
        task.endTime = Date.now()
        // 不添加到activeTaskSet，因为已经失败
      } else {
        // 只有已完成或已失败的任务才检查是否活跃
        if (task.isActive()) {
          activeTaskSet.add(id)
        }
      }
      
      taskMap.set(id, task)
    })
    
    tasks.value = taskMap
    activeTasks.value = activeTaskSet
    
    // 3、恢复完成后应用历史保留数量规则。
    cleanupOldTasks()
  } catch (error) {
    console.error('加载任务状态失败:', error)
  }
}

/**
 * 初始化任务管理器
 * 处理流程：
 * 1、恢复历史任务并安装周期保存。
 * 2、窗口卸载时同步保存，避免依赖尚未执行的空闲回调。
 */
export function initTaskStore() {
  // 1、先恢复快照，再开始定时持久化。
  loadFromStorage()

  // 设置自动保存（使用优化后的异步保存）
  setInterval(saveToStorage, AUTO_SAVE_INTERVAL)

  // 2、页面卸载时直接保存当前快照，不等待异步调度。
  window.addEventListener('beforeunload', saveToStorageSync)
}

/**
 * 获取任务统计信息
 * 处理流程：
 * 1、初始化总数和各状态计数。
 * 2、遍历任务，按实际状态累加后返回统计结果。
 */
export function getTaskStats() {
  // 1、读取当前完整任务列表作为统计快照。
  const allTasks = getAllTasks()
  const stats = {
    total: allTasks.length,
    pending: 0,
    running: 0,
    completed: 0,
    failed: 0,
    cancelled: 0
  }
  
  // 2、状态字段按记录本身累计。
  allTasks.forEach(task => {
    stats[task.status] = (stats[task.status] || 0) + 1
  })
  
  return stats
}

/**
 * 提供组件使用的任务管理接口。
 * 处理流程：
 * 1、返回只读集合引用、操作方法和枚举，避免外部直接改写集合。
 */
export const useTaskStore = () => {
  // 1、所有使用者共享模块级任务状态。
  return {
    tasks: readonly(tasks), // 使用readonly防止外部直接修改
    activeTasks: readonly(activeTasks), // 使用readonly防止外部直接修改
    createTask,
    getTask,
    getAllTasks,
    getActiveTasks,
    getTasksByType,
    updateTaskStatus,
    deleteTask,
    cleanupOldTasks,
    getTaskStats,
    TaskStatus,
    TaskType
  }
}

// 自动初始化
initTaskStore()
