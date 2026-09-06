/**
 * 图层树交互逻辑
 * 管理图层树的显示、操作记录、可见性控制和渲染
 */

import { ref } from 'vue'
import { createPerformanceLogger } from '@renderer/utils/performanceLogger.js'

const isProduction = import.meta?.env?.MODE === 'production'
/**
 * 输出开发环境图层诊断信息。
 * 处理流程：
 * 1、仅在非生产环境转发日志。
 */
const debugLog = (...args) => {
  // 1、避免生产环境输出高频图层日志。
  if (!isProduction) globalThis.console.log(...args)
}
/**
 * 输出开发环境图层警告。
 * 处理流程：
 * 1、仅在非生产环境转发警告。
 */
const debugWarn = (...args) => {
  // 1、按运行环境决定是否输出警告。
  if (!isProduction) globalThis.console.warn(...args)
}
const perfLogger = createPerformanceLogger('layer-tree')

/**
 * 图层树交互逻辑 Composable
 * 处理流程：
 * 1、初始化图层树、操作记录和控制优先级。
 * 2、提供可见性同步、状态恢复与画布渲染方法。
 * 3、返回页面所需的状态及操作接口。
 * @param {Object} deps - 依赖项
 * @param {Ref} deps.currentPsdData - 当前PSD数据
 * @param {Ref} deps.canvasRef - Canvas引用
 * @param {Ref} deps.selectedParts - 选中的部件
 * @param {Ref} deps.showFront - 是否显示正面
 * @param {Ref} deps.showSide - 是否显示侧面
 * @param {Ref} deps.showBack - 是否显示背面
 * @param {Ref} deps.showRear - 是否显示后面
 * @param {Ref} deps.showBackground - 是否显示背景
 * @param {Ref} deps.showBaseLayer - 是否显示最下层白色背景
 * @param {Ref} deps.showSecondBaseLayer - 是否显示次下层白色背景
 * @param {Object} deps.message - Naive UI message对象
 * @param {Function} deps.onRenderTrigger - 触发重新渲染的回调
 * @param {Function} deps.findClippingGroup - 查找剪切蒙版组
 * @param {Function} deps.renderClippingGroup - 渲染剪切蒙版组
 * @param {Function} deps.applyLayerMask - 应用图层蒙版
 * @param {Function} deps.drawLayerImage - 绘制图层图像
 */
export function useLayerTree(deps) {
  // 1、复用注入的 PSD、画布和通用控制状态。
  const {
    currentPsdData,
    canvasRef,
    selectedParts,
    showFront,
    showSide,
    showBack,
    showRear,
    showBackground,
    showBaseLayer,
    showSecondBaseLayer,
    selectHeadOnly,
    selectNonHead,
    message,
    onRenderTrigger,
    findClippingGroup,
    renderClippingGroup,
    applyLayerMask,
    drawLayerImage
  } = deps

  // ==================== 状态 ====================
  
  const layerTreeData = ref([]) // 图层树数据
  const layerTreeOperations = ref({}) // 记录用户通过图层树的操作：{ '图层路径': { name: '图层名', visible: true/false, changed: true } }
  const selectedLayersMap = ref({}) // 选中的图层映射 { layerName: true/false }
  const controlPriority = ref('parts') // 'layerTree' 或 'parts'，记录最后一次操作的来源
  
  // 2、组织树节点构造、交互同步和图像渲染流程。
  // ==================== 构建图层树 ====================
  
  /**
   * 从PSD数据构建图层树
   * 处理流程：
   * 1、兼容两种图层结构并检查数据。
   * 2、生成唯一路径节点及默认表情状态，倒序返回树列表。
   * @param {Object} psdData - PSD数据对象
   * @returns {Array} 图层树数组
   */
  const buildLayerTree = (psdData) => {
    // 1、兼容解析后的层级数据与原始子图层结构。
    debugLog('🔧 buildLayerTree 接收的数据:', psdData)
    
    // 支持多种数据结构：psdData.layerHierarchy 或 psdData.children
    const layers = psdData?.layerHierarchy || psdData?.children
    
    if (!layers || layers.length === 0) {
      debugWarn('⚠️ 无法找到图层数据，psdData 结构:', Object.keys(psdData || {}))
      return []
    }
    
    debugLog('✅ 找到图层数据，数量:', layers.length)
    
    // 2、生成树节点，并对非嵌套表情组选择默认子项。
    /**
     * 递归构造单个图层树节点。
     * 处理流程：
     * 1、统计同名图层并保存原始可见性。
     * 2、递归子项，识别表情组的嵌套结构。
     * 3、对适用的表情组初始化互斥选择。
     */
    const buildNode = (layer, nameCountMap = new Map(), parentPath = [], skipExpressionMutex = false) => {
      // 1、生成同级唯一名称并保留不同用途的可见性状态。
      const layerName = layer.name
      
      // 处理同名图层：添加索引后缀（与 extractDirectChildren 保持一致）
      let uniqueName = layerName
      if (nameCountMap.has(layerName)) {
        const count = nameCountMap.get(layerName)
        nameCountMap.set(layerName, count + 1)
        uniqueName = `${layerName}#${count + 1}`
      } else {
        nameCountMap.set(layerName, 1)
      }
      
      const node = {
        name: layerName, // 原始名称（用于显示）
        uniqueName: uniqueName, // 唯一名称（用于路径）
        type: layer.type, // 'group' or 'layer'
        visible: layer.visible !== false, // 最终可见性状态（包括正面控制）
        originalVisible: layer.visible !== false, // PSD原始状态
        userVisible: layer.visible !== false, // 用户操作状态（不包括正面控制）
        children: []
      }
      
      // 2、递归处理子图层并倒序展示，保留嵌套表情的原始选择。
      if (layer.children && layer.children.length > 0) {
        // 为子图层创建新的计数器
        const childNameCountMap = new Map()
        const currentPath = [...parentPath, uniqueName]
        const fullPath = currentPath.join('/')
        
        // 检查是否是表情图组（通过路径或名称判断）
        const isExpressionGroup = /表情|豆豆眼|专属表情|辅助表情|眼睛|嘴|眉毛/.test(fullPath) || 
                                  /表情|豆豆眼|专属表情|辅助表情/.test(layerName)
        
        // 检查表情图组的子项中是否有图组（有嵌套结构）
        const hasChildGroups = isExpressionGroup && layer.children.some(child => 
          child.children && child.children.length > 0
        )
        
        // 如果是表情图组，确保图组本身是可见的
        if (isExpressionGroup && !skipExpressionMutex) {
          node.visible = true
          node.userVisible = true
          debugLog(`✅ 表情图组本身设置为可见: ${layerName}`)
        }
        
        // 如果表情图组有嵌套结构，输出日志
        if (hasChildGroups) {
          debugLog(`ℹ️ 表情图组 "${layerName}" 有嵌套结构，保持所有子项的原始可见性`)
        }
        
        node.children = layer.children.map((child, index) => {
          // 如果父级是有嵌套结构的表情图组，或者已标记跳过互斥，传递给子级
          const shouldSkipMutex = skipExpressionMutex || hasChildGroups
          const childNode = buildNode(child, childNameCountMap, currentPath, shouldSkipMutex)
          
          return childNode
        }).reverse()
        
        // 3、没有嵌套结构的表情组只显示默认子项。
        if (!skipExpressionMutex && !hasChildGroups && isExpressionGroup && layer.type === 'group') {
          // 先找到应该显示的图层（优先"基础"，其次第一个）
          let defaultIndex = layer.children.findIndex(child => 
            child.name === '基础' || child.name === '基本' || child.name === '默认'
          )
          if (defaultIndex === -1) {
            defaultIndex = 0  // 没有"基础"，使用第一个
          }
          
          // 注意：node.children 已经 reverse 了，所以索引要转换
          const reversedDefaultIndex = node.children.length - 1 - defaultIndex
          
          node.children.forEach((childNode, reverseIndex) => {
            if (reverseIndex === reversedDefaultIndex) {
              childNode.visible = true
              childNode.userVisible = true
              debugLog(`✅ 初始化显示默认表情: ${childNode.name} (路径: ${fullPath}/${childNode.name})`)
            } else {
              childNode.visible = false
              childNode.userVisible = false
              debugLog(`🔧 初始化隐藏表情子图层: ${childNode.name} (路径: ${fullPath}/${childNode.name})`)
            }
          })
        }
      }
      
      return node
    }
    
    // 倒序展示图层（从下到上）
    // 为顶层图层创建计数器
    const topLevelNameCountMap = new Map()
    const result = layers.map(layer => buildNode(layer, topLevelNameCountMap)).reverse()
    debugLog('📊 构建的图层树（已倒序，含唯一名称）:', result)
    return result
  }
  
  // ==================== 图层可见性控制 ====================
  
  /**
   * 处理图层可见性变化
   * 处理流程：
   * 1、切换控制来源并记录目标图层操作。
   * 2、更新树节点、祖先及表情子项状态。
   * 3、将相应可见性同步到 PSD 数据并触发渲染。
   * @param {Object} params - 参数对象
   * @param {string} params.layerPath - 图层路径（使用uniqueName）
   * @param {boolean} params.visible - 可见性
   */
  const handleLayerVisibilityChange = ({ layerPath, visible }) => {
    // 1、记录本次图层树操作，覆盖部件选择的控制优先级。
    debugLog('🔄🔄🔄 [图层树] 可见性变化:', layerPath, '→', visible)
    
    // 设置控制优先级为图层树
    controlPriority.value = 'layerTree'
    debugLog('✅ [图层树] 控制优先级切换为: 图层树')
    
    // 记录用户操作：提取图层名称（路径的最后一部分）
    const layerName = layerPath.split('/').pop()
    layerTreeOperations.value[layerPath] = {
      name: layerName,
      visible: visible,
      changed: true
    }
    debugLog('📝 记录图层操作:', layerName, '→', visible ? '开启' : '关闭')
    
    // 将路径拆分为数组
    const pathParts = layerPath.split('/')
    
    // 2、按唯一名称路径更新树节点及关联的祖先、子项。
    /**
     * 沿目标路径修改树节点的可见性。
     * 处理流程：
     * 1、按路径递归，收集祖先节点。
     * 2、更新用户状态与通用控制后的最终状态。
     * 3、同步祖先显示以及表情组默认子项。
     */
    const updateVisibility = (layers, pathIndex = 0, currentPath = [], ancestorsToUpdate = []) => {
      // 1、使用同名后缀区分目标节点。
      for (let layer of layers) {
        // 使用uniqueName进行匹配（处理同名图层）
        if (layer.uniqueName === pathParts[pathIndex]) {
          if (pathIndex === pathParts.length - 1) {
            // 到达目标图层
            
            // 🔧 如果设置为可见，先确保所有祖先图层都可见
            if (visible && ancestorsToUpdate.length > 0) {
              ancestorsToUpdate.forEach((ancestor) => {
                if (!ancestor.visible) {
                  // 只设置 visible，不修改 userVisible
                  ancestor.visible = true
                }
              })
            }
            
            // 2、分别保存用户选择和经过通用控制过滤的显示状态。
            layer.userVisible = visible
            
            // 计算最终visible（考虑正面控制）
            const fullPath = [...currentPath, layer.uniqueName].join('/')
            const isSpecialGroup = /(侧面|侧身|侧视|背面|背影|背身|背视|后面|背景|武器|阴影|摇摇头|持剑|后手持剑|下压挥剑|后发|后头发|发型后)/.test(fullPath)
            
            if (showFront.value || isSpecialGroup) {
              layer.visible = visible
            } else {
              // 正面关闭时，非特殊图组强制隐藏
              layer.visible = false
            }
            
            // 🔧 如果设置为不可见，检查并更新祖先图层的可见性
            if (!visible && ancestorsToUpdate.length > 0) {
              for (let i = ancestorsToUpdate.length - 1; i >= 0; i--) {
                const ancestor = ancestorsToUpdate[i]
                const hasVisibleChildren = ancestor.children && ancestor.children.some(child => child.visible || child.userVisible)
                
                if (!hasVisibleChildren) {
                  ancestor.visible = false
                } else {
                  break
                }
              }
            }
            
            debugLog(`✅ [图层树] 更新图层: ${layerPath} → userVisible: ${visible}, visible: ${layer.visible}`)
            debugLog(`   [图层树] 图层对象:`, { name: layer.name, uniqueName: layer.uniqueName, type: layer.type })
            
            // 3、表情组启用时补默认子项，关闭时隐藏其直接子项。
            if (layer.type === 'group' && layer.children && layer.children.length > 0) {
              // 检查是否是表情图层组（路径包含"表情"）
              const isExpressionGroup = /表情|豆豆眼|专属表情|辅助表情|眼睛|嘴|眉毛/.test(fullPath)
              
              if (isExpressionGroup) {
                if (visible) {
                  // 勾选表情组：检查是否已有可见的子图层
                  const hasVisibleChild = layer.children.some(child => child.userVisible || child.visible)
                  
                  if (!hasVisibleChild) {
                    // 没有可见的子图层，自动显示默认子图层
                    debugLog(`🔧 [图层树] 表情图层组无可见子图层，自动显示默认子图层`)
                    
                    // 查找"基础"子图层
                    let defaultChild = layer.children.find(child => child.name === '基础' || child.uniqueName === '基础')
                    
                    // 如果没有"基础"，使用第一个子图层
                    if (!defaultChild && layer.children.length > 0) {
                      defaultChild = layer.children[0]
                    }
                    
                    if (defaultChild) {
                      debugLog(`   🔧 自动显示子图层: ${defaultChild.uniqueName}`)
                      defaultChild.userVisible = true
                      defaultChild.visible = true
                    }
                  } else {
                    debugLog(`🔧 [图层树] 表情图层组已有可见子图层，保持不变`)
                  }
                } else {
                  // 取消勾选表情组：隐藏所有子图层
                  debugLog(`🔧 [图层树] 表情图层组取消勾选，隐藏所有子图层`)
                  layer.children.forEach(child => {
                    child.userVisible = false
                    child.visible = false
                  })
                }
              }
            }
            
            return true
          } else if (layer.children && layer.children.length > 0) {
            // 将当前图层添加到祖先列表中
            const newAncestors = [...ancestorsToUpdate, layer]
            // 继续在子图层中查找
            return updateVisibility(layer.children, pathIndex + 1, [...currentPath, layer.uniqueName], newAncestors)
          }
        }
      }
      return false
    }
    
    updateVisibility(layerTreeData.value)
    
    // 3、按一致的同名计数同步 PSD 数据，然后触发页面渲染。
    if (currentPsdData.value && currentPsdData.value.layerHierarchy) {
      /**
       * 把目标图层的可见性写回 PSD 层级。
       * 处理流程：
       * 1、按同名序号定位目标及祖先。
       * 2、同步目标、表情子项和祖先的可见性。
       */
      const updatePsdVisibility = (layers, pathIndex = 0, nameCountMap = new Map(), psdAncestors = []) => {
        // 1、复现树节点命名规则以定位原始图层。
        for (let layer of layers) {
          const layerName = layer.name
          
          // 处理同名图层：添加索引后缀
          let uniqueName = layerName
          if (nameCountMap.has(layerName)) {
            const count = nameCountMap.get(layerName)
            nameCountMap.set(layerName, count + 1)
            uniqueName = `${layerName}#${count + 1}`
          } else {
            nameCountMap.set(layerName, 1)
          }
          
          if (uniqueName === pathParts[pathIndex]) {
            if (pathIndex === pathParts.length - 1) {
              // 到达目标图层
              
              // 🔧 如果设置为可见，先设置所有祖先图层可见
              if (visible && psdAncestors.length > 0) {
                psdAncestors.forEach(ancestor => {
                  if (ancestor.visible === false) {
                    ancestor.visible = true
                  }
                })
              }
              
              // 2、写回目标状态，并处理关联表情组与祖先。
              layer.visible = visible
              
              // 🔧 特殊处理：如果是表情图层组，同步子图层
              const isExpressionGroup = /表情|豆豆眼|专属表情|辅助表情|眼睛|嘴|眉毛/.test(layerPath)
              if (isExpressionGroup && layer.type === 'group' && layer.children && layer.children.length > 0) {
                if (visible) {
                  // 勾选表情组：检查是否已有可见的子图层
                  const hasVisibleChild = layer.children.some(child => child.visible !== false)
                  
                  if (!hasVisibleChild) {
                    // 没有可见的子图层，查找并显示"基础"子图层
                    debugLog(`   🔧 [PSD数据] 表情组无可见子图层，自动显示默认子图层`)
                    let defaultChild = layer.children.find(child => child.name === '基础')
                    if (!defaultChild && layer.children.length > 0) {
                      defaultChild = layer.children[0]
                    }
                    
                    if (defaultChild) {
                      debugLog(`   🔧 [PSD数据] 自动显示子图层: ${defaultChild.name}`)
                      defaultChild.visible = true
                    }
                  } else {
                    debugLog(`   🔧 [PSD数据] 表情组已有可见子图层，保持不变`)
                  }
                } else {
                  // 取消勾选表情组：隐藏所有子图层
                  debugLog(`   🔧 [PSD数据] 隐藏所有子图层`)
                  layer.children.forEach(child => {
                    child.visible = false
                  })
                }
              }
              
              // 🔧 如果设置为不可见，检查祖先图层
              if (!visible && psdAncestors.length > 0) {
                for (let i = psdAncestors.length - 1; i >= 0; i--) {
                  const ancestor = psdAncestors[i]
                  const hasVisibleChildren = ancestor.children && ancestor.children.some(child => child.visible !== false)
                  
                  if (!hasVisibleChildren) {
                    ancestor.visible = false
                  } else {
                    break
                  }
                }
              }
              
              debugLog(`✅ 更新PSD数据: ${layerPath} → visible: ${visible}`)
              return true
            } else if (layer.children && layer.children.length > 0) {
              // 将当前图层添加到PSD祖先列表
              const newPsdAncestors = [...psdAncestors, layer]
              // 继续在子图层中查找，使用新的计数器
              const childNameCountMap = new Map()
              return updatePsdVisibility(layer.children, pathIndex + 1, childNameCountMap, newPsdAncestors)
            }
          }
        }
        return false
      }
      const topLevelNameCountMap = new Map()
      updatePsdVisibility(currentPsdData.value.layerHierarchy, 0, topLevelNameCountMap, [])
    }
    
    // 触发重新渲染
    debugLog('🎨 [图层树] 准备触发渲染回调')
    if (onRenderTrigger) {
      debugLog('🎨 [图层树] 调用 onRenderTrigger()')
      onRenderTrigger()
    } else {
      debugWarn('⚠️ [图层树] onRenderTrigger 未定义')
    }
  }
  
  // ==================== 图层状态恢复 ====================
  
  /**
   * 处理恢复初始状态（三击）
   * 处理流程：
   * 1、清除目标操作记录并定位节点。
   * 2、在全部隐藏和恢复初始状态之间切换。
   * 3、同步 PSD 可见性并触发渲染。
   * @param {Object} params - 参数对象
   * @param {string} params.layerPath - 图层路径（使用uniqueName）
   */
  const handleRestoreInitialState = ({ layerPath }) => {
    // 1、清空该图层的操作记录并切换为图层树控制。
    delete layerTreeOperations.value[layerPath]
    debugLog('🧹 清除图层操作记录:', layerPath)
    debugLog('🔄🔄🔄 三击恢复初始状态:', layerPath)
    
    // 设置控制优先级为图层树
    controlPriority.value = 'layerTree'
    
    // 将路径拆分为数组
    const pathParts = layerPath.split('/')
    
    /**
     * 检查节点及所有后代是否均隐藏。
     * 处理流程：
     * 1、当前节点隐藏时继续检查子项，否则返回否。
     */
    const checkAllHidden = (layer) => {
      // 1、需要节点自身与全部后代都隐藏才满足条件。
      if (!layer.visible) {
        // 如果当前图层隐藏，检查所有子项
        if (layer.children && layer.children.length > 0) {
          return layer.children.every(child => checkAllHidden(child))
        }
        return true
      }
      return false
    }
    
    /**
     * 递归恢复节点原始可见性。
     * 处理流程：
     * 1、读取原始状态并继续恢复子项。
     */
    const restoreLayerAndChildren = (layer) => {
      // 1、没有原始状态记录时按可见处理。
      layer.visible = layer.originalVisible !== undefined ? layer.originalVisible : true
      if (layer.children && layer.children.length > 0) {
        layer.children.forEach(child => restoreLayerAndChildren(child))
      }
    }
    
    /**
     * 递归隐藏节点及所有后代。
     * 处理流程：
     * 1、隐藏当前节点，再递归子节点。
     */
    const hideLayerAndChildren = (layer) => {
      // 1、逐层清除最终显示状态。
      layer.visible = false
      if (layer.children && layer.children.length > 0) {
        layer.children.forEach(child => hideLayerAndChildren(child))
      }
    }
    
    // 2、定位目标子树，并在全部隐藏和原始状态之间切换。
    /**
     * 查找目标节点并切换整棵子树状态。
     * 处理流程：
     * 1、按唯一路径递归定位节点。
     * 2、全部隐藏时恢复原始状态，否则隐藏整棵子树。
     */
    const findAndToggle = (layers, pathIndex = 0) => {
      // 1、沿目标路径定位要批量处理的节点。
      for (let layer of layers) {
        if (layer.uniqueName === pathParts[pathIndex]) {
          if (pathIndex === pathParts.length - 1) {
            // 2、根据整棵子树当前状态决定隐藏或恢复。
            const allHidden = checkAllHidden(layer)
            
            if (allHidden) {
              // 如果全部隐藏，则恢复到初始状态
              restoreLayerAndChildren(layer)
              debugLog(`✅ 恢复图层树到初始状态: ${layerPath} 及所有子项`)
            } else {
              // 如果不是全部隐藏，则全部隐藏
              hideLayerAndChildren(layer)
              debugLog(`✅ 隐藏图层树: ${layerPath} 及所有子项`)
            }
            return true
          } else if (layer.children && layer.children.length > 0) {
            return findAndToggle(layer.children, pathIndex + 1)
          }
        }
      }
      return false
    }
    
    findAndToggle(layerTreeData.value)
    
    // 3、同步更新 PSD 数据并请求重新渲染。
    if (currentPsdData.value && currentPsdData.value.layerHierarchy) {
      /**
       * 递归同步树节点与 PSD 图层的显示状态。
       * 处理流程：
       * 1、同步当前节点，再以同名计数匹配子图层并递归。
       */
      const syncPsdLayerAndChildren = (treeLayer, psdLayer) => {
        // 1、逐个匹配后代图层并写回树中的可见性。
        psdLayer.visible = treeLayer.visible
        if (treeLayer.children && psdLayer.children && treeLayer.children.length > 0 && psdLayer.children.length > 0) {
          // 为PSD子图层建立名称计数
          const psdChildNameCountMap = new Map()
          treeLayer.children.forEach(treeChild => {
            // 在PSD子图层中找到对应的图层（按顺序匹配uniqueName）
            let matchedPsdChild = null
            for (let psdChild of psdLayer.children) {
              const psdChildName = psdChild.name
              let psdUniqueName = psdChildName
              if (psdChildNameCountMap.has(psdChildName)) {
                const count = psdChildNameCountMap.get(psdChildName)
                psdChildNameCountMap.set(psdChildName, count + 1)
                psdUniqueName = `${psdChildName}#${count + 1}`
              } else {
                psdChildNameCountMap.set(psdChildName, 1)
              }
              
              if (psdUniqueName === treeChild.uniqueName) {
                matchedPsdChild = psdChild
                break
              }
            }
            
            if (matchedPsdChild) {
              syncPsdLayerAndChildren(treeChild, matchedPsdChild)
            }
          })
        }
      }
      
      /**
       * 在图层树内查找当前目标路径。
       * 处理流程：
       * 1、按路径分段递归，返回匹配节点或空值。
       */
      const findTreeLayer = (layers, pathIndex = 0) => {
        // 1、使用唯一名称避免同名节点混淆。
        for (let layer of layers) {
          if (layer.uniqueName === pathParts[pathIndex]) {
            if (pathIndex === pathParts.length - 1) {
              return layer
            } else if (layer.children && layer.children.length > 0) {
              return findTreeLayer(layer.children, pathIndex + 1)
            }
          }
        }
        return null
      }
      
      /**
       * 定位原始 PSD 目标并同步其子树状态。
       * 处理流程：
       * 1、重建同名序号，沿路径查找 PSD 图层。
       * 2、找到目标后读取对应树节点并递归同步。
       */
      const findAndSyncPsd = (layers, pathIndex = 0, nameCountMap = new Map()) => {
        // 1、按树路径规则查找原始图层。
        for (let layer of layers) {
          const layerName = layer.name
          
          // 处理同名图层：添加索引后缀
          let uniqueName = layerName
          if (nameCountMap.has(layerName)) {
            const count = nameCountMap.get(layerName)
            nameCountMap.set(layerName, count + 1)
            uniqueName = `${layerName}#${count + 1}`
          } else {
            nameCountMap.set(layerName, 1)
          }
          
          if (uniqueName === pathParts[pathIndex]) {
            if (pathIndex === pathParts.length - 1) {
              // 2、找到对应的树图层，同步目标与子项状态。
              const treeLayer = findTreeLayer(layerTreeData.value, 0)
              if (treeLayer) {
                syncPsdLayerAndChildren(treeLayer, layer)
                debugLog(`✅ 同步PSD数据: ${layerPath} 及所有子项`)
              }
              return true
            } else if (layer.children && layer.children.length > 0) {
              // 继续在子图层中查找，使用新的计数器
              const childNameCountMap = new Map()
              return findAndSyncPsd(layer.children, pathIndex + 1, childNameCountMap)
            }
          }
        }
        return false
      }
      
      const topLevelNameCountMap = new Map()
      findAndSyncPsd(currentPsdData.value.layerHierarchy, 0, topLevelNameCountMap)
    }
    
    // 触发重新渲染
    if (onRenderTrigger) {
      onRenderTrigger()
    }
  }
  
  /**
   * 批量切换功能（已弃用，保留以防兼容性问题）
   * 处理流程：
   * 1、记录弃用提示，保留调用兼容性。
   * @param {Object} params - 参数对象
   * @param {string} params.layerPath - 图层路径
   */
  const handleBatchToggleVisibility = ({ layerPath }) => {
    // 1、此入口只记录提示，不执行图层切换。
    debugLog('handleBatchToggleVisibility 已弃用')
  }
  
  /**
   * 清空图层树操作记录
   * 处理流程：
   * 1、重置操作映射。
   */
  const clearLayerTreeOperations = () => {
    // 1、移除当前 PSD 的手动可见性操作记录。
    layerTreeOperations.value = {}
    debugLog('🧹 清空图层树操作记录')
  }
  
  // ==================== 双向同步机制 ====================

  /**
   * 从部件选择同步到图层树（单向：部件 → 图层树）
   * 用于在用户选择部件后，更新图层树的可见性状态
   * 处理流程：
   * 1、收集已选部件及通用控制对应的图层路径。
   * 2、更新树节点的用户状态与最终可见性。
   * 3、按完整路径将树状态同步到 PSD 层级。
   * @param {Object} selectedParts - 选中的部件对象
   * @param {Object} commonControls - 通用控制状态对象
   */
  const syncLayerTreeFromParts = (selectedParts, commonControls = {}) => {
    // 1、验证 PSD 并收集所有期望可见的路径。
    debugLog('🔄 [同步] 从部件选择同步到图层树')

    if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
      debugWarn('⚠️ 缺少PSD数据，无法同步')
      return
    }

    // 使用唯一名称收集所有应该显示的图层路径。
    const visiblePaths = new Set()

    /**
     * 查找部件名称并收集对应子树路径。
     * 处理流程：
     * 1、递归生成同名可区分的路径。
     * 2、首个名称匹配时收集当前路径及后代路径。
     */
    const collectLayerPaths = (layers, currentPath = '', part, nameCountMap = new Map()) => {
      // 1、逐层生成与树节点一致的路径。
      for (let layer of layers) {
        const layerName = layer.name

        // 处理同名图层：添加索引后缀
        let uniqueName = layerName
        if (nameCountMap.has(layerName)) {
          const count = nameCountMap.get(layerName)
          nameCountMap.set(layerName, count + 1)
          uniqueName = `${layerName}#${count + 1}`
        } else {
          nameCountMap.set(layerName, 1)
        }

        const layerPath = currentPath ? `${currentPath}/${uniqueName}` : uniqueName

        // 2、如果找到匹配的部件，收集此路径及其子路径。
        if (part && layer.name === part.name) {
          visiblePaths.add(layerPath)

          // 递归收集子图层
          if (layer.children && layer.children.length > 0) {
            const childNameCountMap = new Map()
            /**
             * 将已选部件的后代路径加入可见集合。
             * 处理流程：
             * 1、生成子路径并递归收集后代。
             */
            const addChildPaths = (children, parentPath) => {
              // 1、复用当前计数器生成后代的名称后缀。
              for (let child of children) {
                const childName = child.name
                let childUniqueName = childName
                if (childNameCountMap.has(childName)) {
                  const count = childNameCountMap.get(childName)
                  childNameCountMap.set(childName, count + 1)
                  childUniqueName = `${childName}#${count + 1}`
                } else {
                  childNameCountMap.set(childName, 1)
                }
                const childPath = `${parentPath}/${childUniqueName}`
                visiblePaths.add(childPath)
                if (child.children && child.children.length > 0) {
                  addChildPaths(child.children, childPath)
                }
              }
            }
            addChildPaths(layer.children, layerPath)
          }
          return true
        }

        // 继续在子图层中查找
        if (layer.children && layer.children.length > 0) {
          const childNameCountMap = new Map()
          if (collectLayerPaths(layer.children, layerPath, part, childNameCountMap)) {
            return true
          }
        }
      }
      return false
    }

    // 从已选部件收集路径。
    Object.values(selectedParts).forEach(part => {
      if (part && part.name) {
        const topLevelNameCountMap = new Map()
        collectLayerPaths(currentPsdData.value.layerHierarchy, '', part, topLevelNameCountMap)
      }
    })

    // 从通用控制收集固定名称图层的路径。
    // 注意：正面不是具体图层，而是渲染过滤器，不在此处理
    const fixedLayerNames = []
    if (commonControls.showSide) fixedLayerNames.push('侧面')
    if (commonControls.showBack) {
      fixedLayerNames.push('背面')
      fixedLayerNames.push('后面') // 后面是背面的变体
    }
    if (commonControls.showBackground) fixedLayerNames.push('背景')

    fixedLayerNames.forEach(name => {
      const topLevelNameCountMap = new Map()
      collectLayerPaths(currentPsdData.value.layerHierarchy, '', { name }, topLevelNameCountMap)
    })

    debugLog('📋 收集到的可见路径:', Array.from(visiblePaths))

    // 2、更新图层树的用户选择与最终可见性。
    /**
     * 根据可见路径集合更新图层树。
     * 处理流程：
     * 1、按完整路径判断用户状态，再结合正面控制计算可见性。
     * 2、递归更新全部子节点。
     */
    const updateTreeVisibility = (layers, currentPath = []) => {
      // 1、将路径集合映射为节点的选择与显示状态。
      for (let layer of layers) {
        // 构建当前图层的完整路径
        const layerPath = [...currentPath, layer.uniqueName].join('/')

        // 检查这个路径是否在可见路径集合中
        const shouldBeVisible = visiblePaths.has(layerPath)
        
        // 更新用户操作状态
        layer.userVisible = shouldBeVisible
        
        // 更新最终visible状态（考虑正面控制）
        const isSpecialGroup = /(侧面|侧身|侧视|背面|背影|背身|背视|后面|背景|武器|阴影|摇摇头|持剑|后手持剑|下压挥剑|后发|后头发|发型后)/.test(layerPath)
        
        if (showFront.value || isSpecialGroup) {
          layer.visible = shouldBeVisible
        } else {
          // 正面关闭时，非特殊图组强制隐藏
          layer.visible = false
        }
        
        debugLog(`🔧 更新图层树: ${layerPath} → userVisible: ${shouldBeVisible}, visible: ${layer.visible}`)

        // 2、递归更新子图层。
        if (layer.children && layer.children.length > 0) {
          updateTreeVisibility(layer.children, [...currentPath, layer.uniqueName])
        }
      }
    }

    updateTreeVisibility(layerTreeData.value, [])

    // 3、按精确路径同步 PSD 数据。
    /**
     * 把图层树最终可见性写回 PSD 层级。
     * 处理流程：
     * 1、构造 PSD 完整路径并查找对应树节点。
     * 2、同步可见性并递归子层级。
     */
    const syncPsdVisibility = (layers, currentPath = [], nameCountMap = new Map()) => {
      // 1、通过完整路径区分不同位置的同名图层。
      for (let layer of layers) {
        const layerName = layer.name
        let uniqueName = layerName
        if (nameCountMap.has(layerName)) {
          const count = nameCountMap.get(layerName)
          nameCountMap.set(layerName, count + 1)
          uniqueName = `${layerName}#${count + 1}`
        } else {
          nameCountMap.set(layerName, 1)
        }

        // 构建完整路径
        const fullPath = currentPath.length > 0 ? `${currentPath.join('/')}/${uniqueName}` : uniqueName

        /**
         * 按完整路径查找图层树节点。
         * 处理流程：
         * 1、深度遍历并比较路径，返回匹配节点或空值。
         */
        const findTreeNode = (treeNodes, targetPath, nodePath = []) => {
          // 1、每次递归都携带祖先唯一名称。
          for (let node of treeNodes) {
            const newPath = [...nodePath, node.uniqueName]
            const currentFullPath = newPath.join('/')
            
            if (currentFullPath === targetPath) {
              return node
            }
            
            if (node.children && node.children.length > 0) {
              const found = findTreeNode(node.children, targetPath, newPath)
              if (found) return found
            }
          }
          return null
        }

        // 2、仅对找到对应树节点的图层写回可见性。
        const treeNode = findTreeNode(layerTreeData.value, fullPath)
        if (treeNode) {
          layer.visible = treeNode.visible
        }

        // 递归处理子图层
        if (layer.children && layer.children.length > 0) {
          const childNameCountMap = new Map()
          const newPath = [...currentPath, uniqueName]
          syncPsdVisibility(layer.children, newPath, childNameCountMap)
        }
      }
    }

    const topLevelNameCountMap = new Map()
    syncPsdVisibility(currentPsdData.value.layerHierarchy, [], topLevelNameCountMap)

    debugLog('✅ [同步] 图层树同步完成')
  }

  /**
   * 从图层树同步到部件选择（已移除，selectedParts现在是computed）
   * selectedParts会自动从layerTreeData.visible推导
   * 处理流程：
   * 1、保留兼容入口，由计算属性完成反向同步。
   */
  const syncPartsFromLayerTree = () => {
    // 1、部件选择通过计算属性自动更新，无需在此重复赋值。
  }

  // ==================== 图层映射更新 ====================

  /**
   * 更新选中图层映射（根据控制优先级）
   * 处理流程：
   * 1、图层树优先时收集可见节点，否则收集选中部件与通用图层。
   * 2、替换页面高亮映射。
   */
  const updateSelectedLayersMap = () => {
    // 1、按最后操作来源决定高亮数据来源。
    const newMap = {}
    
    if (controlPriority.value === 'layerTree') {
      // 图层树模式：只高亮可见的图层
      /**
       * 收集图层树内可见节点名称。
       * 处理流程：
       * 1、标记当前可见节点，并递归检查子项。
       */
      const collectVisibleLayers = (layers) => {
        // 1、逐节点更新高亮名称集合。
        for (let layer of layers) {
          if (layer.visible) {
            newMap[layer.name] = true
          }
          if (layer.children && layer.children.length > 0) {
            collectVisibleLayers(layer.children)
          }
        }
      }
      collectVisibleLayers(layerTreeData.value)
    } else {
      // 部件选择模式：根据选中的部件和通用控制
      Object.values(selectedParts.value).forEach(part => {
        if (part && part.name) {
          newMap[part.name] = true
          
          // 如果是组，递归标记所有子图层
          if (part.type === 'group' && part.children) {
            /**
             * 标记已选分组内全部子图层。
             * 处理流程：
             * 1、按名称加入高亮映射并递归后代。
             */
            const markChildren = (children) => {
              // 1、已选分组的后代一并标记。
              children.forEach(child => {
                newMap[child.name] = true
                if (child.children) {
                  markChildren(child.children)
                }
              })
            }
            markChildren(part.children)
          }
        }
      })
      
      // 标记通用控制的固定图层（注意：正面是渲染过滤器，不是具体图层）
      if (showSide.value) newMap['侧面'] = true
      if (showBack.value) {
        newMap['背面'] = true
        newMap['后面'] = true // 后面是背面的变体
      }
      if (showBackground.value) newMap['背景'] = true
    }
    
    // 2、一次性替换映射，触发页面高亮更新。
    selectedLayersMap.value = newMap
  }
  
  // ==================== 图层树渲染 ====================
  
  /**
   * 将图层渲染到指定上下文的辅助函数
   * 处理流程：
   * 1、异步加载图层图片并设置超时保护。
   * 2、应用位置、透明度和混合模式。
   * 3、处理可用蒙版后绘制，恢复上下文状态。
   * @param {CanvasRenderingContext2D} ctx - 上下文
   * @param {object} layer - 图层对象
   * @param {number} canvasWidth - 画布宽度
   * @param {number} canvasHeight - 画布高度
   */
  const renderLayerToContext = async (ctx, layer, canvasWidth, canvasHeight) => {
    // 1、单层图片加载失败时结束当前层，允许整帧继续。
    return new Promise((resolve, reject) => {
      try {
        const imageSource = layer.imageData || (layer.canvas ? layer.canvas.toDataURL?.() : null)
        
        if (!imageSource) {
          debugWarn(`⚠️ 图层 ${layer.name} 没有图像源`)
          resolve()
          return
        }
        
        const img = new Image()
        
        img.onload = async () => {
          clearTimeout(timeout)
          try {
            // 2、保持原始坐标精度，设置图层透明度和混合模式。
            let x = layer.left || 0
            let y = layer.top || 0
            let width = layer.width || img.width
            let height = layer.height || img.height
            
            ctx.save()
            
            // 设置高质量渲染
            ctx.imageSmoothingEnabled = true
            ctx.imageSmoothingQuality = 'high'
            
            // 设置透明度
            let opacity = (layer.opacity !== undefined ? layer.opacity : 255) / 255
            if (opacity < 0.1 && layer.opacity > 0) {
              opacity = 1.0
            }
            ctx.globalAlpha = opacity
            
            // 设置混合模式
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
            }
            
            // 3、有可用蒙版时先处理临时画布，再合成到目标上下文。
            if (layer.mask && !layer.mask.disabled && layer.mask.imageData) {
              
              // 创建临时canvas用于应用蒙版
              const tempCanvas = document.createElement('canvas')
              tempCanvas.width = canvasWidth
              tempCanvas.height = canvasHeight
              const tempCtx = tempCanvas.getContext('2d', { 
                alpha: true,
                willReadFrequently: false
              })

              // 先保存透明度和混合模式设置
              const savedAlpha = ctx.globalAlpha
              const savedComposite = ctx.globalCompositeOperation

              // 绘制图层内容到临时canvas（使用高质量设置）
              tempCtx.imageSmoothingEnabled = true
              tempCtx.imageSmoothingQuality = 'high'
              tempCtx.globalAlpha = 1.0
              tempCtx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)

              // 通用：按PSD规则应用图层蒙版（灰度->alpha、考虑defaultColor/invert、整画布套用）
              await applyLayerMask(tempCtx, layer, x, y, width, height, canvasWidth, canvasHeight)

              // 输出到主画布（使用原始设置）
              ctx.globalAlpha = savedAlpha
              ctx.globalCompositeOperation = savedComposite
              ctx.imageSmoothingEnabled = false  // 临时canvas到主canvas不需要平滑
              ctx.drawImage(tempCanvas, 0, 0, canvasWidth, canvasHeight)
              
              debugLog(`✅ [图层蒙版] ${layer.name} 蒙版应用完成`)
            } else {
              // 无蒙版或蒙版已禁用，直接绘制
              ctx.drawImage(img, 0, 0, img.width, img.height, x, y, width, height)
            }
            
            ctx.restore()
            
            resolve()
          } catch (error) {
            console.error(`❌ 渲染图层 ${layer.name} 到上下文失败:`, error)
            ctx.restore()
            resolve()
          }
        }
        
        // 添加加载超时保护
        const timeout = setTimeout(() => {
          console.error(`⏱️ 图层 ${layer.name} 加载超时`)
          resolve()
        }, 5000)
        
        img.onerror = (error) => {
          clearTimeout(timeout)
          console.error(`❌ 图层 ${layer.name} 图像加载失败:`, error)
          resolve()
        }
        
        img.src = imageSource
        
      } catch (error) {
        console.error(`❌ 处理图层 ${layer.name} 失败:`, error)
        resolve()
      }
    })
  }
  
  /**
   * 基于图层树渲染（优先级模式）
   * 处理流程：
   * 1、验证画布与 PSD 数据，开始渲染计时。
   * 2、按树可见性、头部模式和底图控制收集可绘制图层。
   * 3、按 PSD 顺序绘制普通层或剪切组，并返回统计信息。
   */
  const renderByLayerTree = async () => {
    // 1、缺少画布或 PSD 时返回空统计结果。
    const canvas = canvasRef.value
    if (!canvas) {
      message.error('Canvas未初始化')
      return { layersRendered: 0, nodesVisited: 0 }
    }

    if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
      debugWarn('⚠️ 缺少PSD数据')
      perfLogger.logEvent('render:layerTree:skip', { reason: 'no-psd' }, { sampleEvery: 2 })
      return { layersRendered: 0, nodesVisited: 0 }
    }

    const measurement = perfLogger.start('render:layerTree', { threshold: 15 })
    const startTime = Date.now()
    debugLog('🌳 使用图层树模式渲染')
    
    try {
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        throw new Error('无法获取Canvas 2D上下文')
      }
      
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
      // 遍历 PSD 数据，渲染所有可见的图层
      // 收集所有需要渲染的图层（从PSD数据中，根据图层树的可见性）
      const layersToRender = []
      let nodesVisited = 0
      
      // 2、准备路径查找与筛选规则，收集实际参与渲染的图层。
      /**
       * 按路径分段定位图层树节点。
       * 处理流程：
       * 1、使用唯一名称逐级查找，返回目标或空值。
       */
      const findLayerByPath = (layers, pathParts, pathIndex = 0) => {
        // 1、逐级匹配完整路径，避免跨分组选错同名层。
        for (let layer of layers) {
          if (layer.uniqueName === pathParts[pathIndex]) {
            if (pathIndex === pathParts.length - 1) {
              // 到达目标图层
              return layer
            } else if (layer.children && layer.children.length > 0) {
              // 继续在子图层中查找
              return findLayerByPath(layer.children, pathParts, pathIndex + 1)
            }
          }
        }
        return null
      }
      
      /**
       * 根据路径与名称识别头部相关图层。
       * 处理流程：
       * 1、先排除背景及其他视角关键词。
       * 2、匹配头发、脸型和表情等头部关键词。
       */
      const isHeadRelatedLayer = (layerPath, layerName) => {
        // 1、规范化文本，优先应用排除规则。
        if (!layerPath || !layerName) return false
        
        const pathLower = layerPath.toLowerCase()
        const nameLower = layerName.toLowerCase()
        
        // 头部相关关键词（头、脸型、前发、后发）
        const headKeywords = ['头', 'head', '脸型', 'face', '前发', 'fronthair', '后发', 'backhair', '发型']
        
        // 表情相关关键词
        const expressionKeywords = ['表情', 'expression', '眉', 'eyebrow', '眼', 'eye', '嘴', 'mouth', '神态', '五官', '整脸']
        
        // 排除关键词（背景、侧面、背面、侧身、背影等）
        const excludeKeywords = ['背景', 'background', 'bg', '侧面', 'side', '背面', 'back', '侧身', '背影', '后面', 'rear', '侧视']
        
        // 首先检查是否包含排除关键词
        for (const keyword of excludeKeywords) {
          if (pathLower.includes(keyword) || nameLower.includes(keyword)) {
            return false
          }
        }
        
        // 2、检查头部与表情关键词。
        for (const keyword of headKeywords) {
          if (pathLower.includes(keyword) || nameLower.includes(keyword)) {
            return true
          }
        }
        
        // 检查是否包含表情关键词
        for (const keyword of expressionKeywords) {
          if (pathLower.includes(keyword) || nameLower.includes(keyword)) {
            return true
          }
        }
        
        return false
      }
      
      /**
       * 从 PSD 中收集符合树状态和显示模式的图片层。
       * 处理流程：
       * 1、生成唯一路径并查找对应树节点。
       * 2、应用头部与底图过滤，对有效分组递归。
       * 3、把带图片数据的可见叶子加入绘制列表。
       */
      const collectRenderableLayers = (psdLayers, currentPath = '', nameCountMap = new Map(), layerIndex = 0) => {
        // 1、统计访问节点，并保持与构树时一致的路径规则。
        for (let i = 0; i < psdLayers.length; i++) {
          const psdLayer = psdLayers[i]
          nodesVisited++
          const layerName = psdLayer.name
          
          // 处理同名图层：添加索引后缀（与buildLayerTree保持一致）
          let uniqueName = layerName
          if (nameCountMap.has(layerName)) {
            const count = nameCountMap.get(layerName)
            nameCountMap.set(layerName, count + 1)
            uniqueName = `${layerName}#${count + 1}`
          } else {
            nameCountMap.set(layerName, 1)
          }
          
          // 构建当前图层的完整路径（使用uniqueName）
          const layerPath = currentPath ? `${currentPath}/${uniqueName}` : uniqueName
          const pathParts = layerPath.split('/')
          
          // 检查是否是底图（顶层的第一个图层）
          const isBaseLayer = !currentPath && i === 0
          
          // 检查是否是第二底图（顶层的第二个图层）
          const isSecondBaseLayer = !currentPath && i === 1
          
          // 检查是否是背景图层
          const layerNameLower = layerName?.trim().toLowerCase() || ''
          const isBackground = layerName === '背景' || layerNameLower === 'background' || layerNameLower === 'bg'
          
          // 在图层树中找到对应的图层
          const matchingTreeLayer = findLayerByPath(layerTreeData.value, pathParts)
          
          if (matchingTreeLayer && matchingTreeLayer.visible) {
            // 2、应用头部和非头部模式，再检查底图开关。
            const isHeadLayer = isHeadRelatedLayer(layerPath, layerName)
            
            // 如果开启了"选择头部"，只显示头部相关图层
            if (selectHeadOnly?.value) {
              if (!isHeadLayer) {
                debugLog(`⏭️ 跳过非头部图层（选择头部模式）: ${layerPath}`)
                // 如果是组，仍需递归检查子图层（子图层可能是头部相关）
                if (psdLayer.type === 'group' && psdLayer.children) {
                  const childNameCountMap = new Map()
                  collectRenderableLayers(psdLayer.children, layerPath, childNameCountMap, i)
                }
                continue
              }
            }
            
            // 如果开启了"选择非头部"，只显示非头部图层
            if (selectNonHead?.value) {
              if (isHeadLayer) {
                debugLog(`⏭️ 跳过头部图层（选择非头部模式）: ${layerPath}`)
                // 如果是组，仍需递归检查子图层
                if (psdLayer.type === 'group' && psdLayer.children) {
                  const childNameCountMap = new Map()
                  collectRenderableLayers(psdLayer.children, layerPath, childNameCountMap, i)
                }
                continue
              }
            }
            // visible已经包含了正面控制的影响，直接使用即可
            
            // 检查底图控制（从依赖中获取）
            const showBl = showBaseLayer?.value !== false
            const showSbl = showSecondBaseLayer?.value !== false
            
            // 如果是底图且未勾选显示，跳过（背景图层除外）
            if (isBaseLayer && !showBl && !isBackground) {
              debugLog(`⏭️ 跳过最下层白色背景（未勾选）: ${layerPath}`)
              continue
            }
            
            // 如果是第二底图且未勾选显示，跳过（背景图层除外）
            if (isSecondBaseLayer && !showSbl && !isBackground) {
              debugLog(`⏭️ 跳过次下层白色背景（未勾选）: ${layerPath}`)
              continue
            }
            
            // 如果是组，递归处理子图层（使用新的计数器）
            if (psdLayer.type === 'group' && psdLayer.children) {
              const childNameCountMap = new Map()
              collectRenderableLayers(psdLayer.children, layerPath, childNameCountMap, i)
            } else if (psdLayer.imageData) {
              // 3、将带图片数据的可见普通层加入渲染列表。
              layersToRender.push(psdLayer)
            }
          }
        }
      }
      
      // 为顶层图层创建计数器
      const topLevelNameCountMap = new Map()
      collectRenderableLayers(currentPsdData.value.layerHierarchy, '', topLevelNameCountMap)
      
      debugLog(`📋 收集到 ${layersToRender.length} 个可渲染图层`)
      if (layersToRender.length === 0) {
        // 安全兜底：绘制透明像素以刷新画布，避免长时间黑屏
        const px = document.createElement('canvas')
        px.width = 1; px.height = 1
        ctx.drawImage(px, 0, 0)
        debugWarn('⚠️ 未收集到图层，写入透明像素作为兜底')
        measurement.end({
          layersRendered: 0,
          nodesVisited,
          canvasSize: `${canvas.width}x${canvas.height}`,
          note: 'no-layers'
        })
        return { layersRendered: 0, nodesVisited }
      }
      
      // 用于跟踪已处理的剪切蒙版图层，避免重复渲染
      const processedClippingIndices = new Set()
      
      // 3、按照 PSD 顺序渲染，剪切层随基础层合成并标记已处理。
      for (let i = 0; i < layersToRender.length; i++) {
        // 如果当前图层已经作为剪切蒙版被处理过，跳过
        if (processedClippingIndices.has(i)) {
          continue
        }
        
        const layer = layersToRender[i]
        
        // 检查是否有剪切蒙版
        if (!layer.clipping) {
          const clippingIndices = findClippingGroup(layersToRender, i)
          if (Array.isArray(clippingIndices) && clippingIndices.length > 0) {
            // 有剪切蒙版，作为一组渲染
            const clippingLayers = clippingIndices.map(idx => layersToRender[idx])
            await renderClippingGroup(ctx, layer, clippingLayers, canvas.width, canvas.height, renderLayerToContext)
            // 标记这些剪切蒙版图层已处理
            clippingIndices.forEach(idx => processedClippingIndices.add(idx))
          } else {
            // 没有剪切蒙版，正常渲染
            await drawLayerImage(ctx, layer)
          }
        } else {
          debugLog(`⏭️ 跳过剪切蒙版图层 ${layer.name}（将与基础图层一起处理）`)
        }
      }
      
      const endTime = Date.now()
      debugLog(`✅ 图层树模式渲染完成，耗时 ${endTime - startTime}ms`)
      measurement.end({
        layersRendered: layersToRender.length,
        nodesVisited,
        canvasSize: `${canvas.width}x${canvas.height}`
      })
      return { layersRendered: layersToRender.length, nodesVisited }
      
    } catch (error) {
      console.error('❌ 图层树渲染失败:', error)
      message.error(`渲染失败: ${error.message}`)
      measurement.end({
        layersRendered: 0,
        nodesVisited: 0,
        error: error?.message
      })
      return { layersRendered: 0, nodesVisited: 0 }
    }
  }
  
  /**
   * 从图层树同步背景、背面、侧面控制状态
   * 在PSD加载完成或切换文件后调用，确保控制按钮状态与图层树中相关图层的实际可见性一致
   * 强制将这些特殊图层初始化为不可见状态（默认关闭）
   * 处理流程：
   * 1、准备树节点和 PSD 图层可见性同步方法。
   * 2、关闭背景、背面及侧面控制与对应图层。
   * 3、同步匹配的树状态到 PSD，并更新动态表情的隐藏标记。
   * 
   * @param {Object} dynamicExpressionParts - 动态表情图组的部件列表（可选，用于同步部件的hidden属性）
   */
  const syncBackgroundControlFromLayerTree = (dynamicExpressionParts = null) => {
    // 1、准备初始化过程中的节点查找与状态同步。
    debugLog('🔄 同步背景、背面、侧面控制状态（初始化为关闭）...')
    
    /**
     * 更新首个名称匹配的树节点可见性。
     * 处理流程：
     * 1、深度优先查找目标名，同步用户状态和最终状态。
     */
    const findAndUpdateLayerVisibility = (layers, targetNames, shouldBeVisible) => {
      // 1、找到首个匹配后返回，避免继续改变其他同名节点。
      for (const layer of layers) {
        const layerName = layer.name || ''
        const layerNameLower = layerName.toLowerCase().trim()
        
        // 检查是否匹配目标名称
        if (targetNames.some(name => layerName === name || layerNameLower === name.toLowerCase())) {
          // 更新图层树中的可见性状态
          layer.visible = shouldBeVisible
          layer.userVisible = shouldBeVisible
          debugLog(`🔧 更新图层可见性: ${layerName} → ${shouldBeVisible}`)
          return layer
        }
        
        // 递归查找子图层
        if (layer.children && layer.children.length > 0) {
          const found = findAndUpdateLayerVisibility(layer.children, targetNames, shouldBeVisible)
          if (found) return found
        }
      }
      return null
    }
    
    /**
     * 同步首个目标名称对应的 PSD 图层。
     * 处理流程：
     * 1、检查 PSD 数据并递归查找目标图层。
     */
    const syncPsdLayerVisibility = (targetNames, shouldBeVisible) => {
      // 1、缺少层级数据时跳过同步。
      if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
        return
      }
      
      /**
       * 在 PSD 层级中更新首个匹配图层。
       * 处理流程：
       * 1、比较名称并递归子图层，匹配成功后停止查找。
       */
      const findAndUpdateInPsd = (layers) => {
        // 1、将初始化可见性写入首个名称匹配项。
        for (const layer of layers) {
          const layerName = layer.name || ''
          const layerNameLower = layerName.toLowerCase().trim()
          
          if (targetNames.some(name => layerName === name || layerNameLower === name.toLowerCase())) {
            layer.visible = shouldBeVisible
            debugLog(`🔧 同步PSD数据: ${layerName} → ${shouldBeVisible}`)
            return true
          }
          
          if (layer.children && layer.children.length > 0) {
            if (findAndUpdateInPsd(layer.children)) {
              return true
            }
          }
        }
        return false
      }
      
      findAndUpdateInPsd(currentPsdData.value.layerHierarchy)
    }
    
    // 2、依次将背景、背面和侧面初始化为不可见。
    const backgroundLayer = findAndUpdateLayerVisibility(
      layerTreeData.value, 
      ['背景', 'background', 'bg'], 
      false
    )
    if (backgroundLayer) {
      debugLog(`🔧 背景图层初始化为不可见`)
      showBackground.value = false
      syncPsdLayerVisibility(['背景', 'background', 'bg'], false)
    } else {
      debugLog('✅ 未找到背景图层')
      showBackground.value = false
    }
    
    // 强制初始化背面图层为不可见
    const backLayer = findAndUpdateLayerVisibility(
      layerTreeData.value, 
      ['背面', '背影', '背身', '背视', '背视图', '后面'], 
      false
    )
    if (backLayer) {
      debugLog(`🔧 背面图层初始化为不可见`)
      showBack.value = false
      syncPsdLayerVisibility(['背面', '背影', '背身', '背视', '背视图', '后面'], false)
    } else {
      debugLog('✅ 未找到背面图层')
      showBack.value = false
    }
    
    // 强制初始化侧面图层为不可见
    const sideLayer = findAndUpdateLayerVisibility(
      layerTreeData.value, 
      ['侧面', '侧身', '侧视', '侧视图'], 
      false
    )
    if (sideLayer) {
      debugLog(`🔧 侧面图层初始化为不可见`)
      showSide.value = false
      syncPsdLayerVisibility(['侧面', '侧身', '侧视', '侧视图'], false)
    } else {
      debugLog('✅ 未找到侧面图层')
      showSide.value = false
    }
    
    debugLog('✅ 背景、背面、侧面控制状态初始化完成')
    
    // 同步 PSD 数据中表情图组的可见性（根据图层树的状态）
    if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
      return
    }
    
    // 3、同步图层树状态到 PSD 与动态表情部件。
    /**
     * 同步位置和名称均匹配的树节点状态。
     * 处理流程：
     * 1、按相同索引比较名称，匹配后写回可见性。
     * 2、对两侧都有子项的节点递归同步。
     */
    const syncTreeToPsd = (treeLayers, psdLayers, treePath = [], psdPath = []) => {
      // 1、仅同步当前索引下名称一致的节点。
      for (let i = 0; i < Math.min(treeLayers.length, psdLayers.length); i++) {
        const treeLayer = treeLayers[i]
        const psdLayer = psdLayers[i]
        
        if (treeLayer.name === psdLayer.name) {
          // 同步 visible 状态
          psdLayer.visible = treeLayer.visible
          
          const fullPath = [...treePath, treeLayer.uniqueName].join('/')
          // 输出表情相关的同步日志
          if (/表情|豆豆眼|专属表情|辅助表情/.test(fullPath) || /表情|豆豆眼|专属表情|辅助表情/.test(treeLayer.name)) {
            debugLog(`  🔄 同步到PSD: ${psdLayer.name} → ${psdLayer.visible}`)
          }
          
          // 2、递归同步两侧均存在的子图层。
          if (treeLayer.children && treeLayer.children.length > 0 &&
              psdLayer.children && psdLayer.children.length > 0) {
            syncTreeToPsd(treeLayer.children, psdLayer.children, 
              [...treePath, treeLayer.uniqueName], 
              [...psdPath, psdLayer.name])
          }
        }
      }
    }
    
    syncTreeToPsd(layerTreeData.value, currentPsdData.value.layerHierarchy)
    debugLog('✅ 表情图组可见性已从图层树同步到PSD数据')
    
    // 同步更新 dynamicExpressionParts 中部件的 hidden 属性
    // 确保绿色小圆点和双击检测能正确反映实际的可见性状态
    if (dynamicExpressionParts && typeof dynamicExpressionParts === 'object') {
      debugLog('🔄 开始同步表情图组部件的 hidden 属性...')
      
      Object.entries(dynamicExpressionParts).forEach(([tabKey, partsList]) => {
        if (Array.isArray(partsList)) {
          partsList.forEach(part => {
            if (part && part.path) {
              // 在图层树中查找对应的图层
              const pathParts = part.path.split('/')
              /**
               * 根据当前部件路径查找树节点。
               * 处理流程：
               * 1、逐级匹配唯一名称，返回节点或空值。
               */
              const findLayerByPath = (layers, pathIndex = 0) => {
                // 1、以完整路径定位用于更新隐藏标记的节点。
                for (const layer of layers) {
                  if (layer.uniqueName === pathParts[pathIndex]) {
                    if (pathIndex === pathParts.length - 1) {
                      return layer
                    } else if (layer.children && layer.children.length > 0) {
                      return findLayerByPath(layer.children, pathIndex + 1)
                    }
                  }
                }
                return null
              }
              
              const layerInTree = findLayerByPath(layerTreeData.value)
              if (layerInTree) {
                // 根据图层树的可见性更新部件的 hidden 属性
                // userVisible = false 表示用户设置为不可见，应该标记为 hidden = true
                const shouldBeHidden = !layerInTree.userVisible
                if (part.hidden !== shouldBeHidden) {
                  part.hidden = shouldBeHidden
                  debugLog(`  🔧 同步部件 hidden 属性: ${part.name} → hidden=${shouldBeHidden} (userVisible=${layerInTree.userVisible})`)
                }
              }
            }
          })
        }
      })
      
      debugLog('✅ 表情图组部件的 hidden 属性已同步')
    }
  }
  
  // 3、暴露图层树状态、同步操作与渲染入口。
  // ==================== 返回值 ====================
  
  return {
    // 状态
    layerTreeData,
    layerTreeOperations,
    selectedLayersMap,
    controlPriority,
    
    // 方法
    buildLayerTree,
    handleLayerVisibilityChange,
    handleBatchToggleVisibility,
    handleRestoreInitialState,
    clearLayerTreeOperations,
    syncLayerTreeFromParts, // 部件选择 → 图层树
    syncPartsFromLayerTree, // 图层树 → 部件选择（反向同步）
    updateSelectedLayersMap,
    renderByLayerTree,
    syncBackgroundControlFromLayerTree // 同步背景控制状态
  }
}
