<template>
  <div class="panel">
    <div class="panel-header" @click="togglePanel">
      <span>视角管理</span>
      <span>{{ collapsed ? '▼' : '▲' }}</span>
    </div>
    <div class="panel-content" v-show="!collapsed">
      <div class="layers-container">
        <div 
          v-for="layer in layers" 
          :key="layer.id"
          class="layer-section"
          :class="{ active: activeLayer && activeLayer.id === layer.id }"
          @click="selectLayer(layer)"
        >
          <!-- 视角标题 -->
          <div class="layer-title">
            <span class="layer-name">{{ layer.name }}</span>
          </div>

          <!-- 导入按钮区域 -->
          <div class="upload-controls">
            <button 
              @click.stop="triggerUpload(layer, 'background')" 
              class="upload-btn background-btn"
              :disabled="!activeLayer || activeLayer.id !== layer.id"
            >
              设置背景
            </button>
            <button 
              @click.stop="triggerUpload(layer, 'character')" 
              class="upload-btn character-btn"
              :disabled="!activeLayer || activeLayer.id !== layer.id"
            >
              添加角色
            </button>
          </div>

          <!-- 内容预览区域 -->
          <div class="images-preview">
            <!-- 背景素材 -->
            <div 
              class="image-container background-container"
              :class="{ 
                'has-image': layer.backgroundImage,
                'selected': isImageSelected(layer, 'background'),
                'drag-over': backgroundDragOver && activeLayer && activeLayer.id === layer.id
              }"
              @click.stop="selectImage(layer, 'background')"
              @dragover.prevent="handleDragOver($event, layer, 'background')"
              @dragenter.prevent="handleDragEnter($event, layer, 'background')"
              @dragleave.prevent="handleDragLeave($event, layer, 'background')"
              @drop.prevent="handleDrop($event, layer, 'background')"
            >
              <div class="image-wrapper">
                <img 
                  v-if="layer.backgroundImage"
                  :src="layer.backgroundImage"
                  alt="背景素材"
                  class="preview-image"
                />
                <div v-else class="placeholder">
                  <span>背景素材</span>
                  <small>点击或拖拽导入</small>
                </div>
                <!-- 删除按钮 -->
                <button 
                  v-if="layer.backgroundImage"
                  class="delete-btn"
                  @click.stop="deleteBackground(layer)"
                  title="删除背景"
                >
                  ×
                </button>
                <!-- 选中指示器 -->
                <div 
                  v-if="isImageSelected(layer, 'background')" 
                  class="selection-overlay"
                >
                  <div class="selection-indicator">
                    <svg class="check-icon" viewBox="0 0 24 24" fill="none">
                      <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            <!-- 角色形象列表 -->
            <div class="characters-container">
              <div 
                v-for="(character, index) in layer.characterImages || []"
                :key="character.id"
                class="image-container character-container"
                :class="{ 
                  'has-image': true,
                  'selected': isCharacterSelected(layer, character.id),
                  'drag-over': characterDragOver && activeLayer && activeLayer.id === layer.id
                }"
                @click.stop="selectCharacterImage(layer, character, index)"
              >
                <div class="image-wrapper">
                  <img 
                    :src="character.imageSrc"
                    :alt="`角色 ${index + 1}`"
                    class="preview-image"
                  />
                  <!-- 删除按钮 -->
                  <button 
                    class="delete-btn"
                    @click.stop="deleteCharacter(layer, character.id)"
                    title="删除角色"
                  >
                    ×
                  </button>
                  <!-- 选中指示器 -->
                  <div 
                    v-if="isCharacterSelected(layer, character.id)" 
                    class="selection-overlay"
                  >
                    <div class="selection-indicator">
                      <svg class="check-icon" viewBox="0 0 24 24" fill="none">
                        <path d="M9 12L11 14L15 10" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                      </svg>
                    </div>
                  </div>
                </div>
              </div>
              
              <!-- 添加角色占位符 -->
              <div 
                class="image-container character-container add-character"
                :class="{ 
                  'drag-over': characterDragOver && activeLayer && activeLayer.id === layer.id
                }"
                @click.stop="triggerUpload(layer, 'character')"
                @dragover.prevent="handleDragOver($event, layer, 'character')"
                @dragenter.prevent="handleDragEnter($event, layer, 'character')"
                @dragleave.prevent="handleDragLeave($event, layer, 'character')"
                @drop.prevent="handleDrop($event, layer, 'character')"
              >
                <div class="image-wrapper">
                  <div class="placeholder add-placeholder">
                    <svg class="add-icon" viewBox="0 0 24 24" fill="none">
                      <path d="M12 5V19M5 12H19" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                    </svg>
                    <span>添加角色</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-if="layers.length === 0" class="empty-state">
        <p>暂无图层</p>
        <small>请先选择一个模板</small>
      </div>

      <!-- 错误提示 -->
      <div v-if="uploadError" class="error-message">
        <span class="error-icon">⚠️</span>
        {{ uploadError }}
      </div>

      <!-- 隐藏的文件输入 -->
      <input 
        ref="fileInput"
        type="file"
        accept="image/png,image/jpg,image/jpeg,image/gif,image/webp,image/svg+xml"
        style="display: none"
        @change="handleFileChange"
      >
    </div>
  </div>
</template>

<script>
/**
 * 视角管理组件
 * 
 * 功能：
 * - 结合视角管理和内容导入功能
 * - 支持每个视角的背景素材和角色形象导入
 * - 支持拖拽导入
 * - 支持内容选择和激活状态
 * - 优化的布局和空间利用
 */

import { ref, computed } from 'vue'

export default {
  name: 'LayerImageManager',
  props: {
    layers: {
      type: Array,
      required: true
    },
    activeLayer: {
      type: Object,
      default: null
    },
    activeImage: {
      type: Object,
      default: null
    }
  },
  emits: [
    'layer-select', 
    'background-upload', 
    'character-upload', 
    'image-activate'
  ],
  /**
   * 管理视角素材导入、选择及删除交互。
   * 处理流程：
   * 1、初始化上传目标、拖拽提示和错误状态
   * 2、定义文件导入与图片选择删除操作
   * 3、向模板暴露交互状态和处理方法
   */
  setup(props, { emit }) {
    // 1、初始化本次上传及拖放交互的临时状态。
    const collapsed = ref(false)
    const fileInput = ref(null)
    const pendingUpload = ref(null) // 存储待处理的上传信息
    const backgroundDragOver = ref(false)
    const characterDragOver = ref(false)
    const uploadError = ref('')

    /**
     * 切换面板展开/收起状态
     * 处理流程：
     * 1、反转面板折叠状态
     */
    const togglePanel = () => {
      // 1、切换面板显示状态。
      collapsed.value = !collapsed.value
    }

    /**
     * 选择图层
     * 处理流程：
     * 1、向父组件发送目标图层
     */
    const selectLayer = (layer) => {
      // 1、切换当前操作的视角。
      emit('layer-select', layer)
    }


    /**
     * 验证文件类型
     * 处理流程：
     * 1、按允许的图片媒体类型检查文件
     */
    const validateImageFile = (file) => {
      // 1、检查文件声明的图片类型是否受支持。
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
      return validTypes.includes(file.type)
    }

    /**
     * 触发文件上传
     * 处理流程：
     * 1、选中目标视角并记录导入类型
     * 2、打开文件选择输入框
     */
    const triggerUpload = (layer, type) => {
      // 1、固定本次导入的视角与图片类型。
      if (!props.activeLayer || props.activeLayer.id !== layer.id) {
        selectLayer(layer)
      }
      
      pendingUpload.value = { layer, type }
      // 2、让用户选择图片文件。
      fileInput.value?.click()
    }

    /**
     * 处理文件选择变化
     * 处理流程：
     * 1、检查文件类型及待上传目标
     * 2、选择目标视角并发送对应类型的上传事件
     * 3、清理输入状态并显示导入异常
     */
    const handleFileChange = (event) => {
      // 1、验证所选文件及上传上下文。
      try {
        const file = event.target.files[0]
        uploadError.value = ''
        
        if (!file) {
          uploadError.value = '未选择文件'
          return
        }
        
        if (!validateImageFile(file)) {
          uploadError.value = '文件格式不支持，请选择合适的内容文件'
          return
        }
        
        if (!pendingUpload.value) {
          uploadError.value = '导入配置错误，请重试'
          return
        }
        
        const { layer, type } = pendingUpload.value
        
        // 2、确保图层被选中并分派对应上传事件。
        if (!props.activeLayer || props.activeLayer.id !== layer.id) {
          selectLayer(layer)
        }
        
        // 发送上传事件
        if (type === 'background') {
          emit('background-upload', file)
        } else {
          emit('character-upload', file)
        }
        
        // 3、清除文件选择和待处理状态。
        event.target.value = ''
        pendingUpload.value = null
        
        // 清除错误信息
        setTimeout(() => {
          uploadError.value = ''
        }, 3000)
        
      } catch (error) {
        uploadError.value = `导入失败: ${error.message}`
        console.error('Upload error:', error)
        
        // 5秒后自动清除错误信息
        setTimeout(() => {
          uploadError.value = ''
        }, 5000)
      }
    }

    /**
     * 处理拖拽进入
     * 处理流程：
     * 1、阻止默认处理并开启目标区域的拖拽提示
     */
    const handleDragEnter = (event, layer, type) => {
      // 1、按投放类型显示拖拽高亮。
      event.preventDefault()
      if (type === 'background') {
        backgroundDragOver.value = true
      } else {
        characterDragOver.value = true
      }
    }

    /**
     * 处理拖拽悬停
     * 处理流程：
     * 1、阻止默认行为以保持区域可投放
     */
    const handleDragOver = (event, layer, type) => {
      // 1、允许浏览器继续派发投放事件。
      event.preventDefault()
      // 保持拖拽状态
    }

    /**
     * 处理拖拽离开
     * 处理流程：
     * 1、阻止默认处理并取消目标区域的拖拽提示
     */
    const handleDragLeave = (event, layer, type) => {
      // 1、清除对应投放区域的高亮。
      event.preventDefault()
      if (type === 'background') {
        backgroundDragOver.value = false
      } else {
        characterDragOver.value = false
      }
    }

    /**
     * 处理拖拽放置 - 精确投放到指定类型
     * 处理流程：
     * 1、清除拖拽提示并筛选支持的图片
     * 2、选中目标图层并上传第一张有效图片
     * 3、延时清理提示并报告导入异常
     */
    const handleDrop = (event, layer, type) => {
      // 1、接管投放行为并验证文件列表。
      event.preventDefault()
      
      try {
        // 清除拖拽状态
        backgroundDragOver.value = false
        characterDragOver.value = false
        uploadError.value = ''
        
        const files = Array.from(event.dataTransfer.files)
        const imageFiles = files.filter(validateImageFile)
        
        if (imageFiles.length === 0) {
          uploadError.value = '请拖拽内容文件'
          
          // 3秒后自动清除错误信息
          setTimeout(() => {
            uploadError.value = ''
          }, 3000)
          return
        }
        
        // 2、确保图层被选中并向指定类型导入首张图片。
        if (!props.activeLayer || props.activeLayer.id !== layer.id) {
          selectLayer(layer)
        }
        
        // 处理第一个图片文件
        const file = imageFiles[0]
        
        // 精确上传到指定类型
        if (type === 'background') {
          emit('background-upload', file)
        } else {
          emit('character-upload', file)
        }
        
        // 3、延时清除错误信息。
        setTimeout(() => {
          uploadError.value = ''
        }, 3000)
        
      } catch (error) {
        uploadError.value = `拖拽导入失败: ${error.message}`
        console.error('Drag drop error:', error)
        
        // 5秒后自动清除错误信息
        setTimeout(() => {
          uploadError.value = ''
        }, 5000)
      }
    }

    /**
     * 选择图片
     * 处理流程：
     * 1、图片缺失时打开上传入口
     * 2、确认目标视角并切换图片激活状态
     */
    const selectImage = (layer, type) => {
      // 1、检查目标位置是否已有图片。
      const imageExists = type === 'background' ? layer.backgroundImage : layer.characterImage
      
      if (!imageExists) {
        // 如果图片不存在，触发上传
        triggerUpload(layer, type)
        return
      }
      
      // 2、确保图层被选中并切换该图片的激活状态。
      if (!props.activeLayer || props.activeLayer.id !== layer.id) {
        selectLayer(layer)
      }
      
      // 检查是否已经选中这个图片
      const isCurrentlySelected = isImageSelected(layer, type)
      
      if (isCurrentlySelected) {
        // 如果已经选中，则取消选中
        emit('image-activate', null, 'sidebar')
      } else {
        // 选中这个图片
        emit('image-activate', {
          layer: layer,
          type: type,
          imageSrc: imageExists
        }, 'sidebar')
      }
    }

    /**
     * 检查图片是否被选中
     * 处理流程：
     * 1、匹配图层、图片类型并排除独立角色选择
     */
    const isImageSelected = (layer, type) => {
      // 1、确认当前选择属于目标视角的非独立角色图片。
      return props.activeImage && 
             props.activeImage.layer && 
             props.activeImage.layer.id === layer.id && 
             props.activeImage.type === type &&
             !props.activeImage.characterId // 确保不是选中的角色
    }

    /**
     * 检查某个角色是否被选中
     * 处理流程：
     * 1、匹配图层编号、人物类型及角色编号
     */
    const isCharacterSelected = (layer, characterId) => {
      // 1、按角色唯一编号确认当前选择。
      return props.activeImage && 
             props.activeImage.layer && 
             props.activeImage.layer.id === layer.id && 
             props.activeImage.type === 'character' &&
             props.activeImage.characterId === characterId
    }

    /**
     * 选择角色图片
     * 处理流程：
     * 1、选中角色所在图层
     * 2、切换指定角色的激活状态
     */
    const selectCharacterImage = (layer, character, index) => {
      // 1、确保图层被选中。
      if (!props.activeLayer || props.activeLayer.id !== layer.id) {
        selectLayer(layer)
      }
      
      // 2、检查是否已经选中这个角色并切换激活状态。
      const isCurrentlySelected = isCharacterSelected(layer, character.id)
      
      if (isCurrentlySelected) {
        // 如果已经选中，则取消选中
        emit('image-activate', null, 'sidebar')
      } else {
        // 选中这个角色
        emit('image-activate', {
          layer: layer,
          type: 'character',
          imageSrc: character.imageSrc,
          characterId: character.id,
          characterIndex: index
        }, 'sidebar')
      }
    }

    /**
     * 删除角色
     * 处理流程：
     * 1、定位待删除角色
     * 2、清除该角色的激活状态并移除数组项
     * 3、通知父组件刷新目标图层
     */
    const deleteCharacter = (layer, characterId) => {
      // 1、确认角色数组及目标索引存在。
      if (!layer.characterImages) return
      
      // 查找角色索引
      const index = layer.characterImages.findIndex(c => c.id === characterId)
      if (index === -1) return
      
      // 2、如果当前选中的就是这个角色，取消选中后删除。
      if (isCharacterSelected(layer, characterId)) {
        emit('image-activate', null, 'sidebar')
      }
      
      // 从数组中删除
      layer.characterImages.splice(index, 1)
      
      // 3、触发图层更新。
      emit('layer-select', layer)
    }

    /**
     * 删除背景
     * 处理流程：
     * 1、确认背景存在并清除其激活状态
     * 2、删除背景及变换数据并通知父组件
     */
    const deleteBackground = (layer) => {
      // 1、确认背景存在并处理当前选择。
      if (!layer.backgroundImage) return
      
      // 如果当前选中的就是这个背景，取消选中
      if (isImageSelected(layer, 'background')) {
        emit('image-activate', null, 'sidebar')
      }
      
      // 2、清除背景图片和变换数据并通知图层更新。
      layer.backgroundImage = null
      layer.backgroundTransform = null
      
      // 触发图层更新
      emit('layer-select', layer)
    }

    // 3、向模板提供素材管理状态与操作。
    return {
      collapsed,
      fileInput,
      backgroundDragOver,
      characterDragOver,
      uploadError,
      togglePanel,
      selectLayer,
      triggerUpload,
      handleFileChange,
      handleDragEnter,
      handleDragOver,
      handleDragLeave,
      handleDrop,
      selectImage,
      isImageSelected,
      isCharacterSelected,
      selectCharacterImage,
      deleteCharacter,
      deleteBackground
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

.layers-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.layer-section {
  border: 2px solid var(--theme-border);
  border-radius: 8px;
  padding: 12px;
  background: var(--theme-background);
  transition: all 0.3s ease;
  cursor: pointer;
}

.layer-section:hover {
  border-color: var(--theme-primary);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.1);
}

.layer-section.active {
  border-color: #4f9eff;
  border-width: 3px;
  background: rgba(79, 158, 255, 0.08);
  box-shadow: 0 4px 16px rgba(79, 158, 255, 0.35);
}

.layer-title {
  margin-bottom: 8px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--theme-border);
}

.layer-name {
  font-weight: 600;
  color: var(--theme-foreground);
  font-size: 14px;
}


.btn {
  padding: 4px 8px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  background: var(--theme-background);
  color: var(--theme-foreground);
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s ease;
}

.btn-small {
  padding: 2px 6px;
  font-size: 10px;
}

.btn-primary {
  background: var(--theme-primary);
  border-color: var(--theme-primary);
  color: white;
}

.btn-secondary {
  background: var(--theme-background-secondary);
  border-color: var(--theme-border);
}

.btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.upload-controls {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.upload-btn {
  flex: 1;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 4px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.3s ease;
  white-space: nowrap;
}

.upload-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.background-btn {
  background: linear-gradient(135deg, var(--theme-primary) 0%, #3b82f6 100%);
  color: white;
}

.background-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #3b82f6 0%, var(--theme-primary) 100%);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(59, 130, 246, 0.3);
}

.character-btn {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
  color: white;
}

.character-btn:hover:not(:disabled) {
  background: linear-gradient(135deg, #059669 0%, #10b981 100%);
  transform: translateY(-1px);
  box-shadow: 0 2px 4px rgba(16, 185, 129, 0.3);
}

.images-preview {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.characters-container {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.image-container {
  aspect-ratio: 16/9;
  border: 2px solid var(--theme-border);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  background: var(--theme-background-secondary);
  overflow: hidden;
}

.image-container:hover {
  border-color: var(--theme-primary);
  box-shadow: 0 2px 8px rgba(102, 126, 234, 0.2);
  transform: scale(1.02);
}

.image-container.selected {
  border-color: #4f9eff;
  border-width: 4px;
  background: rgba(79, 158, 255, 0.1);
  box-shadow: 
    0 4px 16px rgba(79, 158, 255, 0.4),
    0 0 0 2px rgba(79, 158, 255, 0.2);
  transform: scale(1.03);
}

.image-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
}

.preview-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: all 0.3s ease;
}

.placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  color: var(--theme-foreground-muted);
  height: 100%;
  padding: 8px;
}

.placeholder span {
  font-size: 12px;
  font-weight: 500;
  margin-bottom: 2px;
}

.placeholder small {
  font-size: 10px;
  opacity: 0.7;
}

/* 选中状态遮罩 */
.selection-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: rgba(79, 158, 255, 0.15);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: fadeInOverlay 0.3s ease-out;
}

.selection-indicator {
  width: 28px;
  height: 28px;
  background: #4f9eff;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  animation: scaleInIndicator 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
  box-shadow: 0 3px 10px rgba(79, 158, 255, 0.6);
}

.check-icon {
  width: 16px;
  height: 16px;
  stroke-width: 3;
}

/* 选中状态时图片稍微变暗 */
.image-container.selected .preview-image {
  filter: brightness(0.85);
}

/* 拖拽悬停状态 */
.image-container.drag-over {
  border-color: #10b981 !important;
  border-width: 3px !important;
  background: rgba(16, 185, 129, 0.1) !important;
  box-shadow: 
    0 0 0 2px rgba(16, 185, 129, 0.2),
    0 4px 12px rgba(16, 185, 129, 0.3) !important;
  transform: scale(1.05) !important;
}

.image-container.drag-over .placeholder {
  color: #10b981;
  font-weight: 600;
}

.empty-state {
  text-align: center;
  padding: 2rem 1rem;
  color: var(--theme-foreground-muted);
}

/* 错误提示样式 */
.error-message {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  padding: 8px 12px;
  margin-top: 12px;
  color: #ef4444;
  font-size: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  animation: slideInError 0.3s ease-out;
}

.error-icon {
  font-size: 14px;
}

@keyframes slideInError {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.empty-state p {
  margin-bottom: 0.5rem;
  font-size: 1rem;
}

.empty-state small {
  font-size: 0.8rem;
}

/* 动画效果 */
@keyframes fadeInOverlay {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scaleInIndicator {
  from {
    transform: scale(0);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

/* 删除按钮 */
.delete-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 20px;
  height: 20px;
  background: rgba(239, 68, 68, 0.9);
  color: white;
  border: none;
  border-radius: 50%;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: all 0.2s ease;
  z-index: 10;
}

.image-container:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 1);
  transform: scale(1.1);
}

/* 添加角色占位符 */
.add-character {
  cursor: pointer;
  border-style: dashed;
  opacity: 0.7;
  transition: all 0.3s ease;
}

.add-character:hover {
  opacity: 1;
  border-color: #10b981;
  background: rgba(16, 185, 129, 0.05);
}

.add-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.add-icon {
  width: 24px;
  height: 24px;
  stroke: var(--theme-foreground-muted);
}

.add-character:hover .add-icon {
  stroke: #10b981;
}

.add-character:hover .add-placeholder span {
  color: #10b981;
}

/* 拖拽提示效果 */
.images-preview:hover {
  background: rgba(102, 126, 234, 0.05);
  border-radius: 6px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .characters-container {
    grid-template-columns: 1fr;
    gap: 8px;
  }
  
  .upload-controls {
    flex-direction: column;
    gap: 6px;
  }
  
  .layer-section {
    padding: 10px;
  }
}
</style>
