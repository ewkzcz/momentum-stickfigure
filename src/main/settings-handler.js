/** 设置文件处理器：管理配置导入导出、文档目录自动备份与最新副本恢复。 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import fs from 'fs'
import os from 'os'
import path from 'path'

/**
 * 获取用户文档目录下的配置备份路径
 * 处理流程：
 * 1、定位用户文档目录。
 * 2、返回应用专用的设置备份路径。
 */
function getSettingsBackupPath() {
  // 1、根据平台定位用户主目录下的文档路径。
  const platform = process.platform
  let documentsDir

  if (platform === 'win32') {
    // Windows: C:\Users\用户名\Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  } else if (platform === 'darwin') {
    // macOS: /Users/用户名/Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  } else {
    // Linux: /home/用户名/Documents
    documentsDir = path.join(os.homedir(), 'Documents')
  }

  // 2、组合应用配置目录路径，此处仅返回路径，不创建目录。
  const appConfigDir = path.join(documentsDir, 'MomentumStickFigure', 'Settings')

  return appConfigDir
}

/**
 * 注册设置导入导出处理器
 * 处理流程：
 * 1、提供设置文件导出与导入入口。
 * 2、自动备份并保留最近五份归档及最新副本。
 * 3、从最新副本读取待恢复的设置。
 */
export function registerSettingsHandlers() {
  // 1、通过系统对话框选择文件，导出或导入 JSON 设置。
  ipcMain.handle('settings-export', async (event, settings) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)

      const result = await dialog.showSaveDialog(window, {
        title: '导出配置',
        defaultPath: `momentum-stickfigure-settings_${Date.now()}.json`,
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePath
      console.log('导出设置到:', filePath)

      // 确保目录存在
      const dirPath = path.dirname(filePath)
      if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true })
      }

      // 写入文件（格式化JSON，便于阅读）
      fs.writeFileSync(filePath, JSON.stringify(settings, null, 2), 'utf-8')

      console.log('✅ 设置导出成功:', filePath)
      return {
        success: true,
        filePath: filePath,
        canceled: false
      }
    } catch (error) {
      console.error('❌ 导出设置失败:', error)
      return {
        success: false,
        error: error.message,
        canceled: false
      }
    }
  })

  // 导入设置
  ipcMain.handle('settings-import', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)

      const result = await dialog.showOpenDialog(window, {
        properties: ['openFile'],
        title: '导入配置',
        filters: [
          { name: 'JSON文件', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] }
        ]
      })

      if (result.canceled) {
        return { success: false, canceled: true }
      }

      const filePath = result.filePaths[0]
      console.log('导入设置从:', filePath)

      // 读取文件内容
      const content = fs.readFileSync(filePath, 'utf-8')
      const settings = JSON.parse(content)

      console.log('✅ 设置导入成功:', filePath)
      return {
        success: true,
        filePath: filePath,
        settings: settings,
        canceled: false
      }
    } catch (error) {
      console.error('❌ 导入设置失败:', error)
      return {
        success: false,
        error: error.message,
        canceled: false
      }
    }
  })

  // 2、自动备份设置到用户文档目录，并轮换历史配置备份。
  ipcMain.handle('settings-auto-backup', async (event, settings) => {
    try {
      const backupDir = getSettingsBackupPath()

      // 确保备份目录存在
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true })
        console.log('✅ 创建配置备份目录:', backupDir)
      }

      // 生成备份文件名（保留最近5个备份）
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
      const backupFileName = `settings-backup_${timestamp}.json`
      const backupFilePath = path.join(backupDir, backupFileName)

      // 写入备份文件
      fs.writeFileSync(backupFilePath, JSON.stringify(settings, null, 2), 'utf-8')

      console.log('✅ 配置已自动备份到:', backupFilePath)

      // 清理旧备份（只保留最近5个）
      const backupFiles = fs.readdirSync(backupDir)
        .filter(file => file.startsWith('settings-backup_') && file.endsWith('.json'))
        .sort()
        .reverse()

      if (backupFiles.length > 5) {
        const filesToDelete = backupFiles.slice(5)
        filesToDelete.forEach(file => {
          const fileToDelete = path.join(backupDir, file)
          try {
            fs.unlinkSync(fileToDelete)
            console.log('🗑️ 删除旧备份:', file)
          } catch (err) {
            console.warn('⚠️ 删除旧备份失败:', file, err)
          }
        })
      }

      // 同时保存一个latest.json作为最新备份
      const latestBackupPath = path.join(backupDir, 'settings-latest.json')
      fs.writeFileSync(latestBackupPath, JSON.stringify(settings, null, 2), 'utf-8')

      return {
        success: true,
        backupPath: backupFilePath
      }
    } catch (error) {
      console.error('❌ 自动备份设置失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  // 3、从用户文档目录读取最新设置副本。
  ipcMain.handle('settings-restore', async (event) => {
    try {
      const backupDir = getSettingsBackupPath()
      const latestBackupPath = path.join(backupDir, 'settings-latest.json')

      if (!fs.existsSync(latestBackupPath)) {
        return {
          success: false,
          error: '未找到备份文件'
        }
      }

      // 读取最新备份
      const content = fs.readFileSync(latestBackupPath, 'utf-8')
      const settings = JSON.parse(content)

      console.log('✅ 从备份恢复设置:', latestBackupPath)
      return {
        success: true,
        settings: settings,
        backupPath: latestBackupPath
      }
    } catch (error) {
      console.error('❌ 恢复设置失败:', error)
      return {
        success: false,
        error: error.message
      }
    }
  })

  console.log('✓ 设置导入导出处理器已注册')
}

/**
 * 清理设置导入导出处理器
 * 处理流程：
 * 1、移除导出、导入、自动备份和恢复通道监听。
 */
export function unregisterSettingsHandlers() {
  // 1、清理设置文件管理的四个事件通道。
  ipcMain.removeAllListeners('settings-export')
  ipcMain.removeAllListeners('settings-import')
  ipcMain.removeAllListeners('settings-auto-backup')
  ipcMain.removeAllListeners('settings-restore')
  console.log('✓ 设置导入导出处理器已移除')
}
