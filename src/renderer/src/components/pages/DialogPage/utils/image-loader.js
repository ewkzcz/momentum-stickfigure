/**
 * 图像加载模块
 * 负责从assets文件夹加载所有对话框图片
 */

/**
 * 对话框类别配置
 */
const DIALOG_CATEGORIES = [
  { id: 'dialog', name: '普通对话框', folder: '普通对话框', count: 8 },
  { id: 'curve', name: '弧线对话框', folder: '弧线对话框', count: 9 },
  { id: 'bubble', name: '气泡对话框', folder: '气泡对话框', count: 3 }
]

/**
 * 构建某个类别的所有对话框模板元数据（不立即加载图片）
 * 处理流程：1、按类别数量构造资源地址；2、汇总供懒加载使用的模板元数据。
 * @param {object} category - 类别配置
 * @returns {Array} 模板元数据数组
 */
function buildCategoryTemplates(category) {
  // 1、按类别序号构造模板资源地址和展示信息。
  const items = []
  
  for (let i = 1; i <= category.count; i++) {
    // 使用 import.meta.url 保持构建后相对资源地址可解析。
    const imagePath = new URL(
      `../../../../assets/images/dialog-templates/${category.folder}/diaglog_${i}.png`,
      import.meta.url
    ).href
    
    items.push({
      id: `${category.id}_${i}`,
      categoryId: category.id,
      categoryName: category.name,
      name: `${category.name} ${i}`,
      image: null,      // 图片在需要时再懒加载
      imageSource: imagePath,
      index: i
    })
  }
  
  // 2、返回元数据，图片留待实际使用时加载。
  return items
}

/**
 * 加载所有对话框模板元数据
 * 处理流程：1、合并各类别模板；2、记录加载数量并返回结果。
 * @returns {Promise<Array>} 模板元数据数组
 */
export async function loadAllDialogImages() {
  // 1、按配置顺序合并各类别的模板元数据。
  const allImages = []
  
  for (const category of DIALOG_CATEGORIES) {
    const categoryTemplates = buildCategoryTemplates(category)
    allImages.push(...categoryTemplates)
  }
  
  // 2、记录模板总量并交给调用方展示。
  console.log(`成功加载 ${allImages.length} 个对话框模板元数据`)
  return allImages
}

/**
 * 获取类别列表
 * 处理流程：1、返回页面共用的类别配置。
 * @returns {Array} 类别配置数组
 */
export function getCategories() {
  // 1、复用预定义类别，保持筛选项与模板数据一致。
  return DIALOG_CATEGORIES
}
