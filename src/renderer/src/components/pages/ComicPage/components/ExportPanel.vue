<template>
  <div class="panel">
    <div class="panel-header" @click="togglePanel">
      <span>导出设置</span>
      <span>{{ collapsed ? '▼' : '▲' }}</span>
    </div>
    <div class="panel-content" v-show="!collapsed">
      <div class="export-section">
        <div class="export-actions">
          <button 
            @click="exportAllWithFolderSelection"
            class="btn btn-primary export-btn"
            :disabled="isExporting"
          >
            <span v-if="isExporting" class="loading"></span>
            <span class="btn-text-full">{{ isExporting ? '导出中...' : '导出整体' }}</span>
            <span class="btn-text-short">{{ isExporting ? '导出中...' : '导出整体内容' }}</span>
          </button>
          
          <button 
            @click="exportAllLayersWithFolderSelection"
            class="btn btn-success export-btn"
            :disabled="layers.length === 0 || isExporting"
          >
            <span v-if="isExporting" class="loading"></span>
            <span class="btn-text-full">{{ isExporting ? '导出中...' : '导出所有视角' }}</span>
            <span class="btn-text-short">{{ isExporting ? '导出中...' : '导出各视角' }}</span>
          </button>
        </div>
        
        <!-- 显示最后选择的路径（可选） -->
        <div v-if="lastSelectedPath" class="last-export-info">
          <small class="text-muted">上次导出到：{{ lastSelectedPath }}</small>
        </div>
      </div>

    </div>
  </div>
</template>

<script>
/**
 * 导出设置面板组件
 * 
 * 功能：
 * - 设置导出路径和选项
 * - 支持整体导出和单个视角导出
 * - 支持批量导出所有视角
 * - 内容质量和格式设置
 */

import { ref, reactive, inject } from 'vue'

export default {
  name: 'ExportPanel',
  props: {
    layers: {
      type: Array,
      default: () => []
    },
    activeLayer: {
      type: Object,
      default: null
    }
  },
  emits: ['export-all', 'export-single', 'export-batch', 'export-path-change'],
  /**
   * 管理导出目录、固定导出设置与导出事件。
   * 处理流程：
   * 1、初始化导出状态和导出选项
   * 2、定义目录选择及整体、批量导出操作
   * 3、向模板暴露状态与方法
   */
  setup(props, { emit }) {
    // 1、初始化目录、忙碌状态及导出设置。
    const collapsed = ref(false)
    const lastSelectedPath = ref('')
    const isExporting = ref(false)

    // 导出设置（默认始终包含背景，质量固定100%）
    const exportSettings = reactive({
      includeBackground: true,
      quality: 1.0,
      format: 'png'
    })

    // 2、定义目录选择与整体、批量导出的交互入口。
    /**
     * 切换面板展开/收起状态
     * 处理流程：
     * 1、反转面板折叠状态
     */
    const togglePanel = () => {
      // 1、切换导出面板的折叠状态。
      collapsed.value = !collapsed.value
    }

    /**
     * 选择文件夹并返回路径信息（使用Electron的IPC）
     * 处理流程：
     * 1、调用桌面目录选择接口
     * 2、记录有效目录并处理取消或不可用情况
     * 3、提示异常并返回空结果
     */
    const selectFolderForExport = async () => {
      // 1、通过桌面桥接打开目录选择对话框。
      try {
        // 使用Electron的IPC调用主进程的目录选择对话框
        if (window.fileSystem && window.fileSystem.selectFolder) {
          const result = await window.fileSystem.selectFolder()
          
          // 2、保存有效目录，取消选择时不发起导出。
          if (result && result.success && result.path) {
            lastSelectedPath.value = result.path
            return {
              path: result.path,
              handle: null
            }
          } else if (result && result.canceled) {
            console.log('用户取消了文件夹选择')
            return null
          } else {
            throw new Error(result.error || '文件夹选择失败')
          }
        } else {
          // 降级方案：提示用户
          alert('文件夹选择功能不可用，请确认您在Electron环境中运行此应用。')
        }
        return null
      } catch (error) {
        // 3、向用户报告目录选择失败。
        console.error('文件夹选择失败:', error)
        alert('文件夹选择失败: ' + error.message)
        return null
      }
    }

    /**
     * 选择文件夹并导出整体内容
     * 处理流程：
     * 1、阻止重复导出并选择目录
     * 2、发送整体导出请求并恢复面板忙碌状态
     */
    const exportAllWithFolderSelection = async () => {
      // 1、确认空闲并取得有效导出目录。
      if (isExporting.value) return
      
      // 先选择文件夹
      const folderInfo = await selectFolderForExport()
      if (!folderInfo) return
      
      // 2、通知父组件执行整体导出。
      isExporting.value = true
      try {
        emit('export-all', {
          path: folderInfo.path,
          settings: exportSettings
        })
      } finally {
        isExporting.value = false
      }
    }

    /**
     * 选择文件夹并导出所有视角
     * 处理流程：
     * 1、检查图层及忙碌状态并选择目录
     * 2、筛选可见视角并发送批量导出请求
     * 3、恢复导出状态
     */
    const exportAllLayersWithFolderSelection = async () => {
      // 1、确认有可导出内容并取得目录。
      if (props.layers.length === 0 || isExporting.value) return
      
      // 先选择文件夹
      const folderInfo = await selectFolderForExport()
      if (!folderInfo) return
      
      isExporting.value = true
      try {
        // 2、筛选可见视角。
        const visibleLayers = props.layers.filter(layer => layer.visible)
        
        if (visibleLayers.length === 0) {
          console.warn('没有可见的视角需要导出')
          return
        }
        
        // 发射批量导出事件
        emit('export-batch', visibleLayers, {
          path: folderInfo.path,
          settings: exportSettings
        })
      } finally {
        // 3、释放面板导出状态。
        isExporting.value = false
      }
    }

    // 3、向模板提供导出设置与交互方法。
    return {
      collapsed,
      lastSelectedPath,
      exportSettings,
      isExporting,
      togglePanel,
      selectFolderForExport,
      exportAllWithFolderSelection,
      exportAllLayersWithFolderSelection
    }
  }
}
</script>

<style scoped>
.panel {
  background: var(--theme-background-card);
  border: 1px solid var(--theme-border);
  border-radius: var(--border-radius-md);
  margin-bottom: var(--spacing-4);
}

.panel-header {
  padding: var(--spacing-3) var(--spacing-4);
  background: var(--theme-background-accent);
  border-bottom: 1px solid var(--theme-border);
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 500;
  user-select: none;
  transition: var(--transition-colors);
}

.panel-header:hover {
  background: var(--theme-background-secondary);
}

.panel-content {
  padding: var(--spacing-4);
}

.export-section {
  margin-bottom: 1.5rem;
}

.export-section h4 {
  margin-bottom: 0.5rem;
  font-size: 1rem;
  color: var(--theme-foreground);
}

.export-section:last-child {
  margin-bottom: 0;
}

.export-options {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9rem;
  cursor: pointer;
}

.checkbox-label input[type="checkbox"] {
  margin: 0;
}

.quality-slider {
  width: 100%;
  margin: 0.5rem 0;
}

.quality-value {
  font-size: 0.9rem;
  color: var(--theme-foreground-muted);
}

.export-actions {
  display: flex;
  flex-direction: row;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.export-actions .btn {
  flex: 1;
  min-width: auto;
  padding: 0.6rem 1rem;
  white-space: nowrap;
  font-weight: 500;
  transition: all 0.3s ease;
  border: none;
  border-radius: var(--border-radius-md);
  cursor: pointer;
}

/* 导出整体内容按钮 - 蓝色主题 */
.export-actions .btn-primary {
  background: linear-gradient(135deg, var(--theme-primary) 0%, #3b82f6 100%);
  color: white;
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.2);
}

.export-actions .btn-primary:hover {
  background: linear-gradient(135deg, #3b82f6 0%, var(--theme-primary) 100%);
  box-shadow: 0 4px 8px rgba(59, 130, 246, 0.3);
  transform: translateY(-1px);
}

/* 导出各视角按钮 - 绿色主题 */
.export-actions .btn-success {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.2);
}

.export-actions .btn-success:hover {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  box-shadow: 0 4px 8px rgba(16, 185, 129, 0.3);
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

/* 最后导出信息显示 */
.last-export-info {
  margin-top: 0.75rem;
  padding: 0.5rem 0.75rem;
  background-color: var(--theme-background-accent);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  text-align: center;
}

.text-muted {
  color: var(--theme-foreground-muted);
}

/* 按钮文本响应式显示 */
.btn-text-short {
  display: none;
}

.btn-text-full {
  display: inline;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .export-actions {
    flex-direction: column;
    gap: 0.75rem;
  }
  
  .export-actions .btn {
    width: 100%;
  }
  
  /* 在小屏幕上显示简短文本 */
  .btn-text-full {
    display: none;
  }
  
  .btn-text-short {
    display: inline;
  }
}

/* 超小屏幕优化 */
@media (max-width: 480px) {
  .export-actions .btn {
    padding: 0.5rem 0.75rem;
    font-size: 0.9rem;
  }
  
  .last-export-info {
    font-size: 0.8rem;
  }
}

.loading {
  display: inline-block;
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
  margin-right: 8px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
