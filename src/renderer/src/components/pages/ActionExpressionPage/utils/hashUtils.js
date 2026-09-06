/**
 * 哈希计算工具函数
 * 用于计算PSD文件的内容哈希值，支持PSD文件移动后的匹配
 */

/**
 * 计算PSD文件内容的哈希值（用于匹配移动后的PSD文件）
 * 处理流程：
 * 1、检查 PSD 及图层层级是否可用。
 * 2、序列化尺寸、图层数量和结构作为摘要输入。
 * 3、计算 SHA-256 并返回十六进制结果，异常时返回空值。
 * @param {Object} psdData - PSD数据对象
 * @param {number} psdData.width - PSD宽度
 * @param {number} psdData.height - PSD高度
 * @param {Array} psdData.layerHierarchy - 图层层级结构
 * @returns {Promise<string|null>} 返回SHA-256哈希值（十六进制字符串），失败返回null
 */
export const calculatePsdHash = async (psdData) => {
  // 1、过滤缺少图层结构的数据。
  try {
    if (!psdData || !psdData.layerHierarchy) {
      console.warn('⚠️ PSD数据为空，无法计算哈希')
      return null
    }
    
    // 2、使用 PSD 的关键特征来计算哈希：宽度、高度、图层结构。
    const hashSource = JSON.stringify({
      width: psdData.width,
      height: psdData.height,
      layerCount: psdData.layerHierarchy?.length || 0,
      // 递归获取所有图层名称和路径
      layerStructure: JSON.stringify(psdData.layerHierarchy)
    })
    
    // 3、使用 SubtleCrypto API 计算 SHA-256 哈希并转换为十六进制。
    const encoder = new TextEncoder()
    const data = encoder.encode(hashSource)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    
    console.log('🔐 计算PSD哈希:', hashHex.substring(0, 16) + '...')
    return hashHex
  } catch (error) {
    console.error('❌ 计算PSD哈希失败:', error)
    return null
  }
}
