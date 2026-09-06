<template>
  <div 
    class="dialog-frame-page"
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
        <!-- 左侧栏：对话框和人物管理 -->
        <aside class="left-sidebar" ref="leftSidebarEl">
          <DialogFrameManager 
            :dialogFrame="dialogFrame"
            :characters="characters"
            :activeCharacter="activeCharacter"
            :activeObjectType="activeObjectType"
            @frame-upload="handleFrameUpload"
            @character-upload="handleCharacterUpload"
            @character-select="handleCharacterSelect"
            @character-delete="handleCharacterDelete"
            @frame-select="handleFrameSelect"
          />
        </aside>
        
        <!-- 右侧：画布区域 -->
        <div class="main-workspace" ref="mainWorkspaceEl">
          <DialogFrameCanvas 
            ref="dialogFrameCanvas"
            :dialogFrame="dialogFrame"
            :characters="characters"
            :activeCharacter="activeCharacter"
            :activeObjectType="activeObjectType"
            @frame-select="handleFrameSelect"
            @character-update="handleCharacterUpdate"
            @character-select="handleCharacterSelect"
            @frame-update="handleFrameUpdate"
            @export="handleExport"
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
/** 对话框人物合成页面：管理蒙版图片、人物素材、画布交互及导出。 */
import { ref, reactive, computed, onMounted, onActivated, nextTick } from 'vue'
import { useMessage } from 'naive-ui'
import DialogFrameManager from './components/DialogFrameManager.vue'
import DialogFrameCanvas from './components/DialogFrameCanvas.vue'
import ToastNotification from '../ComicPage/components/ToastNotification.vue'
import { generateUniqueId, processDialogFrameImage } from './utils/helpers.js'
import { sanitizeFileName } from '../ActionExpressionPage/utils/stringUtils.js'
import './DialogFramePage.css'

export default {
  name: 'DialogFramePage',
  components: {
    DialogFrameManager,
    DialogFrameCanvas,
    ToastNotification
  },
  /**
   * 初始化对话框合成页面及素材操作。
   * 处理流程：
   * 1、创建蒙版、人物、选择与拖拽状态
   * 2、定义素材导入、更新和导出操作
   * 3、在挂载及重新激活时接收跨页图片
   */
  setup() {
    // 1、创建画布所需的素材和交互状态。
    const message = useMessage()
    
    // 对话框图片（作为剪切蒙版）
    const dialogFrame = ref(null)
    
    // 人物图片列表
    const characters = ref([])
    
    // 当前激活的人物
    const activeCharacter = ref(null)
    
    // 当前激活的对象类型：'frame' 或 'character'
    const activeObjectType = ref('character')
    
    // 画布引用
    const dialogFrameCanvas = ref(null)
    const leftSidebarEl = ref(null)
    const mainWorkspaceEl = ref(null)
    
    // 全局拖拽状态
    const isPageDragOver = ref(false)
    const dragCounter = ref(0)
    
    // 提示信息状态
    const toast = reactive({
      show: false,
      type: 'success',
      message: ''
    })

    /**
     * 显示提示信息
     * 处理流程：
     * 1、显示指定类型和正文的提示
     * 2、三秒后自动隐藏
     */
    const showToast = (type, message) => {
      // 1、设置本次提示内容并显示。
      toast.type = type
      toast.message = message
      toast.show = true
      
      // 2、安排提示自动关闭。
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
      // 1、取消提示可见状态。
      toast.show = false
    }

    /**
     * 处理对话框图片上传
     * 处理流程：
     * 1、读取文件并加载原始图片
     * 2、裁剪空白、扩展画布并重新读取处理后的尺寸
     * 3、保存对话框及默认变换，重新绘制并提示结果
     */
    const handleFrameUpload = async (file) => {
      // 1、将文件读取为图片数据后解码。
      const reader = new FileReader()
      reader.onload = async (e) => {
        try {
          // 加载原始图片
          const originalImg = new Image()
          originalImg.onload = async () => {
            try {
              // 2、处理图片：裁剪空白像素并扩展画布。
              const processedDataUrl = await processDialogFrameImage(originalImg)
              
              // 加载处理后的图片以获取新尺寸
              const processedImg = new Image()
              processedImg.onload = () => {
                // 3、记录处理后尺寸和默认变换并刷新画布。
                dialogFrame.value = {
                  imageSrc: processedDataUrl,
                  width: processedImg.naturalWidth,
                  height: processedImg.naturalHeight,
                  transform: {
                    x: 0,
                    y: 0,
                    scale: 1,
                    scaleX: 1,
                    scaleY: 1,
                    rotation: 0,
                    flipHorizontal: false
                  }
                }
                
                // 强制重新渲染
                if (dialogFrameCanvas.value?.render) {
                  setTimeout(() => {
                    dialogFrameCanvas.value.render()
                  }, 100)
                }
                
                showToast('success', '对话框图片已处理并上传成功')
              }
              processedImg.onerror = () => {
                showToast('error', '处理后的图片加载失败')
              }
              processedImg.src = processedDataUrl
              
            } catch (error) {
              console.error('图片处理失败:', error)
              showToast('error', '图片处理失败，请重试')
            }
          }
          originalImg.onerror = () => {
            showToast('error', '图片加载失败，请重试')
          }
          originalImg.src = e.target.result
          
        } catch (error) {
          console.error('处理失败:', error)
          showToast('error', '处理失败，请重试')
        }
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
     * 1、读取图片并创建带唯一编号的角色
     * 2、追加角色后重新绘制并自动激活
     * 3、提示成功或文件读取失败
     */
    const handleCharacterUpload = (file) => {
      // 1、读取人物图片并初始化变换数据。
      const reader = new FileReader()
      reader.onload = (e) => {
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
        
        // 2、加入角色列表并安排重绘和选择。
        characters.value.push(newCharacter)
        
        // 强制重新渲染
        if (dialogFrameCanvas.value?.render) {
          setTimeout(() => {
            dialogFrameCanvas.value.render()
          }, 100)
        }
        
        // 自动激活新上传的人物
        setTimeout(() => {
          handleCharacterSelect(newCharacter)
        }, 150)
        
        // 3、报告素材读取结果。
        showToast('success', '人物图片上传成功')
      }
      reader.onerror = (error) => {
        console.error('文件读取失败:', error)
        showToast('error', '文件读取失败，请重试')
      }
      reader.readAsDataURL(file)
    }

    /**
     * 处理对话框选择
     * 处理流程：
     * 1、将操作目标切换为对话框并显示提示
     */
    const handleFrameSelect = () => {
      // 1、使后续调整作用于对话框蒙版。
      activeObjectType.value = 'frame'
      showToast('success', '已选中对话框，可以进行调整')
    }

    /**
     * 处理人物选择
     * 处理流程：
     * 1、记录选中角色并将操作目标切换为人物
     */
    const handleCharacterSelect = (character) => {
      // 1、同步人物引用与当前操作类型。
      activeCharacter.value = character
      activeObjectType.value = 'character'
    }

    /**
     * 处理人物删除
     * 处理流程：
     * 1、定位并移除目标人物
     * 2、必要时清空激活状态并重新绘制
     */
    const handleCharacterDelete = (characterId) => {
      // 1、按唯一编号查找并删除人物。
      const index = characters.value.findIndex(c => c.id === characterId)
      if (index > -1) {
        characters.value.splice(index, 1)
        
        // 2、如果删除的是当前激活的人物，取消激活并刷新画布。
        if (activeCharacter.value?.id === characterId) {
          activeCharacter.value = null
        }
        
        // 强制重新渲染
        if (dialogFrameCanvas.value?.render) {
          setTimeout(() => {
            dialogFrameCanvas.value.render()
          }, 50)
        }
        
        showToast('success', '人物已删除')
      }
    }

    /**
     * 处理人物更新
     * 处理流程：
     * 1、按编号合并人物数据
     * 2、同步当前激活人物的副本
     */
    const handleCharacterUpdate = (updatedCharacter) => {
      // 1、定位角色并合并变更。
      const index = characters.value.findIndex(c => c.id === updatedCharacter.id)
      if (index > -1) {
        characters.value[index] = { ...characters.value[index], ...updatedCharacter }
        
        // 2、如果更新的是当前激活的人物，也要更新激活引用。
        if (activeCharacter.value?.id === updatedCharacter.id) {
          activeCharacter.value = { ...characters.value[index] }
        }
      }
    }

    /**
     * 处理对话框更新
     * 处理流程：
     * 1、将变更合并到当前对话框数据
     */
    const handleFrameUpdate = (updatedFrame) => {
      // 1、保留已有对话框属性并覆盖本次变更。
      dialogFrame.value = { ...dialogFrame.value, ...updatedFrame }
    }

    /**
     * 处理导出
     * 处理流程：
     * 1、确认画布和对话框已准备完成
     * 2、选择目录并导出合成图片
     * 3、提示结果并打开导出目录
     */
    const handleExport = async () => {
      // 1、确认存在可导出的画布与对话框蒙版。
      if (!dialogFrameCanvas.value) {
        showToast('error', '画布未初始化')
        return
      }

      if (!dialogFrame.value) {
        showToast('warning', '请先上传对话框图片')
        return
      }

      try {
        // 2、选择导出文件夹并等待图片保存。
        const folderResult = await selectExportFolder()
        if (!folderResult) return
        
        showToast('success', '正在导出...')
        await dialogFrameCanvas.value.exportImage(folderResult.path)
        showToast('success', '导出成功')
        
        // 3、导出成功后打开文件夹。
        await openExportFolder(folderResult.path)
      } catch (error) {
        showToast('error', `导出失败：${error.message}`)
      }
    }

    /**
     * 选择导出文件夹
     * 处理流程：
     * 1、调用桌面目录选择接口
     * 2、返回有效目录，取消或失败时返回空值并按需提示
     */
    const selectExportFolder = async () => {
      // 1、确认桌面目录选择能力并发起请求。
      try {
        if (window.fileSystem && window.fileSystem.selectFolder) {
          const result = await window.fileSystem.selectFolder()
          
          // 2、区分成功选择、主动取消与错误结果。
          if (result && result.success && result.path) {
            return { path: result.path }
          } else if (result && result.canceled) {
            console.log('用户取消了文件夹选择')
            return null
          } else {
            throw new Error(result.error || '文件夹选择失败')
          }
        } else {
          showToast('error', '文件夹选择功能不可用')
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
     * 1、调用桌面接口打开指定目录并记录结果
     */
    const openExportFolder = async (folderPath) => {
      // 1、打开导出目录，失败时保留日志。
      try {
        if (window.fileSystem && window.fileSystem.openFolder) {
          const result = await window.fileSystem.openFolder(folderPath)
          if (result && result.success) {
            console.log('已打开导出文件夹:', folderPath)
          }
        }
      } catch (error) {
        console.error('打开文件夹失败:', error)
      }
    }

    /**
     * 验证文件是否为图片
     * 处理流程：
     * 1、按受支持的图片媒体类型筛选文件
     */
    const validateImageFile = (file) => {
      // 1、确认文件声明的类型属于图片白名单。
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml']
      return validTypes.includes(file.type)
    }

    /**
     * 计算拖拽提示文本
     */
    const dragHintText = computed(() => {
      // 如果对话框被激活，则替换对话框
      if (activeObjectType.value === 'frame' && dialogFrame.value) {
        return '将替换对话框图片'
      }
      
      // 如果没有对话框图片，则设置为对话框
      if (!dialogFrame.value) {
        return '将设置为对话框图片'
      }
      
      // 其他情况（人物被激活或无激活），添加为人物
      return '将添加新的人物图片'
    })

    /**
     * 处理全局拖拽进入
     * 处理流程：
     * 1、累计嵌套进入事件并在首次进入时显示提示
     */
    const handlePageDragEnter = (event) => {
      // 1、通过计数避免子元素切换时高亮闪烁。
      event.preventDefault()
      dragCounter.value++
      
      if (dragCounter.value === 1) {
        isPageDragOver.value = true
      }
    }

    /**
     * 处理全局拖拽悬停
     * 处理流程：
     * 1、允许文件投放并显示复制反馈
     */
    const handlePageDragOver = (event) => {
      // 1、接管默认行为并保持复制投放效果。
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }

    /**
     * 处理全局拖拽离开
     * 处理流程：
     * 1、减少进入计数并在完全离开后关闭提示
     */
    const handlePageDragLeave = (event) => {
      // 1、仅在离开全部嵌套区域后隐藏拖拽提示。
      event.preventDefault()
      dragCounter.value--
      
      if (dragCounter.value === 0) {
        isPageDragOver.value = false
      }
    }

    /**
     * 处理全局拖拽放置
     * 处理流程：
     * 1、重置拖拽提示并筛选首张有效图片
     * 2、按当前对象类型与蒙版状态选择替换蒙版或追加人物
     * 3、报告文件导入异常
     */
    const handlePageDrop = async (event) => {
      // 1、接管投放行为并检查图片文件。
      event.preventDefault()
      
      // 重置拖拽状态
      isPageDragOver.value = false
      dragCounter.value = 0
      
      try {
        // 获取拖拽的文件
        const files = Array.from(event.dataTransfer.files)
        const imageFiles = files.filter(validateImageFile)
        
        if (imageFiles.length === 0) {
          showToast('warning', '请拖拽图片文件')
          return
        }
        
        const file = imageFiles[0]

        // 2、根据当前激活状态决定操作。
        if (activeObjectType.value === 'frame' && dialogFrame.value) {
          // 如果对话框被激活，替换对话框图片
          handleFrameUpload(file)
          showToast('success', '对话框图片已替换')
        } else if (!dialogFrame.value) {
          // 如果没有对话框图片，先设置对话框
          handleFrameUpload(file)
        } else {
          // 其他情况（人物被激活或无激活），添加为人物
          handleCharacterUpload(file)
        }
        
      } catch (error) {
        // 3、将投放处理异常转换为界面提示。
        console.error('拖拽导入失败:', error)
        showToast('error', `拖拽导入失败：${error.message}`)
      }
    }

    /**
     * 接收其他页面发送到对话框合成页的图片。
     * 处理流程：
     * 1、读取暂存数据并确认页面目标
     * 2、消费暂存数据并延迟到页面初始化后处理
     * 3、还原图片文件并复用人物上传流程
     */
    const processPendingJumpImage = () => {
      // 1、读取跨页暂存图片并确认目标。
      const pendingImageData = sessionStorage.getItem('pendingImageForJump')
      if (!pendingImageData) {
        return
      }
      
      try {
        const imageData = JSON.parse(pendingImageData)
        
        if (imageData.targetPage === 'dialog-frame') {
          // 2、移除已接收的数据，避免重复导入。
          sessionStorage.removeItem('pendingImageForJump')
          
          setTimeout(() => {
            try {
              // 3、将图片数据还原为文件，兼容不支持文件构造器的环境。
              const base64Data = imageData.dataURL.split(',')[1]
              const mimeType = imageData.dataURL.match(/data:([^;]+);/)?.[1] || 'image/png'
              const byteCharacters = atob(base64Data)
              const byteNumbers = new Array(byteCharacters.length)
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i)
              }
              const byteArray = new Uint8Array(byteNumbers)
              const blob = new Blob([byteArray], { type: mimeType })
              const fileName = imageData.fileName || `角色_${Date.now()}.png`
              let characterFile
              try {
                characterFile = new File([blob], fileName, { type: mimeType })
              } catch (error) {
                characterFile = Object.assign(blob, { name: fileName })
              }

              handleCharacterUpload(characterFile)
            } catch (error) {
              showToast('error', '处理跳转图片失败: ' + error.message)
            }
          }, 500)
        }
      } catch (error) {
        // 静默处理错误
      }
    }

    // 3、首次挂载与页面重新激活时接收待处理图片。
    onMounted(async () => {
      await nextTick()
      processPendingJumpImage()
    })

    onActivated(() => {
      processPendingJumpImage()
    })

    return {
      // 数据
      dialogFrame,
      characters,
      activeCharacter,
      activeObjectType,
      dialogFrameCanvas,
      leftSidebarEl,
      mainWorkspaceEl,
      toast,
      isPageDragOver,
      dragHintText,
      
      // 方法
      handleFrameUpload,
      handleCharacterUpload,
      handleFrameSelect,
      handleCharacterSelect,
      handleCharacterDelete,
      handleCharacterUpdate,
      handleFrameUpdate,
      handleExport,
      showToast,
      hideToast,
      handlePageDragOver,
      handlePageDragEnter,
      handlePageDragLeave,
      handlePageDrop
    }
  }
}
</script>

<style scoped src="./DialogFramePage.css"></style>
