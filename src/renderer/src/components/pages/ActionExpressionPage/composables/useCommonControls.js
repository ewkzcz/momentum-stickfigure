/**
 * 通用控制逻辑 Composable
 * 管理所有通用控制选项的状态和操作
 */

import { ref } from 'vue'

/**
 * 管理图组显示、互斥模式及头部筛选。
 * 处理流程：
 * 1、建立可延迟设置的依赖代理及默认控制状态。
 * 2、定义控制切换、重置及保存恢复逻辑。
 * 3、导出状态和处理函数。
 * @param {Object} deps - 依赖项
 * @param {Function} deps.renderAllLayers - 重新渲染画布函数
 * @param {Object} deps.message - 消息提示对象
 */
export function useCommonControls(deps = {}) {
  // 1、允许后续设置依赖（由于初始化顺序问题），并初始化控制状态。
  const depsProxy = {
    /** 读取渲染依赖。处理流程：1、返回当前注入的重绘函数。 */
    get renderAllLayers() {
      // 1、读取最新注入值。
      return deps.renderAllLayers
    },
    /** 设置渲染依赖。处理流程：1、替换共享依赖中的重绘函数。 */
    set renderAllLayers(value) {
      // 1、保存后续调用使用的重绘函数。
      deps.renderAllLayers = value
    },
    /** 读取消息服务。处理流程：1、返回当前注入的提示对象。 */
    get message() {
      // 1、读取最新提示依赖。
      return deps.message
    },
    /** 设置消息服务。处理流程：1、覆盖提示依赖供后续操作使用。 */
    set message(value) {
      // 1、保存消息提示服务。
      deps.message = value
    }
  }
  // ==================== 通用控制状态 ====================
  
  // 基础显示控制
  const showBackground = ref(false)         // 是否显示背景图层，默认不显示
  const showBaseLayer = ref(true)           // 是否显示底图（PSD最底层图层），默认显示（建议不勾选）
  const showSecondBaseLayer = ref(true)     // 是否显示第二底图（PSD倒数第二层图层），默认显示
  
  // 方向控制
  const showFront = ref(true)               // 是否显示正面图组，默认显示
  const showSide = ref(false)               // 是否显示侧面/侧身图组，默认不显示
  const showBack = ref(false)               // 是否显示背面图组（包含后面），默认不显示
  const showRear = ref(false)               // 已废弃：后面已合并到背面，保留以兼容旧版本
  
  // 特殊图组控制
  const showWeapon = ref(false)             // 是否显示武器图组，默认不显示
  const showBackHair = ref(true)            // 是否显示后发/发型后图组，默认显示
  const showShadow = ref(false)             // 是否显示阴影图组，默认不显示
  const showShakeHead = ref(false)          // 是否显示摇摇头图组，默认不显示
  const showHoldSword = ref(false)          // 是否显示持剑图组，默认不显示
  const showBackHandSword = ref(false)      // 是否显示后手持剑图组，默认不显示
  const showDownwardSlash = ref(false)      // 是否显示下压挥剑图组，默认不显示
  
  // 模式控制
  const exclusiveMode = ref(true)           // 图层互斥模式，默认开启
  const actionExclusiveMode = ref(true)     // 动作互斥模式，默认开启（双手/左手/右手/动作互斥）
  const expressionExclusiveMode = ref(true) // 表情互斥模式，默认开启（不同表情图组互斥）
  
  // 拖拽到剪映相关
  const enableTrimWhitespace = ref('no-trim')   // 默认不剪切空白像素（会导致剪映替换图片偏移）
  
  // 头部/非头部选择
  const selectHeadOnly = ref(false)     // 是否只显示头部相关图组（头、脸型、前发、后发、表情），默认关闭
  const selectNonHead = ref(false)      // 是否只显示非头部图组，默认关闭
  
  // UI状态
  const commonControlsCollapsed = ref(true) // 通用控制区域折叠状态（默认折叠以节省空间）
  
  // 2、定义控制变化和状态保存恢复操作。
  
  /**
   * 切换通用控制区域折叠状态
   * 处理流程：
   * 1、反转折叠状态。
   */
  const toggleCommonControlsPanel = () => {
    // 1、切换面板展开状态。
    commonControlsCollapsed.value = !commonControlsCollapsed.value
  }
  
  /**
   * 重置通用控制到默认状态
   * 处理流程：
   * 1、恢复所有图组显示与互斥控制默认值。
   * 2、等待画布重绘并提示重置结果。
   */
  const resetCommonControls = async () => {
    console.log('🔄 重置通用控制到默认状态...')
    
    // 1、恢复所有通用控制到默认值。
    showBackground.value = false         // 背景，默认不显示
    showBaseLayer.value = true           // 最下层白色背景，默认显示（建议不勾选）
    showSecondBaseLayer.value = true     // 次下层白色背景，默认显示
    showWeapon.value = false             // 武器，默认不显示
    showBackHair.value = true            // 后发/发型后，默认显示
    showShadow.value = false             // 阴影，默认不显示
    showShakeHead.value = false          // 摇摇头，默认不显示
    showHoldSword.value = false          // 持剑，默认不显示
    showBackHandSword.value = false      // 后手持剑，默认不显示
    showDownwardSlash.value = false      // 下压挥剑，默认不显示
    exclusiveMode.value = true           // 互斥模式，默认开启
    actionExclusiveMode.value = true     // 动作互斥，默认开启
    expressionExclusiveMode.value = true // 表情互斥，默认开启
    showFront.value = true               // 正面，默认显示
    showSide.value = false               // 侧面/侧身，默认不显示
    showBack.value = false               // 背面，默认不显示
    showRear.value = false               // 后面，默认不显示
    enableTrimWhitespace.value = 'no-trim' // 剪切空白像素，默认不剪切
    selectHeadOnly.value = false         // 选择头部，默认关闭
    selectNonHead.value = false          // 选择非头部，默认关闭
    
    console.log('✅ 通用控制已重置到默认状态')
    
    // 2、重新渲染画布并提示完成。
    if (depsProxy.renderAllLayers) {
      await depsProxy.renderAllLayers()
    }
    
    if (depsProxy.message) {
      depsProxy.message.success('通用控制已重置到默认状态')
    }
  }
  
  /**
   * 处理通用控制变化
   * 处理流程：
   * 1、记录当前显示控制状态。
   * 2、调用重绘函数应用状态。
   */
  const handleCommonControlChange = async () => {
    // 1、记录头部与非头部及其他显示控制的当前状态。
    // 头部/非头部选择互斥逻辑
    // 注意：这里不能直接在事件处理中获取event.target，因为是从Vue的@change调用
    // 互斥逻辑将在各自的单选框处理函数中实现
    
    console.log('🔄 通用控制变化:', {
      showBackground: showBackground.value,
      showBaseLayer: showBaseLayer.value,
      showSecondBaseLayer: showSecondBaseLayer.value,
      showWeapon: showWeapon.value,
      showBackHair: showBackHair.value,
      showShadow: showShadow.value,
      showShakeHead: showShakeHead.value,
      showHoldSword: showHoldSword.value,
      showBackHandSword: showBackHandSword.value,
      showDownwardSlash: showDownwardSlash.value,
      selectHeadOnly: selectHeadOnly.value,
      selectNonHead: selectNonHead.value
    })

    // 2、重新渲染画布（渲染逻辑会读取 layerTreeData.visible 和通用控制状态）。
    if (depsProxy.renderAllLayers) {
      await depsProxy.renderAllLayers()
    }
  }
  
  /**
   * 处理选择头部变化（互斥逻辑）
   * 处理流程：
   * 1、选中头部时取消冲突的非头部选择。
   * 2、应用通用控制变化并重绘。
   */
  const handleSelectHeadOnlyChange = async () => {
    // 1、确保两种筛选互斥。
    if (selectHeadOnly.value && selectNonHead.value) {
      // 如果两个都选中，关闭非头部选择
      selectNonHead.value = false
    }
    // 2、应用更新后的显示控制。
    await handleCommonControlChange()
  }
  
  /**
   * 处理选择非头部变化（互斥逻辑）
   * 处理流程：
   * 1、选中非头部时取消冲突的头部选择。
   * 2、应用通用控制变化并重绘。
   */
  const handleSelectNonHeadChange = async () => {
    // 1、确保两种筛选互斥。
    if (selectNonHead.value && selectHeadOnly.value) {
      // 如果两个都选中，关闭头部选择
      selectHeadOnly.value = false
    }
    // 2、应用更新后的显示控制。
    await handleCommonControlChange()
  }
  
  /**
   * 获取所有通用控制状态（用于保存/恢复）
   * 处理流程：
   * 1、提取需要持久化的控制值，返回普通对象快照。
   */
  const getCommonControlsState = () => {
    // 1、读取响应式值，避免将引用写入持久化数据。
    return {
      showBackground: showBackground.value,
      showBaseLayer: showBaseLayer.value,
      showSecondBaseLayer: showSecondBaseLayer.value,
      showWeapon: showWeapon.value,
      showBackHair: showBackHair.value,
      showShadow: showShadow.value,
      showShakeHead: showShakeHead.value,
      showHoldSword: showHoldSword.value,
      showBackHandSword: showBackHandSword.value,
      showDownwardSlash: showDownwardSlash.value,
      exclusiveMode: exclusiveMode.value,
      actionExclusiveMode: actionExclusiveMode.value,
      expressionExclusiveMode: expressionExclusiveMode.value,
      showFront: showFront.value,
      showSide: showSide.value,
      showBack: showBack.value,
      showRear: showRear.value,
      selectHeadOnly: selectHeadOnly.value,
      selectNonHead: selectNonHead.value
    }
  }
  
  /**
   * 恢复通用控制状态（从保存的状态）
   * 处理流程：
   * 1、忽略空快照，恢复已保存的控制值。
   * 2、兼容缺失互斥字段和旧版后面控制。
   */
  const restoreCommonControlsState = (savedState) => {
    // 1、检查快照并恢复基础显示值。
    if (!savedState) return
    
    showBackground.value = savedState.showBackground
    showBaseLayer.value = savedState.showBaseLayer
    showSecondBaseLayer.value = savedState.showSecondBaseLayer
    showWeapon.value = savedState.showWeapon
    showBackHair.value = savedState.showBackHair
    showShadow.value = savedState.showShadow
    showShakeHead.value = savedState.showShakeHead
    showHoldSword.value = savedState.showHoldSword
    showBackHandSword.value = savedState.showBackHandSword
    showDownwardSlash.value = savedState.showDownwardSlash
    exclusiveMode.value = savedState.exclusiveMode
    // 2、补齐旧快照未保存的互斥控制，合并后面到背面。
    actionExclusiveMode.value = savedState.actionExclusiveMode !== undefined ? savedState.actionExclusiveMode : true
    expressionExclusiveMode.value = savedState.expressionExclusiveMode !== undefined ? savedState.expressionExclusiveMode : true
    showFront.value = savedState.showFront
    showSide.value = savedState.showSide
    // 背面控制：包含后面（兼容旧版本的showRear）
    showBack.value = savedState.showBack || savedState.showRear || false
    showRear.value = false  // 已废弃，重置为false
    selectHeadOnly.value = savedState.selectHeadOnly !== undefined ? savedState.selectHeadOnly : false
    selectNonHead.value = savedState.selectNonHead !== undefined ? savedState.selectNonHead : false
  }
  
  // 3、导出通用控制状态与处理入口。
  
  return {
    // 状态
    showBackground,
    showBaseLayer,
    showSecondBaseLayer,
    showWeapon,
    showBackHair,
    showShadow,
    showShakeHead,
    showHoldSword,
    showBackHandSword,
    showDownwardSlash,
    exclusiveMode,
    actionExclusiveMode,
    expressionExclusiveMode,
    showFront,
    showSide,
    showBack,
    showRear,
    enableTrimWhitespace,
    commonControlsCollapsed,
    selectHeadOnly,
    selectNonHead,
    
    // 方法
    toggleCommonControlsPanel,
    resetCommonControls,
    handleCommonControlChange,
    handleSelectHeadOnlyChange,
    handleSelectNonHeadChange,
    getCommonControlsState,
    restoreCommonControlsState
  }
}
