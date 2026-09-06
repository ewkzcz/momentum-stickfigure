/**
 * 部件状态管理 Composable
 * 
 * 职责：管理所有部件分类相关的响应式状态
 * 
 * 包含：
 * - 基础部件分类状态（前手、后手、双手、上身、下身、动作）
 * - 动态表情图组状态
 * - 动态分组状态（前手、后手、双手、上身、下身、动作）
 */

import { ref } from 'vue'

/**
 * 初始化部件状态
 * 处理流程：
 * 1、创建基础分类、动态表情和兼容分组状态。
 * 2、定义清空、分类结果写入与快照读取方法。
 * 3、返回分类引用和辅助操作。
 */
export function usePartsState() {
  // 1、建立基础分类及动态分组状态。
  
  // 前手部件（基础分类）
  const frontHandParts = ref([]) // 前手部件列表（完整列表，用于内部处理）
  const frontHandNormalParts = ref([]) // 前手部件列表
  const frontHandRightParts = ref([]) // 前手(右手)部件列表
  const frontHandBothParts = ref([]) // 前手(双手)部件列表
  
  // 后手和双手部件
  const backHandParts = ref([]) // 后手部件列表
  const frontLayerBackHandParts = ref([]) // 前层后手部件列表
  const bothHandsParts = ref([]) // 双手部件列表
  
  // 身体部件
  const upperBodyParts = ref([]) // 上身部件列表
  const lowerBodyParts = ref([]) // 下身部件列表
  
  // 动作部件
  const actionParts = ref([]) // 动作部件列表
  
  // ==================== 动态表情图组状态 ====================
  
  // 动态表情图组存储（使用Map结构，key为表情图组名称，value为部件列表）
  // 示例：{ 'expr_expression_123': [], 'expr_expression1_456': [], 'expr_custom_789': [] }
  const dynamicExpressionParts = ref({})
  
  // 动态表情标签页配置
  // 示例：[{ key: 'expr_expression_123', label: '表情', layerName: '表情', path: '表情' }]
  const dynamicExpressionTabs = ref([])
  
  // ==================== 动态分组状态（已禁用，但保留兼容性）====================
  
  // 前手动态分组（已禁用，保留代码兼容性）
  const dynamicFrontHandParts = ref({})
  const dynamicFrontHandTabs = ref([])
  
  // 后手动态分组（已禁用，保留代码兼容性）
  const dynamicBackHandParts = ref({})
  const dynamicBackHandTabs = ref([])
  
  // 双手动态分组（已禁用，保留代码兼容性）
  const dynamicBothHandsParts = ref({})
  const dynamicBothHandsTabs = ref([])
  
  // 上身动态分组（已禁用，保留代码兼容性）
  const dynamicUpperBodyParts = ref({})
  const dynamicUpperBodyTabs = ref([])
  
  // 下身动态分组（已禁用，保留代码兼容性）
  const dynamicLowerBodyParts = ref({})
  const dynamicLowerBodyTabs = ref([])
  
  // 动作动态分组（已禁用，保留代码兼容性）
  const dynamicActionParts = ref({})
  const dynamicActionTabs = ref([])
  
  // 2、定义整批状态更新及缓存读写操作。
  /**
   * 清空所有部件状态
   * 处理流程：
   * 1、清空基础部件数组。
   * 2、清空表情与兼容分组的映射和标签。
   */
  const clearAllPartsState = () => {
    // 1、清空基础部件。
    frontHandParts.value = []
    frontHandNormalParts.value = []
    frontHandRightParts.value = []
    frontHandBothParts.value = []
    backHandParts.value = []
    frontLayerBackHandParts.value = []
    bothHandsParts.value = []
    upperBodyParts.value = []
    lowerBodyParts.value = []
    actionParts.value = []
    
    // 2、清空动态表情及其他分组。
    dynamicExpressionParts.value = {}
    dynamicExpressionTabs.value = []
    
    // 清空动态其他分组
    dynamicFrontHandParts.value = {}
    dynamicFrontHandTabs.value = []
    dynamicBackHandParts.value = {}
    dynamicBackHandTabs.value = []
    dynamicBothHandsParts.value = {}
    dynamicBothHandsTabs.value = []
    dynamicUpperBodyParts.value = {}
    dynamicUpperBodyTabs.value = []
    dynamicLowerBodyParts.value = {}
    dynamicLowerBodyTabs.value = []
    dynamicActionParts.value = {}
    dynamicActionTabs.value = []
  }
  
  /**
   * 从分类结果更新所有部件状态
   * 处理流程：
   * 1、写入基础分类，缺失类别使用空数组。
   * 2、写入动态表情和兼容分组，缺失字段使用空容器。
   * @param {Object} parts - 分类结果对象
   */
  const updatePartsFromClassifyResult = (parts) => {
    // 1、更新基础部件。
    frontHandParts.value = parts.frontHand || []
    frontHandNormalParts.value = parts.frontHandNormal || []
    frontHandRightParts.value = parts.frontHandRight || []
    frontHandBothParts.value = parts.frontHandBoth || []
    backHandParts.value = parts.backHand || []
    frontLayerBackHandParts.value = parts.frontLayerBackHand || []
    bothHandsParts.value = parts.bothHands || []
    upperBodyParts.value = parts.upperBody || []
    lowerBodyParts.value = parts.lowerBody || []
    actionParts.value = parts.action || []
    
    // 2、更新动态表情及兼容图组。
    dynamicExpressionParts.value = parts.expressions || {}
    dynamicExpressionTabs.value = parts.expressionTabs || []
    
    console.log('📦 已加载动态表情图组:', dynamicExpressionTabs.value.length, '个')
    
    // 更新动态其他分组（已禁用，但保留字段）
    dynamicFrontHandParts.value = parts.frontHandDynamic || {}
    dynamicFrontHandTabs.value = parts.frontHandDynamicTabs || []
    dynamicBackHandParts.value = parts.backHandDynamic || {}
    dynamicBackHandTabs.value = parts.backHandDynamicTabs || []
    dynamicBothHandsParts.value = parts.bothHandsDynamic || {}
    dynamicBothHandsTabs.value = parts.bothHandsDynamicTabs || []
    dynamicUpperBodyParts.value = parts.upperBodyDynamic || {}
    dynamicUpperBodyTabs.value = parts.upperBodyDynamicTabs || []
    dynamicLowerBodyParts.value = parts.lowerBodyDynamic || {}
    dynamicLowerBodyTabs.value = parts.lowerBodyDynamicTabs || []
    dynamicActionParts.value = parts.actionDynamic || {}
    dynamicActionTabs.value = parts.actionDynamicTabs || []
  }
  
  /**
   * 获取所有部件状态的快照（用于缓存）
   * 处理流程：
   * 1、按分类结果结构读取当前引用值，返回浅层快照。
   * @returns {Object} 部件状态快照
   */
  const getPartsStateSnapshot = () => {
    // 1、返回现有集合引用；调用方需自行决定是否深拷贝。
    return {
      frontHand: frontHandParts.value,
      frontHandNormal: frontHandNormalParts.value,
      frontHandRight: frontHandRightParts.value,
      frontHandBoth: frontHandBothParts.value,
      backHand: backHandParts.value,
      frontLayerBackHand: frontLayerBackHandParts.value,
      bothHands: bothHandsParts.value,
      upperBody: upperBodyParts.value,
      lowerBody: lowerBodyParts.value,
      action: actionParts.value,
      expressions: dynamicExpressionParts.value,
      expressionTabs: dynamicExpressionTabs.value,
      frontHandDynamic: dynamicFrontHandParts.value,
      frontHandDynamicTabs: dynamicFrontHandTabs.value,
      backHandDynamic: dynamicBackHandParts.value,
      backHandDynamicTabs: dynamicBackHandTabs.value,
      bothHandsDynamic: dynamicBothHandsParts.value,
      bothHandsDynamicTabs: dynamicBothHandsTabs.value,
      upperBodyDynamic: dynamicUpperBodyParts.value,
      upperBodyDynamicTabs: dynamicUpperBodyTabs.value,
      lowerBodyDynamic: dynamicLowerBodyParts.value,
      lowerBodyDynamicTabs: dynamicLowerBodyTabs.value,
      actionDynamic: dynamicActionParts.value,
      actionDynamicTabs: dynamicActionTabs.value
    }
  }
  
  // 3、导出分类状态和辅助方法。
  return {
    // 基础部件状态
    frontHandParts,
    frontHandNormalParts,
    frontHandRightParts,
    frontHandBothParts,
    backHandParts,
    frontLayerBackHandParts,
    bothHandsParts,
    upperBodyParts,
    lowerBodyParts,
    actionParts,
    
    // 动态表情图组
    dynamicExpressionParts,
    dynamicExpressionTabs,
    
    // 动态分组（已禁用，保留兼容性）
    dynamicFrontHandParts,
    dynamicFrontHandTabs,
    dynamicBackHandParts,
    dynamicBackHandTabs,
    dynamicBothHandsParts,
    dynamicBothHandsTabs,
    dynamicUpperBodyParts,
    dynamicUpperBodyTabs,
    dynamicLowerBodyParts,
    dynamicLowerBodyTabs,
    dynamicActionParts,
    dynamicActionTabs,
    
    // 辅助方法
    clearAllPartsState,
    updatePartsFromClassifyResult,
    getPartsStateSnapshot
  }
}
