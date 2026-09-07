/** 通用控件与图层反向同步：复用原控件引用，在页面原位置显式注册监听。 */
import { watch } from 'vue'

/** 创建原采样日志函数。处理流程：1、仅建立闭包，触发渲染时才读取记录器。 */
export function createRenderTriggerLogger(perfLogger) {
  /**
   * 采样记录画布渲染触发原因。
   * 处理流程：
   * 1、合并来源与附加信息，按四次一次的频率记录事件
   */
  const logRenderTrigger = (source, meta = {}) => {
    // 1、通过共享性能记录器降低重复日志数量
    perfLogger.logEvent('render:trigger', { source, ...meta }, { sampleEvery: 4 })
  }
  return logRenderTrigger
}

/** 建立双向同步入口。处理流程：1、持有唯一同步标记；2、监听等最终依赖就绪后再注册。 */
export function useCommonControlLayerSync({
  showBackground, showFront, showSide, showBack, showShadow, showWeapon, showBackHair,
  showShakeHead, showHoldSword, showBackHandSword, showDownwardSlash,
  selectedPresetId, originalHandleLayerVisibilityChange
}) {
  // 1、原同步标记仅迁移归属，不改为 ref，也不延后恢复时机。
  let isSyncingFromLayerTree = false

  /**
   * 包装图层树可见性操作并反向同步通用控制。
   * 处理流程：
   * 1、退出预设并等待图层树原始操作完成
   * 2、按图层名称映射控制开关，设置同步标记避免监听循环
   */
  const handleLayerVisibilityChange = async (params) => {
    // 1、用户操作图层树时退出预设模式，并执行原始图层更新
    if (selectedPresetId.value) {
      console.log('🔄 操作图层树时清除预设选择')
      selectedPresetId.value = null
    }

    // 调用原始函数
    await originalHandleLayerVisibilityChange(params)

    // 2、将图层树变化反向同步到对应通用控制开关
    const layerName = params.layerPath.split('/').pop()
    const layerNameBase = layerName.replace(/#\d+$/, '') // 去除#2等后缀

    // 映射图层名称到通用控制（注意：正面不在此映射，它是渲染过滤器）
    const layerToControlMap = {
      '背景': showBackground,
      '侧面': showSide,
      '侧身': showSide,
      '侧视': showSide,
      '侧视图': showSide,
      '背面': showBack,
      '背影': showBack,
      '背身': showBack,
      '背视': showBack,
      '背视图': showBack,
      '后面': showBack, // 后面是背面的变体
      '阴影': showShadow,
      '武器': showWeapon,
      '后发': showBackHair,
      '后头发': showBackHair,
      '发型后': showBackHair,
      '摇摇头': showShakeHead,
      '持剑': showHoldSword,
      '后手持剑': showBackHandSword,
      '下压挥剑': showDownwardSlash
    }

    const controlRef = layerToControlMap[layerNameBase]
    if (controlRef && controlRef.value !== params.visible) {
      // 标记正在同步，避免触发watch
      isSyncingFromLayerTree = true
      controlRef.value = params.visible
      isSyncingFromLayerTree = false
      console.log(`🔄 [反向同步] 通用控制更新: ${layerNameBase} → ${params.visible}`)
    }
  }

  /** 注册通用控件监听。处理流程：1、在原尾部位置接收最终引用；2、逐项保留原回调和顺序。 */
  const registerCommonControlWatches = ({ layerTreeData, setLayerVisibilityByName, renderAllLayers, logRenderTrigger }) => {
    // 2、由页面同步调用，watch 仍归属当前组件；不新增手动停止或生命周期清理。
    watch(showBackground, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showBackground', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('背景', newVal)
      await renderAllLayers()
    })

    watch(showFront, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showFront', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }

      /**
       * 根据正面开关重新计算图层最终可见性。
       * 处理流程：
       * 1、正面开启时恢复用户状态，关闭时仅保留特殊分组
       * 2、携带完整路径递归更新所有子节点
       */
      const recalculateVisible = (layers, currentPath = []) => {
        // 1、保留用户选择，仅修改受正面开关影响的最终显示状态
        for (let layer of layers) {
          const fullPath = [...currentPath, layer.uniqueName].join('/')
          const isSpecialGroup = /(侧面|侧身|侧视|背面|背影|背身|背视|后面|背景|武器|阴影|摇摇头|持剑|后手持剑|下压挥剑|后发|后头发|发型后)/.test(fullPath)

          if (newVal) {
            // 正面勾选：恢复用户设置的状态
            layer.visible = layer.userVisible
          } else {
            // 正面取消：只显示特殊图组，隐藏普通图层
            if (isSpecialGroup) {
              layer.visible = layer.userVisible
            } else {
              layer.visible = false
            }
          }

          // 2、递归处理子图层，继承路径中的特殊分组信息
          if (layer.children && layer.children.length > 0) {
            recalculateVisible(layer.children, [...currentPath, layer.uniqueName])
          }
        }
      }

      recalculateVisible(layerTreeData.value)
      console.log(`✅ [正面控制] 已重新计算所有图层visible状态，正面: ${newVal}`)

      await renderAllLayers()
    })

    watch(showSide, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showSide', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      ;['侧面', '侧身', '侧视', '侧视图'].forEach(name => {
        setLayerVisibilityByName(name, newVal)
      })
      await renderAllLayers()
    })

    watch(showBack, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showBack', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      ;['背面', '背影', '背身', '背视', '背视图', '后面'].forEach(name => {
        setLayerVisibilityByName(name, newVal)
      })
      await renderAllLayers()
    })

    watch(showShadow, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showShadow', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('阴影', newVal)
      await renderAllLayers()
    })

    watch(showWeapon, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showWeapon', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('武器', newVal)
      await renderAllLayers()
    })

    watch(showBackHair, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showBackHair', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      ;['后发', '后头发', '发型后'].forEach(name => {
        setLayerVisibilityByName(name, newVal)
      })
      await renderAllLayers()
    })

    watch(showShakeHead, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showShakeHead', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('摇摇头', newVal)
      await renderAllLayers()
    })

    watch(showHoldSword, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showHoldSword', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('持剑', newVal)
      await renderAllLayers()
    })

    watch(showBackHandSword, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showBackHandSword', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('后手持剑', newVal)
      await renderAllLayers()
    })

    watch(showDownwardSlash, async (newVal) => {
      if (isSyncingFromLayerTree) return
      logRenderTrigger('showDownwardSlash', { value: newVal })
      // 清除预设选择（用户操作通用控制时应该退出预设模式）
      if (selectedPresetId.value) {
        console.log('🔄 操作通用控制时清除预设选择')
        selectedPresetId.value = null
      }
      setLayerVisibilityByName('下压挥剑', newVal)
      await renderAllLayers()
    })
  }

  return { handleLayerVisibilityChange, registerCommonControlWatches }
}
