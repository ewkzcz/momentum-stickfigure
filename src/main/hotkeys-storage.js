/**
 * 快捷键配置存储模块
 * 管理全局快捷键配置的持久化存储
 */

import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// 默认快捷键配置
const DEFAULT_HOTKEYS = {
  toggleMainWindow: 'Alt+Z',
  togglePreviewWindow: 'Alt+X'
}

/**
 * 获取快捷键配置文件路径。
 * 处理流程：
 * 1、读取应用数据目录并拼接配置文件名。
 */
function getConfigPath() {
  // 1、将快捷键配置定位到当前应用的数据目录。
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'hotkeys-config.json')
}

/**
 * 获取快捷键配置
 * 处理流程：
 * 1、读取并解析本地配置。
 * 2、补齐缺省快捷键；文件缺失或损坏时返回默认值。
 * @returns {Object} 快捷键配置对象
 */
export function getHotkeysConfig() {
  // 1、尝试从应用数据目录读取配置。
  try {
    const configPath = getConfigPath()
    
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8')
      const config = JSON.parse(data)
      
      // 2、合并默认配置，确保所有字段都存在。
      return {
        toggleMainWindow: config.toggleMainWindow || DEFAULT_HOTKEYS.toggleMainWindow,
        togglePreviewWindow: config.togglePreviewWindow || DEFAULT_HOTKEYS.togglePreviewWindow
      }
    }
  } catch (error) {
    console.error('[快捷键存储] 读取配置失败:', error)
  }
  
  // 3、文件缺失或读取失败时返回默认配置。
  return { ...DEFAULT_HOTKEYS }
}

/**
 * 保存快捷键配置
 * 处理流程：
 * 1、提取允许保存的快捷键字段并确保目录存在。
 * 2、写入 JSON 配置，返回保存结果。
 * @param {Object} config - 快捷键配置对象
 */
export function saveHotkeysConfig(config) {
  // 1、构造配置路径及可持久化字段。
  try {
    const configPath = getConfigPath()
    const configToSave = {
      toggleMainWindow: config.toggleMainWindow || '',
      togglePreviewWindow: config.togglePreviewWindow || ''
    }
    
    // 2、确保配置目录存在。
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // 3、写入配置并报告结果。
    fs.writeFileSync(configPath, JSON.stringify(configToSave, null, 2), 'utf-8')
    console.log('[快捷键存储] 配置已保存:', configPath)
    
    return true
  } catch (error) {
    console.error('[快捷键存储] 保存配置失败:', error)
    return false
  }
}
