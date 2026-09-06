/** PSD 会话控制：保存、恢复、切换与移除文件，复用页面及既有模块持有的唯一状态容器。 */
import { markRaw, nextTick } from 'vue'

/**
 * 创建 PSD 会话入口。
 * 处理流程：
 * 1、在图层树与画布渲染初始化完成后，接入按职责列出的原引用
 * 2、保留原状态快照、切换分支及异步顺序，不创建额外响应式状态或生命周期
 * 3、返回与页面及标签栏兼容的四个函数
 */
export function usePsdSession({ session, layerTree, parts, canvas, commonControls, presetState, templateState, message }) {
  // 1、文件与缓存仍由页面持有，图层树仍由图层树模块持有。
  const { psdFiles, currentPsdFile, currentPsdData, psdPartsCache, psdStatesCache, currentTab, userInteracted } = session
  const { layerTreeData, buildLayerTree, setLayerVisibilityByPath, syncBackgroundControlFromLayerTree } = layerTree
  // 2、部件数据及分类行为仅引用原模块，表情元信息计算仍由页面提供。
  const {
    dynamicExpressionParts, dynamicExpressionTabs, dynamicFrontHandTabs, dynamicBackHandTabs,
    dynamicBothHandsTabs, dynamicUpperBodyTabs, dynamicLowerBodyTabs, dynamicActionTabs,
    initialSorted, updatePartsFromClassifyResult, clearAllPartsState, buildExpressionMeta, getFirstDefaultTabKey
  } = parts
  const { canvasRef, canvasWidth, canvasHeight, updateCanvasDisplaySize, resetPreviewWindowViewport, renderAllLayers } = canvas
  const { getCommonControlsState, restoreCommonControlsState } = commonControls
  // 3、预设列表按文件加载；全局模板列表只读，切换仅清除其选择与编辑标识。
  const { presets, selectedPresetId, editingPresetId, loadPresets } = presetState
  const { templates, selectedTemplate1Id, selectedTemplate2Id, editingTemplate1Id, editingTemplate2Id, loadTemplates } = templateState

  /**
   * 保存当前PSD文件的状态
   * 处理流程：
   * 1、校验文件标识
   * 2、深拷贝图层树和交互状态，并保存当前标签与通用控制
   */
  const savePsdState = (psdId) => {
    // 1、缺少文件标识时不创建缓存项
    if (!psdId) return

    console.log('💾 保存PSD状态:', psdId)

    // 2、以文件标识隔离状态，避免切换文件后继续共享可变树节点
    psdStatesCache.value[psdId] = {
      // 图层树visible状态（唯一数据源）
      layerTreeData: JSON.parse(JSON.stringify(layerTreeData.value)),
      // 当前标签页
      currentTab: currentTab.value,
      // 通用控制状态（使用 composable 的方法）
      commonControls: getCommonControlsState(),
      // 用户交互状态
      userInteracted: JSON.parse(JSON.stringify(userInteracted.value)),
      // 保存时间戳
      savedAt: Date.now()
    }

    console.log('✅ PSD状态已保存')
  }

  /**
   * 恢复PSD文件的状态
   * 处理流程：
   * 1、按文件标识查找保存的状态
   * 2、还原图层树、当前标签、通用控制及用户交互状态
   */
  const restorePsdState = (psdId) => {
    // 1、没有历史状态时保留本次载入的默认状态
    if (!psdId) return

    const savedState = psdStatesCache.value[psdId]
    if (!savedState) {
      console.log('⚠️ 没有找到PSD的保存状态，使用默认状态')
      return
    }

    console.log('📂 恢复PSD状态:', psdId)

    // 2、恢复图层树及其相关的界面控制状态
    if (savedState.layerTreeData) {
      layerTreeData.value = JSON.parse(JSON.stringify(savedState.layerTreeData))
    }

    // 恢复当前标签页
    currentTab.value = savedState.currentTab

    // 恢复通用控制状态（使用 composable 的方法）
    restoreCommonControlsState(savedState.commonControls)

    // 恢复用户交互状态
    userInteracted.value = JSON.parse(JSON.stringify(savedState.userInteracted))

    console.log('✅ PSD状态已恢复')
  }
  /**
   * 切换PSD文件
   * 处理流程：
   * 1、保存旧文件状态，载入新数据并重建图层树
   * 2、恢复缓存分类并按表情类型协调初始可见性
   * 3、调整画布尺寸，重置交互及预设模板选择
   * 4、恢复该文件已保存状态，异步加载预设模板后校验目标并重绘
   */
  const switchPsdFile = (psdFile) => {
    // 1、相同文件不重复切换，切换前保存旧文件状态
    if (currentPsdFile.value?.id === psdFile.id) return

    // 保存当前PSD的状态
    if (currentPsdFile.value) {
      savePsdState(currentPsdFile.value.id)
    }

    console.log('🔄 切换PSD文件:', psdFile.name)

    // 从缓存读取数据
    currentPsdFile.value = psdFile
    currentPsdData.value = markRaw(psdFile.data)

    // 重置预览窗口的视图状态（滚动条和缩放）
    // 在 PSD 数据改变后立即发送重置命令，避免不同PSD尺寸导致的画布显示问题
    resetPreviewWindowViewport()

    // 构建图层树
    layerTreeData.value = buildLayerTree(psdFile.data)

    // 2、从缓存读取部件分类并恢复类型互斥关系
    const cachedParts = psdPartsCache.value[psdFile.id]
    if (cachedParts) {
      // 使用 updatePartsFromClassifyResult 方法更新部件状态
      updatePartsFromClassifyResult(cachedParts)

      // 强制重置标签排序标志，确保标签能够根据最新的parts数据重新计算显示
      // 修复：初始化时标签显示不全的问题
      initialSorted.value = false

      // 同步背景、背面、侧面控制状态，以及表情图组的部件 hidden 属性
      // 确保按钮状态、图层树和部件列表三者保持一致
      syncBackgroundControlFromLayerTree(dynamicExpressionParts.value)

      // 🔧 修复：如果有多个表情组，按类型互斥（眉/眼/嘴可共存，同类型互斥）
      // 避免绿色小圆点显示错误
      if (cachedParts.expressionTabs && cachedParts.expressionTabs.length > 1) {
        console.log(`🔧 [切换PSD] 检测到 ${cachedParts.expressionTabs.length} 个表情组，应用表情类型互斥规则`)

        // 按类型分组检查可见的表情组，优先记录首个可见的分组
        const typeToVisibleGroup = new Map() // key -> { tab, visibleLayers, index }
        const cachedMetaAnalysis = buildExpressionMeta(cachedParts.expressionTabs || [], cachedParts.expressions || {})
        const cachedMetaMap = cachedMetaAnalysis.metaMap
        let standaloneVisibleInfo = null

        for (let i = 0; i < cachedParts.expressionTabs.length; i++) {
          const tab = cachedParts.expressionTabs[i]
          const tabKey = tab.key
          const partsList = cachedParts.expressions[tabKey] || []
          const meta = cachedMetaMap.get(tab.key) || {}
          const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')

          const visibleLayers = []
          partsList.forEach(part => {
            if (!part || !part.path || !layerTreeData.value) return

            const pathParts = part.path.split('/')
            let layers = layerTreeData.value
            let found = false

            for (let j = 0; j < pathParts.length; j++) {
              const layer = layers.find(l => l.uniqueName === pathParts[j])
              if (!layer) break

              if (j === pathParts.length - 1) {
                found = layer.userVisible && layer.visible
                if (found) {
                  visibleLayers.push(part)
                }
              } else if (layer.children) {
                layers = layer.children
              } else {
                break
              }
            }
          })

          if (visibleLayers.length > 0) {
            console.log(`  ✅ 表情组 ${tab.label} (类型: ${exprTypeKey}) 有 ${visibleLayers.length} 个可见图层`)

            if (!typeToVisibleGroup.has(exprTypeKey)) {
              typeToVisibleGroup.set(exprTypeKey, { tab, visibleLayers, index: i })
            } else {
              console.log(`  ⚠️ 类型 ${exprTypeKey} 已有可见表情组，将隐藏: ${tab.label}`)
            }
          }
        }

        standaloneVisibleInfo = typeToVisibleGroup.get('standalone') || null

        if (typeToVisibleGroup.size === 0) {
          console.log(`  ℹ️ 没有检测到可见的表情组，保持原始PSD状态（不主动开启表情）`)
        } else {
          console.log(`  🔧 应用类型互斥规则，共 ${typeToVisibleGroup.size} 个类别有可见表情组`)
        }

        for (let i = 0; i < cachedParts.expressionTabs.length; i++) {
          const tab = cachedParts.expressionTabs[i]
          const tabKey = tab.key
          const partsList = cachedParts.expressions[tabKey] || []
          const meta = cachedMetaMap.get(tab.key) || {}
          const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')

          const visibleGroup = standaloneVisibleInfo && exprTypeKey !== 'standalone'
            ? null
            : typeToVisibleGroup.get(exprTypeKey)

          if (visibleGroup && visibleGroup.index === i) {
            console.log(`    ✅ 保持表情组 ${tab.label} (类型: ${exprTypeKey}) 可见`)

            const visiblePaths = new Set(visibleGroup.visibleLayers.map(p => p.path))

            partsList.forEach(part => {
              if (part && part.path && !visiblePaths.has(part.path)) {
                setLayerVisibilityByPath(part.path, false)
              }
            })

            if (tab.path) {
              setLayerVisibilityByPath(tab.path, true)
            }
          } else {
            console.log(`    🔧 隐藏表情组 ${tab.label} (类型: ${exprTypeKey}), 共 ${partsList.length} 个图层`)

            partsList.forEach(part => {
              if (part && part.path) {
                setLayerVisibilityByPath(part.path, false)
              }
            })
          }
        }
      }

      console.log('📦 已加载动态分组:', {
        前手: dynamicFrontHandTabs.value.length,
        后手: dynamicBackHandTabs.value.length,
        双手: dynamicBothHandsTabs.value.length,
        上身: dynamicUpperBodyTabs.value.length,
        下身: dynamicLowerBodyTabs.value.length,
        动作: dynamicActionTabs.value.length
      })
    }

    // 3、更新画布尺寸并为新文件重置临时交互状态
    if (psdFile.data.width && psdFile.data.height) {
      canvasWidth.value = psdFile.data.width
      canvasHeight.value = psdFile.data.height

      // 计算Canvas显示尺寸（固定占据60%窗口高度，保持16:9宽高比）
      updateCanvasDisplaySize()
    }

    // 重置用户交互状态
    const baseUserInteracted = {
      frontHandNormal: false,
      frontHandRight: false,
      frontHandBoth: false,
      backHand: false,
      frontLayerBackHand: false,
      bothHands: false,
      upperBody: false,
      lowerBody: false,
      action: false
    }

    // 动态添加表情图组的交互状态
    dynamicExpressionTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })

    // 动态添加其他分组的交互状态
    dynamicFrontHandTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })
    dynamicBackHandTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })
    dynamicBothHandsTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })
    dynamicUpperBodyTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })
    dynamicLowerBodyTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })
    dynamicActionTabs.value.forEach(tab => {
      baseUserInteracted[tab.key] = false
    })

    userInteracted.value = baseUserInteracted

    // 立即清空预设状态，防止旧预设污染新PSD的渲染
    selectedPresetId.value = null
    editingPresetId.value = null
    presets.value = []
    console.log('🧹 已清空预设状态，防止污染')

    // 立即清空模板状态，防止旧模板污染新PSD的渲染
    selectedTemplate1Id.value = null
    selectedTemplate2Id.value = null
    editingTemplate1Id.value = null
    editingTemplate2Id.value = null
    // 注意：不清空templates1和templates2，因为它们是全局的，不属于特定PSD
    console.log('🧹 已清空模板选中状态，防止污染')

    // 4、尝试恢复保存的状态，再加载该文件对应的预设与全局模板
    restorePsdState(psdFile.id)

    // 如果没有保存的状态，使用默认选中逻辑
    if (!psdStatesCache.value[psdFile.id]) {
      // 默认选中：优先选择有绿色小圆点的分组，否则选择第一个存在的分组
      const defaultTabKey = getFirstDefaultTabKey()
      currentTab.value = defaultTabKey
    }

    // 使用 nextTick 确保 presetsStorageKey 已经更新
    nextTick(async () => {
      // 确保当前PSD文件ID，用于验证预设加载的正确性
      const currentPsdId = psdFile.id
      console.log('🔄 开始为PSD加载预设和模板:', currentPsdId, psdFile.name)

      // 加载预设列表（但不自动选中）
      await loadPresets()

      // 加载模板列表（但不自动选中）
      await loadTemplates()

      // 验证当前PSD是否仍然是目标PSD（防止快速切换导致的数据混乱）
      if (currentPsdFile.value?.id === currentPsdId) {
        console.log('✅ 预设和模板加载完成，PSD ID验证通过:', currentPsdId)
        console.log('📝 当前PSD预设数量:', presets.value.length, '模板数量:', templates.value.length)
      } else {
        console.warn('⚠️ PSD已切换，忽略过期的预设和模板数据:', currentPsdId)
        return
      }

      // 渲染完整画面（显示PSD原本的可见图层）
      setTimeout(() => {
        // 再次验证PSD ID
        if (currentPsdFile.value?.id === currentPsdId) {
          renderAllLayers()
        }
      }, 100)
    })

    message.success(`已切换到 ${psdFile.name}`)
  }

  /**
   * 移除PSD文件
   * 处理流程：
   * 1、从打开列表和分类状态缓存中移除目标文件
   * 2、当前文件被移除时切换剩余文件，或清空部件、选择和画布
   * 3、提示文件已经移除
   */
  const removePsdFile = (psdId) => {
    // 1、定位文件并删除其列表记录与缓存
    const index = psdFiles.value.findIndex(f => f.id === psdId)
    if (index === -1) return

    const fileName = psdFiles.value[index].name
    console.log('🗑️ 移除PSD文件:', fileName)

    // 从列表中移除
    psdFiles.value.splice(index, 1)

    // 从缓存中移除
    delete psdPartsCache.value[psdId]

    // 从状态缓存中移除
    delete psdStatesCache.value[psdId]
    console.log('🗑️ 已清除PSD状态缓存')

    // 2、如果移除的是当前文件，切换到其他文件或清空
    if (currentPsdFile.value?.id === psdId) {
      if (psdFiles.value.length > 0) {
        // 切换到第一个文件
        switchPsdFile(psdFiles.value[0])
      } else {
        // 没有文件了，清空所有状态
        currentPsdFile.value = null
        currentPsdData.value = null

        // 使用 clearAllPartsState 方法清空部件状态
        clearAllPartsState()

        // 重置标签排序标志，确保下次加载PSD时能正确显示标签
        initialSorted.value = false

        /**
         * 将剩余图层树递归设置为不可见。
         * 处理流程：
         * 1、隐藏当前层级节点并递归子分组
         */
        const resetLayerTreeVisibility = (layers) => {
          // 1、清除最后一个文件遗留的图层显示
          layers.forEach(layer => {
            layer.visible = false
            if (layer.children && layer.children.length > 0) {
              resetLayerTreeVisibility(layer.children)
            }
          })
        }
        if (layerTreeData.value) {
          resetLayerTreeVisibility(layerTreeData.value)
        }

        userInteracted.value = {
          frontHandNormal: false,
          frontHandRight: false,
          frontHandBoth: false,
          backHand: false,
          frontLayerBackHand: false,
          bothHands: false,
          upperBody: false,
          lowerBody: false,
          action: false
        }

        // 清空预设列表
        presets.value = []
        selectedPresetId.value = null
        editingPresetId.value = null
        console.log('🗑️ 已清空预设列表')

        // 清空模板选中状态（不清空模板列表，因为它们是全局的）
        selectedTemplate1Id.value = null
        selectedTemplate2Id.value = null
        editingTemplate1Id.value = null
        editingTemplate2Id.value = null
        console.log('🗑️ 已清空模板选中状态')

        // 清空画布
        const canvas = canvasRef.value
        if (canvas) {
          const ctx = canvas.getContext('2d')
          ctx.clearRect(0, 0, canvas.width, canvas.height)
        }
      }
    }

    // 3、报告本次移除的文件名
    message.success(`已移除 ${fileName}`)
  }

  return { savePsdState, restorePsdState, switchPsdFile, removePsdFile }
}
