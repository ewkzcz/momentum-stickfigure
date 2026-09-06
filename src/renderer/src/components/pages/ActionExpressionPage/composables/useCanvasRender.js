/**
 * 画布渲染组合逻辑：协调预设、图层树和部件选择，处理剪切组与图层蒙版。
 */
import { ref } from 'vue'
import { useMessage } from 'naive-ui'
import { createPerformanceLogger } from '@renderer/utils/performanceLogger.js'
import {
  isPartSelected,
  shouldLayerBeRendered,
  findClippingGroup,
  renderClippingGroup,
  applyLayerMask,
  renderLayerToContext
} from '../utils/layerRenderUtils.js'
import { regionHasVisiblePixel } from '../utils/canvasUtils.js'

const isProduction = import.meta?.env?.MODE === 'production'
/**
 * 输出开发环境渲染诊断日志。
 * 处理流程：
 * 1、仅在非生产环境转发日志参数。
 */
const debugLog = (...args) => {
  // 1、生产环境跳过高频渲染日志。
  if (!isProduction) globalThis.console.log(...args)
}
/**
 * 输出开发环境渲染警告。
 * 处理流程：
 * 1、仅在非生产环境转发警告参数。
 */
const debugWarn = (...args) => {
  // 1、按运行环境决定是否输出警告。
  if (!isProduction) globalThis.console.warn(...args)
}
const perfLogger = createPerformanceLogger('canvas-render')

/**
 * Canvas渲染核心逻辑
 * 
 * 提供Canvas渲染相关的核心功能
 * 处理流程：
 * 1、接入画布、预设、图层树和部件选择状态。
 * 2、定义整帧、部件和蒙版渲染流程。
 * 3、返回渲染状态与调用接口。
 * @param {object} deps - 依赖对象
 * @param {Ref} deps.canvasRef - Canvas元素引用
 * @param {Ref} deps.canvasStyle - Canvas样式
 * @param {Ref} deps.scrollMode - 滚动模式
 * @param {Ref} deps.canvasScale - Canvas缩放比例
 * @param {Ref} deps.currentPsdData - 当前PSD数据
 * @param {Ref} deps.selectedPresetId - 选中的预设ID
 * @param {Ref} deps.presets - 预设列表
 * @param {Function} deps.renderPreset - 渲染预设函数
 * @param {Function} deps.updateSelectedLayersMap - 更新选中图层映射
 * @param {Ref} deps.controlPriority - 控制优先级
 * @param {Function} deps.renderByLayerTree - 按图层树渲染
 * @param {object} deps.commonControls - 通用控制状态对象
 * @param {object} deps.partsState - 部件状态对象
 * @param {object} deps.dynamicState - 动态状态对象
 */
export function useCanvasRender(deps) {
  // 1、复用页面注入的画布和选择状态。
  const message = useMessage()
  
  // 解构依赖
  const {
    canvasRef,
    canvasStyle,
    scrollMode,
    canvasScale,
    currentPsdData,
    selectedPresetId,
    presets,
    renderPreset,
    updateSelectedLayersMap,
    controlPriority,
    renderByLayerTree,
    commonControls,
    partsState,
    dynamicState
  } = deps

  // ==================== 渲染状态 ====================
  
  /**
   * 渲染进行中标志
   */
  const isRendering = ref(false)

  // 2、提供不同粒度的画布渲染流程。
  // ==================== 刷新画布 ====================
  
  /**
   * 刷新画布
   * 处理流程：
   * 1、检查已选部件，重绘后反馈结果。
   */
  const refreshCanvas = async () => {
    // 1、仅在已选部件时触发手动刷新。
    if (!partsState.selectedPart.value) {
      message.warning('请先选择要渲染的部件')
      return
    }
    
    await renderPart(partsState.selectedPart.value)
    message.success('画布已刷新')
  }

  // ==================== 渲染所有图层 ====================
  
  /**
   * 渲染所有图层（根据各分组的选中状态）
   * 处理流程：
   * 1、检查画布，优先展示当前选中的预设。
   * 2、更新图层选择映射并执行图层树渲染。
   * 3、清理超时计时器与渲染状态，记录性能结果。
   */
  const renderAllLayers = async () => {
    // 1、预设选中时由预设渲染接管当前画面。
    const canvas = canvasRef.value
    if (!canvas) {
      message.error('Canvas未初始化')
      return
    }
    
    // 如果选中了预设，只渲染预设
    if (selectedPresetId.value) {
      const preset = presets.value.find(p => p.id === selectedPresetId.value)
      if (preset) {
        perfLogger.logEvent('render:preset', { presetId: preset.id })
        await renderPreset(preset)
        return
      }
    }
    
    // 2、更新选中图层映射，用于图层树高亮并驱动整帧渲染。
    updateSelectedLayersMap()
    
    isRendering.value = true
    const measurement = perfLogger.start('render:allLayers', { threshold: 18 })
    let renderStats = null

    let watchdogTimer = null
    try {
      // 渲染超时保护：超时后释放渲染状态，计时器不取消原任务。
      watchdogTimer = setTimeout(() => {
        console.error('⏱️ 渲染超时，强制释放渲染锁并请求重绘')
        isRendering.value = false
      }, 10000)
      // 统一使用图层树渲染模式（从layerTreeData.visible读取，结合通用控制）
      renderStats = await renderByLayerTree()
    } catch (error) {
      console.error('❌ 渲染失败:', error)
      message.error('渲染失败: ' + error.message)
    } finally {
      // 3、结束本次渲染状态并记录图层数与画布尺寸。
      if (watchdogTimer) clearTimeout(watchdogTimer)
      isRendering.value = false
      measurement.end({
        canvasScale: canvasScale.value,
        layersRendered: renderStats?.layersRendered ?? 0,
        nodesVisited: renderStats?.nodesVisited ?? 0,
        canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'unknown'
      })
    }
  }

  // ==================== 渲染单个部件 ====================
  
  /**
   * 渲染单个部件到Canvas（渲染所有图层，但每个分组只渲染其选中的部件）
   * 处理流程：
   * 1、验证部件与画布，初始化渲染状态。
   * 2、建立离屏画布和分组选中映射，绘制筛选后的图层。
   * 3、一次性替换主画布并结束渲染计时。
   */
  const renderPart = async (part) => {
    // 1、排除缺少部件或画布的调用。
    if (!part) {
      message.warning('请选择要渲染的部件')
      return
    }
    
    const canvas = canvasRef.value
    if (!canvas) {
      message.error('Canvas未初始化')
      return
    }
    
    isRendering.value = true
    const measurement = perfLogger.start('render:part', { threshold: 18 })

    let watchdogTimer = null
    try {
      watchdogTimer = setTimeout(() => {
        console.error('⏱️ 部件渲染超时，强制释放渲染锁')
        isRendering.value = false
      }, 10000)
      const ctx = canvas.getContext('2d')
      
      if (!ctx) {
        throw new Error('无法获取Canvas 2D上下文')
      }
      
      // 2、使用双缓冲技术：创建离屏画布完成分组过滤与图层渲染。
      // 这样可以避免渲染过程中的闪烁，让切换更加平滑
      const offscreenCanvas = document.createElement('canvas')
      offscreenCanvas.width = canvas.width
      offscreenCanvas.height = canvas.height
      const offscreenCtx = offscreenCanvas.getContext('2d')
      
      if (!offscreenCtx) {
        throw new Error('无法创建离屏Canvas上下文')
      }
      
      // 在离屏canvas上清空（主canvas暂时保持当前内容）
      offscreenCtx.clearRect(0, 0, offscreenCanvas.width, offscreenCanvas.height)
      
      // 获取所有分组的图层路径和选中状态
      const allGroupPaths = new Set()
      const selectedPathsMap = new Map()
      
      // 构建所有分组的路径映射
      buildGroupPathsMap(allGroupPaths, selectedPathsMap)
      
      // 在离屏canvas上渲染所有图层，每个分组只渲染选中的部件
      if (currentPsdData.value && currentPsdData.value.layerHierarchy) {
        await renderLayersWithAllGroupFilters(
          offscreenCtx, 
          currentPsdData.value.layerHierarchy, 
          allGroupPaths, 
          selectedPathsMap, 
          offscreenCanvas,
          commonControls.showBackground.value,
          commonControls.showBaseLayer.value,
          commonControls.showSecondBaseLayer.value,
          commonControls.showWeapon.value,
          commonControls.showBackHair.value,
          commonControls.showFront.value,
          commonControls.showSide.value,
          commonControls.showBack.value,
          commonControls.showRear.value,
          commonControls.showShadow.value,
          commonControls.showShakeHead.value,
          commonControls.showHoldSword.value,
          commonControls.showBackHandSword.value,
          commonControls.showDownwardSlash.value
        )
      }
      
      // 3、渲染完成后，一次性将离屏画布内容绘制到主画布。
      // 双缓冲技术避免了渲染过程中的闪烁和逐层显示，切换更加流畅自然
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(offscreenCanvas, 0, 0)
      
    } catch (error) {
      console.error('❌ 渲染失败:', error)
      message.error('渲染失败: ' + error.message)
    } finally {
      if (watchdogTimer) clearTimeout(watchdogTimer)
      isRendering.value = false
      measurement.end({
        partPath: part.path || part.name || 'unknown',
        groupsConsidered: allGroupPaths.size,
        selectedGroups: selectedPathsMap.size
      })
    }
  }

  // ==================== 辅助函数：构建分组路径映射 ====================
  
  /**
   * 构建所有分组的图层路径和选中状态映射
   * 处理流程：
   * 1、读取固定分组、动态分组和用户交互状态。
   * 2、记录固定部件路径，按用户选择或原始可见性决定状态。
   * 3、遍历动态分组，应用相同的路径与状态规则。
   * @param {Set} allGroupPaths - 所有分组路径集合
   * @param {Map} selectedPathsMap - 路径到选中状态的映射
   */
  const buildGroupPathsMap = (allGroupPaths, selectedPathsMap) => {
    // 1、用户操作过的分组使用选择结果，其余保留 PSD 初始状态。
    const { selectedParts, userInteracted } = partsState
    const { 
      frontHandNormalParts, frontHandRightParts, frontHandBothParts,
      backHandParts, frontLayerBackHandParts, bothHandsParts,
      upperBodyParts, lowerBodyParts, actionParts
    } = partsState
    const {
      dynamicExpressionTabs, dynamicExpressionParts,
      dynamicFrontHandTabs, dynamicFrontHandParts,
      dynamicBackHandTabs, dynamicBackHandParts,
      dynamicBothHandsTabs, dynamicBothHandsParts,
      dynamicUpperBodyTabs, dynamicUpperBodyParts,
      dynamicLowerBodyTabs, dynamicLowerBodyParts,
      dynamicActionTabs, dynamicActionParts
    } = dynamicState
    
    // 2、收集固定分组，首先处理普通前手。
    frontHandNormalParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.frontHandNormal) {
        if (selectedParts.value.frontHandNormal) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.frontHandNormal))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 前手(右手)分组
    frontHandRightParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.frontHandRight) {
        if (selectedParts.value.frontHandRight) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.frontHandRight))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 前手(双手)分组
    frontHandBothParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.frontHandBoth) {
        if (selectedParts.value.frontHandBoth) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.frontHandBoth))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 后手分组
    backHandParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.backHand) {
        if (selectedParts.value.backHand) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.backHand))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 前层后手分组
    frontLayerBackHandParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.frontLayerBackHand) {
        if (selectedParts.value.frontLayerBackHand) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.frontLayerBackHand))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 双手分组
    bothHandsParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.bothHands) {
        if (selectedParts.value.bothHands) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.bothHands))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 上身分组
    upperBodyParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.upperBody) {
        if (selectedParts.value.upperBody) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.upperBody))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 下身分组
    lowerBodyParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.lowerBody) {
        if (selectedParts.value.lowerBody) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.lowerBody))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 动作分组
    actionParts.value.forEach(p => {
      allGroupPaths.add(p.path)
      if (userInteracted.value.action) {
        if (selectedParts.value.action) {
          selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value.action))
        } else {
          selectedPathsMap.set(p.path, false)
        }
      } else {
        selectedPathsMap.set(p.path, !p.hidden)
      }
    })
    
    // 3、收集动态分组，首先遍历所有动态表情图组。
    dynamicExpressionTabs.value.forEach(expressionTab => {
      const expressionKey = expressionTab.key
      const expressionPartsList = dynamicExpressionParts.value[expressionKey] || []
      
      expressionPartsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[expressionKey]) {
          if (selectedParts.value[expressionKey]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[expressionKey]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态前手分组
    dynamicFrontHandTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicFrontHandParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态后手分组
    dynamicBackHandTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicBackHandParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态双手分组
    dynamicBothHandsTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicBothHandsParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态上身分组
    dynamicUpperBodyTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicUpperBodyParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态下身分组
    dynamicLowerBodyTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicLowerBodyParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
    
    // 动态动作分组
    dynamicActionTabs.value.forEach(tab => {
      const key = tab.key
      const partsList = dynamicActionParts.value[key] || []
      partsList.forEach(p => {
        allGroupPaths.add(p.path)
        if (userInteracted.value[key]) {
          if (selectedParts.value[key]) {
            selectedPathsMap.set(p.path, isPartSelected(p.path, selectedParts.value[key]))
          } else {
            selectedPathsMap.set(p.path, false)
          }
        } else {
          selectedPathsMap.set(p.path, !p.hidden)
        }
      })
    })
  }

  // ==================== 图层渲染函数 ====================
  
  /**
   * 渲染图层树，对所有分组进行过滤（每个分组只渲染选中的部件）
   * 处理流程：
   * 1、生成兼容同名图层的路径并跟踪已处理剪切层。
   * 2、识别方向、通用控制与部件分组，过滤未显示的内容。
   * 3、按选中状态渲染普通层或剪切组。
   * 4、递归处理子图层。
   * @param {CanvasRenderingContext2D} ctx - Canvas上下文
   * @param {Array} layers - 图层数组
   * @param {Set} allGroupPaths - 所有分组的图层路径集合
   * @param {Map} selectedPathsMap - 图层路径到是否选中的映射
   * @param {HTMLCanvasElement} canvas - Canvas元素
   * @param {boolean} showBg - 是否显示背景
   * @param {boolean} showBl - 是否显示底图（PSD最底层）
   * @param {boolean} showSbl - 是否显示第二底图（PSD倒数第二层）
   * @param {boolean} showWp - 是否显示武器
   * @param {boolean} showBh - 是否显示后发/发型后
   * @param {boolean} showFt - 是否显示正面
   * @param {boolean} showSd - 是否显示侧面
   * @param {boolean} showBk - 是否显示背面
   * @param {boolean} showSh - 是否显示阴影
   * @param {boolean} showShk - 是否显示摇摇头
   * @param {boolean} showHs - 是否显示持剑
   * @param {boolean} showBhs - 是否显示后手持剑
   * @param {boolean} showDs - 是否显示下压挥剑
   * @param {string} parentPath - 父级路径
   */
  const renderLayersWithAllGroupFilters = async (ctx, layers, allGroupPaths, selectedPathsMap, canvas, showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showRr, showSh, showShk, showHs, showBhs, showDs, parentPath = '', nameCountMap = new Map()) => {
    // 1、跟踪已处理的剪切蒙版图层，并为同名节点生成唯一路径。
    const processedClippingIndices = new Set()
    
    for (let i = 0; i < layers.length; i++) {
      // 如果当前图层已经作为剪切蒙版被处理过，跳过
      if (processedClippingIndices.has(i)) {
        continue
      }
      
      const layer = layers[i]
      const layerName = layer.name
      
      // 处理同名图层：添加索引后缀（需与 extractDirectChildren 完全一致：所有图层均参与计数）
      let uniqueName = layerName
      if (nameCountMap.has(layerName)) {
        const count = nameCountMap.get(layerName)
        nameCountMap.set(layerName, count + 1)
        uniqueName = `${layerName}#${count + 1}`
      } else {
        nameCountMap.set(layerName, 1)
      }
      
      const layerPath = parentPath ? `${parentPath}/${uniqueName}` : uniqueName
      const layerNameLower = layerName?.trim().toLowerCase() || ''
      const layerPathLower = layerPath.toLowerCase()
      
      // 2、识别通用控制和方向分类，以决定当前图层是否参与渲染。
      const isBackground = layerName === '背景' || layerName === 'background' || layerName === 'bg'
      
      // 检查是否是底图（PSD最底层的图层）
      const isBaseLayer = !parentPath && i === 0
      
      // 检查是否是第二底图（PSD倒数第二层的图层）
      const isSecondBaseLayer = !parentPath && i === 1
      
      // 检查是否属于武器图组
      const isWeaponGroup = layerNameLower.includes('武器') || layerNameLower.includes('weapon')
      
      // 检查是否属于方向图组（检查完整路径，支持多种命名格式和空格）
      const normalizedPath = layerPathLower.replace(/\s+/g, '')
      
      // 检查是否属于后手持剑图组（必须先检查，避免被"持剑"或"后手"误判）
      const isBackHandSwordGroup = (
        layerNameLower.includes('后手持剑') ||
        layerNameLower.includes('backhandsword') ||
        layerNameLower.includes('back_hand_sword') ||
        layerPathLower.includes('后手持剑') ||
        normalizedPath.includes('后手持剑')
      )
      
      // 检查是否属于持剑图组（排除已经被识别为后手持剑的图层）
      const isHoldSwordGroup = !isBackHandSwordGroup && (
        layerNameLower.includes('持剑') ||
        layerNameLower.includes('holdsword') ||
        layerNameLower.includes('hold_sword') ||
        layerPathLower.includes('持剑') ||
        normalizedPath.includes('持剑')
      )
      
      // 检查是否属于后发图组（兼容"后发"和"发型后"两种命名）
      const isBackHairGroup = (
        layerNameLower.includes('后发') ||
        layerNameLower.includes('发型后') ||
        layerNameLower.includes('backhair') ||
        layerNameLower.includes('back_hair') ||
        layerPathLower.includes('后发') ||
        layerPathLower.includes('发型后') ||
        normalizedPath.includes('后发') ||
        normalizedPath.includes('发型后')
      )
      
      // 检查是否属于阴影图组
      const isShadowGroup = (
        layerNameLower.includes('阴影') ||
        layerNameLower.includes('shadow') ||
        layerPathLower.includes('阴影') ||
        normalizedPath.includes('阴影')
      )
      
      // 检查是否属于摇摇头图组（兼容"摇头"和"摇摇头"）
      const isShakeHeadGroup = (
        layerNameLower.includes('摇摇头') ||
        layerNameLower.includes('摇头') ||
        layerNameLower.includes('shake') ||
        layerNameLower.includes('shakehead') ||
        layerPathLower.includes('摇摇头') ||
        layerPathLower.includes('摇头') ||
        normalizedPath.includes('摇摇头') ||
        normalizedPath.includes('摇头')
      )
      
      // 检查是否属于下压挥剑图组
      const isDownwardSlashGroup = (
        layerNameLower.includes('下压挥剑') ||
        layerNameLower.includes('downwardslash') ||
        layerNameLower.includes('downward_slash') ||
        layerPathLower.includes('下压挥剑') ||
        normalizedPath.includes('下压挥剑')
      )
      
      const isSideGroup = (
        normalizedPath.includes('侧面') || 
        normalizedPath.includes('侧身') || 
        layerPathLower.includes('/side/') ||
        layerPathLower.includes('侧面') ||
        layerPathLower.includes('侧身') ||
        /侧\s*面/.test(layerPathLower) ||
        /侧\s*身/.test(layerPathLower)
      )
      
      const isBackGroup = (
        normalizedPath.includes('背面') || 
        normalizedPath.includes('背影') || 
        normalizedPath.includes('背身') ||
        layerPathLower.includes('/back/') ||
        layerPathLower.includes('背面') ||
        layerPathLower.includes('背影') ||
        layerPathLower.includes('背身') ||
        /背\s*面/.test(layerPathLower) ||
        /背\s*影/.test(layerPathLower) ||
        /背\s*身/.test(layerPathLower)
      )
      
      const isRearGroup = (
        normalizedPath.includes('后面') ||
        layerPathLower.includes('/rear/') ||
        layerPathLower.includes('后面') ||
        /后\s*面/.test(layerPathLower)
      )
      
      // 先检查当前图层是否属于分组成员（用于避免误判）
      const renderCheck = shouldLayerBeRendered(layerPath, allGroupPaths, selectedPathsMap, dynamicState.dynamicExpressionTabs, partsState.userInteracted, partsState.selectedParts)
      const isMemberOfControlledGroup = renderCheck.isGroupMember
      
      // 检查是否是表情相关图组（所有包含"表情"字符串的图组都要过滤）
      const isExpressionRelated = (
        layerNameLower.includes('表情') ||
        layerNameLower.includes('expression') ||
        layerPathLower.includes('表情') ||
        normalizedPath.includes('表情')
      )
      
      // 关键修复：即使是分组成员，也要先检查通用控制（侧面/背面/后面等方向性图层）
      // 这样确保初始化时能正确应用通用控制的默认设置
      const shouldSkipDueToDirectionControl = (
        (isSideGroup && !showSd) ||
        (isBackGroup && !showBk) ||
        (isRearGroup && !showRr)
      )
      
      if (shouldSkipDueToDirectionControl) {
        debugLog(`⏭️ 跳过方向控制的图层（未勾选）: ${layerPath}`)
        // 如果是图层组，跳过整个组
        if (layer.children && layer.children.length > 0) {
          continue
        } else {
          continue
        }
      }
      
      // 如果图层属于前手/后手/动作/表情等分组，或者是表情相关图组，跳过其他通用控制的检测
      if (isMemberOfControlledGroup || isExpressionRelated) {
        // 跳过其他通用控制检测，直接进入后续的分组渲染逻辑
      } else {
        // 只有非分组成员且非表情相关的图组才检测通用控制
        
        // 如果是背景图层，根据控制状态决定是否渲染
        if (isBackground) {
          if (showBg) {
            const hasPart = !!(layer.imageData || layer.canvas)
            if (hasPart) {
              // 检查是否有剪切蒙版
              if (!layer.clipping) {
                const clippingIndices = findClippingGroup(layers, i)
                if (Array.isArray(clippingIndices) && clippingIndices.length > 0) {
                  // 有剪切蒙版，作为一组渲染
                  const clippingLayers = clippingIndices.map(idx => layers[idx])
                  await renderClippingGroup(ctx, layer, clippingLayers, canvas.width, canvas.height, renderLayerToContext)
                  // 标记这些剪切蒙版图层已处理
                  clippingIndices.forEach(idx => processedClippingIndices.add(idx))
                } else {
                  // 没有剪切蒙版，正常渲染
                  await renderLayer(ctx, layer, canvas.width, canvas.height)
                }
              } else {
                // 跳过剪切蒙版背景图层
              }
            }
          } else {
            // 跳过背景图层（未勾选）
          }
          continue
        }

        // 如果是底图，根据控制状态决定是否跳过
        if (isBaseLayer && !showBl && !isBackground && !isSideGroup && !isBackGroup && !isRearGroup) {
          continue
        }

        // 如果是第二底图，根据控制状态决定是否跳过
        if (isSecondBaseLayer && !showSbl && !isBackground && !isSideGroup && !isBackGroup && !isRearGroup) {
          continue
        }

        // 检查各种特殊图组的控制状态
        if (isWeaponGroup && !showWp) {
          continue
        }

        if (isBackHairGroup && !showBh) {
          continue
        }

        if (isShadowGroup && !showSh) {
          continue
        }

        if (isShakeHeadGroup && !showShk) {
          continue
        }

        if (isHoldSwordGroup && !showHs) {
          continue
        }

        if (isBackHandSwordGroup && !showBhs) {
          continue
        }

        if (isDownwardSlashGroup && !showDs) {
          continue
        }
      }
      
      // 正面控制逻辑
      if (!isMemberOfControlledGroup && !isExpressionRelated) {
        if (!showFt && !isSideGroup && !isBackGroup && !isBackground && !isBaseLayer && !isSecondBaseLayer && !isWeaponGroup && !isBackHairGroup && !isShadowGroup && !isShakeHeadGroup && !isHoldSwordGroup && !isBackHandSwordGroup && !isDownwardSlashGroup) {
          continue
        }
      }

      // renderCheck已经在前面计算过了，这里直接使用
      
      // 3、按直接选中、分组成员和独立图层分别处理绘制与剪切组。
      const isDirectSelected = allGroupPaths.has(layerPath) && selectedPathsMap.get(layerPath) === true
      
      if (renderCheck.isGroupMember) {
        // 图层属于某个分组
        // 处理受控组的剪切蒙版
        if (layer.children && layer.children.length > 0 && !layer.clipping) {
          const clippingIndicesForControlledGroup = findClippingGroup(layers, i)
          if (Array.isArray(clippingIndicesForControlledGroup) && clippingIndicesForControlledGroup.length > 0) {
            const clippingLayersForControlledGroup = clippingIndicesForControlledGroup.map(idx => layers[idx])
            await renderGroupWithClippingAdjustments(
              ctx,
              layer,
              clippingLayersForControlledGroup,
              canvas.width,
              canvas.height,
              allGroupPaths,
              selectedPathsMap,
              canvas,
              showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showSh, showShk, showHs, showBhs, showDs,
              layerPath
            )
            clippingIndicesForControlledGroup.forEach(idx => processedClippingIndices.add(idx))
            continue
          }
        }
        
        if (renderCheck.shouldRender) {
          // 受控组剪切处理
          if (layer.children && layer.children.length > 0 && !layer.clipping) {
            const clippingIndicesForControlledGroup = findClippingGroup(layers, i)
            if (Array.isArray(clippingIndicesForControlledGroup) && clippingIndicesForControlledGroup.length > 0) {
              const clippingLayersForControlledGroup = clippingIndicesForControlledGroup.map(idx => layers[idx])
              await renderGroupWithClippingAdjustments(
                ctx,
                layer,
                clippingLayersForControlledGroup,
                canvas.width,
                canvas.height,
                allGroupPaths,
                selectedPathsMap,
                canvas,
                showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showSh, showShk, showHs, showBhs, showDs,
                layerPath
              )
              clippingIndicesForControlledGroup.forEach(idx => processedClippingIndices.add(idx))
              continue
            }
          }
          
          // 是否有直接图像数据
          const hasDirectImageData = !!(layer.imageData || layer.canvas)

          if (hasDirectImageData) {
            // 如果是直接被选中的普通图层，则忽略原始隐藏状态，强制渲染
            if (isDirectSelected) {
              // 检查是否有剪切蒙版
              if (!layer.clipping) {
                const clippingIndices = findClippingGroup(layers, i)
                if (Array.isArray(clippingIndices) && clippingIndices.length > 0) {
                  // 有剪切蒙版，作为一组渲染
                  const clippingLayers = clippingIndices.map(idx => layers[idx])
                  await renderClippingGroup(ctx, layer, clippingLayers, canvas.width, canvas.height, renderLayerToContext)
                  // 标记这些剪切蒙版图层已处理
                  clippingIndices.forEach(idx => processedClippingIndices.add(idx))
                } else {
                  // 没有剪切蒙版，正常渲染
                  await renderLayer(ctx, layer, canvas.width, canvas.height)
                }
              } else {
                // 跳过剪切蒙版图层
              }
            } else {
              // 否则保持原始PSD可见性
              if (layer.hidden || layer.visible === false) {
                // 跳过隐藏图层
              } else {
                
                // 检查是否有剪切蒙版
                if (!layer.clipping) {
                  const clippingIndices = findClippingGroup(layers, i)
                  if (Array.isArray(clippingIndices) && clippingIndices.length > 0) {
                    // 有剪切蒙版，作为一组渲染
                    const clippingLayers = clippingIndices.map(idx => layers[idx])
                    await renderClippingGroup(ctx, layer, clippingLayers, canvas.width, canvas.height, renderLayerToContext)
                    // 标记这些剪切蒙版图层已处理
                    clippingIndices.forEach(idx => processedClippingIndices.add(idx))
                  } else {
                    // 没有剪切蒙版，正常渲染
                    await renderLayer(ctx, layer, canvas.width, canvas.height)
                  }
                } else {
                  // 跳过剪切蒙版图层
                }
              }
            }
          } else if (layer.children && layer.children.length > 0) {
            // 图层组，但没有直接图像数据，继续递归处理子项
          }
        } else {
          // 属于分组但未被选中
        }
      } else {
        // 不属于任何分组的独立图层
        if (!(layer.hidden || layer.visible === false)) {
          // 独立的可见图层，应该渲染
          const hasPart = !!(layer.imageData || layer.canvas)

          if (hasPart) {
            // 检查是否有剪切蒙版
            if (!layer.clipping) {
              const clippingIndices = findClippingGroup(layers, i)
              if (Array.isArray(clippingIndices) && clippingIndices.length > 0) {
                // 有剪切蒙版，作为一组渲染
                const clippingLayers = clippingIndices.map(idx => layers[idx])
                await renderClippingGroup(ctx, layer, clippingLayers, canvas.width, canvas.height, renderLayerToContext)
                // 标记这些剪切蒙版图层已处理
                clippingIndices.forEach(idx => processedClippingIndices.add(idx))
              } else {
                // 没有剪切蒙版，正常渲染
                await renderLayer(ctx, layer, canvas.width, canvas.height)
              }
            } else {
              // 跳过剪切蒙版图层
            }
          }
        } else {
          // 跳过隐藏的独立图层
        }
      }
      
      // 4、递归处理子图层，同名计数在每层重新开始。
      if (layer.children && layer.children.length > 0) {
        await renderLayersWithAllGroupFilters(ctx, layer.children, allGroupPaths, selectedPathsMap, canvas, showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showRr, showSh, showShk, showHs, showBhs, showDs, layerPath, new Map())
      }
    }
  }

  /**
   * 以组为基准渲染：
   * - 先将组内内容渲染到临时canvas
   * - 再依次应用剪切层
   * - 最终按组的alpha作为遮罩输出
   * 处理流程：
   * 1、把组内图层绘制到临时画布。
   * 2、叠加非调整类型的剪切图层。
   * 3、重新绘制组透明度并作为遮罩。
   * 4、将组结果合成到目标画布。
   */
  const renderGroupWithClippingAdjustments = async (
    ctx,
    groupLayer,
    clippingLayers,
    canvasWidth,
    canvasHeight,
    allGroupPaths,
    selectedPathsMap,
    canvas,
    showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showSh, showShk, showHs, showBhs, showDs,
    parentPath
  ) => {
    // 1、将组内容渲染到临时画布。
    const groupCanvas = document.createElement('canvas')
    groupCanvas.width = canvasWidth
    groupCanvas.height = canvasHeight
    const groupCtx = groupCanvas.getContext('2d', { willReadFrequently: true })
    
    // 递归渲染组内所有子图层
    await renderLayersWithAllGroupFilters(
      groupCtx,
      groupLayer.children || [],
      allGroupPaths,
      selectedPathsMap,
      canvas,
      showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showRr, showSh, showShk, showHs, showBhs, showDs,
      parentPath ? `${parentPath}/${groupLayer.name}` : groupLayer.name,
      new Map()
    )

    // 2、依次应用剪切层。
    for (const clippingLayer of clippingLayers) {
      // 跳过调整图层
      if (clippingLayer.adjustment || clippingLayer.type === 'adjustment') {
        debugLog(`⏭️ 跳过调整图层: ${clippingLayer.name}`)
        continue
      }
      
      await renderLayerToContext(groupCtx, clippingLayer, canvasWidth, canvasHeight)
    }

    // 3、使用组自身的透明度作为遮罩。
    const maskCanvas = document.createElement('canvas')
    maskCanvas.width = canvasWidth
    maskCanvas.height = canvasHeight
    const maskCtx = maskCanvas.getContext('2d')
    await renderLayersWithAllGroupFilters(
      maskCtx,
      groupLayer.children || [],
      allGroupPaths,
      selectedPathsMap,
      canvas,
      showBg, showBl, showSbl, showWp, showBh, showFt, showSd, showBk, showRr, showSh, showShk, showHs, showBhs, showDs,
      parentPath ? `${parentPath}/${groupLayer.name}` : groupLayer.name,
      new Map()
    )

    // 应用 destination-in 遮罩
    groupCtx.globalCompositeOperation = 'destination-in'
    groupCtx.drawImage(maskCanvas, 0, 0)
    groupCtx.globalCompositeOperation = 'source-over'

    // 4、输出到主画布。
    ctx.drawImage(groupCanvas, 0, 0)
  }

  /**
   * 渲染单个图层
   * 处理流程：
   * 1、取得图片源并异步加载，设置加载超时保护。
   * 2、检查尺寸，应用透明度与混合模式。
   * 3、按需处理蒙版并绘制，恢复上下文状态。
   */
  const renderLayer = async (ctx, layer, canvasWidth, canvasHeight) => {
    // 1、将图片加载过程包装为可等待任务。
    return new Promise((resolve, reject) => {
      try {
        // 优先使用imageData（base64），其次使用canvas
        const imageSource = layer.imageData || (layer.canvas ? layer.canvas.toDataURL?.() : null)
        
        if (!imageSource) {
          debugWarn(`⚠️ 图层 ${layer.name} 没有图像源`)
          resolve()
          return
        }
        
        debugLog(`🔄 加载图层图像: ${layer.name}`)
        debugLog(`📏 图像数据长度: ${imageSource.length} 字符`)
        debugLog(`🔍 图像数据格式:`, imageSource.substring(0, 50))
        
        const img = new Image()
        
        // 设置超时保护
        const timeout = setTimeout(() => {
          console.error(`⏱️ 图层 ${layer.name} 加载超时`) 
          // 超时不阻塞整帧，记录并继续
          resolve()
        }, 5000)
        
        img.onload = async () => {
          clearTimeout(timeout)
          try {
            debugLog(`✓ 图片加载完成: ${layer.name}, 尺寸: ${img.width}x${img.height}`)
            
            // 保持原始坐标精度，避免与蒙版位置不匹配
            let x = layer.left || 0
            let y = layer.top || 0
            let width = layer.width || img.width
            let height = layer.height || img.height
            
            debugLog(`📐 绘制参数:`, {
              位置: `(${x}, ${y})`,
              尺寸: `${width}x${height}`,
              图片尺寸: `${img.width}x${img.height}`,
              透明度: (layer.opacity || 255) / 255,
              Canvas像素尺寸: `${canvasWidth}x${canvasHeight}`,
              Canvas显示尺寸: `${canvasStyle.value.width} x ${canvasStyle.value.height}`,
              滚动模式: scrollMode.value,
              缩放比例: canvasScale.value,
              有蒙版: !!layer.mask
            })
            
            // 2、验证绘制参数并配置当前图层的透明度与混合模式。
            if (width <= 0 || height <= 0) {
              debugWarn(`⚠️ 图层 ${layer.name} 尺寸无效: ${width}x${height}`)
              resolve()
              return
            }
            
            // 保存当前状态
            ctx.save()
            
            // 设置高质量渲染
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            
            // 设置透明度
            let opacity = (layer.opacity !== undefined ? layer.opacity : 255) / 255
            
            if (opacity < 0.1 && layer.opacity > 0) {
              debugWarn(`⚠️ 图层 ${layer.name} 透明度异常: ${opacity} (原始值: ${layer.opacity})，调整为不透明`)
              opacity = 1.0
            }
            
            ctx.globalAlpha = opacity
            debugLog(`🎨 设置透明度: ${opacity} (原始值: ${layer.opacity})`)
            
            // 设置混合模式（如果支持）
            if (layer.blendMode && layer.blendMode !== 'normal') {
              const blendModeMap = {
                'multiply': 'multiply',
                'screen': 'screen',
                'overlay': 'overlay',
                'darken': 'darken',
                'lighten': 'lighten',
                'color-dodge': 'color-dodge',
                'color-burn': 'color-burn',
                'hard-light': 'hard-light',
                'soft-light': 'soft-light',
                'difference': 'difference',
                'exclusion': 'exclusion'
              }
              const mappedMode = blendModeMap[layer.blendMode] || 'source-over'
              ctx.globalCompositeOperation = mappedMode
              debugLog(`🎨 混合模式: ${layer.blendMode} -> ${mappedMode}`)
            }
            
            // 3、有蒙版时先在临时画布处理透明区域，再合成到目标。
            if (layer.mask && !layer.mask.disabled && layer.mask.imageData) {
              
              // 创建临时canvas用于应用蒙版
              const tempCanvas = document.createElement('canvas')
              tempCanvas.width = canvasWidth
              tempCanvas.height = canvasHeight
              const tempCtx = tempCanvas.getContext('2d', {
                alpha: true,
                willReadFrequently: false
              })
              
              // 在临时canvas上绘制图层内容（使用高质量设置）
              tempCtx.imageSmoothingEnabled = true
              tempCtx.imageSmoothingQuality = 'high'
              tempCtx.globalAlpha = 1.0
              tempCtx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)
              
              // 通用：按PSD规则应用图层蒙版
              await applyLayerMask(tempCtx, layer, x, y, width, height, canvasWidth, canvasHeight)
              
              // 将应用了蒙版的内容绘制到主canvas（保持原有透明度）
              const hasVisible = regionHasVisiblePixel(tempCtx, { x, y, w: width, h: height })
              if (hasVisible) {
                ctx.imageSmoothingEnabled = false  // 临时canvas到主canvas不需要平滑
                ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight)
              } else {
                debugWarn('⚠️ [mask] 应用后区域无可见像素，跳过绘制:', layer.name)
              }
            } else {
              // 无蒙版，直接绘制图层
              ctx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)
            }
            
            // 恢复状态
            ctx.restore()
            
            resolve()
          } catch (error) {
            console.error(`❌ 绘制图层 ${layer.name} 失败:`, error)
            console.error('错误堆栈:', error.stack)
            ctx.restore()
            // 单层失败不中断整帧
            resolve()
          }
        }
        
        img.onerror = (error) => {
          console.error(`❌ 图层 ${layer.name} 图像加载失败:`, error)
          console.error(`图像源前100字符:`, imageSource.substring(0, 100))
          // 单层失败不中断整帧
          resolve()
        }
        
        // 设置图像源
        img.src = imageSource
        
      } catch (error) {
        console.error(`❌ 处理图层 ${layer.name} 失败:`, error)
        console.error('错误堆栈:', error.stack)
        reject(error)
      }
    })
  }

  // 3、返回渲染状态与各级渲染入口。
  // ==================== 导出 ====================
  
  return {
    // 渲染状态
    isRendering,
    
    // 渲染函数
    refreshCanvas,
    renderAllLayers,
    renderPart,
    renderLayer,
    renderLayersWithAllGroupFilters,
    renderGroupWithClippingAdjustments
  }
}

