/**
 * 提示词模板服务：将模板保存到共享配置目录，供应用实例读取。
 */

import { ipcMain, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_NAME = 'momentum-stickfigure-open'
const TEMPLATE_FILE = path.join(os.homedir(), '.config', APP_NAME, 'prompt-templates.json')
const DEFAULT_DATA = {
  image: [],
  video: []
}

let templatesCache = { ...DEFAULT_DATA }
let isWriting = false
const ENABLE_LIVE_MULTI_INSTANCE_SYNC = false
let watcher = null
let reloadTimer = null
const RELOAD_DELAY = 200

/**
 * 确保模板文件可用。
 * 处理流程：
 * 1、创建缺失目录。
 * 2、首次运行时写入默认模板集合。
 */
function ensureTemplateFile() {
  // 1、准备模板文件的父目录。
  const dir = path.dirname(TEMPLATE_FILE)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }

  // 2、只在文件不存在时初始化，保留已有模板。
  if (!fs.existsSync(TEMPLATE_FILE)) {
    fs.writeFileSync(TEMPLATE_FILE, JSON.stringify(DEFAULT_DATA, null, 2), 'utf-8')
  }
}

/**
 * 规范模板列表字段。
 * 处理流程：
 * 1、拒绝非数组数据。
 * 2、为每个模板补齐标识、时间、排序及类型。
 */
function normalizeTemplates(data = []) {
  // 1、将无效集合降级为空列表。
  if (!Array.isArray(data)) {
    return []
  }
  // 2、保留已有字段值并补齐缺省元信息。
  return data.map((template, index) => ({
    id: template.id || `template-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    content: template.content || '',
    isFavorite: Boolean(template.isFavorite),
    createdAt: template.createdAt || Date.now(),
    order: typeof template.order === 'number' ? template.order : index,
    type: template.type || 'image'
  }))
}

/**
 * 从共享文件加载模板缓存。
 * 处理流程：
 * 1、准备文件并解析 JSON。
 * 2、规范各类模板；读取失败时恢复空集合。
 */
function loadFromDisk() {
  // 1、读取文件并分别规范图片与视频模板。
  try {
    ensureTemplateFile()
    const raw = fs.readFileSync(TEMPLATE_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    templatesCache = {
      image: normalizeTemplates(parsed?.image),
      video: normalizeTemplates(parsed?.video)
    }
    console.log('[PromptTemplateService] 已加载模板文件:', TEMPLATE_FILE)
  } catch (error) {
    console.error('[PromptTemplateService] 加载模板文件失败:', error)
    templatesCache = { ...DEFAULT_DATA }
  }
}

/**
 * 将当前模板缓存写入共享文件。
 * 处理流程：
 * 1、确保文件存在并设置写入标记。
 * 2、同步写入缓存，在成功或异常时释放标记。
 */
function saveToDisk() {
  // 1、写入期间标记本实例操作，供文件监听排除自身事件。
  try {
    ensureTemplateFile()
    isWriting = true
    fs.writeFileSync(
      TEMPLATE_FILE,
      JSON.stringify(templatesCache, null, 2),
      'utf-8'
    )
    isWriting = false
    console.log('[PromptTemplateService] 模板已写入共享文件')
  } catch (error) {
    isWriting = false
    console.error('[PromptTemplateService] 写入模板文件失败:', error)
  }
}

/**
 * 获取指定类型的模板副本。
 * 处理流程：
 * 1、选择模板集合并浅拷贝每项，避免调用方直接修改缓存项。
 */
function getTemplates(type = 'image') {
  // 1、缺失类型返回空集合，已有模板以副本返回。
  const list = templatesCache[type] || []
  return list.map(item => ({ ...item }))
}

/**
 * 更新指定类型的模板。
 * 处理流程：
 * 1、规范字段并重建排序。
 * 2、持久化缓存并广播变更。
 */
function setTemplates(type = 'image', templates = []) {
  // 1、以传入列表顺序重新编号并统一类型。
  templatesCache[type] = normalizeTemplates(templates).map((template, index) => ({
    ...template,
    order: index,
    type
  }))
  // 2、保存到共享文件后通知全部窗口。
  saveToDisk()
  broadcastChange(type)
}

/**
 * 向窗口广播某类模板的最新副本。
 * 处理流程：
 * 1、构造类型与模板载荷。
 * 2、逐窗口发送，忽略窗口关闭造成的失败。
 */
function broadcastChange(type) {
  // 1、组装当前类型的模板快照。
  const payload = {
    type,
    templates: getTemplates(type)
  }
  // 2、将快照发送到各个窗口。
  BrowserWindow.getAllWindows().forEach((win) => {
    try {
      win.webContents.send('prompt-templates-updated', payload)
    } catch (error) {
      // 忽略发送失败（窗口可能已关闭）
    }
  })
}

/**
 * 按开关建立共享模板监听。
 * 处理流程：
 * 1、检查实时同步开关并替换旧监听器。
 * 2、过滤自身写入，对外部变化防抖加载并广播。
 */
function watchTemplateFile() {
  // 1、默认关闭实时监听，启动时加载仍然有效。
  if (!ENABLE_LIVE_MULTI_INSTANCE_SYNC) {
    console.log('[PromptTemplateService] 实时多实例监听已禁用，依赖共享文件启动时的加载结果')
    return
  }

  try {
    ensureTemplateFile()
    if (watcher) {
      watcher.close()
    }
    // 2、延迟合并文件事件，避免连续写入触发重复重载。
    watcher = fs.watch(TEMPLATE_FILE, () => {
      if (isWriting) {
        return
      }
      if (reloadTimer) {
        clearTimeout(reloadTimer)
      }
      reloadTimer = setTimeout(() => {
        console.log('[PromptTemplateService] 检测到其他实例修改了模板文件，重新加载...')
        loadFromDisk()
        broadcastChange('image')
        broadcastChange('video')
      }, RELOAD_DELAY)
    })
    console.log('[PromptTemplateService] 已开始监听模板文件变化')
  } catch (error) {
    console.error('[PromptTemplateService] 监听模板文件失败:', error)
  }
}

/**
 * 注册提示词模板读写接口。
 * 处理流程：
 * 1、加载缓存并按配置建立文件监听。
 * 2、注册获取和保存模板的 IPC 处理器。
 */
export function registerPromptTemplateHandlers() {
  // 1、初始化磁盘缓存及可选监听。
  console.log('[IPC] 注册 PromptTemplate 服务处理器...')
  loadFromDisk()
  watchTemplateFile()

  // 2、为渲染进程提供统一的读写结果结构。
  ipcMain.handle('prompt-templates:get', async (_event, type = 'image') => {
    try {
      return { success: true, templates: getTemplates(type) }
    } catch (error) {
      console.error('[PromptTemplateService] 获取模板失败:', error)
      return { success: false, templates: [], error: error.message }
    }
  })

  ipcMain.handle('prompt-templates:save', async (_event, { type = 'image', templates = [] } = {}) => {
    try {
      setTemplates(type, templates)
      return { success: true }
    } catch (error) {
      console.error('[PromptTemplateService] 保存模板失败:', error)
      return { success: false, error: error.message }
    }
  })
}

/**
 * 释放提示词模板服务资源。
 * 处理流程：
 * 1、移除读写 IPC 处理器。
 * 2、关闭文件监听并清除待执行重载。
 */
export function unregisterPromptTemplateHandlers() {
  // 1、停止接收新的模板请求。
  console.log('[IPC] 注销 PromptTemplate 服务处理器...')
  ipcMain.removeHandler('prompt-templates:get')
  ipcMain.removeHandler('prompt-templates:save')
  // 2、释放监听器和防抖定时器。
  if (watcher) {
    watcher.close()
    watcher = null
  }
  if (reloadTimer) {
    clearTimeout(reloadTimer)
    reloadTimer = null
  }
}
