<template>
  <div 
    class="comic-page"
    @dragover.prevent="handlePageDragOver"
    @dragenter.prevent="handlePageDragEnter"
    @dragleave.prevent="handlePageDragLeave"
    @drop.prevent="handlePageDrop"
    :class="{ 'page-drag-over': isPageDragOver }"
  >
    <!-- 全局拖拽提示遮罩 -->
    <div v-if="isPageDragOver" class="drag-overlay">
      <div class="drag-hint">
        <svg class="drag-icon" viewBox="0 0 24 24" fill="none">
          <path d="M12 5L12 19M12 5L8 9M12 5L16 9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span class="drag-text">{{ dragHintText }}</span>
      </div>
    </div>
    
    <!-- 主工具区域 -->
    <div class="page-content">
      <div class="main-layout">
        <!-- 左侧栏：模板选择和图层管理 -->
        <aside class="left-sidebar" ref="leftSidebarEl">
          <TemplatePanel 
            :templates="templates"
            :activeTemplate="activeTemplate"
            @template-select="handleTemplateSelect"
          />
          <LayerImageManager 
            :layers="layers"
            :activeLayer="activeLayer"
            :activeImage="activeImage"
            @layer-select="handleLayerSelect"
            @background-upload="handleBackgroundUpload"
            @character-upload="handleCharacterUpload"
            @image-activate="handleImageActivate"
          />
        </aside>
        
        <!-- 右侧：画布区域 -->
        <div class="main-workspace" ref="mainWorkspaceEl">
          <CanvasEditor 
            ref="canvasEditor"
            :template="activeTemplate"
            :layers="layers"
            :activeLayer="activeLayer"
            :activeImage="activeImage"
            @layer-update="handleLayerUpdate"
            @layer-select="handleLayerSelect"
            @image-activate="handleImageActivate"
            @export-all="handleExportAll"
            @export-batch="handleExportBatch"
          />
        </div>
      </div>
    </div>
    
    <!-- 提示信息 -->
    <ToastNotification 
      v-if="toast.show"
      :type="toast.type"
      :message="toast.message"
      @close="hideToast"
    />
  </div>
</template>

<script>
/** 漫画排版页面：组织视角模板、图片导入、画布编辑及文件导出。 */
import { ref, reactive, computed, onMounted, onActivated } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NButton, useMessage } from 'naive-ui'
import TemplatePanel from './components/TemplatePanel.vue'
import LayerImageManager from './components/LayerImageManager.vue'
import CanvasEditor from './components/CanvasEditor.vue'
import ToastNotification from './components/ToastNotification.vue'
import { COMIC_TEMPLATES } from './utils/templates.js'
import { generateUniqueId } from './utils/helpers.js'
import './ComicPage.css'

export default {
  name: 'ComicPage',
  components: {
    TemplatePanel,
    LayerImageManager,
    CanvasEditor,
    ToastNotification,
    NButton
  },
  /**
   * 建立漫画编辑页面状态与交互入口。
   * 处理流程：
   * 1、初始化窗口控制、排版、图层和拖放状态
   * 2、定义素材分配、图片编辑和导出操作
   * 3、初始化默认排版并接收页面跳转携带的图片
   */
  setup() {
    // 1、初始化窗口接口及页面共享状态。
    const router = useRouter()
    const message = useMessage()

    // 窗口控制状态
    const isAlwaysOnTop = ref(false)
    const windowMode = ref('software') // 'software' 或 'plugin'

    /**
     * 切换窗口置顶状态
     * 处理流程：
     * 1、调用桌面接口设置相反的置顶状态
     * 2、依据结果同步状态并提示成功或失败
     */
    const toggleAlwaysOnTop = async () => {
      // 1、请求桌面窗口切换置顶状态。
      try {
        const newState = !isAlwaysOnTop.value
        const result = await window.electronAPI?.windowSetAlwaysOnTop(newState)
        
        // 2、仅在主进程确认成功后更新界面状态。
        if (result && result.success) {
          isAlwaysOnTop.value = newState
          message.success(newState ? '窗口已置顶' : '已取消置顶')
        } else {
          message.error('设置窗口置顶失败')
        }
      } catch (error) {
        console.error('切换窗口置顶失败:', error)
        message.error('切换窗口置顶失败: ' + error.message)
      }
    }

    /**
     * 切换窗口模式（软件模式/插件模式）
     * 处理流程：
     * 1、计算目标模式并请求主进程切换
     * 2、按调用结果更新状态或报告错误
     */
    const toggleWindowMode = async () => {
      // 1、请求在软件模式和插件模式之间切换。
      try {
        const newMode = windowMode.value === 'software' ? 'plugin' : 'software'
        const result = await window.electronAPI?.windowSetMode(newMode)
        
        // 2、同步已生效的窗口模式。
        if (result && result.success) {
          windowMode.value = newMode
          message.success(newMode === 'plugin' ? '已切换到插件模式' : '已切换到软件模式')
        } else {
          message.error('切换窗口模式失败')
        }
      } catch (error) {
        console.error('切换窗口模式失败:', error)
        message.error('切换窗口模式失败: ' + error.message)
      }
    }

    /**
     * 获取当前窗口置顶状态
     * 处理流程：
     * 1、读取主进程窗口状态并在成功时同步界面
     */
    const getAlwaysOnTopState = async () => {
      // 1、恢复窗口实际置顶状态，读取失败只记录日志。
      try {
        const result = await window.electronAPI?.windowGetAlwaysOnTop()
        if (result && result.success) {
          isAlwaysOnTop.value = result.alwaysOnTop
        }
      } catch (error) {
        console.error('获取窗口置顶状态失败:', error)
      }
    }
    // 响应式数据
    const templates = ref(COMIC_TEMPLATES)
    const activeTemplate = ref(null)
    const layers = ref([])
    const activeLayer = ref(null)
    const activeImage = ref(null)
    const canvasEditor = ref(null)
    const leftSidebarEl = ref(null)
    const mainWorkspaceEl = ref(null)
    // 移除导出路径配置，改为每次手动选择
    
    // 隐藏图片池 - 存储切换模板时暂时无法显示的图片
    const hiddenImagePool = ref([])
    
    // 图层数据存储 - 用于切换模板时保留图片信息
    const savedLayersData = ref([])
    
    // 全局拖拽状态
    const isPageDragOver = ref(false)
    const dragCounter = ref(0) // 用于跟踪 dragenter/dragleave 事件
    
    // 追踪最后激活的区域 ('sidebar': 视角管理区, 'canvas': 画布区)
    const activeRegion = ref('sidebar')
    
    // 提示信息状态
    const toast = reactive({
      show: false,
      type: 'success',
      message: ''
    })

    /**
     * 显示提示信息
     * 处理流程：
     * 1、更新提示类型、正文与可见状态
     * 2、安排三秒后自动隐藏
     * @param {string} type - 提示类型 (success, error, warning)
     * @param {string} message - 提示内容
     */
    const showToast = (type, message) => {
      // 1、写入本次提示内容并显示。
      toast.type = type
      toast.message = message
      toast.show = true
      
      // 2、三秒后自动隐藏。
      setTimeout(() => {
        toast.show = false
      }, 3000)
    }

    /**
     * 隐藏提示信息
     * 处理流程：
     * 1、关闭当前提示
     */
    const hideToast = () => {
      // 1、恢复提示不可见状态。
      toast.show = false
    }

    /**
     * 收集当前所有图层中的图片信息（按区域分组）
     * 处理流程：
     * 1、按视角保存背景、人物及变换副本
     * 2、返回供模板切换恢复使用的区域数据
     * @returns {Array} 包含所有区域数据的数组
     */
    const collectAllLayersData = () => {
      // 1、收集当前区域的素材及独立变换快照。
      const layersData = []
      
      // 遍历当前所有图层，按区域保存完整数据
      layers.value.forEach((layer, layerIndex) => {
        const layerData = {
          originalLayerIndex: layerIndex,
          originalLayerName: layer.name,
          backgroundImage: layer.backgroundImage || null,
          backgroundTransform: layer.backgroundTransform ? { ...layer.backgroundTransform } : null,
          characterImages: []
        }
        
        // 收集所有人物图片
        if (layer.characterImages && Array.isArray(layer.characterImages)) {
          layer.characterImages.forEach((character) => {
            layerData.characterImages.push({
              id: character.id,
              imageSrc: character.imageSrc,
              transform: character.transform ? { ...character.transform } : {
                x: 0,
                y: 0,
                scale: 1,
                rotation: 0,
                flipHorizontal: false
              }
            })
          })
        }
        
        layersData.push(layerData)
      })
      
      // 2、返回全部区域快照。
      console.log('[ComicPage] 收集到的区域数据:', layersData.length, '个区域')
      return layersData
    }
    
    /**
     * 将区域数据重新分配到新的图层中（按区域整体分配）
     * 处理流程：
     * 1、确认旧数据并计算可分配区域数
     * 2、按区域顺序复制背景、人物及变换
     * 3、将超出新模板容量的区域保存到隐藏池
     * @param {Array} newLayers - 新创建的图层数组
     * @param {Array} oldLayersData - 旧的区域数据数组
     */
    const redistributeLayersData = (newLayers, oldLayersData) => {
      // 1、检查旧区域数据并计算新旧容量。
      if (!oldLayersData || oldLayersData.length === 0) {
        console.log('[ComicPage] 没有需要分配的区域数据')
        return
      }
      
      const newLayerCount = newLayers.length
      const oldLayerCount = oldLayersData.length
      
      console.log(`[ComicPage] 开始重新分配区域数据: ${oldLayerCount} 个旧区域 → ${newLayerCount} 个新区域`)
      
      // 按区域顺序分配：前N个区域的数据完整复制到新区域
      const layersToAssign = Math.min(newLayerCount, oldLayerCount)
      
      // 2、分配可以显示的区域。
      for (let i = 0; i < layersToAssign; i++) {
        const newLayer = newLayers[i]
        const oldLayerData = oldLayersData[i]
        
        // 复制背景图片
        if (oldLayerData.backgroundImage) {
          newLayer.backgroundImage = oldLayerData.backgroundImage
          newLayer.backgroundTransform = oldLayerData.backgroundTransform ? 
            { ...oldLayerData.backgroundTransform } : null
          console.log(`[ComicPage] 分配背景到区域 ${i + 1}: ${newLayer.name}`)
        }
        
        // 复制所有人物图片
        if (oldLayerData.characterImages && oldLayerData.characterImages.length > 0) {
          newLayer.characterImages = oldLayerData.characterImages.map(char => ({
            id: char.id,
            imageSrc: char.imageSrc,
            transform: { ...char.transform }
          }))
          console.log(`[ComicPage] 分配 ${newLayer.characterImages.length} 个人物到区域 ${i + 1}: ${newLayer.name}`)
        }
      }
      
      // 3、处理多余的区域（存入隐藏池）。
      if (oldLayerCount > newLayerCount) {
        // 将超出的区域数据存入隐藏池
        const hiddenLayers = oldLayersData.slice(newLayerCount)
        hiddenImagePool.value = hiddenLayers
        
        const hiddenImageCount = hiddenLayers.reduce((count, layer) => {
          let total = layer.backgroundImage ? 1 : 0
          total += layer.characterImages ? layer.characterImages.length : 0
          return count + total
        }, 0)
        
        console.log(`[ComicPage] 有 ${hiddenLayers.length} 个区域（共 ${hiddenImageCount} 张图片）被存入隐藏池`)
      } else {
        // 新区域数量 >= 旧区域数量，清空隐藏池
        hiddenImagePool.value = []
        console.log('[ComicPage] 所有区域数据都已分配完毕')
      }
    }
    
    /**
     * 处理模板选择
     * 处理流程：
     * 1、收集当前区域及隐藏池的数据
     * 2、更新活动模板
     * 3、创建新模板的图层结构
     * 4、重新分配已有素材
     * 5、更新图层列表和活动图层
     * 6、安排画布重新绘制
     * @param {Object} template - 选中的模板
     */
    const handleTemplateSelect = (template) => {
      // 1、收集当前所有区域数据（如果存在图层）。
      let allLayersData = []
      if (layers.value.length > 0) {
        allLayersData = collectAllLayersData()
        
        // 合并隐藏池中的区域数据
        if (hiddenImagePool.value.length > 0) {
          console.log(`[ComicPage] 从隐藏池中恢复 ${hiddenImagePool.value.length} 个区域`)
          allLayersData = allLayersData.concat(hiddenImagePool.value)
        }
      }
      
      // 2、更新活动模板。
      activeTemplate.value = template
      
      // 3、根据模板创建新的图层结构。
      const newLayers = template.variants.map((variant, index) => ({
        id: generateUniqueId(),
        name: variant.name,
        type: 'polygon',
        visible: true,
        polygon: variant.points,
        backgroundImage: null,
        characterImages: [], // 修改为数组，支持多个人物
        transform: {
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0
        }
      }))
      
      // 4、将收集的区域数据重新分配到新图层。
      if (allLayersData.length > 0) {
        redistributeLayersData(newLayers, allLayersData)
        
        // 计算总图片数量用于提示
        const totalImages = allLayersData.reduce((count, layer) => {
          let total = layer.backgroundImage ? 1 : 0
          total += layer.characterImages ? layer.characterImages.length : 0
          return count + total
        }, 0)
        
        showToast('success', `已切换到"${template.name}"排版，保留了 ${allLayersData.length} 个区域的内容`)
      } else {
        showToast('success', `已切换到"${template.name}"排版`)
      }
      
      // 5、更新图层数据。
      layers.value = newLayers
      activeLayer.value = newLayers[0] || null
      
      // 6、强制重新渲染画布。
      if (canvasEditor.value?.render) {
        setTimeout(() => {
          canvasEditor.value.render()
        }, 100)
      }
    }

    /**
     * 处理背景图片上传
     * 处理流程：
     * 1、确认活动图层并读取图片文件
     * 2、替换背景并初始化缺失的变换数据
     * 3、重新绘制、激活图片并提示结果
     * @param {File} file - 上传的图片文件
     */
    const handleBackgroundUpload = (file) => {
      // 1、确认导入目标后使用文件读取器加载图片。
      if (!activeLayer.value) {
        showToast('warning', '请先选择一个图层')
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        // 2、清除旧图片缓存，替换背景并补齐变换数据。
        if (activeLayer.value.backgroundImage && canvasEditor.value?.clearImageCache) {
          canvasEditor.value.clearImageCache(activeLayer.value.backgroundImage)
        }
        
        activeLayer.value.backgroundImage = e.target.result
        
        // 初始化背景图片的变换属性（如果不存在）
        if (!activeLayer.value.backgroundTransform) {
          activeLayer.value.backgroundTransform = {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            flipHorizontal: false
          }
        }
        
        // 3、强制重新渲染画布并自动激活新背景。
        if (canvasEditor.value?.render) {
          setTimeout(() => {
            canvasEditor.value.render()
          }, 100)
        }
        
        // 自动激活刚上传的背景图片
        setTimeout(() => {
          handleImageActivate({
            layer: activeLayer.value,
            type: 'background',
            imageSrc: e.target.result
          }, 'sidebar')
        }, 150)
        
        showToast('success', '背景图片上传成功')
      }
      reader.onerror = (error) => {
        console.error('文件读取失败:', error)
        showToast('error', '文件读取失败，请重试')
      }
      reader.readAsDataURL(file)
    }

    /**
     * 处理人物图片上传
     * 处理流程：
     * 1、确认活动图层并读取图片文件
     * 2、创建带唯一编号与默认变换的人物并加入图层
     * 3、重新绘制、激活人物并提示结果
     * @param {File} file - 上传的图片文件
     */
    const handleCharacterUpload = (file) => {
      // 1、确认导入目标并读取图片内容。
      if (!activeLayer.value) {
        showToast('warning', '请先选择一个图层')
        return
      }

      const reader = new FileReader()
      reader.onload = (e) => {
        // 2、确保人物数组存在并创建新的角色数据。
        if (!activeLayer.value.characterImages) {
          activeLayer.value.characterImages = []
        }
        
        // 创建新的人物对象
        const newCharacter = {
          id: generateUniqueId(),
          imageSrc: e.target.result,
          transform: {
            x: 0,
            y: 0,
            scale: 1,
            rotation: 0,
            flipHorizontal: false
          }
        }
        
        // 添加到人物数组
        activeLayer.value.characterImages.push(newCharacter)
        
        // 3、强制重新渲染画布并激活新角色。
        if (canvasEditor.value?.render) {
          setTimeout(() => {
            canvasEditor.value.render()
          }, 100)
        }
        
        // 自动激活刚上传的人物图片
        setTimeout(() => {
          handleImageActivate({
            layer: activeLayer.value,
            type: 'character',
            imageSrc: newCharacter.imageSrc,
            characterId: newCharacter.id,
            characterIndex: activeLayer.value.characterImages.length - 1
          }, 'sidebar')
        }, 150)
        
        showToast('success', '人物图片上传成功')
      }
      reader.onerror = (error) => {
        console.error('文件读取失败:', error)
        showToast('error', '文件读取失败，请重试')
      }
      reader.readAsDataURL(file)
    }

    /**
     * 处理图层选择
     * 处理流程：
     * 1、设置活动图层
     * 2、优先激活首个人物，其次背景，无图片时清空选择
     * @param {Object} layer - 选中的图层
     */
    const handleLayerSelect = (layer) => {
      // 1、切换当前操作的图层。
      activeLayer.value = layer
      
      // 2、切换图层时，如果该图层有图片，自动激活人物图片（优先）或背景图片。
      if (layer.characterImages && layer.characterImages.length > 0) {
        // 延迟激活，确保图层切换完成
        // 默认激活第一个人物
        const firstCharacter = layer.characterImages[0]
        setTimeout(() => {
          handleImageActivate({
            layer: layer,
            type: 'character',
            imageSrc: firstCharacter.imageSrc,
            characterId: firstCharacter.id,
            characterIndex: 0
          }, 'sidebar')
        }, 50)
      } else if (layer.backgroundImage) {
        // 如果没有人物图片但有背景图片，激活背景图片
        setTimeout(() => {
          handleImageActivate({
            layer: layer,
            type: 'background',
            imageSrc: layer.backgroundImage
          }, 'sidebar')
        }, 50)
      } else {
        // 如果都没有，取消激活
        handleImageActivate(null, 'sidebar')
      }
    }



    /**
     * 处理图层更新
     * 处理流程：
     * 1、按编号合并图层更新
     * 2、同步活动图层及激活图片中的图层引用
     * @param {Object} updatedLayer - 更新后的图层数据
     */
    const handleLayerUpdate = (updatedLayer) => {
      // 1、定位图层并合并变更。
      const index = layers.value.findIndex(l => l.id === updatedLayer.id)
      if (index > -1) {
        layers.value[index] = { ...layers.value[index], ...updatedLayer }
        
        // 2、如果当前激活图层就是被更新的图层，确保引用同步。
        if (activeLayer.value && activeLayer.value.id === updatedLayer.id) {
          activeLayer.value = layers.value[index]
        }
        
        // 如果更新的图层是当前激活图片所在的图层，也要更新activeImage
        if (activeImage.value && activeImage.value.layer.id === updatedLayer.id) {
          activeImage.value = {
            ...activeImage.value,
            layer: layers.value[index]
          }
        }
      }
    }

    /**
     * 选择导出文件夹
     * 处理流程：
     * 1、调用桌面目录选择接口
     * 2、返回有效路径，取消时返回空值，失败时提示错误
     */
    const selectExportFolder = async () => {
      // 1、通过桌面桥接选择导出目录。
      try {
        // 使用Electron的IPC调用主进程的目录选择对话框
        if (window.fileSystem && window.fileSystem.selectFolder) {
          const result = await window.fileSystem.selectFolder()
          
          // 2、区分有效目录、主动取消和选择失败。
          if (result && result.success && result.path) {
            return {
              path: result.path
            }
          } else if (result && result.canceled) {
            console.log('用户取消了文件夹选择')
            return null
          } else {
            throw new Error(result.error || '文件夹选择失败')
          }
        } else {
          // 降级方案：提示用户
          showToast('error', '文件夹选择功能不可用，请确认您在Electron环境中运行此应用。')
          return null
        }
      } catch (error) {
        console.error('文件夹选择失败:', error)
        showToast('error', '文件夹选择失败: ' + error.message)
        return null
      }
    }

    /**
     * 打开文件夹
     * 处理流程：
     * 1、使用桌面接口打开指定目录并记录调用结果
     */
    const openExportFolder = async (folderPath) => {
      // 1、打开已导出的目录，失败时只记录日志。
      try {
        if (window.fileSystem && window.fileSystem.openFolder) {
          const result = await window.fileSystem.openFolder(folderPath)
          if (result && result.success) {
            console.log('已打开导出文件夹:', folderPath)
          } else {
            console.warn('打开文件夹失败:', result.error || '未知错误')
          }
        } else {
          console.warn('fileSystem API不可用，无法打开文件夹')
        }
      } catch (error) {
        console.error('打开文件夹失败:', error)
        // 不显示错误提示，避免影响用户体验
      }
    }

    /**
     * 处理图片激活
     * 处理流程：
     * 1、补齐目标背景或人物的变换数据
     * 2、记录交互来源并更新激活图片
     * @param {Object|null} imageInfo - 图片信息或null（取消激活）
     * @param {string} region - 激活来源区域 ('sidebar' 或 'canvas')
     */
    const handleImageActivate = (imageInfo, region = 'sidebar') => {
      // 1、确保待激活图片具有完整变换状态。
      if (imageInfo) {
        // 确保激活图片的变换属性已初始化
        if (imageInfo.type === 'background') {
          // 背景图片
          if (!imageInfo.layer.backgroundTransform) {
            imageInfo.layer.backgroundTransform = {
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              flipHorizontal: false
            }
          }
        } else {
          // 人物图片 - 确保character对象的transform已初始化
          const characterImages = imageInfo.layer.characterImages || []
          const character = characterImages.find(c => c.id === imageInfo.characterId)
          if (character && !character.transform) {
            character.transform = {
              x: 0,
              y: 0,
              scale: 1,
              rotation: 0,
              flipHorizontal: false
            }
          }
        }
        
        // 2、更新激活区域并保存当前图片选择。
        activeRegion.value = region
        
        // 调试日志
        console.log('[ComicPage] 激活区域切换:', region, '图片类型:', imageInfo.type, '图层:', imageInfo.layer.name)
        
        showToast('success', `已激活${imageInfo.type === 'background' ? '背景' : '人物'}图片`)
      }
      
      activeImage.value = imageInfo
    }

    /**
     * 处理整体导出
     * 处理流程：
     * 1、确认画布编辑器并选择目录
     * 2、导出完整视角后打开目录，失败时提示错误
     */
    const handleExportAll = async () => {
      // 1、检查编辑器并取得导出位置。
      if (!canvasEditor.value) {
        showToast('error', '画布编辑器未初始化')
        return
      }

      try {
        // 选择导出文件夹
        const folderResult = await selectExportFolder()
        if (!folderResult) return
        
        // 2、等待整体导出完成后展示结果目录。
        showToast('success', '正在导出整体视角...')
        await canvasEditor.value.exportAll(folderResult.path)
        showToast('success', '整体视角导出成功')
        
        // 导出成功后打开文件夹
        await openExportFolder(folderResult.path)
      } catch (error) {
        showToast('error', `导出失败：${error.message}`)
      }
    }

    /**
     * 处理单个图层导出
     * 处理流程：
     * 1、确认画布编辑器可用
     * 2、调用单层导出接口并报告结果
     * @param {Object} layer - 要导出的图层
     */
    const handleExportSingle = async (layer) => {
      // 1、确认画布编辑器已初始化。
      if (!canvasEditor.value) {
        showToast('error', '画布编辑器未初始化')
        return
      }

      // 2、委托编辑器导出目标图层并提示调用结果。
      try {
        showToast('success', `正在导出图层：${layer.name}...`)
        await canvasEditor.value.exportSingle(layer, exportPath.value)
        showToast('success', `图层 ${layer.name} 导出成功`)
      } catch (error) {
        showToast('error', `导出失败：${error.message}`)
      }
    }

    /**
     * 处理批量导出所有视角
     * 处理流程：
     * 1、检查可导出视角并选择目录
     * 2、顺序导出各视角
     * 3、提示完成并打开导出目录
     */
    const handleExportBatch = async () => {
      // 1、确认画布及视角列表后选择导出目录。
      if (!canvasEditor.value || layers.value.length === 0) {
        showToast('error', '无可导出的视角')
        return
      }

      try {
        // 选择导出文件夹
        const folderResult = await selectExportFolder()
        if (!folderResult) return
        
        showToast('success', `正在导出 ${layers.value.length} 个视角...`)
        
        // 2、导出每个视角。
        for (const layer of layers.value) {
          await canvasEditor.value.exportSingle(layer, folderResult.path)
        }
        
        // 3、展示完成提示并打开输出位置。
        showToast('success', `视角导出成功，共 ${layers.value.length} 个视角`)
        
        // 导出成功后打开文件夹
        await openExportFolder(folderResult.path)
      } catch (error) {
        showToast('error', `导出失败：${error.message}`)
      }
    }

    /**
     * 验证文件是否为图片
     * 处理流程：
     * 1、按支持的媒体类型检查文件
     * @param {File} file - 文件对象
     * @returns {boolean} 是否为图片
     */
    const validateImageFile = (file) => {
      // 1、仅接收声明为受支持图片格式的文件。
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
      return validTypes.includes(file.type)
    }

    /**
     * 查找下一个空白位置（按顺序遍历）
     * 首个视角没有背景时返回背景位置，否则返回可继续追加人物的位置。
     * 处理流程：
     * 1、检查首个可用视角的背景状态并返回导入类型
     * 2、没有图层时返回空值
     * @returns {Object|null} 返回 { layer, type } 或 null
     */
    const findNextEmptySlot = () => {
      // 1、优先补齐首个视角的背景，否则追加角色。
      for (const layer of layers.value) {
        // 先检查背景
        if (!layer.backgroundImage) {
          return { layer, type: 'background' }
        }
        // 检查是否还可以添加角色（始终可以添加更多角色）
        return { layer, type: 'character' }
      }
      // 2、没有可用图层。
      return null // 没有可用图层
    }

    /**
     * 计算拖拽提示文本
     */
    const dragHintText = computed(() => {
      if (!layers.value.length) {
        return '请先选择模板'
      }

      // 画布区域激活：若当前图层无背景则提示设置背景，否则提示追加人物
      if (activeRegion.value === 'canvas') {
        const targetLayer = activeLayer.value || layers.value[0]
        if (!targetLayer) return '请先选择模板'
        const layerName = targetLayer.name
        if (!targetLayer.backgroundImage) {
          return `将设置 ${layerName} 的背景`
        }
        return `将添加到 ${layerName} 的新角色`
      }

      // 视角管理区激活：优先显示选中图层的提示
      if (activeLayer.value) {
        const layerName = activeLayer.value.name
        if (!activeLayer.value.backgroundImage) {
          return `将设置 ${layerName} 的背景`
        }
        return `将添加到 ${layerName} 的新角色`
      }

      // 没有选中图层时，查找下一个空白位置
      const nextSlot = findNextEmptySlot()

      if (nextSlot) {
        const typeName = nextSlot.type === 'background' ? '背景' : '角色'
        return `将导入到 ${nextSlot.layer.name} 的${typeName}图片`
      }

      // 默认：将添加到第一个视角的人物
      return `将添加到 ${layers.value[0].name} 的角色`
    })

    /**
     * 处理全局拖拽进入
     * 处理流程：
     * 1、累计进入事件并在首次进入时显示拖拽提示
     */
    const handlePageDragEnter = (event) => {
      // 1、用计数器吸收子元素切换产生的重复进入事件。
      event.preventDefault()
      dragCounter.value++
      
      if (dragCounter.value === 1) {
        isPageDragOver.value = true
      }
    }

    /**
     * 处理全局拖拽悬停
     * 处理流程：
     * 1、允许投放并设置复制反馈
     */
    const handlePageDragOver = (event) => {
      // 1、保留图片文件的复制投放语义。
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    /**
     * 处理全局拖拽离开
     * 处理流程：
     * 1、减少进入计数并在完全离开页面时隐藏提示
     */
    const handlePageDragLeave = (event) => {
      // 1、仅在全部嵌套拖拽区域离开后取消高亮。
      event.preventDefault()
      dragCounter.value--
      
      if (dragCounter.value === 0) {
        isPageDragOver.value = false
      }
    }

    /**
     * 处理全局拖拽放置
     * 处理流程：
     * 1、清理拖拽状态并检查模板及图片文件
     * 2、按实际落点确定交互区域，未命中时采用激活区域
     * 3、优先向选中视角补背景或追加人物，再使用默认视角
     */
    const handlePageDrop = async (event) => {
      // 1、重置提示并确认有视角和有效图片可供导入。
      event.preventDefault()
      
      // 重置拖拽状态
      isPageDragOver.value = false
      dragCounter.value = 0
      
      try {
        // 检查是否有模板
        if (!layers.value.length) {
          showToast('warning', '请先选择一个模板')
          return
        }
        
        // 获取拖拽的文件
        const files = Array.from(event.dataTransfer.files)
        const imageFiles = files.filter(validateImageFile)
        
        if (imageFiles.length === 0) {
          showToast('warning', '请拖拽图片文件')
          return
        }
        
        const file = imageFiles[0]

        // 2、判断落点区域（以鼠标位置为准）。
        const { clientX, clientY } = event
        /**
         * 判断当前投放点是否位于目标元素内。
         * 处理流程：
         * 1、读取有效元素边界并比较鼠标坐标
         */
        const isInElement = (el) => {
          // 1、检查目标元素及投放点是否命中其矩形区域。
          if (!el) return false
          const rect = el.getBoundingClientRect()
          return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom
        }
        const dropInSidebar = isInElement(leftSidebarEl?.value)
        const dropInCanvas = isInElement(mainWorkspaceEl?.value)

        // 调试日志
        console.log('[ComicPage] 拖拽导入 - pointer:', clientX, clientY, 'inSidebar:', dropInSidebar, 'inCanvas:', dropInCanvas, 'activeRegion:', activeRegion.value)
        if (activeImage.value) {
          console.log('[ComicPage] 激活图片信息:', activeImage.value.type, activeImage.value.layer.name)
        }

        // 优先以落点区域为准；如果未命中任何区域，回退到激活区域
        const effectiveRegion = dropInCanvas ? 'canvas' : (dropInSidebar ? 'sidebar' : activeRegion.value)

        // 3、根据有效区域决定导入逻辑。
        if (effectiveRegion === 'canvas') {
          // 画布区域：若当前图层无背景先设置背景，否则追加人物
          const targetLayer = activeLayer.value || layers.value[0]
          if (!targetLayer) {
            showToast('warning', '没有可用视角，请先选择模板')
            return
          }
          // 确保图层被选中
          if (!activeLayer.value || activeLayer.value.id !== targetLayer.id) {
            handleLayerSelect(targetLayer)
          }
          if (!targetLayer.backgroundImage) {
            handleBackgroundUpload(file)
            showToast('success', `已设置 ${targetLayer.name} 的背景`)
          } else {
            handleCharacterUpload(file)
            showToast('success', `已添加到 ${targetLayer.name} 的新角色`)
          }
          return
        }

        // 视角管理区（sidebar）：优先使用当前选中的图层
        if (effectiveRegion === 'sidebar') {
          // 第一步：如果有选中的图层，始终导入到选中的图层
          if (activeLayer.value) {
            const targetLayer = activeLayer.value
            if (!targetLayer.backgroundImage) {
              handleBackgroundUpload(file)
              showToast('success', `已设置 ${targetLayer.name} 的背景`)
            } else {
              handleCharacterUpload(file)
              showToast('success', `已添加到 ${targetLayer.name} 的新角色`)
            }
            return
          }

          // 第二步：没有选中图层时，查找下一个空白位置
          const nextSlot = findNextEmptySlot()

          if (nextSlot) {
            // 找到空白位置，导入到该位置
            const { layer, type } = nextSlot

            // 选中目标图层
            handleLayerSelect(layer)

            // 根据类型上传
            const typeName = type === 'background' ? '背景' : '角色'
            if (type === 'background') {
              handleBackgroundUpload(file)
            } else {
              handleCharacterUpload(file)
            }

            showToast('success', `已导入到 ${layer.name} 的${typeName}图片`)
            return
          }

          // 第三步：没有空白位置时，向第1个区域追加人物
          const firstLayer = layers.value[0]
          if (firstLayer) {
            handleLayerSelect(firstLayer)
            if (!firstLayer.backgroundImage) {
              handleBackgroundUpload(file)
              showToast('success', `已设置 ${firstLayer.name} 的背景`)
            } else {
              handleCharacterUpload(file)
              showToast('success', `已添加到 ${firstLayer.name} 的新角色`)
            }
          }
          return
        }

        // 第四步：默认情况，向第1个区域追加人物
        const firstLayer = layers.value[0]
        if (firstLayer) {
          handleLayerSelect(firstLayer)
          if (!firstLayer.backgroundImage) {
            handleBackgroundUpload(file)
            showToast('success', `已设置 ${firstLayer.name} 的背景`)
          } else {
            handleCharacterUpload(file)
            showToast('success', `已添加到 ${firstLayer.name} 的新角色`)
          }
        }
        
      } catch (error) {
        console.error('全局拖拽导入失败:', error)
        showToast('error', `拖拽导入失败：${error.message}`)
      }
    }

    /**
     * 接收其他页面暂存的漫画导入图片。
     * 处理流程：
     * 1、读取并确认跳转目标为漫画页面
     * 2、消费暂存数据并等待图层初始化
     * 3、将图片数据转换为文件后作为人物导入
     */
    const processPendingJumpImage = async () => {
      // 1、读取跳转携带的待处理图片。
      const pendingImageData = sessionStorage.getItem('pendingImageForJump')
      if (!pendingImageData) {
        return
      }
      
      try {
        const imageData = JSON.parse(pendingImageData)
        
        if (imageData.targetPage === 'comic') {
          // 2、消费本次数据，等待默认图层准备完成。
          sessionStorage.removeItem('pendingImageForJump')
          
          setTimeout(async () => {
            if (!activeLayer.value && layers.value.length > 0) {
              activeLayer.value = layers.value[0]
            }
            
            if (activeLayer.value) {
              try {
                // 3、还原图片字节并复用人物上传流程。
                const base64Data = imageData.dataURL.split(',')[1]
                const mimeType = imageData.dataURL.match(/data:([^;]+);/)?.[1] || 'image/png'
                const byteCharacters = atob(base64Data)
                const byteNumbers = new Array(byteCharacters.length)
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i)
                }
                const byteArray = new Uint8Array(byteNumbers)
                const blob = new Blob([byteArray], { type: mimeType })
                const file = new File([blob], imageData.fileName, { type: mimeType })
                
                handleCharacterUpload(file)
                
                showToast('success', '已接收来自人物调整的图片')
              } catch (error) {
                showToast('error', '处理跳转图片失败: ' + error.message)
              }
            } else {
              showToast('warning', '请先选择一个模板和图层')
            }
          }, 500)
        }
      } catch (error) {
        // 静默处理错误
      }
    }

    // 3、组件挂载时选择默认模板，页面激活时接收跳转图片。
  onMounted(async () => {
    if (templates.value.length > 0) {
      handleTemplateSelect(templates.value[0])
    }
    
    await getAlwaysOnTopState()
    await processPendingJumpImage()
  })

  onActivated(async () => {
    await processPendingJumpImage()
  })

    // 路由离开前的处理（已移除自动取消置顶逻辑）
    onBeforeRouteLeave(async (to, from) => {
      return true
    })

    return {
      // 数据
      templates,
      activeTemplate,
      layers,
      activeLayer,
      activeImage,
      leftSidebarEl,
      mainWorkspaceEl,
      activeRegion,
      canvasEditor,
      toast,
      isAlwaysOnTop,
      windowMode,
      isPageDragOver,
      dragHintText,
      hiddenImagePool,
      
      // 方法
      toggleAlwaysOnTop,
      toggleWindowMode,
      handleTemplateSelect,
      handleBackgroundUpload,
      handleCharacterUpload,
      handleLayerSelect,
      handleLayerUpdate,
      selectExportFolder,
      openExportFolder,
      handleImageActivate,
      handleExportAll,
      handleExportSingle,
      handleExportBatch,
      showToast,
      hideToast,
      handlePageDragOver,
      handlePageDragEnter,
      handlePageDragLeave,
      handlePageDrop,
      collectAllLayersData,
      redistributeLayersData
    }
  }
}
</script>

<style scoped>
.comic-page {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--theme-background);
  position: relative;
}

/* ==================== 全局拖拽效果 ==================== */
.drag-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(79, 70, 229, 0.15);
  backdrop-filter: blur(4px);
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  animation: fadeInOverlay 0.2s ease-out;
}

.drag-hint {
  background: rgba(79, 70, 229, 0.95);
  color: white;
  padding: 32px 48px;
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  box-shadow: 0 12px 32px rgba(79, 70, 229, 0.4);
  animation: scaleInHint 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}

.drag-icon {
  width: 48px;
  height: 48px;
  stroke: white;
  stroke-width: 2;
  animation: bounceIcon 1s ease-in-out infinite;
}

.drag-text {
  font-size: 18px;
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}

.page-drag-over .toolbar,
.page-drag-over .main-layout {
  pointer-events: none;
}

@keyframes fadeInOverlay {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes scaleInHint {
  from {
    transform: scale(0.8);
    opacity: 0;
  }
  to {
    transform: scale(1);
    opacity: 1;
  }
}

@keyframes bounceIcon {
  0%, 100% {
    transform: translateY(0);
  }
  50% {
    transform: translateY(-8px);
  }
}

.page-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.main-layout {
  flex: 1;
  display: flex;
  gap: 20px;
  padding: 20px;
  overflow: hidden;
  min-height: 0; /* 确保flex容器能正确收缩 */
}

.left-sidebar {
  width: 320px;
  min-width: 320px;
  max-width: 320px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  overflow-y: auto;
  flex-shrink: 0;
}

.main-workspace {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--theme-background);
  border: 1px solid var(--theme-border);
  border-radius: 8px;
  min-width: 0; /* 确保可以收缩 */
  min-height: 500px; /* 确保最小高度 */
}

/* 滚动条样式 */
.left-sidebar::-webkit-scrollbar {
  width: 6px;
}

.left-sidebar::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 3px;
}

.left-sidebar::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 3px;
}

.left-sidebar::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

/* 响应式设计 */
@media (max-width: 1200px) {
  .left-sidebar {
    width: 280px;
    min-width: 280px;
    max-width: 280px;
  }
}

/* 只在宽度小于700px且高度小于500px的真正小屏设备上才切换到上下布局 */
@media (max-width: 700px) and (max-height: 500px) {
  .main-layout {
    flex-direction: column;
    gap: 16px;
  }
  
  .left-sidebar {
    width: 100%;
    min-width: auto;
    max-width: none;
    max-height: 250px;
    flex-direction: row;
    overflow-x: auto;
    overflow-y: hidden;
  }
  
  .main-workspace {
    order: -1;
    height: 50vh;
    min-height: 300px;
  }
}

/* 插件模式下的优化：保持左右布局，但调整尺寸 */
@media (max-width: 800px) {
  .left-sidebar {
    width: 240px;
    min-width: 240px;
    max-width: 240px;
  }
  
  .main-layout {
    padding: 16px;
    gap: 16px;
  }
}

@media (max-width: 600px) {
  .toolbar {
    padding: 10px 12px;
  }
  
  .toolbar-actions {
    flex-wrap: wrap;
    gap: 6px;
  }
  
  .main-layout {
    padding: 12px;
    gap: 12px;
  }
  
  /* 只有在非常小的屏幕上才恢复垂直布局 */
  .left-sidebar {
    width: 200px;
    min-width: 200px;
    max-width: 200px;
  }
}
</style>
