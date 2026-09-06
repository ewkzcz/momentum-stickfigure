/**
 * useTabsScroll.js
 * 标签滚动逻辑
 * 
 * 功能：
 * - 管理部件标签和PSD标签的横向滚动
 * - 鼠标滚轮转换为水平滚动
 */

import { ref } from 'vue'

/**
 * 管理部件和 PSD 标签的横向滚动。
 * 处理流程：
 * 1、创建各标签行的容器引用。
 * 2、定义将滚轮纵向位移映射为横向位移的处理函数。
 * 3、返回容器引用和滚轮事件入口。
 */
export function useTabsScroll() {
  // 1、创建可供各标签行绑定的容器引用。
  
  /**
   * 部件标签容器的引用（已废弃，保留以兼容旧代码）
   * @type {import('vue').Ref<HTMLElement|null>}
   */
  const partsTabsRef = ref(null)

  /**
   * 部件标签第1行容器的引用
   * @type {import('vue').Ref<HTMLElement|null>}
   */
  const partsTabsRow1Ref = ref(null)

  /**
   * 部件标签第2行容器的引用
   * @type {import('vue').Ref<HTMLElement|null>}
   */
  const partsTabsRow2Ref = ref(null)

  /**
   * PSD标签容器的引用
   * @type {import('vue').Ref<HTMLElement|null>}
   */
  const psdTabsRef = ref(null)

  // 2、定义两类标签容器的滚轮转换。

  /**
   * 处理部件标签页区域的鼠标滚轮事件，实现水平滚动
   * 处理流程：
   * 1、阻止默认滚动并取得当前事件容器。
   * 2、将纵向滚轮位移加速后写入横向滚动位置。
   * @param {WheelEvent} event - 鼠标滚轮事件
   */
  const handleTabsWheel = (event) => {
    // 1、取得触发事件的标签行，以支持每行独立滚动。
    event.preventDefault()
    
    // 使用 event.currentTarget 以支持多个标签行的独立滚动
    const container = event.currentTarget
    if (!container) return
    
    // 2、将垂直滚动转换为水平滚动。
    const scrollAmount = event.deltaY * 2 // 增加滚动速度
    container.scrollLeft += scrollAmount
  }

  /**
   * 处理PSD标签页区域的鼠标滚轮事件，实现水平滚动
   * 处理流程：
   * 1、阻止默认滚动并取得 PSD 标签容器。
   * 2、将纵向位移加速后更新横向滚动位置。
   * @param {WheelEvent} event - 鼠标滚轮事件
   */
  const handlePsdTabsWheel = (event) => {
    // 1、检查 PSD 标签容器是否挂载。
    event.preventDefault()
    
    const container = psdTabsRef.value
    if (!container) return
    
    // 2、将垂直滚动转换为水平滚动。
    const scrollAmount = event.deltaY * 2 // 增加滚动速度
    container.scrollLeft += scrollAmount
  }

  // 3、导出标签引用与事件处理函数。

  return {
    // 状态
    partsTabsRef, // 保留以兼容旧代码
    partsTabsRow1Ref,
    partsTabsRow2Ref,
    psdTabsRef,

    // 方法
    handleTabsWheel,
    handlePsdTabsWheel
  }
}
