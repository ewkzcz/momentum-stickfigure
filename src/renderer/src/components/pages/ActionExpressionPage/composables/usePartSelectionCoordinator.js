/**
 * 人物页部件选择与图层显隐协调。
 * 职责：保留标签单双击、路径/名称同步、表情与动作互斥及手部代理的原有分支和时序。
 * 状态归属：仅持有原双击计时状态；部件选择仍由页面按图层树 userVisible 推导。
 * 边界：正面是显示过滤；不接管图层树多选、画布合成、PSD 解析、会话或监听注册。
 */
import { nextTick } from 'vue'

/**
 * 在页面原选择函数位置创建协调入口。
 * 处理流程：
 * 1、复用已就绪的 const 引用，保存三个明确的晚绑定 getter，但不立即调用
 * 2、原路径、祖先与 PSD 同步以及互斥流程按原顺序执行
 * 3、返回页面、解析器、会话和通用控制监听所需的稳定函数
 */
export function usePartSelectionCoordinator({
  currentTab, selectedParts, userInteracted, selectedPresetId, selectedTemplate1Id, selectedTemplate2Id,
  partTabs, allPartsListsMap, frontHandNormalParts, frontHandRightParts, frontHandBothParts,
  backHandParts, frontLayerBackHandParts, bothHandsParts, upperBodyParts, lowerBodyParts, actionParts,
  dynamicExpressionTabs, dynamicExpressionParts, dynamicFrontHandTabs, dynamicFrontHandParts,
  dynamicBackHandTabs, dynamicBackHandParts, dynamicBothHandsTabs, dynamicBothHandsParts,
  enhancedExpressionTabs, expressionTabMetaMap, exclusiveMode, expressionExclusiveMode,
  actionExclusiveMode, currentPsdData, showFront, message, queueRenderAllLayers, syncCanvasToPreview,
  getLayerTreeData, getControlPriority, getRenderAllLayers
}) {
  // 1、仅业务调用时读取后赋值依赖，不提前捕获图层树、控制优先级或渲染占位。
  /**
   * 切换标签页
   * 处理流程：
   * 1、设置当前标签，必要时清除预设选择并重绘
   * 2、离开模板区域时清除模板选中标识
   * 3、记录目标分组的当前选择情况
   */
  const switchTab = (tabKey) => {
    // 1、更新标签并处理预设退出后的画布恢复
    currentTab.value = tabKey
    console.log('🔄 切换到:', tabKey)

    // 如果切换到非预设标签页，清除预设选择
    if (tabKey !== 'presets') {
      if (selectedPresetId.value) {
        console.log('🔄 切换到非预设标签页，清除预设选择')
        selectedPresetId.value = null
        // 只有在清除预设时才需要重新渲染
        queueRenderAllLayers()
      }
    }

    // 2、如果切换到非模板标签页，清除模板选择
    if (tabKey !== 'template1' && tabKey !== 'template2') {
      if (selectedTemplate1Id.value) {
        console.log('🔄 切换到非模板标签页，清除动作模板选择')
        selectedTemplate1Id.value = null
      }
      if (selectedTemplate2Id.value) {
        console.log('🔄 切换到非模板标签页，清除表情模板选择')
        selectedTemplate2Id.value = null
      }
    }

    // 优化：切换标签本身不需要重新渲染画布
    // 画布内容由选中的部件决定，不由当前标签决定
    // 只有当切换标签导致选中部件变化时（如清除预设），才需要渲染

    // 3、输出目标分组的选择状态供交互排查
    const selectedInGroup = selectedParts.value[tabKey]
    if (selectedInGroup) {
      console.log('🔄 该分组当前显示:', selectedInGroup.name)
    } else {
      console.log('🔄 该分组暂无显示部件')
    }
  }

  // 双击检测相关变量
  let tabClickTimer = null
  let tabClickCount = 0
  let lastClickedTab = null

  /**
   * 处理标签页点击事件（支持单击切换和双击取消）
   * 处理流程：
   * 1、切换点击目标时清理上次计数和定时器
   * 2、首次点击立即切换，并开启双击检测窗口
   * 3、窗口内第二次点击清理计数并取消分组选中
   */
  const handleTabClick = async (tabKey) => {
    // 1、如果点击的是不同的标签，重置计数
    if (lastClickedTab !== tabKey) {
      tabClickCount = 0
      lastClickedTab = tabKey
      if (tabClickTimer) {
        clearTimeout(tabClickTimer)
        tabClickTimer = null
      }
    }

    tabClickCount++

    // 2、立即执行单击，并保留短时间内第二次点击的双击检测
    if (tabClickCount === 1) {
      // 第一次点击：立即切换标签（无延迟）
      switchTab(tabKey)

      // 设置双击检测窗口（150ms内的第二次点击视为双击）
      if (tabClickTimer) {
        clearTimeout(tabClickTimer)
      }
      tabClickTimer = setTimeout(() => {
        // 超时后重置计数
        tabClickCount = 0
        lastClickedTab = null
      }, 150) // 缩短到150ms，提升响应速度
    } else if (tabClickCount === 2) {
      // 3、第二次点击时取消该组所有图层，并清理检测状态
      if (tabClickTimer) {
        clearTimeout(tabClickTimer)
        tabClickTimer = null
      }
      tabClickCount = 0
      lastClickedTab = null
      await handleTabDoubleClick(tabKey)
    }
  }
  /**
   * 处理标签页双击事件，快捷取消该组件内所有选中的图层（支持代理机制）
   * 处理流程：
   * 1、排除预设模板标签，并建立动态分组名称映射
   * 2、检查主分组和代理分组当前是否有显示内容
   * 3、有内容时隐藏相关分组、标记用户操作并重绘，否则提示空状态
   */
  const handleTabDoubleClick = async (tabKey) => {
    // 1、预设与模板不提供双击清空操作
    console.log('👆 双击标签页:', tabKey)

    // 预设和模板标签页特殊处理：不支持双击取消，直接返回
    if (tabKey === 'presets' || tabKey === 'template1' || tabKey === 'template2') {
      console.log('ℹ️ 预设/模板标签页不支持双击取消')
      return
    }

    // 构建标签名称映射（包含动态表情图组）
    const tabNames = {
      frontHandNormal: '左手',
      frontHandRight: '右手',
      frontHandBoth: '双手',
      backHand: '右手',
      frontLayerBackHand: '右手',
      bothHands: '双手',
      upperBody: '上身',
      lowerBody: '下身',
      action: '动作',
      presets: '预设'
    }

    // 动态添加表情图组的名称
    dynamicExpressionTabs.value.forEach(tab => {
      tabNames[tab.key] = tab.label
    })

    // 动态添加其他分组的名称（仅前手、后手、双手，已禁用，保留代码兼容性）
    dynamicFrontHandTabs.value.forEach(tab => {
      tabNames[tab.key] = tab.label
    })
    dynamicBackHandTabs.value.forEach(tab => {
      tabNames[tab.key] = tab.label
    })
    dynamicBothHandsTabs.value.forEach(tab => {
      tabNames[tab.key] = tab.label
    })
    // 注意：动作、上身、下身不支持动态标签，已移除

    // 2、结合用户操作状态、默认可见性与代理分组检查显示内容
    const currentSelected = selectedParts.value[tabKey]
    const hasInteracted = userInteracted.value[tabKey]

    // 查找当前标签页配置（用于代理机制）
    const currentTabConfig = partTabs.value.find(tab => tab.key === tabKey)

    // 判断是否有渲染内容（与绿色小圆点的显示逻辑保持一致）
    let mainHasContent = false
    let proxyHasContent = false

    // 检查主分组是否有内容
    if (hasInteracted) {
      // 如果用户操作过，检查是否有选中的图层
      mainHasContent = currentSelected !== null && currentSelected !== undefined
    } else {
      // 如果用户没有操作过，检查是否有默认可见的图层
      let partsList = []

      // 先检查是否是动态表情图组
      if (currentTabConfig?.isExpression && dynamicExpressionParts.value[tabKey]) {
        partsList = dynamicExpressionParts.value[tabKey]
      }
      // 检查是否是动态分组（只检查动态标签，基础标签走 switch）
      // 注意：仅前手、后手、双手支持动态分组（已禁用），动作、上身、下身不支持
      else if (currentTabConfig?.isDynamic) {
        // 动态分组根据 groupType 获取对应数据
        if (currentTabConfig.groupType === 'frontHand' && dynamicFrontHandParts.value[tabKey]) {
          partsList = dynamicFrontHandParts.value[tabKey]
        }
        else if (currentTabConfig.groupType === 'backHand' && dynamicBackHandParts.value[tabKey]) {
          partsList = dynamicBackHandParts.value[tabKey]
        }
        else if (currentTabConfig.groupType === 'bothHands' && dynamicBothHandsParts.value[tabKey]) {
          partsList = dynamicBothHandsParts.value[tabKey]
        }
      }
      else {
        // 否则使用固定的switch分支
        switch (tabKey) {
        case 'combinedExpressions': {
          // 组合表情：清空所有表情分组
          const allExpressionKeys = dynamicExpressionTabs.value.map(tab => tab.key)
          const groupsToHide = allExpressionKeys
          groupsToHide.forEach(groupKey => {
            const partsList = allPartsListsMap.value[groupKey] || []
            partsList.forEach(p => {
              if (p && p.path) {
                setLayerVisibilityByPath(p.path, false)
              }
            })
            // 标记该分组已被用户手动操作
            userInteracted.value[groupKey] = true
            console.log(`✅ 取消分组: ${groupKey}`)
          })
          console.log('✅ 已取消 组合表情 内所有显示的图层')
          await getRenderAllLayers()()
          return
        }
          case 'frontHandNormal':
            partsList = frontHandNormalParts.value
            break
          case 'frontHandRight':
            partsList = frontHandRightParts.value
            break
          case 'frontHandBoth':
            partsList = frontHandBothParts.value
            break
          case 'backHand':
            partsList = backHandParts.value
            break
          case 'frontLayerBackHand':
            partsList = frontLayerBackHandParts.value
            break
          case 'bothHands':
            partsList = bothHandsParts.value
            break
          case 'upperBody':
            partsList = upperBodyParts.value
            break
          case 'lowerBody':
            partsList = lowerBodyParts.value
            break
          case 'action':
            partsList = actionParts.value
            break
        }
      }
      // 检查是否有非隐藏的图层（默认可见）
      mainHasContent = partsList.some(p => !p.hidden)
    }

    // 检查代理目标是否有内容（支持多个代理目标）
    if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
      proxyHasContent = currentTabConfig.proxyTargets.some(proxyTarget => {
        const proxySelected = selectedParts.value[proxyTarget]
        const proxyInteracted = userInteracted.value[proxyTarget]

        if (proxyInteracted) {
          return proxySelected !== null && proxySelected !== undefined
        } else {
          let proxyPartsList = []
          switch (proxyTarget) {
            case 'backHand':
              proxyPartsList = backHandParts.value
              break
            case 'frontLayerBackHand':
              proxyPartsList = frontLayerBackHandParts.value
              break
            case 'bothHands':
              proxyPartsList = bothHandsParts.value
              break
          }
          return proxyPartsList.some(p => !p.hidden)
        }
      })
    }

    // 主分组或代理目标有内容即算有内容
    const hasContent = mainHasContent || proxyHasContent

    // 3、存在显示内容时统一隐藏主分组和代理分组并重新绘制
    if (hasContent) {
      // 收集需要隐藏的分组（主分组 + 代理分组）
      const groupsToHide = [tabKey]
      if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
        groupsToHide.push(...currentTabConfig.proxyTargets)
      }

      // 隐藏这些分组的所有部件图层
      groupsToHide.forEach(groupKey => {
        const partsList = allPartsListsMap.value[groupKey] || []
        partsList.forEach(p => {
          if (p && p.path) {
            setLayerVisibilityByPath(p.path, false)
          }
        })

        // 标记该分组已被用户手动操作
        userInteracted.value[groupKey] = true
        console.log(`✅ 取消分组: ${groupKey}`)
      })

      console.log(`✅ 已取消 ${tabKey} 组件内所有显示的图层`)

      message.success(`已取消 ${tabNames[tabKey] || tabKey} 组件内所有显示的图层`, {
        duration: 2000
      })

      // 重新渲染画布
      await getRenderAllLayers()()
    } else {
      console.log(`ℹ️ ${tabKey} 组件当前没有显示的图层`)
      message.info(`${tabNames[tabKey] || tabKey} 当前没有显示的图层`, {
        duration: 2000
      })
    }
  }

  /**
   * 根据路径设置图层可见性
   * 处理流程：
   * 1、按唯一路径查找目标，相同状态跳过更新
   * 2、递归修改目标用户状态，并结合正面控制计算显示状态
   * 3、同步 PSD 原始数据及必要的祖先可见性，报告未匹配路径
   */
  const setLayerVisibilityByPath = (path, visible) => {
    // 1、校验路径并检查是否需要实际修改
    if (!path) return

    const pathParts = path.split('/')

    /**
     * 沿唯一路径递归查找目标图层。
     * 处理流程：
     * 1、逐层匹配唯一名称，到达末段时返回节点
     */
    const findLayer = (layers, pathIndex = 0) => {
      // 1、仅在当前路径命中的子树中继续查找
      for (const layer of layers) {
        if (layer.uniqueName === pathParts[pathIndex]) {
          if (pathIndex === pathParts.length - 1) {
            return layer
          }
          if (layer.children && layer.children.length > 0) {
            const found = findLayer(layer.children, pathIndex + 1)
            if (found) return found
          }
        }
      }
      return null
    }

    const existingLayer = findLayer(getLayerTreeData().value || [])
    if (existingLayer && existingLayer.visible === visible && existingLayer.userVisible === visible) {
      return
    }

    /**
     * 更新路径目标及其祖先的显示状态。
     * 处理流程：
     * 1、沿路径递归收集祖先，到达目标后按需开启祖先
     * 2、更新目标用户状态、最终可见性及 PSD 原始数据
     * 3、隐藏目标时自下而上关闭没有可见子项的祖先
     */
    const updateVisibility = (layers, pathIndex = 0, currentPath = [], ancestorsToUpdate = []) => {
      // 1、沿唯一名称逐层定位，保留完整祖先链
      for (let layer of layers) {
        if (layer.uniqueName === pathParts[pathIndex]) {
          if (pathIndex === pathParts.length - 1) {
            // 到达目标图层

            // 🔧 如果设置为可见，先确保所有祖先图层都可见
            // 注意：只设置 visible，不设置 userVisible，因为这不是用户的主动选择
            if (visible && ancestorsToUpdate.length > 0) {
              ancestorsToUpdate.forEach((ancestor, index) => {
                if (!ancestor.visible) {
                  // 只设置 visible，不修改 userVisible
                  // 这样 selectedParts 计算时不会误认为父级图层组被选中
                  ancestor.visible = true

                  // 同步更新PSD底层数据中的祖先图层
                  if (currentPsdData.value?.layerHierarchy) {
                    const ancestorPath = pathParts.slice(0, index + 1)
                    updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, ancestorPath, 0, true)
                  }
                }
              })
            }

            // 2、设置目标图层的用户操作状态并同步最终显示结果
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

            // 同步更新PSD底层数据中的目标图层
            if (currentPsdData.value?.layerHierarchy) {
              updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, pathParts, 0, visible)
            }

            // 3、如果设置为不可见，检查并更新祖先图层的可见性
            // 如果父级图层组没有任何可见的子图层了，也应该将父级设置为不可见
            if (!visible && ancestorsToUpdate.length > 0) {
              // 从最深的祖先开始向上检查
              for (let i = ancestorsToUpdate.length - 1; i >= 0; i--) {
                const ancestor = ancestorsToUpdate[i]

                // 检查该祖先是否还有其他可见的子图层
                const hasVisibleChildren = ancestor.children && ancestor.children.some(child => child.visible || child.userVisible)

                if (!hasVisibleChildren) {
                  // 没有可见的子图层了，将父级也设置为不可见
                  ancestor.visible = false
                  // 注意：不修改 ancestor.userVisible，保持用户的原始选择

                  // 同步更新PSD底层数据
                  if (currentPsdData.value?.layerHierarchy) {
                    const ancestorPath = pathParts.slice(0, i + 1)
                    updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, ancestorPath, 0, false)
                  }
                } else {
                  // 还有可见的子图层，不需要继续向上检查
                  break
                }
              }
            }

            return true
          } else if (layer.children && layer.children.length > 0) {
            // 将当前图层添加到祖先列表中
            const newAncestors = [...ancestorsToUpdate, layer]

            return updateVisibility(layer.children, pathIndex + 1, [...currentPath, layer.uniqueName], newAncestors)
          }
        }
      }
      return false
    }

    // 2、更新目标与祖先，并通过内部流程同步 PSD 原始层级
    const result = updateVisibility(getLayerTreeData().value)
    // 3、记录无法匹配的路径，便于排查模板与 PSD 不一致
    if (!result) {
      console.warn(`⚠️ [setLayerVisibilityByPath] 未找到路径: ${path}`)
    }
  }

  /**
   * 选择组合表情（一次性选择/取消多个分组的子图层）
   * 处理流程：
   * 1、判断整组是否已选中并标记用户操作
   * 2、根据互斥模式清理同类或同组部件，再切换所选子项
   * 3、等待合并渲染并同步独立预览窗口
   */
  const selectCombinedExpression = async (combinedPart) => {
    // 1、校验组合数据，并以所有子项是否选中决定取消或应用
    if (!combinedPart || !Array.isArray(combinedPart.items) || combinedPart.items.length === 0) return

    try {
      // 是否为取消：全部子项都已选中
      const isDeselecting = combinedPart.items.every(({ groupKey, part }) => {
        const sel = selectedParts.value[groupKey]
        return sel && sel.path === part.path
      })

      // 标记涉及到的分组为用户已操作
      combinedPart.items.forEach(({ groupKey }) => {
        userInteracted.value[groupKey] = true
      })

      // 2、按互斥开关决定清理范围，再批量切换组合子项
      if (exclusiveMode.value) {
        if (isDeselecting) {
          // 取消：直接全部关闭
          combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, false))
        } else {
          // 组合表情在互斥开启时，仅在各自类别内部互斥，不跨类别清空
          if (expressionExclusiveMode.value) {
            // 构建类别 -> 该类别所有表情组keys（仅考虑眉/眼/嘴三大类）
            const typeToKeys = {}
            enhancedExpressionTabs.value.forEach(tab => {
              const meta = expressionTabMetaMap.value[tab.key] || {}
              if (meta?.isStandalone) return
              const category = meta?.baseCategory
              if (!category) return
              if (!typeToKeys[category]) typeToKeys[category] = []
              typeToKeys[category].push(tab.key)
            })
            // 对每个被选中的类别，清理该类别下所有组的其它部件
            // 🔧 修复：只有组合表情中实际选中的分组才能保留同path的部件
            combinedPart.items.forEach(({ groupKey, part }) => {
              const meta = expressionTabMetaMap.value[groupKey] || {}
              const category = meta?.baseCategory
              const keys = category ? (typeToKeys[category] || []) : []
              keys.forEach(k => {
                const list = allPartsListsMap.value[k] || []
                list.forEach(p => {
                  if (p && p.path) {
                    // 只有当前组合表情项对应的分组才能保留同path的部件
                    const shouldKeep = (k === groupKey) && (p.path === part.path)
                    if (!shouldKeep) {
                      setLayerVisibilityByPath(p.path, false)
                    }
                  }
                })
              })
            })
          } else {
            // 非表情互斥，仅清理同组的其它部件
            // 🔧 修复：避免同名表情被误保留
            combinedPart.items.forEach(({ groupKey, part }) => {
              const list = allPartsListsMap.value[groupKey] || []
              list.forEach(p => {
                if (p && p.path) {
                  const shouldKeep = p.path === part.path
                  if (!shouldKeep) {
                    setLayerVisibilityByPath(p.path, false)
                  }
                }
              })
            })
          }
          // 打开所选子项
          combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, true))
        }
      } else {
        // 多选模式：逐一切换
        if (isDeselecting) {
          combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, false))
        } else {
          combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, true))
        }
      }
      // 3、先完成主画布绘制，再同步独立预览
      await queueRenderAllLayers()

      // 同步到独立预览窗口
      nextTick(() => {
        if (typeof syncCanvasToPreview === 'function') {
          syncCanvasToPreview().catch(err => {
            console.debug('[预览同步] 预览窗口同步失败（可能未打开）:', err)
          })
        }
      })
    } catch (error) {
      console.error('选择组合表情失败:', error)
    }
  }

  /**
   * 根据图层名称或唯一名称设置可见性，供通用控制使用。
   * 处理流程：
   * 1、递归查找名称匹配的图层
   * 2、更新用户状态和最终可见性，同步 PSD 数据并记录未匹配名称
   */
  const setLayerVisibilityByName = (layerName, visible) => {
    // 1、名称为空时跳过，其他情况遍历全部图层以更新同名节点
    if (!layerName) return

    let found = false

    /**
     * 递归更新所有名称命中的图层。
     * 处理流程：
     * 1、匹配原始名称或唯一名称并结合正面控制更新显示状态
     * 2、同步命中节点的 PSD 数据，并继续递归子层级
     */
    const updateVisibility = (layers, currentPath = []) => {
      // 1、当前层级逐项检查，允许更新多个同名节点
      for (let layer of layers) {
        // 按原始名称或唯一名称进行完整匹配
        if (layer.name === layerName || layer.uniqueName === layerName) {
          // 设置用户操作状态
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

          found = true

          // 构建完整路径
          const pathParts = fullPath.split('/')

          // 2、同步更新 PSD 数据，随后继续遍历子层级
          if (currentPsdData.value?.layerHierarchy) {
            updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, pathParts, 0, visible)
          }

          console.log(`✅ [通用控制] 更新图层: ${fullPath} → userVisible: ${visible}, visible: ${layer.visible}`)
        }

        if (layer.children && layer.children.length > 0) {
          updateVisibility(layer.children, [...currentPath, layer.uniqueName])
        }
      }
    }

    // 2、执行递归更新，未找到名称时记录排查信息
    updateVisibility(getLayerTreeData().value)

    if (!found) {
      console.log(`⚠️ [通用控制] 未找到图层: ${layerName}`)
    }
  }

  /**
   * 获取图层的完整路径
   * 处理流程：
   * 1、递归比较图层对象身份并累积唯一名称
   * 2、返回命中路径，未找到时返回空字符串
   */
  const getLayerPath = (targetLayer) => {
    // 1、从图层树根节点按对象身份定位目标
    /**
     * 递归查找目标对象的唯一名称路径。
     * 处理流程：
     * 1、命中当前对象时返回路径，否则继续搜索子树
     */
    const findPath = (layers, currentPath = []) => {
      // 1、携带父级路径遍历各节点
      for (let layer of layers) {
        const newPath = [...currentPath, layer.uniqueName]
        if (layer === targetLayer) {
          return newPath.join('/')
        }
        if (layer.children && layer.children.length > 0) {
          const found = findPath(layer.children, newPath)
          if (found) return found
        }
      }
      return null
    }

    // 2、对外统一以空字符串表示未找到
    return findPath(getLayerTreeData().value) || ''
  }

  /**
   * 更新PSD数据中图层的可见性
   * 处理流程：
   * 1、重建当前层级的重名序号，与唯一路径匹配
   * 2、命中目标末段时修改可见性，否则递归对应子层级
   */
  const updatePsdLayerVisibility = (layers, pathParts, pathIndex, visible) => {
    // 1、每个层级独立重建唯一名称，保持与界面图层树一致
    const nameCountMap = new Map()
    for (let layer of layers) {
      let uniqueName = layer.name
      if (nameCountMap.has(layer.name)) {
        const count = nameCountMap.get(layer.name)
        nameCountMap.set(layer.name, count + 1)
        uniqueName = `${layer.name}#${count + 1}`
      } else {
        nameCountMap.set(layer.name, 1)
      }

      // 2、只在当前路径段命中的节点更新或递归
      if (uniqueName === pathParts[pathIndex]) {
        if (pathIndex === pathParts.length - 1) {
          layer.visible = visible
          return true
        } else if (layer.children && layer.children.length > 0) {
          return updatePsdLayerVisibility(layer.children, pathParts, pathIndex + 1, visible)
        }
      }
    }
    return false
  }

  // ==================== 表情关联头部互斥辅助 ====================
  const HEAD_NAME_PATTERN = /头/
  /**
   * 去掉图层唯一名称末尾的重名序号。
   * 处理流程：
   * 1、移除井号加数字后缀，保留原始业务名称
   */
  const stripSuffix = (name = '') => name.replace(/#\d+$/, '')

  /**
   * 查找唯一路径对应的节点及父级信息。
   * 处理流程：
   * 1、逐层匹配路径名称
   * 2、到达末段时返回节点、父节点和同级索引
   */
  const findLayerNodeByPath = (layers, pathParts, depth = 0, parent = null) => {
    // 1、先校验当前层级和路径范围，再沿匹配子树查找
    if (!layers || !pathParts || depth >= pathParts.length) return null
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (layer.uniqueName === pathParts[depth]) {
        if (depth === pathParts.length - 1) {
          // 2、保留同级索引，供头部互斥时排除当前节点
          return { node: layer, parent, index: i }
        }
        if (layer.children && layer.children.length > 0) {
          const found = findLayerNodeByPath(layer.children, pathParts, depth + 1, layer)
          if (found) return found
        }
      }
    }
    return null
  }

  /**
   * 查找表情图层最近的头部祖先路径。
   * 处理流程：
   * 1、从直接父级向根遍历，返回首个名称包含头部关键词的路径
   */
  const findHeadPathPartsFromExpression = (path) => {
    // 1、忽略目标自身，从父级开始匹配去除重名后缀的名称
    if (!path) return null
    const parts = path.split('/')
    // 从父级开始向上查找，允许在上层或上上层
    for (let i = parts.length - 2; i >= 0; i--) {
      if (HEAD_NAME_PATTERN.test(stripSuffix(parts[i]))) {
        return parts.slice(0, i + 1)
      }
    }
    return null
  }

  /**
   * 应用表情时保证对应头部与同级其他头部互斥。
   * 处理流程：
   * 1、找到最近头部祖先并开启
   * 2、遍历同级节点，关闭其他名称包含头部关键词的节点
   */
  const ensureHeadMutexForExpression = (expressionPath) => {
    // 1、只在表情路径中存在头部祖先时执行联动
    const headPathParts = findHeadPathPartsFromExpression(expressionPath)
    if (!headPathParts || headPathParts.length === 0) return

    const headPath = headPathParts.join('/')
    // 开启当前头部
    setLayerVisibilityByPath(headPath, true)

    // 2、找到当前头部节点，关闭同层级其他包含头部关键词的节点
    const headNodeInfo = findLayerNodeByPath(getLayerTreeData().value || [], headPathParts)
    if (!headNodeInfo) return
    const siblings = headNodeInfo.parent ? headNodeInfo.parent.children : (getLayerTreeData().value || [])

    siblings.forEach((sibling, idx) => {
      if (idx === headNodeInfo.index) return
      if (!HEAD_NAME_PATTERN.test(stripSuffix(sibling.uniqueName))) return
      const siblingPathParts = [...headPathParts]
      siblingPathParts[siblingPathParts.length - 1] = sibling.uniqueName
      setLayerVisibilityByPath(siblingPathParts.join('/'), false)
    })
  }

  /**
   * 选择部件（直接修改图层树visible状态）
   * 处理流程：
   * 1、分流组合表情，普通部件切回部件控制并退出预设
   * 2、解析代理来源，根据单选或多选及表情互斥规则修改图层
   * 3、应用动作互斥，并在需要时补齐另一只手的默认部件
   * 4、合并渲染画布并同步独立预览
   */
  const selectPart = async (part) => {
    // 1、组合表情使用批量入口，普通部件准备自身控制上下文
    if (!part) return

    // 组合表情的专用处理
    if (part.isCombined) {
      await selectCombinedExpression(part)
      return
    }

    // 切换控制优先级为部件模式
    if (getControlPriority().value !== 'parts') {
      getControlPriority().value = 'parts'
    }

    // 清除预设选择（用户选择部件时应该退出预设模式）
    if (selectedPresetId.value) {
      console.log('🔄 选择部件时清除预设选择')
      selectedPresetId.value = null
    }

    try {
      // 2、根据代理来源确定实际分组，再计算本次选中或取消及互斥范围
      const actualGroup = part._sourceGroup || currentTab.value
      const currentSelected = selectedParts.value[actualGroup]

      // 标记该分组已被用户手动操作
      userInteracted.value[actualGroup] = true

      // 查找当前标签页的配置（用于代理机制）
      const currentTabConfig = partTabs.value.find(tab => tab.key === currentTab.value)

      const proxyTargets = currentTabConfig?.proxyTargets || []

      // 判断是取消还是选中
      const isDeselecting = currentSelected && currentSelected.path === part.path

      if (exclusiveMode.value) {
        // 互斥模式：单选
        if (isDeselecting) {
          setLayerVisibilityByPath(part.path, false)
        } else {
          // 选中新部件：先隐藏该分组和代理分组的所有部件，再显示选中的

          // 收集需要清空的分组
          let groupsToClear = [currentTab.value, ...proxyTargets]

          // 🔧 表情互斥：按类别互斥
          // 眉毛、眼睛、嘴之间不互斥，只在各自类别内部互斥
          // 其他表情标签（如"表情"、"任意表情"等非眉眼嘴类）在其内部互斥
          // 变体标签（如"眉毛"、"眉毛表情"等）也被视为同一类别，会相互互斥
          if (currentTabConfig?.isExpression && expressionExclusiveMode.value) {
            const currentMeta = expressionTabMetaMap.value[currentTab.value] || {}
            const exprType = currentMeta.exprType || currentTabConfig?.exprType || null
            const isCategory = !currentMeta.isStandalone && (currentMeta.baseCategory === 'eyebrow' || currentMeta.baseCategory === 'eye' || currentMeta.baseCategory === 'mouth')
            const metaEntries = Object.entries(expressionTabMetaMap.value || {})

            if (currentMeta.isStandalone || exprType === 'standalone') {
              // 独立表情：清空所有表情分组，确保与任意表情互斥
              groupsToClear = metaEntries.map(([key]) => key)
            } else if (isCategory) {
              // 眉毛、眼睛、嘴：仅清空同类别的分组
              const sameTypeKeys = metaEntries
                .filter(([, meta]) => !meta?.isStandalone && meta?.baseCategory === currentMeta.baseCategory)
                .map(([key]) => key)
              groupsToClear = sameTypeKeys
            } else {
              // 其他表情（含 "表情*" 等标签）：清空非眉眼嘴类别
              const nonCategoryKeys = metaEntries
                .filter(([, meta]) => meta?.isStandalone || !(meta?.baseCategory === 'eyebrow' || meta?.baseCategory === 'eye' || meta?.baseCategory === 'mouth'))
                .map(([key]) => key)
              groupsToClear = nonCategoryKeys
            }

            if (!groupsToClear || groupsToClear.length === 0) {
              groupsToClear = [currentTab.value, ...proxyTargets]
            }
          }

          // 隐藏这些分组的所有部件图层（跳过即将要选中的图层）
          // 🔧 修复：只有当前选中的分组（actualGroup）才能保留同path的部件
          // 其他分组即使有同名表情（相同path）也应该被隐藏，避免多个表情被激活
          groupsToClear.forEach(groupKey => {
            const partsList = allPartsListsMap.value[groupKey] || []
            partsList.forEach(p => {
              // 如果是当前选中的分组，保留即将选中的部件（path匹配）
              // 如果是其他分组，即使path相同也要隐藏（避免同名表情被误激活）
              if (p && p.path) {
                const shouldKeep = (groupKey === actualGroup) && (p.path === part.path)
                if (!shouldKeep) {
                  setLayerVisibilityByPath(p.path, false)
                }
              }
            })
          })

          // 显示选中的部件
          setLayerVisibilityByPath(part.path, true)

          // 表情互斥时联动头部互斥（支持多头场景）
          if (currentTabConfig?.isExpression && expressionExclusiveMode.value) {
            ensureHeadMutexForExpression(part.path)
          }
        }
      } else {
        // 多选模式：切换
        if (isDeselecting) {
          setLayerVisibilityByPath(part.path, false)
        } else {
          setLayerVisibilityByPath(part.path, true)
        }
      }

      // 3、动作互斥时协调双手、单手与动作，并按需补齐另一只手
      if (actionExclusiveMode.value && !isDeselecting) {
        const actionRelatedGroups = {
          bothHands: 'bothHands',
          frontHandNormal: 'frontHandNormal',
          frontHandRight: 'frontHandRight',
          frontHandBoth: 'frontHandBoth',
          backHand: 'backHand',
          frontLayerBackHand: 'frontLayerBackHand',
          action: 'action'
        }

        // 检查当前选中的是否是动作相关分组
        if (actionRelatedGroups[actualGroup]) {

          let groupsToClose = []
          let handToEnsure = null // 需要确保有图层显示的手（leftHand 或 rightHand）

          if (actualGroup === 'bothHands' || actualGroup === 'frontHandBoth') {
            // 点击双手 → 关闭动作、左手、右手（所有手部分组）
            groupsToClose = ['action', 'frontHandNormal', 'frontHandRight', 'backHand', 'frontLayerBackHand']
          } else if (actualGroup === 'action') {
            // 点击动作 → 关闭双手、左手、右手（所有手部分组）
            groupsToClose = ['bothHands', 'frontHandBoth', 'frontHandNormal', 'frontHandRight', 'backHand', 'frontLayerBackHand']
          } else if (actualGroup === 'frontHandNormal') {
            // 点击左手 → 关闭双手、动作
            groupsToClose = ['bothHands', 'frontHandBoth', 'action']
            handToEnsure = 'rightHand'
          } else if (actualGroup === 'frontHandRight' || actualGroup === 'backHand' || actualGroup === 'frontLayerBackHand') {
            // 点击右手（任意右手分组）→ 关闭双手、动作，以及其他右手分组
            groupsToClose = ['bothHands', 'frontHandBoth', 'action']

            // 关闭其他右手分组
            if (actualGroup !== 'frontHandRight') groupsToClose.push('frontHandRight')
            if (actualGroup !== 'backHand') groupsToClose.push('backHand')
            if (actualGroup !== 'frontLayerBackHand') groupsToClose.push('frontLayerBackHand')

            handToEnsure = 'leftHand'
          }

          // 如果需要确保某只手有图层显示，先检查再决定是否补手
          if (handToEnsure) {
            // 确定目标手的所有相关分组
            let targetGroups = []
            if (handToEnsure === 'leftHand') {
              targetGroups = ['frontHandNormal']
            } else {
              // 右手包括：后手、前层后手、前手(右手)
              targetGroups = ['backHand', 'frontLayerBackHand', 'frontHandRight']
            }

            // 先检查所有目标分组是否有任何可见的图层
            let hasVisibleInAnyGroup = false
            for (const targetGroup of targetGroups) {
              const targetPartsList = allPartsListsMap.value[targetGroup] || []
              const hasVisible = targetPartsList.some(p => {
                if (!p || !p.path) return false
                const pathParts = p.path.split('/')
                /**
                 * 查询待补手部件是否已被用户设为可见。
                 * 处理流程：
                 * 1、沿唯一路径查找目标，返回用户可见状态
                 */
                const findLayer = (layers, index = 0) => {
                  // 1、按路径逐层查询，未命中时视为未显示
                  for (const layer of layers) {
                    if (layer.uniqueName === pathParts[index]) {
                      if (index === pathParts.length - 1) {
                        return layer.userVisible
                      } else if (layer.children) {
                        return findLayer(layer.children, index + 1)
                      }
                    }
                  }
                  return false
                }
                return findLayer(getLayerTreeData().value)
              })

              if (hasVisible) {
                hasVisibleInAnyGroup = true
                break
              }
            }

            // 如果所有目标分组都没有可见图层，才补手
            if (!hasVisibleInAnyGroup) {
              let defaultPart = null
              let defaultGroup = null

              // 优先从第一个非空分组中选择默认图层
              for (const targetGroup of targetGroups) {
                const targetPartsList = allPartsListsMap.value[targetGroup] || []
                if (targetPartsList.length > 0) {
                  // 寻找"基础"或第一个部件
                  defaultPart = targetPartsList.find(p => p.name === '基础' || p.name === '基本' || p.name === '默认')
                  if (!defaultPart) {
                    defaultPart = targetPartsList[0]
                  }
                  defaultGroup = targetGroup
                  break
                }
              }

              if (defaultPart && defaultPart.path && defaultGroup) {
                setLayerVisibilityByPath(defaultPart.path, true)
                userInteracted.value[defaultGroup] = true
              }
            }
          }

          // 关闭指定的分组（在检查补手之后，这样不会影响检查结果）
          groupsToClose.forEach(groupKey => {
            const partsList = allPartsListsMap.value[groupKey] || []
            partsList.forEach(p => {
              if (p && p.path) {
                setLayerVisibilityByPath(p.path, false)
              }
            })
            // 标记该分组已被用户操作
            userInteracted.value[groupKey] = true
          })
        }
      }

      // 表情互斥已经由本方法前面的单选分支处理

      // 4、合并主画布渲染请求，并在下一轮视图更新后同步预览
      await queueRenderAllLayers()

      // 🔄 同步到独立预览窗口
      nextTick(() => {
        if (typeof syncCanvasToPreview === 'function') {
          syncCanvasToPreview().catch(err => {
            console.debug('[预览同步] 预览窗口同步失败（可能未打开）:', err)
          })
        }
      })
    } catch (error) {
      console.error('选择部件失败:', error)
    }
  }

  // 3、只公开原调用方需要的入口；路径查询保留为本职责的兼容辅助。
  return { switchTab, handleTabClick, setLayerVisibilityByPath, setLayerVisibilityByName, getLayerPath, selectPart }
}
