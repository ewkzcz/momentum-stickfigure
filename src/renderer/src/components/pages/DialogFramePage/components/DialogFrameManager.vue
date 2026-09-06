<template>
  <div class="dialog-frame-manager">
    <!-- 对话框图片管理面板 -->
    <div class="panel">
      <div class="panel-header">
        <span>对话框图片</span>
        <button 
          v-if="dialogFrame"
          class="btn btn-small btn-primary" 
          @click="triggerFrameUpload"
        >
          更换图片
        </button>
      </div>
      <div class="panel-content">
        <div v-if="!dialogFrame" class="upload-area" @click="triggerFrameUpload">
          <div class="upload-icon">📁</div>
          <div class="upload-text">点击上传对话框图片</div>
          <div class="upload-hint">或拖拽图片到页面任意位置</div>
        </div>
        <div v-else class="frame-preview" :class="{ 'active': isActiveFrame }" @click="handleFrameClick">
          <img :src="dialogFrame.imageSrc" alt="对话框" class="frame-image" />
          <div class="frame-overlay">
            <div class="frame-label">点击选中调整</div>
          </div>
        </div>
        <input
          ref="frameInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleFrameInputChange"
        />
      </div>
    </div>

    <!-- 人物图片管理面板 -->
    <div class="panel">
      <div class="panel-header">
        <span>人物图片</span>
        <button 
          class="btn btn-small btn-primary" 
          @click="triggerCharacterUpload"
          :disabled="!dialogFrame"
        >
          + 添加人物
        </button>
      </div>
      <div class="panel-content">
        <div v-if="!dialogFrame && characters.length === 0" class="empty-hint">
          请先上传对话框图片
        </div>
        <div v-else-if="characters.length === 0" class="empty-hint">
          暂无人物图片，点击"添加人物"按钮上传
        </div>
        <div v-else class="character-list">
          <div v-if="!dialogFrame" class="character-warning">
            建议先上传对话框图片，以便在画布中查看人物
          </div>
          <div
            v-for="(character, index) in characters"
            :key="character.id"
            :class="['character-item', { active: isActiveCharacter(character) }]"
            @click="handleCharacterClick(character)"
          >
            <img :src="character.imageSrc" alt="人物" class="character-thumbnail" />
            <div class="character-info">
              <div class="character-name">人物 {{ index + 1 }}</div>
            </div>
            <button
              class="btn-delete"
              @click.stop="handleDeleteClick(character.id)"
              title="删除"
            >
              ×
            </button>
          </div>
        </div>
        <input
          ref="characterInput"
          type="file"
          accept="image/*"
          style="display: none"
          @change="handleCharacterInputChange"
        />
      </div>
    </div>
  </div>
</template>

<script>
/** 对话框素材管理面板：提供蒙版和人物的文件选择、激活及删除入口。 */
import { ref, computed } from 'vue'

export default {
  name: 'DialogFrameManager',
  props: {
    dialogFrame: {
      type: Object,
      default: null
    },
    characters: {
      type: Array,
      default: () => []
    },
    activeCharacter: {
      type: Object,
      default: null
    },
    activeObjectType: {
      type: String,
      default: 'character'
    }
  },
  emits: ['frame-upload', 'character-upload', 'character-select', 'character-delete', 'frame-select'],
  /**
   * 连接素材输入框与父页面的管理事件。
   * 处理流程：
   * 1、初始化文件输入引用并定义上传处理
   * 2、提供当前激活判断与选择、删除操作
   * 3、将状态和操作暴露给模板
   */
  setup(props, { emit }) {
    // 1、保存两类素材各自的文件选择入口。
    const frameInput = ref(null)
    const characterInput = ref(null)

    /**
     * 触发对话框图片上传
     * 处理流程：
     * 1、输入框挂载后打开对话框文件选择
     */
    const triggerFrameUpload = () => {
      // 1、打开蒙版图片选择器。
      if (frameInput.value) {
        frameInput.value.click()
      }
    }

    /**
     * 处理对话框图片选择
     * 处理流程：
     * 1、向父组件提交首个选中文件
     * 2、清空输入以支持重复选择同一文件
     */
    const handleFrameInputChange = (event) => {
      // 1、将有效文件交给父组件处理。
      const file = event.target.files[0]
      if (file) {
        emit('frame-upload', file)
      }
      // 2、清空输入框，允许重复上传同一文件。
      event.target.value = ''
    }

    /**
     * 触发人物图片上传
     * 处理流程：
     * 1、输入框挂载后打开人物文件选择
     */
    const triggerCharacterUpload = () => {
      // 1、打开人物图片选择器。
      if (characterInput.value) {
        characterInput.value.click()
      }
    }

    /**
     * 处理人物图片选择
     * 处理流程：
     * 1、向父组件提交首个选中文件
     * 2、清空输入以支持重复选择同一文件
     */
    const handleCharacterInputChange = (event) => {
      // 1、将人物文件交给父组件读取。
      const file = event.target.files[0]
      if (file) {
        emit('character-upload', file)
      }
      // 2、清空输入框，允许重复上传同一文件。
      event.target.value = ''
    }

    /**
     * 判断对话框是否激活
     */
    const isActiveFrame = computed(() => {
      return props.activeObjectType === 'frame'
    })

    /**
     * 判断是否为激活的人物
     * 处理流程：
     * 1、同时匹配人物编号与当前操作对象类型
     */
    const isActiveCharacter = (character) => {
      // 1、仅将当前人物操作对象视为激活项。
      return props.activeCharacter?.id === character.id && props.activeObjectType === 'character'
    }

    /**
     * 处理对话框点击
     * 处理流程：
     * 1、通知父组件激活对话框
     */
    const handleFrameClick = () => {
      // 1、切换操作目标为对话框。
      emit('frame-select')
    }

    /**
     * 处理人物点击
     * 处理流程：
     * 1、通知父组件激活指定人物
     */
    const handleCharacterClick = (character) => {
      // 1、提交本次选择的人物数据。
      emit('character-select', character)
    }

    /**
     * 处理删除点击
     * 处理流程：
     * 1、通知父组件删除指定编号的人物
     */
    const handleDeleteClick = (characterId) => {
      // 1、请求删除目标人物。
      emit('character-delete', characterId)
    }

    // 3、向模板提供文件选择入口及素材管理操作。
    return {
      frameInput,
      characterInput,
      isActiveFrame,
      triggerFrameUpload,
      handleFrameInputChange,
      triggerCharacterUpload,
      handleCharacterInputChange,
      isActiveCharacter,
      handleFrameClick,
      handleCharacterClick,
      handleDeleteClick
    }
  }
}
</script>

<style scoped>
.dialog-frame-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel {
  background: var(--theme-background-card);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
}

.panel-header {
  padding: 12px 16px;
  background: var(--theme-background-accent);
  font-weight: 600;
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--theme-border);
  color: var(--theme-foreground);
}

.panel-content {
  padding: 16px;
}

.upload-area {
  border: 2px dashed var(--theme-border);
  border-radius: 8px;
  padding: 32px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
}

.upload-area:hover {
  border-color: var(--theme-primary);
  background: var(--theme-background-accent);
}

.upload-icon {
  font-size: 48px;
  margin-bottom: 12px;
}

.upload-text {
  font-size: 14px;
  font-weight: 500;
  color: var(--theme-foreground);
  margin-bottom: 4px;
}

.upload-hint {
  font-size: 12px;
  color: var(--theme-foreground-muted);
}

.frame-preview {
  position: relative;
  cursor: pointer;
  transition: all 0.2s ease;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid var(--theme-border);
}

.frame-preview:hover {
  border-color: var(--theme-primary);
}

.frame-preview:hover .frame-overlay {
  opacity: 1;
}

.frame-preview.active {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.1);
}

.frame-image {
  width: 100%;
  height: auto;
  display: block;
  transition: all 0.2s ease;
}

.frame-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s ease;
  pointer-events: none;
}

.frame-label {
  color: white;
  font-size: 14px;
  font-weight: 500;
}

.empty-hint {
  text-align: center;
  padding: 24px;
  color: var(--theme-foreground-muted);
  font-size: 14px;
}

.character-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 400px;
  overflow-y: auto;
}

.character-warning {
  margin-bottom: 8px;
  padding: 8px;
  border: 1px dashed var(--theme-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--theme-foreground-muted);
  background: var(--theme-background-accent);
}

.character-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px;
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  position: relative;
}

.character-item:hover {
  background: var(--theme-background-accent);
  border-color: var(--theme-primary);
}

.character-item.active {
  background: rgba(102, 126, 234, 0.1);
  border-color: var(--theme-primary);
}

.character-thumbnail {
  width: 60px;
  height: 60px;
  object-fit: cover;
  border-radius: 6px;
  border: 1px solid var(--theme-border);
}

.character-info {
  flex: 1;
}

.character-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--theme-foreground);
}

.btn-delete {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 24px;
  height: 24px;
  border: none;
  background: rgba(239, 68, 68, 0.9);
  color: white;
  border-radius: 50%;
  cursor: pointer;
  font-size: 18px;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.btn-delete:hover {
  background: rgba(220, 38, 38, 1);
  transform: scale(1.1);
}

.btn {
  padding: 6px 12px;
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s ease;
  background: var(--theme-background);
  color: var(--theme-foreground);
}

.btn:hover:not(:disabled) {
  background: var(--theme-background-accent);
  border-color: var(--theme-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--theme-primary);
  border-color: var(--theme-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #3b82f6;
  border-color: #3b82f6;
}

.btn-small {
  padding: 4px 8px;
  font-size: 12px;
}

/* 响应式设计 - 适配插件模式横向布局 */
@media (max-width: 900px) and (max-height: 600px) {
  .dialog-frame-manager {
    flex-direction: row;
    gap: 12px;
    height: 100%;
  }
  
  .panel {
    min-width: 280px;
    flex-shrink: 0;
    height: 100%;
    display: flex;
    flex-direction: column;
  }
  
  .panel-content {
    padding: 12px;
    overflow-y: auto;
    flex: 1;
  }
  
  .upload-area {
    padding: 24px 16px;
  }
  
  .upload-icon {
    font-size: 36px;
    margin-bottom: 8px;
  }
  
  .upload-text {
    font-size: 13px;
  }
  
  .upload-hint {
    font-size: 11px;
  }
  
  .character-list {
    max-height: none;
  }
}

@media (max-width: 600px) {
  .dialog-frame-manager {
    flex-direction: column;
    height: auto;
  }
  
  .panel {
    min-width: auto;
    height: auto;
  }
  
  .panel-content {
    padding: 12px;
  }
}
</style>
