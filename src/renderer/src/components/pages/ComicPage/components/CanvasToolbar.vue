<template>
  <div class="canvas-toolbar">
    <!-- 缩放控制 -->
    <div class="toolbar-group">
      <button @click="$emit('zoom-in')" class="btn btn-small btn-secondary">放大</button>
      <button @click="$emit('zoom-out')" class="btn btn-small btn-secondary">缩小</button>
      <button @click="$emit('zoom-reset')" class="btn btn-small btn-secondary">重置</button>
      <span class="zoom-info">{{ Math.round(zoom * 100) }}%</span>
    </div>

    <!-- 显示控制 -->
    <div class="toolbar-group">
      <button 
        @click="handleHorizontalFlip" 
        class="btn btn-small btn-secondary"
        :disabled="!activeImage"
        :title="activeImage ? '水平翻转激活图片' : '请先激活一张图片'"
      >
        水平翻转
      </button>
    </div>

    <!-- 导出控制 -->
    <div class="toolbar-group">
      <button 
        @click="$emit('export-all')" 
        class="btn btn-small btn-primary"
        :disabled="exportDisabled"
      >
        导出整体
      </button>
      <button 
        @click="$emit('export-batch')" 
        class="btn btn-small btn-secondary"
        :disabled="exportDisabled"
      >
        导出拆分
      </button>
    </div>

    <div class="toolbar-spacer"></div>

    <!-- 图片变换控制 (仅在有激活图片时显示) -->
    <div v-if="activeImage" class="toolbar-group image-controls">
      <!-- 缩放控制 -->
      <div class="control-group">
        <label>缩放：</label>
        <input
          type="number"
          v-model.number="scaleInputValue"
          @focus="onScaleInputFocus"
          @blur="onScaleInputBlur"
          @keyup.enter="onScaleInputBlur"
          :min="10"
          :max="500"
          :step="1"
          class="value-input"
        />
        <span>%</span>
      </div>

      <!-- 旋转控制 -->
      <div class="control-group">
        <label>旋转：</label>
        <input
          type="number"
          v-model.number="rotationInputValue"
          @focus="onRotationInputFocus"
          @blur="onRotationInputBlur"
          @keyup.enter="onRotationInputBlur"
          :min="-360"
          :max="360"
          :step="1"
          class="value-input"
        />
        <span>°</span>
      </div>

      <!-- 重置按钮 -->
      <button @click="resetImageTransform" class="btn btn-small btn-warning">重置</button>
    </div>
  </div>
</template>

<script>
/**
 * 画布工具栏组件
 * 
 * 功能：
 * - 画布缩放控制
 * - 网格显示切换
 * - 图片变换控制（当有激活图片时）
 * - 显示当前变换状态
 */

import { ref, computed, watch } from 'vue'

export default {
  name: 'CanvasToolbar',
  props: {
    zoom: {
      type: Number,
      default: 1.0
    },
    activeImage: {
      type: Object,
      default: null
    },
    exportDisabled: {
      type: Boolean,
      default: false
    }
  },
  emits: [
    'zoom-in',
    'zoom-out', 
    'zoom-reset',
    'image-transform',
    'image-reset',
    'image-flip-horizontal',
    'export-all',
    'export-batch'
  ],
  /**
   * 连接画布工具栏的输入状态与图片变换事件。
   * 处理流程：
   * 1、初始化输入状态并定义图片变换操作
   * 2、监听激活图片与变换数据并同步显示
   * 3、向模板提供输入状态和操作方法
   */
  setup(props, { emit }) {
    // 1、初始化变换输入并定义输入提交规则。
    // 输入框值和编辑状态
    const scaleInputValue = ref(100)
    const rotationInputValue = ref(0)
    const isEditingScale = ref(false)
    const isEditingRotation = ref(false)
    /**
     * 获取图片类型的中文标签
     * 处理流程：
     * 1、按背景类型返回对应中文标签
     * @param {string} type - 图片类型
     * @returns {string} 中文标签
     */
    const getImageTypeLabel = (type) => {
      // 1、区分背景与人物图片。
      return type === 'background' ? '背景图片' : '人物图片'
    }

    /**
     * 获取当前图片的缩放值
     * 处理流程：
     * 1、未选中图片时返回默认缩放
     * 2、从背景或对应人物的变换数据读取缩放
     * @returns {number} 缩放值
     */
    const getImageScale = () => {
      // 1、处理没有激活图片的情况。
      if (!props.activeImage) return 1
      
      // 2、按图片类型读取变换数据。
      if (props.activeImage.type === 'background') {
        const transform = props.activeImage.layer.backgroundTransform || { scale: 1 }
        return transform.scale
      } else {
        // 对于人物图片，从characterImages数组中找到对应的character
        const characterImages = props.activeImage.layer.characterImages || []
        const character = characterImages.find(c => c.id === props.activeImage.characterId)
        const transform = character?.transform || { scale: 1 }
        return transform.scale
      }
    }

    /**
     * 获取当前图片的旋转角度
     * 处理流程：
     * 1、未选中图片时返回零度
     * 2、从背景或对应人物的变换数据读取角度
     * @returns {number} 旋转角度
     */
    const getImageRotation = () => {
      // 1、处理没有激活图片的情况。
      if (!props.activeImage) return 0
      
      // 2、按背景或人物类型读取当前旋转角度。
      if (props.activeImage.type === 'background') {
        const transform = props.activeImage.layer.backgroundTransform || { rotation: 0 }
        return transform.rotation
      } else {
        // 对于人物图片，从characterImages数组中找到对应的character
        const characterImages = props.activeImage.layer.characterImages || []
        const character = characterImages.find(c => c.id === props.activeImage.characterId)
        const transform = character?.transform || { rotation: 0 }
        return transform.rotation
      }
    }

    /**
     * 处理缩放输入框获得焦点
     * 处理流程：
     * 1、标记缩放输入正在编辑
     */
    const onScaleInputFocus = () => {
      // 1、暂停缩放输入的外部同步。
      isEditingScale.value = true
    }

    /**
     * 处理缩放输入框失去焦点
     * 处理流程：
     * 1、结束编辑并确认激活图片
     * 2、约束缩放范围并读取实际值
     * 3、提交有效变化或恢复当前显示值
     */
    const onScaleInputBlur = () => {
      // 1、结束编辑并确认存在目标图片。
      isEditingScale.value = false
      if (!props.activeImage) return
      
      // 2、确保值在有效范围内。
      const clampedValue = Math.max(10, Math.min(500, scaleInputValue.value || 100))
      const newScaleValue = clampedValue / 100
      
      // 获取当前实际缩放值
      const currentScale = getImageScale()
      
      // 3、只有当值真正改变时才发送变换事件。
      if (Math.abs(newScaleValue - currentScale) > 0.01) {
        scaleInputValue.value = clampedValue
        
        // 发送绝对缩放值
        emit('image-transform', {
          type: 'scale',
          value: newScaleValue,
          relative: false
        })
      } else {
        // 如果没有真正改变，恢复到当前实际值
        scaleInputValue.value = Math.round(currentScale * 100)
      }
    }

    /**
     * 处理旋转输入框获得焦点
     * 处理流程：
     * 1、标记旋转输入正在编辑
     */
    const onRotationInputFocus = () => {
      // 1、暂停旋转输入的外部同步。
      isEditingRotation.value = true
    }

    /**
     * 处理旋转输入框失去焦点
     * 处理流程：
     * 1、结束编辑并确认激活图片
     * 2、将输入角度规范到允许范围
     * 3、提交有效变化或恢复当前角度
     */
    const onRotationInputBlur = () => {
      // 1、结束编辑并确认存在目标图片。
      isEditingRotation.value = false
      if (!props.activeImage) return
      
      // 2、确保值在有效范围内。
      let clampedValue = rotationInputValue.value || 0
      // 将角度标准化到 -360 到 360 度范围内
      clampedValue = clampedValue % 360
      if (clampedValue < -360) clampedValue += 360
      if (clampedValue > 360) clampedValue -= 360
      
      // 获取当前实际旋转值
      const currentRotation = getImageRotation()
      
      // 3、只有当值真正改变时才发送变换事件。
      if (Math.abs(clampedValue - currentRotation) > 0.5) {
        rotationInputValue.value = clampedValue
        
        // 发送绝对旋转值
        emit('image-transform', {
          type: 'rotation',
          value: clampedValue,
          relative: false
        })
      } else {
        // 如果没有真正改变，恢复到当前实际值
        rotationInputValue.value = Math.round(currentRotation)
      }
    }

    /**
     * 重置图片变换
     * 处理流程：
     * 1、确认图片并恢复输入默认值
     * 2、通知父组件重置实际变换
     */
    const resetImageTransform = () => {
      // 1、确认目标图片并恢复输入框。
      if (!props.activeImage) return
      
      // 重置输入框值
      scaleInputValue.value = 100
      rotationInputValue.value = 0
      
      // 2、请求重置图片变换。
      emit('image-reset')
    }

    /**
     * 处理水平翻转
     * 处理流程：
     * 1、存在激活图片时发出水平翻转事件
     */
    const handleHorizontalFlip = () => {
      // 1、确认目标后请求水平翻转。
      if (!props.activeImage) return
      
      emit('image-flip-horizontal')
    }

    /**
     * 同步输入框值与实际变换值
     * 处理流程：
     * 1、没有激活图片时恢复未编辑的输入框
     * 2、读取图片实际缩放与旋转值
     * 3、仅更新未编辑且显示值发生变化的输入框
     */
    const syncInputValues = () => {
      // 1、没有目标图片时恢复默认显示值。
      if (!props.activeImage) {
        // 如果没有激活图片，重置输入框
        if (!isEditingScale.value) {
          scaleInputValue.value = 100
        }
        if (!isEditingRotation.value) {
          rotationInputValue.value = 0
        }
        return
      }

      // 2、获取当前实际值。
      const currentScale = getImageScale()
      const currentRotation = getImageRotation()

      // 3、只在用户没有在编辑时更新输入框值，并且只在值真正不同时更新。
      if (!isEditingScale.value) {
        const displayScale = Math.round(currentScale * 100)
        if (scaleInputValue.value !== displayScale) {
          scaleInputValue.value = displayScale
        }
      }
      
      if (!isEditingRotation.value) {
        const displayRotation = Math.round(currentRotation)
        if (rotationInputValue.value !== displayRotation) {
          rotationInputValue.value = displayRotation
        }
      }
    }

    // 2、监听激活图片变化及变换变化并同步输入框。
    watch(
      () => props.activeImage,
      () => {
        syncInputValues()
      },
      { immediate: true }
    )

    // 监听层级的变换属性变化（这样更直接且避免循环调用）
    watch(
      () => {
        if (!props.activeImage) return null
        
        if (props.activeImage.type === 'background') {
          return props.activeImage.layer.backgroundTransform
        } else {
          // 对于人物图片，监听整个characterImages数组以及特定character的transform
          const characterImages = props.activeImage.layer.characterImages || []
          const character = characterImages.find(c => c.id === props.activeImage.characterId)
          return character?.transform
        }
      },
      () => {
        // 延迟更新，避免在用户输入过程中干扰
        setTimeout(() => {
          if (!isEditingScale.value && !isEditingRotation.value) {
            syncInputValues()
          }
        }, 50)
      },
      { deep: true }
    )

    // 3、向模板提供输入状态和操作方法。
    return {
      // 数据
      scaleInputValue,
      rotationInputValue,
      
      // 方法
      getImageTypeLabel,
      getImageScale,
      getImageRotation,
      onScaleInputFocus,
      onScaleInputBlur,
      onRotationInputFocus,
      onRotationInputBlur,
      resetImageTransform,
      handleHorizontalFlip
    }
  }
}
</script>

<style scoped>
.canvas-toolbar {
  display: flex;
  align-items: center;
  padding: 0.5rem 1rem;
  background: var(--theme-background-accent);
  border-bottom: 1px solid var(--theme-border);
  gap: 1rem;
  flex-wrap: wrap;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.toolbar-spacer {
  flex: 1;
  min-width: 1rem;
}

.zoom-info {
  padding: 0.25rem 0.5rem;
  font-size: 0.9rem;
  color: var(--theme-foreground-muted);
  background: var(--theme-background);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  min-width: 50px;
  text-align: center;
}

.image-controls {
  background: var(--theme-background-card);
  padding: 0.5rem;
  border-radius: 6px;
  border: 1px solid var(--theme-border);
  gap: 1rem;
}

.control-label {
  font-weight: 600;
  color: var(--theme-foreground);
}

.control-group {
  display: flex;
  align-items: center;
  gap: 0.3rem;
}

.control-group label {
  font-size: 0.9rem;
  color: var(--theme-foreground-muted);
  min-width: 40px;
}

.value-display {
  min-width: 50px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--theme-foreground);
}

.value-input {
  width: 60px;
  padding: 0.2rem 0.4rem;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  text-align: center;
  font-size: 0.9rem;
  font-weight: 500;
  color: var(--theme-foreground);
  background: var(--theme-background);
  outline: none;
  transition: border-color 0.2s ease;
}

.value-input:focus {
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 2px rgba(102, 126, 234, 0.1);
}

.value-input:invalid {
  border-color: #ef4444;
}

/* Chrome, Safari, Edge, Opera - 移除数字输入框的箭头 */
.value-input::-webkit-outer-spin-button,
.value-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

/* Firefox - 移除数字输入框的箭头 */
.value-input[type=number] {
  appearance: textfield;
  -moz-appearance: textfield;
}

.btn {
  padding: 0.4rem 0.8rem;
  border: 1px solid var(--theme-border);
  border-radius: var(--border-radius-md);
  background: var(--theme-background);
  color: var(--theme-foreground);
  cursor: pointer;
  font-size: 0.875rem;
  transition: var(--transition-all);
}

.btn:hover {
  background: var(--theme-background-accent);
  border-color: var(--theme-primary);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-small {
  padding: 0.3rem 0.6rem;
  font-size: 0.8rem;
}

.btn-secondary {
  background: var(--theme-background-secondary);
}

.btn-primary {
  background-color: var(--theme-primary);
  border-color: var(--theme-primary);
  color: white;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-warning {
  background-color: #f59e0b;
  border-color: #f59e0b;
  color: white;
}

.btn-warning:hover {
  background-color: #d97706;
  border-color: #d97706;
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .canvas-toolbar {
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  
  .image-controls {
    flex-basis: 100%;
    justify-content: center;
  }
}

@media (max-width: 768px) {
  .canvas-toolbar {
    padding: 0.3rem 0.5rem;
  }
  
  .toolbar-group {
    gap: 0.3rem;
  }
  
  .control-group {
    gap: 0.2rem;
  }
  
  .control-group label {
    min-width: 35px;
    font-size: 0.8rem;
  }
  
  .value-display {
    min-width: 40px;
    font-size: 0.8rem;
  }
}
</style>
