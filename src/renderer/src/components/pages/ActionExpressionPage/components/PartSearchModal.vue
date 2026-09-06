<template>
  <Teleport to="body">
    <div
      v-if="showModal"
      class="part-search-panel"
      :style="{ 
        top: panelPosition.y + 'px', 
        left: panelPosition.x + 'px' 
      }"
      @mousedown="handlePanelMouseDown"
    >
    <div class="panel-header" @mousedown.stop="handleHeaderMouseDown">
      <span class="panel-title">搜索部件</span>
      <button class="panel-close" @click="handleClose" title="关闭（ESC键 / 点击外部）">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
    <div class="search-content">
      <!-- 搜索类型选择 -->
      <div class="search-type-selector">
        <n-radio-group v-model:value="searchType" name="searchType">
          <n-radio value="all">全部</n-radio>
          <n-radio value="action">动作</n-radio>
          <n-radio value="expression">表情</n-radio>
        </n-radio-group>
      </div>

      <!-- 搜索输入框 -->
      <div class="search-input-wrapper">
        <n-input
          ref="searchInputRef"
          v-model:value="searchKeyword"
          type="text"
          placeholder="请输入搜索关键词"
          clearable
          @keyup.enter="handleSearch"
        >
          <template #prefix>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="width: 18px; height: 18px;">
              <circle cx="11" cy="11" r="8"/>
              <path d="m21 21-4.35-4.35"/>
            </svg>
          </template>
        </n-input>
      </div>

      <!-- 搜索按钮 -->
      <div class="search-actions">
        <n-button type="primary" @click="handleSearch" :disabled="!searchKeyword">
          搜索
        </n-button>
      </div>

      <!-- 搜索结果列表 -->
      <div v-if="searchResults.length > 0" class="search-results-container">
        <div class="search-results-header">
          找到 {{ searchResults.length }} 个匹配项
        </div>
        <div class="search-results-tips">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="tip-icon">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4M12 8h.01"/>
          </svg>
          <span>单击：应用部件 | 双击：应用并关闭</span>
        </div>
        <div class="search-results-list">
          <div 
            v-for="(result, index) in searchResults" 
            :key="index"
            class="search-result-item"
            @click="handleResultClick(result)"
            @dblclick="handleResultDoubleClick(result)"
          >
            <div class="result-thumbnail">
              <img 
                v-if="result.part.thumbnail" 
                :src="result.part.thumbnail" 
                :alt="result.part.displayName || result.part.name"
              />
              <span v-else class="result-icon">🖼️</span>
            </div>
            <div class="result-info">
              <div class="result-category">{{ result.tabLabel }}</div>
              <div class="result-name">{{ result.part.displayName || result.part.name }}</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 无结果提示 -->
      <div v-else-if="hasSearched && searchResults.length === 0" class="search-no-results">
        <n-alert type="warning" title="未找到匹配项" />
      </div>
    </div>
    </div>
  </Teleport>
</template>

<script setup>
/** 部件搜索弹窗：按动作、表情和预设检索素材，保留来源信息并支持拖拽及单双击应用。 */
import { ref, watch, nextTick, onMounted, onUnmounted } from 'vue'
import { NInput, NButton, NRadioGroup, NRadio, NAlert } from 'naive-ui'

const props = defineProps({
  show: {
    type: Boolean,
    default: false
  },
  allParts: {
    type: Object,
    default: () => ({})
  },
  expressionTabs: {
    type: Array,
    default: () => []
  },
  expressionMeta: {
    type: Object,
    default: () => ({})
  },
  handParts: {
    type: Object,
    default: () => ({})
  },
  combinedExpressions: {
    type: Array,
    default: () => []
  },
  // 原始部件数组，用于准确判断 part 的来源
  originalHandParts: {
    type: Object,
    default: () => ({
      frontHandRight: [],
      backHand: [],
      frontLayerBackHand: [],
      frontHandBoth: [],
      bothHands: []
    })
  }
})

const emit = defineEmits(['update:show', 'search-result', 'search-result-confirm'])

const showModal = ref(false)
const searchType = ref('all') // 'all', 'action', 'expression'
const searchKeyword = ref('')
const searchInputRef = ref(null)
const searchResults = ref([])
const hasSearched = ref(false)

// 双击检测相关
let clickTimer = null
const clickDelay = 300 // 双击检测延迟（毫秒）

// 面板位置与拖拽
const panelPosition = ref({ x: 100, y: 100 })
const isDragging = ref(false)
const dragStart = ref({ x: 0, y: 0 })

/**
 * 根据预估面板尺寸计算居中位置。
 * 处理流程：
 * 1、读取窗口尺寸和面板预估尺寸。
 * 2、计算居中坐标，并为左右、底部边界保留间距。
 * 3、返回位置；窗口小于面板时仍保留最小边距，无法保证面板完整可见。
 */
const calculateSafePosition = () => {
  // 1、读取当前窗口尺寸。
  const windowWidth = window.innerWidth
  const windowHeight = window.innerHeight
  
  // 2、使用面板预估宽高计算位置。
  const panelWidth = 400
  const panelHeight = 600
  
  // 3、计算居中位置，并限制最小左侧和顶部间距。
  const margin = 20
  let x = Math.max(margin, (windowWidth - panelWidth) / 2)
  let y = Math.max(margin, (windowHeight - panelHeight) / 2)
  
  // 4、右侧空间不足时向左收回，但不小于最小边距。
  if (x + panelWidth > windowWidth - margin) {
    x = Math.max(margin, windowWidth - panelWidth - margin)
  }
  
  // 5、底部空间不足时向上收回，但不小于最小边距。
  if (y + panelHeight > windowHeight - margin) {
    y = Math.max(margin, windowHeight - panelHeight - margin)
  }
  
  // 6、返回调整后的位置。
  return { x, y }
}

/**
 * 为父组件提供重新定位面板的入口。
 * 处理流程：
 * 1、按当前窗口重新计算面板位置并记录结果。
 */
const resetPosition = () => {
  // 1、更新位置并输出重新定位日志。
  panelPosition.value = calculateSafePosition()
  console.log('🔍 手动重置对话框位置到安全区域:', panelPosition.value)
}

// 使用 defineExpose 暴露方法
defineExpose({
  resetPosition
})

// 监听外部show属性变化
watch(() => props.show, (newVal) => {
  showModal.value = newVal
  if (newVal) {
    // 每次打开时都重置到可见区域的安全位置
    panelPosition.value = calculateSafePosition()
    console.log('🔍 搜索对话框已重置到安全位置:', panelPosition.value)
    nextTick(() => {
      searchInputRef.value?.focus()
      
      // 🔧 如果有上次的搜索关键词，自动触发搜索
      if (searchKeyword.value && searchKeyword.value.trim()) {
        console.log('🔍 检测到上次搜索关键词，自动触发搜索:', searchKeyword.value)
        handleSearch()
      }
    })
  }
})

// 监听内部showModal变化，同步到外部
watch(showModal, (newVal) => {
  emit('update:show', newVal)
})

// 监听搜索关键词变化，如果清空则清空搜索结果
watch(searchKeyword, (newVal) => {
  if (!newVal || !newVal.trim()) {
    searchResults.value = []
    hasSearched.value = false
  }
})

/**
 * 关闭面板并清理本轮搜索展示状态。
 * 处理流程：
 * 1、取消尚未执行的单击操作。
 * 2、隐藏面板、清空结果和搜索标记，保留关键词以供下次打开重搜。
 */
const handleClose = () => {
  // 1、清除未完成的点击定时器。
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  
  // 2、关闭面板并清理结果，保留关键词供下次打开时重新搜索。
  showModal.value = false
  searchResults.value = []  // ✅ 清空搜索结果（节省内存，下次打开时会自动重新搜索）
  hasSearched.value = false  // ✅ 重置搜索状态
}

/**
 * 预留面板按下事件入口。
 * 处理流程：
 * 1、当前为空实现，不改变面板层级或状态。
 */
const handlePanelMouseDown = () => {
  // 1、保留事件入口，当前未实现层级调整。
}

/**
 * 记录面板拖拽的起点偏移。
 * 处理流程：
 * 1、启用拖拽并记录鼠标相对面板左上角的偏移。
 * 2、阻止鼠标按下的默认行为。
 */
const handleHeaderMouseDown = (e) => {
  // 1、记录拖拽标记及固定抓取偏移。
  isDragging.value = true
  dragStart.value = {
    x: e.clientX - panelPosition.value.x,
    y: e.clientY - panelPosition.value.y
  }
  // 2、阻止默认行为，避免拖拽时触发文本选择。
  e.preventDefault()
}

/**
 * 随鼠标移动更新正在拖拽的面板位置。
 * 处理流程：
 * 1、未处于拖拽状态时直接返回。
 * 2、按鼠标位置减去抓取偏移更新坐标，移动期间不限制窗口边界。
 */
const handleMouseMove = (e) => {
  // 1、仅处理已开始的拖拽。
  if (!isDragging.value) return
  // 2、维持鼠标在面板上的抓取位置。
  panelPosition.value = {
    x: e.clientX - dragStart.value.x,
    y: e.clientY - dragStart.value.y
  }
}

/**
 * 结束当前面板拖拽。
 * 处理流程：
 * 1、清除拖拽标记，停止后续移动更新。
 */
const handleMouseUp = () => {
  // 1、退出拖拽状态。
  isDragging.value = false
}

/**
 * 在窗口尺寸变化后重新定位已打开的面板。
 * 处理流程：
 * 1、面板显示时重新计算位置并记录，隐藏时保持原状态。
 */
const handleWindowResize = () => {
  // 1、仅对可见面板应用当前窗口下的重新定位结果。
  if (showModal.value) {
    panelPosition.value = calculateSafePosition()
    console.log('🔍 窗口大小改变，对话框已重新定位到安全位置:', panelPosition.value)
  }
}

/**
 * 在点击搜索面板外部时关闭面板。
 * 处理流程：
 * 1、忽略面板隐藏时的事件。
 * 2、检查目标是否位于搜索面板内，外部点击则执行关闭。
 */
const handleClickOutside = (e) => {
  // 1、只有在对话框显示时才处理。
  if (!showModal.value) return
  
  // 2、从点击目标向上查找搜索面板。
  const panel = e.target.closest('.part-search-panel')
  
  // 3、未找到面板祖先时关闭对话框。
  if (!panel) {
    console.log('🔍 检测到点击外部，关闭搜索对话框')
    handleClose()
  }
}

/**
 * 响应搜索面板的退出按键。
 * 处理流程：
 * 1、面板隐藏时忽略键盘事件。
 * 2、识别退出键后关闭面板，并阻止该事件的默认行为及继续传播。
 */
const handleKeyDown = (e) => {
  // 1、只有在对话框显示时才处理。
  if (!showModal.value) return
  
  // 2、兼容按键名称和旧键码，关闭后阻止事件继续传播。
  if (e.key === 'Escape' || e.keyCode === 27) {
    console.log('🔍 检测到 ESC 键，关闭搜索对话框')
    handleClose()
    e.preventDefault()
    e.stopPropagation()
  }
}

/**
 * 挂载搜索面板的全局交互监听。
 * 处理流程：
 * 1、监听鼠标移动、松开和窗口缩放，以便面板外也能继续拖拽或结束拖拽。
 * 2、在捕获阶段监听外部点击和退出按键。
 */
onMounted(() => {
  // 1、注册拖拽与窗口重新定位事件。
  document.addEventListener('mousemove', handleMouseMove)
  document.addEventListener('mouseup', handleMouseUp)
  window.addEventListener('resize', handleWindowResize)
  // 2、通过捕获阶段处理外部点击与退出按键。
  document.addEventListener('mousedown', handleClickOutside, true)
  // 添加键盘监听（ESC 键关闭）
  document.addEventListener('keydown', handleKeyDown, true)
})

/**
 * 卸载搜索面板的全局交互监听。
 * 处理流程：
 * 1、移除拖拽及窗口缩放监听。
 * 2、使用与注册时一致的捕获参数移除点击和键盘监听。
 */
onUnmounted(() => {
  // 1、移除鼠标与窗口事件。
  document.removeEventListener('mousemove', handleMouseMove)
  document.removeEventListener('mouseup', handleMouseUp)
  window.removeEventListener('resize', handleWindowResize)
  // 2、移除捕获阶段的外部点击与键盘监听。
  document.removeEventListener('mousedown', handleClickOutside, true)
  // 移除键盘监听
  document.removeEventListener('keydown', handleKeyDown, true)
})

/**
 * 搜索素材名称并保留应用部件所需的来源分类。
 * 处理流程：
 * 1、规范化关键词，并按搜索类型确定动作和表情范围。
 * 2、检索动作、手部和身体；对合并手部分组按原始引用或路径还原来源。
 * 3、检索组合及独立表情，附带表情类型和独立性标记。
 * 4、全部搜索时额外检索预设，最后更新结果及已搜索状态。
 */
const handleSearch = () => {
  // 1、忽略空关键词，再统一大小写并去除首尾空白。
  if (!searchKeyword.value) {
    return
  }

  const keyword = searchKeyword.value.toLowerCase().trim()
  const results = []

  // 2、根据选中的搜索类型确定范围。
  const searchInActions = searchType.value === 'all' || searchType.value === 'action'
  const searchInExpressions = searchType.value === 'all' || searchType.value === 'expression'

  // 3、收集动作、手部及身体素材，并标明应用时的目标分组。
  if (searchInActions) {
    // 3.1、先检索动作分组。
    const actionParts = props.allParts.action || []
    actionParts.forEach(part => {
      const name = (part.displayName || part.name || '').toLowerCase()
      if (name.includes(keyword)) {
        results.push({
          type: 'action',
          tabKey: 'action',
          tabLabel: '动作',
          part: {
            ...part,
            _sourceGroup: 'action'
          }
        })
      }
    })
    
    // 3.2、准备左手分组，右手与双手需要还原合并前的来源。
    // 注意：handParts 中的数据是经过合并的（比如 frontHandRight 包含了 backHand 和 frontLayerBackHand）
    // 需要分别处理每个原始数据源，并添加正确的 _sourceGroup
    const handGroups = [
      { key: 'frontHandNormal', label: '左手', parts: props.handParts.frontHandNormal || [], sourceGroup: 'frontHandNormal' }
    ]
    
    // 3.3、右手标签页包含前手右手、后手和前层后手，逐项识别真实来源。
    const frontHandRightParts = props.handParts.frontHandRight || []
    frontHandRightParts.forEach(part => {
      const name = (part.displayName || part.name || '').toLowerCase()
      if (name.includes(keyword)) {
        // 通过原始对象引用或路径匹配判断来源。
        let sourceGroup = 'frontHandRight' // 默认
        let displayPrefix = '前手'
        
        // 按优先级检查：先检查前层后手、后手，最后才是前手右手
        if (props.originalHandParts.frontLayerBackHand && 
            props.originalHandParts.frontLayerBackHand.some(p => p === part || p.path === part.path)) {
          sourceGroup = 'frontLayerBackHand'
          displayPrefix = '前层后手'
        } else if (props.originalHandParts.backHand && 
                   props.originalHandParts.backHand.some(p => p === part || p.path === part.path)) {
          sourceGroup = 'backHand'
          displayPrefix = '后手'
        } else if (props.originalHandParts.frontHandRight && 
                   props.originalHandParts.frontHandRight.some(p => p === part || p.path === part.path)) {
          sourceGroup = 'frontHandRight'
          displayPrefix = '前手'
        }
        
        results.push({
          type: 'action',
          tabKey: 'frontHandRight',
          tabLabel: '右手',
          part: {
            ...part,
            displayName: part.displayName || `${displayPrefix}-${part.name}`,
            _sourceGroup: sourceGroup
          }
        })
      }
    })
    
    // 3.4、双手标签页按双手、前手双手的优先级识别来源。
    const frontHandBothParts = props.handParts.frontHandBoth || []
    frontHandBothParts.forEach(part => {
      const name = (part.displayName || part.name || '').toLowerCase()
      if (name.includes(keyword)) {
        // 通过原始对象引用或路径匹配判断来源。
        let sourceGroup = 'frontHandBoth' // 默认
        let displayPrefix = '前手'
        
        // 按优先级检查：先检查双手，再检查前手双手
        if (props.originalHandParts.bothHands && 
            props.originalHandParts.bothHands.some(p => p === part || p.path === part.path)) {
          sourceGroup = 'bothHands'
          displayPrefix = '双手'
        } else if (props.originalHandParts.frontHandBoth && 
                   props.originalHandParts.frontHandBoth.some(p => p === part || p.path === part.path)) {
          sourceGroup = 'frontHandBoth'
          displayPrefix = '前手'
        }
        
        results.push({
          type: 'action',
          tabKey: 'frontHandBoth',
          tabLabel: '双手',
          part: {
            ...part,
            displayName: part.displayName || `${displayPrefix}-${part.name}`,
            _sourceGroup: sourceGroup
          }
        })
      }
    })
    
    // 3.5、左手素材直接使用所属分组作为来源。
    handGroups.forEach(group => {
      group.parts.forEach(part => {
        const name = (part.displayName || part.name || '').toLowerCase()
        if (name.includes(keyword)) {
          results.push({
            type: 'action',
            tabKey: group.key,
            tabLabel: group.label,
            part: {
              ...part,
              _sourceGroup: group.sourceGroup
            }
          })
        }
      })
    })
    
    // 3.6、分别收集上身和下身的名称匹配项。
    const bodyParts = [
      { key: 'upperBody', label: '上身', parts: props.allParts.upperBody || [], sourceGroup: 'upperBody' },
      { key: 'lowerBody', label: '下身', parts: props.allParts.lowerBody || [], sourceGroup: 'lowerBody' }
    ]
    bodyParts.forEach(group => {
      group.parts.forEach(part => {
        const name = (part.displayName || part.name || '').toLowerCase()
        if (name.includes(keyword)) {
          results.push({
            type: 'other',
            tabKey: group.key,
            tabLabel: group.label,
            part: {
              ...part,
              _sourceGroup: group.sourceGroup
            }
          })
        }
      })
    })
  }

  // 4、收集表情素材，并补充组合类型和独立表情标记。
  if (searchInExpressions) {
    // 4.1、组合表情统一标记为组合类型。
    (props.combinedExpressions || []).forEach(part => {
      const name = (part.displayName || part.name || '').toLowerCase()
      if (name.includes(keyword)) {
        results.push({
          type: 'expression',
          tabKey: 'combinedExpressions',
          tabLabel: '组合表情',
          part: {
            ...part,
            _sourceGroup: 'combinedExpressions',
            _exprType: 'combined',
            _isStandaloneExpression: false
          }
        })
      }
    })
    
    // 4.2、按标签页检索表情，优先采用表情元数据中的分类信息。
    props.expressionTabs.forEach(tab => {
      const expressionParts = props.allParts[tab.key] || []
      const tabMeta = props.expressionMeta?.[tab.key] || {}
      expressionParts.forEach(part => {
        const name = (part.displayName || part.name || '').toLowerCase()
        if (name.includes(keyword)) {
          results.push({
            type: 'expression',
            tabKey: tab.key,
            tabLabel: tab.label,
            part: {
              ...part,
              _sourceGroup: tab.key,
              _exprType: tabMeta.exprType ?? tab.exprType ?? null,
              _isStandaloneExpression: !!(tabMeta.isStandalone || tab.isStandaloneExpression)
            }
          })
        }
      })
    })
  }

  // 5、仅在全部搜索模式下追加匹配的预设。
  if (searchType.value === 'all') {
    const presets = props.allParts.presets || []
    presets.forEach(part => {
      const name = (part.displayName || part.name || '').toLowerCase()
      if (name.includes(keyword)) {
        results.push({
          type: 'preset',
          tabKey: 'presets',
          tabLabel: '预设',
          part: {
            ...part,
            _sourceGroup: 'presets'
          }
        })
      }
    })
  }

  // 6、一次性更新结果列表和搜索状态。
  searchResults.value = results
  hasSearched.value = true
}

/**
 * 延迟确认单击结果，留出识别双击的时间。
 * 处理流程：
 * 1、取消此前尚未执行的单击定时器。
 * 2、等待三百毫秒后发送应用事件并清空定时器，保持面板打开。
 */
const handleResultClick = (result) => {
  // 1、清除之前的定时器。
  if (clickTimer) {
    clearTimeout(clickTimer)
  }
  
  // 2、延迟应用部件，允许双击处理在执行前取消本次单击。
  clickTimer = setTimeout(() => {
    console.log('🖱️ 单击应用部件（不关闭对话框）:', result.part.displayName || result.part.name)
    // 发送确认事件（应用部件）
    emit('search-result-confirm', result)
    clickTimer = null
  }, clickDelay)
}

/**
 * 双击应用部件并关闭面板。
 * 处理流程：
 * 1、取消单击定时器，避免重复发送应用事件。
 * 2、立即发送确认事件，一百毫秒后关闭面板。
 */
const handleResultDoubleClick = (result) => {
  // 1、取消单击的延迟处理。
  if (clickTimer) {
    clearTimeout(clickTimer)
    clickTimer = null
  }
  
  console.log('🖱️ 双击应用部件（关闭对话框）:', result.part.displayName || result.part.name)
  // 2、发送确认事件以应用部件。
  emit('search-result-confirm', result)
  // 3、延迟关闭对话框，让确认事件先处理。
  setTimeout(() => {
    handleClose()
  }, 100)
}
</script>

<style scoped>
.part-search-panel {
  position: fixed;
  width: 380px;
  max-height: calc(100vh - 120px);
  background: var(--theme-background-card);
  border: 2px solid var(--theme-border);
  border-radius: 8px;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  opacity: 0.85;
  backdrop-filter: blur(10px);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: var(--theme-background-accent);
  border-bottom: 1px solid var(--theme-border);
  cursor: move;
  user-select: none;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--theme-foreground);
}

.panel-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--theme-text-secondary);
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.panel-close:hover {
  background: var(--theme-background-hover);
  color: var(--theme-primary);
}

.panel-close svg {
  width: 16px;
  height: 16px;
}

.search-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.search-type-selector {
  display: flex;
  justify-content: center;
}

.search-input-wrapper {
  width: 100%;
}

.search-actions {
  display: flex;
  justify-content: center;
}

.search-results-container {
  border-top: 1px solid var(--theme-border);
  padding-top: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.search-results-header {
  font-size: 13px;
  color: var(--theme-text-secondary);
  margin-bottom: 8px;
  font-weight: 500;
  flex-shrink: 0;
}

.search-results-tips {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  margin-bottom: 8px;
  background: var(--theme-background-accent);
  border: 1px solid var(--theme-border);
  border-radius: 6px;
  font-size: 12px;
  color: var(--theme-text-secondary);
  flex-shrink: 0;
}

.tip-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  color: var(--theme-primary);
}

.search-results-list {
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
}

.search-result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--theme-background-secondary);
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.search-result-item:hover {
  background: var(--theme-background-hover);
  transform: translateX(4px);
}

.result-thumbnail {
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--theme-background);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  overflow: hidden;
  flex-shrink: 0;
}

.result-thumbnail img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.result-icon {
  font-size: 22px;
}

.result-info {
  flex: 1;
  min-width: 0;
}

.result-category {
  font-size: 11px;
  color: var(--theme-text-muted);
  margin-bottom: 2px;
}

.result-name {
  font-size: 13px;
  color: var(--theme-foreground);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-no-results {
  margin-top: 12px;
  flex-shrink: 0;
}
</style>
