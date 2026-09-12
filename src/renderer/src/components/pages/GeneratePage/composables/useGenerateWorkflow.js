/** 图像处理工作流：协调生成、编辑、抠图、高清与链式输入，状态由父页面唯一持有。 */
import { TaskType, TaskStatus } from '@renderer/stores/taskStore.js'
import { GEMINI_IMAGE_CONFIG_STORAGE_KEY } from '@renderer/config/gemini-image-config.js'
import { resolveGeminiProjectRoot } from '@renderer/utils/geminiOutputConfig.js'
import { filterGeminiExceptionMessage } from '@renderer/utils/errorFilters.js'

/**
 * 组织生图、抠图、高清及结果链式处理流程。
 * 处理流程：
 * 1、接收父页面持有的响应状态、服务和图片辅助函数
 * 2、保留原处理流程，仅向父页面提供模式执行与配置加载入口
 */
export function useGenerateWorkflow({
  activeMode,
  generateState,
  removeState,
  highresState,
  isToolkitAvailable,
  currentPrompt,
  sharedInputFiles,
  toolkitConfig,
  removeModelOptions,
  highresModelOptions,
  taskStore,
  message,
  getActiveInputFiles,
  replaceSharedOutput,
  createImageId,
  clearInputs,
  getModeLimit,
  createImageCanvas,
  loadPreviewImages
}) {
  /**
   * 按用户选择执行对应图片处理模式。
   * 处理流程：
   * 1、按模式切换状态，本地处理先确认服务可用
   * 2、阻止同模式重复运行并调用对应执行入口
   */
  const executeMode = async (mode) => {
    // 1、按目标模式检查服务并选择处理状态。
    if (mode === 'generate') {
      activeMode.value = 'generate'
      // 2、当前模式空闲时才启动处理。
      if (generateState.isProcessing) return
      await runGenerate()
    } else if (mode === 'remove') {
      if (!isToolkitAvailable.value) {
        message.warning('未检测到抠图高清服务，请先完成配置。')
        return
      }
      activeMode.value = 'remove'
      if (removeState.isProcessing) return
      await runRemove()
    } else if (mode === 'highres') {
      if (!isToolkitAvailable.value) {
        message.warning('未检测到抠图高清服务，请先完成配置。')
        return
      }
      activeMode.value = 'highres'
      if (highresState.isProcessing) return
      await runHighres()
    }
  }

  /**
   * 执行文生图或带输入图片的编辑任务。
   * 处理流程：
   * 1、检查提示词和生成接口
   * 2、按输入图片构建任务并登记运行状态
   * 3、读取用户配置并调用对应生成接口
   * 4、保存结果或任务错误，成功时将输出接入下一步输入
   * 5、恢复忙碌状态及默认宽高比
   */
  const runGenerate = async () => {
    // 1、获取并清理提示词，检查生成服务是否可用。
    const promptText = (currentPrompt.value || '').trim()
    
    if (!promptText) {
      message.warning('请输入提示词后再尝试生成。')
      return
    }
    
    if (!window?.falApi?.generateImage || !window?.falApi?.editImage) {
      message.error('未检测到生成服务，请确认主程序是否正常。')
      return
    }

    // 2、区分纯文本生成与图片编辑，并创建可追踪任务。
    const state = generateState
    const inputFiles = getActiveInputFiles()
    const hasFiles = inputFiles.length > 0
    const taskType = hasFiles ? TaskType.EDIT : TaskType.GENERATE
    const taskConfig = {
      prompt: promptText  // 使用清理后的提示词
    }
    if (hasFiles) {
      taskConfig.inputImages = inputFiles
        .filter((item) => item.path)
        .map((item) => item.path)
    }
    if (state.aspectRatio !== 'original') {
      taskConfig.aspectRatio = state.aspectRatio
    }

    const task = taskStore.createTask(taskType, taskConfig)
    taskStore.updateTaskStatus(task.id, TaskStatus.RUNNING)

    state.isProcessing = true

    try {
      // 3、读取用户连接与输出配置后调用相应服务。
      const savedConfig = localStorage.getItem(GEMINI_IMAGE_CONFIG_STORAGE_KEY) || localStorage.getItem('fal-config')
      const userConfig = savedConfig ? JSON.parse(savedConfig) : {}
      if (!userConfig.apiKey) {
        message.error('请先在设置页配置 API Key。')
        taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: '未配置 API Key'
        })
        return
      }

      const projectRoot = resolveGeminiProjectRoot(userConfig)
      let result
      if (hasFiles) {
        const inputImages = taskConfig.inputImages
        if (!inputImages.length) {
          message.error('无法获取图片路径，请重新选择输入图片。')
          taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, {
            error: '缺少图片路径'
          })
          return
        }

        const params = {
          prompt: promptText,  // 使用清理后的提示词
          inputImages,
          apiKey: userConfig.apiKey,
          baseUrl: userConfig.baseUrl,
          model: 'gemini-2.5-flash-image',
          projectRoot,
          editOutputDir: userConfig.editOutputDir || 'output',
          logDir: userConfig.logDir || 'logs'
        }
        if (state.aspectRatio !== 'original') {
          params.aspectRatio = state.aspectRatio
        }
        result = await window.falApi.editImage(params)
      } else {
        const params = {
          prompt: promptText,  // 使用清理后的提示词
          apiKey: userConfig.apiKey,
          baseUrl: userConfig.baseUrl,
          model: 'gemini-2.5-flash-image',
          projectRoot,
          outputDir: userConfig.outputDir || 'output',
          logDir: userConfig.logDir || 'logs'
        }
        if (state.aspectRatio !== 'original') {
          params.aspectRatio = state.aspectRatio
        }
        result = await window.falApi.generateImage(params)
      }

      // 4、同步结果及任务状态，成功时衔接后续处理输入。
      if (result?.success) {
        const images = Array.isArray(result.data) ? result.data : []
        const mapped = images.map((url, index) => ({
          id: createImageId(),
          url,
          name: `gen_`
        }))
        replaceSharedOutput(mapped)
        taskStore.updateTaskStatus(task.id, TaskStatus.COMPLETED, {
          result: mapped
        })
        const successMsg = hasFiles
          ? `编辑完成，得到 ${images.length} 张图片`
          : `生成完成，得到 ${images.length} 张图片`
        message.success(successMsg)
        
        // 🔄 自动链式流程：清空输入并将输出导入到输入
        await autoChainWorkflow(mapped, successMsg)
      } else {
        const errorMsg = result?.message || '生成失败'
        const friendlyErrorLocal = filterGeminiExceptionMessage(errorMsg)
        taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, {
          error: friendlyErrorLocal
        })
        message.error(friendlyErrorLocal)
      }
    } catch (error) {
      console.error('[图像处理插件] 生成失败:', error)
      const friendlyError = filterGeminiExceptionMessage(error)
      taskStore.updateTaskStatus(task.id, TaskStatus.FAILED, {
        error: friendlyError
      })
      message.error('生成失败：' + friendlyError)
    } finally {
      // 5、释放处理状态并恢复默认生成宽高比。
      state.isProcessing = false
      state.aspectRatio = '16:9'
    }
  }

  /**
   * 使用本地模型处理共享输入图片的背景。
   * 处理流程：
   * 1、检查输入及本地抠图配置
   * 2、构造图片路径、模型和输出参数并执行抠图
   * 3、加载结果预览并衔接到共享输入
   * 4、提示失败并最终恢复处理状态
   */
  const runRemove = async () => {
    // 1、验证待处理图片与本地抠图服务。
    const state = removeState
    const inputFiles = sharedInputFiles
    if (!inputFiles.length) {
      message.warning('请先添加待抠图的图片。')
      return
    }
    if (!ensureToolkitReady('remove')) return
    if (!window?.hdToolkit?.runRemovebg) {
      message.error('未检测到抠图服务。')
      return
    }

    // 2、进入忙碌状态并准备本次抠图参数。
    state.isProcessing = true
    try {
      const payload = {
        inputPaths: inputFiles.map((item) => item.path).filter(Boolean),
        modelId: state.selectedModel || (removeModelOptions.value[0]?.value || ''),
        alphaMatting: state.alphaMatting,
        outputDir: toolkitConfig.outputDir
      }

      if (!payload.inputPaths.length) {
        message.error('无法读取图片路径，请重新选择图片。')
        return
      }

      if (!payload.modelId) {
        message.error('请选择抠图模型。')
        return
      }

      const response = await window.hdToolkit.runRemovebg(payload)
      // 3、将处理成功的文件转换为预览和下一步输入。
      if (response?.success) {
        const data = response.data || {}
        const files = Array.isArray(data.files) ? data.files : []
        state.outputDir = data.outputDir || toolkitConfig.outputDir
        const previews = await loadPreviewImages(files)
        replaceSharedOutput(previews)
        const successMsg = `抠图处理完成，得到 ${previews.length} 张图片`
        message.success(successMsg)
        
        // 🔄 自动链式流程：清空输入并将输出导入到输入
        await autoChainWorkflow(previews, successMsg)
      } else {
        message.error(response?.message || '抠图失败')
      }
    } catch (error) {
      console.error('[图像处理插件] 抠图失败:', error)
      message.error('抠图失败：' + error.message)
    } finally {
      // 4、无论是否成功都允许下一次处理。
      state.isProcessing = false
    }
  }

  /**
   * 使用本地模型提升共享输入图片的分辨率。
   * 处理流程：
   * 1、检查输入和高清服务配置
   * 2、按模型、倍率及性能模式执行处理
   * 3、加载输出预览并衔接到共享输入
   * 4、最终恢复处理状态
   */
  const runHighres = async () => {
    // 1、确认输入图片及高清模型配置。
    const state = highresState
    const inputFiles = sharedInputFiles
    if (!inputFiles.length) {
      message.warning('请先添加需要高清处理的图片。')
      return
    }
    if (!ensureToolkitReady('highres')) return
    if (!window?.hdToolkit?.runHighres) {
      message.error('未检测到高清服务。')
      return
    }

    // 2、设置忙碌标记并构造高清处理参数。
    state.isProcessing = true
    try {
      const payload = {
        inputPaths: inputFiles.map((item) => item.path).filter(Boolean),
        modelId: state.selectedModel || (highresModelOptions.value[0]?.value || ''),
        outputDir: toolkitConfig.outputDir,
        outscale: Number(state.outscale) || 2,
        mode: state.mode || 'auto'  // 性能模式：自动优化
      }

      if (!payload.inputPaths.length) {
        message.error('无法读取图片路径，请重新选择图片。')
        return
      }
      if (!payload.modelId) {
        message.error('请选择高清模型。')
        return
      }

      const response = await window.hdToolkit.runHighres(payload)
      // 3、同步结果目录和预览，随后更新链式输入。
      if (response?.success) {
        const data = response.data || {}
        const files = Array.isArray(data.files) ? data.files : []
        state.outputDir = data.outputDir || toolkitConfig.outputDir
        const previews = await loadPreviewImages(files)
        replaceSharedOutput(previews)
        const successMsg = `高清处理完成，得到 ${previews.length} 张图片`
        message.success(successMsg)
        
        // 🔄 自动链式流程：清空输入并将输出导入到输入
        await autoChainWorkflow(previews, successMsg)
      } else {
        message.error(response?.message || '高清处理失败')
      }
    } catch (error) {
      console.error('[图像处理插件] 高清失败:', error)
      message.error('高清处理失败：' + error.message)
    } finally {
      // 4、释放当前模式的处理状态。
      state.isProcessing = false
    }
  }

  /**
   * 检查本地图片处理所需的服务和路径配置。
   * 处理流程：
   * 1、检查服务、解释器和输出目录
   * 2、检查当前模式所需的模型目录，全部满足时返回就绪
   */
  const ensureToolkitReady = (mode) => {
    // 1、确认本地处理的基础配置齐全。
    if (!isToolkitAvailable.value) {
      message.error('未检测到抠图高清服务。')
      return false
    }
    if (!toolkitConfig.pythonHome) {
      message.error('请先在抠图高清设置中配置 Python 解释器路径。')
      return false
    }
    if (!toolkitConfig.outputDir) {
      message.error('请设置输出目录后再试。')
      return false
    }
    // 2、分别确认抠图和高清所需的权重目录。
    if (mode === 'remove' && !toolkitConfig.removebgWeightsDir) {
      message.error('请配置抠图模型权重目录。')
      return false
    }
    if (mode === 'highres' && !toolkitConfig.highresWeightsDir) {
      message.error('请配置高清模型权重目录。')
      return false
    }
    return true
  }

  /**
   * 自动链式工作流：清空输入并将输出导入到输入
   * 处理流程：
   * 1、确认存在输出并清空旧输入
   * 2、读取当前模式数量上限
   * 3、转换输出地址为可处理文件路径并写入输入列表
   */
  const autoChainWorkflow = async (outputImages, sourceMsg = '') => {
    // 1、确认有效输出后才替换当前输入。
    if (!Array.isArray(outputImages) || outputImages.length === 0) {
      return
    }

    try {
      console.log('🔄 开始自动链式流程，将输出导入到输入...')
      
      // 清空当前输入。
      clearInputs()
      
      // 2、获取当前模式的限制数量。
      const limit = getModeLimit(activeMode.value)
      
      // 3、将输出图片转换为输入格式并添加到输入列表。
      const imagesToImport = outputImages.slice(0, limit)
      
      for (const item of imagesToImport) {
        // 确保图片有必要的属性
        if (!item.url) continue
        
        // 尝试保存为临时文件以获得文件路径
        let filePath = item.path
        
        // 如果没有路径，尝试将 URL/dataURL 保存为临时文件
        if (!filePath && item.url) {
          try {
            // 如果是 file:// 路径，提取真实路径
            if (item.url.startsWith('file://')) {
              filePath = item.url.replace('file:///', '').replace('file://', '')
              // Windows路径处理
              if (/^[a-zA-Z]:/.test(filePath)) {
                // 已经是完整路径，直接使用
              }
            } 
            // 如果是 data URL，保存为临时文件
            else if (item.url.startsWith('data:image')) {
              const base64Data = item.url.split(',')[1]
              const tempFileName = `自动保存_${item.name || `image_${Date.now()}`}.png`
              
              if (window?.fileSystem?.saveTempImage) {
                const tempResult = await window.fileSystem.saveTempImage(base64Data, tempFileName)
                if (tempResult?.success && tempResult.path) {
                  filePath = tempResult.path
                }
              }
            }
            // 如果是普通 URL，转换为 base64 后保存
            else {
              const canvas = await createImageCanvas(item.url)
              if (canvas) {
                const base64Data = canvas.toDataURL('image/png').split(',')[1]
                const tempFileName = `自动保存_${item.name || `image_${Date.now()}`}.png`
                
                if (window?.fileSystem?.saveTempImage) {
                  const tempResult = await window.fileSystem.saveTempImage(base64Data, tempFileName)
                  if (tempResult?.success && tempResult.path) {
                    filePath = tempResult.path
                  }
                }
              }
            }
          } catch (error) {
            console.warn('⚠️ 无法保存临时文件:', error)
          }
        }
        
        // 添加到输入列表
        const inputItem = {
          id: createImageId(),
          name: item.name || `链式输入 ${sharedInputFiles.length + 1}`,
          path: filePath || '',
          url: item.url,
          size: item.size || 0
        }
        
        sharedInputFiles.push(inputItem)
      }
      
      console.log(`✅ 自动链式流程完成，已将 ${imagesToImport.length} 张输出图片导入到输入`)
      
      // 显示友好的链式流程提示
      if (imagesToImport.length > 0) {
        setTimeout(() => {
          //   message.info(`🔄 已自动导入 ${imagesToImport.length} 张图片到输入区，可继续进行下一步处理`, {
          //   duration: 3000
          // })
          console.log("...");
        }, 500)
      }
      
    } catch (error) {
      console.error('❌ 自动链式流程失败:', error)
      // 静默失败，不影响主流程
    }
  }

  /**
   * 加载本地处理配置与可用模型。
   * 处理流程：
   * 1、检查本地服务入口并读取初始化数据
   * 2、同步路径、模型选项与已保存的参数
   * 3、读取失败时标记服务不可用并切回生图模式
   */
  const loadToolkitConfig = async () => {
    // 1、确认本地处理服务暴露了初始化接口。
    if (!window?.hdToolkit?.getInitialData) {
      isToolkitAvailable.value = false
      activeMode.value = 'generate'
      return
    }
    try {
      const response = await window.hdToolkit.getInitialData()
      if (response?.success) {
        isToolkitAvailable.value = true
        // 2、恢复路径配置、可选模型和上次使用参数。
        const data = response.data || {}
        const cfg = data.config || {}
        toolkitConfig.pythonHome = cfg.pythonHome || ''
        toolkitConfig.removebgWeightsDir = cfg.removebgWeightsDir || ''
        toolkitConfig.highresWeightsDir = cfg.highresWeightsDir || ''
        toolkitConfig.outputDir = cfg.outputDir || ''

        const removeModels = Array.isArray(data.removebgModels) ? data.removebgModels : []
        const highresModels = Array.isArray(data.highresModels) ? data.highresModels : []

        removeModelOptions.value = removeModels.map((item) => ({
          label: item.name || item.id,
          value: item.id
        }))
        highresModelOptions.value = highresModels.map((item) => ({
          label: item.name || item.id,
          value: item.id
        }))

        if (!removeState.selectedModel && removeModelOptions.value.length) {
          removeState.selectedModel = removeModelOptions.value[0].value
        }
        if (!highresState.selectedModel && highresModelOptions.value.length) {
          highresState.selectedModel = highresModelOptions.value[0].value
        }
        if (cfg.removebg?.modelId && removeModelOptions.value.some((opt) => opt.value === cfg.removebg.modelId)) {
          removeState.selectedModel = cfg.removebg.modelId
        }
        if (cfg.highres?.modelId && highresModelOptions.value.some((opt) => opt.value === cfg.highres.modelId)) {
          highresState.selectedModel = cfg.highres.modelId
        }
        if (typeof cfg.removebg?.alphaMatting === 'boolean') {
          removeState.alphaMatting = cfg.removebg.alphaMatting
        }
        if (cfg.highres?.outscale !== undefined) {
          highresState.outscale = Number(cfg.highres.outscale) || highresState.outscale
        }
      } else {
        // 3、服务初始化失败时恢复为生图模式。
        isToolkitAvailable.value = false
        activeMode.value = 'generate'
        if (response?.message) {
          message.warning(response.message)
        }
      }
    } catch (error) {
      isToolkitAvailable.value = false
      activeMode.value = 'generate'
      console.error('[图像处理插件] 加载抠图高清配置失败:', error)
    }
  }

  return { executeMode, loadToolkitConfig }
}
