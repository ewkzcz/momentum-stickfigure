/**
 * 工具函数模块
 * 提供通用的辅助功能
 */

/**
 * 将描边值转换为实际像素值
 * 处理流程：1、将设置比例换算为当前字号对应的像素宽度。
 * @param {number} value - 描边值
 * @param {number} fontSize - 字体大小
 * @returns {number} 实际像素值
 */
export function convertStrokeValueToPixels(value, fontSize) {
  // 1、用字号缩放描边比例，使不同字号保持相近视觉粗细。
  const ratio = (value / 100) * 0.3
  return fontSize * ratio
}

/**
 * 常用字体列表（作为后备）
 */
const commonFonts = [
  'Arial',
  'Arial Black',
  'Comic Sans MS',
  'Courier New',
  'Georgia',
  'Impact',
  'Times New Roman',
  'Trebuchet MS',
  'Verdana',
  '微软雅黑',
  'Microsoft YaHei',
  '黑体',
  'SimHei',
  '宋体',
  'SimSun',
  '新宋体',
  'NSimSun',
  '仿宋',
  'FangSong',
  '楷体',
  'KaiTi',
  '华文细黑',
  'STXihei',
  '华文楷体',
  'STKaiti',
  '华文宋体',
  'STSong',
  '华文仿宋',
  'STFangsong',
  '方正舒体',
  'FZShuTi',
  '方正姚体',
  'FZYaoti'
]

/**
 * 检测字体是否可用
 * 处理流程：1、测量基准字体；2、测量候选字体；3、根据宽度差异判断可用性。
 * @param {string} fontName - 字体名称
 * @returns {boolean} 是否可用
 */
function isFontAvailable(fontName) {
  // 1、创建离屏画布并测量基准字体的混合字符宽度。
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  
  // 包含中英文，提升中文字体检测准确性。
  const baseFont = 'monospace'
  const testText = 'abcdefghijklmnopqrstuvwxyz0123456789中文测试字体'
  const fontSize = '72px'
  
  context.font = `${fontSize} ${baseFont}`
  const baseWidth = context.measureText(testText).width
  
  // 2、保留基准字体回退，测量候选字体对应的宽度。
  context.font = `${fontSize} "${fontName}", ${baseFont}`
  const testWidth = context.measureText(testText).width
  
  // 3、宽度发生变化时认为候选字体可用。
  return baseWidth !== testWidth
}

/**
 * 获取系统所有可用字体
 * 处理流程：1、尝试主进程字体接口；2、尝试浏览器字体接口；3、检测后备列表；4、异常时返回默认字体。
 * @returns {Promise<string[]>} 字体列表
 */
export async function getSystemFonts() {
  try {
    // 1、优先使用 Electron API，由主进程获取系统字体。
    if (window.electronAPI?.fonts?.getSystemFonts) {
      try {
        const result = await window.electronAPI.fonts.getSystemFonts()
        if (result.success && result.fonts && result.fonts.length > 0) {
          console.log(`通过 Electron API 获取到 ${result.fonts.length} 个系统字体`)
          return result.fonts
        }
      } catch (error) {
        console.warn('Electron 字体 API 调用失败:', error)
      }
    }
    
    // 2、主进程未返回字体时尝试浏览器 Font Access API。
    if ('queryLocalFonts' in window) {
      try {
        const availableFonts = await window.queryLocalFonts()
        const fontFamilies = [...new Set(availableFonts.map(font => font.family))]
        console.log(`通过 Font Access API 获取到 ${fontFamilies.length} 个字体`)
        return fontFamilies.sort()
      } catch (error) {
        console.warn('Font Access API 调用失败:', error)
      }
    }
    
    // 3、逐个检测常用字体，作为前两种接口不可用时的后备方案。
    console.log('使用字体检测方法获取可用字体...')
    const availableFonts = commonFonts.filter(font => isFontAvailable(font))
    console.log(`检测到 ${availableFonts.length} 个可用字体`)
    return availableFonts
  } catch (error) {
    // 4、检测失败时保留常用字体选项，避免页面无字体可选。
    console.error('获取系统字体失败:', error)
    return commonFonts // 返回常用字体列表作为后备
  }
}

/**
 * 系统字体列表（默认值，会被动态获取的字体替换）
 */
export let systemFonts = commonFonts
