/**
 * 虚拟滚动 Composable
 * 
 * 职责：优化大列表的渲染性能
 * 
 * 功能：
 * - 只渲染可视区域的元素
 * - 支持动态高度
 * - 支持grid布局
 * - 自动计算可视区域
 */

import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'

/**
 * 创建虚拟滚动实例
 * 处理流程：
 * 1、建立容器、尺寸、滚动位置和项目数量状态
 * 2、提供列数、可见行范围和偏移计算
 * 3、返回监听初始化与定位方法供页面控制列表
 * @param {Object} options - 配置选项
 * @returns {Object} 虚拟滚动实例
 */
export function useVirtualScroll(options = {}) {
  // 1、读取布局参数并建立响应式列表状态
  const {
    itemSize: initialItemSize = 130,  // 单个项目的基础尺寸
    bufferSize = 3,        // 缓冲区大小（额外渲染的行数）
    gap = 2,               // 项目间距（与CSS保持一致）
    containerPadding = 2   // 容器内边距（极致紧凑）
  } = options

  // 滚动容器引用
  const scrollContainerRef = ref(null)
  
  // 滚动位置
  const scrollTop = ref(0)
  
  // 容器尺寸
  const containerWidth = ref(0)
  const containerHeight = ref(0)
  
  // 项目尺寸（响应式）
  const itemSize = ref(initialItemSize)
  
  // 每行可容纳的列数
  const columnsPerRow = ref(1)
  
  // 项目总数
  const totalItems = ref(0)
  
  // 是否正在滚动（用于节流）
  const isScrolling = ref(false)
  let scrollTimer = null
  
  // RAF 帧ID
  let rafId = null
  
  /**
   * 计算每行列数
   * 注意：需要精确匹配 CSS grid 的布局，确保按行渲染
   * 修复：虚拟滚动容器通过left/right定位，宽度与父容器内容区一致
   * 处理流程：
   * 1、扣除内边距与滚动条占用宽度
   * 2、按项目宽度和间距计算至少一列的布局
   */
  const calculateColumns = () => {
    // 1、容器尚未挂载时不计算可用宽度
    if (!scrollContainerRef.value) return
    
    // 虚拟滚动容器的实际宽度（通过left和right定位后的宽度）
    // 可用宽度 = 容器宽度 - 左右padding - 滚动条宽度(12px)
    const scrollbarWidth = 12
    const availableWidth = containerWidth.value - containerPadding * 2 - scrollbarWidth
    
    // 2、计算列数：使用与网格自动填充相同的宽度计算逻辑
    // auto-fill算法：floor((容器宽度 + gap) / (项目宽度 + gap))
    const itemWithGap = itemSize.value + gap
    const cols = Math.max(1, Math.floor((availableWidth + gap) / itemWithGap))
    
    columnsPerRow.value = cols
    
    console.log('📊 虚拟滚动列数计算:', {
      容器宽度: containerWidth.value,
      padding: containerPadding,
      滚动条宽度: scrollbarWidth,
      可用宽度: availableWidth,
      项目尺寸: itemSize.value,
      间距: gap,
      计算列数: cols
    })
  }
  
  /**
   * 更新容器尺寸（同时从CSS读取实际的gap值）
   * 处理流程：
   * 1、测量容器并读取实际行间距，重新计算列数
   * 2、列数改变且已滚动时调整滚动位置，尽量保留首个可见项
   */
  const updateContainerSize = () => {
    // 1、保留旧列数，以便重新布局后换算可见项位置
    if (!scrollContainerRef.value) return
    
    const rect = scrollContainerRef.value.getBoundingClientRect()
    const oldWidth = containerWidth.value
    const oldColumns = columnsPerRow.value
    
    containerWidth.value = rect.width
    containerHeight.value = rect.height
    
    // 从CSS computed style中读取实际的gap值（响应式gap）
    const computedStyle = window.getComputedStyle(scrollContainerRef.value)
    const actualGap = parseFloat(computedStyle.rowGap) || gap
    
    // 实际行间距仅用于下方滚动位置换算，列数仍使用传入的间距参数
    
    calculateColumns()
    
    // 2、如果列数发生变化，调整滚动位置以保持当前可见的第一项
    if (oldColumns > 0 && columnsPerRow.value !== oldColumns && scrollTop.value > 0) {
      const currentFirstVisibleItem = visibleStartRow.value * oldColumns
      const newScrollRow = Math.floor(currentFirstVisibleItem / columnsPerRow.value)
      const rowHeight = itemSize.value + actualGap
      
      // 使用nextTick确保DOM已更新
      nextTick(() => {
        if (scrollContainerRef.value) {
          scrollContainerRef.value.scrollTop = newScrollRow * rowHeight
          console.log('📐 列数变化，调整滚动位置:', {
            旧列数: oldColumns,
            新列数: columnsPerRow.value,
            实际gap: actualGap,
            旧滚动行: visibleStartRow.value,
            新滚动行: newScrollRow
          })
        }
      })
    }
  }
  
  // 2、由项目数量、容器尺寸与滚动位置推导可见范围和整体占位高度
  /**
   * 计算总行数
   */
  const totalRows = computed(() => {
    if (columnsPerRow.value === 0) return 0
    return Math.ceil(totalItems.value / columnsPerRow.value)
  })
  
  /**
   * 计算虚拟列表总高度
   * 修复：确保总高度计算准确，避免滚动到底部时卡住
   */
  const totalHeight = computed(() => {
    if (totalRows.value === 0) return 0
    const rowHeight = itemSize.value + gap
    // 总高度 = 行数 * (项目高度 + gap) - gap
    // 最后一行不需要额外的gap，避免底部多余空白导致滚动异常
    return totalRows.value * rowHeight - gap + containerPadding * 2
  })
  
  /**
   * 计算可见的开始行索引（始终是完整行）
   * 修复：添加边界保护，避免滚动到底部时循环
   */
  const visibleStartRow = computed(() => {
    if (columnsPerRow.value === 0 || totalRows.value === 0) return 0
    const rowHeight = itemSize.value + gap
    const start = Math.floor(scrollTop.value / rowHeight)
    // 确保开始行索引是有效的，且不超过总行数
    const startWithBuffer = Math.max(0, start - bufferSize)
    // 关键修复：计算最大可见的起始行，确保至少能显示一屏内容
    const visibleRows = Math.ceil(containerHeight.value / rowHeight)
    const maxStartRow = Math.max(0, totalRows.value - visibleRows - bufferSize)
    return Math.min(startWithBuffer, maxStartRow)
  })
  
  /**
   * 计算可见的结束行索引（始终是完整行）
   * 修复：添加边界保护，确保不会超出范围
   */
  const visibleEndRow = computed(() => {
    if (columnsPerRow.value === 0 || totalRows.value === 0) return 0
    const rowHeight = itemSize.value + gap
    const visibleRows = Math.ceil(containerHeight.value / rowHeight)
    const end = visibleStartRow.value + visibleRows + bufferSize
    // 确保结束行索引不超过总行数
    return Math.min(totalRows.value, end)
  })
  
  /**
   * 计算可见的开始项索引
   * 注意：始终返回完整行的起始索引
   */
  const visibleStartIndex = computed(() => {
    return visibleStartRow.value * columnsPerRow.value
  })
  
  /**
   * 计算可见的结束项索引
   * 关键修复：必须确保渲染完整行，避免半行导致space-evenly间距变化
   */
  const visibleEndIndex = computed(() => {
    if (columnsPerRow.value === 0) return 0
    
    // 计算结束行应该包含的所有项目（完整行）
    const endIndex = visibleEndRow.value * columnsPerRow.value
    
    // 关键：不能超过总项数，但要特别处理最后一行
    const actualEndIndex = Math.min(totalItems.value, endIndex)
    
    // 检查是否是最后一行的不完整行
    const isIncompleteLastRow = actualEndIndex < endIndex && actualEndIndex === totalItems.value
    
    if (isIncompleteLastRow) {
      // 如果最后一行不完整，我们仍然返回实际的结束索引
      // CSS的space-evenly会自动处理最后一行的布局
      // 关键是确保前面的行都是完整的
      return actualEndIndex
    }
    
    return actualEndIndex
  })
  
  /**
   * 可见项的数量
   */
  const visibleItemsCount = computed(() => {
    return visibleEndIndex.value - visibleStartIndex.value
  })
  
  /**
   * 偏移量（用于定位可见项）
   * 修复：添加边界检查，避免负值或超出范围的偏移
   */
  const offsetY = computed(() => {
    if (visibleStartRow.value === 0 || totalRows.value === 0) return 0
    const rowHeight = itemSize.value + gap
    const offset = visibleStartRow.value * rowHeight
    // 关键修复：确保偏移量不会超过总高度减去容器高度
    // 这样可以避免底部滚动时出现内容跳变
    const maxOffset = Math.max(0, totalHeight.value - containerHeight.value)
    return Math.min(offset, maxOffset)
  })
  
  /**
   * 获取可见项的索引范围
   * 注意：确保返回的是完整行的范围，避免位置跳变
   * 处理流程：
   * 1、读取计算后的起止索引并检查完整行约束
   * 2、记录调试数据，返回左闭右开的项目范围
   */
  const getVisibleRange = () => {
    // 1、末行允许不完整，其余渲染范围应按整行组织
    const start = visibleStartIndex.value
    const end = visibleEndIndex.value
    const itemCount = end - start
    
    // 验证是否按完整行渲染（除了最后一行）
    const isCompleteRows = itemCount % columnsPerRow.value === 0 || end === totalItems.value
    
    // 调试信息
    console.log('🔍 虚拟滚动渲染:', {
      起始行: visibleStartRow.value,
      结束行: visibleEndRow.value,
      每行列数: columnsPerRow.value,
      起始索引: start,
      结束索引: end,
      渲染项数: itemCount,
      是否完整行: isCompleteRows,
      总项数: totalItems.value,
      总行数: totalRows.value,
      滚动位置: Math.round(scrollTop.value)
    })
    
    // 警告：如果不是完整行（且不是最后一行），说明有bug
    if (!isCompleteRows) {
      console.warn('⚠️ 警告：虚拟滚动未按完整行渲染！这会导致space-evenly布局跳变')
    }
    
    // 2、范围可直接用于数组切片
    return { start, end }
  }
  
  /**
   * 获取项的位置信息
   * 处理流程：
   * 1、根据列数将索引转换为行列，再计算网格像素位置
   * @param {number} index - 项索引
   */
  const getItemPosition = (index) => {
    // 1、行列索引与画布偏移使用同一套项目尺寸和间距
    const row = Math.floor(index / columnsPerRow.value)
    const col = index % columnsPerRow.value
    const rowHeight = itemSize.value + gap
    
    return {
      row,
      col,
      top: row * rowHeight,
      left: col * (itemSize.value + gap)
    }
  }
  
  /**
   * 处理滚动事件（使用RAF优化）
   * 处理流程：
   * 1、取消未执行的帧任务，将位置更新合并到下一帧
   * 2、读取实际滚动位置，并延迟清除滚动中标记
   */
  const handleScroll = () => {
    // 1、同一帧内的多次滚动只保留最后一次读取
    if (!scrollContainerRef.value) return
    
    // 取消之前的RAF
    if (rafId) {
      cancelAnimationFrame(rafId)
    }
    
    // 2、在下一帧读取位置，并用停止定时器更新滚动状态
    rafId = requestAnimationFrame(() => {
      scrollTop.value = scrollContainerRef.value.scrollTop
      
      // 标记正在滚动
      isScrolling.value = true
      
      // 清除之前的定时器
      if (scrollTimer) {
        clearTimeout(scrollTimer)
      }
      
      // 滚动停止后延迟200ms标记为非滚动状态
      scrollTimer = setTimeout(() => {
        isScrolling.value = false
      }, 200)
    })
  }
  
  /**
   * 初始化
   * 处理流程：
   * 1、绑定容器并测量初始尺寸
   * 2、注册滚动、容器尺寸和项目尺寸变化监听
   * 3、返回事件、观察器、帧任务及定时器的清理函数
   */
  const init = (container) => {
    // 1、绑定页面实际的滚动容器
    if (!container) return
    
    scrollContainerRef.value = container
    
    // 初始化容器尺寸
    updateContainerSize()
    
    // 2、监听滚动和尺寸变化，使可见范围随布局更新
    container.addEventListener('scroll', handleScroll, { passive: true })
    
    // 添加resize监听
    const resizeObserver = new ResizeObserver(() => {
      updateContainerSize()
    })
    resizeObserver.observe(container)
    
    // 监听itemSize变化，重新计算列数
    watch(itemSize, (newSize, oldSize) => {
      if (newSize !== oldSize) {
        console.log('📏 项目尺寸变化:', { 旧: oldSize, 新: newSize })
        // 重新计算列数和滚动位置
        updateContainerSize()
      }
    })
    
    // 3、由调用方在页面卸载时释放容器相关资源
    return () => {
      container.removeEventListener('scroll', handleScroll)
      resizeObserver.disconnect()
      if (rafId) {
        cancelAnimationFrame(rafId)
      }
      if (scrollTimer) {
        clearTimeout(scrollTimer)
      }
    }
  }
  
  /**
   * 滚动到指定位置
   * 处理流程：
   * 1、将项目索引转换为行顶部位置，并按指定行为滚动
   */
  const scrollToIndex = (index, behavior = 'smooth') => {
    // 1、容器存在时使用当前列数和尺寸定位目标行
    if (!scrollContainerRef.value) return
    
    const position = getItemPosition(index)
    scrollContainerRef.value.scrollTo({
      top: position.top,
      behavior
    })
  }
  
  /**
   * 滚动到顶部
   * 处理流程：
   * 1、将已挂载容器滚动到零位置
   */
  const scrollToTop = (behavior = 'smooth') => {
    // 1、复用浏览器滚动行为选项完成顶部定位
    if (!scrollContainerRef.value) return
    
    scrollContainerRef.value.scrollTo({
      top: 0,
      behavior
    })
  }
  
  // 3、导出布局状态、可见范围与容器控制方法
  return {
    // 引用
    scrollContainerRef,
    
    // 状态
    scrollTop,
    isScrolling,
    containerWidth,
    containerHeight,
    columnsPerRow,
    totalItems,
    itemSize, // 暴露itemSize供外部修改
    
    // 计算属性
    totalHeight,
    totalRows,
    visibleStartIndex,
    visibleEndIndex,
    visibleItemsCount,
    visibleStartRow,
    visibleEndRow,
    offsetY,
    
    // 方法
    init,
    updateContainerSize,
    calculateColumns, // 暴露列数计算方法
    getVisibleRange,
    getItemPosition,
    scrollToIndex,
    scrollToTop
  }
}
