<template>
  <div class="action-expression-panel" @selectstart="handleSelectStart">
    <!-- PSD文件标签列表 -->
    <PsdTabsBar
      :psd-files="psdFiles"
      :current-psd-file="currentPsdFile"
      @select="switchPsdFile"
      @remove="removePsdFile"
    />

    <!-- 顶部工具栏 -->
    <ActionExpressionToolbar
      :canvas-panel-expanded="canvasPanelExpanded"
      v-model:enable-canvas-hover="enableCanvasHover"
      v-model:enable-preset-hover="enablePresetHover"
      :hotkey-labels="hotkeyLabels"
      :jump-options="jumpOptions"
      :more-options="moreOptions"
      :current-psd-data="currentPsdData"
      :is-sending-to-generate="isSendingToGenerate"
      @toggle-canvas="toggleCanvasPanel"
      @select-psd="handleSelectPsdFiles"
      @open-preview="openCanvasPreview"
      @jump-select="handleJumpSelect"
      @more-select="handleMoreSelect"
    />

    <!-- 主内容区域 -->
    <div class="content-wrapper" ref="contentWrapperRef">
      <!-- 画布区域（可折叠） -->
      <div class="canvas-panel">
        <transition name="panel-collapse">
          <div
            v-show="canvasPanelExpanded"
            class="canvas-area"
            ref="canvasAreaRef"
            :style="canvasAreaStyle"
            :class="{ 'scale-mode': scrollMode === 'scale', 'drag-over': isDragOver }"
            @scroll="handleCanvasAreaScroll"
            @dragover.prevent="handleDragOver"
            @dragleave="handleDragLeave"
            @drop.prevent="handleDrop"
          >
            <div class="canvas-main-column">
              <div class="canvas-container" :class="{ 'rendering-template': isRenderingTemplate }">
                <canvas
                  ref="canvasRef"
                  :width="canvasWidth"
                  :height="canvasHeight"
                  :style="{ ...canvasStyle, opacity: canvasOpacity, transition: 'opacity 0.3s ease-in-out' }"
                  class="render-canvas"
                  :draggable="false"
                  @mousedown="handleCanvasMouseDown"
                  @wheel.stop.prevent="handleCanvasWheel"
                  @mouseenter="handleCanvasHoverEnter"
                  @mousemove="handleCanvasHoverMove"
                  @mouseleave="handleCanvasHoverLeave"
                ></canvas>

                <!-- 模板渲染Loading提示 -->
                <transition name="fade">
                  <div v-if="isRenderingTemplate" class="template-rendering-overlay">
                    <div class="spinner-circle"></div>
                  </div>
                </transition>

                <!-- 画布帮助提示图标 -->
                <n-tooltip placement="bottom-start" trigger="hover">
                  <template #trigger>
                    <div class="canvas-help-icon">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 7v6M12 17h.01" stroke="black" stroke-width="2" stroke-linecap="round" />
                      </svg>
                    </div>
                  </template>
                  <div class="canvas-tooltip-content">
                    <div class="tooltip-item">
                      🔍 <strong>缩放功能：</strong>在画布上滚动鼠标滚轮可缩放图像（{{ (canvasScale * 100).toFixed(0) }}%）
                    </div>
                    <div class="tooltip-item">
                      🎬 <strong>拖拽功能：</strong>图片支持直接拖拽到桌面/剪映/PS中使用
                    </div>
                    <div class="tooltip-item">
                      🖼️ <strong>部件拖拽：</strong>部件选择区域的小图也可拖拽导出（自动命名）
                    </div>
                    <div class="tooltip-item warning">
                      ⚠️ <strong>注意：</strong>请勿随意删除/移动图片，以免导致剪映图片失去链接
                    </div>
                  </div>
                </n-tooltip>
              </div>
            </div>
          </div>
        </transition>
      </div>

      <!-- 拖拽跟随及三类悬浮预览（传送到body，避免父级transform影响） -->
      <HoverPreviewOverlays
        :is-dragging="isDragging"
        :drag-mouse-x="dragMouseX"
        :drag-mouse-y="dragMouseY"
        :drag-calibration="dragCalibration"
        :hover-preview="hoverPreview"
        :preset-hover-preview="presetHoverPreview"
        :template-hover-preview="templateHoverPreview"
        @preview-ref="node => dragFollowPreview = node"
        @canvas-ref="node => dragFollowCanvas = node"
      />

      <!-- 通用控制和图层结构整合面板 -->
      <IntegratedControlsPanel
        :common-controls="commonControlValues"
        :integrated-panel-tab="integratedPanelTab"
        :integrated-panel-collapsed="integratedPanelCollapsed"
        v-model:part-item-size-input="partItemSizeInput"
        @update-common-control="updateCommonControlModel"
        @header-click="handleHeaderClick"
        @switch-tab="switchIntegratedPanelTab"
        @toggle="toggleIntegratedPanel"
        @save-preset="handleSavePreset"
        @save-template1="handleSaveTemplate1"
        @save-template2="handleSaveTemplate2"
        @search="openSearchModal"
        @size-confirm="handleSizeInputConfirm"
        @common-control-change="handleCommonControlChange"
        @select-head-only-change="handleSelectHeadOnlyChange"
        @select-non-head-change="handleSelectNonHeadChange"
        @reset="resetCommonControls"
      >
        <template #layer-tree>
            <!-- 图层结构内容 -->
            <div v-show="integratedPanelTab === 'layerTree'" class="layer-tree-content">
              <LayerTreePanel
                v-if="currentPsdData"
                :layer-data="layerTreeData"
                :selected-layers="selectedLayersMap"
                @update:visibility="handleLayerVisibilityChange"
                @batch-toggle-visibility="handleBatchToggleVisibility"
                @restore-initial-state="handleRestoreInitialState"
              />
              <div v-else class="empty-state">
                <p>请先上传PSD文件</p>
              </div>
            </div>
        </template>
      </IntegratedControlsPanel>

      <!-- 可拖拽的分隔条（仅在画布展开时显示） -->
      <div
        v-show="canvasPanelExpanded"
        class="resize-divider"
        @mousedown="handleDividerMouseDown"
        title="拖拽调整画布高度"
      >
        <div class="resize-divider-handle">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="8" x2="21" y2="8" />
            <line x1="3" y1="16" x2="21" y2="16" />
          </svg>
        </div>
      </div>

      <!-- 控制区域容器（可滚动） -->
      <div class="controls-scrollable-area">
        <!-- 部件选择区域 -->
        <div class="parts-section">
          <!-- 切换按钮 - 拆分为2行 -->
          <PartsTabsBar
            :row1-tabs="categorizedTabs.row1Tabs"
            :row2-tabs="categorizedTabs.row2Tabs"
            :current-tab="currentTab"
            :has-rendered-content="hasRenderedContent"
            :drag-over-tab-key="dragOverTabKey"
            :drop-position="dropPosition"
            @row1-ref="node => partsTabsRow1Ref = node"
            @row2-ref="node => partsTabsRow2Ref = node"
            @wheel="handleTabsWheel"
            @container-dragover="handleContainerDragOver"
            @container-drop="handleContainerDrop"
            @tab-click="handleTabClick"
            @tab-dragstart="handleTabDragStart"
            @tab-dragend="handleTabDragEnd"
            @tab-dragover="handleTabDragOver"
            @tab-dragleave="handleTabDragLeave"
            @tab-drop="handleTabDrop"
            @reset="resetTabConfig"
          />

          <!-- 部件列表（含预设） - 使用虚拟滚动优化 -->
          <div
            :class="[
              'parts-list',
              { 'template-grid-mode': isTemplateGridMode }
            ]"
            ref="partsListRef"
            :style="{ '--part-item-size': partItemSize + 'px' }"
            @dragover="handleTemplateListDragOver"
            @drop="handleTemplateListDrop"
            @dragleave="handleTemplateListDragLeave"
          >
            <!-- 预设卡片展示（预设不使用虚拟滚动，因为数量较少） -->
            <PresetListPanel
              v-if="currentTab === 'presets'"
              :presets="presets"
              :selected-preset-id="selectedPresetId"
              :editing-preset-id="editingPresetId"
              :is-preset-multi-selected="isPresetMultiSelected"
              :get-preset-full-description="getPresetFullDescription"
              :get-preset-display-name="getPresetDisplayName"
              @card-click="handlePresetCardClick"
              @context-menu="handlePresetContextMenu"
              @deselect="deselectAllPresets"
              @hover-enter="handlePresetHoverEnter"
              @hover-move="handlePresetHoverMove"
              @hover-leave="handlePresetHoverLeave"
              @precache="precacheImageData"
              @drag-start="handlePartDragStart"
              @drag-end="handlePartDragEnd"
              @image-click="handlePresetImageClick"
              @name-blur="handlePresetNameBlur"
              @rename="startEditPresetName"
            />

            <!-- 模板卡片展示（模板不使用虚拟滚动，因为数量较少） -->
            <TemplateListPanel
              v-else-if="currentTab === 'template1' || currentTab === 'template2'"
              :templates="currentTab === 'template1' ? templates1 : templates2"
              :template-type="currentTab"
              :selected-id="currentTab === 'template1' ? selectedTemplate1Id : selectedTemplate2Id"
              :empty-text="currentTab === 'template1' ? '暂无动作模板，点击&quot;动作模板&quot;按钮创建' : '暂无表情模板，点击&quot;表情模板&quot;按钮创建'"
              :is-multi-selected="isTemplateMultiSelected"
              :is-dragging="isTemplateDragging"
              :is-drag-over="isTemplateDragOver"
              @card-click="handleTemplateCardClick"
              @context-menu="handleTemplateContextMenu"
              @drag-over="handleTemplateDragOver"
              @drag-enter="handleTemplateDragEnter"
              @drag-leave="handleTemplateDragLeave"
              @drop="handleTemplateDrop"
              @drag-start="handleTemplateDragStart"
              @drag-end="handleTemplateDragEnd"
              @hover-enter="handleTemplateHoverEnter"
              @hover-move="handleTemplateHoverMove"
              @hover-leave="handleTemplateHoverLeave"
              @rename="startEditTemplateNameById"
            />

            <!-- 普通部件列表（使用虚拟滚动） -->
            <PartsVirtualList
              v-else
              :empty="currentPartsList.length === 0"
              :empty-state-text="emptyStateText"
              :visible-parts-list="visiblePartsList"
              :total-height="virtualScroll.totalHeight.value"
              :offset-y="virtualScroll.offsetY.value"
              :highlighted-part-path="highlightedPartPath"
              :is-part-active="isPartActive"
              @select="selectPart"
              @precache="precacheImageData"
              @drag-start="handlePartDragStart"
              @drag-end="handlePartDragEnd"
              @image-click="part => handlePartImageClick(part, selectPart)"
            />
          </div>
        </div>
      </div>
      <!-- 控制区域容器结束 -->
    </div>

    <!-- 搜索对话框 -->
    <PartSearchModal
      ref="searchModalRef"
      v-model:show="showSearchModal"
      :all-parts="allPartsForSearch"
      :expression-tabs="enhancedExpressionTabs"
      :expression-meta="expressionTabMetaMap"
      :hand-parts="handPartsForSearch"
      :original-hand-parts="originalHandPartsForSearch"
      :combined-expressions="combinedExpressionParts"
      @search-result-confirm="handleSearchResultConfirm"
    />

    <TemplateContextMenu
      :context-menu-visible="contextMenuVisible"
      :context-menu-position="contextMenuPosition"
      :context-menu-item-type="contextMenuItemType"
      :context-menu-template-detail="contextMenuTemplateDetail"
      :template-detail-entries="templateDetailEntries"
      :template-detail-type-label="templateDetailTypeLabel"
      :context-menu-single-item-id="contextMenuSingleItemId"
      @delete-presets="handleBatchDeletePresets"
      @close="closeContextMenu"
      @apply="handleTemplateDetailApply"
      @rename="handleContextMenuRename"
      @delete-templates="handleBatchDeleteTemplates"
      @page-click="handlePageClick"
    />

  </div>
</template>

<script setup>
/**
 * 人物动作与表情编辑页面：协调 PSD 图层、部件选择、预设模板、画布预览及拖拽导出。
 */
import { ref, reactive, computed, onMounted, onUnmounted, nextTick, watch, shallowRef } from 'vue'
import { useRouter } from 'vue-router'
import { NTooltip, useMessage, useDialog } from 'naive-ui'
import ActionExpressionToolbar from './components/ActionExpressionToolbar.vue'
import PartsTabsBar from './components/PartsTabsBar.vue'
import HoverPreviewOverlays from './components/HoverPreviewOverlays.vue'
import PsdTabsBar from './components/PsdTabsBar.vue'
import IntegratedControlsPanel from './components/IntegratedControlsPanel.vue'
import LayerTreePanel from './components/LayerTreePanel.vue'
import PartSearchModal from './components/PartSearchModal.vue'
import TemplateListPanel from './components/TemplateListPanel.vue'
import PresetListPanel from './components/PresetListPanel.vue'
import PartsVirtualList from './components/PartsVirtualList.vue'
import { useHotkeyLabels } from './composables/useHotkeyLabels.js'
import { useIntegratedPanelState } from './composables/useIntegratedPanelState.js'
import TemplateContextMenu from './components/TemplateContextMenu.vue'
import {
  normalizeString,
  generateId,
  generatePresetName
} from './utils/stringUtils.js'
import {
  FOLLOW_OFFSET_X,
  FOLLOW_OFFSET_Y,
  OUTSIDE_COUNT_THRESHOLD,
  OUTSIDE_DURATION_MS,
  OUTSIDE_SAFE_MARGIN,
  MIN_DRAG_TIME_MS
} from './constants/dragConstants.js'
import {
  getFrontHandSpecialNames,
  getCustomGroupNames,
  classifyFrontHandParts
} from './utils/psdClassifyUtils.js'
import {
  getCanvasBase64,
  regionHasVisiblePixel,
  trimWhitespace,
  trimWhitespaceHorizontal,
  drawDragPreview
} from './utils/canvasUtils.js'
import {
  calculatePsdHash
} from './utils/hashUtils.js'
import {
  isPartSelected,
  isChildOfSelectedGroupItem,
  shouldLayerBeRendered,
  findClippingGroup,
  renderClippingGroup,
  applyLayerMask,
  renderLayerToContext,
  drawLayerImage
} from './utils/layerRenderUtils.js'
import {
  useWindowControl
} from './composables/useWindowControl.js'
import {
  usePartsState
} from './composables/usePartsState.js'
import {
  classifyParts
} from './composables/usePartsClassify.js'
import {
  useCanvasScale
} from './composables/useCanvasScale.js'
import {
  useCanvasDivider
} from './composables/useCanvasDivider.js'
import {
  usePsdHistory
} from './composables/usePsdHistory.js'
import {
  usePresetData
} from './composables/usePresetData.js'
import {
  usePresetUI
} from './composables/usePresetUI.js'
import {
  useTemplateData
} from './composables/useTemplateData.js'
import {
  useTemplateUI
} from './composables/useTemplateUI.js'
import { useTemplatePresetList } from './composables/useTemplatePresetList.js'
import { useTemplateRenderCoordinator } from './composables/useTemplateRenderCoordinator.js'
import { useDragState } from './composables/useDragState.js'
import { useDragHandlers } from './composables/useDragHandlers.js'
import { useActionPageLifecycle } from './composables/useActionPageLifecycle.js'
import { useDragFinishedSubscription } from './composables/useDragFinishedSubscription.js'
import { usePartImageDrag } from './composables/usePartImageDrag.js'
import {
  useLayerTree
} from './composables/useLayerTree.js'
import { usePsdParser } from './composables/usePsdParser.js'
import { usePsdUpload } from './composables/usePsdUpload.js'
import { useTabsScroll } from './composables/useTabsScroll.js'
import { useCommonControls } from './composables/useCommonControls.js'
import { useCommonControlLayerSync, createRenderTriggerLogger } from './composables/useCommonControlLayerSync.js'
import { usePreviewSyncSubscriptions } from './composables/usePreviewSyncSubscriptions.js'
import { usePsdSession } from './composables/usePsdSession.js'
import { useCanvasState } from './composables/useCanvasState.js'
import { useKeyboard } from './composables/useKeyboard.js'
import { useMoreMenu } from './composables/useMoreMenu.js'
import { useCanvasRender } from './composables/useCanvasRender.js'
import { usePartTabLayout } from './composables/usePartTabLayout.js'
import { usePartSearch } from './composables/usePartSearch.js'
import { usePartBrowsing } from './composables/usePartBrowsing.js'
import { usePartSelectionCoordinator } from './composables/usePartSelectionCoordinator.js'
import { useExpressionAnalysis } from './composables/useExpressionAnalysis.js'
import { useVirtualScroll } from './composables/useVirtualScroll.js'
import { useCanvasOutputCoordinator, createCanvasJumpOptions } from './composables/useCanvasOutputCoordinator.js'
import { buildCanvasOutputFileName } from './utils/canvasOutputName.js'
import { useCanvasPresetHoverPreview } from './composables/useCanvasPresetHoverPreview.js'
import { useTemplateHoverPreview } from './composables/useTemplateHoverPreview.js'
import { useHoverPreviewSetting } from '../../../composables/useHoverPreviewSetting.js'
import { createPerformanceLogger } from '@renderer/utils/performanceLogger.js'

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const perfLogger = createPerformanceLogger('action-expression')

// ==================== 窗口控制 ====================
const {
  isAlwaysOnTop,
  windowMode,
  windowBounds,
  toggleAlwaysOnTop,
  toggleWindowMode,
  getAlwaysOnTopState,
  updateWindowBounds
} = useWindowControl()

// ==================== 标签滚动 ====================
const {
  partsTabsRef,
  partsTabsRow1Ref,
  partsTabsRow2Ref,
  handleTabsWheel
} = useTabsScroll()

// ==================== 状态管理 ====================
// Canvas基础状态
const {
  canvasRef,
  canvasAreaRef,
  contentWrapperRef,
  canvasWidth,
  canvasHeight,
  psdAspectRatio,
  canvasStyle,
  windowHeight,
  canvasHeightRatio,
  canvasAreaStyle
} = useCanvasState()

// 悬浮预览开关控制（使用 composable 实现同步和持久化）
// 主画布悬浮预览（仅画布）
const { hoverPreviewEnabled: enableCanvasHover, toggleHoverPreview: toggleCanvasHoverPreview } = useHoverPreviewSetting({
  type: 'canvas',
  source: 'ActionExpressionPage'
})
// 预设 & 模板悬浮预览
const { hoverPreviewEnabled: enablePresetHover, toggleHoverPreview: togglePresetHoverPreview } = useHoverPreviewSetting({
  type: 'part',
  source: 'ActionExpressionPage'
})

// 1、两种开关就绪后传入原始引用，模板状态与关闭监听仍保留在页面。
const {
  hoverPreview,
  presetHoverPreview,
  buildCanvasDataUrl,
  handleCanvasHoverEnter,
  handleCanvasHoverMove,
  handleCanvasHoverLeave,
  handlePresetHoverEnter,
  handlePresetHoverMove,
  handlePresetHoverLeave
} = useCanvasPresetHoverPreview({ canvasRef, enableCanvasHover, enablePresetHover })

// ==================== 快捷键信息（用于展示） ====================
const { hotkeyLabels, handleHotkeyLabelUpdate, toggleHoverHotkeyDisplay } = useHotkeyLabels()
const isTemplateGridMode = computed(() => currentTab.value === 'template1' || currentTab.value === 'template2')

// ==================== 键盘快捷键 ====================
useKeyboard({
  onSearch: async () => {
    openSearchModal()
  },
  onToggleCanvasHover: async () => {
    // 切换主画布悬浮预览开关（使用 composable 的切换方法，会自动保存到 localStorage）
    toggleCanvasHoverPreview({ broadcast: true, source: 'ActionExpressionPage-keyboard' })
    const status = enableCanvasHover.value ? '已开启' : '已关闭'
    message.info(`悬浮预览（主画布）${status}`)
    console.log(`🎨 悬浮预览（主画布）${status} (快捷键: ${toggleHoverHotkeyDisplay.value})`)
  },
  onTogglePartHover: async () => {
    togglePresetHoverPreview({ broadcast: true, source: 'ActionExpressionPage-keyboard' })
    const status = enablePresetHover.value ? '已开启' : '已关闭'
    message.info(`悬浮预览（预设/模板）${status}`)
    console.log(`🎨 悬浮预览（预设/模板）${status} (快捷键: ${hotkeyLabels.togglePartHover || '未设置'})`)
  }
  // 预留：可在此添加快捷键回调函数
  // onSave: async () => { /* 保存功能 */ },
  // onExport: async () => { /* 导出功能 */ },
  // onUndo: async () => { /* 撤销功能 */ },
  // onRedo: async () => { /* 重做功能 */ }
})

onMounted(() => {
  window.addEventListener('hotkeys-config-updated', handleHotkeyLabelUpdate)
})

onUnmounted(() => {
  window.removeEventListener('hotkeys-config-updated', handleHotkeyLabelUpdate)
})

// 提取拖拽状态为 composable
const dragState = useDragState()
const {
  isDragging,
  dragFollowPreview,
  dragFollowCanvas,
  dragMouseX,
  dragMouseY,
  dragCalibration,
  hasTriggeredSystemDrag,
  isNearBoundary
} = dragState
// ==================== 禁用页面文字选中（可编辑区域除外） ====================
/**
 * 限制编辑区域之外的文字选择，避免干扰拖拽。
 * 处理流程：
 * 1、识别富文本和表单输入区域并放行
 * 2、阻止其他区域及异常情况下的默认文字选择
 */
const handleSelectStart = (e) => {
  // 1、检查事件目标是否允许编辑
  try {
    const target = e.target
    if (!target) return e.preventDefault()
    const tag = (target.tagName || '').toUpperCase()
    const isEditable = !!target.isContentEditable
    if (isEditable) return // 允许富文本编辑
    if (tag === 'INPUT' || tag === 'TEXTAREA') return // 允许表单输入
    // 2、其他区域统一禁止文字选中，避免拖拽时选中文字
    e.preventDefault()
  } catch {
    e.preventDefault()
  }
}


// 当前PSD数据和文件列表
const psdFiles = ref([]) // 存储所有上传的PSD文件（带缓存）
const currentPsdFile = ref(null) // 当前选中的PSD文件对象
const currentPsdData = shallowRef(null) // 当前选中的PSD数据（使用shallowRef避免深层响应带来的性能开销）

// 画布面板折叠状态
const canvasPanelExpanded = ref(true)
const isSendingToGenerate = ref(false) // 发送到生成页面的加载状态

/**
 * 切换画布面板展开或折叠。
 * 处理流程：
 * 1、反转展开状态
 * 2、展开且存在 PSD 时等待动画结束，再调整尺寸并重绘
 */
const toggleCanvasPanel = () => {
  // 1、切换面板状态
  canvasPanelExpanded.value = !canvasPanelExpanded.value
  // 2、展开后更新画布显示尺寸
  if (canvasPanelExpanded.value && currentPsdData.value) {
    // 延迟更新，等待折叠动画完成
    setTimeout(() => {
      updateCanvasDisplaySize()
      // 只在有数据时才重新渲染
      renderAllLayers()
    }, 350)
  }
}

// ==================== 独立预览与跨页图片传递 ====================
// 1、在原预览声明位置接入，供后续 usePresetData 等模块注入；ref 均为原对象。
const {
  openCanvasPreview,
  sendCanvasToGenerate,
  syncCanvasToPreview,
  resetPreviewWindowViewport,
  handleJumpSelect
} = useCanvasOutputCoordinator({
  currentPsdData,
  canvasRef,
  isSendingToGenerate,
  message,
  router,
  perfLogger,
  buildSuggestedFileName,
  // 2、该日志函数在页面末尾声明，只在原同步分支执行时读取。
  logPreviewSyncTrigger: (...args) => logPreviewSyncTrigger(...args)
})

// 部件分类缓存（每个PSD文件都有自己的部件分类）
const psdPartsCache = ref({}) // { psdId: { frontHand: [], backHand: [], expression: [] } }

// PSD文件状态缓存（保存每个PSD文件的选中状态、通用控制等）
const psdStatesCache = ref({}) // { psdId: { selectedParts, currentTab, commonControls, layerTreeOperations, etc. } }

// ==================== 部件状态管理 ====================
const {
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
} = usePartsState()

// 预设UI交互相关数据（非业务数据，保留在主组件）
const presetNameInput = ref(null) // 预设名称输入框ref
// 当前选中的标签页和部件
const currentTab = ref('frontHandNormal') // frontHandNormal, frontHandRight, frontHandBoth, backHand, frontLayerBackHand, bothHands, upperBody, lowerBody, action, expression, expression1, expression2, exclusiveExpression, exclusiveExpression1, exclusiveExpression2, exclusiveExpression3, beadeyeExpression1, beadeyeExpression2, beadeye, beadeyeExpression

// 部件列表图片尺寸控制（50-200px）
const partItemSize = ref(85) // 默认85px，保持固定宽高比
const partItemSizeInput = ref(85) // 输入框的值
const partsListRef = ref(null) // 部件列表容器的引用

// ==================== 搜索功能 ====================
// 1、在原搜索位置建立唯一展示状态；输入及单双击仍由搜索弹窗处理。
// 2、后方目录、列表、预设与选择/渲染入口按原读点取值，不捕获未就绪引用。
const {
  showSearchModal, highlightedPartPath, isSearchTriggeredSwitch, searchModalRef,
  openSearchModal, allPartsForSearch, handPartsForSearch, originalHandPartsForSearch,
  handleSearchResultConfirm
} = usePartSearch({
  currentPsdData, currentTab, partsListRef, partItemSize, message,
  actionParts, upperBodyParts, lowerBodyParts, dynamicExpressionTabs, dynamicExpressionParts,
  frontHandNormalParts, frontHandRightParts, backHandParts, frontLayerBackHandParts,
  frontHandBothParts, bothHandsParts,
  getPresets: () => presets,
  getPartTabs: () => partTabs,
  getSelectedPresetId: () => selectedPresetId,
  getRenderAllLayers: () => renderAllLayers,
  getSelectPart: () => selectPart,
  getCurrentPartsList: () => currentPartsList
})

// 同步滑动条和输入框的值
watch(partItemSize, (newVal) => {
  partItemSizeInput.value = newVal
})

// ==================== 虚拟滚动优化 ====================
// 创建虚拟滚动实例
const virtualScroll = useVirtualScroll({
  itemSize: partItemSize.value,
  bufferSize: 2,
  gap: 2, // 与CSS gap保持一致
  containerPadding: 2 // 与CSS padding保持一致（极致紧凑）
})

// 监听partItemSize变化，同步到虚拟滚动并重新计算
// 注意：虚拟滚动内部也会监听itemSize的变化并自动调整
watch(partItemSize, (newSize) => {
  virtualScroll.itemSize.value = newSize
  // 触发容器尺寸更新，会自动处理列数变化和滚动位置调整
  nextTick(() => {
    virtualScroll.updateContainerSize()
  })
})

// ==================== 表情分析与组合缩略图 ====================
// 1、原始引用均已初始化；在原位置注册 immediate 监听，初始空标签不会触发缩略图生成。
const {
  buildExpressionMeta,
  expressionTabMetaMap,
  combinedExpressionParts,
  enhancedExpressionTabs,
  combinedThumbnailsMap,
  getComboSignature,
  buildUniquePathMap
} = useExpressionAnalysis({ dynamicExpressionTabs, dynamicExpressionParts, currentPsdData, trimWhitespace })

// 监听当前分类变化，滚动到顶部（搜索触发的切换除外）
watch(currentTab, () => {
  // 如果是模板预览渲染中，忽略标签页变化
  if (isRenderingTemplatePreview.value) {
    return
  }

  // 如果是搜索触发的切换，不自动滚动到顶部（搜索功能会自己处理滚动）
  if (isSearchTriggeredSwitch.value) {
    return
  }

  nextTick(() => {
    virtualScroll.scrollToTop('auto')
  })
})

// ==================== 当前部件列表与选中派生 ====================
// 1、在原可见列表与选中推导位置创建；所有 computed 保持惰性，不求值后方目录或旧图层树占位。
// 2、userInteracted 仍由页面原位创建，后续会话与选择协调共用；所有 watch 与生命周期保持原位。
const {
  handleSizeInputConfirm, visiblePartsList, selectedParts, selectedPart, isPartActive, hasRenderedContent, currentPartsList, emptyStateText
} = usePartBrowsing({
  currentTab, currentPsdData, perfLogger, partItemSize, partItemSizeInput,
  frontHandNormalParts, frontHandRightParts, frontHandBothParts, backHandParts,
  frontLayerBackHandParts, bothHandsParts, upperBodyParts, lowerBodyParts, actionParts,
  dynamicExpressionTabs, dynamicExpressionParts, dynamicFrontHandTabs, dynamicFrontHandParts,
  dynamicBackHandTabs, dynamicBackHandParts, dynamicBothHandsTabs, dynamicBothHandsParts,
  combinedExpressionParts, combinedThumbnailsMap, getComboSignature,
  getLayerTreeData: () => layerTreeData,
  getAllPartsListsMap: () => allPartsListsMap,
  getPartTabs: () => partTabs,
  getUserInteracted: () => userInteracted,
  getVirtualScroll: () => virtualScroll,
  getPresets: () => presets,
  getSelectedPresetId: () => selectedPresetId,
  getTemplates1: () => templates1,
  getTemplates2: () => templates2,
  getSelectedTemplate1Id: () => selectedTemplate1Id,
  getSelectedTemplate2Id: () => selectedTemplate2Id
})

// 追踪每个分组是否被用户手动操作过（用于区分初始状态和用户手动取消状态）
const userInteracted = ref({
  frontHandNormal: false, // 前手
  frontHandRight: false,  // 前手(右手)
  frontHandBoth: false,   // 前手(双手)
  backHand: false,
  frontLayerBackHand: false,
  bothHands: false,
  upperBody: false,
  lowerBody: false,
  action: false,
  expression: false,
  expression1: false,
  expression2: false,
  exclusiveExpression: false,
  exclusiveExpression1: false,
  exclusiveExpression2: false,
  exclusiveExpression3: false,
  beadeyeExpression1: false,
  beadeyeExpression2: false,
  beadeye: false,
  beadeyeExpression: false
})

// ==================== 通用控制逻辑（提前初始化，避免变量未定义） ====================
// 先创建依赖对象（稍后设置函数引用）
const commonControlsDeps = {
  controlPriority: null, // 稍后设置
  renderAllLayers: null, // 稍后设置
  message
}
// 创建 composable 实例
const commonControlsComposable = useCommonControls(commonControlsDeps)

// 立即解构变量，确保在使用前可用
const {
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
  toggleCommonControlsPanel,
  resetCommonControls,
  handleCommonControlChange,
  handleSelectHeadOnlyChange,
  handleSelectNonHeadChange,
  getCommonControlsState,
  restoreCommonControlsState
} = commonControlsComposable

// 1、展示契约只列出十九项通用控件的原始 ref，不传递整页上下文或创建第二份状态。
const commonControlModels = {
  exclusiveMode, actionExclusiveMode, expressionExclusiveMode, showFront, showSide, showBack,
  showBackground, showBaseLayer, showSecondBaseLayer, showWeapon, showBackHair, showShadow,
  showShakeHead, showHoldSword, showBackHandSword, showDownwardSlash, selectHeadOnly,
  selectNonHead, enableTrimWhitespace
}
const commonControlValues = computed(() => Object.fromEntries(
  Object.entries(commonControlModels).map(([key, model]) => [key, model.value])
))

/** 更新展示控件对应的原 ref。处理流程：1、同步写回，保持原 v-model 先于 change 的顺序。 */
const updateCommonControlModel = (key, value) => {
  // 1、只接受明确列出的控件字段，通用控制 watch 和业务事件仍使用原引用。
  if (Object.hasOwn(commonControlModels, key)) commonControlModels[key].value = value
}

// ==================== 整合面板控制（通用控制 + 图层结构） ====================
const {
  integratedPanelCollapsed, integratedPanelTab,
  toggleIntegratedPanel, handleHeaderClick, switchIntegratedPanelTab
} = useIntegratedPanelState()

// ==================== 图层树交互逻辑 ====================
// 注意：某些依赖函数需要延迟获取，使用 getter 模式
let layerTreeInstance = null
/**
 * 在依赖就绪后初始化图层树模块。
 * 处理流程：
 * 1、创建模块实例并保存引用，返回给后续依赖接线
 */
const initLayerTree = (deps) => {
  // 1、通过参数注入尚未在声明阶段可用的业务方法
  layerTreeInstance = useLayerTree(deps)
  return layerTreeInstance
}
// 临时导出（在初始化前使用默认值）
let layerTreeData = ref([])
let layerTreeOperations = ref({})
let selectedLayersMap = ref({})
let controlPriority = ref('parts')
/**
 * 图层树构建方法的初始化占位。
 * 处理流程：
 * 1、模块就绪前返回空树，稍后替换为实际构建方法
 */
let buildLayerTree = () => []
/**
 * 单层可见性更新的初始化占位。
 * 处理流程：
 * 1、初始化阶段不执行操作，稍后替换为图层树模块入口
 */
let handleLayerVisibilityChange = () => {}
/**
 * 图层批量可见性更新的初始化占位。
 * 处理流程：
 * 1、模块就绪前保持空操作，之后接入批量更新方法
 */
let handleBatchToggleVisibility = () => {}
/**
 * 图层初始状态恢复的初始化占位。
 * 处理流程：
 * 1、暂不操作图层，待模块创建后替换为恢复入口
 */
let handleRestoreInitialState = () => {}
/**
 * 图层操作记录清理的初始化占位。
 * 处理流程：
 * 1、依赖未就绪前为空操作，随后替换为实际清理函数
 */
let clearLayerTreeOperations = () => {}
/**
 * 部件向图层树同步的兼容占位。
 * 处理流程：
 * 1、保留旧接口引用，当前选择流程直接更新图层可见性
 */
let syncLayerTreeFromParts = () => {} // 已废弃，现在直接操作visible
/**
 * 选中图层映射更新的初始化占位。
 * 处理流程：
 * 1、暂不更新映射，模块就绪后绑定实际实现
 */
let updateSelectedLayersMap = () => {}
/**
 * 图层树渲染的异步初始化占位。
 * 处理流程：
 * 1、初始化阶段立即完成，随后替换为实际渲染入口
 */
let renderByLayerTree = async () => {}

// ==================== 画布缩放和滚动控制 ====================
// 注意：renderAllLayers 需要在函数定义后才能传递，所以先初始化为 null
let renderAllLayersRef = null
const {
  canvasScale,
  scrollMode,
  userHasManuallyScrolled,
  isProgrammaticScroll,
  handleCanvasWheel,
  toggleScrollMode,
  centerCanvasScroll,
  handleCanvasAreaScroll,
  updateCanvasDisplaySize
} = useCanvasScale({
  canvasAreaRef,
  canvasHeightRatio,
  canvasStyle,
  psdAspectRatio,
  /**
   * 延迟读取全画布渲染入口。
   * 处理流程：
   * 1、返回初始化后更新的渲染引用
   */
  get renderAllLayers() {
    // 1、避免创建缩放模块时捕获尚未赋值的函数
    return renderAllLayersRef
  }
})


// ==================== 画布分隔条调整 ====================
const {
  handleDividerMouseDown,
  handleDividerMouseMove,
  handleDividerMouseUp
} = useCanvasDivider({
  canvasHeightRatio,
  updateCanvasDisplaySize,
  contentWrapperRef,
  windowHeight
})

// ==================== 文件名生成函数 ====================
/** 保留函数声明提升；七项明确 getter 在命名算法原读取点取值，不提前捕获晚赋值 ref。 */
function buildSuggestedFileName() {
  return buildCanvasOutputFileName({
    get controlPriority() { return controlPriority },
    get currentPsdFile() { return currentPsdFile },
    get showSide() { return showSide },
    get showBack() { return showBack },
    get showRear() { return showRear },
    get selectedParts() { return selectedParts },
    get dynamicExpressionTabs() { return dynamicExpressionTabs }
  })
}

// ==================== 拖拽处理器初始化 ====================
// 提取拖拽核心事件处理为 composable（必须在所有依赖状态定义之后）
const {
  handleCanvasMouseDown,
  handleMouseMoveForDrag,
  handleMouseUpForDrag,
  handleWindowMouseOut,
  triggerSystemDrag,
  createTempFileAndDrag,
  cleanupDrag,
  handleDragFinished
} = useDragHandlers({
  state: dragState,
  constants: {
    FOLLOW_OFFSET_X,
    FOLLOW_OFFSET_Y,
    MIN_DRAG_TIME_MS,
    OUTSIDE_SAFE_MARGIN,
    OUTSIDE_COUNT_THRESHOLD,
    OUTSIDE_DURATION_MS
  },
  deps: {
    canvasRef,
    updateWindowBounds,
    windowBounds,
    trimWhitespace,
    trimWhitespaceHorizontal,
    drawDragPreview,
    message,
    buildSuggestedFileName,
    controlPriority,
    enableTrimWhitespace,
    currentPsdFile
  }
})

const { registerDragFinished, cleanupDragFinished } = useDragFinishedSubscription()

// ==================== 部件小图拖拽功能 ====================
const {
  handlePartDragStart,
  handlePartDragEnd,
  handlePartImageClick,
  precacheImageData  // 🚀 预缓存函数，在 mouseenter 时调用
} = usePartImageDrag({
  message,
  currentPsdFile,
  controlPriority,
  canvasDragState: dragState // 传入画布拖拽状态，防止冲突
})

/**
 * 应用被点击的预设图片。
 * 处理流程：
 * 1、记录点击并交给预设选择逻辑，拖拽不会触发此点击事件
 */
const handlePresetImageClick = (presetId) => {
  // 1、按预设标识应用保存的配置
  console.log('🖱️ 预设图片点击:', presetId)
  selectPreset(presetId)
}

// ==================== 部件标签目录与编排 ====================
// 1、在原位置创建，复用已就绪的部件与 PSD 引用，不提前求值标签 computed。
// 2、hasRenderedContent 已由部件浏览模块建立；getter 只在默认标签查询或首次分行求值时读取。
// 3、选中推导由部件浏览模块负责，单双击由选择协调模块负责；跨 PSD 会话复用唯一的 initialSorted 重置标记。
const {
  partTabs,
  allPartsListsMap,
  getFirstDefaultTabKey,
  initialSorted,
  resetTabConfig,
  dragOverTabKey,
  dropPosition,
  handleTabDragStart,
  handleTabDragEnd,
  handleTabDragOver,
  handleTabDragLeave,
  handleTabDrop,
  handleContainerDragOver,
  handleContainerDrop,
  categorizedTabs
} = usePartTabLayout({
  currentPsdData,
  frontHandNormalParts,
  frontHandRightParts,
  frontHandBothParts,
  backHandParts,
  frontLayerBackHandParts,
  bothHandsParts,
  upperBodyParts,
  lowerBodyParts,
  actionParts,
  dynamicExpressionTabs,
  dynamicExpressionParts,
  dynamicFrontHandTabs,
  dynamicFrontHandParts,
  dynamicBackHandTabs,
  dynamicBackHandParts,
  dynamicBothHandsTabs,
  dynamicBothHandsParts,
  dynamicUpperBodyParts,
  dynamicLowerBodyParts,
  dynamicActionParts,
  enhancedExpressionTabs,
  combinedExpressionParts,
  getHasRenderedContent: () => hasRenderedContent.value,
  message
})
// ==================== PSD解析核心功能 ====================
// 注意：usePsdParser 的初始化需要在所有依赖函数定义之后
// 因此移到文件末尾，在 classifyParts, renderAllLayers, buildLayerTree 等定义之后
// 临时占位，避免引用错误
/**
 * PSD 服务初始化的临时入口。
 * 处理流程：
 * 1、依赖未就绪前立即完成，稍后由解析模块替换
 */
let initPSDService = async () => {}
/**
 * PSD 文件解析的临时入口。
 * 处理流程：
 * 1、初始化阶段为空操作，模块就绪后替换为解析实现
 */
let parsePsdFile = async () => {}
/**
 * PSD 文件处理的临时入口。
 * 处理流程：
 * 1、先提供可引用的异步函数，随后绑定实际处理方法
 */
let processFile = async () => {}
/**
 * PSD 历史保存依赖注入的临时入口。
 * 处理流程：
 * 1、初始化阶段为空操作，解析模块创建后替换为注入方法
 */
let setSavePsdPathToHistory = () => {}

// ==================== PSD历史记录管理 ====================
// 使用 composable 管理历史记录（依赖 processFile，将在 usePsdParser 初始化后再初始化）
let psdHistoryFunctions = null
// 占位变量，避免引用错误
/**
 * 单个 PSD 路径历史保存的初始化占位。
 * 处理流程：
 * 1、提供空入口，历史模块创建后替换为真实保存函数
 */
let savePsdPathToHistory = () => {}
/**
 * 当前 PSD 历史保存的初始化占位。
 * 处理流程：
 * 1、暂不保存，历史模块就绪后接入实际入口
 */
let saveCurrentPsdHistory = () => {}
/**
 * PSD 历史加载的初始化占位。
 * 处理流程：
 * 1、依赖就绪前保持空操作，随后绑定历史加载方法
 */
let loadPsdFromHistory = () => {}
/**
 * PSD 历史清空的初始化占位。
 * 处理流程：
 * 1、暂不清理记录，模块就绪后替换为实际方法
 */
let clearPsdHistory = () => {}
/**
 * PSD 历史自动保存的初始化占位。
 * 处理流程：
 * 1、初始化阶段为空操作，随后接入生命周期使用的保存入口
 */
let autoSavePsdHistory = () => {}
/**
 * PSD 历史导出的初始化占位。
 * 处理流程：
 * 1、提供临时入口，等待历史模块绑定实际导出流程
 */
let exportPsdHistory = () => {}
/**
 * PSD 历史导入的初始化占位。
 * 处理流程：
 * 1、提供临时入口，等待历史模块绑定实际导入流程
 */
let importPsdHistory = () => {}

// ==================== Canvas渲染核心逻辑临时占位变量 ====================
// 注意：必须在 usePresetData 之前定义，因为 usePresetData 依赖这些变量
let isRendering = ref(false)
/**
 * 画布刷新的异步初始化占位。
 * 处理流程：
 * 1、模块创建前立即完成，之后由渲染模块替换
 */
let refreshCanvas = async () => {}
/**
 * 全图层渲染的异步初始化占位。
 * 处理流程：
 * 1、先供预设模块建立依赖，稍后替换为真实渲染入口
 */
let renderAllLayers = async () => {}
/**
 * 单个部件渲染的初始化占位。
 * 处理流程：
 * 1、初始化阶段立即完成，后续绑定实际绘制方法
 */
let renderPart = async () => {}
/**
 * 全分组过滤渲染的初始化占位。
 * 处理流程：
 * 1、暂不绘制，渲染模块创建后注入分组过滤实现
 */
let renderLayersWithAllGroupFilters = async () => {}
/**
 * 剪贴调整分组渲染的初始化占位。
 * 处理流程：
 * 1、先建立可引用入口，随后绑定包含剪贴处理的绘制方法
 */
let renderGroupWithClippingAdjustments = async () => {}
/**
 * 单图层渲染的初始化占位。
 * 处理流程：
 * 1、模块初始化完成前保持空操作，之后绑定真实渲染方法
 */
let renderLayer = async () => {}
let renderAllLayersQueue = null

/**
 * 合并同时发生的全画布渲染请求。
 * 处理流程：
 * 1、无在途任务时创建渲染承诺，并在结束时清除引用
 * 2、返回共享承诺供调用方等待
 */
const queueRenderAllLayers = () => {
  // 1、复用正在执行的渲染，避免并发重复绘制
  if (!renderAllLayersQueue) {
    renderAllLayersQueue = (async () => {
      try {
        await renderAllLayers()
      } finally {
        renderAllLayersQueue = null
      }
    })()
  }
  // 2、让本轮所有调用者等待同一个任务
  return renderAllLayersQueue
}

// ==================== 预设功能（已提取到 usePresetData.js） ====================
// 所有预设业务逻辑函数已提取到 composables/usePresetData.js
// 包括：getAllPresetsData, saveAllPresetsData, findPresetsByMatch, loadPresets, savePresets
// handleSavePreset, handleExportPreset, handleImportPreset, selectPreset, renderPreset
// deselectAllPresets, confirmDeletePreset, deletePreset, renamePreset

// ==================== 初始化PSD历史记录功能 ====================
// 历史记录功能将在 usePsdParser 初始化后再初始化（因为需要真正的 processFile 实现）

// ==================== 初始化预设数据管理功能 ====================
const {
  presets,
  selectedPresetId,
  editingPresetId,
  loadPresets,
  savePresets,
  handleSavePreset: handleSavePresetOriginal,
  handleExportPreset,
  handleImportPreset,
  selectPreset,
  renderPreset,
  deselectAllPresets,
  confirmDeletePreset,
  deletePreset,
  renamePreset
} = usePresetData({
  currentPsdFile,
  currentPsdData,
  canvasRef,
  canvasWidth,
  canvasHeight,
  isRendering,
  renderAllLayers: () => renderAllLayers(), // 使用箭头函数包装，避免undefined问题
  syncCanvasToPreview // 将画布同步方法下发给预设逻辑，保障预设切换后预览窗口立即刷新
})

// 模板悬浮预览由 useTemplateHoverPreview 管理，依赖模板数据使用延迟 getter。
const {
  templateHoverPreview,
  handleTemplateHoverEnter,
  handleTemplateHoverMove,
  handleTemplateHoverLeave
} = useTemplateHoverPreview({
  enablePresetHover,
  getTemplatePreview: () => getTemplatePreview,
  getActiveTemplateType: () => activeTemplateType.value
})

// 监听悬浮预览开关，关闭时立即隐藏对应预览
watch(enableCanvasHover, (newValue) => {
  if (!newValue) {
    hoverPreview.visible = false
  }
})

watch(enablePresetHover, (newValue) => {
  if (!newValue) {
    presetHoverPreview.visible = false
    templateHoverPreview.visible = false
  }
})

// ==================== 初始化预设UI交互功能 ====================
const {
  startEditPresetName,
  handlePresetNameBlur
} = usePresetUI({
  presets,
  editingPresetId,
  renamePreset
})

// ==================== 模板应用与预览绘制编排 ====================
// 1、在原首次应用函数位置创建，仅建立函数与空标记；模板数据模块仍在下方按原顺序初始化。
// 2、已就绪的 const 传原引用；模板数据、后方选择入口及会替换的图层树/绘制函数逐项延迟读取。
// 3、工厂不求值 computed、不调用 getter 或 callback；下方渲染回调赋值及全部 watch 保持原位。
const {
  applyTemplateConfig, generateTemplatePreviewBase64, applyTemplateById, setTemplateCanvasRef,
  renderTemplatePreview, renderAllTemplatesPreviews, renderTemplatesPreviewsRef,
  isRenderingTemplatePreview, isRenderingTemplate, canvasOpacity
} = useTemplateRenderCoordinator({
  currentPsdData, allPartsListsMap, dynamicExpressionTabs, selectedParts, currentTab, message,
  canvasRef, getCustomGroupNames, buildUniquePathMap, trimWhitespace,
  getActiveTemplateType: () => activeTemplateType,
  getLayerTreeData: () => layerTreeData,
  getRenderAllLayers: () => renderAllLayers,
  getSelectPart: () => selectPart,
  getApplyTemplate: () => applyTemplate,
  getTemplatePreviewReader: () => getTemplatePreview,
  getTemplates1: () => templates1,
  getTemplates2: () => templates2,
  getSetLayerVisibilityByPath: () => setLayerVisibilityByPath
})

// ==================== 初始化模板数据管理功能 ====================
const {
  // 双模板系统状态
  activeTemplateType,
  templates1,
  templates2,
  selectedTemplate1Id,
  selectedTemplate2Id,
  editingTemplate1Id,
  editingTemplate2Id,
  // 计算属性（当前活动模板）
  templates,
  selectedTemplateId,
  editingTemplateId,
  // 方法
  loadTemplates,
  saveTemplates,
  switchTemplateType,
  handleSaveTemplate: handleSaveTemplateOriginal,
  handleExportTemplate,
  handleImportTemplate,
  selectTemplate,
  applyTemplate,
  deselectAllTemplates,
  confirmDeleteTemplate,
  deleteTemplate,
  renameTemplate: renameTemplateFunc,
  getTemplatePreview,
  getAllTemplatePreviews
} = useTemplateData({
  currentPsdFile,
  currentPsdData,
  selectedParts,
  userInteracted,
  dynamicExpressionTabs,
  applyTemplateConfig,
  renderTemplatesPreviews: renderTemplatesPreviewsRef
})

// ==================== 旧模板交互模块保持未接入 ====================
// 模板列表控制统一在下方依赖就绪后接入 useTemplatePresetList；不启用旧 useTemplateUI。

// 将渲染函数赋值给 ref，供 useTemplateData 使用
renderTemplatesPreviewsRef.value = renderAllTemplatesPreviews

// 🔧 标记：是否正在添加模板（用于避免watch重复渲染）
const isAddingTemplate = ref(false)

// ==================== 模板与预设列表交互 ====================
// 1、在预览函数和新增标记就绪后接入原引用；所有依赖均为不重新赋值的 const。
// 2、列表只持有原多选集合、菜单与拖动状态；业务数组、应用绘图和下方监听仍由原模块与页面负责。
const {
  handleSavePreset,
  getPresetDisplayName,
  getPresetFullDescription,
  contextMenuVisible,
  contextMenuPosition,
  contextMenuItemType,
  contextMenuSingleItemId,
  contextMenuTemplateDetail,
  templateDetailEntries,
  templateDetailTypeLabel,
  handleTemplateCardClick,
  handleTemplateContextMenu,
  closeContextMenu,
  handleBatchDeleteTemplates,
  handleContextMenuRename,
  handlePageClick,
  isTemplateMultiSelected,
  isTemplateDragging,
  isTemplateDragOver,
  handleTemplateDragStart,
  handleTemplateDragEnter,
  handleTemplateDragOver,
  handleTemplateDragLeave,
  handleTemplateDrop,
  handleTemplateDragEnd,
  handleTemplateListDragOver,
  handleTemplateListDragLeave,
  handleTemplateListDrop,
  handlePresetCardClick,
  handlePresetContextMenu,
  handleBatchDeletePresets,
  handleTemplateDetailApply,
  isPresetMultiSelected,
  handleSaveTemplate1,
  handleSaveTemplate2,
  startEditTemplateNameById
} = useTemplatePresetList({
  selectedParts,
  handleSavePresetOriginal,
  templates1,
  templates2,
  templates,
  activeTemplateType,
  editingTemplate1Id,
  editingTemplate2Id,
  currentTab,
  message,
  dialog,
  saveTemplates,
  deleteTemplate,
  confirmDeleteTemplate,
  renameTemplateFunc,
  selectPreset,
  deletePreset,
  applyTemplateById,
  handleSaveTemplateOriginal,
  generateTemplatePreviewBase64,
  renderTemplatePreview,
  isAddingTemplate
})

// 监听动作模板列表变化和标签页切换，自动渲染预览
watch([templates1, currentTab], async ([newTemplates, newTab], [oldTemplates, oldTab]) => {
  // 如果正在添加模板，跳过（避免重复渲染所有预览）
  if (isAddingTemplate.value) {
    console.log('⏭️ 正在添加动作模板，跳过全量预览渲染')
    return
  }

  if (newTab === 'template1' && newTemplates && newTemplates.length > 0) {
    // 只有在切换到template1标签页或模板数量减少时才重新渲染所有预览
    const isTabSwitch = oldTab !== 'template1' && newTab === 'template1'
    const isTemplateDeleted = oldTemplates && newTemplates.length < oldTemplates.length

    if (isTabSwitch || isTemplateDeleted) {
      // 延迟一下，确保DOM已更新
      await nextTick()
      setTimeout(() => {
        renderAllTemplatesPreviews()
      }, 100)
    }
  }
}, { deep: true })

// 监听表情模板列表变化和标签页切换，自动渲染预览
watch([templates2, currentTab], async ([newTemplates, newTab], [oldTemplates, oldTab]) => {
  // 如果正在添加模板，跳过（避免重复渲染所有预览）
  if (isAddingTemplate.value) {
    console.log('⏭️ 正在添加表情模板，跳过全量预览渲染')
    return
  }

  if (newTab === 'template2' && newTemplates && newTemplates.length > 0) {
    // 只有在切换到template2标签页或模板数量减少时才重新渲染所有预览
    const isTabSwitch = oldTab !== 'template2' && newTab === 'template2'
    const isTemplateDeleted = oldTemplates && newTemplates.length < oldTemplates.length

    if (isTabSwitch || isTemplateDeleted) {
      // 延迟一下，确保DOM已更新
      await nextTick()
      setTimeout(() => {
        renderAllTemplatesPreviews()
      }, 100)
    }
  }
}, { deep: true })

// ==================== 部件分类逻辑 ====================
// classifyParts 函数已移至 composables/usePartsClassify.js

// ==================== UI交互 ====================

// PSD 会话四个入口在图层树与画布渲染依赖完成后统一初始化。

// ==================== 部件选择与图层显隐协调 ====================
// 1、在原函数位置接线；已就绪的 const 依赖复用原引用，选中推导由部件浏览模块负责，监听仍留在页面。
// 2、图层树、控制优先级和全量渲染在下方替换占位；getter 每次使用时读取最新引用。
// 3、队列与预览同步使用已声明的原函数，不增加 await、this 绑定或监听注册。
const {
  switchTab, handleTabClick, setLayerVisibilityByPath, setLayerVisibilityByName, getLayerPath, selectPart
} = usePartSelectionCoordinator({
  currentTab, selectedParts, userInteracted, selectedPresetId, selectedTemplate1Id, selectedTemplate2Id,
  partTabs, allPartsListsMap, frontHandNormalParts, frontHandRightParts, frontHandBothParts,
  backHandParts, frontLayerBackHandParts, bothHandsParts, upperBodyParts, lowerBodyParts, actionParts,
  dynamicExpressionTabs, dynamicExpressionParts, dynamicFrontHandTabs, dynamicFrontHandParts,
  dynamicBackHandTabs, dynamicBackHandParts, dynamicBothHandsTabs, dynamicBothHandsParts,
  enhancedExpressionTabs, expressionTabMetaMap, exclusiveMode, expressionExclusiveMode,
  actionExclusiveMode, currentPsdData, showFront, message, queueRenderAllLayers, syncCanvasToPreview,
  getLayerTreeData: () => layerTreeData,
  getControlPriority: () => controlPriority,
  getRenderAllLayers: () => renderAllLayers
})

// ==================== Canvas渲染核心逻辑（已提取到 useCanvasRender.js） ====================
// 渲染相关的所有函数已迁移到 composables/useCanvasRender.js
// 包括：isRendering, refreshCanvas, renderAllLayers, renderPart,
// renderLayersWithAllGroupFilters, renderGroupWithClippingAdjustments, renderLayer
// 注意：临时占位变量已在文件前面定义（在 usePresetData 之前）

// ==================== 初始化Canvas渲染 ====================
/**
 * 在状态与业务依赖齐备后初始化画布渲染模块。
 * 处理流程：
 * 1、注入画布、PSD、图层树、通用控制和部件状态
 * 2、用实际渲染方法替换初始化占位，并更新缩放模块引用
 */
const initCanvasRender = () => {
  // 1、集中传入响应式依赖，保持各渲染入口使用同一组状态
  const renderComposable = useCanvasRender({
    // Canvas基础状态
    canvasRef,
    canvasStyle,
    scrollMode,
    canvasScale,

    // PSD数据
    currentPsdData,

    // 预设相关
    selectedPresetId,
    presets,
    renderPreset,

    // 图层树相关
    updateSelectedLayersMap,
    controlPriority,
    renderByLayerTree,

    // 通用控制
    commonControls: {
      showBackground,
      showBaseLayer,
      showSecondBaseLayer,
      showWeapon,
      showBackHair,
      showFront,
      showSide,
      showBack,
      showRear,
      showShadow,
      showShakeHead,
      showHoldSword,
      showBackHandSword,
      showDownwardSlash
    },

    // 部件状态
    partsState: {
      selectedPart,
      selectedParts,
      userInteracted,
      currentTab,
      frontHandNormalParts,
      frontHandRightParts,
      frontHandBothParts,
      backHandParts,
      frontLayerBackHandParts,
      bothHandsParts,
      upperBodyParts,
      lowerBodyParts,
      actionParts
    },

    // 动态状态
    dynamicState: {
      dynamicExpressionTabs,
      dynamicExpressionParts,
      dynamicFrontHandTabs,
      dynamicFrontHandParts,
      dynamicBackHandTabs,
      dynamicBackHandParts,
      dynamicBothHandsTabs,
      dynamicBothHandsParts,
      dynamicUpperBodyTabs,
      dynamicUpperBodyParts,
      dynamicLowerBodyTabs,
      dynamicLowerBodyParts,
      dynamicActionTabs,
      dynamicActionParts
    }
  })

  // 2、替换临时占位变量，并向画布缩放模块传递实际渲染入口
  isRendering = renderComposable.isRendering
  refreshCanvas = renderComposable.refreshCanvas
  renderAllLayers = renderComposable.renderAllLayers
  renderPart = renderComposable.renderPart
  renderLayersWithAllGroupFilters = renderComposable.renderLayersWithAllGroupFilters
  renderGroupWithClippingAdjustments = renderComposable.renderGroupWithClippingAdjustments
  renderLayer = renderComposable.renderLayer

  // 将renderAllLayers函数赋值给ref，供useCanvasScale使用
  renderAllLayersRef = renderAllLayers

  console.log('✅ Canvas渲染模块初始化完成')
}

// ==================== 滚动模式控制 ====================
// 已迁移到 composables/useCanvasScale.js

// ==================== 通用控制 ====================

// ==================== 通用控制函数（已移至 useCommonControls.js） ====================

// 以下函数已迁移到 composables/useCanvasScale.js:
// - updateCanvasDisplaySize()
// - centerCanvasScroll()
// - handleCanvasAreaScroll()

// 保持渲染服务与图层树的晚初始化：函数调用时读取原页面最新绑定。
useActionPageLifecycle({
  windowHeight, updateCanvasDisplaySize,
  initPSDService: () => initPSDService(),
  getAlwaysOnTopState, loadTemplates, registerDragFinished, handleDragFinished,
  partsListRef, virtualScroll, scrollMode, canvasScale, userHasManuallyScrolled,
  renderAllLayers: () => renderAllLayers(),
  autoSavePsdHistory: () => autoSavePsdHistory(),
  cleanupDragFinished, psdFiles, currentPsdFile, currentPsdData,
  getLayerTreeData: () => layerTreeData,
  psdPartsCache, psdStatesCache, userInteracted
})

// ==================== 图层树相关功能（已提取到 composables/useLayerTree.js） ====================
// 注意：实际的初始化在渲染函数定义之后进行

// ==================== 设置通用控制的依赖函数（在 renderAllLayers 定义后） ====================
// 注意：commonControlsComposable 已在文件前面创建并解构，这里只是设置依赖
commonControlsDeps.renderAllLayers = () => queueRenderAllLayers()

// 初始化图层树 composable（在依赖函数定义之后）
const layerTreeComposable = initLayerTree({
  currentPsdData,
  canvasRef,
  selectedParts,
  showFront,
  showSide,
  showBack,
  showRear,
  showBackground,
  showBaseLayer,
  showSecondBaseLayer,
  selectHeadOnly,
  selectNonHead,
  message,
  onRenderTrigger: () => renderAllLayers(),
  findClippingGroup,
  renderClippingGroup,
  applyLayerMask,
  drawLayerImage
})

// 重新赋值图层树相关变量
layerTreeData = layerTreeComposable.layerTreeData
layerTreeOperations = layerTreeComposable.layerTreeOperations
selectedLayersMap = layerTreeComposable.selectedLayersMap
controlPriority = layerTreeComposable.controlPriority
buildLayerTree = layerTreeComposable.buildLayerTree

// 1、在原反向同步位置创建唯一同步标记，不提前注册尾部通用控件 watch。
const commonControlLayerSync = useCommonControlLayerSync({
  showBackground, showFront, showSide, showBack, showShadow, showWeapon, showBackHair,
  showShakeHead, showHoldSword, showBackHandSword, showDownwardSlash, selectedPresetId,
  originalHandleLayerVisibilityChange: layerTreeComposable.handleLayerVisibilityChange
})
handleLayerVisibilityChange = commonControlLayerSync.handleLayerVisibilityChange

handleBatchToggleVisibility = layerTreeComposable.handleBatchToggleVisibility
handleRestoreInitialState = layerTreeComposable.handleRestoreInitialState
clearLayerTreeOperations = layerTreeComposable.clearLayerTreeOperations
syncLayerTreeFromParts = layerTreeComposable.syncLayerTreeFromParts // 部件选择 → 图层树（已移除，直接操作visible）
updateSelectedLayersMap = layerTreeComposable.updateSelectedLayersMap
renderByLayerTree = layerTreeComposable.renderByLayerTree
const syncBackgroundControlFromLayerTree = layerTreeComposable.syncBackgroundControlFromLayerTree

// 现在所有依赖都准备好了，初始化Canvas渲染模块
initCanvasRender()

// 会话仅由挂载后的标签事件及内部互调触发；在唯一一次渲染初始化后接入最终引用。
// layerTreeData、buildLayerTree、renderAllLayers 已替换占位，后续不会重新赋值。
const { savePsdState, restorePsdState, switchPsdFile, removePsdFile } = usePsdSession({
  session: {
    psdFiles, currentPsdFile, currentPsdData, psdPartsCache, psdStatesCache, currentTab, userInteracted
  },
  layerTree: {
    layerTreeData, buildLayerTree, setLayerVisibilityByPath, syncBackgroundControlFromLayerTree
  },
  parts: {
    dynamicExpressionParts, dynamicExpressionTabs, dynamicFrontHandTabs, dynamicBackHandTabs,
    dynamicBothHandsTabs, dynamicUpperBodyTabs, dynamicLowerBodyTabs, dynamicActionTabs,
    initialSorted, updatePartsFromClassifyResult, clearAllPartsState, buildExpressionMeta, getFirstDefaultTabKey
  },
  canvas: {
    canvasRef, canvasWidth, canvasHeight, updateCanvasDisplaySize, resetPreviewWindowViewport, renderAllLayers
  },
  commonControls: { getCommonControlsState, restoreCommonControlsState },
  presetState: { presets, selectedPresetId, editingPresetId, loadPresets },
  templateState: {
    templates, selectedTemplate1Id, selectedTemplate2Id, editingTemplate1Id, editingTemplate2Id, loadTemplates
  },
  message
})

// 通用控制不再需要依赖（直接通过watch监听）

// ==================== 初始化 PSD 解析器（在所有依赖函数定义之后） ====================
const psdParser = usePsdParser({
  // 基础依赖
  message,

  // 文件与当前数据
  psdFiles,
  currentPsdFile,
  currentPsdData,

  // 图层树与控制优先级
  layerTreeData,
  selectedLayersMap,
  controlPriority,

  // 部件分类相关状态（当前显示的数据容器）
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

  // 动态分组
  dynamicExpressionParts,
  dynamicExpressionTabs,
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

  // 画布
  canvasWidth,
  canvasHeight,
  updateCanvasDisplaySize,

  // 预设与渲染
  getFirstDefaultTabKey,
  selectedPresetId,
  editingPresetId,
  presets,
  loadPresets,
  renderAllLayers,

  // 业务函数
  classifyParts,
  buildLayerTree,
  setLayerVisibilityByPath,
  syncBackgroundControlFromLayerTree,

  // 工具函数
  generateId,

  // 额外依赖（缓存与选择状态）
  psdPartsCache,
  selectedParts,
  userInteracted,
  currentTab
})

// 重新赋值 PSD 解析函数
initPSDService = psdParser.initPSDService
parsePsdFile = psdParser.parsePsdFile
processFile = psdParser.processFile
setSavePsdPathToHistory = psdParser.setSavePsdPathToHistory

// ==================== 初始化 PSD 上传逻辑（需要 processFile 依赖） ====================
const {
  isUploading,
  isDragOver,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleSelectPsdFiles
} = usePsdUpload({
  message,
  psdFiles,
  processFile
})

// ==================== 初始化 PSD 历史记录功能（需要 processFile 依赖） ====================
psdHistoryFunctions = usePsdHistory({
  psdFiles,
  processFile,
  message
})

// 重新赋值历史记录相关函数
savePsdPathToHistory = psdHistoryFunctions.savePsdPathToHistory
saveCurrentPsdHistory = psdHistoryFunctions.saveCurrentPsdHistory
loadPsdFromHistory = psdHistoryFunctions.loadPsdFromHistory
clearPsdHistory = psdHistoryFunctions.clearPsdHistory
autoSavePsdHistory = psdHistoryFunctions.autoSavePsdHistory
exportPsdHistory = psdHistoryFunctions.exportPsdHistory
importPsdHistory = psdHistoryFunctions.importPsdHistory

// 将历史记录保存函数注入解析器（避免循环依赖）
setSavePsdPathToHistory(savePsdPathToHistory)

// ==================== 初始化更多菜单功能 ====================
const {
  moreOptions,
  handleMoreSelect
} = useMoreMenu({
  canvasScaleControl: {
    scrollMode,
    canvasScale,
    userHasManuallyScrolled,
    updateCanvasDisplaySize
  },
  renderAllLayers,
  historyControl: {
    saveCurrentPsdHistory,
    loadPsdFromHistory,
    clearPsdHistory,
    exportPsdHistory,
    importPsdHistory
  },
  presetControl: {
    handleExportPreset,
    handleImportPreset
  },
  templateControl: {
    handleExportTemplate,
    handleImportTemplate,
    switchTemplateType
  },
  currentTab,
  switchTab,
  renderTemplatesPreviews: renderAllTemplatesPreviews,
  message
})

// ==================== 跳转菜单选项 ====================
const jumpOptions = createCanvasJumpOptions()

// 已移除所有调整图层算法实现

// ==================== 监听通用控制变化，自动修改图层树visible ====================
// 单独监听每个控制，避免循环触发和性能问题

// 1、保持两个日志的晚声明位置；早期输出模块仍只在同步分支内通过原闭包读取。
const logRenderTrigger = createRenderTriggerLogger(perfLogger)
const { logPreviewSyncTrigger, registerPreviewSyncWatches } = usePreviewSyncSubscriptions(perfLogger)

// 2、图层树和画布渲染已完成唯一一次初始化，此处只传最终引用，不保留占位副本。
commonControlLayerSync.registerCommonControlWatches({
  layerTreeData, setLayerVisibilityByName, renderAllLayers, logRenderTrigger
})

// ==================== 画布实时同步到预览窗口 ====================
// 3、在原两个预览 watch 位置同步注册，早期 watch 和所有生命周期位置均不变。
registerPreviewSyncWatches({
  selectedParts, currentTab, currentPsdData, isRenderingTemplatePreview, isRendering,
  canvasRef, syncCanvasToPreview
})


</script>

<style scoped src="./ActionExpressionPage.css"></style><style scoped src="./styles/part-panels.css"></style><style scoped src="./styles/overrides.css"></style>

<!-- 全局样式：设置所有message弹窗位置为屏幕居中80% -->
<style>
/* 设置message容器位置为屏幕垂直居中 */
.n-message-container {
  top: 80% !important;
  transform: translateY(-80%);
}

/* 确保message项不受影响 */
.n-message-wrapper {
  margin-top: 0;
}
</style>
