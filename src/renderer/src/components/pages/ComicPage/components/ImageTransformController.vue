<script>
/**
 * 图片变换控制器组件
 * 
 * 功能：
 * - 管理图片的激活状态
 * - 处理图片变换操作（缩放、旋转、移动）
 * - 提供变换计算和边界检查
 * - 管理拖拽状态和交互逻辑
 */

import { ref, computed } from 'vue'
import { clamp } from '../utils/helpers.js'

export default {
  name: 'ImageTransformController',
  props: {
    layers: {
      type: Array,
      default: () => []
    },
    activeImage: {
      type: Object,
      default: null
    }
  },
  emits: ['layer-update', 'image-select', 'image-deselect'],
  /**
   * 管理图片选择、变换计算与拖拽操作。
   * 处理流程：
   * 1、初始化拖拽状态并派生当前图片变换
   * 2、定义图片操作、命中检测与键盘分发
   * 3、暴露控制接口供父组件调用
   */
  setup(props, { emit }) {
    // 1、初始化拖拽快照并读取当前图片变换。
    // 拖拽状态
    const isDragging = ref(false)
    const dragStart = ref({ x: 0, y: 0 })
    const initialTransform = ref(null)

    /**
     * 获取当前激活图片的变换信息
     */
    const currentTransform = computed(() => {
      if (!props.activeImage) return null
      
      if (props.activeImage.type === 'background') {
        // 背景图片的变换
        return props.activeImage.layer.backgroundTransform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      } else {
        // 人物图片的变换 - 从characterImages数组中找到对应的character
        const characterImages = props.activeImage.layer.characterImages || []
        const character = characterImages.find(c => c.id === props.activeImage.characterId)
        return character?.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      }
    })

    // 2、定义图片选择、变换和命中检测操作。
    /**
     * 激活图片
     * 处理流程：
     * 1、向父组件发送图片选择信息
     * @param {Object} imageInfo - 图片信息 { layer, type, imageSrc }
     */
    const activateImage = (imageInfo) => {
      // 1、通知父组件切换激活图片。
      emit('image-select', imageInfo)
    }

    /**
     * 取消激活图片
     * 处理流程：
     * 1、结束拖拽后发送取消选择事件
     */
    const deactivateImage = () => {
      // 1、释放拖拽状态后取消图片选择。
      stopDragging()
      emit('image-deselect')
    }

    /**
     * 开始拖拽
     * 处理流程：
     * 1、确认激活图片并保存起点与变换快照
     * @param {number} x - 起始x坐标
     * @param {number} y - 起始y坐标
     */
    const startDragging = (x, y) => {
      // 1、记录拖拽起点及后续位移计算基准。
      if (!props.activeImage) return
      
      isDragging.value = true
      dragStart.value = { x, y }
      initialTransform.value = { ...currentTransform.value }
    }

    /**
     * 更新拖拽
     * 处理流程：
     * 1、检查拖拽状态并计算相对起点的偏移
     * 2、合并初始变换并更新图层
     * @param {number} x - 当前x坐标
     * @param {number} y - 当前y坐标
     */
    const updateDragging = (x, y) => {
      // 1、仅在有效拖拽中计算位移。
      if (!isDragging.value || !props.activeImage || !initialTransform.value) return
      
      const deltaX = x - dragStart.value.x
      const deltaY = y - dragStart.value.y
      
      // 2、以起始快照为基准提交当前位置。
      const newTransform = {
        ...initialTransform.value,
        x: initialTransform.value.x + deltaX,
        y: initialTransform.value.y + deltaY
      }
      
      updateImageTransform(newTransform)
    }

    /**
     * 停止拖拽
     * 处理流程：
     * 1、清空拖拽标记、起点和变换快照
     */
    const stopDragging = () => {
      // 1、恢复空闲状态。
      isDragging.value = false
      dragStart.value = { x: 0, y: 0 }
      initialTransform.value = null
    }


    /**
     * 应用图片变换
     * 处理流程：
     * 1、确定目标图片并读取当前变换
     * 2、按操作类型计算相对或绝对变换
     * 3、更新背景或对应人物数据并发送图层更新
     * @param {Object} transformOptions - 变换选项
     * @param {string} transformOptions.type - 变换类型 (scale/rotation/position)
     * @param {number|Object} transformOptions.value - 变换值
     * @param {boolean} transformOptions.relative - 是否为相对变换
     * @param {Object} transformOptions.target - 目标图片（用于拖拽时指定特定图片）
     */
    const applyTransform = (transformOptions) => {
      // 1、优先使用明确传入的目标图片。
      const { type, value, relative = false, target } = transformOptions
      
      // 确定要操作的图片：优先使用目标图片，否则使用当前激活图片
      const targetImage = target || props.activeImage
      
      if (!targetImage) return
      
      // 获取当前变换信息
      let current
      if (targetImage.type === 'background') {
        current = targetImage.layer.backgroundTransform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      } else {
        // 对于人物，从characterImages中找到对应的character
        const characterImages = targetImage.layer.characterImages || []
        const character = characterImages.find(c => c.id === targetImage.characterId)
        current = character?.transform || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      }
      
      let newTransform = { ...current }
      
      // 2、将缩放、旋转、位置或翻转操作合并到变换副本。
      switch (type) {
        case 'scale':
          if (relative) {
            newTransform.scale = clamp(current.scale * value, 0.1, 5.0)
          } else {
            newTransform.scale = clamp(value, 0.1, 5.0)
          }
          break
          
        case 'rotation':
          if (relative) {
            newTransform.rotation = (current.rotation + value) % 360
          } else {
            // 对于绝对值，直接设置旋转角度
            newTransform.rotation = value
          }
          break
          
        case 'position':
          if (relative) {
            newTransform.x = current.x + (value.x || 0)
            newTransform.y = current.y + (value.y || 0)
          } else {
            newTransform.x = value.x !== undefined ? value.x : current.x
            newTransform.y = value.y !== undefined ? value.y : current.y
          }
          break
          
        case 'flip':
          if (value === 'horizontal') {
            newTransform.flipHorizontal = !current.flipHorizontal
          }
          break
      }
      
      // 3、更新对应的图层并通知父组件。
      let updatedLayer
      if (targetImage.type === 'background') {
        updatedLayer = {
          ...targetImage.layer,
          backgroundTransform: newTransform
        }
      } else {
        // 更新characterImages数组中对应的character
        const characterImages = [...(targetImage.layer.characterImages || [])]
        const characterIndex = characterImages.findIndex(c => c.id === targetImage.characterId)
        if (characterIndex !== -1) {
          characterImages[characterIndex] = {
            ...characterImages[characterIndex],
            transform: newTransform
          }
          updatedLayer = {
            ...targetImage.layer,
            characterImages: characterImages
          }
        } else {
          return // 找不到对应的character，不做更新
        }
      }
      
      emit('layer-update', updatedLayer)
    }

    /**
     * 重置图片变换
     * 处理流程：
     * 1、确认激活图片并写回默认变换
     */
    const resetTransform = () => {
      // 1、恢复位移、缩放、旋转及翻转的默认值。
      if (!props.activeImage) return
      
      const defaultTransform = { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      updateImageTransform(defaultTransform)
    }

    /**
     * 更新图片变换到图层
     * 处理流程：
     * 1、确认激活图片并替换背景或人物的变换数据
     * 2、发送更新后的图层
     * @param {Object} newTransform - 新的变换信息
     */
    const updateImageTransform = (newTransform) => {
      // 1、构造目标图片所在图层的新数据。
      if (!props.activeImage) return
      
      let updatedLayer
      if (props.activeImage.type === 'background') {
        updatedLayer = {
          ...props.activeImage.layer,
          backgroundTransform: newTransform
        }
      } else {
        // 更新characterImages数组中对应的character
        const characterImages = [...(props.activeImage.layer.characterImages || [])]
        const characterIndex = characterImages.findIndex(c => c.id === props.activeImage.characterId)
        if (characterIndex !== -1) {
          characterImages[characterIndex] = {
            ...characterImages[characterIndex],
            transform: newTransform
          }
          updatedLayer = {
            ...props.activeImage.layer,
            characterImages: characterImages
          }
        } else {
          return // 找不到对应的character，不做更新
        }
      }
      
      // 2、提交图层更新。
      emit('layer-update', updatedLayer)
    }

    /**
     * 检查点是否在图片范围内
     * 处理流程：
     * 1、确认多边形并计算变换后的图片中心
     * 2、按缩放后的近似半径判断点到中心的距离
     * @param {number} x - x坐标
     * @param {number} y - y坐标
     * @param {Object} layer - 图层对象
     * @param {string} imageType - 图片类型
     * @returns {boolean} 是否在范围内
     */
    const isPointInImage = (x, y, layer, imageType) => {
      // 1、以视角边界和图片位移确定检测中心。
      if (!layer.polygon) return false
      
      // 计算多边形边界框
      const bounds = calculatePolygonBounds(layer.polygon)
      const transformKey = imageType === 'background' ? 'backgroundTransform' : 'characterTransform'
      const transform = layer[transformKey] || { x: 0, y: 0, scale: 1, rotation: 0, flipHorizontal: false }
      
      // 计算图片中心
      const centerX = bounds.centerX + transform.x
      const centerY = bounds.centerY + transform.y
      
      // 2、简化的点击检测：使用中心距离近似判断图片范围。
      const maxDistance = Math.min(bounds.width, bounds.height) / 2 * transform.scale
      const distance = Math.sqrt((x - centerX) ** 2 + (y - centerY) ** 2)
      
      return distance <= maxDistance
    }

    /**
     * 计算多边形边界框
     * 处理流程：
     * 1、遍历顶点取得横纵坐标极值
     * 2、返回边界尺寸和中心位置
     * @param {Array} polygon - 多边形顶点数组
     * @returns {Object} 边界框信息
     */
    const calculatePolygonBounds = (polygon) => {
      // 1、统计所有顶点的坐标边界。
      let minX = Infinity, minY = Infinity
      let maxX = -Infinity, maxY = -Infinity
      
      for (const point of polygon) {
        minX = Math.min(minX, point.x)
        minY = Math.min(minY, point.y)
        maxX = Math.max(maxX, point.x)
        maxY = Math.max(maxY, point.y)
      }
      
      // 2、根据边界计算尺寸及中心。
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY,
        centerX: (minX + maxX) / 2,
        centerY: (minY + maxY) / 2
      }
    }

    /**
     * 获取图片在指定位置的信息
     * 处理流程：
     * 1、从顶层向下遍历可见图层
     * 2、优先检测人物，再检测背景并返回首个命中项
     * 3、未命中任何图片时返回空值
     * @param {number} x - x坐标
     * @param {number} y - y坐标
     * @returns {Object|null} 图片信息
     */
    const getImageAtPosition = (x, y) => {
      // 1、从上到下遍历图层。
      for (let i = props.layers.length - 1; i >= 0; i--) {
        const layer = props.layers[i]
        if (!layer.visible || !layer.polygon) continue
        
        // 2、检查所有人物图片（从后往前，后添加的在上层），随后检查背景。
        if (layer.characterImages && layer.characterImages.length > 0) {
          for (let j = layer.characterImages.length - 1; j >= 0; j--) {
            const character = layer.characterImages[j]
            // 这里需要更复杂的点击检测，暂时简化为检查是否在图层内
            if (isPointInImage(x, y, layer, 'character')) {
              return { 
                layer, 
                type: 'character', 
                imageSrc: character.imageSrc,
                characterId: character.id,
                characterIndex: j
              }
            }
          }
        }
        
        // 检查背景图片
        if (layer.backgroundImage && isPointInImage(x, y, layer, 'background')) {
          return { layer, type: 'background', imageSrc: layer.backgroundImage }
        }
      }
      
      // 3、没有图片通过近似范围检测。
      return null
    }

    /**
     * 处理键盘快捷键
     * 处理流程：
     * 1、确认激活图片并按规范化键值分派变换操作
     * @param {KeyboardEvent} event - 键盘事件
     */
    const handleKeyboard = (event) => {
      // 1、将匹配的按键分派为缩放、旋转、选择或重置操作。
      if (!props.activeImage) return
      
      switch (event.key.toLowerCase()) {
        case '=':
        case '+':
          event.preventDefault()
          applyTransform({ type: 'scale', value: 1.02, relative: true })
          break
        case '-':
          event.preventDefault()
          applyTransform({ type: 'scale', value: 0.98, relative: true })
          break
        case '[':
          event.preventDefault()
          applyTransform({ type: 'rotation', value: -2, relative: true })
          break
        case ']':
          event.preventDefault()
          applyTransform({ type: 'rotation', value: 2, relative: true })
          break
        case 'Escape':
          event.preventDefault()
          deactivateImage()
          break
        case 'r':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault()
            resetTransform()
          }
          break
      }
    }

    // 3、向父组件提供状态和图片控制接口。
    return {
      // 状态
      isDragging,
      currentTransform,
      
      // 方法
      activateImage,
      deactivateImage,
      startDragging,
      updateDragging,
      stopDragging,
      applyTransform,
      resetTransform,
      getImageAtPosition,
      handleKeyboard,
      isPointInImage,
      calculatePolygonBounds
    }
  },
  /**
   * 保持控制器为无界面的逻辑组件。
   * 处理流程：
   * 1、返回空渲染结果
   */
  render() {
    // 1、这是一个逻辑组件，不渲染任何内容。
    return null
  }
}
</script>
