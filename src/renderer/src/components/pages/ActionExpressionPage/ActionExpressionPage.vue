<template>
  <div class="action-expression-panel" @selectstart="handleSelectStart">
    <!-- PSD文件标签列表 -->
    <div v-if="psdFiles.length > 0" class="psd-tabs-bar">
      <div 
        class="psd-tabs-container"
        ref="psdTabsRef"
        @wheel="handlePsdTabsWheel"
      >
        <div 
          v-for="(psdFile, index) in psdFiles" 
          :key="psdFile.id"
          :class="['psd-tab-item', { active: currentPsdFile?.id === psdFile.id }]"
          @click="switchPsdFile(psdFile)"
        >
          <button 
            class="psd-tab-close"
            @click.stop="removePsdFile(psdFile.id)"
            title="移除"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <span class="psd-tab-name" :title="psdFile.name">{{ getDisplayFileName(psdFile.name) }}</span>
        </div>
      </div>
    </div>

    <!-- 顶部工具栏 -->
    <div 
      class="toolbar"
      @click="toggleCanvasPanel"
      title="点击空白区域折叠/展开画布"
    >
      <div class="toolbar-left">
        <span class="canvas-toggle-title">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <circle cx="8.5" cy="8.5" r="1.5"/>
            <path d="M21 15l-5-5L5 21"/>
          </svg>
          画布
          <span class="collapse-icon-mini" :class="{ expanded: canvasPanelExpanded }">▼</span>
        </span>
      </div>
      <div class="toolbar-actions" @click.stop>
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-checkbox 
              v-model:checked="enableCanvasHover"
              size="small"
              style="margin-right: 8px;"
            >
              预览1
            </n-checkbox>
          </template>
          开启鼠标悬浮预览效果（主画布）<br/>快捷键: {{ hotkeyLabels.toggleCanvasHover || '未设置' }}
        </n-tooltip>

        <n-tooltip placement="bottom">
          <template #trigger>
            <n-checkbox 
              v-model:checked="enablePresetHover"
              size="small"
              style="margin-right: 8px;"
            >
              预览2
            </n-checkbox>
          </template>
          开启鼠标悬浮预览效果（预设列表、模板列表）<br/>快捷键: {{ hotkeyLabels.togglePartHover || '未设置' }}
        </n-tooltip>
        
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button 
              size="small" 
              @click="handleSelectPsdFiles"
            >
              上传
            </n-button>
          </template>
          选择PSD文件进行编辑
        </n-tooltip>
        
        <n-tooltip placement="bottom">
          <template #trigger>
            <n-button 
              size="small" 
              type="primary"
              @click="openCanvasPreview"
              :disabled="!currentPsdData"
            >
              预览
            </n-button>
          </template>
          在独立窗口中查看预览
        </n-tooltip>

        <n-dropdown 
          trigger="click" 
          :options="jumpOptions"
          @select="handleJumpSelect"
          :disabled="!currentPsdData"
        >
          <n-tooltip placement="bottom">
            <template #trigger>
              <n-button 
                size="small" 
                type="primary"
                :disabled="!currentPsdData"
                :loading="isSendingToGenerate"
              >
                跳转
              </n-button>
            </template>
            跳转到其他页面并传递图片
          </n-tooltip>
        </n-dropdown>
        
        <n-dropdown 
          trigger="click" 
          :options="moreOptions"
          @select="handleMoreSelect"
        >
          <n-tooltip placement="bottom">
            <template #trigger>
              <n-button size="small">
                更多
              </n-button>
            </template>
            更多功能选项
          </n-tooltip>
        </n-dropdown>
      </div>
    </div>

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
      
      <!-- 拖拽预览（传送到body，避免父级transform影响） -->
      <teleport to="body">
        <div 
          v-if="isDragging"
          class="drag-follow-preview"
          ref="dragFollowPreview"
          :style="{ 
            left: Math.max(0, dragMouseX - dragCalibration.dx) + 'px',
            top: Math.max(0, dragMouseY - dragCalibration.dy) + 'px'
          }"
        >
          <canvas 
            ref="dragFollowCanvas" 
            width="170" 
            height="150"  
            style="pointer-events:none; width: 150px; height: 120px; border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);"
          ></canvas>
        </div>
      </teleport>

      <!-- 悬浮放大预览（传送到body，避免父级transform影响） -->
      <teleport to="body">
        <div
          v-if="hoverPreview.visible"
          class="image-hover-preview"
          :style="{
            left: hoverPreview.x + 'px',
            top: hoverPreview.y + 'px',
            width: hoverPreview.width + 'px',
            height: hoverPreview.height + 'px'
          }"
        >
          <img :src="hoverPreview.src" alt="preview" />
        </div>
      </teleport>

      <!-- 预设悬浮预览 -->
      <teleport to="body">
        <div
          v-if="presetHoverPreview.visible"
          class="preset-hover-preview"
          :style="{
            left: presetHoverPreview.x + 'px',
            top: presetHoverPreview.y + 'px',
            width: presetHoverPreview.width + 'px',
            height: presetHoverPreview.height + 'px'
          }"
        >
          <img :src="presetHoverPreview.src" alt="preset preview" />
        </div>
      </teleport>

      <!-- 模板悬浮预览 -->
      <teleport to="body">
        <div
          v-if="templateHoverPreview.visible"
          class="template-hover-preview"
          :style="{
            left: templateHoverPreview.x + 'px',
            top: templateHoverPreview.y + 'px',
            width: templateHoverPreview.width + 'px',
            height: templateHoverPreview.height + 'px'
          }"
        >
          <img :src="templateHoverPreview.src" alt="template preview" />
        </div>
      </teleport>

      <!-- 通用控制和图层结构整合面板 -->
      <div class="integrated-controls-panel">
        <div class="panel-header-tabs" @click="handleHeaderClick">
          <button 
            class="panel-tab-button"
            :class="{ active: integratedPanelTab === 'commonControls' }"
            @click="switchIntegratedPanelTab('commonControls')"
            title="通用控制"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2v20M2 12h20M17 7l-5-5-5 5M7 17l5 5 5-5"/>
            </svg>
            <span>通用</span>
          </button>
          <button 
            class="panel-tab-button"
            :class="{ active: integratedPanelTab === 'layerTree' }"
            @click="switchIntegratedPanelTab('layerTree')"
            title="图层结构"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
            </svg>
            <span>图层</span>
          </button>
          
          <!-- 工具栏：预设按钮、动作模板按钮、表情模板按钮、搜索按钮和缩放控制 -->
          <button 
            class="save-preset-button"
            @click="handleSavePreset"
            title="添加当前画布为预设"
          >
            预设
          </button>
          
          <button 
            class="save-template-button"
            @click="handleSaveTemplate1"
            title="保存当前动作配置为动作模板"
          >
            动作模板
          </button>
          
          <button 
            class="save-template-button"
            @click="handleSaveTemplate2"
            title="保存当前表情配置为表情模板"
          >
            表情模板
          </button>
          
          <button 
            class="search-preset-button"
            @click="openSearchModal"
            title="搜索动作和表情"
          >
            搜索
          </button>
          
          <div class="size-control-compact">
            <label class="size-control-label">缩放</label>
            <input 
              type="number"
              class="size-control-input"
              v-model.number="partItemSizeInput"
              min="50"
              max="400"
              step="1"
              @keyup.enter="handleSizeInputConfirm"
              @blur="handleSizeInputConfirm"
              title="输入数值后按回车或失去焦点生效"
            />
            <span class="size-control-unit">px</span>
          </div>
          
          <span 
            class="collapse-icon" 
            :class="{ expanded: !integratedPanelCollapsed }"
            @click="toggleIntegratedPanel"
            title="点击折叠/展开"
          >▼</span>
        </div>
        <transition name="panel-collapse">
          <div v-show="!integratedPanelCollapsed" class="integrated-panel-content">
            <!-- 通用控制内容 -->
            <div v-show="integratedPanelTab === 'commonControls'" class="common-controls-content">
            <div class="common-controls">
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="exclusiveMode"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>互斥</span>
                  </template>
                  勾选后，每个分组（如头部、身体等）同时只能选中一个部件
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="actionExclusiveMode"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>动作互斥</span>
                  </template>
                  勾选后，不同动作图组之间互斥
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="expressionExclusiveMode"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>表情互斥</span>
                  </template>
                  勾选后，不同表情图组之间互斥
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showFront"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>正面</span>
                  </template>
                  显示人物的正面视图
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showSide"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>侧面/侧身/侧视/侧视图</span>
                  </template>
                  显示人物的侧面、侧身或侧视图
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showBack"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>背面/背影/背身/背视/背视图/后面</span>
                  </template>
                  显示人物的背面、背影、背视图或后面
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showBackground"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>背景</span>
                  </template>
                  显示PSD文件中的背景图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showBaseLayer"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span class="warning-text">最下层(白色背景)</span>
                  </template>
                  PSD最底层的白色背景图层，通常不需要显示
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showSecondBaseLayer"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span class="warning-text">次下层(白色背景)</span>
                  </template>
                  PSD倒数第二层的白色背景，取消勾选可能影响部分图层显示
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showWeapon"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>武器</span>
                  </template>
                  显示武器图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox"
                  v-model="showBackHair"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>后发/发型后</span>
                  </template>
                  显示后发或发型后部图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showShadow"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>阴影</span>
                  </template>
                  显示阴影图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showShakeHead"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>摇摇头/摇头</span>
                  </template>
                  显示摇头动作图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showHoldSword"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>持剑</span>
                  </template>
                  显示持剑动作图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showBackHandSword"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>后手持剑</span>
                  </template>
                  显示后手持剑动作图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="showDownwardSlash"
                  @change="handleCommonControlChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>下压挥剑</span>
                  </template>
                  显示下压挥剑动作图层
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="selectHeadOnly"
                  @change="handleSelectHeadOnlyChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>选择头部</span>
                  </template>
                  开启后只显示头部（不支持长发），其他全部隐藏
                </n-tooltip>
              </label>
              <label class="control-item">
                <input 
                  type="checkbox" 
                  v-model="selectNonHead"
                  @change="handleSelectNonHeadChange"
                />
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span>选择非头部</span>
                  </template>
                  开启后隐藏头部（不支持长发），显示其他图层
                </n-tooltip>
              </label>
              <div class="control-item select-control-item">
                <n-tooltip trigger="hover">
                  <template #trigger>
                    <span class="control-label">剪切空白像素</span>
                  </template>
                  裁剪空白像素，可能导致剪映中替换图片时偏移
                </n-tooltip>
                <n-select
                  v-model:value="enableTrimWhitespace"
                  :options="[
                    { label: '不剪切', value: 'no-trim' },
                    { label: '剪切', value: 'trim' },
                    { label: '剪切水平方向', value: 'trim-horizontal' }
                  ]"
                  size="small"
                  style="width: 135px; margin-left: 8px;"
                />
              </div>
              
              <!-- 重置按钮 -->
              <button 
                class="reset-button-inline"
                @click="resetCommonControls"
                title="重置控制面板到默认状态"
              >
                重置
              </button>
            </div>
            </div>
            
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
          </div>
        </transition>
      </div>
      
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
          <div class="parts-tabs-container">
            <!-- 第1行：动作表情相关标签 -->
            <div 
              class="parts-tabs parts-tabs-row-1" 
              ref="partsTabsRow1Ref"
              @wheel="handleTabsWheel"
              @dragover="handleContainerDragOver($event, 'row1')"
              @drop="handleContainerDrop($event, 'row1')"
            >
              <button 
                v-for="tab in categorizedTabs.row1Tabs" 
                :key="tab.key"
                :class="[
                  'part-tab', 
                  { 
                    active: currentTab === tab.key,
                    'has-rendered': hasRenderedContent[tab.key],
                    'drag-over-before': dragOverTabKey === tab.key && dropPosition === 'before',
                    'drag-over-after': dragOverTabKey === tab.key && dropPosition === 'after'
                  }
                ]"
                draggable="true"
                @click="handleTabClick(tab.key)"
                @dragstart="handleTabDragStart($event, tab.key)"
                @dragend="handleTabDragEnd"
                @dragover="handleTabDragOver($event, tab.key)"
                @dragleave="handleTabDragLeave"
                @drop="handleTabDrop($event, tab.key)"
                :title="`双击可便捷取消分组内所有图层显示\n拖拽可调整顺序`"
              >
                {{ tab.label }}
              </button>
            </div>
            
            <!-- 第2行：模板、预设、上身下身 + 工具栏 -->
            <div 
              class="parts-tabs parts-tabs-row-2" 
              ref="partsTabsRow2Ref"
              @wheel="handleTabsWheel"
              @dragover="handleContainerDragOver($event, 'row2')"
              @drop="handleContainerDrop($event, 'row2')"
            >
              <button 
                v-for="tab in categorizedTabs.row2Tabs" 
                :key="tab.key"
                :class="[
                  'part-tab', 
                  { 
                    active: currentTab === tab.key,
                    'has-rendered': hasRenderedContent[tab.key],
                    'drag-over-before': dragOverTabKey === tab.key && dropPosition === 'before',
                    'drag-over-after': dragOverTabKey === tab.key && dropPosition === 'after'
                  }
                ]"
                draggable="true"
                @click="handleTabClick(tab.key)"
                @dragstart="handleTabDragStart($event, tab.key)"
                @dragend="handleTabDragEnd"
                @dragover="handleTabDragOver($event, tab.key)"
                @dragleave="handleTabDragLeave"
                @drop="handleTabDrop($event, tab.key)"
                :title="`双击可便捷取消分组内所有图层显示\n拖拽可调整顺序`"
              >
                {{ tab.label }}
              </button>
              
              <!-- 工具栏（重置和提示）放在第2行末尾 -->
              <div class="tab-management-toolbar-inline">
                <n-tooltip placement="bottom">
                  <template #trigger>
                    <button class="tab-reset-btn" @click="resetTabConfig" title="重置标签排序">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                        <path d="M21 3v5h-5"/>
                        <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/>
                        <path d="M3 21v-5h5"/>
                      </svg>
                    </button>
                  </template>
                  重置标签排序
                </n-tooltip>
                
                <span class="tab-hint">提示：拖拽标签可排序</span>
              </div>
            </div>
          </div>

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
            <template v-if="currentTab === 'presets'">
              <div v-if="presets.length === 0" class="empty-state">
                <p>暂无预设，点击"预设"按钮创建预设</p>
              </div>
              <div 
                v-for="preset in presets" 
                :key="preset.id"
                :class="[
                  'part-item',
                  'preset-item',
                  { 
                    active: selectedPresetId === preset.id,
                    'multi-selected': isPresetMultiSelected(preset.id)
                  }
                ]"
                @click="handlePresetCardClick($event, preset.id)"
                @contextmenu="handlePresetContextMenu($event, preset.id)"
                @dblclick.stop="deselectAllPresets"
              >
                <div 
                  class="part-preview"
                  @mouseenter="handlePresetHoverEnter($event, preset)"
                  @mousemove="handlePresetHoverMove"
                  @mouseleave="handlePresetHoverLeave"
                >
                  <img
                    v-if="preset.base64Image"
                    :src="preset.base64Image"
                    :alt="preset.name"
                    loading="lazy"
                    draggable="true"
                    @mouseenter="precacheImageData($event.target, { name: preset.name, displayName: preset.name })"
                    @dragstart.stop="handlePartDragStart($event, { name: preset.name, displayName: preset.name })"
                    @dragend.stop="handlePartDragEnd($event)"
                    @click.stop="handlePresetImageClick(preset.id)"
                    @mousedown.stop
                    style="cursor: grab; user-select: none;"
                    :title="`拖拽到剪映或其他软件使用（拖拽时自动命名）`"
                  />
                  <span v-else class="part-icon">🖼️</span>
                </div>
                <div class="part-info">
                  <div class="part-name">
                    <input 
                      v-if="editingPresetId === preset.id"
                      type="text"
                      class="preset-name-input"
                      :value="preset.name"
                      @click.stop
                      @blur="handlePresetNameBlur(preset.id, $event)"
                      @keyup.enter="handlePresetNameBlur(preset.id, $event)"
                    />
                    <span 
                      v-else
                      @dblclick.stop="startEditPresetName(preset.id)"
                      :title="getPresetFullDescription(preset)"
                    >
                      {{ getPresetDisplayName(preset) }}
                    </span>
                  </div>
                </div>
              </div>
            </template>
            
            <!-- 动作模板卡片展示（模板不使用虚拟滚动，因为数量较少） -->
            <template v-else-if="currentTab === 'template1'">
              <div v-if="templates1.length === 0" class="empty-state">
                <p>暂无动作模板，点击"动作模板"按钮创建</p>
              </div>
              <div 
                v-for="template in templates1" 
                :key="template.id"
                :class="[
                  'part-item',
                  'template-item',
                  'template-text-only',
                  { 
                    active: selectedTemplate1Id === template.id,
                    'multi-selected': isTemplateMultiSelected(template.id, 'template1'),
                    'template-dragging': isTemplateDragging(template.id),
                    'template-drag-over-before': isTemplateDragOver(template.id, 'before'),
                    'template-drag-over-after': isTemplateDragOver(template.id, 'after')
                  }
                ]"
                @click="handleTemplateCardClick($event, template.id, 'template1')"
                @contextmenu="handleTemplateContextMenu($event, template.id, 'template1')"
                @dragover.prevent="handleTemplateDragOver($event, template.id, 'template1')"
                @dragenter.prevent="handleTemplateDragEnter($event, template.id, 'template1')"
                @dragleave="handleTemplateDragLeave($event, template.id, 'template1')"
                @drop.prevent="handleTemplateDrop($event, template.id, 'template1')"
              >
                <!-- 只显示文字内容 -->
                <div class="template-text-content">
                  <span 
                    class="template-card-drag-handle"
                    draggable="true"
                    title="拖拽调整模板顺序"
                    @dragstart.stop="handleTemplateDragStart($event, template.id, 'template1')"
                    @dragend.stop="handleTemplateDragEnd"
                    @click.stop
                    @contextmenu.stop
                  ></span>
                  <div 
                    class="template-card-body"
                    @mouseenter="handleTemplateHoverEnter($event, template)"
                    @mousemove="handleTemplateHoverMove"
                    @mouseleave="handleTemplateHoverLeave"
                  >
                    <div 
                      class="template-card-title"
                      @dblclick="startEditTemplateNameById(template.id, 'template1')"
                      :title="template.description || template.name"
                    >
                      {{ template.name }}
                    </div>
                  </div>
                </div>
              </div>
            </template>
            
            <!-- 表情模板卡片展示（模板不使用虚拟滚动，因为数量较少） -->
            <template v-else-if="currentTab === 'template2'">
              <div v-if="templates2.length === 0" class="empty-state">
                <p>暂无表情模板，点击"表情模板"按钮创建</p>
              </div>
              <div 
                v-for="template in templates2" 
                :key="template.id"
                :class="[
                  'part-item',
                  'template-item',
                  'template-text-only',
                  { 
                    active: selectedTemplate2Id === template.id,
                    'multi-selected': isTemplateMultiSelected(template.id, 'template2'),
                    'template-dragging': isTemplateDragging(template.id),
                    'template-drag-over-before': isTemplateDragOver(template.id, 'before'),
                    'template-drag-over-after': isTemplateDragOver(template.id, 'after')
                  }
                ]"
                @click="handleTemplateCardClick($event, template.id, 'template2')"
                @contextmenu="handleTemplateContextMenu($event, template.id, 'template2')"
                @dragover.prevent="handleTemplateDragOver($event, template.id, 'template2')"
                @dragenter.prevent="handleTemplateDragEnter($event, template.id, 'template2')"
                @dragleave="handleTemplateDragLeave($event, template.id, 'template2')"
                @drop.prevent="handleTemplateDrop($event, template.id, 'template2')"
              >
                <!-- 只显示文字内容 -->
                <div class="template-text-content">
                  <span 
                    class="template-card-drag-handle"
                    draggable="true"
                    title="拖拽调整模板顺序"
                    @dragstart.stop="handleTemplateDragStart($event, template.id, 'template2')"
                    @dragend.stop="handleTemplateDragEnd"
                    @click.stop
                    @contextmenu.stop
                  ></span>
                  <div 
                    class="template-card-body"
                    @mouseenter="handleTemplateHoverEnter($event, template)"
                    @mousemove="handleTemplateHoverMove"
                    @mouseleave="handleTemplateHoverLeave"
                  >
                    <div 
                      class="template-card-title"
                      @dblclick="startEditTemplateNameById(template.id, 'template2')"
                      :title="template.description || template.name"
                    >
                      {{ template.name }}
                    </div>
                  </div>
                </div>
              </div>
            </template>

            <!-- 普通部件列表（使用虚拟滚动） -->
            <template v-else>
              <div 
                v-if="currentPartsList.length === 0" 
                class="empty-state"
              >
                <p>{{ emptyStateText }}</p>
              </div>
              <template v-else>
                <!-- 虚拟滚动占位容器 -->
                <div 
                  class="parts-virtual-spacer"
                  :style="{ height: virtualScroll.totalHeight.value + 'px' }"
                ></div>
                <!-- 虚拟滚动可见内容（绝对定位） -->
                <div 
                  class="parts-virtual-items"
                  :style="{ transform: `translateY(${virtualScroll.offsetY.value}px)` }"
                >
                  <div 
                    v-for="part in visiblePartsList" 
                    :key="part._absoluteIndex"
                    :class="[
                      'part-item', 
                      { 
                        active: isPartActive(part), 
                        hidden: part.hidden,
                        group: part.isGroup,
                        'search-highlighted': highlightedPartPath === part.path
                      }
                    ]"
                    @click="selectPart(part)"
                  >
                    <div class="part-preview">
                      <img
                        v-if="part.thumbnail"
                        :src="part.thumbnail"
                        :alt="part.name"
                        loading="lazy"
                        decoding="async"
                        draggable="true"
                        @mouseenter="precacheImageData($event.target, part)"
                        @dragstart.stop="handlePartDragStart($event, part)"
                        @dragend.stop="handlePartDragEnd($event)"
                        @click.stop="handlePartImageClick(part, selectPart)"
                        @mousedown.stop
                        style="cursor: grab; user-select: none;"
                        :title="`拖拽到剪映或其他软件使用（拖拽时自动命名）`"
                      />
                      <span v-else class="part-icon">🖼️</span>
                    </div>
                    <div class="part-info">
                      <div class="part-name">
                        <span v-if="part.isGroup" class="group-indicator">📁</span>
                        {{ part.displayName || part.name }}
                        <span v-if="part.isGroup" class="group-text">(图组)</span>
                      </div>
                    </div>
                  </div>
                </div>
              </template>
            </template>
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

    <!-- 右键菜单 -->
    <div 
      v-if="contextMenuVisible" 
      :class="[
        'template-context-menu',
        { 'detail-mode': contextMenuItemType === 'template' }
      ]"
      :style="{
        left: contextMenuPosition.x + 'px',
        top: contextMenuPosition.y + 'px'
      }"
      @click.stop
    >
      <template v-if="contextMenuItemType === 'preset'">
        <!-- 删除选项（预设） -->
        <div class="context-menu-item" @click="handleBatchDeletePresets">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6"/>
          </svg>
          <span>删除</span>
        </div>
      </template>

      <template v-else-if="contextMenuItemType === 'template' && contextMenuTemplateDetail">
        <div class="template-detail-popup">
          <div class="template-detail-header">
            <div class="template-detail-title">
              <span class="template-detail-type">{{ templateDetailTypeLabel }}</span>
              {{ contextMenuTemplateDetail.name }}
            </div>
            <button class="template-detail-close" @click="closeContextMenu" aria-label="关闭">
              ×
            </button>
          </div>

          <div class="template-detail-body">
            <div 
              v-if="templateDetailEntries.length" 
              class="template-detail-groups"
            >
              <div 
                v-for="group in templateDetailEntries" 
                :key="group.tabName" 
                class="template-detail-group"
              >
                <span class="template-detail-group-name">{{ group.tabName }}</span>
                <span class="template-detail-group-parts">{{ group.selectedParts.join('、') }}</span>
              </div>
            </div>
            <div v-else class="template-detail-empty">
              暂无具体配置
            </div>
          </div>

          <div class="template-detail-actions">
            <button 
              class="template-detail-btn primary" 
              :disabled="!contextMenuSingleItemId"
              @click="handleTemplateDetailApply"
            >
              应用
            </button>
            <button 
              class="template-detail-btn" 
              :disabled="!contextMenuSingleItemId"
              @click="handleContextMenuRename"
            >
              重命名
            </button>
            <button 
              class="template-detail-btn danger" 
              @click="handleBatchDeleteTemplates"
            >
              删除
            </button>
          </div>
        </div>
      </template>
    </div>

    <!-- 点击遮罩层关闭右键菜单 -->
    <div 
      v-if="contextMenuVisible" 
      class="context-menu-overlay"
      @click="handlePageClick"
      @contextmenu.prevent="handlePageClick"
    ></div>

  </div>
</template>

<script setup>
/**
 * 人物动作与表情编辑页面：协调 PSD 图层、部件选择、预设模板、画布预览及拖拽导出。
 */
import { ref, reactive, computed, onMounted, onUnmounted, onActivated, nextTick, h, watch, shallowRef, markRaw } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NButton, NTooltip, NDropdown, NCheckbox, useMessage, useDialog } from 'naive-ui'
import LayerTreePanel from './components/LayerTreePanel.vue'
import PartSearchModal from './components/PartSearchModal.vue'
import { 
  normalizeString, 
  sanitizeSegment, 
  getDisplayFileName, 
  generateId, 
  generatePresetName,
  generateExportFileName
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
import { useDragState } from './composables/useDragState.js'
import { useDragHandlers } from './composables/useDragHandlers.js'
import { usePartImageDrag } from './composables/usePartImageDrag.js'
import {
  useLayerTree
} from './composables/useLayerTree.js'
import { usePsdParser } from './composables/usePsdParser.js'
import { usePsdUpload } from './composables/usePsdUpload.js'
import { useTabsScroll } from './composables/useTabsScroll.js'
import { useCommonControls } from './composables/useCommonControls.js'
import { useCanvasState } from './composables/useCanvasState.js'
import { useKeyboard } from './composables/useKeyboard.js'
import { useMoreMenu } from './composables/useMoreMenu.js'
import { useCanvasRender } from './composables/useCanvasRender.js'
import { useVirtualScroll } from './composables/useVirtualScroll.js'
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
  psdTabsRef,
  handleTabsWheel,
  handlePsdTabsWheel
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

// 悬浮预览状态（与模板预览保持一致样式行为）
const hoverPreview = reactive({ visible: false, src: '', x: 0, y: 0, width: 0, height: 0 })
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

// ==================== 快捷键信息（用于展示） ====================
const HOTKEYS_STORAGE_KEY = 'hotkeys-config'
const HOTKEY_LABEL_DEFAULTS = {
  toggleCanvasHover: 'Alt+C',
  togglePartHover: 'Alt+V',
  openSearch: 'Ctrl+F'
}

const hotkeyLabels = reactive({
  toggleCanvasHover: HOTKEY_LABEL_DEFAULTS.toggleCanvasHover,
  togglePartHover: HOTKEY_LABEL_DEFAULTS.togglePartHover,
  openSearch: HOTKEY_LABEL_DEFAULTS.openSearch
})

/**
 * 更新界面中的快捷键名称。
 * 处理流程：
 * 1、优先读取传入配置，否则读取本地配置
 * 2、为缺失配置应用默认值并更新显示状态
 */
const applyHotkeyLabels = (sourceConfig = null) => {
  // 1、取得配置，并容忍本地存储内容解析失败
  let config = sourceConfig
  if (!config) {
    try {
      const stored = localStorage.getItem(HOTKEYS_STORAGE_KEY)
      config = stored ? JSON.parse(stored) : null
    } catch (error) {
      console.warn('⚠️ 解析快捷键配置失败，将使用默认展示值', error)
    }
  }
  
  /**
   * 获取单个快捷键的显示值。
   * 处理流程：
   * 1、缺失或空值回退默认配置，其余保留用户设置
   */
  const resolveValue = (key) => {
    // 1、区分未配置与用户主动清空的快捷键
    if (!config || config[key] === undefined || config[key] === null) {
      return HOTKEY_LABEL_DEFAULTS[key]
    }
    return config[key]
  }
  
  // 2、同步三项快捷键的界面展示
  hotkeyLabels.toggleCanvasHover = resolveValue('toggleCanvasHover')
  hotkeyLabels.togglePartHover = resolveValue('togglePartHover')
  hotkeyLabels.openSearch = resolveValue('openSearch')
}

applyHotkeyLabels()

/**
 * 接收快捷键配置广播。
 * 处理流程：
 * 1、把事件配置交给统一的显示更新逻辑
 */
const handleHotkeyLabelUpdate = (event) => {
  // 1、事件未携带配置时重新读取本地配置
  applyHotkeyLabels(event?.detail || null)
}

const toggleHoverHotkeyDisplay = computed(() => hotkeyLabels.toggleCanvasHover || '未设置')
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

/**
 * 打开独立画布预览窗口。
 * 处理流程：
 * 1、检查 PSD 数据并请求创建窗口
 * 2、同步主题和文件名，延迟发送画布内容
 * 3、反馈窗口创建结果
 */
const openCanvasPreview = async () => {
  // 1、未载入 PSD 时终止创建
  if (!currentPsdData.value) {
    message.warning('请先上传PSD文件')
    return
  }
  
  try {
    const result = await window.electronAPI?.invoke('canvas-preview-create')
    if (result?.success) {
      // 2、立即同步当前主题到预览窗口
      const savedTheme = localStorage.getItem('theme') || 'dark'
      await window.electronAPI?.invoke('canvas-preview-sync-theme', savedTheme)
      
      // 立即同步当前文件名
      const fileName = buildSuggestedFileName()
      await window.electronAPI?.invoke('canvas-preview-update-filename', fileName)
      
      // 延迟发送画布内容，确保预览窗口完全加载
      setTimeout(async () => {
        await syncCanvasToPreview()
      }, 300)
      
      // 3、报告窗口创建成功
      message.success('已打开预览图窗口')
    }
  } catch (error) {
    console.error('打开预览窗口失败:', error)
    message.error('打开预览窗口失败')
  }
}

/**
 * 将当前画布转换为图片并交给图像处理页面。
 * 处理流程：
 * 1、校验 PSD 和画布状态，标记发送中
 * 2、导出 PNG 并转换为数据地址
 * 3、替换待处理图片缓存并跳转页面
 * 4、反馈结果并释放发送状态
 */
const sendCanvasToGenerate = async (event) => {
  // 1、阻止事件冒泡并检查数据，避免触发画布面板折叠
  event?.stopPropagation()
  
  if (!currentPsdData.value) {
    message.warning('请先上传PSD文件')
    return
  }
  
  if (!canvasRef.value) {
    message.error('画布未就绪，请稍后再试')
    return
  }
  
  isSendingToGenerate.value = true
  console.log('[人物调整] 开始发送画布到图像处理插件')
  
  try {
    const canvas = canvasRef.value
    
    // 验证canvas有效性
    if (!canvas.width || !canvas.height) {
      message.error('画布尺寸无效')
      console.error('[人物调整] 画布尺寸无效:', { width: canvas.width, height: canvas.height })
      return
    }
    
    console.log('[人物调整] 画布尺寸:', { width: canvas.width, height: canvas.height })
    
    // 2、将画布转换为 PNG 二进制数据，再读取数据地址
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((createdBlob) => {
        if (!createdBlob) {
          reject(new Error('Blob结果为空'))
          return
        }
        resolve(createdBlob)
      }, 'image/png', 1.0)
    })
    
    if (!blob) {
      message.error('图片转换失败')
      return
    }
    
    console.log('[人物调整] Blob 创建成功，大小:', blob.size, 'bytes')
    
    // 将Blob转换为Base64 DataURL
    const reader = new FileReader()
    const dataURL = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    
    console.log('[人物调整] DataURL 转换成功，长度:', dataURL.length)
    
    // 生成文件名
    const fileName = buildSuggestedFileName() || '画布导出.png'
    console.log('[人物调整] 生成文件名:', fileName)
    
    // 3、先清除旧数据，再写入本次待处理图片并跳转
    const oldData = sessionStorage.getItem('pendingImageForGenerate')
    if (oldData) {
      console.log('[人物调整] 清除旧的待处理数据')
      sessionStorage.removeItem('pendingImageForGenerate')
    }
    
    // 将图片数据存储到 sessionStorage，供 GeneratePage 读取
    const imageData = {
      dataURL,
      fileName,
      timestamp: Date.now(),
      source: 'action-expression-canvas'
    }
    sessionStorage.setItem('pendingImageForGenerate', JSON.stringify(imageData))
    console.log('[人物调整] 新图片数据已存储到 sessionStorage，时间戳:', imageData.timestamp)
    
    // 跳转到图像处理页面
    console.log('[人物调整] 准备跳转到图像处理页面')
    await router.push('/image-processing')
    
    message.success('已发送到图像处理插件')
  } catch (error) {
    console.error('[人物调整] 发送到生成页面失败:', error)
    message.error('发送失败：' + error.message)
  } finally {
    // 4、无论成功、失败或中途返回，都释放发送状态
    isSendingToGenerate.value = false
  }
}

// =============== 画布悬浮预览（使用canvas快照） ===============
/**
 * 获取当前画布的 PNG 快照。
 * 处理流程：
 * 1、检查画布尺寸并编码，缺失或失败时返回空字符串
 */
const buildCanvasDataUrl = () => {
  // 1、仅对有效画布导出快照，编码异常交由调用方按空值处理
  try {
    const canvas = canvasRef.value
    if (!canvas || !canvas.width || !canvas.height) return ''
    // PNG 保留当前画布的无损像素内容
    return canvas.toDataURL('image/png')
  } catch (e) {
    console.warn('预览快照失败:', e)
    return ''
  }
}

/**
 * 创建主画布的悬浮预览。
 * 处理流程：
 * 1、检查开关并复制画布，裁除透明留白
 * 2、按窗口限制缩放预览尺寸
 * 3、显示预览并更新鼠标附近的位置
 */
const handleCanvasHoverEnter = (event) => {
  // 1、开关关闭或画布未就绪时跳过快照
  if (!enableCanvasHover.value) return
  if (!canvasRef.value) return
  
  try {
    // 创建临时canvas并剪切空白像素
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = canvasRef.value.width
    tempCanvas.height = canvasRef.value.height
    const tempCtx = tempCanvas.getContext('2d')
    tempCtx.drawImage(canvasRef.value, 0, 0)
    
    // 裁剪空白像素
    const trimmed = trimWhitespace(tempCanvas)
    const dataUrl = trimmed.toDataURL('image/png')
    
    // 2、计算缩放后的尺寸，保持宽高比
    const maxWidth = Math.min(window.innerWidth * 0.5, 800)
    const maxHeight = Math.min(window.innerHeight * 0.7, 600)
    
    let width = trimmed.width
    let height = trimmed.height
    
    // 按比例缩放
    if (width > maxWidth) {
      height = (maxWidth / width) * height
      width = maxWidth
    }
    if (height > maxHeight) {
      width = (maxHeight / height) * width
      height = maxHeight
    }
    
    // 3、提交预览数据并定位浮层
    hoverPreview.src = dataUrl
    hoverPreview.visible = true
    hoverPreview.width = width
    hoverPreview.height = height
    
    handleCanvasHoverMove(event)
  } catch (error) {
    console.error('生成画布预览失败:', error)
  }
}

/**
 * 更新主画布悬浮预览的位置。
 * 处理流程：
 * 1、读取预览尺寸并计算鼠标偏移位置
 * 2、约束窗口边界后写入浮层坐标
 */
const handleCanvasHoverMove = (event) => {
  // 1、隐藏时无需更新位置
  if (!hoverPreview.visible) return
  
  const gap = 12
  const width = hoverPreview.width || 400
  const height = hoverPreview.height || 300
  
  // 计算位置，确保不超出窗口
  let x = event.clientX + gap
  let y = event.clientY + gap
  
  // 2、如果右侧空间不足，显示在左侧，再约束其他边界
  if (x + width > window.innerWidth - 8) {
    x = event.clientX - width - gap
  }
  
  // 如果下方空间不足，向上调整
  if (y + height > window.innerHeight - 8) {
    y = window.innerHeight - height - 8
  }
  
  // 确保不超出左侧和顶部
  x = Math.max(8, x)
  y = Math.max(8, y)
  
  hoverPreview.x = x
  hoverPreview.y = y
}

/**
 * 隐藏主画布悬浮预览。
 * 处理流程：
 * 1、关闭浮层显示状态
 */
const handleCanvasHoverLeave = () => {
  // 1、保留快照数据，仅隐藏浮层
  hoverPreview.visible = false
}

/**
 * 同步画布内容和文件名到独立预览窗口。
 * 处理流程：
 * 1、验证画布并开始耗时记录
 * 2、优先生成 PNG 二进制载荷，失败时回退数据地址
 * 3、异步发送图片与文件名并记录编码结果
 */
const syncCanvasToPreview = async () => {
  // 1、没有画布或有效尺寸时记录跳过原因
  if (!canvasRef.value) {
    console.warn('[预览同步] Canvas引用不存在')
    logPreviewSyncTrigger('skip', { reason: 'no-canvas' })
    return
  }
  
  try {
    const canvas = canvasRef.value
    
    // 验证canvas有效性
    if (!canvas.width || !canvas.height) {
      console.warn('[预览同步] Canvas尺寸无效:', { width: canvas.width, height: canvas.height })
      logPreviewSyncTrigger('skip', { reason: 'empty-canvas' })
      return
    }
    
    const startTime = performance.now()
    let previewMeasurement = perfLogger.start('preview-sync:full', { threshold: 35 })
    
    let payload = null
    let encodingStrategy = 'blob-png'
    try {
      // 2、使用 PNG 格式保持最高画质，失败时回退数据地址
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((createdBlob) => {
          if (!createdBlob) {
            reject(new Error('Blob结果为空'))
            return
          }
          resolve(createdBlob)
        }, 'image/png', 1.0) // PNG 格式，质量1.0保持原始画质
      })
      const arrayBuffer = await blob.arrayBuffer()
      payload = {
        buffer: arrayBuffer,
        width: canvas.width,
        height: canvas.height,
        mimeType: blob.type || 'image/png'
      }
    } catch (blobError) {
      // 兜底方案：使用 PNG dataURL
      encodingStrategy = 'dataURL-png-fallback'
      console.warn('[预览同步] toBlob 失败，使用 dataURL 兜底:', blobError)
      const dataUrl = canvas.toDataURL('image/png', 1.0)
      if (!dataUrl || dataUrl.length < 100) {
        console.error('[预览同步] Canvas数据无效或为空')
        return
      }
      payload = {
        dataUrl,
        width: canvas.width,
        height: canvas.height,
        mimeType: 'image/png'
      }
    }
    
    const encodeTime = performance.now() - startTime
    console.log('[预览同步] 图像编码完成:', {
      width: canvas.width,
      height: canvas.height,
      strategy: encodingStrategy,
      byteLength: payload.buffer ? payload.buffer.byteLength : payload.dataUrl.length,
      encodeTime: `${encodeTime.toFixed(1)}ms`
    })
    
    // 3、异步发送到预览窗口并同步文件名，不等待窗口更新结果
    window.electronAPI?.invoke('canvas-preview-update', payload).then(result => {
      if (result && !result.success) {
        console.error('[预览同步] 预览窗口更新失败:', result.error)
      } else {
        const totalTime = performance.now() - startTime
        console.log(`[预览同步] ✅ 完成 (总耗时: ${totalTime.toFixed(1)}ms)`)
      }
    }).catch(err => {
      console.error('[预览同步] 发送失败:', err)
    })
    
    // 异步同步文件名（不阻塞）
    const fileName = buildSuggestedFileName()
    window.electronAPI?.invoke('canvas-preview-update-filename', fileName).catch(err => {
      console.error('[预览同步] 文件名同步失败:', err)
    })

    previewMeasurement?.end({
      strategy: encodingStrategy,
      width: canvas.width,
      height: canvas.height,
      payloadBytes: payload.buffer ? payload.buffer.byteLength : payload.dataUrl?.length || 0,
      encodeTime: Number(encodeTime.toFixed(1))
    })
    
  } catch (error) {
    console.error('[预览同步] 同步画布到预览窗口失败:', error)
    perfLogger.logEvent('preview-sync:error', { message: error?.message })
  }
}

/**
 * 切换 PSD 时重置独立预览窗口的视口。
 * 处理流程：
 * 1、发送重置命令，窗口不存在时仅记录调试信息
 */
const resetPreviewWindowViewport = async () => {
  // 1、将缩放和位置复位委托给预览窗口
  try {
    await window.electronAPI?.invoke('canvas-preview-reset-viewport')
    console.log('[预览窗口] ✅ 已发送视图重置命令')
  } catch (error) {
    // 静默失败，预览窗口可能未打开
    console.debug('[预览窗口] 视图重置调用失败（预览窗口可能未打开）:', error)
  }
}

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
// 搜索对话框显示状态
const showSearchModal = ref(false)
// 高亮显示的部件路径
const highlightedPartPath = ref(null)
// 标记是否是搜索触发的标签切换（避免触发不必要的UI交互）
const isSearchTriggeredSwitch = ref(false)
// 搜索对话框组件引用
const searchModalRef = ref(null)

/**
 * 打开部件搜索对话框。
 * 处理流程：
 * 1、检查 PSD 是否已经载入
 * 2、已打开时重置窗口位置，否则显示搜索框
 */
const openSearchModal = () => {
  // 1、搜索依赖当前 PSD 的部件列表
  if (!currentPsdData.value) {
    message.warning('请先上传PSD文件')
    return
  }
  
  // 2、如果对话框已经打开，重置位置到可见区域
  if (showSearchModal.value && searchModalRef.value) {
    searchModalRef.value.resetPosition()
    console.log('🔍 对话框已打开，重置位置到可见区域')
  } else {
    // 否则打开对话框（会自动触发位置重置）
    showSearchModal.value = true
  }
}

// 所有部件数据（用于搜索）
const allPartsForSearch = computed(() => {
  const parts = {
    action: actionParts.value,
    upperBody: upperBodyParts.value,
    lowerBody: lowerBodyParts.value,
    presets: presets.value
  }
  
  // 添加所有表情图组
  dynamicExpressionTabs.value.forEach(tab => {
    parts[tab.key] = dynamicExpressionParts.value[tab.key] || []
  })
  
  return parts
})

// 手部部件数据（用于搜索动作时的代理支持）
const handPartsForSearch = computed(() => {
  return {
    frontHandNormal: frontHandNormalParts.value,
    frontHandRight: [
      ...frontHandRightParts.value,
      ...backHandParts.value,
      ...frontLayerBackHandParts.value
    ],
    frontHandBoth: [
      ...frontHandBothParts.value,
      ...bothHandsParts.value
    ]
  }
})

// 原始手部部件数据（用于搜索时准确判断 part 的来源）
const originalHandPartsForSearch = computed(() => {
  return {
    frontHandNormal: frontHandNormalParts.value,
    frontHandRight: frontHandRightParts.value,
    backHand: backHandParts.value,
    frontLayerBackHand: frontLayerBackHandParts.value,
    frontHandBoth: frontHandBothParts.value,
    bothHands: bothHandsParts.value
  }
})

/**
 * 定位搜索结果对应的预设或部件。
 * 处理流程：
 * 1、校验目标标签并处理预设分支
 * 2、标记搜索切换，等待标签视图更新
 * 3、高亮并滚动到目标部件，延时清除高亮
 */
const handleSearchResult = async (result) => {
  // 1、忽略空结果和不能显示部件的特殊标签
  if (!result) return
  
  console.log('🔍 搜索结果:', result)
  
  // 确保不会切换到通用控制或图层结构
  const tabKey = result.tabKey
  const tabConfig = partTabs.value.find(tab => tab.key === tabKey)
  
  if (tabConfig?.isCommonControls || tabConfig?.isLayerTree) {
    console.warn('⚠️ 搜索结果指向特殊标签页，已忽略')
    message.warning('搜索结果无法显示')
    return
  }
  
  // 预设特殊处理
  if (tabKey === 'presets') {
    currentTab.value = 'presets'
    await nextTick()
    // 选中预设
    if (result.part.id) {
      selectedPresetId.value = result.part.id
      await renderAllLayers()
    }
    message.success(`已定位到预设：${result.part.displayName || result.part.name}`)
    return
  }
  
  // 2、设置搜索触发标志，防止触发不必要的界面交互
  isSearchTriggeredSwitch.value = true
  
  // 直接设置标签页（不触发handleTabClick，避免触发区域展开）
  currentTab.value = tabKey
  
  // 等待DOM更新
  await nextTick()
  
  // 重置搜索标志（在nextTick之后，确保watch已执行）
  setTimeout(() => {
    isSearchTriggeredSwitch.value = false
  }, 100)
  
  // 3、高亮显示目标部件，并滚动到列表中的对应位置
  if (result.part.path) {
    highlightedPartPath.value = result.part.path
  }
  
  // 滚动到目标部件位置
  await scrollToPartInList(result.part)
  
  // 9秒后取消高亮（延长到3倍）
  setTimeout(() => {
    highlightedPartPath.value = null
  }, 9000)
  
  message.success(`已定位到：${result.tabLabel} - ${result.part.displayName || result.part.name}`)
}

/**
 * 确认搜索结果并应用部件，对话框的关闭由子组件处理。
 * 处理流程：
 * 1、定位搜索结果并等待视图更新
 * 2、延迟应用部件，让高亮和滚动先完成
 */
const handleSearchResultConfirm = async (result) => {
  // 1、先完成标签切换与结果定位
  if (!result) return
  
  console.log('🔍 搜索结果确认应用:', result)
  
  // 先执行定位逻辑（切换标签页、高亮、滚动到目标位置）
  await handleSearchResult(result)
  
  // 等待DOM更新后应用部件
  await nextTick()
  
  // 2、延迟一小段时间确保高亮和滚动完成
  setTimeout(async () => {
    // 应用部件（实际修改图层显示状态）
    await selectPart(result.part)
    message.success(`已应用：${result.part.displayName || result.part.name}`)
  }, 200)
}

/**
 * 滚动到目标部件在列表中的位置。
 * 处理流程：
 * 1、等待列表更新并查找目标索引
 * 2、根据部件高度估算滚动距离并保留顶部余量
 */
const scrollToPartInList = async (targetPart) => {
  // 1、检查列表容器并取得当前目标索引
  if (!partsListRef.value || !targetPart) return
  
  await nextTick()
  
  // 获取当前部件列表
  const partsList = currentPartsList.value
  const targetIndex = partsList.findIndex(p => p.path === targetPart.path)
  
  if (targetIndex === -1) {
    console.warn('未在当前列表中找到目标部件')
    return
  }
  
  // 2、计算目标部件的位置并应用滚动偏移
  const itemHeight = partItemSize.value + 16 // 部件高度 + gap
  const targetScrollTop = targetIndex * itemHeight
  
  // 滚动到目标位置（留一些余量）
  partsListRef.value.scrollTop = Math.max(0, targetScrollTop - 100)
}

// 同步滑动条和输入框的值
watch(partItemSize, (newVal) => {
  partItemSizeInput.value = newVal
})

/**
 * 提交部件尺寸输入值。
 * 处理流程：
 * 1、将输入限制在允许范围，无效数字回退默认值
 * 2、同步实际尺寸与输入框值
 */
const handleSizeInputConfirm = () => {
  // 1、按现有范围校正输入值
  let value = partItemSizeInput.value
  // 确保值在有效范围内
  if (value < 50) value = 50
  if (value > 400) value = 400
  if (isNaN(value)) value = 85
  
  // 2、保持输入框与部件尺寸一致
  partItemSize.value = value
  partItemSizeInput.value = value
}

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

// ==================== 组合表情构建（眉/眼/嘴合并） ====================
/**
 * 根据部位关键词识别眉毛、眼睛或嘴巴分类。
 * 处理流程：
 * 1、规范输入并按眉、眼、嘴的顺序匹配中英文关键词
 */
const detectExpressionCategoryFromLabel = (text = '') => {
  // 1、空文本不分类，其余按固定优先级匹配
  const raw = String(text || '').trim()
  if (!raw) return null
  const lower = raw.toLowerCase()
  if (/(眉毛|眉|eyebrow|brow)/i.test(raw) || /(eyebrow|brow)/.test(lower)) return 'eyebrow'
  if (/(眼睛|眼|双眼|瞳|目|eye|pupil)/i.test(raw) || /(eye|pupil)/.test(lower)) return 'eye'
  if (/(嘴巴|嘴|嘴型|口|唇|mouth|lip)/i.test(raw) || /(mouth|lip)/.test(lower)) return 'mouth'
  return null
}

/**
 * 判断分组上下文是否描述表情。
 * 处理流程：
 * 1、排除空值并匹配表情或面部相关关键词
 */
const looksLikeExpressionContext = (text = '') => {
  // 1、以中英文表情词及面部词判定上下文
  if (!text) return false
  return /(表情|emotion|expression|神态|整脸|五官|脸|面)/i.test(text)
}

/**
 * 获取分组路径中的直接父级名称。
 * 处理流程：
 * 1、统一路径分隔符并移除空段，返回倒数第二段
 */
const getGroupParentName = (tab) => {
  // 1、优先使用原始路径，兼容反斜杠与全角斜杠
  const rawPath = tab?.originalPath || tab?.path || ''
  if (!rawPath) return ''
  const normalized = rawPath.replace(/\\/g, '/').replace(/／/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length >= 2) return parts[parts.length - 2]
  return ''
}

/**
 * 从子项名称提取用于组合匹配的基础表情名。
 * 处理流程：
 * 1、清理表情前缀、括号说明和部位后缀，清空时保留原名称
 */
const extractBaseExpressionName = (name) => {
  // 1、逐类剥离命名修饰，保留主体名称
  if (!name) return ''
  let result = String(name).trim()
  result = result.replace(/^[\s·\-_／／]*(表情[:：\- ]*)/iu, '')
  result = result.replace(/（[^）]*）/g, '')
  result = result.replace(/\([^)]*\)/g, '')
  result = result.replace(/[【】\[\]]/g, '')
  result = result.replace(/(眉毛|眉|眼睛|眼|嘴巴|嘴|口|唇|表情)$/u, '')
  result = result.replace(/[-_/—]+$/u, '')
  result = result.replace(/\s+$/u, '')
  return result || name
}

/**
 * 分析表情分组，区分组合通道和独立表情。
 * 处理流程：
 * 1、按父级和基础名称统计眉、眼、嘴通道
 * 2、结合完整组合与上下文生成每个标签的互斥元信息
 */
const buildExpressionMeta = (tabs = [], expressionsMap = {}) => {
  // 1、建立父级下各基础表情名的通道矩阵
  const metaMap = new Map()
  const parentBaseMatrix = new Map()

  /**
   * 获取并按需创建父级表情矩阵。
   * 处理流程：
   * 1、缺失时初始化映射，再返回该父级的矩阵
   */
  const ensureParentMatrix = (parent) => {
    // 1、为每个父级复用同一份通道统计
    if (!parentBaseMatrix.has(parent)) {
      parentBaseMatrix.set(parent, new Map())
    }
    return parentBaseMatrix.get(parent)
  }

  tabs.forEach(tab => {
    const parentName = getGroupParentName(tab)
    if (!parentName) return
    const category = detectExpressionCategoryFromLabel(tab.label || tab.layerName || '')
    if (!category) return
    const partsList = expressionsMap[tab.key] || []
    const baseMap = ensureParentMatrix(parentName)
    partsList.forEach(part => {
      if (!part) return
      const baseName = extractBaseExpressionName(part.displayName || part.name)
      if (!baseName) return
      if (!baseMap.has(baseName)) {
        baseMap.set(baseName, { eyebrow: false, eye: false, mouth: false })
      }
      baseMap.get(baseName)[category] = true
    })
  })

  // 2、用通道是否完整和分组语义确定标签类型
  tabs.forEach(tab => {
    const parentName = getGroupParentName(tab)
    const label = tab.label || tab.layerName || ''
    const category = detectExpressionCategoryFromLabel(label)
    const partsList = expressionsMap[tab.key] || []
    const parentMatrix = parentBaseMatrix.get(parentName)
    const contextText = `${label}|${tab.originalPath || ''}|${tab.path || ''}|${parentName}`

    let hasFullCombination = false
    if (category && parentMatrix) {
      for (const part of partsList) {
        if (!part) continue
        const baseName = extractBaseExpressionName(part.displayName || part.name)
        if (!baseName) continue
        const record = parentMatrix.get(baseName)
        if (record && record.eyebrow && record.eye && record.mouth) {
          hasFullCombination = true
          break
        }
      }
    }

    let looksExpression = looksLikeExpressionContext(contextText)
    if (!looksExpression) {
      looksExpression = partsList.some(part => 
        looksLikeExpressionContext(part?.displayName || part?.name || '')
      )
    }

    let exprType = category
    let isStandalone = false
    if (category && hasFullCombination) {
      exprType = category
    } else if (category && !hasFullCombination && looksExpression) {
      exprType = 'standalone'
      isStandalone = true
    } else if (!category && looksExpression) {
      exprType = 'standalone'
      isStandalone = true
    } else if (!category) {
      exprType = null
    }

    metaMap.set(tab.key, {
      exprType,
      baseCategory: category,
      isStandalone,
      parentName
    })
  })

  return {
    metaMap,
    parentBaseMatrix
  }
}

// 当前PSD的表情元信息分析结果
const expressionAnalysis = computed(() => {
  return buildExpressionMeta(dynamicExpressionTabs.value || [], dynamicExpressionParts.value || {})
})

// tabKey -> 元数据（包含 exprType/baseCategory/isStandalone 等）
const expressionTabMetaMap = computed(() => {
  const meta = expressionAnalysis.value.metaMap
  const plain = {}
  meta.forEach((value, key) => {
    plain[key] = value
  })
  return plain
})

// 父级 -> 基础名称 -> { eyebrow/eye/mouth }，用于组合检测
const expressionParentBaseMatrix = computed(() => expressionAnalysis.value.parentBaseMatrix)

// 组合表情的部件列表
const combinedExpressionParts = computed(() => {
  const byParent = new Map()
  /**
   * 获取父分组下的眉、眼、嘴部件容器。
   * 处理流程：
   * 1、缺失时建立三类映射，并返回可复用的父级容器
   */
  const ensureParent = (parent) => {
    // 1、每个父分组独立积累组合所需的部位
    if (!byParent.has(parent)) {
      byParent.set(parent, {
        eyebrow: new Map(),
        eye: new Map(),
        mouth: new Map()
      })
    }
    return byParent.get(parent)
  }
  /**
   * 追加同名基础表情的部件记录。
   * 处理流程：
   * 1、初始化该名称的数组并追加当前部件
   */
  const pushTo = (map, base, payload) => {
    // 1、保留同名部件的原始收集顺序
    if (!map.has(base)) map.set(base, [])
    map.get(base).push(payload)
  }

  ;(dynamicExpressionTabs.value || []).forEach(tab => {
    const meta = expressionTabMetaMap.value[tab.key]
    const category = meta?.baseCategory
    if (!category || meta?.isStandalone) return
    const parentName = meta?.parentName || getGroupParentName(tab)
    if (!parentName) return
    const store = ensureParent(parentName)
    const list = (dynamicExpressionParts.value || {})[tab.key] || []
    const localCount = new Map()
    list.forEach(part => {
      if (!part || !part.path) return
      const base = extractBaseExpressionName(part.displayName || part.name)
      const idx = (localCount.get(base) || 0) + 1
      localCount.set(base, idx)
      const entry = { groupKey: tab.key, part, baseName: base, variantIndex: idx, parentName }
      if (category === 'eyebrow') pushTo(store.eyebrow, base, entry)
      else if (category === 'eye') pushTo(store.eye, base, entry)
      else if (category === 'mouth') pushTo(store.mouth, base, entry)
    })
  })

  const eligibleParents = Array.from(byParent.keys()).filter(parent => {
    const matrix = expressionParentBaseMatrix.value.get(parent)
    if (!matrix) return false
    for (const [, flags] of matrix.entries()) {
      if (flags.eyebrow && flags.eye && flags.mouth) {
        return true
      }
    }
    return false
  })

  const parentFirstIndex = new Map()
  ;(dynamicExpressionTabs.value || []).forEach((tab, idx) => {
    const parent = getGroupParentName(tab)
    if (!parent) return
    if (!parentFirstIndex.has(parent)) parentFirstIndex.set(parent, idx)
  })
  const selectedParents = eligibleParents.slice().sort((a, b) => {
    const ia = parentFirstIndex.has(a) ? parentFirstIndex.get(a) : Number.MAX_SAFE_INTEGER
    const ib = parentFirstIndex.has(b) ? parentFirstIndex.get(b) : Number.MAX_SAFE_INTEGER
    if (ia !== ib) return ia - ib
    return a.localeCompare(b, 'zh-CN')
  })

  const result = []
  selectedParents.forEach((parent, idx) => {
    const store = byParent.get(parent)
    if (!store) return
    const baseSet = new Set([
      ...Array.from(store.eyebrow.keys()),
      ...Array.from(store.eye.keys()),
      ...Array.from(store.mouth.keys())
    ])
    const bases = Array.from(baseSet).sort((a, b) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    bases.forEach(base => {
      const eyebrowEntry = (store.eyebrow.get(base) || [])[0]
      const eyeEntry = (store.eye.get(base) || [])[0]
      const mouthEntry = (store.mouth.get(base) || [])[0]
      if (!eyebrowEntry || !eyeEntry || !mouthEntry) return
      const items = [eyebrowEntry, eyeEntry, mouthEntry].map(it => ({ groupKey: it.groupKey, part: it.part }))
      const prefix = idx === 0 ? '表情' : `表情${idx}`
      const displayName = `${prefix}_[${base}]`
      const thumb = mouthEntry.part?.thumbnail || eyeEntry.part?.thumbnail || eyebrowEntry.part?.thumbnail || null
      result.push({
        name: `${parent}:${base}|` + items.map(x => `${x.groupKey}:${x.part.path}`).join(','),
        displayName,
        isCombined: true,
        items,
        thumbnail: thumb
      })
    })
  })

  const parentOrder = new Map(selectedParents.map((p, i) => [p, i]))
  result.sort((a, b) => {
    const pa = a.name.split(':')[0]
    const pb = b.name.split(':')[0]
    const oa = parentOrder.get(pa) ?? 9999
    const ob = parentOrder.get(pb) ?? 9999
    if (oa !== ob) return oa - ob
    const ba = a.displayName.match(/_\[(.*)\]$/)?.[1] || ''
    const bb = b.displayName.match(/_\[(.*)\]$/)?.[1] || ''
    return ba.localeCompare(bb, 'zh-CN', { numeric: true })
  })

  return result
})

// 将动态表情标签增强为携带互斥信息的结构，方便界面与逻辑直接使用
const enhancedExpressionTabs = computed(() => {
  return (dynamicExpressionTabs.value || []).map(tab => {
    const meta = expressionTabMetaMap.value[tab.key] || {}
    return {
      ...tab,
      isExpression: true,
      isDynamic: true,
      exprType: meta.exprType ?? null,
      baseCategory: meta.baseCategory ?? null,
      isStandaloneExpression: !!meta.isStandalone,
      parentExpressionName: meta.parentName || getGroupParentName(tab)
    }
  })
})

// =============== 组合表情缩略图生成（遵循PSD全局z-index） ===============
const combinedThumbnailsMap = ref(new Map()) // key: signature(paths)| value: dataURL
const combinedImageCache = new Map() // imageData -> HTMLImageElement

/**
 * 加载并缓存组合缩略图所需的图片。
 * 处理流程：
 * 1、命中缓存时直接返回图片
 * 2、未命中时等待图片加载成功，再写入缓存
 */
const loadImageCached = (imageData) => {
  // 1、复用已解码的图片，减少重复加载
  if (combinedImageCache.has(imageData)) return Promise.resolve(combinedImageCache.get(imageData))
  // 2、仅缓存成功加载的图片，错误通过承诺传递
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => { combinedImageCache.set(imageData, img); resolve(img) }
    img.onerror = reject
    img.src = imageData
  })
}

/**
 * 生成与部件顺序无关的组合缩略图缓存键。
 * 处理流程：
 * 1、收集有效路径，排序后拼接为签名
 */
const getComboSignature = (items) => items.map(i => i.part?.path).filter(Boolean).sort().join('|')

/**
 * 为 PSD 图层对象建立唯一路径映射。
 * 处理流程：
 * 1、为同级重名图层补充序号
 * 2、保存完整路径并递归处理子图层
 */
const buildUniquePathMap = (layers, currentPath = '', pathMap = new Map()) => {
  // 1、每个层级独立统计重名图层
  const nameCount = new Map()
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    let uniqueName = layer.name
    if (nameCount.has(layer.name)) {
      const c = nameCount.get(layer.name)
      nameCount.set(layer.name, c + 1)
      uniqueName = `${layer.name}#${c + 1}`
    } else {
      nameCount.set(layer.name, 1)
    }
    // 2、将当前路径传给子层级，保持图层对象到路径的稳定映射
    const layerPath = currentPath ? `${currentPath}/${uniqueName}` : uniqueName
    if (!pathMap.has(layer)) pathMap.set(layer, layerPath)
    if (layer.children && layer.children.length > 0) {
      buildUniquePathMap(layer.children, layerPath, pathMap)
    }
  }
  return pathMap
}

/**
 * 按 PSD 原始坐标生成组合表情缩略图。
 * 处理流程：
 * 1、建立路径映射并收集所选分组的叶子图层
 * 2、按原始画布尺寸和图层顺序绘制图片
 * 3、裁掉透明留白并返回图片数据地址
 */
const generateCombinedThumbnail = async (items) => {
  // 1、过滤缺失数据，准备选中分组与路径映射
  if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) return null
  const rootLayers = currentPsdData.value.layerHierarchy
  const selectedGroupPaths = new Set(items.map(i => i.part?.path).filter(Boolean))
  if (selectedGroupPaths.size === 0) return null

  const pathMap = buildUniquePathMap(rootLayers)
  const leaves = []

  /**
   * 递归收集组合表情使用的叶子图层。
   * 处理流程：
   * 1、保持原始顺序递归分组
   * 2、保留属于选中路径且尺寸有效的叶子及其绘制参数
   */
  const collectLeaves = (layers) => {
    // 1、从底到顶遍历，确保绘制顺序为底层先、上层后
    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i]
      if (layer.children && layer.children.length > 0) {
        collectLeaves(layer.children)
      } else {
        const fullPath = pathMap.get(layer)
        // 2、只收集路径属于选中组且尺寸有效的叶子图层
        const belongs = Array.from(selectedGroupPaths).some(p => fullPath && fullPath.startsWith(p))
        if (!belongs) continue
        const width = layer.width || (layer.canvas ? layer.canvas.width : 0)
        const height = layer.height || (layer.canvas ? layer.canvas.height : 0)
        if (!width || !height) continue
        leaves.push({
          canvas: layer.canvas || null,
          imageData: layer.imageData || null,
          left: layer.left || 0,
          top: layer.top || 0,
          width,
          height,
          opacity: (layer.opacity !== undefined ? layer.opacity : 255) / 255
        })
      }
    }
  }

  collectLeaves(rootLayers)
  if (leaves.length === 0) return null

  // 2、先以原始 PSD 尺寸堆叠，保持绝对坐标与透明度
  const fullW = Math.max(1, currentPsdData.value.width || 0)
  const fullH = Math.max(1, currentPsdData.value.height || 0)
  const cvs = document.createElement('canvas')
  cvs.width = fullW
  cvs.height = fullH
  const ctx = cvs.getContext('2d')

  for (const lf of leaves) {
    try {
      ctx.globalAlpha = lf.opacity
      const x = lf.left
      const y = lf.top
      if (lf.canvas) {
        ctx.drawImage(lf.canvas, 0, 0, lf.canvas.width, lf.canvas.height, x, y, lf.width, lf.height)
      } else if (lf.imageData) {
        const img = await loadImageCached(lf.imageData)
        ctx.drawImage(img, 0, 0, img.width, img.height, x, y, lf.width, lf.height)
      }
      ctx.globalAlpha = 1
    } catch (e) {
      console.warn('组合缩略图绘制失败:', e)
    }
  }

  // 3、渲染完成后再进行裁剪，避免位置信息丢失
  const trimmed = trimWhitespace(cvs)
  return trimmed.toDataURL()
}

// 监听组合数据，异步生成缩略图
watch(combinedExpressionParts, async (list) => {
  if (!Array.isArray(list)) return
  for (const combo of list) {
    const sig = getComboSignature(combo.items || [])
    if (!combinedThumbnailsMap.value.has(sig)) {
      const dataURL = await generateCombinedThumbnail(combo.items || [])
      if (dataURL) {
        combinedThumbnailsMap.value.set(sig, dataURL)
      }
    }
  }
}, { immediate: true })

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

// 虚拟滚动的可见部件列表
const visiblePartsList = computed(() => {
  const allParts = currentPartsList.value
  const { start, end } = virtualScroll.getVisibleRange()
  return allParts.slice(start, end).map((part, index) => ({
    ...part,
    _virtualIndex: start + index,
    _absoluteIndex: start + index
  }))
})

// 每个分组当前显示的部件（计算属性，从图层树userVisible状态推导）
const selectedParts = computed(() => {
  const measurement = perfLogger.start('selectedParts:compute', { threshold: 12 })
  let layerNodesVisited = 0
  let matchedPartsCount = 0

  // 收集当前图层树中所有用户设置为可见的图层路径（不包括正面控制的影响）
  const visibleLayerPaths = new Set()
  /**
   * 收集用户主动设为可见的图层路径。
   * 处理流程：
   * 1、递归遍历节点，将用户可见路径加入集合并累计访问量
   */
  const collectVisiblePaths = (layers, currentPath = []) => {
    // 1、沿唯一名称拼接路径，避免通用控制覆盖用户选择状态
    if (!Array.isArray(layers)) return
    for (let layer of layers) {
      layerNodesVisited++
      const fullPath = [...currentPath, layer.uniqueName].join('/')
      // 使用userVisible而不是visible，避免正面控制影响绿色小圆点
      if (layer.userVisible) {
        visibleLayerPaths.add(fullPath)
      }
      if (layer.children && layer.children.length > 0) {
        collectVisiblePaths(layer.children, [...currentPath, layer.uniqueName])
      }
    }
  }
  collectVisiblePaths(layerTreeData.value)

  // 从可见路径中匹配部件（支持多选）
  const result = {}
  const allGroups = Object.entries(allPartsListsMap.value)
  allGroups.forEach(([groupKey, partsList]) => {
    const matchedParts = []
    for (let part of partsList || []) {
      if (part && part.path && visibleLayerPaths.has(part.path)) {
        matchedParts.push(part)
      }
    }
    matchedPartsCount += matchedParts.length
    // 如果只有一个匹配，保存为单个对象（兼容旧逻辑）
    // 如果有多个匹配，保存为数组
    if (matchedParts.length === 1) {
      result[groupKey] = matchedParts[0]
    } else if (matchedParts.length > 1) {
      result[groupKey] = matchedParts
    } else {
      result[groupKey] = null
    }
  })
  
  measurement.end({
    nodesVisited: layerNodesVisited,
    groups: allGroups.length,
    matchedParts: matchedPartsCount
  })
  return result
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

// 计算当前分组选中的部件
const selectedPart = computed(() => selectedParts.value[currentTab.value])

/**
 * 判断部件是否应呈现选中状态。
 * 处理流程：
 * 1、组合表情检查其全部子项是否匹配
 * 2、根据代理来源读取用户选择，未操作时沿用初始可见状态
 */
const isPartActive = (part) => {
  // 1、组合表情包含的所有子项均匹配时视为激活
  if (part && part.isCombined && Array.isArray(part.items)) {
    return part.items.every(({ groupKey, part: p }) => {
      const sel = selectedParts.value[groupKey]
      return sel && sel.path === p.path
    })
  }

  // 2、根据代理来源确定实际分组，并区分用户操作与默认状态
  const actualGroup = part._sourceGroup || currentTab.value
  const currentSelected = selectedParts.value[actualGroup]
  const hasInteracted = userInteracted.value[actualGroup]
  
  // 如果用户进行过手动操作
  if (hasInteracted) {
    // 只显示用户手动选中的图层
    if (!currentSelected) return false
    if (Array.isArray(currentSelected)) {
      return currentSelected.some(p => p.path === part.path)
    }
    return currentSelected.path === part.path
  }
  
  // 如果用户没有进行过手动操作，显示默认可见的图层
  return !part.hidden
}

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

// ==================== 整合面板控制（通用控制 + 图层结构） ====================
const integratedPanelCollapsed = ref(true) // 整合面板折叠状态，默认折叠
const integratedPanelTab = ref('commonControls') // 当前选中的标签页：commonControls 或 layerTree

/**
 * 切换整合面板折叠状态。
 * 处理流程：
 * 1、反转当前折叠标记
 */
const toggleIntegratedPanel = () => {
  // 1、触发面板展开或折叠
  integratedPanelCollapsed.value = !integratedPanelCollapsed.value
}

/**
 * 响应整合面板标题空白处的点击。
 * 处理流程：
 * 1、排除按钮和输入控件的点击
 * 2、切换面板折叠状态
 */
const handleHeaderClick = (event) => {
  // 1、如果点击的是按钮、输入框或其内部元素，不触发折叠或展开
  const target = event.target
  if (target.closest('.panel-tab-button') || 
      target.closest('.collapse-icon') || 
      target.closest('.save-preset-button') ||
      target.closest('.save-template-button') ||
      target.closest('.search-preset-button') ||
      target.closest('.size-control-compact')) {
    return
  }
  // 2、点击空白处触发折叠或展开
  toggleIntegratedPanel()
}

/**
 * 切换整合面板标签或收起当前标签。
 * 处理流程：
 * 1、重复点击展开中的标签时折叠，否则选中目标标签并展开
 */
const switchIntegratedPanelTab = (tab) => {
  // 1、按当前标签和展开状态决定面板的目标状态
  if (integratedPanelTab.value === tab && !integratedPanelCollapsed.value) {
    // 如果点击当前已选中的标签且面板是展开的，则折叠面板
    integratedPanelCollapsed.value = true
  } else {
    // 否则切换到点击的标签并展开面板
    integratedPanelTab.value = tab
    integratedPanelCollapsed.value = false
  }
}

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
/**
 * 根据当前控制模式与选择内容生成 PNG 文件名。
 * 处理流程：
 * 1、读取命名规则，图层树模式使用不含语义的规则
 * 2、处理侧面、背面和后面的专用名称
 * 3、收集去重后的动作名及表情名
 * 4、调用统一命名工具并追加文件扩展名
 */
function buildSuggestedFileName() {
  // 1、读取文件名规则配置，图层树模式提前生成无语义名称
  let fileNamingRule = 'timestamp-semantic' // 默认值
  try {
    const savedConfig = localStorage.getItem('stickfigure-config')
    if (savedConfig) {
      const config = JSON.parse(savedConfig)
      fileNamingRule = config.fileNamingRule || 'timestamp-semantic'
    }
  } catch (error) {
    console.warn('读取文件名规则配置失败:', error)
  }

  // ========== 图层树模式：直接返回纯时间戳或Hash，不处理任何语义 ==========
  if (controlPriority.value === 'layerTree') {
    // 将带语义的规则转换为纯规则
    if (fileNamingRule === 'timestamp-semantic') {
      fileNamingRule = 'timestamp-only'
    } else if (fileNamingRule === 'hash-semantic') {
      fileNamingRule = 'hash-only'
    }
    
    const baseFileName = generateExportFileName({
      namingRule: fileNamingRule,
      semanticInfo: { actions: [], expressions: [] },
      psdName: ''
    })
    
    return `${baseFileName}.png`
  }

  // ========== 部件控制模式：正常处理语义信息 ==========
  const psdNameRaw = currentPsdFile.value?.name || 'image'
  const psdBase = sanitizeSegment(psdNameRaw.replace(/\.(psd|PSD)$/,'') || 'image')

  // 2、侧面、背面与后面使用固定方向后缀
  if (showSide.value) {
    return `${psdBase}_侧面.png`
  }
  if (showBack.value) {
    return `${psdBase}_背面.png`
  }
  if (showRear.value) {
    return `${psdBase}_后面.png`
  }

  // 3、收集动作与表情语义，动作名称按首次出现去重
  // 使用与绿色小圆点完全相同的逻辑：遍历所有标签，检查是否有内容
  const actionNames = []
  
  // 所有可能包含动作信息的key（包括手部动作和动作图组）
  const actionKeys = [
    'frontHandNormal',    // 左手
    'frontHandRight',     // 右手
    'backHand',           // 后手（右手的代理目标）
    'frontLayerBackHand', // 前层后手（右手的代理目标）
    'frontHandBoth',      // 前手双手
    'bothHands',          // 双手（双手的代理目标）
    'action'              // 动作
  ]
  
  // 用于去重的部件名称集合
  const addedActionParts = new Set()
  
  // 检查每个动作相关的key（使用与绿色小圆点相同的逻辑）
  actionKeys.forEach(key => {
    const selected = selectedParts.value[key]
    // 只有当 selectedParts 不为 null/undefined 时才计入（与绿色小圆点逻辑一致）
    if (selected !== null && selected !== undefined) {
      // 提取部件名称（不添加前缀，由压缩函数统一处理）
      const names = Array.isArray(selected) 
        ? selected.map(p => p?.name).filter(Boolean) 
        : [selected?.name].filter(Boolean)
      
      // 添加到结果中（去重）
      names.forEach(name => {
        if (!addedActionParts.has(name)) {
          actionNames.push(name)
          addedActionParts.add(name)
        }
      })
    }
  })

  // ==================== 收集表情信息 ====================
  const expressionNames = []
  
  // 遍历所有动态表情标签页（使用与绿色小圆点相同的逻辑）
  if (dynamicExpressionTabs.value && dynamicExpressionTabs.value.length > 0) {
    dynamicExpressionTabs.value.forEach(tab => {
      const expressionKey = tab.key
      const selectedExpression = selectedParts.value[expressionKey]
      
      // 使用与绿色小圆点相同的逻辑：只检查 selectedParts 是否为 null/undefined
      // 只有当该表情图组有内容（绿色小圆点亮起）时才计入文件名
      if (selectedExpression !== null && selectedExpression !== undefined) {
        // 收集选中的表情名称
        if (Array.isArray(selectedExpression)) {
          selectedExpression.forEach(exp => {
            if (exp?.name) {
              expressionNames.push(exp.name)
            }
          })
        } else if (selectedExpression?.name) {
          expressionNames.push(selectedExpression.name)
        }
      }
    })
  }

  // 4、按选择的规则生成基础文件名并追加 PNG 扩展名
  const semanticInfo = {
    actions: actionNames,
    expressions: expressionNames
  }

  const baseFileName = generateExportFileName({
    namingRule: fileNamingRule,
    semanticInfo,
    psdName: psdBase
  })

  return `${baseFileName}.png`
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

// 标签页配置（手部图层使用代理机制，表情图组动态生成）
const partTabs = computed(() => {
  
  // 预设标签页（放在最后面）
  const presetTab = [
    { key: 'presets', label: '预设', isPreset: true }
  ]
  
  // 模板标签页（动作模板和表情模板，放在预设后面）
  const templateTabs = [
    { key: 'template1', label: '动作模板', isTemplate: true, templateType: 'actionTemplate' },
    { key: 'template2', label: '表情模板', isTemplate: true, templateType: 'expressionTemplate' }
  ]
  
  const baseTabs = [
    { key: 'frontHandNormal', label: '左手' },
    { key: 'frontHandRight', label: '右手', proxyTargets: ['backHand', 'frontLayerBackHand'] },
    { key: 'frontHandBoth', label: '双手', proxyTargets: ['bothHands'] },
    { key: 'action', label: '动作' }
  ]
  
  // 动态添加前手标签页
  const frontHandDynamicTabs = dynamicFrontHandTabs.value.map(tab => ({
    key: tab.key,
    label: tab.label,
    groupType: 'frontHand',
    isDynamic: true
  }))
  
  // 动态添加后手标签页
  const backHandDynamicTabs = dynamicBackHandTabs.value.map(tab => ({
    key: tab.key,
    label: tab.label,
    groupType: 'backHand',
    isDynamic: true
  }))
  
  // 动态添加双手标签页
  const bothHandsDynamicTabs = dynamicBothHandsTabs.value.map(tab => ({
    key: tab.key,
    label: tab.label,
    groupType: 'bothHands',
    isDynamic: true
  }))
  
  // 动态添加表情标签页（使用增强后的元信息）
  const expressionTabs = enhancedExpressionTabs.value

  // 组合表情标签（放在所有表情标签的最前面）
  const combinedTab = combinedExpressionParts.value.length > 0
    ? [{ key: 'combinedExpressions', label: '组合表情', isExpression: true, isDynamic: true, isCombinedExpression: true, exprType: 'combined' }]
    : []
  
  const endTabs = [
    { key: 'upperBody', label: '上身' },
    { key: 'lowerBody', label: '下身' }
  ]
  
  // 注意：前手、后手、双手的动态标签已禁用，使用代理机制整合到基础标签
  // 注意：动作、上身、下身不支持多实例，始终显示基础标签
  return [
    ...baseTabs,              // 左手、右手、双手、动作等基础标签
    ...frontHandDynamicTabs,  // 已在解析阶段设为空数组
    ...backHandDynamicTabs,   // 已在解析阶段设为空数组
    ...bothHandsDynamicTabs,  // 已在解析阶段设为空数组
    ...combinedTab,           // 组合表情（优先显示在表情标签最前）
    ...expressionTabs,        // 表情标签
    ...endTabs,               // 上身、下身标签
    ...presetTab,             // 预设标签页在最后面
    ...templateTabs           // 动作模板和表情模板标签页在预设后面
  ]
})

// 收集所有部件列表（用于反向同步：图层树 → 部件选择）
const allPartsListsMap = computed(() => {
  const map = {}
  
  // 静态分组
  map.frontHandNormal = frontHandNormalParts.value || []
  map.frontHandRight = frontHandRightParts.value || []
  map.frontHandBoth = frontHandBothParts.value || []
  map.backHand = backHandParts.value || []
  map.frontLayerBackHand = frontLayerBackHandParts.value || []
  map.bothHands = bothHandsParts.value || []
  map.upperBody = upperBodyParts.value || []
  map.lowerBody = lowerBodyParts.value || []
  map.action = actionParts.value || []
  
  // 动态分组
  Object.entries(dynamicExpressionParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicFrontHandParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicBackHandParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicBothHandsParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicUpperBodyParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicLowerBodyParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  Object.entries(dynamicActionParts.value || {}).forEach(([key, parts]) => {
    map[key] = parts
  })
  // 组合表情
  map.combinedExpressions = combinedExpressionParts.value || []
  
  return map
})

// 基于PSD是否存在图层组的映射
const groupExistsMap = computed(() => {
  const rootLayers = currentPsdData.value?.layerHierarchy || []
  /**
   * 判断 PSD 是否存在指定名称的有效图组。
   * 处理流程：
   * 1、规范候选名称后深度遍历图层树，返回是否命中
   */
  const exists = (names) => {
    // 1、以候选名称集合检查原始图层层级
    // 使用normalizeString规范化配置名称（统一中英文标点符号）
    const targets = names.map(n => normalizeString(n))
    /**
     * 深度查找符合候选名称的图组。
     * 处理流程：
     * 1、检查当前节点名称及内容，未命中时递归子节点
     */
    const dfs = (layers) => {
      // 1、在当前层级与后代中寻找有效分组
      for (const layer of layers) {
        // 使用normalizeString规范化图层名称
        const lname = normalizeString(layer.name || '')
        if (targets.includes(lname)) return true
        if (layer.children && layer.children.length > 0) {
          if (dfs(layer.children)) return true
        }
      }
      return false
    }
    return dfs(rootLayers)
  }
  
  // 获取自定义图组名称配置
  const customGroupNames = getCustomGroupNames()
  
  // 前手分组存在性检查：只要前手图层组存在且有内容，三个子分组就都可用
  const hasFrontHand = exists(customGroupNames.frontHand)
  const hasBackHand = exists(customGroupNames.backHand)
  const hasBothHands = exists(customGroupNames.bothHands)
  const hasUpperBody = exists(customGroupNames.upperBody)
  const hasLowerBody = exists(customGroupNames.lowerBody)
  const hasAction = exists(customGroupNames.action)
  
  // 右手标签：前手-右手、后手、前层后手任一存在即可显示
  const hasRightHandContent = (hasFrontHand && frontHandRightParts.value.length > 0) || 
                               hasBackHand || 
                               frontLayerBackHandParts.value.length > 0
  
  // 双手标签：前手内的双手动作 或 独立的双手图层组 任一存在即可显示（代理模式）
  const hasBothHandContent = (hasFrontHand && frontHandBothParts.value.length > 0) || 
                              hasBothHands || 
                              bothHandsParts.value.length > 0
  
  const result = {
    presets: true, // 预设标签页始终存在
    template1: true, // 动作模板标签页始终存在
    template2: true, // 表情模板标签页始终存在
    frontHandNormal: hasFrontHand && frontHandNormalParts.value.length > 0,
    frontHandRight: hasRightHandContent,
    frontHandBoth: hasBothHandContent,
    backHand: false, // 后手已合并到右手，不再作为独立标签
    frontLayerBackHand: false, // 前层后手已合并到右手，不再作为独立标签
    bothHands: false, // 双手已合并到frontHandBoth，不再作为独立标签
    upperBody: hasUpperBody,
    lowerBody: hasLowerBody,
    action: hasAction
  }
  
  // 动态添加表情图组的存在性检查
  dynamicExpressionTabs.value.forEach(tab => {
    result[tab.key] = dynamicExpressionParts.value[tab.key]?.length > 0
  })
  // 组合表情存在性
  result['combinedExpressions'] = combinedExpressionParts.value.length > 0
  
  // 动态添加其他分组的存在性检查（仅前手、后手、双手，已禁用，保留代码兼容性）
  dynamicFrontHandTabs.value.forEach(tab => {
    result[tab.key] = dynamicFrontHandParts.value[tab.key]?.length > 0
  })
  dynamicBackHandTabs.value.forEach(tab => {
    result[tab.key] = dynamicBackHandParts.value[tab.key]?.length > 0
  })
  dynamicBothHandsTabs.value.forEach(tab => {
    result[tab.key] = dynamicBothHandsParts.value[tab.key]?.length > 0
  })
  // 注意：动作、上身、下身不支持动态标签，已移除
  
  return result
})

/**
 * 选择当前 PSD 的默认部件标签。
 * 处理流程：
 * 1、优先返回存在渲染内容的标签
 * 2、回退到存在分组的标签或默认前手标签
 */
const getFirstDefaultTabKey = () => {
  // 1、按候选顺序优先检查当前可见内容，再回退可用分组
  // 优先选择有渲染内容的标签页（跳过图层结构、控制面板、预设和模板标签页）
  const firstWithContent = partTabs.value.find(tab => 
    !tab.isLayerTree && !tab.isCommonControls && !tab.isPreset && !tab.isTemplate && hasRenderedContent.value[tab.key]
  )
  if (firstWithContent) return firstWithContent.key
  
  // 选择第一个存在的分组（跳过图层结构、控制面板、预设和模板标签页）
  const firstExisting = partTabs.value.find(tab => 
    !tab.isLayerTree && !tab.isCommonControls && !tab.isPreset && !tab.isTemplate && groupExistsMap.value[tab.key]
  )
  if (firstExisting) return firstExisting.key
  
  // 默认选中左手
  return 'frontHandNormal'
}

// 过滤出可见的标签页：仅当PSD中存在该分组时显示
//（不存在的分组完全隐藏；存在但无默认可见内容的分组仍显示，但无绿色小圆点）
const visiblePartTabs = computed(() => {
  return partTabs.value.filter(tab => groupExistsMap.value[tab.key])
})

// ==================== 标签管理：拖拽排序、重置 ====================
// 标签配置状态（运行时状态，不持久化）
const tabConfig = ref({
  customOrder: null // 自定义排序数组，null表示使用默认排序
})

// 标签初始化排序标记（运行时状态，不持久化）
const initialSorted = ref(false)

// 标签初始化排序缓存（运行时状态，不持久化）
const initialTabOrder = ref({
  row1: null,
  row2: null
})

/**
 * 恢复标签的默认排序。
 * 处理流程：
 * 1、清除自定义顺序及首次排序缓存
 * 2、根据原有排序状态反馈结果
 */
const resetTabConfig = () => {
  // 1、清空运行时排序信息，让计算属性重新建立默认顺序
  const hadCustomOrder = tabConfig.value.customOrder !== null
  
  tabConfig.value = {
    customOrder: null
  }
  // 清除缓存和排序标记，强制重新计算排序
  initialSorted.value = false
  initialTabOrder.value = {
    row1: null,
    row2: null
  }
  
  // 2、区分实际重置和原本已经使用默认顺序
  if (hadCustomOrder) {
    message.success('标签排序已重置')
  } else {
    message.info('标签已是默认排序')
  }
}

/**
 * 保存当前页面的标签自定义顺序。
 * 处理流程：
 * 1、将标签键数组写入运行时配置
 */
const setCustomOrder = (orderedKeys) => {
  // 1、顺序仅保存在当前页面状态中
  tabConfig.value.customOrder = orderedKeys
}

// 拖拽相关状态
const draggedTabKey = ref(null)
const dragOverTabKey = ref(null)
const dropPosition = ref(null) // 'before' 或 'after'

/**
 * 开始拖动部件标签。
 * 处理流程：
 * 1、记录来源标签并声明移动数据
 * 2、降低来源元素透明度作为拖拽反馈
 */
const handleTabDragStart = (event, tabKey) => {
  // 1、记录本次标签拖拽来源
  draggedTabKey.value = tabKey
  event.dataTransfer.effectAllowed = 'move'
  event.dataTransfer.setData('text/plain', tabKey)
  // 2、添加视觉反馈
  event.target.style.opacity = '0.5'
}

/**
 * 结束标签拖拽并清理反馈。
 * 处理流程：
 * 1、恢复透明度并清空来源、目标与插入位置
 */
const handleTabDragEnd = (event) => {
  // 1、成功放置或取消拖拽都执行相同清理
  event.target.style.opacity = '1'
  draggedTabKey.value = null
  dragOverTabKey.value = null
  dropPosition.value = null
}

/**
 * 更新标签上的拖拽插入提示。
 * 处理流程：
 * 1、允许移动并记录目标标签
 * 2、按鼠标位于目标左右半区决定前插或后插
 */
const handleTabDragOver = (event, tabKey) => {
  // 1、允许放置到当前标签
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  dragOverTabKey.value = tabKey
  
  // 2、计算鼠标相对于目标元素的位置
  const rect = event.currentTarget.getBoundingClientRect()
  const mouseX = event.clientX
  const elementCenterX = rect.left + rect.width / 2
  
  // 如果鼠标在元素左半部分，插入到之前；否则插入到之后
  dropPosition.value = mouseX < elementCenterX ? 'before' : 'after'
}

/**
 * 清除离开标签后的插入提示。
 * 处理流程：
 * 1、清空目标标签和插入位置
 */
const handleTabDragLeave = () => {
  // 1、保留来源拖拽状态，仅清理悬停反馈
  dragOverTabKey.value = null
  dropPosition.value = null
}

/**
 * 将拖动标签插入目标标签前后。
 * 处理流程：
 * 1、校验来源并取得当前顺序
 * 2、移除来源后按插入方向重新插入
 * 3、保存排序并清理目标提示
 */
const handleTabDrop = (event, targetTabKey) => {
  // 1、忽略无来源和放置回自身的情况
  event.preventDefault()
  
  if (!draggedTabKey.value || draggedTabKey.value === targetTabKey) {
    return
  }
  
  // 获取当前所有标签（合并两行）
  const allTabs = [...categorizedTabs.value.row1Tabs, ...categorizedTabs.value.row2Tabs]
  const allKeys = allTabs.map(t => t.key)
  
  // 如果没有自定义排序，使用当前排序初始化
  const currentOrder = tabConfig.value.customOrder || allKeys
  
  // 2、先移除来源标签，避免插入后出现重复项
  const newOrder = currentOrder.filter(key => key !== draggedTabKey.value)
  
  // 找到目标位置
  const targetIndex = newOrder.indexOf(targetTabKey)
  
  // 根据dropPosition决定插入位置
  if (dropPosition.value === 'before') {
    // 插入到目标之前
    newOrder.splice(targetIndex, 0, draggedTabKey.value)
  } else {
    // 插入到目标之后
    newOrder.splice(targetIndex + 1, 0, draggedTabKey.value)
  }
  
  // 3、保存新顺序并清理目标提示
  setCustomOrder(newOrder)
  
  dragOverTabKey.value = null
  dropPosition.value = null
}

/**
 * 更新标签行空白区域的拖拽提示。
 * 处理流程：
 * 1、排除由标签自身处理的事件
 * 2、按鼠标位置选择该行开头或末尾
 */
const handleContainerDragOver = (event, rowType) => {
  // 1、如果拖拽经过的是标签按钮，交给标签自身处理
  if (event.target.classList.contains('part-tab')) {
    return
  }
  
  event.preventDefault()
  event.dataTransfer.dropEffect = 'move'
  
  // 2、获取容器位置并判断应放在行首还是行尾
  const rect = event.currentTarget.getBoundingClientRect()
  const mouseX = event.clientX
  const containerCenterX = rect.left + rect.width / 2
  
  // 根据鼠标位置决定插入到最前面还是最后面
  dropPosition.value = mouseX < containerCenterX ? 'first' : 'last'
  dragOverTabKey.value = `container-${rowType}`
}

/**
 * 将拖动标签放到指定行的开头或末尾。
 * 处理流程：
 * 1、过滤标签事件并检查拖拽来源
 * 2、移除来源，按目标行边界重新插入
 * 3、保存顺序并清理插入提示
 */
const handleContainerDrop = (event, rowType) => {
  // 1、如果放置目标是标签按钮，交给标签自身处理
  if (event.target.classList.contains('part-tab')) {
    return
  }
  
  event.preventDefault()
  
  if (!draggedTabKey.value) {
    return
  }
  
  // 获取当前所有标签
  const allTabs = [...categorizedTabs.value.row1Tabs, ...categorizedTabs.value.row2Tabs]
  const allKeys = allTabs.map(t => t.key)
  
  // 如果没有自定义排序，使用当前排序初始化
  const currentOrder = tabConfig.value.customOrder || allKeys
  
  // 移除拖拽的标签
  const newOrder = currentOrder.filter(key => key !== draggedTabKey.value)
  
  // 2、获取对应行的标签，选择行首、行尾或空行落点
  const rowTabs = rowType === 'row1' ? categorizedTabs.value.row1Tabs : categorizedTabs.value.row2Tabs
  
  if (rowTabs.length === 0) {
    // 如果该行没有标签，直接添加到末尾
    newOrder.push(draggedTabKey.value)
  } else if (dropPosition.value === 'first') {
    // 插入到该行第一个标签之前
    const firstTabKey = rowTabs[0].key
    const firstIndex = newOrder.indexOf(firstTabKey)
    newOrder.splice(firstIndex, 0, draggedTabKey.value)
  } else {
    // 插入到该行最后一个标签之后
    const lastTabKey = rowTabs[rowTabs.length - 1].key
    const lastIndex = newOrder.indexOf(lastTabKey)
    newOrder.splice(lastIndex + 1, 0, draggedTabKey.value)
  }
  
  // 3、保存新顺序并清理插入提示
  setCustomOrder(newOrder)
  
  dragOverTabKey.value = null
  dropPosition.value = null
}

// 将可见标签页分类为2行
const categorizedTabs = computed(() => {
  const tabs = visiblePartTabs.value
  
  // 如果没有标签，返回空数组
  if (tabs.length === 0) {
    return {
      row1Tabs: [],
      row2Tabs: []
    }
  }
  
  // 如果已经有缓存且缓存中有数据，使用缓存（避免闪烁）
  if (initialSorted.value && initialTabOrder.value.row1 && initialTabOrder.value.row1.length > 0) {
    // 使用缓存的顺序，只应用隐藏和自定义拖拽排序
    let row1Tabs = initialTabOrder.value.row1.filter(tab => tabs.some(t => t.key === tab.key))
    let row2Tabs = initialTabOrder.value.row2.filter(tab => tabs.some(t => t.key === tab.key))
    
    // 应用自定义排序
    if (tabConfig.value.customOrder && tabConfig.value.customOrder.length > 0) {
      const customOrder = tabConfig.value.customOrder
      /**
       * 按用户顺序重排已缓存的一行标签。
       * 处理流程：
       * 1、有自定义位置的标签优先，未配置标签保持相对顺序
       */
      const sortByCustomOrder = (tabsArray) => {
        // 1、复制数组后排序，避免改变首次排序缓存
        return [...tabsArray].sort((a, b) => {
          const aIndex = customOrder.indexOf(a.key)
          const bIndex = customOrder.indexOf(b.key)
          
          if (aIndex !== -1 && bIndex !== -1) {
            return aIndex - bIndex
          }
          if (aIndex !== -1) return -1
          if (bIndex !== -1) return 1
          return 0
        })
      }
      
      row1Tabs = sortByCustomOrder(row1Tabs)
      row2Tabs = sortByCustomOrder(row2Tabs)
    }
    
    return {
      row1Tabs,
      row2Tabs
    }
  }
  
  // 首次初始化：进行智能排序
  // 新的分行逻辑：
  // 第1行：动作表情相关标签（手部、动作、表情、组合表情）
  // 第2行：模板、预设、上身下身、控制面板、图层结构
  
  /**
   * 判断标签是否属于上下身分类。
   * 处理流程：
   * 1、匹配上身或下身标签键
   */
  const isUpperLower = (t) => t.key === 'upperBody' || t.key === 'lowerBody'
  /**
   * 判断标签是否属于手部分类。
   * 处理流程：
   * 1、结合分组类型与固定手部键识别手部标签
   */
  const isHand = (t) => t.groupType === 'frontHand' || t.groupType === 'backHand' || t.groupType === 'bothHands' ||
    ['frontHandNormal','frontHandRight','frontHandBoth','backHand','frontLayerBackHand','bothHands'].includes(t.key)
  /**
   * 判断标签是否属于动作表情区域。
   * 处理流程：
   * 1、合并表情、组合表情、手部和动作的分类条件
   */
  const isActionExpression = (t) => t.isExpression || t.isCombinedExpression || t.key === 'combinedExpressions' || isHand(t) || t.key === 'action'
  
  const expressions = tabs.filter(t => t.isExpression && t.key !== 'combinedExpressions')
  const combinedExpr = tabs.filter(t => t.key === 'combinedExpressions' || t.isCombinedExpression)
  const handAndAction = tabs.filter(t => isHand(t) || t.key === 'action')
  const presets = tabs.filter(t => t.isPreset)
  const templates = tabs.filter(t => t.isTemplate)
  const uppersLowers = tabs.filter(isUpperLower)
  const specials = tabs.filter(t => t.isCommonControls || t.isLayerTree)
  const alreadyUsed = new Set([...handAndAction, ...combinedExpr, ...expressions, ...presets, ...templates, ...uppersLowers, ...specials].map(t => t.key))
  const others = tabs.filter(t => !alreadyUsed.has(t.key))

  // 第1行：动作表情相关标签
  // 手部标签（左手、右手、双手）始终固定在开头，不参与排序
  const handTabs = handAndAction
  
  // 其他动作表情标签（组合表情、普通表情）按绿色小圆点排序
  const otherActionExpressionTabs = [...combinedExpr, ...expressions]
  const row1WithContent = otherActionExpressionTabs.filter(t => hasRenderedContent.value[t.key])
  const row1WithoutContent = otherActionExpressionTabs.filter(t => !hasRenderedContent.value[t.key])
  
  // 拼接：手部标签始终在前 + 有内容的其他标签 + 无内容的其他标签
  let row1Tabs = [...handTabs, ...row1WithContent, ...row1WithoutContent]
  
  // 第2行：模板 -> 预设 -> 上身下身 -> 其他 -> 控制面板/图层
  let row2Tabs = [...templates, ...presets, ...uppersLowers, ...others, ...specials]
  
  // 如果有自定义排序，应用自定义排序
  if (tabConfig.value.customOrder && tabConfig.value.customOrder.length > 0) {
    const customOrder = tabConfig.value.customOrder
    /**
     * 对首次生成的标签行应用用户排序。
     * 处理流程：
     * 1、按自定义键位置比较，未配置标签保持相对顺序
     */
    const sortByCustomOrder = (tabsArray) => {
      // 1、复制数组后应用排序，不改变原始分类结果
      return [...tabsArray].sort((a, b) => {
        const aIndex = customOrder.indexOf(a.key)
        const bIndex = customOrder.indexOf(b.key)
        
        // 如果两个都在自定义排序中，按自定义顺序
        if (aIndex !== -1 && bIndex !== -1) {
          return aIndex - bIndex
        }
        // 如果只有a在自定义排序中，a排前面
        if (aIndex !== -1) return -1
        // 如果只有b在自定义排序中，b排前面
        if (bIndex !== -1) return 1
        // 都不在自定义排序中，保持原顺序
        return 0
      })
    }
    
    row1Tabs = sortByCustomOrder(row1Tabs)
    row2Tabs = sortByCustomOrder(row2Tabs)
  }
  
  // 只在有标签时才缓存和标记（避免缓存空数据）
  if (row1Tabs.length > 0 || row2Tabs.length > 0) {
    initialTabOrder.value = {
      row1: row1Tabs,
      row2: row2Tabs
    }
    initialSorted.value = true
  }
  
  return {
    row1Tabs,  // 第1行：动作表情
    row2Tabs   // 第2行：模板、预设、上身下身等
  }
})
// 判断某个图组是否有渲染内容（从图层树visible状态判断）
const hasRenderedContent = computed(() => {
  const result = {}
  partTabs.value.forEach(tab => {
    // 图层结构标签页：不显示绿色小圆点
    if (tab.isLayerTree) {
      result[tab.key] = false
      return
    }
    
    // 控制面板标签页：始终不显示绿色小圆点
    if (tab.isCommonControls) {
      result[tab.key] = false
      return
    }
    
    // 预设标签页：有预设且有选中的预设时显示绿色小圆点
    if (tab.isPreset) {
      result[tab.key] = presets.value.length > 0 && selectedPresetId.value !== null
      return
    }
    
    // 模板标签页：有对应模板且有选中时显示绿色小圆点
    if (tab.isTemplate) {
      if (tab.key === 'template1') {
        result[tab.key] = templates1.value.length > 0 && selectedTemplate1Id.value !== null
      } else if (tab.key === 'template2') {
        result[tab.key] = templates2.value.length > 0 && selectedTemplate2Id.value !== null
      }
      return
    }
    
    // 检查该分组是否有显示的部件（从selectedParts计算属性读取）
    const selected = selectedParts.value[tab.key]
    let mainHasContent = selected !== null && selected !== undefined
    
    // 检查代理目标是否有内容
    let proxyHasContent = false
    if (tab.proxyTargets && tab.proxyTargets.length > 0) {
      proxyHasContent = tab.proxyTargets.some(proxyTarget => {
        const proxySelected = selectedParts.value[proxyTarget]
        return proxySelected !== null && proxySelected !== undefined
      })
    }
    
    // 只要主分组或代理目标有内容，就显示绿点
    result[tab.key] = mainHasContent || proxyHasContent
  })
  return result
})

// 当前标签页的部件列表（支持代理机制合并）
const currentPartsList = computed(() => {
  const currentTabKey = currentTab.value
  
  // 查找当前标签页配置
  const currentTabConfig = partTabs.value.find(tab => tab.key === currentTabKey)
  
  // 获取基础图层列表
  let baseParts = []
  let proxyParts = []
  
  // 先检查是否是动态表情图组
  if (currentTabConfig?.isExpression && dynamicExpressionParts.value[currentTabKey]) {
    baseParts = dynamicExpressionParts.value[currentTabKey]
  } 
  // 组合表情
  else if (currentTabKey === 'combinedExpressions') {
    // 为组合表情注入合成缩略图
    baseParts = (combinedExpressionParts.value || []).map(item => {
      const sig = getComboSignature(item.items || [])
      const thumb = combinedThumbnailsMap.value.get(sig) || item.thumbnail || null
      return { ...item, thumbnail: thumb }
    })
  }
  // 检查是否是动态分组（只检查动态标签，基础标签走 switch）
  // 注意：仅前手、后手、双手支持动态分组（已禁用），动作、上身、下身不支持
  else if (currentTabConfig?.isDynamic) {
    // 动态分组根据 groupType 获取对应数据
    if (currentTabConfig.groupType === 'frontHand' && dynamicFrontHandParts.value[currentTabKey]) {
      baseParts = dynamicFrontHandParts.value[currentTabKey]
    }
    else if (currentTabConfig.groupType === 'backHand' && dynamicBackHandParts.value[currentTabKey]) {
      baseParts = dynamicBackHandParts.value[currentTabKey]
    }
    else if (currentTabConfig.groupType === 'bothHands' && dynamicBothHandsParts.value[currentTabKey]) {
      baseParts = dynamicBothHandsParts.value[currentTabKey]
    }
  } 
  else {
    // 否则使用固定的switch分支
    switch (currentTabKey) {
      case 'frontHandNormal':
        baseParts = frontHandNormalParts.value
        break
      case 'frontHandRight':
        // 前手右手 + 后手 + 前层后手 = 右手（代理机制，支持多个数据源）
        baseParts = frontHandRightParts.value.map(part => ({
          ...part,
          displayName: `前手-${part.name}`,
          _sourceGroup: 'frontHandRight'
        }))
        // 合并所有代理目标的部件
        if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
          currentTabConfig.proxyTargets.forEach(proxyTarget => {
            let targetParts = []
            let targetLabel = ''
            
            switch (proxyTarget) {
              case 'backHand':
                targetParts = backHandParts.value
                targetLabel = '后手'
                break
              case 'frontLayerBackHand':
                targetParts = frontLayerBackHandParts.value
                targetLabel = '前层后手'
                break
            }
            
            const mappedParts = targetParts.map(part => ({
              ...part,
              displayName: `${targetLabel}-${part.name}`,
              _sourceGroup: proxyTarget
            }))
            
            proxyParts = proxyParts.concat(mappedParts)
          })
        }
        break
      case 'frontHandBoth':
        // 前手双手 + 双手 = 双手（代理机制）
        baseParts = frontHandBothParts.value.map(part => ({
          ...part,
          displayName: `前手-${part.name}`,
          _sourceGroup: 'frontHandBoth'
        }))
        // 合并所有代理目标的部件
        if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
          currentTabConfig.proxyTargets.forEach(proxyTarget => {
            if (proxyTarget === 'bothHands') {
              const mappedParts = bothHandsParts.value.map(part => ({
                ...part,
                displayName: `双手-${part.name}`,
                _sourceGroup: 'bothHands'
              }))
              proxyParts = proxyParts.concat(mappedParts)
            }
          })
        }
        break
      case 'backHand':
        baseParts = backHandParts.value
        break
      case 'frontLayerBackHand':
        baseParts = frontLayerBackHandParts.value
        break
      case 'bothHands':
        baseParts = bothHandsParts.value
        break
      case 'upperBody':
        baseParts = upperBodyParts.value
        break
      case 'lowerBody':
        baseParts = lowerBodyParts.value
        break
      case 'action':
        baseParts = actionParts.value
        break
      default:
        baseParts = []
    }
  }
  
  // 合并基础图层和代理图层
  const result = [...baseParts, ...proxyParts]
  
  // 同步虚拟滚动的总项目数
  nextTick(() => {
    virtualScroll.totalItems.value = result.length
  })
  
  return result
})

// 空状态文本
const emptyStateText = computed(() => {
  if (!currentPsdData.value) {
    return '请先上传PSD文件'
  }
  
  // 先查找是否是动态表情图组
  const expressionTab = dynamicExpressionTabs.value.find(tab => tab.key === currentTab.value)
  if (expressionTab) {
    return `暂无${expressionTab.label}部件`
  }
  if (currentTab.value === 'combinedExpressions') {
    return '暂无可组合的表情（眉/眼/嘴）'
  }
  
  // 查找其他动态分组（仅前手、后手、双手，已禁用，保留代码兼容性）
  const allDynamicTabs = [
    ...dynamicFrontHandTabs.value,
    ...dynamicBackHandTabs.value,
    ...dynamicBothHandsTabs.value
    // 注意：动作、上身、下身不支持动态标签，已移除
  ]
  const dynamicTab = allDynamicTabs.find(tab => tab.key === currentTab.value)
  if (dynamicTab) {
    return `暂无${dynamicTab.label}部件`
  }
  
  // 否则使用固定的映射表
  const tabNames = {
    frontHandNormal: '左手',
    frontHandRight: '右手',
    frontHandBoth: '双手',
    backHand: '右手',
    frontLayerBackHand: '右手',
    bothHands: '双手',
    upperBody: '上身',
    lowerBody: '下身',
    action: '动作'
  }
  return `暂无${tabNames[currentTab.value] || ''}部件`
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

// ==================== 文件上传处理 ====================
// 拖拽上传逻辑已提取到 usePsdUpload composable
// 将在 PSD 解析器初始化后再初始化上传逻辑（因为需要 processFile 依赖）

/**
 * 使用Electron Dialog选择PSD文件
 * 处理流程：
 * 1、打开系统选择框并处理取消或失败结果
 * 2、过滤已打开路径，逐个读取文件并调用解析入口
 * 3、汇总加载结果、清理消息并释放上传状态
 */
const handleSelectPsdFiles = async () => {
  // 1、等待文件选择结果，无有效路径时提前结束
  try {
    const result = await window.electronAPI?.selectPsdFiles?.()
    
    if (!result || !result.success) {
      if (!result?.canceled) {
        message.error('选择文件失败')
      }
      return
    }
    
    if (result.filePaths.length === 0) {
      return
    }
    
    console.log('📂 用户选择的文件路径:', result.filePaths)
    
    isUploading.value = true
    let successCount = 0
    let failCount = 0
    const totalFiles = result.filePaths.length
    
  // 2、去重后逐个读取并处理文件，保留真实路径供后续缓存使用
  const openedPaths = new Set(
    psdFiles.value
      .filter(psd => psd.filePath)
      .map(psd => psd.filePath)
  )
  const uniquePaths = result.filePaths.filter(p => !openedPaths.has(p))
  const alreadyOpenedCount = result.filePaths.length - uniquePaths.length

  for (let i = 0; i < uniquePaths.length; i++) {
    const filePath = uniquePaths[i]
    try {
      message.loading(`正在处理 ${i + 1}/${uniquePaths.length}: ${filePath.split(/[\\/]/).pop()}`, { 
        duration: 0, 
        key: 'parse-dialog' 
      })
      
      // 读取文件
      const fileBuffer = await window.electronAPI?.readFile?.(filePath)
      if (!fileBuffer) {
        console.error('无法读取文件:', filePath)
        failCount++
        continue
      }
      
      // 创建File对象并添加path属性
      const fileName = filePath.split(/[\\/]/).pop()
      const file = new File([fileBuffer], fileName, { type: 'application/octet-stream' })
      
      // 强制设置path属性
      Object.defineProperty(file, 'path', {
        value: filePath,
        writable: false,
        enumerable: true,
        configurable: false
      })
      
      console.log('📁 处理文件，路径:', file.path)
      
      // 处理文件
      await processFile(file, false)
      successCount++
    } catch (error) {
      console.error(`处理文件失败: ${filePath}`, error)
      failCount++
    }
  }
    
    // 3、循环结束后统一清理提示，再报告成功、已打开和失败数量
    message.destroyAll()
    
    // 显示最终结果
    if (successCount > 0 || alreadyOpenedCount > 0 || failCount > 0) {
      const parts = []
      if (successCount > 0) parts.push(`成功上传 ${successCount} 个`)
      if (alreadyOpenedCount > 0) parts.push(`${alreadyOpenedCount} 个已打开`)
      if (failCount > 0) parts.push(`${failCount} 个失败`)
      
      if (successCount > 0) {
        message.success(parts.join('，'))
      } else if (alreadyOpenedCount > 0) {
        message.info(parts.join('，'))
      } else {
        message.error(parts.join('，'))
      }
    }
    
  } catch (error) {
    console.error('选择PSD文件失败:', error)
    message.error('选择文件失败: ' + error.message)
  } finally {
    isUploading.value = false
  }
}

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

/**
 * 保存包含当前部件选择的预设。
 * 处理流程：
 * 1、创建选择状态快照并交给预设保存模块
 */
const handleSavePreset = async () => {
  // 1、收集当前的配置信息后等待保存完成
  const configInfo = {
    selectedParts: { ...selectedParts.value }
  }
  await handleSavePresetOriginal(configInfo)
}

/**
 * 生成预设名称与主要配置的简短展示。
 * 处理流程：
 * 1、缺少配置时使用原名称
 * 2、提取主要分组选项并拼接展示名称
 */
const getPresetDisplayName = (preset) => {
  // 1、兼容没有选择配置的预设
  if (!preset.config || !preset.config.selectedParts) {
    return preset.name
  }
  
  const parts = preset.config.selectedParts
  const configParts = []
  
  // 2、提取主要配置信息，多选分组仅展示首项
  const keyGroups = ['frontHand', 'backHand', 'expression', 'action']
  keyGroups.forEach(key => {
    if (parts[key]) {
      const value = Array.isArray(parts[key]) ? parts[key][0] : parts[key]
      if (value) {
        configParts.push(value)
      }
    }
  })
  
  if (configParts.length > 0) {
    const configStr = configParts.join('_')
    return `${preset.name}_${configStr}`
  }
  
  return preset.name
}

/**
 * 生成预设悬浮提示中的完整配置说明。
 * 处理流程：
 * 1、缺少配置时返回原名称
 * 2、格式化每个已选分组并按行拼接
 */
const getPresetFullDescription = (preset) => {
  // 1、兼容未保存配置明细的预设
  if (!preset.config || !preset.config.selectedParts) {
    return preset.name
  }
  
  const parts = preset.config.selectedParts
  const descriptions = []
  
  // 2、把单选与多选值统一转成可读文本
  Object.entries(parts).forEach(([key, value]) => {
    if (value) {
      const displayValue = Array.isArray(value) ? value.join('、') : value
      descriptions.push(`${key}: ${displayValue}`)
    }
  })
  
  return `${preset.name}\n${descriptions.join('\n')}`
}

// 预设悬浮预览状态
const presetHoverPreview = reactive({ 
  visible: false, 
  src: '', 
  x: 0, 
  y: 0, 
  width: 0, 
  height: 0 
})

/**
 * 加载预设图片并展示悬浮预览。
 * 处理流程：
 * 1、检查预览开关和图片数据，再开始加载
 * 2、裁除留白并按窗口限制缩放图片
 * 3、写入预览状态并定位浮层
 */
const handlePresetHoverEnter = (event, preset) => {
  // 1、无图片或开关关闭时不触发预览
  if (!enablePresetHover.value) return
  if (!preset.base64Image) return
  
  // 加载图片并剪切空白像素
  const img = new Image()
  img.onload = () => {
    try {
      // 2、通过临时画布裁除图片透明留白并计算展示尺寸
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = img.width
      tempCanvas.height = img.height
      const tempCtx = tempCanvas.getContext('2d')
      tempCtx.drawImage(img, 0, 0)
      
      // 裁剪空白像素
      const trimmed = trimWhitespace(tempCanvas)
      const dataUrl = trimmed.toDataURL('image/png')
      
      // 计算缩放后的尺寸，保持宽高比
      const maxWidth = Math.min(window.innerWidth * 0.5, 800)
      const maxHeight = Math.min(window.innerHeight * 0.7, 600)
      
      let width = trimmed.width
      let height = trimmed.height
      
      // 按比例缩放
      if (width > maxWidth) {
        height = (maxWidth / width) * height
        width = maxWidth
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width
        height = maxHeight
      }
      
      // 3、提交预览图片及尺寸，按鼠标位置显示
      presetHoverPreview.src = dataUrl
      presetHoverPreview.visible = true
      presetHoverPreview.width = width
      presetHoverPreview.height = height
      
      handlePresetHoverMove(event)
    } catch (error) {
      console.error('生成预设预览失败:', error)
    }
  }
  img.src = preset.base64Image
}

/**
 * 让预设悬浮预览跟随鼠标。
 * 处理流程：
 * 1、计算鼠标右下方的候选坐标
 * 2、修正窗口边界后更新浮层位置
 */
const handlePresetHoverMove = (event) => {
  // 1、读取浮层尺寸并确定候选位置
  if (!presetHoverPreview.visible) return
  
  const gap = 12
  const width = presetHoverPreview.width || 400
  const height = presetHoverPreview.height || 300
  
  // 计算位置，确保不超出窗口
  let x = event.clientX + gap
  let y = event.clientY + gap
  
  // 2、修正右侧、底部、左侧和顶部的越界位置
  // 如果右侧空间不足，显示在左侧
  if (x + width > window.innerWidth - 8) {
    x = event.clientX - width - gap
  }
  
  // 如果下方空间不足，向上调整
  if (y + height > window.innerHeight - 8) {
    y = window.innerHeight - height - 8
  }
  
  // 确保不超出左侧和顶部
  x = Math.max(8, x)
  y = Math.max(8, y)
  
  presetHoverPreview.x = x
  presetHoverPreview.y = y
}

/**
 * 关闭预设悬浮预览。
 * 处理流程：
 * 1、将预设浮层设为隐藏
 */
const handlePresetHoverLeave = () => {
  // 1、隐藏当前预设浮层
  presetHoverPreview.visible = false
}

// 模板悬浮预览状态
const templateHoverPreview = reactive({ 
  visible: false, 
  src: '', 
  x: 0, 
  y: 0, 
  width: 0, 
  height: 0 
})

// 模板悬浮预览事件处理
// 用于防止快速移入移出导致的闪烁
let templateHoverTimer = null
let currentHoverTemplateId = null

/**
 * 获取模板预览并显示悬浮图片。
 * 处理流程：
 * 1、清理隐藏定时器，同一模板直接更新位置
 * 2、按模板自身类型获取预览图
 * 3、图片加载后检查悬停目标，缩放并显示浮层
 */
const handleTemplateHoverEnter = async (event, template) => {
  // 1、检查开关，取消尚未执行的隐藏操作
  if (!enablePresetHover.value) return
  
  // 清除之前的隐藏定时器
  if (templateHoverTimer) {
    clearTimeout(templateHoverTimer)
    templateHoverTimer = null
  }
  
  // 如果是同一个模板，只更新位置
  if (currentHoverTemplateId === template.id && templateHoverPreview.visible) {
    handleTemplateHoverMove(event)
    return
  }
  
  currentHoverTemplateId = template.id
  
  // 2、使用模板自身的类型属性获取预览
  // 这样可以确保在动作模板标签页也能预览表情模板，反之亦然
  const templateType = template.templateType || activeTemplateType.value
  const base64Data = await getTemplatePreview(template.id, templateType)
  
  if (!base64Data) {
    console.log('⚠️ 模板无预览图:', template.name)
    return
  }
  
  try {
    // 创建临时图片对象以获取真实尺寸
    const img = new Image()
    img.src = base64Data
    
    img.onload = () => {
      // 3、检查是否仍然悬浮在同一个模板上，避免异步结果覆盖新目标
      if (currentHoverTemplateId !== template.id) {
        return
      }
      
      let width = img.width
      let height = img.height
      
      // 计算缩放后的尺寸，保持宽高比（自适应屏幕大小）
      const maxWidth = Math.min(window.innerWidth * 0.5, 800)
      const maxHeight = Math.min(window.innerHeight * 0.7, 600)
      
      // 按比例缩放
      if (width > maxWidth) {
        height = (maxWidth / width) * height
        width = maxWidth
      }
      if (height > maxHeight) {
        width = (maxHeight / height) * width
        height = maxHeight
      }
      
      templateHoverPreview.src = base64Data
      templateHoverPreview.visible = true
      templateHoverPreview.width = width
      templateHoverPreview.height = height
      
      handleTemplateHoverMove(event)
    }
  } catch (error) {
    console.error('生成模板预览失败:', error)
  }
}

/**
 * 更新模板预览浮层的鼠标跟随位置。
 * 处理流程：
 * 1、读取浮层尺寸并计算候选坐标
 * 2、约束窗口边界并提交位置
 */
const handleTemplateHoverMove = (event) => {
  // 1、隐藏时跳过定位，显示时基于当前图片尺寸计算
  if (!templateHoverPreview.visible) return
  
  const gap = 12
  const width = templateHoverPreview.width || 400
  const height = templateHoverPreview.height || 300
  
  // 计算位置，确保不超出窗口
  let x = event.clientX + gap
  let y = event.clientY + gap
  
  // 如果右侧空间不足，显示在左侧
  if (x + width > window.innerWidth - 8) {
    x = event.clientX - width - gap
  }
  
  // 如果下方空间不足，向上调整
  if (y + height > window.innerHeight - 8) {
    y = window.innerHeight - height - 8
  }
  
  // 确保不超出左侧和顶部
  x = Math.max(8, x)
  y = Math.max(8, y)
  
  // 2、提交已修正窗口边界的浮层坐标
  templateHoverPreview.x = x
  templateHoverPreview.y = y
}

/**
 * 延迟关闭模板悬浮预览。
 * 处理流程：
 * 1、替换已有隐藏定时器
 * 2、延迟清理浮层及当前模板标识，减少子元素切换闪烁
 */
const handleTemplateHoverLeave = () => {
  // 1、清理之前的隐藏任务，保留最后一次离开事件
  if (templateHoverTimer) {
    clearTimeout(templateHoverTimer)
  }
  
  // 2、延迟隐藏并重置悬停状态
  templateHoverTimer = setTimeout(() => {
    templateHoverPreview.visible = false
    currentHoverTemplateId = null
    templateHoverTimer = null
  }, 100) // 100ms 延迟
}

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

// ==================== 应用模板配置函数（在初始化模板功能之前定义） ====================
/**
 * 应用模板配置到当前PSD
 * 处理流程：
 * 1、验证数据，无跳转模式委托静默应用并管理画布过渡
 * 2、建立标准手部及动态表情标签的映射
 * 3、逐项匹配和应用部件，收集缺失信息
 * 4、重绘画布并按需提示缺失项，异常时恢复画布状态
 * @param {Array} config - 模板配置数组 [{tabName, selectedParts}]
 * @param {Boolean} noJump - 是否禁止标签页跳转（默认false）
 * @param {Boolean} showMissingAlert - 是否显示缺失部件警告弹窗（默认false）
 */
const applyTemplateConfig = async (config, noJump = false, showMissingAlert = false) => {
  // 1、检查配置，并对无跳转应用使用独立的过渡流程
  if (!config || !Array.isArray(config) || !currentPsdData.value) {
    console.warn('⚠️ 无法应用模板：配置或PSD数据为空')
    return
  }
  
  console.log('📋 开始应用模板配置:', config, '禁止跳转:', noJump, '显示缺失警告:', showMissingAlert)
  
  try {
    if (noJump) {
      // 🎬 开始应用：隐藏主画布，添加过渡动画
      isRenderingTemplate.value = true
      canvasOpacity.value = 0 // 完全隐藏画布
      
      // 等待过渡动画开始
      await new Promise(resolve => setTimeout(resolve, 50))
      
      // 使用静默应用，不跳转标签页
      // 🔧 传入模板类型，只清空对应类型的图层
      const result = await applyTemplateConfigSilent(config, true, activeTemplateType.value, showMissingAlert)
      await renderAllLayers()
      
      // 🎬 应用完成：恢复主画布不透明度，带有过渡动画
      await new Promise(resolve => setTimeout(resolve, 50))
      canvasOpacity.value = 1 // 恢复到100%不透明度
      
      // 等待过渡动画完成后清除渲染标志
      await new Promise(resolve => setTimeout(resolve, 300))
      isRenderingTemplate.value = false
      
      console.log('✅ 模板应用完成（无跳转）')
      return result
    }
    
    // 2、建立模板显示名称到当前 PSD 实际分组的映射
    const tabNameToKey = {}
    
    /**
     * 检测当前 PSD 实际使用的手部分组键。
     * 处理流程：
     * 1、按标准键和备用键顺序查找非空部件列表，未匹配则保留标准键
     */
    const detectHandGroupKey = (standardKey, alternatives) => {
      // 1、检查哪个分组键在当前 PSD 中实际存在
      for (const key of [standardKey, ...alternatives]) {
        if (allPartsListsMap.value[key] && allPartsListsMap.value[key].length > 0) {
          return key
        }
      }
      return standardKey // 兜底返回标准key
    }
    
    // 标准标签映射（使用智能检测）
    const standardMap = {
      '前手': detectHandGroupKey('frontHandNormal', ['frontHand']),
      '左手': detectHandGroupKey('frontHandNormal', ['frontHand']),
      '右手': detectHandGroupKey('frontHandRight', ['rightHand']),
      '双手': detectHandGroupKey('frontHandBoth', ['bothHands']),  // 🔧 关键：智能匹配双手
      '后手': detectHandGroupKey('backHand', []),
      '前层后手': detectHandGroupKey('frontLayerBackHand', []),
      '动作': 'action'
      // 注意：移除了上身和下身，模板不再管理这些
    }
    
    // 添加标准映射
    Object.assign(tabNameToKey, standardMap)
    
    console.log('🔍 当前PSD的手部标签映射:', {
      '双手': standardMap['双手'],
      '前手': standardMap['前手'],
      '右手': standardMap['右手']
    })
    
    // 添加动态表情标签映射
    if (dynamicExpressionTabs?.value) {
      for (const tab of dynamicExpressionTabs.value) {
        tabNameToKey[tab.label] = tab.key
      }
    }
    
    // 记录模板中配置的groupKey，用于后续只应用这些分组
    const configuredGroups = new Set()
    // 收集缺失的部件信息
    const missingItems = [] // [{ tabName, missingParts: [] }]
    
    // 3、逐组匹配名称并应用未选中的部件，同时收集缺失项
    for (const item of config) {
      const { tabName, selectedParts: partNames } = item
      
      if (!tabName || !partNames || partNames.length === 0) {
        continue
      }
      
      // 查找对应的groupKey
      const groupKey = tabNameToKey[tabName]
      if (!groupKey) {
        console.warn(`⚠️ 未找到标签"${tabName}"的groupKey映射`)
        missingItems.push({ 
          tabName, 
          missingParts: partNames,
          reason: '未找到对应的标签分组'
        })
        continue
      }
      
      configuredGroups.add(groupKey)
      
      // 查找对应的部件列表
      const partsList = allPartsListsMap.value[groupKey]
      if (!partsList || partsList.length === 0) {
        console.warn(`⚠️ groupKey"${groupKey}"没有可用的部件列表`)
        missingItems.push({ 
          tabName, 
          missingParts: partNames,
          reason: '该标签下没有可用的部件'
        })
        continue
      }
      
      // 应用所有匹配的部件（支持多选）
      const missingParts = []
      for (const partName of partNames) {
        const targetPart = partsList.find(p => 
          p.name === partName || 
          p.displayName === partName ||
          (p.displayName || p.name).includes(partName) ||
          partName.includes(p.displayName || p.name)
        )
        
        if (targetPart) {
          // 检查该部件是否已选中
          const currentSelected = selectedParts.value[groupKey]
          const isAlreadySelected = Array.isArray(currentSelected) 
            ? currentSelected.some(p => p.path === targetPart.path)
            : (currentSelected && currentSelected.path === targetPart.path)
          
          if (!isAlreadySelected) {
            // 切换到对应的标签页
            currentTab.value = groupKey
            // 应用部件选择
            await selectPart(targetPart)
            console.log(`✅ 应用部件选择: ${tabName} -> ${targetPart.displayName || targetPart.name}`)
          } else {
            console.log(`ℹ️ 部件已选中，跳过: ${tabName} -> ${targetPart.displayName || targetPart.name}`)
          }
        } else {
          console.log(`⚠️ 未找到匹配的部件: ${tabName} -> ${partName}`)
          missingParts.push(partName)
        }
      }
      
      // 记录该标签下缺失的部件
      if (missingParts.length > 0) {
        missingItems.push({ 
          tabName, 
          missingParts,
          reason: '部件不存在'
        })
      }
    }
    
    // 4、重绘当前选择，并按调用参数显示缺失部件提示
    console.log(`📋 模板应用完成，配置了 ${configuredGroups.size} 个分组，其他分组保持原状`)
    
    // 重新渲染画布
    await renderAllLayers()
    
    // 如果需要显示缺失警告，且有缺失项，则显示气泡提示
    if (showMissingAlert && missingItems.length > 0) {
      // 判断是动作模板还是表情模板
      const isActionTemplate = activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
      const templateTypeName = isActionTemplate ? '动作' : '表情'
      
      // 构建简洁的缺失信息文本
      const missingTexts = missingItems.map(item => {
        return `【${item.tabName}】${item.missingParts.join('、')}`
      })
      
      // 显示气泡提示
      message.warning(`模板已部分应用，缺少${templateTypeName}：${missingTexts.join('；')}`, {
        duration: 5000
      })
      
      console.warn(`⚠️ 模板应用时发现 ${missingItems.length} 个缺失项`)
    }
    
    console.log('✅ 模板应用完成')
    return { success: true, missingItems }
  } catch (error) {
    console.error('❌ 应用模板配置失败:', error)
    // 确保在错误情况下也恢复画布状态
    if (noJump && isRenderingTemplate.value) {
      canvasOpacity.value = 1
      isRenderingTemplate.value = false
    }
    throw error
  }
}

// 创建一个 ref 用于存储渲染函数引用（稍后赋值）
const renderTemplatesPreviewsRef = ref(null)

/**
 * 生成模板预览图的 base64 数据
 * 通过主画布渲染逻辑来确保剪切蒙版、图层蒙版等复杂逻辑的正确性
 * 处理流程：
 * 1、备份图层树，并按动作或表情模板筛选可见图层
 * 2、等待主画布绘制稳定后复制图像
 * 3、裁剪缩放并导出 JPEG 数据地址
 * 4、无论生成结果如何，都恢复原始图层树与主画布
 * @param {String} templateType - 模板类型 'actionTemplate' 或 'expressionTemplate'
 * @returns {Promise<String>} 图片数据地址，缺少数据或生成失败时返回空值
 */
const generateTemplatePreviewBase64 = async (templateType) => {
  // 1、验证 PSD 并备份图层树，临时应用模板类型对应的可见性
  try {
    if (!currentPsdData.value || !currentPsdData.value.layerHierarchy) {
      console.warn('⚠️ 当前没有加载PSD数据，跳过预览图生成')
      return null
    }
    
    const typeName = templateType === 'actionTemplate' ? '动作' : '表情'
    console.log(`📸 开始生成${typeName}模板预览图（使用主画布渲染）...`)
    
    // 🔧 保存当前状态
    const originalLayerTreeData = JSON.parse(JSON.stringify(layerTreeData.value))
    
    try {
      // 获取系统配置的表情图组名称列表
      const customGroupNames = getCustomGroupNames()
      const expressionNames = customGroupNames.expression || []
      
      /**
       * 判断路径是否属于配置的表情分组。
       * 处理流程：
       * 1、遍历表情名称，检查路径中是否包含该名称
       */
      const isExpressionLayer = (layerPath) => {
        // 1、复用用户配置的表情组名识别路径
        return expressionNames.some(exprName => 
          layerPath && (layerPath.includes(exprName) || layerPath.includes(`/${exprName}/`))
        )
      }
      
      // 构建路径映射
      const pathMap = buildUniquePathMap(currentPsdData.value.layerHierarchy)
      
      /**
       * 为当前模板预览临时筛选可见图层。
       * 处理流程：
       * 1、递归处理分组，叶子节点按路径判定是否属于表情
       * 2、隐藏当前模板类型不需要的叶子，保留其他节点原有状态
       */
      const setLayerVisibility = (layers) => {
        // 1、逐层遍历到可绘制节点，并查找其原始路径
        for (const layer of layers) {
          if (layer.children && layer.children.length > 0) {
            setLayerVisibility(layer.children)
          } else {
            // 找到对应的原始图层
            const originalLayer = currentPsdData.value.layerHierarchy
            const fullPath = pathMap.get(layer)
            if (!fullPath) continue
            
            const isExpression = isExpressionLayer(fullPath)
            
            // 2、根据模板类型决定图层可见性
            if (templateType === 'actionTemplate') {
              // 动作模板：隐藏表情图层，保留其他所有可见图层
              if (isExpression) {
                layer.visible = false
                layer.userVisible = false
              }
              // 非表情图层保持原状
            } else if (templateType === 'expressionTemplate') {
              // 表情模板：只显示表情图层，隐藏其他图层
              if (!isExpression) {
                layer.visible = false
                layer.userVisible = false
              }
              // 表情图层保持原状
            }
          }
        }
      }
      
      // 应用可见性设置
      setLayerVisibility(layerTreeData.value)
      
      // 2、调用主画布渲染逻辑，等待蒙版等绘制完成后复制图像
      await nextTick()
      await renderAllLayers()
      
      // 🔧 等待渲染完全完成（多次 nextTick + 额外延迟）
      await nextTick()
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 100)) // 等待100ms确保渲染完成
      
      // 🔧 再次确认画布已经稳定
      await nextTick()
      
      // 从主画布拷贝图像
      const mainCanvas = canvasRef.value
      if (!mainCanvas) {
        console.warn('⚠️ 主画布未初始化，跳过预览图生成')
        return null
      }
      
      console.log(`📸 主画布尺寸: ${mainCanvas.width} x ${mainCanvas.height}，准备拷贝图像...`)
      
      // 创建临时 canvas
      const tempCanvas = document.createElement('canvas')
      tempCanvas.width = mainCanvas.width
      tempCanvas.height = mainCanvas.height
      const tempCtx = tempCanvas.getContext('2d', { alpha: true })
      
      if (!tempCtx) {
        console.warn('⚠️ 无法创建临时Canvas上下文')
        return null
      }
      
      // 设置高质量渲染
      tempCtx.imageSmoothingEnabled = true
      tempCtx.imageSmoothingQuality = 'high'
      
      // 清空画布
      tempCtx.clearRect(0, 0, tempCanvas.width, tempCanvas.height)
      
      // 从主画布拷贝图像
      tempCtx.drawImage(mainCanvas, 0, 0)
      
      // 3、裁剪空白并限制预览尺寸，再编码为 JPEG
      const trimmed = trimWhitespace(tempCanvas)
      
      // 🔧 限制图片尺寸以减小base64大小
      let finalCanvas = trimmed
      const maxWidth = 800
      const maxHeight = 800
      
      if (trimmed.width > maxWidth || trimmed.height > maxHeight) {
        const scale = Math.min(maxWidth / trimmed.width, maxHeight / trimmed.height)
        const scaledWidth = Math.floor(trimmed.width * scale)
        const scaledHeight = Math.floor(trimmed.height * scale)
        
        const scaledCanvas = document.createElement('canvas')
        scaledCanvas.width = scaledWidth
        scaledCanvas.height = scaledHeight
        const scaledCtx = scaledCanvas.getContext('2d', { alpha: true })
        
        if (scaledCtx) {
          scaledCtx.imageSmoothingEnabled = true
          scaledCtx.imageSmoothingQuality = 'high'
          scaledCtx.drawImage(trimmed, 0, 0, scaledWidth, scaledHeight)
          finalCanvas = scaledCanvas
          console.log(`📐 图片已缩放: ${trimmed.width}x${trimmed.height} -> ${scaledWidth}x${scaledHeight}`)
        }
      }
      
      // 🔧 使用JPEG格式和适当的质量来减小文件大小
      // 对于模板预览，0.8的质量已经足够好，同时能显著减小文件大小
      const base64 = finalCanvas.toDataURL('image/jpeg', 0.8)
      
      console.log(`✅ ${typeName}模板预览图生成完成，尺寸: ${finalCanvas.width}x${finalCanvas.height}，base64 长度: ${base64.length} (${(base64.length / 1024 / 1024).toFixed(2)}MB)`)
      
      // 🔧 验证base64数据有效性
      if (!base64 || !base64.startsWith('data:image/')) {
        console.error('❌ 生成的base64数据无效')
        return null
      }
      
      // 🔧 警告：如果数据太大（超过5MB），可能会导致存储问题
      if (base64.length > 5 * 1024 * 1024) {
        console.warn(`⚠️ base64数据过大 (${(base64.length / 1024 / 1024).toFixed(2)}MB)，可能会导致存储失败`)
      }
      
      return base64
      
    } finally {
      // 4、恢复原始图层树并重新绘制主画布
      layerTreeData.value = originalLayerTreeData
      
      // 重新渲染主画布以恢复原始显示
      await nextTick()
      await renderAllLayers()
      
      // 等待恢复渲染完成
      await nextTick()
      await nextTick()
      await new Promise(resolve => setTimeout(resolve, 50))
    }
  } catch (error) {
    console.error('❌ 生成预览图失败:', error)
    // 返回 null 而不是抛出错误，让程序继续执行
    return null
  }
}

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

// ==================== 多选状态管理 ====================
const selectedTemplateIds1 = ref(new Set()) // 动作模板多选
const selectedTemplateIds2 = ref(new Set()) // 表情模板多选
const selectedPresetIds = ref(new Set()) // 预设多选
const contextMenuVisible = ref(false)
const contextMenuPosition = ref({ x: 0, y: 0 })
const contextMenuTemplateType = ref('') // 'template1' 或 'template2'
const contextMenuItemType = ref('') // 'preset' 或 'template'
const contextMenuSingleItemId = ref(null) // 单个项目的ID（用于重命名）
const templateDragState = reactive({
  draggingId: null,
  draggingType: '',
  overId: null,
  dropPosition: ''
})
const contextMenuTemplateDetail = ref(null) // 记录右键详情的模板数据

// 右键弹窗尺寸预估，用于计算安全位置
const TEMPLATE_DETAIL_WIDTH = 360
const TEMPLATE_DETAIL_HEIGHT = 360
const BASIC_MENU_WIDTH = 200
const BASIC_MENU_HEIGHT = 120

// 右键小窗需要展示的配置明细
const templateDetailEntries = computed(() => {
  if (!contextMenuTemplateDetail.value?.config) return []
  return contextMenuTemplateDetail.value.config.filter(item => 
    item &&
    item.tabName &&
    Array.isArray(item.selectedParts) &&
    item.selectedParts.length > 0
  )
})

// 根据类型输出标签文案
const templateTypeLabelMap = {
  template1: '动作模板',
  template2: '表情模板',
  actionTemplate: '动作模板',
  expressionTemplate: '表情模板'
}

const templateDetailTypeLabel = computed(() => {
  if (!contextMenuTemplateDetail.value) return ''
  const typeFromContext = templateTypeLabelMap[contextMenuTemplateType.value]
  if (typeFromContext && typeFromContext.includes('模板')) {
    return typeFromContext.replace('模板', '')
  }
  const fallback = templateTypeLabelMap[contextMenuTemplateDetail.value.templateType] || ''
  return fallback.replace('模板', '')
})

const templateDetailTimestamp = ref('')

const templateDetailSummary = computed(() => {
  if (!contextMenuTemplateDetail.value) return ''
  const count = templateDetailEntries.value.reduce((sum, group) => sum + group.selectedParts.length, 0)
  return count > 0 ? `共 ${count} 项配置` : ''
})

/**
 * 计算右键弹窗在窗口内的位置。
 * 处理流程：
 * 1、取得视口尺寸并修正右侧、底部越界
 * 2、保留顶部和左侧边距后返回坐标
 */
const getContextMenuSafePosition = (clientX, clientY, width = BASIC_MENU_WIDTH, height = BASIC_MENU_HEIGHT) => {
  // 1、根据弹窗预计尺寸约束右侧和底部位置
  const margin = 12
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1920
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 1080
  let x = clientX
  let y = clientY
  
  if (x + width + margin > viewportWidth) {
    x = viewportWidth - width - margin
  }
  if (y + height + margin > viewportHeight) {
    y = viewportHeight - height - margin
  }
  
  // 2、窗口较小时仍确保左侧和顶部起点可见
  x = Math.max(margin, x)
  y = Math.max(margin, y)
  
  return { x, y }
}

/**
 * 响应模板卡片单选或多选。
 * 处理流程：
 * 1、选择对应模板类型的多选集合
 * 2、修饰键点击切换集合成员，普通点击直接应用模板
 */
const handleTemplateCardClick = (event, templateId, templateType) => {
  // 1、动作模板与表情模板使用独立的多选状态
  const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2
  
  // 2、按修饰键区分多选切换与直接应用
  if (event.ctrlKey || event.metaKey) {
    // Ctrl 或 Cmd 多选
    if (selectedSet.value.has(templateId)) {
      selectedSet.value.delete(templateId)
    } else {
      selectedSet.value.add(templateId)
    }
    // 触发响应式更新
    selectedSet.value = new Set(selectedSet.value)
  } else {
    // 普通点击：应用模板并清空多选
    selectedSet.value.clear()
    applyTemplateById(templateId, templateType)
  }
}

/**
 * 展示模板卡片的右键菜单与配置详情。
 * 处理流程：
 * 1、同步右键目标与多选集合
 * 2、保存单项标识和模板详情
 * 3、计算菜单位置并显示，随后按实际尺寸调整
 */
const handleTemplateContextMenu = (event, templateId, templateType) => {
  // 1、接管原生右键菜单，确保目标位于当前选中集合
  event.preventDefault()
  
  const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2
  const templateList = templateType === 'template1' ? templates1.value : templates2.value
  
  // 如果右键的模板不在选中列表中，清空选中并选中当前模板
  if (!selectedSet.value.has(templateId)) {
    selectedSet.value.clear()
    selectedSet.value.add(templateId)
    selectedSet.value = new Set(selectedSet.value)
  }
  
  // 2、如果只选中了一个模板，记录其标识用于重命名
  contextMenuSingleItemId.value = selectedSet.value.size === 1 ? templateId : null
  
  // 记录当前模板详情
  const currentTemplate = templateList.find(item => item.id === templateId) || null
  contextMenuTemplateDetail.value = currentTemplate
  
  // 3、显示右键菜单，并约束详情浮层位置
  contextMenuPosition.value = getContextMenuSafePosition(
    event.clientX, 
    event.clientY, 
    TEMPLATE_DETAIL_WIDTH, 
    TEMPLATE_DETAIL_HEIGHT
  )
  contextMenuTemplateType.value = templateType
  contextMenuItemType.value = 'template'
  contextMenuVisible.value = true
  templateDetailTimestamp.value = ''
  adjustTemplateDetailMenuPosition()
}

/**
 * 关闭当前右键菜单。
 * 处理流程：
 * 1、隐藏菜单并释放当前详情对象和项目类型
 */
const closeContextMenu = () => {
  // 1、清理菜单展示所需的临时上下文
  contextMenuVisible.value = false
  contextMenuItemType.value = ''
  contextMenuTemplateDetail.value = null
}

/**
 * 确认后批量删除选中的模板。
 * 处理流程：
 * 1、检查选中集合并确定模板存储类型
 * 2、确认后逐个删除，清空选择并关闭菜单
 */
const handleBatchDeleteTemplates = async () => {
  // 1、读取右键菜单所属模板类型的选择集合
  const selectedSet = contextMenuTemplateType.value === 'template1' 
    ? selectedTemplateIds1 
    : selectedTemplateIds2
  
  if (selectedSet.value.size === 0) {
    message.warning('请先选择要删除的模板')
    return
  }
  
  const count = selectedSet.value.size
  const typeText = contextMenuTemplateType.value === 'template1' ? '动作' : '表情'
  // 转换为新的类型名
  const targetType = contextMenuTemplateType.value === 'template1' ? 'actionTemplate' : 'expressionTemplate'
  
  // 2、仅在用户确认后执行批量删除
  dialog.warning({
    title: '确认删除',
    content: `确定要删除选中的 ${count} 个${typeText}模板吗？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      // 批量删除，传递正确的模板类型
      for (const templateId of selectedSet.value) {
        await deleteTemplate(templateId, targetType)
      }
      
      // 清空选中状态
      selectedSet.value.clear()
      closeContextMenu()
      
      message.success(`已删除 ${count} 个${typeText}模板`)
    }
  })
}

/**
 * 通过对话框重命名单个模板。
 * 处理流程：
 * 1、获取目标模板并关闭原右键菜单
 * 2、展示名称输入框，支持回车提交和自动聚焦
 * 3、确认时检查空名及重名，保存后恢复原模板类型
 */
const handleContextMenuRename = () => {
  // 1、仅处理单项模板上下文
  if (!contextMenuSingleItemId.value) return
  
  // 获取当前模板
  const templateType = contextMenuTemplateType.value
  const targetType = templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
  const isActionTemplate = targetType === 'actionTemplate'
  const currentTemplates = isActionTemplate ? templates1.value : templates2.value
  const template = currentTemplates.find(t => t.id === contextMenuSingleItemId.value)
  
  if (!template) return
  
  // 关闭右键菜单
  closeContextMenu()
  
  // 创建输入框的响应式变量
  let newName = template.name
  
  // 2、使用对话框收集新名称并提供键盘提交
  const d = dialog.create({
    title: '重命名模板',
    content: () => {
      return h('div', { style: 'padding: 10px 0;' }, [
        h('div', { style: 'margin-bottom: 8px; color: var(--n-text-color); font-size: 14px;' }, '请输入新的模板名称：'),
        h('input', {
          type: 'text',
          value: newName,
          placeholder: '模板名称',
          style: 'width: 100%; padding: 8px 12px; border: 1px solid var(--n-border-color); border-radius: 4px; background: var(--n-color); color: var(--n-text-color); font-size: 14px; outline: none; box-sizing: border-box;',
          onInput: (e) => {
            newName = e.target.value
          },
          onKeyup: (e) => {
            if (e.key === 'Enter') {
              d.positiveClick()
            }
          },
          onVnodeMounted: (vnode) => {
            // 自动聚焦并选中文本
            nextTick(() => {
              vnode.el.focus()
              vnode.el.select()
            })
          }
        })
      ])
    },
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: () => {
      // 3、校验名称后保存目标类型的数据，再恢复原活动类型
      const trimmedName = newName.trim()
      
      if (!trimmedName) {
        message.warning('模板名称不能为空')
        return false // 阻止对话框关闭
      }
      
      // 检查重名
      if (currentTemplates.some(t => t.id !== template.id && t.name === trimmedName)) {
        message.warning('模板名称已存在')
        return false // 阻止对话框关闭
      }
      
      // 执行重命名
      template.name = trimmedName
      
      // 保存到存储
      const originalType = activeTemplateType.value
      activeTemplateType.value = targetType
      saveTemplates()
      activeTemplateType.value = originalType
      
      message.success('模板已重命名')
      console.log('✏️ 重命名模板:', trimmedName)
    }
  })
}

/**
 * 响应页面空白处点击并关闭右键菜单。
 * 处理流程：
 * 1、调用统一的菜单关闭方法
 */
const handlePageClick = () => {
  // 1、结束当前右键菜单交互
  closeContextMenu()
}

/**
 * 判断模板是否位于对应类型的多选集合。
 * 处理流程：
 * 1、读取该类型的集合并查询模板标识
 */
const isTemplateMultiSelected = (templateId, templateType) => {
  // 1、动作与表情模板分别查询，避免标识跨类型混用
  const selectedSet = templateType === 'template1' ? selectedTemplateIds1 : selectedTemplateIds2
  return selectedSet.value.has(templateId)
}

/**
 * 判断模板是否为当前拖拽来源。
 * 处理流程：
 * 1、比较模板标识与拖拽来源标识
 */
const isTemplateDragging = (templateId) => templateDragState.draggingId === templateId
/**
 * 判断模板的指定侧是否应显示插入提示。
 * 处理流程：
 * 1、同时匹配悬停目标与插入方向
 */
const isTemplateDragOver = (templateId, position) => {
  // 1、目标和方向都一致时显示反馈
  return templateDragState.overId === templateId && templateDragState.dropPosition === position
}

/**
 * 将界面模板类型转换为存储类型。
 * 处理流程：
 * 1、动作标签映射到动作模板，其余映射到表情模板
 */
const templateTypeToInternal = (templateType) => {
  // 1、统一界面与数据模块的类型名称
  return templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
}

/**
 * 获取界面类型对应的模板列表。
 * 处理流程：
 * 1、按动作或表情标签返回对应数组
 */
const getTemplateListByType = (templateType) => {
  // 1、保持两类模板的数据相互独立
  return templateType === 'template1' ? templates1.value : templates2.value
}

/**
 * 按当前列表顺序更新模板排序序号。
 * 处理流程：
 * 1、取得目标列表，将数组索引转换为从一开始的序号
 */
const updateTemplateSortOrderMeta = (templateType) => {
  // 1、把拖拽后的数组顺序写入各模板的排序字段
  const list = getTemplateListByType(templateType)
  list.forEach((template, index) => {
    template.sortOrder = index + 1
  })
}

/**
 * 持久化指定类型的模板排序。
 * 处理流程：
 * 1、更新排序序号并临时切换活动类型
 * 2、等待保存完成，无论结果如何都恢复原类型
 */
const persistTemplateOrder = async (templateType) => {
  // 1、保存前让数据模块指向本次重排的模板集合
  updateTemplateSortOrderMeta(templateType)
  const originalType = activeTemplateType.value
  const targetType = templateTypeToInternal(templateType)
  if (originalType !== targetType) {
    activeTemplateType.value = targetType
  }
  // 2、恢复活动类型的操作由最终清理分支保证执行
  try {
    await saveTemplates()
  } finally {
    if (activeTemplateType.value !== originalType) {
      activeTemplateType.value = originalType
    }
  }
}

/**
 * 清空模板拖拽状态。
 * 处理流程：
 * 1、重置来源、类型、目标和插入方向
 */
const resetTemplateDragState = () => {
  // 1、为下一次拖拽清理全部临时字段
  templateDragState.draggingId = null
  templateDragState.draggingType = ''
  templateDragState.overId = null
  templateDragState.dropPosition = ''
}

/**
 * 判断目标类型能否接收当前模板拖拽。
 * 处理流程：
 * 1、要求存在拖拽来源且来源类型与目标一致
 */
const isTemplateDragAcceptable = (templateType) => {
  // 1、限制模板在同类型列表内重排
  return templateDragState.draggingId && templateDragState.draggingType === templateType
}

/**
 * 初始化模板卡片拖拽。
 * 处理流程：
 * 1、记录来源与类型，清除旧目标
 * 2、存在浏览器拖拽载荷时声明移动操作并写入标识
 */
const handleTemplateDragStart = (event, templateId, templateType) => {
  // 1、建立本次拖拽上下文
  templateDragState.draggingId = templateId
  templateDragState.draggingType = templateType
  templateDragState.overId = null
  templateDragState.dropPosition = ''
  // 2、设置浏览器拖拽载荷与允许的操作类型
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', templateId)
  }
}

/**
 * 计算模板卡片前后的插入方向。
 * 处理流程：
 * 1、按鼠标在卡片左右半区的位置更新目标和方向
 */
const updateTemplateDropPosition = (event, templateId) => {
  // 1、使用卡片局部横向坐标确定插入位置
  const rect = event.currentTarget.getBoundingClientRect()
  const offsetX = event.clientX - rect.left
  templateDragState.overId = templateId
  templateDragState.dropPosition = offsetX < rect.width / 2 ? 'before' : 'after'
}

/**
 * 处理拖拽进入模板卡片。
 * 处理流程：
 * 1、类型可接收时更新插入提示
 */
const handleTemplateDragEnter = (event, templateId, templateType) => {
  // 1、忽略跨类型拖拽
  if (!isTemplateDragAcceptable(templateType)) return
  updateTemplateDropPosition(event, templateId)
}

/**
 * 允许模板在同类型卡片上放置。
 * 处理流程：
 * 1、检查类型并阻止浏览器默认行为，再更新插入方向
 */
const handleTemplateDragOver = (event, templateId, templateType) => {
  // 1、持续同步鼠标位置对应的插入提示
  if (!isTemplateDragAcceptable(templateType)) return
  event.preventDefault()
  updateTemplateDropPosition(event, templateId)
}

/**
 * 清理模板卡片的拖拽离开反馈。
 * 处理流程：
 * 1、忽略不可接收类型及卡片内部子元素切换
 * 2、真正离开卡片时清空目标和方向
 */
const handleTemplateDragLeave = (event, templateId, templateType) => {
  // 1、检查类型与事件关联目标
  if (!isTemplateDragAcceptable(templateType)) return
  const related = event.relatedTarget
  if (related && event.currentTarget.contains(related)) {
    return
  }
  // 2、离开整个卡片才移除插入提示
  templateDragState.overId = null
  templateDragState.dropPosition = ''
}

/**
 * 将来源模板插入另一模板的前方或后方。
 * 处理流程：
 * 1、校验来源并从列表移除
 * 2、查找目标，缺失时恢复原位置，否则按方向插入
 */
const reorderTemplateList = (templateType, targetTemplateId, dropPosition) => {
  // 1、排除无来源、自身放置和来源已经不存在的情况
  if (!templateDragState.draggingId || templateDragState.draggingId === targetTemplateId) {
    return false
  }
  const list = getTemplateListByType(templateType)
  const fromIndex = list.findIndex(t => t.id === templateDragState.draggingId)
  if (fromIndex === -1) {
    return false
  }
  const [item] = list.splice(fromIndex, 1)
  // 2、移除来源后重新查找目标索引，避免偏移计算错误
  const targetIndex = list.findIndex(t => t.id === targetTemplateId)
  if (targetIndex === -1) {
    list.splice(fromIndex, 0, item)
    return false
  }
  let insertIndex = dropPosition === 'after' ? targetIndex + 1 : targetIndex
  if (insertIndex < 0) insertIndex = 0
  if (insertIndex > list.length) insertIndex = list.length
  list.splice(insertIndex, 0, item)
  return true
}

/**
 * 将拖动模板移到列表开头或末尾。
 * 处理流程：
 * 1、查找并移除来源模板
 * 2、按边界方向插入，返回是否完成移动
 */
const moveTemplateToEdge = (templateType, edge) => {
  // 1、来源不存在时不修改列表
  if (!templateDragState.draggingId) return false
  const list = getTemplateListByType(templateType)
  const fromIndex = list.findIndex(t => t.id === templateDragState.draggingId)
  if (fromIndex === -1) return false
  const [item] = list.splice(fromIndex, 1)
  // 2、将来源放到指定边界
  if (edge === 'first') {
    list.unshift(item)
  } else {
    list.push(item)
  }
  return true
}

/**
 * 提交模板卡片上的放置操作。
 * 处理流程：
 * 1、校验类型并重排来源模板
 * 2、发生变动时持久化顺序，随后清空拖拽状态
 */
const handleTemplateDrop = async (event, templateId, templateType) => {
  // 1、使用当前插入方向，缺失方向时默认后插
  if (!isTemplateDragAcceptable(templateType)) return
  event.preventDefault()
  const dropPosition = templateDragState.dropPosition || 'after'
  // 2、仅对完成的移动保存排序
  const changed = reorderTemplateList(templateType, templateId, dropPosition)
  if (changed) {
    await persistTemplateOrder(templateType)
  }
  resetTemplateDragState()
}

/**
 * 结束模板拖拽并处理容器边界放置。
 * 处理流程：
 * 1、若仍保留容器首尾目标，则执行边界移动并保存
 * 2、清理本轮拖拽状态
 */
const handleTemplateDragEnd = async () => {
  // 1、补充处理在容器边缘结束的拖拽
  if (
    templateDragState.draggingId &&
    (templateDragState.dropPosition === 'container-first' || templateDragState.dropPosition === 'container-last')
  ) {
    const templateType = templateDragState.draggingType
    const moveEdge = templateDragState.dropPosition === 'container-first' ? 'first' : 'last'
    const changed = moveTemplateToEdge(templateType, moveEdge)
    if (changed) {
      await persistTemplateOrder(templateType)
    }
  }
  // 2、移除来源及插入反馈
  resetTemplateDragState()
}

/**
 * 判断当前标签是否属于正在拖拽的模板类型。
 * 处理流程：
 * 1、检查来源标识，并按类型匹配当前标签
 */
const isTemplateDragContextActiveOnCurrentTab = () => {
  // 1、仅激活来源模板对应列表的容器事件
  if (!templateDragState.draggingId) return false
  if (templateDragState.draggingType === 'template1') {
    return currentTab.value === 'template1'
  }
  if (templateDragState.draggingType === 'template2') {
    return currentTab.value === 'template2'
  }
  return false
}

/**
 * 更新模板列表首尾区域的插入提示。
 * 处理流程：
 * 1、检查活动拖拽并测量容器边界
 * 2、按左右边缘或阈值区域设置首尾插入标记
 */
const handleTemplateListDragOver = (event) => {
  // 1、仅接收当前模板标签的拖拽
  if (!isTemplateDragContextActiveOnCurrentTab()) return
  event.preventDefault()
  const container = event.currentTarget
  const rect = container.getBoundingClientRect()
  // 2、容器外侧和内部边缘区域均可作为首尾落点
  if (event.clientX <= rect.left) {
    templateDragState.overId = null
    templateDragState.dropPosition = 'container-first'
    return
  }
  if (event.clientX >= rect.right) {
    templateDragState.overId = null
    templateDragState.dropPosition = 'container-last'
    return
  }
  const relativeX = event.clientX - rect.left
  const threshold = Math.min(80, rect.width * 0.25)
  templateDragState.overId = null
  if (relativeX <= threshold) {
    templateDragState.dropPosition = 'container-first'
  } else if (relativeX >= rect.width - threshold) {
    templateDragState.dropPosition = 'container-last'
  } else {
    templateDragState.dropPosition = ''
  }
}

/**
 * 处理拖拽离开模板列表。
 * 处理流程：
 * 1、移出左右边界时保留对应首尾插入标记
 * 2、离开其他区域时清理不再有效的插入提示
 */
const handleTemplateListDragLeave = (event) => {
  // 1、根据离开方向保留边界移动意图
  if (!templateDragState.draggingId) return
  const rect = event.currentTarget.getBoundingClientRect()
  if (event.clientX <= rect.left) {
    templateDragState.overId = null
    templateDragState.dropPosition = 'container-first'
    return
  }
  if (event.clientX >= rect.right) {
    templateDragState.overId = null
    templateDragState.dropPosition = 'container-last'
    return
  }
  // 2、真正离开列表且没有边界意图时清空提示
  if (!event.currentTarget.contains(event.relatedTarget)) {
    if (
      !templateDragState.overId &&
      templateDragState.dropPosition !== 'container-first' &&
      templateDragState.dropPosition !== 'container-last'
    ) {
      templateDragState.dropPosition = ''
    }
  }
}

/**
 * 提交模板列表空白区域的放置操作。
 * 处理流程：
 * 1、读取首尾目标并执行对应移动
 * 2、保存变动并结束拖拽上下文
 */
const handleTemplateListDrop = async (event) => {
  // 1、只处理当前模板类型的容器首尾放置
  if (!isTemplateDragContextActiveOnCurrentTab()) return
  event.preventDefault()
  const dropPosition = templateDragState.dropPosition
  const templateType = templateDragState.draggingType
  let changed = false
  if (dropPosition === 'container-first') {
    changed = moveTemplateToEdge(templateType, 'first')
  } else if (dropPosition === 'container-last') {
    changed = moveTemplateToEdge(templateType, 'last')
  }
  // 2、持久化顺序并清理反馈
  if (changed) {
    await persistTemplateOrder(templateType)
  }
  resetTemplateDragState()
}

// ==================== 预设多选管理 ====================
/**
 * 响应预设卡片的单选和多选。
 * 处理流程：
 * 1、修饰键点击切换多选成员
 * 2、普通点击清空多选并应用当前预设
 */
const handlePresetCardClick = (event, presetId) => {
  // 1、按修饰键状态分流到多选或直接应用
  if (event.ctrlKey || event.metaKey) {
    // Ctrl 或 Cmd 多选
    if (selectedPresetIds.value.has(presetId)) {
      selectedPresetIds.value.delete(presetId)
    } else {
      selectedPresetIds.value.add(presetId)
    }
    // 触发响应式更新
    selectedPresetIds.value = new Set(selectedPresetIds.value)
  } else {
    // 2、普通点击时选择预设并清空多选
    selectedPresetIds.value.clear()
    selectPreset(presetId)
  }
}

/**
 * 打开预设的右键操作菜单。
 * 处理流程：
 * 1、将右键目标纳入当前选中集合
 * 2、定位菜单并清除模板专用上下文
 */
const handlePresetContextMenu = (event, presetId) => {
  // 1、替代浏览器菜单并同步本次操作的预设集合
  event.preventDefault()
  
  // 如果右键的预设不在选中列表中，清空选中并选中当前预设
  if (!selectedPresetIds.value.has(presetId)) {
    selectedPresetIds.value.clear()
    selectedPresetIds.value.add(presetId)
    selectedPresetIds.value = new Set(selectedPresetIds.value)
  }
  
  // 2、定位预设菜单，重置不适用的模板详情字段
  contextMenuPosition.value = getContextMenuSafePosition(
    event.clientX, 
    event.clientY, 
    BASIC_MENU_WIDTH, 
    BASIC_MENU_HEIGHT
  )
  contextMenuItemType.value = 'preset'
  contextMenuTemplateDetail.value = null
  contextMenuTemplateType.value = ''
  contextMenuSingleItemId.value = null
  contextMenuVisible.value = true
}

/**
 * 确认后批量删除预设。
 * 处理流程：
 * 1、检查是否存在选中预设并展示确认框
 * 2、确认后逐项删除，清空选择并反馈完成结果
 */
const handleBatchDeletePresets = async () => {
  // 1、空集合不进入删除流程
  if (selectedPresetIds.value.size === 0) {
    message.warning('请先选择要删除的预设')
    return
  }
  
  const count = selectedPresetIds.value.size
  
  dialog.warning({
    title: '确认删除',
    content: `确定要删除选中的 ${count} 个预设吗？此操作不可撤销。`,
    positiveText: '删除',
    negativeText: '取消',
    onPositiveClick: async () => {
      // 2、依次等待每个预设删除后再清理选中集合
      for (const presetId of selectedPresetIds.value) {
        await deletePreset(presetId)
      }
      
      // 清空选中状态
      selectedPresetIds.value.clear()
      closeContextMenu()
      
      message.success(`已删除 ${count} 个预设`)
    }
  })
}

/**
 * 从模板详情菜单直接应用当前模板。
 * 处理流程：
 * 1、确认单项模板上下文完整
 * 2、等待应用完成后关闭菜单
 */
const handleTemplateDetailApply = async () => {
  // 1、缺少标识或类型时跳过
  if (!contextMenuSingleItemId.value || !contextMenuTemplateType.value) {
    return
  }
  // 2、使用菜单记录的类型应用模板
  await applyTemplateById(contextMenuSingleItemId.value, contextMenuTemplateType.value)
  closeContextMenu()
}

/**
 * 查询预设是否处于多选状态。
 * 处理流程：
 * 1、检查预设标识是否存在于选中集合
 */
const isPresetMultiSelected = (presetId) => {
  // 1、按标识读取集合成员状态
  return selectedPresetIds.value.has(presetId)
}

/**
 * 将当前配置保存为动作模板。
 * 处理流程：
 * 1、标记正在新增，并调用模板保存流程
 * 2、当前显示动作模板列表时补绘新模板预览
 * 3、延迟解除新增标记，避免监听器重复全量绘制
 */
const handleSaveTemplate1 = async () => {
  // 1、在保存期间抑制列表监听器的重复绘制
  isAddingTemplate.value = true
  try {
    await handleSaveTemplateOriginal(renderTemplatePreview, 'template1', generateTemplatePreviewBase64)
    
    // 2、当前处于动作模板标签页时，仅绘制新添加模板
    if (currentTab.value === 'template1') {
      await nextTick()
      // 获取最后一个模板（刚添加的）
      const newTemplate = templates1.value[templates1.value.length - 1]
      if (newTemplate) {
        console.log('🎨 立即渲染新添加的动作模板预览:', newTemplate.name)
        await renderTemplatePreview(newTemplate)
      }
    }
  } finally {
    // 3、稍等一下再解除标记，确保监听器不会被立即触发
    setTimeout(() => {
      isAddingTemplate.value = false
    }, 200)
  }
}

/**
 * 将当前配置保存为表情模板。
 * 处理流程：
 * 1、设置新增标记并保存表情配置
 * 2、当前显示表情模板列表时补绘新模板预览
 * 3、延迟清除新增标记
 */
const handleSaveTemplate2 = async () => {
  // 1、保存与预览期间共用新增标记
  isAddingTemplate.value = true
  try {
    await handleSaveTemplateOriginal(renderTemplatePreview, 'template2', generateTemplatePreviewBase64)
    
    // 2、当前处于表情模板标签页时，仅绘制新添加模板
    if (currentTab.value === 'template2') {
      await nextTick()
      // 获取最后一个模板（刚添加的）
      const newTemplate = templates2.value[templates2.value.length - 1]
      if (newTemplate) {
        console.log('🎨 立即渲染新添加的表情模板预览:', newTemplate.name)
        await renderTemplatePreview(newTemplate)
      }
    }
  } finally {
    // 3、稍等一下再解除标记，确保监听器不会被立即触发
    setTimeout(() => {
      isAddingTemplate.value = false
    }, 200)
  }
}

/**
 * 按界面模板类型应用指定模板。
 * 处理流程：
 * 1、将界面类型映射到活动存储类型
 * 2、等待模板应用完成
 */
const applyTemplateById = async (templateId, templateType) => {
  // 1、先切换到对应的模板存储类型
  if (templateType === 'template1') {
    activeTemplateType.value = 'actionTemplate'
  } else if (templateType === 'template2') {
    activeTemplateType.value = 'expressionTemplate'
  }
  
  // 2、在对应集合中查找并应用模板
  await applyTemplate(templateId)
}

/**
 * 按模板标识和类型请求删除确认。
 * 处理流程：
 * 1、转换类型后调用模板模块的确认入口
 */
const confirmDeleteTemplateById = (templateId, templateType) => {
  // 1、直接传递模板类型，不改变当前活动模板类型
  // 转换为新的类型名
  const targetType = templateType === 'template1' ? 'actionTemplate' : 'expressionTemplate'
  confirmDeleteTemplate(templateId, targetType)
}

/**
 * 为指定模板打开重命名对话框。
 * 处理流程：
 * 1、建立单项上下文后调用统一重命名逻辑
 */
const startEditTemplateNameById = (templateId, templateType) => {
  // 1、通过菜单上下文复用对话框重命名流程
  contextMenuSingleItemId.value = templateId
  contextMenuTemplateType.value = templateType
  handleContextMenuRename()
}

/**
 * 在模板名称输入框失焦时提交修改。
 * 处理流程：
 * 1、切换到对应模板类型并读取新名称
 * 2、提交非空名称，失败时恢复原文本
 * 3、清除该类型的编辑标识
 */
const handleTemplateNameBlur = async (templateId, event, templateType) => {
  // 1、先切换到对应的模板存储类型
  if (templateType === 'template1') {
    activeTemplateType.value = 'actionTemplate'
  } else if (templateType === 'template2') {
    activeTemplateType.value = 'expressionTemplate'
  }
  
  const newName = event.target.value.trim()
  
  // 2、非空输入交给数据模块校验与保存
  if (newName && newName !== '') {
    const success = await renameTemplateFunc(templateId, newName)
    if (!success) {
      // 重命名失败，恢复原名称
      const template = templates.value.find(t => t.id === templateId)
      if (template) {
        event.target.value = template.name
      }
    }
  }
  
  // 3、清除对应类型的编辑状态
  if (templateType === 'template1') {
    editingTemplate1Id.value = null
  } else if (templateType === 'template2') {
    editingTemplate2Id.value = null
  }
}

// ==================== 初始化模板UI交互功能（已移除，使用上面的独立函数） ====================
// const {
//   startEditTemplateName,
//   handleTemplateNameBlur
// } = useTemplateUI({
//   templates,
//   editingTemplateId,
//   renameTemplate: renameTemplateFunc
// })

// ==================== 模板预览canvas管理 ====================
const templateCanvasRefs = ref({}) // 存储每个模板的canvas引用
const isRenderingTemplatePreview = ref(false) // 标志位：是否正在渲染模板预览
const isRenderingTemplate = ref(false) // 标志位：是否正在渲染模板（用于控制画布过渡动画）
const canvasOpacity = ref(1) // 画布不透明度（用于渲染模板时的过渡动画）

/**
 * 设置模板canvas的ref
 * 处理流程：
 * 1、挂载时缓存画布，卸载时删除引用
 */
const setTemplateCanvasRef = (templateId, el) => {
  // 1、按模板标识维护画布引用表
  if (el) {
    templateCanvasRefs.value[templateId] = el
  } else {
    delete templateCanvasRefs.value[templateId]
  }
}

/**
 * 渲染单个模板的预览图（使用 base64 预览图）
 * 处理流程：
 * 1、校验模板、PSD 和目标画布
 * 2、读取已有预览数据，加载后按原始图片尺寸绘制
 * 3、缺少预览时跳过，加载失败时记录错误
 * @param {Object} template - 模板对象
 * @param {Boolean} skipTransition - 是否跳过过渡动画（批量渲染时使用）
 */
const renderTemplatePreview = async (template, skipTransition = false) => {
  // 1、模板画布依赖视图挂载后才能绘制
  if (!template || !currentPsdData.value) return
  
  const canvas = templateCanvasRefs.value[template.id]
  if (!canvas) {
    console.warn('⚠️ 模板canvas未找到:', template.id)
    return
  }
  
  try {
    // 2、读取模板自身类型对应的预览数据并绘制
    const previewBase64 = await getTemplatePreview(template.id, template.templateType)
    if (previewBase64) {
      // 加载 base64 图片并渲染到 canvas
      const img = new Image()
      await new Promise((resolve, reject) => {
        img.onload = () => {
          // 设置canvas为图片尺寸
          canvas.width = img.width
          canvas.height = img.height
      
      const ctx = canvas.getContext('2d', { alpha: true })
          if (!ctx) {
            reject(new Error('无法获取Canvas 2D上下文'))
            return
          }
      
      // 设置高质量渲染
      ctx.imageSmoothingEnabled = true
      ctx.imageSmoothingQuality = 'high'
      
      // 清空画布
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      
          // 绘制图片
          ctx.drawImage(img, 0, 0)
          
          console.log('✅ 模板预览渲染完成（使用base64）:', template.name)
          resolve()
        }
        img.onerror = (error) => {
          console.warn('⚠️ 加载base64预览图失败:', error)
          reject(error)
        }
        img.src = previewBase64
      })
      return
    }
    
    // 3、没有已有预览时直接跳过，避免占用主画布重新生成
    console.log('⏭️ 跳过模板预览渲染（无base64预览图）:', template.name)
    
  } catch (error) {
    console.error('❌ 渲染模板预览失败:', template.id, error)
  }
}

/**
 * 静默应用模板配置（不触发标签页跳转）
 * 处理流程：
 * 1、校验配置并建立当前 PSD 的分组映射
 * 2、匹配目标部件并收集缺失项
 * 3、按模板类型与预览模式清理受影响分组
 * 4、显示配置中的图层，更新选择并按需提示缺失项
 * @param {Array} config - 模板配置
 * @param {Boolean} isForPreview - 是否用于预览渲染
 * @param {String} templateType - 模板类型（'actionTemplate' 或 'expressionTemplate'）
 * @param {Boolean} showMissingAlert - 是否显示缺失部件警告弹窗（默认false）
 * @returns {Object} 返回应用结果 { success: boolean, missingItems: Array }
 */
const applyTemplateConfigSilent = async (config, isForPreview = false, templateType = null, showMissingAlert = false) => {
  // 1、保证数据可用后建立标签与实际分组的映射
  if (!config || !Array.isArray(config) || !currentPsdData.value) {
    return { success: false, missingItems: [] }
  }
  
  // 标签名称到groupKey的映射
  const tabNameToKey = {}
  
  /**
   * 为静默应用选择实际存在的手部分组键。
   * 处理流程：
   * 1、依次检查标准与备用分组，返回首个包含部件的键
   */
  const detectHandGroupKey = (standardKey, alternatives) => {
    // 1、没有可用候选时保留标准键以便报告缺失
    for (const key of [standardKey, ...alternatives]) {
      if (allPartsListsMap.value[key] && allPartsListsMap.value[key].length > 0) {
        return key
      }
    }
    return standardKey // 兜底返回标准key
  }
  
  // 标准标签映射（使用智能检测）
  const standardMap = {
    '前手': detectHandGroupKey('frontHandNormal', ['frontHand']),
    '左手': detectHandGroupKey('frontHandNormal', ['frontHand']),
    '右手': detectHandGroupKey('frontHandRight', ['rightHand']),
    '双手': detectHandGroupKey('frontHandBoth', ['bothHands']),  // 🔧 关键：智能匹配双手
    '后手': detectHandGroupKey('backHand', []),
    '前层后手': detectHandGroupKey('frontLayerBackHand', []),
    '动作': 'action'
    // 注意：移除了上身和下身，模板不再管理这些
  }
  
  Object.assign(tabNameToKey, standardMap)
  
  // 添加动态表情标签映射
  if (dynamicExpressionTabs?.value) {
    for (const tab of dynamicExpressionTabs.value) {
      tabNameToKey[tab.label] = tab.key
    }
  }
  
  // 2、收集成功匹配的配置，同时保留缺失原因用于提示
  const configToApply = new Map() // groupKey -> [parts]
  // 收集缺失的部件信息
  const missingItems = [] // [{ tabName, missingParts: [] }]
  
  for (const item of config) {
    const { tabName, selectedParts: partNames } = item
    
    if (!tabName || !partNames || partNames.length === 0) {
      continue
    }
    
    const groupKey = tabNameToKey[tabName]
    if (!groupKey) {
      console.warn(`⚠️ 未找到标签"${tabName}"的groupKey映射`)
      missingItems.push({ 
        tabName, 
        missingParts: partNames,
        reason: '未找到对应的标签分组'
      })
      continue
    }
    
    const partsList = allPartsListsMap.value[groupKey]
    if (!partsList || partsList.length === 0) {
      console.warn(`⚠️ groupKey"${groupKey}"没有可用的部件列表`)
      missingItems.push({ 
        tabName, 
        missingParts: partNames,
        reason: '该标签下没有可用的部件'
      })
      continue
    }
    
    const parts = []
    const missingParts = []
    
    for (const partName of partNames) {
      const targetPart = partsList.find(p => 
        p.name === partName || 
        p.displayName === partName ||
        (p.displayName || p.name).includes(partName) ||
        partName.includes(p.displayName || p.name)
      )
      
      if (targetPart) {
        parts.push(targetPart)
      } else {
        missingParts.push(partName)
      }
    }
    
    if (parts.length > 0) {
      configToApply.set(groupKey, parts)
    }
    
    // 记录该标签下缺失的部件
    if (missingParts.length > 0) {
      missingItems.push({ 
        tabName, 
        missingParts,
        reason: '部件不存在'
      })
    }
  }
  
  // 总是排除的标签列表（不受模板影响，保持当前状态）
  const excludedKeys = ['upperBody', 'lowerBody']
  
  // 定义动作相关和表情相关的groupKey
  const actionGroupKeys = ['frontHandNormal', 'frontHandRight', 'frontHandBoth', 'bothHands', 
                           'backHand', 'frontLayerBackHand', 'action', 'handParts']
  
  // 判断是动作模板还是表情模板
  const isActionTemplate = templateType === 'actionTemplate' || templateType === 'template1' || 
                           activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
  const isExpressionTemplate = templateType === 'expressionTemplate' || templateType === 'template2' ||
                               activeTemplateType.value === 'expressionTemplate' || activeTemplateType.value === 'template2'
  
  // 3、根据模板类型和使用场景决定清空策略，上身与下身保持原状
  if (isForPreview) {
    // 预览模式：根据模板类型清空对应的标签（避免堆叠）
    let groupKeysToClear = []
    
    if (isActionTemplate) {
      // 动作模板：只清空动作相关的标签，保留表情
      groupKeysToClear = actionGroupKeys
    } else if (isExpressionTemplate) {
      // 表情模板：只清空表情相关的标签，保留动作
      groupKeysToClear = Object.keys(allPartsListsMap.value).filter(key => 
        !excludedKeys.includes(key) && !actionGroupKeys.includes(key)
      )
    } else {
      // 未知类型：清空所有（兼容旧逻辑）
      groupKeysToClear = Object.keys(allPartsListsMap.value).filter(key => 
        !excludedKeys.includes(key)
      )
    }
    
    // 清空指定的标签
    for (const groupKey of groupKeysToClear) {
      const partsList = allPartsListsMap.value[groupKey]
      
      // 隐藏该分组的所有图层
      if (partsList && Array.isArray(partsList)) {
        for (const part of partsList) {
          if (part && part.path) {
            setLayerVisibilityByPath(part.path, false)
          }
        }
      }
      
      // 清空selectedParts
      if (Array.isArray(selectedParts.value[groupKey])) {
        selectedParts.value[groupKey] = []
      } else {
        selectedParts.value[groupKey] = null
      }
    }
  } else {
    // 应用模式：只清空模板中配置的分组（保持其他部分不变）
    for (const [groupKey, parts] of configToApply.entries()) {
      // 跳过排除的标签
      if (excludedKeys.includes(groupKey)) {
        continue
      }
      
      // 隐藏该分组的所有图层
      const partsList = allPartsListsMap.value[groupKey]
      if (partsList && Array.isArray(partsList)) {
        for (const part of partsList) {
          if (part && part.path) {
            setLayerVisibilityByPath(part.path, false)
          }
        }
      }
      
      // 清空该分组的selectedParts
      if (Array.isArray(selectedParts.value[groupKey])) {
        selectedParts.value[groupKey] = []
      } else {
        selectedParts.value[groupKey] = null
      }
    }
  }
  
  // 4、显示模板配置中指定的图层，并同步选择与缺失提示
  for (const [groupKey, parts] of configToApply.entries()) {
    // 跳过排除的标签
    if (excludedKeys.includes(groupKey)) {
      continue
    }
    
    for (const part of parts) {
      if (part && part.path) {
        setLayerVisibilityByPath(part.path, true)
      }
    }
    
    // 更新selectedParts（用于UI显示选中状态）
    const isMultiSelect = Array.isArray(selectedParts.value[groupKey])
    if (isMultiSelect) {
      selectedParts.value[groupKey] = parts
    } else {
      selectedParts.value[groupKey] = parts[0] || null
    }
  }
  
  // 如果需要显示缺失警告，且有缺失项，则显示气泡提示
  if (showMissingAlert && missingItems.length > 0) {
    // 判断是动作模板还是表情模板
    const isActionTemplate = templateType === 'actionTemplate' || templateType === 'template1' || 
                             activeTemplateType.value === 'actionTemplate' || activeTemplateType.value === 'template1'
    const templateTypeName = isActionTemplate ? '动作' : '表情'
    
    // 构建简洁的缺失信息文本
    const missingTexts = missingItems.map(item => {
      return `【${item.tabName}】${item.missingParts.join('、')}`
    })
    
    // 显示气泡提示
    message.warning(`模板已部分应用，缺少${templateTypeName}：${missingTexts.join('；')}`, {
      duration: 5000
    })
    
    console.warn(`⚠️ 模板应用时发现 ${missingItems.length} 个缺失项`)
  }
  
  return { success: true, missingItems }
}

/**
 * 渲染指定模板列表的预览图（直接使用 Base64 数据）
 * 处理流程：
 * 1、由显式参数或当前标签确定目标模板列表
 * 2、等待画布挂载后依次绘制各模板预览
 * @param {'template1' | 'template2' | null} targetType - 目标模板类型；为空时根据当前标签判断
 */
const renderAllTemplatesPreviews = async (targetType = null) => {
  // 1、没有目标类型或目标列表为空时跳过
  let templateType = targetType
  if (!templateType) {
    if (currentTab.value === 'template1') templateType = 'template1'
    if (currentTab.value === 'template2') templateType = 'template2'
  }
  
  if (!templateType) return
  
  const targetTemplates = templateType === 'template1' ? templates1.value : templates2.value
  if (!targetTemplates || targetTemplates.length === 0) return
  
  await nextTick()
  
  // 2、依次等待单项预览绘制，避免同时处理全部图片
  for (const template of targetTemplates) {
    await renderTemplatePreview(template, true)
  }
}

// 将渲染函数赋值给 ref，供 useTemplateData 使用
renderTemplatesPreviewsRef.value = renderAllTemplatesPreviews

// 🔧 标记：是否正在添加模板（用于避免watch重复渲染）
const isAddingTemplate = ref(false)

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

/**
 * 保存当前PSD文件的状态
 * 处理流程：
 * 1、校验文件标识
 * 2、深拷贝图层树和交互状态，并保存当前标签与通用控制
 */
const savePsdState = (psdId) => {
  // 1、缺少文件标识时不创建缓存项
  if (!psdId) return
  
  console.log('💾 保存PSD状态:', psdId)
  
  // 2、以文件标识隔离状态，避免切换文件后继续共享可变树节点
  psdStatesCache.value[psdId] = {
    // 图层树visible状态（唯一数据源）
    layerTreeData: JSON.parse(JSON.stringify(layerTreeData.value)),
    // 当前标签页
    currentTab: currentTab.value,
    // 通用控制状态（使用 composable 的方法）
    commonControls: getCommonControlsState(),
    // 用户交互状态
    userInteracted: JSON.parse(JSON.stringify(userInteracted.value)),
    // 保存时间戳
    savedAt: Date.now()
  }
  
  console.log('✅ PSD状态已保存')
}

/**
 * 恢复PSD文件的状态
 * 处理流程：
 * 1、按文件标识查找保存的状态
 * 2、还原图层树、当前标签、通用控制及用户交互状态
 */
const restorePsdState = (psdId) => {
  // 1、没有历史状态时保留本次载入的默认状态
  if (!psdId) return
  
  const savedState = psdStatesCache.value[psdId]
  if (!savedState) {
    console.log('⚠️ 没有找到PSD的保存状态，使用默认状态')
    return
  }
  
  console.log('📂 恢复PSD状态:', psdId)
  
  // 2、恢复图层树及其相关的界面控制状态
  if (savedState.layerTreeData) {
    layerTreeData.value = JSON.parse(JSON.stringify(savedState.layerTreeData))
  }
  
  // 恢复当前标签页
  currentTab.value = savedState.currentTab
  
  // 恢复通用控制状态（使用 composable 的方法）
  restoreCommonControlsState(savedState.commonControls)
  
  // 恢复用户交互状态
  userInteracted.value = JSON.parse(JSON.stringify(savedState.userInteracted))
  
  console.log('✅ PSD状态已恢复')
}
/**
 * 切换PSD文件
 * 处理流程：
 * 1、保存旧文件状态，载入新数据并重建图层树
 * 2、恢复缓存分类并按表情类型协调初始可见性
 * 3、调整画布尺寸，重置交互及预设模板选择
 * 4、恢复该文件已保存状态，异步加载预设模板后校验目标并重绘
 */
const switchPsdFile = (psdFile) => {
  // 1、相同文件不重复切换，切换前保存旧文件状态
  if (currentPsdFile.value?.id === psdFile.id) return
  
  // 保存当前PSD的状态
  if (currentPsdFile.value) {
    savePsdState(currentPsdFile.value.id)
  }
  
  console.log('🔄 切换PSD文件:', psdFile.name)
  
  // 从缓存读取数据
  currentPsdFile.value = psdFile
  currentPsdData.value = markRaw(psdFile.data)
  
  // 重置预览窗口的视图状态（滚动条和缩放）
  // 在 PSD 数据改变后立即发送重置命令，避免不同PSD尺寸导致的画布显示问题
  resetPreviewWindowViewport()
  
  // 构建图层树
  layerTreeData.value = buildLayerTree(psdFile.data)
  
  // 2、从缓存读取部件分类并恢复类型互斥关系
  const cachedParts = psdPartsCache.value[psdFile.id]
  if (cachedParts) {
    // 使用 updatePartsFromClassifyResult 方法更新部件状态
    updatePartsFromClassifyResult(cachedParts)
    
    // 强制重置标签排序标志，确保标签能够根据最新的parts数据重新计算显示
    // 修复：初始化时标签显示不全的问题
    initialSorted.value = false
    
    // 同步背景、背面、侧面控制状态，以及表情图组的部件 hidden 属性
    // 确保按钮状态、图层树和部件列表三者保持一致
    syncBackgroundControlFromLayerTree(dynamicExpressionParts.value)
    
    // 🔧 修复：如果有多个表情组，按类型互斥（眉/眼/嘴可共存，同类型互斥）
    // 避免绿色小圆点显示错误
    if (cachedParts.expressionTabs && cachedParts.expressionTabs.length > 1) {
      console.log(`🔧 [切换PSD] 检测到 ${cachedParts.expressionTabs.length} 个表情组，应用表情类型互斥规则`)
      
      // 按类型分组检查可见的表情组，优先记录首个可见的分组
      const typeToVisibleGroup = new Map() // key -> { tab, visibleLayers, index }
      const cachedMetaAnalysis = buildExpressionMeta(cachedParts.expressionTabs || [], cachedParts.expressions || {})
      const cachedMetaMap = cachedMetaAnalysis.metaMap
      let standaloneVisibleInfo = null
      
      for (let i = 0; i < cachedParts.expressionTabs.length; i++) {
        const tab = cachedParts.expressionTabs[i]
        const tabKey = tab.key
        const partsList = cachedParts.expressions[tabKey] || []
        const meta = cachedMetaMap.get(tab.key) || {}
        const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')
        
        const visibleLayers = []
        partsList.forEach(part => {
          if (!part || !part.path || !layerTreeData.value) return
          
          const pathParts = part.path.split('/')
          let layers = layerTreeData.value
          let found = false
          
          for (let j = 0; j < pathParts.length; j++) {
            const layer = layers.find(l => l.uniqueName === pathParts[j])
            if (!layer) break
            
            if (j === pathParts.length - 1) {
              found = layer.userVisible && layer.visible
              if (found) {
                visibleLayers.push(part)
              }
            } else if (layer.children) {
              layers = layer.children
            } else {
              break
            }
          }
        })
        
        if (visibleLayers.length > 0) {
          console.log(`  ✅ 表情组 ${tab.label} (类型: ${exprTypeKey}) 有 ${visibleLayers.length} 个可见图层`)
          
          if (!typeToVisibleGroup.has(exprTypeKey)) {
            typeToVisibleGroup.set(exprTypeKey, { tab, visibleLayers, index: i })
          } else {
            console.log(`  ⚠️ 类型 ${exprTypeKey} 已有可见表情组，将隐藏: ${tab.label}`)
          }
        }
      }

      standaloneVisibleInfo = typeToVisibleGroup.get('standalone') || null
      
      if (typeToVisibleGroup.size === 0) {
        console.log(`  ℹ️ 没有检测到可见的表情组，保持原始PSD状态（不主动开启表情）`)
      } else {
        console.log(`  🔧 应用类型互斥规则，共 ${typeToVisibleGroup.size} 个类别有可见表情组`)
      }
      
      for (let i = 0; i < cachedParts.expressionTabs.length; i++) {
        const tab = cachedParts.expressionTabs[i]
        const tabKey = tab.key
        const partsList = cachedParts.expressions[tabKey] || []
        const meta = cachedMetaMap.get(tab.key) || {}
        const exprTypeKey = meta.isStandalone ? 'standalone' : (meta.baseCategory || meta.exprType || 'other')
        
        const visibleGroup = standaloneVisibleInfo && exprTypeKey !== 'standalone'
          ? null
          : typeToVisibleGroup.get(exprTypeKey)
        
        if (visibleGroup && visibleGroup.index === i) {
          console.log(`    ✅ 保持表情组 ${tab.label} (类型: ${exprTypeKey}) 可见`)
          
          const visiblePaths = new Set(visibleGroup.visibleLayers.map(p => p.path))
          
          partsList.forEach(part => {
            if (part && part.path && !visiblePaths.has(part.path)) {
              setLayerVisibilityByPath(part.path, false)
            }
          })
          
          if (tab.path) {
            setLayerVisibilityByPath(tab.path, true)
          }
        } else {
          console.log(`    🔧 隐藏表情组 ${tab.label} (类型: ${exprTypeKey}), 共 ${partsList.length} 个图层`)
          
          partsList.forEach(part => {
            if (part && part.path) {
              setLayerVisibilityByPath(part.path, false)
            }
          })
        }
      }
    }
    
    console.log('📦 已加载动态分组:', {
      前手: dynamicFrontHandTabs.value.length,
      后手: dynamicBackHandTabs.value.length,
      双手: dynamicBothHandsTabs.value.length,
      上身: dynamicUpperBodyTabs.value.length,
      下身: dynamicLowerBodyTabs.value.length,
      动作: dynamicActionTabs.value.length
    })
  }
  
  // 3、更新画布尺寸并为新文件重置临时交互状态
  if (psdFile.data.width && psdFile.data.height) {
    canvasWidth.value = psdFile.data.width
    canvasHeight.value = psdFile.data.height
    
    // 计算Canvas显示尺寸（固定占据60%窗口高度，保持16:9宽高比）
    updateCanvasDisplaySize()
  }
  
  // 重置用户交互状态
  const baseUserInteracted = {
    frontHandNormal: false,
    frontHandRight: false,
    frontHandBoth: false,
    backHand: false,
    frontLayerBackHand: false,
    bothHands: false,
    upperBody: false,
    lowerBody: false,
    action: false
  }
  
  // 动态添加表情图组的交互状态
  dynamicExpressionTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  
  // 动态添加其他分组的交互状态
  dynamicFrontHandTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  dynamicBackHandTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  dynamicBothHandsTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  dynamicUpperBodyTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  dynamicLowerBodyTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  dynamicActionTabs.value.forEach(tab => {
    baseUserInteracted[tab.key] = false
  })
  
  userInteracted.value = baseUserInteracted
  
  // 立即清空预设状态，防止旧预设污染新PSD的渲染
  selectedPresetId.value = null
  editingPresetId.value = null
  presets.value = []
  console.log('🧹 已清空预设状态，防止污染')
  
  // 立即清空模板状态，防止旧模板污染新PSD的渲染
  selectedTemplate1Id.value = null
  selectedTemplate2Id.value = null
  editingTemplate1Id.value = null
  editingTemplate2Id.value = null
  // 注意：不清空templates1和templates2，因为它们是全局的，不属于特定PSD
  console.log('🧹 已清空模板选中状态，防止污染')
  
  // 4、尝试恢复保存的状态，再加载该文件对应的预设与全局模板
  restorePsdState(psdFile.id)
  
  // 如果没有保存的状态，使用默认选中逻辑
  if (!psdStatesCache.value[psdFile.id]) {
    // 默认选中：优先选择有绿色小圆点的分组，否则选择第一个存在的分组
    const defaultTabKey = getFirstDefaultTabKey()
    currentTab.value = defaultTabKey
  }
  
  // 使用 nextTick 确保 presetsStorageKey 已经更新
  nextTick(async () => {
    // 确保当前PSD文件ID，用于验证预设加载的正确性
    const currentPsdId = psdFile.id
    console.log('🔄 开始为PSD加载预设和模板:', currentPsdId, psdFile.name)
    
    // 加载预设列表（但不自动选中）
    await loadPresets()
    
    // 加载模板列表（但不自动选中）
    await loadTemplates()
    
    // 验证当前PSD是否仍然是目标PSD（防止快速切换导致的数据混乱）
    if (currentPsdFile.value?.id === currentPsdId) {
      console.log('✅ 预设和模板加载完成，PSD ID验证通过:', currentPsdId)
      console.log('📝 当前PSD预设数量:', presets.value.length, '模板数量:', templates.value.length)
    } else {
      console.warn('⚠️ PSD已切换，忽略过期的预设和模板数据:', currentPsdId)
      return
    }
    
    // 渲染完整画面（显示PSD原本的可见图层）
    setTimeout(() => {
      // 再次验证PSD ID
      if (currentPsdFile.value?.id === currentPsdId) {
        renderAllLayers()
      }
    }, 100)
  })
  
  message.success(`已切换到 ${psdFile.name}`)
}

/**
 * 移除PSD文件
 * 处理流程：
 * 1、从打开列表和分类状态缓存中移除目标文件
 * 2、当前文件被移除时切换剩余文件，或清空部件、选择和画布
 * 3、提示文件已经移除
 */
const removePsdFile = (psdId) => {
  // 1、定位文件并删除其列表记录与缓存
  const index = psdFiles.value.findIndex(f => f.id === psdId)
  if (index === -1) return
  
  const fileName = psdFiles.value[index].name
  console.log('🗑️ 移除PSD文件:', fileName)
  
  // 从列表中移除
  psdFiles.value.splice(index, 1)
  
  // 从缓存中移除
  delete psdPartsCache.value[psdId]
  
  // 从状态缓存中移除
  delete psdStatesCache.value[psdId]
  console.log('🗑️ 已清除PSD状态缓存')
  
  // 2、如果移除的是当前文件，切换到其他文件或清空
  if (currentPsdFile.value?.id === psdId) {
    if (psdFiles.value.length > 0) {
      // 切换到第一个文件
      switchPsdFile(psdFiles.value[0])
    } else {
      // 没有文件了，清空所有状态
      currentPsdFile.value = null
      currentPsdData.value = null
      
      // 使用 clearAllPartsState 方法清空部件状态
      clearAllPartsState()
      
      // 重置标签排序标志，确保下次加载PSD时能正确显示标签
      initialSorted.value = false
      
      /**
       * 将剩余图层树递归设置为不可见。
       * 处理流程：
       * 1、隐藏当前层级节点并递归子分组
       */
      const resetLayerTreeVisibility = (layers) => {
        // 1、清除最后一个文件遗留的图层显示
        layers.forEach(layer => {
          layer.visible = false
          if (layer.children && layer.children.length > 0) {
            resetLayerTreeVisibility(layer.children)
          }
        })
      }
      if (layerTreeData.value) {
        resetLayerTreeVisibility(layerTreeData.value)
      }
      
      userInteracted.value = {
        frontHandNormal: false,
        frontHandRight: false,
        frontHandBoth: false,
        backHand: false,
        frontLayerBackHand: false,
        bothHands: false,
        upperBody: false,
        lowerBody: false,
        action: false
      }
      
      // 清空预设列表
      presets.value = []
      selectedPresetId.value = null
      editingPresetId.value = null
      console.log('🗑️ 已清空预设列表')
      
      // 清空模板选中状态（不清空模板列表，因为它们是全局的）
      selectedTemplate1Id.value = null
      selectedTemplate2Id.value = null
      editingTemplate1Id.value = null
      editingTemplate2Id.value = null
      console.log('🗑️ 已清空模板选中状态')
      
      // 清空画布
      const canvas = canvasRef.value
      if (canvas) {
        const ctx = canvas.getContext('2d')
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }
  }
  
  // 3、报告本次移除的文件名
  message.success(`已移除 ${fileName}`)
}

/**
 * 切换标签页
 * 处理流程：
 * 1、设置当前标签，必要时清除预设选择并重绘
 * 2、离开模板区域时清除模板选中标识
 * 3、记录目标分组的当前选择情况
 */
const switchTab = (tabKey) => {
  // 1、更新标签并处理预设退出后的画布恢复
  currentTab.value = tabKey
  console.log('🔄 切换到:', tabKey)
  
  // 如果切换到非预设标签页，清除预设选择
  if (tabKey !== 'presets') {
    if (selectedPresetId.value) {
      console.log('🔄 切换到非预设标签页，清除预设选择')
      selectedPresetId.value = null
      // 只有在清除预设时才需要重新渲染
      queueRenderAllLayers()
    }
  }
  
  // 2、如果切换到非模板标签页，清除模板选择
  if (tabKey !== 'template1' && tabKey !== 'template2') {
    if (selectedTemplate1Id.value) {
      console.log('🔄 切换到非模板标签页，清除动作模板选择')
      selectedTemplate1Id.value = null
    }
    if (selectedTemplate2Id.value) {
      console.log('🔄 切换到非模板标签页，清除表情模板选择')
      selectedTemplate2Id.value = null
    }
  }
  
  // 优化：切换标签本身不需要重新渲染画布
  // 画布内容由选中的部件决定，不由当前标签决定
  // 只有当切换标签导致选中部件变化时（如清除预设），才需要渲染
  
  // 3、输出目标分组的选择状态供交互排查
  const selectedInGroup = selectedParts.value[tabKey]
  if (selectedInGroup) {
    console.log('🔄 该分组当前显示:', selectedInGroup.name)
  } else {
    console.log('🔄 该分组暂无显示部件')
  }
}

// 双击检测相关变量
let tabClickTimer = null
let tabClickCount = 0
let lastClickedTab = null

/**
 * 处理标签页点击事件（支持单击切换和双击取消）
 * 处理流程：
 * 1、切换点击目标时清理上次计数和定时器
 * 2、首次点击立即切换，并开启双击检测窗口
 * 3、窗口内第二次点击清理计数并取消分组选中
 */
const handleTabClick = async (tabKey) => {
  // 1、如果点击的是不同的标签，重置计数
  if (lastClickedTab !== tabKey) {
    tabClickCount = 0
    lastClickedTab = tabKey
    if (tabClickTimer) {
      clearTimeout(tabClickTimer)
      tabClickTimer = null
    }
  }
  
  tabClickCount++
  
  // 2、立即执行单击，并保留短时间内第二次点击的双击检测
  if (tabClickCount === 1) {
    // 第一次点击：立即切换标签（无延迟）
    switchTab(tabKey)
    
    // 设置双击检测窗口（150ms内的第二次点击视为双击）
    if (tabClickTimer) {
      clearTimeout(tabClickTimer)
    }
    tabClickTimer = setTimeout(() => {
      // 超时后重置计数
      tabClickCount = 0
      lastClickedTab = null
    }, 150) // 缩短到150ms，提升响应速度
  } else if (tabClickCount === 2) {
    // 3、第二次点击时取消该组所有图层，并清理检测状态
    if (tabClickTimer) {
      clearTimeout(tabClickTimer)
      tabClickTimer = null
    }
    tabClickCount = 0
    lastClickedTab = null
    await handleTabDoubleClick(tabKey)
  }
}
/**
 * 处理标签页双击事件，快捷取消该组件内所有选中的图层（支持代理机制）
 * 处理流程：
 * 1、排除预设模板标签，并建立动态分组名称映射
 * 2、检查主分组和代理分组当前是否有显示内容
 * 3、有内容时隐藏相关分组、标记用户操作并重绘，否则提示空状态
 */
const handleTabDoubleClick = async (tabKey) => {
  // 1、预设与模板不提供双击清空操作
  console.log('👆 双击标签页:', tabKey)
  
  // 预设和模板标签页特殊处理：不支持双击取消，直接返回
  if (tabKey === 'presets' || tabKey === 'template1' || tabKey === 'template2') {
    console.log('ℹ️ 预设/模板标签页不支持双击取消')
    return
  }
  
  // 构建标签名称映射（包含动态表情图组）
  const tabNames = {
    frontHandNormal: '左手',
    frontHandRight: '右手',
    frontHandBoth: '双手',
    backHand: '右手',
    frontLayerBackHand: '右手',
    bothHands: '双手',
    upperBody: '上身',
    lowerBody: '下身',
    action: '动作',
    presets: '预设'
  }
  
  // 动态添加表情图组的名称
  dynamicExpressionTabs.value.forEach(tab => {
    tabNames[tab.key] = tab.label
  })
  
  // 动态添加其他分组的名称（仅前手、后手、双手，已禁用，保留代码兼容性）
  dynamicFrontHandTabs.value.forEach(tab => {
    tabNames[tab.key] = tab.label
  })
  dynamicBackHandTabs.value.forEach(tab => {
    tabNames[tab.key] = tab.label
  })
  dynamicBothHandsTabs.value.forEach(tab => {
    tabNames[tab.key] = tab.label
  })
  // 注意：动作、上身、下身不支持动态标签，已移除
  
  // 2、结合用户操作状态、默认可见性与代理分组检查显示内容
  const currentSelected = selectedParts.value[tabKey]
  const hasInteracted = userInteracted.value[tabKey]
  
  // 查找当前标签页配置（用于代理机制）
  const currentTabConfig = partTabs.value.find(tab => tab.key === tabKey)
  
  // 判断是否有渲染内容（与绿色小圆点的显示逻辑保持一致）
  let mainHasContent = false
  let proxyHasContent = false
  
  // 检查主分组是否有内容
  if (hasInteracted) {
    // 如果用户操作过，检查是否有选中的图层
    mainHasContent = currentSelected !== null && currentSelected !== undefined
  } else {
    // 如果用户没有操作过，检查是否有默认可见的图层
    let partsList = []
    
    // 先检查是否是动态表情图组
    if (currentTabConfig?.isExpression && dynamicExpressionParts.value[tabKey]) {
      partsList = dynamicExpressionParts.value[tabKey]
    } 
    // 检查是否是动态分组（只检查动态标签，基础标签走 switch）
    // 注意：仅前手、后手、双手支持动态分组（已禁用），动作、上身、下身不支持
    else if (currentTabConfig?.isDynamic) {
      // 动态分组根据 groupType 获取对应数据
      if (currentTabConfig.groupType === 'frontHand' && dynamicFrontHandParts.value[tabKey]) {
        partsList = dynamicFrontHandParts.value[tabKey]
      }
      else if (currentTabConfig.groupType === 'backHand' && dynamicBackHandParts.value[tabKey]) {
        partsList = dynamicBackHandParts.value[tabKey]
      }
      else if (currentTabConfig.groupType === 'bothHands' && dynamicBothHandsParts.value[tabKey]) {
        partsList = dynamicBothHandsParts.value[tabKey]
      }
    }
    else {
      // 否则使用固定的switch分支
      switch (tabKey) {
      case 'combinedExpressions': {
        // 组合表情：清空所有表情分组
        const allExpressionKeys = dynamicExpressionTabs.value.map(tab => tab.key)
        const groupsToHide = allExpressionKeys
        groupsToHide.forEach(groupKey => {
          const partsList = allPartsListsMap.value[groupKey] || []
          partsList.forEach(p => {
            if (p && p.path) {
              setLayerVisibilityByPath(p.path, false)
            }
          })
          // 标记该分组已被用户手动操作
          userInteracted.value[groupKey] = true
          console.log(`✅ 取消分组: ${groupKey}`)
        })
        console.log('✅ 已取消 组合表情 内所有显示的图层')
        await renderAllLayers()
        return
      }
        case 'frontHandNormal':
          partsList = frontHandNormalParts.value
          break
        case 'frontHandRight':
          partsList = frontHandRightParts.value
          break
        case 'frontHandBoth':
          partsList = frontHandBothParts.value
          break
        case 'backHand':
          partsList = backHandParts.value
          break
        case 'frontLayerBackHand':
          partsList = frontLayerBackHandParts.value
          break
        case 'bothHands':
          partsList = bothHandsParts.value
          break
        case 'upperBody':
          partsList = upperBodyParts.value
          break
        case 'lowerBody':
          partsList = lowerBodyParts.value
          break
        case 'action':
          partsList = actionParts.value
          break
      }
    }
    // 检查是否有非隐藏的图层（默认可见）
    mainHasContent = partsList.some(p => !p.hidden)
  }
  
  // 检查代理目标是否有内容（支持多个代理目标）
  if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
    proxyHasContent = currentTabConfig.proxyTargets.some(proxyTarget => {
      const proxySelected = selectedParts.value[proxyTarget]
      const proxyInteracted = userInteracted.value[proxyTarget]
      
      if (proxyInteracted) {
        return proxySelected !== null && proxySelected !== undefined
      } else {
        let proxyPartsList = []
        switch (proxyTarget) {
          case 'backHand':
            proxyPartsList = backHandParts.value
            break
          case 'frontLayerBackHand':
            proxyPartsList = frontLayerBackHandParts.value
            break
          case 'bothHands':
            proxyPartsList = bothHandsParts.value
            break
        }
        return proxyPartsList.some(p => !p.hidden)
      }
    })
  }
  
  // 主分组或代理目标有内容即算有内容
  const hasContent = mainHasContent || proxyHasContent
  
  // 3、存在显示内容时统一隐藏主分组和代理分组并重新绘制
  if (hasContent) {
    // 收集需要隐藏的分组（主分组 + 代理分组）
    const groupsToHide = [tabKey]
    if (currentTabConfig?.proxyTargets && currentTabConfig.proxyTargets.length > 0) {
      groupsToHide.push(...currentTabConfig.proxyTargets)
    }
    
    // 隐藏这些分组的所有部件图层
    groupsToHide.forEach(groupKey => {
      const partsList = allPartsListsMap.value[groupKey] || []
      partsList.forEach(p => {
        if (p && p.path) {
          setLayerVisibilityByPath(p.path, false)
        }
      })
      
      // 标记该分组已被用户手动操作
      userInteracted.value[groupKey] = true
      console.log(`✅ 取消分组: ${groupKey}`)
    })
    
    console.log(`✅ 已取消 ${tabKey} 组件内所有显示的图层`)
    
    message.success(`已取消 ${tabNames[tabKey] || tabKey} 组件内所有显示的图层`, {
      duration: 2000
    })
    
    // 重新渲染画布
    await renderAllLayers()
  } else {
    console.log(`ℹ️ ${tabKey} 组件当前没有显示的图层`)
    message.info(`${tabNames[tabKey] || tabKey} 当前没有显示的图层`, {
      duration: 2000
    })
  }
}

/**
 * 根据路径设置图层可见性
 * 处理流程：
 * 1、按唯一路径查找目标，相同状态跳过更新
 * 2、递归修改目标用户状态，并结合正面控制计算显示状态
 * 3、同步 PSD 原始数据及必要的祖先可见性，报告未匹配路径
 */
const setLayerVisibilityByPath = (path, visible) => {
  // 1、校验路径并检查是否需要实际修改
  if (!path) return
  
  const pathParts = path.split('/')
  
  /**
   * 沿唯一路径递归查找目标图层。
   * 处理流程：
   * 1、逐层匹配唯一名称，到达末段时返回节点
   */
  const findLayer = (layers, pathIndex = 0) => {
    // 1、仅在当前路径命中的子树中继续查找
    for (const layer of layers) {
      if (layer.uniqueName === pathParts[pathIndex]) {
        if (pathIndex === pathParts.length - 1) {
          return layer
        }
        if (layer.children && layer.children.length > 0) {
          const found = findLayer(layer.children, pathIndex + 1)
          if (found) return found
        }
      }
    }
    return null
  }
  
  const existingLayer = findLayer(layerTreeData.value || [])
  if (existingLayer && existingLayer.visible === visible && existingLayer.userVisible === visible) {
    return
  }
  
  /**
   * 更新路径目标及其祖先的显示状态。
   * 处理流程：
   * 1、沿路径递归收集祖先，到达目标后按需开启祖先
   * 2、更新目标用户状态、最终可见性及 PSD 原始数据
   * 3、隐藏目标时自下而上关闭没有可见子项的祖先
   */
  const updateVisibility = (layers, pathIndex = 0, currentPath = [], ancestorsToUpdate = []) => {
    // 1、沿唯一名称逐层定位，保留完整祖先链
    for (let layer of layers) {
      if (layer.uniqueName === pathParts[pathIndex]) {
        if (pathIndex === pathParts.length - 1) {
          // 到达目标图层
          
          // 🔧 如果设置为可见，先确保所有祖先图层都可见
          // 注意：只设置 visible，不设置 userVisible，因为这不是用户的主动选择
          if (visible && ancestorsToUpdate.length > 0) {
            ancestorsToUpdate.forEach((ancestor, index) => {
              if (!ancestor.visible) {
                // 只设置 visible，不修改 userVisible
                // 这样 selectedParts 计算时不会误认为父级图层组被选中
                ancestor.visible = true
                
                // 同步更新PSD底层数据中的祖先图层
                if (currentPsdData.value?.layerHierarchy) {
                  const ancestorPath = pathParts.slice(0, index + 1)
                  updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, ancestorPath, 0, true)
                }
              }
            })
          }
          
          // 2、设置目标图层的用户操作状态并同步最终显示结果
          layer.userVisible = visible
          
          // 计算最终visible（考虑正面控制）
          const fullPath = [...currentPath, layer.uniqueName].join('/')
          const isSpecialGroup = /(侧面|侧身|侧视|背面|背影|背身|背视|后面|背景|武器|阴影|摇摇头|持剑|后手持剑|下压挥剑|后发|后头发|发型后)/.test(fullPath)
          
          if (showFront.value || isSpecialGroup) {
            layer.visible = visible
          } else {
            // 正面关闭时，非特殊图组强制隐藏
            layer.visible = false
          }
          
          // 同步更新PSD底层数据中的目标图层
          if (currentPsdData.value?.layerHierarchy) {
            updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, pathParts, 0, visible)
          }
          
          // 3、如果设置为不可见，检查并更新祖先图层的可见性
          // 如果父级图层组没有任何可见的子图层了，也应该将父级设置为不可见
          if (!visible && ancestorsToUpdate.length > 0) {
            // 从最深的祖先开始向上检查
            for (let i = ancestorsToUpdate.length - 1; i >= 0; i--) {
              const ancestor = ancestorsToUpdate[i]
              
              // 检查该祖先是否还有其他可见的子图层
              const hasVisibleChildren = ancestor.children && ancestor.children.some(child => child.visible || child.userVisible)
              
              if (!hasVisibleChildren) {
                // 没有可见的子图层了，将父级也设置为不可见
                ancestor.visible = false
                // 注意：不修改 ancestor.userVisible，保持用户的原始选择
                
                // 同步更新PSD底层数据
                if (currentPsdData.value?.layerHierarchy) {
                  const ancestorPath = pathParts.slice(0, i + 1)
                  updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, ancestorPath, 0, false)
                }
              } else {
                // 还有可见的子图层，不需要继续向上检查
                break
              }
            }
          }
          
          return true
        } else if (layer.children && layer.children.length > 0) {
          // 将当前图层添加到祖先列表中
          const newAncestors = [...ancestorsToUpdate, layer]
          
          return updateVisibility(layer.children, pathIndex + 1, [...currentPath, layer.uniqueName], newAncestors)
        }
      }
    }
    return false
  }
  
  // 2、更新目标与祖先，并通过内部流程同步 PSD 原始层级
  const result = updateVisibility(layerTreeData.value)
  // 3、记录无法匹配的路径，便于排查模板与 PSD 不一致
  if (!result) {
    console.warn(`⚠️ [setLayerVisibilityByPath] 未找到路径: ${path}`)
  }
}

/**
 * 选择组合表情（一次性选择/取消多个分组的子图层）
 * 处理流程：
 * 1、判断整组是否已选中并标记用户操作
 * 2、根据互斥模式清理同类或同组部件，再切换所选子项
 * 3、等待合并渲染并同步独立预览窗口
 */
const selectCombinedExpression = async (combinedPart) => {
  // 1、校验组合数据，并以所有子项是否选中决定取消或应用
  if (!combinedPart || !Array.isArray(combinedPart.items) || combinedPart.items.length === 0) return

  try {
    // 是否为取消：全部子项都已选中
    const isDeselecting = combinedPart.items.every(({ groupKey, part }) => {
      const sel = selectedParts.value[groupKey]
      return sel && sel.path === part.path
    })

    // 标记涉及到的分组为用户已操作
    combinedPart.items.forEach(({ groupKey }) => {
      userInteracted.value[groupKey] = true
    })

    // 2、按互斥开关决定清理范围，再批量切换组合子项
    if (exclusiveMode.value) {
      if (isDeselecting) {
        // 取消：直接全部关闭
        combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, false))
      } else {
        // 组合表情在互斥开启时，仅在各自类别内部互斥，不跨类别清空
        if (expressionExclusiveMode.value) {
          // 构建类别 -> 该类别所有表情组keys（仅考虑眉/眼/嘴三大类）
          const typeToKeys = {}
          enhancedExpressionTabs.value.forEach(tab => {
            const meta = expressionTabMetaMap.value[tab.key] || {}
            if (meta?.isStandalone) return
            const category = meta?.baseCategory
            if (!category) return
            if (!typeToKeys[category]) typeToKeys[category] = []
            typeToKeys[category].push(tab.key)
          })
          // 对每个被选中的类别，清理该类别下所有组的其它部件
          // 🔧 修复：只有组合表情中实际选中的分组才能保留同path的部件
          combinedPart.items.forEach(({ groupKey, part }) => {
            const meta = expressionTabMetaMap.value[groupKey] || {}
            const category = meta?.baseCategory
            const keys = category ? (typeToKeys[category] || []) : []
            keys.forEach(k => {
              const list = allPartsListsMap.value[k] || []
              list.forEach(p => {
                if (p && p.path) {
                  // 只有当前组合表情项对应的分组才能保留同path的部件
                  const shouldKeep = (k === groupKey) && (p.path === part.path)
                  if (!shouldKeep) {
                    setLayerVisibilityByPath(p.path, false)
                  }
                }
              })
            })
          })
        } else {
          // 非表情互斥，仅清理同组的其它部件
          // 🔧 修复：避免同名表情被误保留
          combinedPart.items.forEach(({ groupKey, part }) => {
            const list = allPartsListsMap.value[groupKey] || []
            list.forEach(p => {
              if (p && p.path) {
                const shouldKeep = p.path === part.path
                if (!shouldKeep) {
                  setLayerVisibilityByPath(p.path, false)
                }
              }
            })
          })
        }
        // 打开所选子项
        combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, true))
      }
    } else {
      // 多选模式：逐一切换
      if (isDeselecting) {
        combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, false))
      } else {
        combinedPart.items.forEach(({ part }) => setLayerVisibilityByPath(part.path, true))
      }
    }
    // 3、先完成主画布绘制，再同步独立预览
    await queueRenderAllLayers()
    
    // 同步到独立预览窗口
    nextTick(() => {
      if (typeof syncCanvasToPreview === 'function') {
        syncCanvasToPreview().catch(err => {
          console.debug('[预览同步] 预览窗口同步失败（可能未打开）:', err)
        })
      }
    })
  } catch (error) {
    console.error('选择组合表情失败:', error)
  }
}

/**
 * 根据图层名称或唯一名称设置可见性，供通用控制使用。
 * 处理流程：
 * 1、递归查找名称匹配的图层
 * 2、更新用户状态和最终可见性，同步 PSD 数据并记录未匹配名称
 */
const setLayerVisibilityByName = (layerName, visible) => {
  // 1、名称为空时跳过，其他情况遍历全部图层以更新同名节点
  if (!layerName) return
  
  let found = false
  
  /**
   * 递归更新所有名称命中的图层。
   * 处理流程：
   * 1、匹配原始名称或唯一名称并结合正面控制更新显示状态
   * 2、同步命中节点的 PSD 数据，并继续递归子层级
   */
  const updateVisibility = (layers, currentPath = []) => {
    // 1、当前层级逐项检查，允许更新多个同名节点
    for (let layer of layers) {
      // 按原始名称或唯一名称进行完整匹配
      if (layer.name === layerName || layer.uniqueName === layerName) {
        // 设置用户操作状态
        layer.userVisible = visible
        
        // 计算最终visible（考虑正面控制）
        const fullPath = [...currentPath, layer.uniqueName].join('/')
        const isSpecialGroup = /(侧面|侧身|侧视|背面|背影|背身|背视|后面|背景|武器|阴影|摇摇头|持剑|后手持剑|下压挥剑|后发|后头发|发型后)/.test(fullPath)
        
        if (showFront.value || isSpecialGroup) {
          layer.visible = visible
        } else {
          // 正面关闭时，非特殊图组强制隐藏
          layer.visible = false
        }
        
        found = true
        
        // 构建完整路径
        const pathParts = fullPath.split('/')
        
        // 2、同步更新 PSD 数据，随后继续遍历子层级
        if (currentPsdData.value?.layerHierarchy) {
          updatePsdLayerVisibility(currentPsdData.value.layerHierarchy, pathParts, 0, visible)
        }
        
        console.log(`✅ [通用控制] 更新图层: ${fullPath} → userVisible: ${visible}, visible: ${layer.visible}`)
      }
      
      if (layer.children && layer.children.length > 0) {
        updateVisibility(layer.children, [...currentPath, layer.uniqueName])
      }
    }
  }
  
  // 2、执行递归更新，未找到名称时记录排查信息
  updateVisibility(layerTreeData.value)
  
  if (!found) {
    console.log(`⚠️ [通用控制] 未找到图层: ${layerName}`)
  }
}

/**
 * 获取图层的完整路径
 * 处理流程：
 * 1、递归比较图层对象身份并累积唯一名称
 * 2、返回命中路径，未找到时返回空字符串
 */
const getLayerPath = (targetLayer) => {
  // 1、从图层树根节点按对象身份定位目标
  /**
   * 递归查找目标对象的唯一名称路径。
   * 处理流程：
   * 1、命中当前对象时返回路径，否则继续搜索子树
   */
  const findPath = (layers, currentPath = []) => {
    // 1、携带父级路径遍历各节点
    for (let layer of layers) {
      const newPath = [...currentPath, layer.uniqueName]
      if (layer === targetLayer) {
        return newPath.join('/')
      }
      if (layer.children && layer.children.length > 0) {
        const found = findPath(layer.children, newPath)
        if (found) return found
      }
    }
    return null
  }
  
  // 2、对外统一以空字符串表示未找到
  return findPath(layerTreeData.value) || ''
}

/**
 * 更新PSD数据中图层的可见性
 * 处理流程：
 * 1、重建当前层级的重名序号，与唯一路径匹配
 * 2、命中目标末段时修改可见性，否则递归对应子层级
 */
const updatePsdLayerVisibility = (layers, pathParts, pathIndex, visible) => {
  // 1、每个层级独立重建唯一名称，保持与界面图层树一致
  const nameCountMap = new Map()
  for (let layer of layers) {
    let uniqueName = layer.name
    if (nameCountMap.has(layer.name)) {
      const count = nameCountMap.get(layer.name)
      nameCountMap.set(layer.name, count + 1)
      uniqueName = `${layer.name}#${count + 1}`
    } else {
      nameCountMap.set(layer.name, 1)
    }
    
    // 2、只在当前路径段命中的节点更新或递归
    if (uniqueName === pathParts[pathIndex]) {
      if (pathIndex === pathParts.length - 1) {
        layer.visible = visible
        return true
      } else if (layer.children && layer.children.length > 0) {
        return updatePsdLayerVisibility(layer.children, pathParts, pathIndex + 1, visible)
      }
    }
  }
  return false
}

// ==================== 表情关联头部互斥辅助 ====================
const HEAD_NAME_PATTERN = /头/
/**
 * 去掉图层唯一名称末尾的重名序号。
 * 处理流程：
 * 1、移除井号加数字后缀，保留原始业务名称
 */
const stripSuffix = (name = '') => name.replace(/#\d+$/, '')

/**
 * 查找唯一路径对应的节点及父级信息。
 * 处理流程：
 * 1、逐层匹配路径名称
 * 2、到达末段时返回节点、父节点和同级索引
 */
const findLayerNodeByPath = (layers, pathParts, depth = 0, parent = null) => {
  // 1、先校验当前层级和路径范围，再沿匹配子树查找
  if (!layers || !pathParts || depth >= pathParts.length) return null
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    if (layer.uniqueName === pathParts[depth]) {
      if (depth === pathParts.length - 1) {
        // 2、保留同级索引，供头部互斥时排除当前节点
        return { node: layer, parent, index: i }
      }
      if (layer.children && layer.children.length > 0) {
        const found = findLayerNodeByPath(layer.children, pathParts, depth + 1, layer)
        if (found) return found
      }
    }
  }
  return null
}

/**
 * 查找表情图层最近的头部祖先路径。
 * 处理流程：
 * 1、从直接父级向根遍历，返回首个名称包含头部关键词的路径
 */
const findHeadPathPartsFromExpression = (path) => {
  // 1、忽略目标自身，从父级开始匹配去除重名后缀的名称
  if (!path) return null
  const parts = path.split('/')
  // 从父级开始向上查找，允许在上层或上上层
  for (let i = parts.length - 2; i >= 0; i--) {
    if (HEAD_NAME_PATTERN.test(stripSuffix(parts[i]))) {
      return parts.slice(0, i + 1)
    }
  }
  return null
}

/**
 * 应用表情时保证对应头部与同级其他头部互斥。
 * 处理流程：
 * 1、找到最近头部祖先并开启
 * 2、遍历同级节点，关闭其他名称包含头部关键词的节点
 */
const ensureHeadMutexForExpression = (expressionPath) => {
  // 1、只在表情路径中存在头部祖先时执行联动
  const headPathParts = findHeadPathPartsFromExpression(expressionPath)
  if (!headPathParts || headPathParts.length === 0) return

  const headPath = headPathParts.join('/')
  // 开启当前头部
  setLayerVisibilityByPath(headPath, true)

  // 2、找到当前头部节点，关闭同层级其他包含头部关键词的节点
  const headNodeInfo = findLayerNodeByPath(layerTreeData.value || [], headPathParts)
  if (!headNodeInfo) return
  const siblings = headNodeInfo.parent ? headNodeInfo.parent.children : (layerTreeData.value || [])

  siblings.forEach((sibling, idx) => {
    if (idx === headNodeInfo.index) return
    if (!HEAD_NAME_PATTERN.test(stripSuffix(sibling.uniqueName))) return
    const siblingPathParts = [...headPathParts]
    siblingPathParts[siblingPathParts.length - 1] = sibling.uniqueName
    setLayerVisibilityByPath(siblingPathParts.join('/'), false)
  })
}

/**
 * 选择部件（直接修改图层树visible状态）
 * 处理流程：
 * 1、分流组合表情，普通部件切回部件控制并退出预设
 * 2、解析代理来源，根据单选或多选及表情互斥规则修改图层
 * 3、应用动作互斥，并在需要时补齐另一只手的默认部件
 * 4、合并渲染画布并同步独立预览
 */
const selectPart = async (part) => {
  // 1、组合表情使用批量入口，普通部件准备自身控制上下文
  if (!part) return
  
  // 组合表情的专用处理
  if (part.isCombined) {
    await selectCombinedExpression(part)
    return
  }
  
  // 切换控制优先级为部件模式
  if (controlPriority.value !== 'parts') {
    controlPriority.value = 'parts'
  }
  
  // 清除预设选择（用户选择部件时应该退出预设模式）
  if (selectedPresetId.value) {
    console.log('🔄 选择部件时清除预设选择')
    selectedPresetId.value = null
  }

  try {
    // 2、根据代理来源确定实际分组，再计算本次选中或取消及互斥范围
    const actualGroup = part._sourceGroup || currentTab.value
    const currentSelected = selectedParts.value[actualGroup]
    
    // 标记该分组已被用户手动操作
    userInteracted.value[actualGroup] = true
    
    // 查找当前标签页的配置（用于代理机制）
    const currentTabConfig = partTabs.value.find(tab => tab.key === currentTab.value)
    
    const proxyTargets = currentTabConfig?.proxyTargets || []
    
    // 判断是取消还是选中
    const isDeselecting = currentSelected && currentSelected.path === part.path
    
    if (exclusiveMode.value) {
      // 互斥模式：单选
      if (isDeselecting) {
        setLayerVisibilityByPath(part.path, false)
      } else {
        // 选中新部件：先隐藏该分组和代理分组的所有部件，再显示选中的
        
        // 收集需要清空的分组
        let groupsToClear = [currentTab.value, ...proxyTargets]
        
        // 🔧 表情互斥：按类别互斥
        // 眉毛、眼睛、嘴之间不互斥，只在各自类别内部互斥
        // 其他表情标签（如"表情"、"任意表情"等非眉眼嘴类）在其内部互斥
        // 变体标签（如"眉毛"、"眉毛表情"等）也被视为同一类别，会相互互斥
        if (currentTabConfig?.isExpression && expressionExclusiveMode.value) {
          const currentMeta = expressionTabMetaMap.value[currentTab.value] || {}
          const exprType = currentMeta.exprType || currentTabConfig?.exprType || null
          const isCategory = !currentMeta.isStandalone && (currentMeta.baseCategory === 'eyebrow' || currentMeta.baseCategory === 'eye' || currentMeta.baseCategory === 'mouth')
          const metaEntries = Object.entries(expressionTabMetaMap.value || {})

          if (currentMeta.isStandalone || exprType === 'standalone') {
            // 独立表情：清空所有表情分组，确保与任意表情互斥
            groupsToClear = metaEntries.map(([key]) => key)
          } else if (isCategory) {
            // 眉毛、眼睛、嘴：仅清空同类别的分组
            const sameTypeKeys = metaEntries
              .filter(([, meta]) => !meta?.isStandalone && meta?.baseCategory === currentMeta.baseCategory)
              .map(([key]) => key)
            groupsToClear = sameTypeKeys
          } else {
            // 其他表情（含 "表情*" 等标签）：清空非眉眼嘴类别
            const nonCategoryKeys = metaEntries
              .filter(([, meta]) => meta?.isStandalone || !(meta?.baseCategory === 'eyebrow' || meta?.baseCategory === 'eye' || meta?.baseCategory === 'mouth'))
              .map(([key]) => key)
            groupsToClear = nonCategoryKeys
          }

          if (!groupsToClear || groupsToClear.length === 0) {
            groupsToClear = [currentTab.value, ...proxyTargets]
          }
        }
        
        // 隐藏这些分组的所有部件图层（跳过即将要选中的图层）
        // 🔧 修复：只有当前选中的分组（actualGroup）才能保留同path的部件
        // 其他分组即使有同名表情（相同path）也应该被隐藏，避免多个表情被激活
        groupsToClear.forEach(groupKey => {
          const partsList = allPartsListsMap.value[groupKey] || []
          partsList.forEach(p => {
            // 如果是当前选中的分组，保留即将选中的部件（path匹配）
            // 如果是其他分组，即使path相同也要隐藏（避免同名表情被误激活）
            if (p && p.path) {
              const shouldKeep = (groupKey === actualGroup) && (p.path === part.path)
              if (!shouldKeep) {
                setLayerVisibilityByPath(p.path, false)
              }
            }
          })
        })
        
        // 显示选中的部件
        setLayerVisibilityByPath(part.path, true)

        // 表情互斥时联动头部互斥（支持多头场景）
        if (currentTabConfig?.isExpression && expressionExclusiveMode.value) {
          ensureHeadMutexForExpression(part.path)
        }
      }
    } else {
      // 多选模式：切换
      if (isDeselecting) {
        setLayerVisibilityByPath(part.path, false)
      } else {
        setLayerVisibilityByPath(part.path, true)
      }
    }
    
    // 3、动作互斥时协调双手、单手与动作，并按需补齐另一只手
    if (actionExclusiveMode.value && !isDeselecting) {
      const actionRelatedGroups = {
        bothHands: 'bothHands',
        frontHandNormal: 'frontHandNormal',
        frontHandRight: 'frontHandRight',
        frontHandBoth: 'frontHandBoth',
        backHand: 'backHand',
        frontLayerBackHand: 'frontLayerBackHand',
        action: 'action'
      }

      // 检查当前选中的是否是动作相关分组
      if (actionRelatedGroups[actualGroup]) {
        
        let groupsToClose = []
        let handToEnsure = null // 需要确保有图层显示的手（leftHand 或 rightHand）

        if (actualGroup === 'bothHands' || actualGroup === 'frontHandBoth') {
          // 点击双手 → 关闭动作、左手、右手（所有手部分组）
          groupsToClose = ['action', 'frontHandNormal', 'frontHandRight', 'backHand', 'frontLayerBackHand']
        } else if (actualGroup === 'action') {
          // 点击动作 → 关闭双手、左手、右手（所有手部分组）
          groupsToClose = ['bothHands', 'frontHandBoth', 'frontHandNormal', 'frontHandRight', 'backHand', 'frontLayerBackHand']
        } else if (actualGroup === 'frontHandNormal') {
          // 点击左手 → 关闭双手、动作
          groupsToClose = ['bothHands', 'frontHandBoth', 'action']
          handToEnsure = 'rightHand'
        } else if (actualGroup === 'frontHandRight' || actualGroup === 'backHand' || actualGroup === 'frontLayerBackHand') {
          // 点击右手（任意右手分组）→ 关闭双手、动作，以及其他右手分组
          groupsToClose = ['bothHands', 'frontHandBoth', 'action']

          // 关闭其他右手分组
          if (actualGroup !== 'frontHandRight') groupsToClose.push('frontHandRight')
          if (actualGroup !== 'backHand') groupsToClose.push('backHand')
          if (actualGroup !== 'frontLayerBackHand') groupsToClose.push('frontLayerBackHand')

          handToEnsure = 'leftHand'
        }
        
        // 如果需要确保某只手有图层显示，先检查再决定是否补手
        if (handToEnsure) {
          // 确定目标手的所有相关分组
          let targetGroups = []
          if (handToEnsure === 'leftHand') {
            targetGroups = ['frontHandNormal']
          } else {
            // 右手包括：后手、前层后手、前手(右手)
            targetGroups = ['backHand', 'frontLayerBackHand', 'frontHandRight']
          }
          
          // 先检查所有目标分组是否有任何可见的图层
          let hasVisibleInAnyGroup = false
          for (const targetGroup of targetGroups) {
            const targetPartsList = allPartsListsMap.value[targetGroup] || []
            const hasVisible = targetPartsList.some(p => {
              if (!p || !p.path) return false
              const pathParts = p.path.split('/')
              /**
               * 查询待补手部件是否已被用户设为可见。
               * 处理流程：
               * 1、沿唯一路径查找目标，返回用户可见状态
               */
              const findLayer = (layers, index = 0) => {
                // 1、按路径逐层查询，未命中时视为未显示
                for (const layer of layers) {
                  if (layer.uniqueName === pathParts[index]) {
                    if (index === pathParts.length - 1) {
                      return layer.userVisible
                    } else if (layer.children) {
                      return findLayer(layer.children, index + 1)
                    }
                  }
                }
                return false
              }
              return findLayer(layerTreeData.value)
            })

            if (hasVisible) {
              hasVisibleInAnyGroup = true
              break
            }
          }
          
          // 如果所有目标分组都没有可见图层，才补手
          if (!hasVisibleInAnyGroup) {
            let defaultPart = null
            let defaultGroup = null
            
            // 优先从第一个非空分组中选择默认图层
            for (const targetGroup of targetGroups) {
              const targetPartsList = allPartsListsMap.value[targetGroup] || []
              if (targetPartsList.length > 0) {
                // 寻找"基础"或第一个部件
                defaultPart = targetPartsList.find(p => p.name === '基础' || p.name === '基本' || p.name === '默认')
                if (!defaultPart) {
                  defaultPart = targetPartsList[0]
                }
                defaultGroup = targetGroup
                break
              }
            }

            if (defaultPart && defaultPart.path && defaultGroup) {
              setLayerVisibilityByPath(defaultPart.path, true)
              userInteracted.value[defaultGroup] = true
            }
          }
        }
        
        // 关闭指定的分组（在检查补手之后，这样不会影响检查结果）
        groupsToClose.forEach(groupKey => {
          const partsList = allPartsListsMap.value[groupKey] || []
          partsList.forEach(p => {
            if (p && p.path) {
              setLayerVisibilityByPath(p.path, false)
            }
          })
          // 标记该分组已被用户操作
          userInteracted.value[groupKey] = true
        })
      }
    }
    
    // 表情互斥已经由本方法前面的单选分支处理
    
    // 4、合并主画布渲染请求，并在下一轮视图更新后同步预览
    await queueRenderAllLayers()
    
    // 🔄 同步到独立预览窗口
    nextTick(() => {
      if (typeof syncCanvasToPreview === 'function') {
        syncCanvasToPreview().catch(err => {
          console.debug('[预览同步] 预览窗口同步失败（可能未打开）:', err)
        })
      }
    })
  } catch (error) {
    console.error('选择部件失败:', error)
  }
}

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

/**
 * 监听窗口大小变化
 * 处理流程：
 * 1、更新窗口高度并重新计算画布展示尺寸
 */
const handleWindowResize = () => {
  // 1、让尺寸计算使用最新窗口高度
  windowHeight.value = window.innerHeight
  updateCanvasDisplaySize()
}

// ==================== 分隔条拖拽功能 ====================
// handleDividerMouseDown, handleDividerMouseMove, handleDividerMouseUp 函数已迁移到 composables/useCanvasDivider.js

// handleCanvasWheel 函数已迁移到 composables/useCanvasScale.js

// handleKeyDown 函数已迁移到 composables/useKeyboard.js

// ==================== 生命周期 ====================

/**
 * 初始化人物编辑页面的服务、模板和交互监听。
 * 处理流程：
 * 1、检查 PSD 服务和置顶状态，计算画布尺寸并加载全局模板
 * 2、注册窗口尺寸及系统拖拽完成监听
 * 3、等待部件列表挂载，初始化虚拟滚动并保留清理入口
 */
onMounted(async () => {
  // 1、先准备页面显示和全局模板所需的数据
  await initPSDService()
  await getAlwaysOnTopState()
  
  // 初始化Canvas显示尺寸
  updateCanvasDisplaySize()
  
  // 加载全局模板（不依赖PSD）
  await loadTemplates()
  console.log('✅ 已加载全局模板')
  
  // 2、注册窗口大小变化与桌面系统拖拽完成事件
  window.addEventListener('resize', handleWindowResize)
  
  // 注意：键盘事件监听已由 useKeyboard composable 内部管理，无需手动添加
  
  // 监听 drag-finished 事件
  if (window.electronAPI?.on) {
    dragFinishedUnsubscribe = window.electronAPI.on('drag-finished', handleDragFinished)
    console.log('✅ 已注册 drag-finished 事件监听')
  } else {
    console.warn('⚠️ electronAPI.on 不可用')
  }
  
  // 3、等待列表容器可用后初始化虚拟滚动，并保存卸载时的清理函数
  await nextTick()
  if (partsListRef.value) {
    const cleanup = virtualScroll.init(partsListRef.value)
    // 保存清理函数，以便在onUnmounted中调用
    window.__virtualScrollCleanup = cleanup
    console.log('✅ 虚拟滚动已初始化')
  }
})

/**
 * 返回缓存的人物编辑页面时重新居中画布。
 * 处理流程：
 * 1、等待视图恢复后读取原滚动模式
 * 2、临时切换模式并重置缩放与手动滚动状态
 * 3、下一轮视图更新后恢复原模式，重新计算尺寸并绘制
 */
onActivated(() => {
  // 1、每次从其他页面回来时，等待缓存视图重新激活
  nextTick(() => {
    const currentMode = scrollMode.value
    
    // 2、先切换到另一模式，触发尺寸和滚动位置重置
    if (currentMode === 'scale') {
      // 当前是画布缩放模式：切换到区域调整 -> 再切回画布缩放
      scrollMode.value = 'region'
      canvasScale.value = 1.0
      userHasManuallyScrolled.value = false
      updateCanvasDisplaySize()
      
      // 3、恢复原画布缩放模式并重新绘制
      nextTick(() => {
        scrollMode.value = 'scale'
        canvasScale.value = 1.0
        userHasManuallyScrolled.value = false
        updateCanvasDisplaySize()
        renderAllLayers()
      })
    } else {
      // 当前是区域调整模式：切换到画布缩放 -> 再切回区域调整
      scrollMode.value = 'scale'
      canvasScale.value = 1.0
      userHasManuallyScrolled.value = false
      updateCanvasDisplaySize()
      
      // 恢复原区域调整模式并重新绘制
      nextTick(() => {
        scrollMode.value = 'region'
        canvasScale.value = 1.0
        userHasManuallyScrolled.value = false
        updateCanvasDisplaySize()
        renderAllLayers()
      })
    }
  })
})

/**
 * 卸载人物编辑页面并释放文件与监听资源。
 * 处理流程：
 * 1、自动保存当前 PSD 路径历史
 * 2、解除窗口、拖拽及虚拟滚动监听
 * 3、释放 PSD 数据、部件缓存与图层树引用
 */
onUnmounted(() => {
  // 1、在清空文件引用之前保存路径历史
  autoSavePsdHistory()
  
  // 2、清理页面持有的窗口、拖拽和虚拟滚动监听
  window.removeEventListener('resize', handleWindowResize)
  
  // 注意：键盘事件监听已由 useKeyboard composable 内部管理，无需手动清理
  // 注意：分隔条拖拽监听已由 useCanvasDivider composable 内部管理，无需手动清理
  
  // 清理拖拽监听
  if (dragFinishedUnsubscribe) {
    dragFinishedUnsubscribe()
  }
  window.electronAPI?.removeAllListeners?.('drag-finished')
  
  // 清理虚拟滚动
  if (window.__virtualScrollCleanup) {
    window.__virtualScrollCleanup()
    delete window.__virtualScrollCleanup
    console.log('✅ 虚拟滚动已清理')
  }

  // 3、彻底释放 PSD 相关引用，避免大文件常驻内存
  psdFiles.value.splice(0, psdFiles.value.length)
  currentPsdFile.value = null
  currentPsdData.value = null
  layerTreeData.value = []
  psdPartsCache.value = {}
  psdStatesCache.value = {}
  userInteracted.value = {}
})

// 路由离开前的处理
onBeforeRouteLeave(async (to, from) => {
  // 自动保存PSD历史记录
  autoSavePsdHistory()
  
  // 关闭预览窗口
  try {
    await window.electronAPI?.invoke('canvas-preview-close')
  } catch (error) {
    console.error('关闭预览窗口失败:', error)
  }
  
  return true
})

// ==================== 拖拽到剪映功能（已提取到 composables） ====================

let dragFinishedUnsubscribe = null

/**
 * ==================== 图层树相关功能（已提取到 composables/useLayerTree.js） ====================
 * 注意：实际的初始化在渲染函数定义之后进行
 */

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

// 标记：正在从图层树同步，避免触发watch循环
let isSyncingFromLayerTree = false

// 包装图层可见性改变函数，添加反向同步
const originalHandleLayerVisibilityChange = layerTreeComposable.handleLayerVisibilityChange
/**
 * 包装图层树可见性操作并反向同步通用控制。
 * 处理流程：
 * 1、退出预设并等待图层树原始操作完成
 * 2、按图层名称映射控制开关，设置同步标记避免监听循环
 */
handleLayerVisibilityChange = async (params) => {
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

handleBatchToggleVisibility = layerTreeComposable.handleBatchToggleVisibility
handleRestoreInitialState = layerTreeComposable.handleRestoreInitialState
clearLayerTreeOperations = layerTreeComposable.clearLayerTreeOperations
syncLayerTreeFromParts = layerTreeComposable.syncLayerTreeFromParts // 部件选择 → 图层树（已移除，直接操作visible）
updateSelectedLayersMap = layerTreeComposable.updateSelectedLayersMap
renderByLayerTree = layerTreeComposable.renderByLayerTree
const syncBackgroundControlFromLayerTree = layerTreeComposable.syncBackgroundControlFromLayerTree

// 现在所有依赖都准备好了，初始化Canvas渲染模块
initCanvasRender()

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
  handleDrop
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
const jumpOptions = ref([
  {
    label: '跳转到抠图',
    key: 'removebg',
    icon: () => h('span', '🎨')
  },
  {
    label: '跳转到分格',
    key: 'comic',
    icon: () => h('span', '📱')
  },
  {
    label: '跳转到幻想框',
    key: 'dialog-frame',
    icon: () => h('span', '💭')
  }
])

/**
 * 将当前画布作为图片传递给指定工具页面。
 * 处理流程：
 * 1、验证画布并导出 PNG 数据地址
 * 2、保存临时图片并写入跨页面待处理缓存
 * 3、按菜单项跳转目标页面，最终释放发送状态
 */
const handleJumpSelect = async (key) => {
  // 1、缺少 PSD 或画布时不启动导出
  if (!currentPsdData.value || !canvasRef.value) {
    message.warning('请先上传PSD文件')
    return
  }
  
  isSendingToGenerate.value = true
  
  try {
    const canvas = canvasRef.value
    
    // 验证canvas有效性
    if (!canvas.width || !canvas.height) {
      message.error('画布尺寸无效')
      console.error('[人物调整] 画布尺寸无效:', { width: canvas.width, height: canvas.height })
      isSendingToGenerate.value = false
      return
    }
    
    console.log(`[人物调整] 准备跳转到: ${key}`)
    
    // 将canvas转换为Blob
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob((createdBlob) => {
        if (!createdBlob) {
          reject(new Error('Blob结果为空'))
          return
        }
        resolve(createdBlob)
      }, 'image/png', 1.0)
    })
    
    if (!blob) {
      message.error('图片转换失败')
      isSendingToGenerate.value = false
      return
    }
    
    console.log('[人物调整] Blob 创建成功，大小:', blob.size, 'bytes')
    
    // 将Blob转换为Base64 DataURL
    const reader = new FileReader()
    const dataURL = await new Promise((resolve, reject) => {
      reader.onload = () => resolve(reader.result)
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })
    
    console.log('[人物调整] DataURL 转换成功，长度:', dataURL.length)
    
    // 生成文件名
    const fileName = buildSuggestedFileName() || '画布导出.png'
    console.log('[人物调整] 生成文件名:', fileName)
    
    // 2、保存图片到临时文件，再把图片信息放入会话缓存
    const base64Data = dataURL.split(',')[1]
    const tempDir = await window.api?.getTempDir?.()
    const tempFilePath = tempDir ? `${tempDir}\\${fileName}` : fileName
    
    console.log('[人物调整] 保存文件到:', tempFilePath)
    
    try {
      await window.api?.writeFile(tempFilePath, base64Data)
      console.log('[人物调整] 文件保存成功')
    } catch (error) {
      console.error('[人物调整] 文件保存失败:', error)
      message.error('文件保存失败: ' + error.message)
      isSendingToGenerate.value = false
      return
    }
    
    // 先清除旧数据
    const oldData = sessionStorage.getItem('pendingImageForJump')
    if (oldData) {
      console.log('[人物调整] 清除旧的待处理数据')
      sessionStorage.removeItem('pendingImageForJump')
    }
    
    // 将图片信息存储到 sessionStorage，供目标页面读取
    const imageData = {
      dataURL,
      fileName,
      filePath: tempFilePath,
      timestamp: Date.now(),
      source: 'action-expression-canvas',
      targetPage: key
    }
    sessionStorage.setItem('pendingImageForJump', JSON.stringify(imageData))
    console.log('[人物调整] 图片数据已存储到 sessionStorage')
    
    // 3、根据选择跳转到对应工具页面，并通过最终清理释放发送状态
    let targetRoute = ''
    let successMessage = ''
    
    switch (key) {
      case 'removebg':
        targetRoute = '/image-processing'
        successMessage = '已跳转到抠图页面'
        break
      case 'comic':
        targetRoute = '/comic'
        successMessage = '已跳转到分格页面'
        break
      case 'dialog-frame':
        targetRoute = '/dialog-frame'
        successMessage = '已跳转到幻想框页面'
        break
      default:
        message.error('未知的跳转目标')
        isSendingToGenerate.value = false
        return
    }
    
    console.log('[人物调整] 准备跳转到:', targetRoute)
    await router.push(targetRoute)
    
    message.success(successMessage)
  } catch (error) {
    console.error('[人物调整] 跳转失败:', error)
    message.error('跳转失败：' + error.message)
  } finally {
    isSendingToGenerate.value = false
  }
}

// 已移除所有调整图层算法实现

// ==================== 监听通用控制变化，自动修改图层树visible ====================
// 单独监听每个控制，避免循环触发和性能问题

/**
 * 采样记录画布渲染触发原因。
 * 处理流程：
 * 1、合并来源与附加信息，按四次一次的频率记录事件
 */
const logRenderTrigger = (source, meta = {}) => {
  // 1、通过共享性能记录器降低重复日志数量
  perfLogger.logEvent('render:trigger', { source, ...meta }, { sampleEvery: 4 })
}

/**
 * 采样记录独立预览同步的触发原因。
 * 处理流程：
 * 1、合并原因与附加数据，并按采样频率输出事件
 */
const logPreviewSyncTrigger = (reason, meta = {}) => {
  // 1、为同步耗时排查保留触发来源
  perfLogger.logEvent('preview-sync:trigger', { reason, ...meta }, { sampleEvery: 4 })
}

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

// ==================== 画布实时同步到预览窗口 ====================
// 监听画布内容变化，自动同步到预览窗口
let syncDebounceTimer = null
let psdSwitchSyncTimer = null // PSD切换时的同步定时器

/**
 * 合并高频画布变化并延迟同步预览。
 * 处理流程：
 * 1、重置防抖定时器，仅保留最后一次常规请求
 * 2、让 PSD 切换同步优先，画布渲染中时延迟重试
 * 3、确认画布尺寸有效后发起异步同步
 */
const debouncedSyncCanvas = () => {
  // 1、用新定时器覆盖尚未执行的常规同步
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer)
  }
  syncDebounceTimer = setTimeout(async () => {
    // 2、如果 PSD 切换同步正在等待，取消常规同步避免重复
    if (psdSwitchSyncTimer) {
      perfLogger.logEvent('preview-sync:skip', { reason: 'psd-switch-pending' }, { sampleEvery: 2 })
      console.log('[预览同步] PSD切换同步优先，跳过常规同步')
      return
    }
    
    // 简化等待逻辑：只等待一次，如果正在渲染就延迟50ms重试
    if (isRendering.value) {
      perfLogger.logEvent('preview-sync:defer', { reason: 'canvas-rendering' }, { sampleEvery: 2 })
      console.log('[预览同步] 检测到渲染中，延迟50ms重试')
      syncDebounceTimer = setTimeout(() => {
        debouncedSyncCanvas()
      }, 50)
      return
    }
    
    // 3、确保画布尺寸有效再异步同步
    if (canvasRef.value && canvasRef.value.width > 0 && canvasRef.value.height > 0) {
      syncCanvasToPreview() // 不await，让它异步执行
    } else {
      console.warn('[预览同步] Canvas无效，跳过同步')
    }
  }, 100) // 减少到100ms防抖，更快响应（配合JPEG压缩，足够快）
}

// 监听可能导致画布更新的状态变化
watch([selectedParts, currentTab], () => {
  // 如果是模板预览渲染中，不同步到预览窗口
  if (isRenderingTemplatePreview.value) {
    return
  }
  logPreviewSyncTrigger('selection-change', { tab: currentTab.value })
  debouncedSyncCanvas()
}, { deep: true })

// 监听PSD数据变化（切换文件时）- 需要等渲染完成后再同步
watch(currentPsdData, () => {
  // 清除之前的PSD切换同步定时器
  if (psdSwitchSyncTimer) {
    clearTimeout(psdSwitchSyncTimer)
  }
  
  // 清除常规同步定时器，避免重复同步
  if (syncDebounceTimer) {
    clearTimeout(syncDebounceTimer)
    syncDebounceTimer = null
  }

  logPreviewSyncTrigger('psd-switch', { psdId: currentPsdData.value?.id })
  
  // 延迟同步，确保画布已渲染（优化：减少等待时间，使用更智能的重试机制）
  psdSwitchSyncTimer = setTimeout(async () => {
    // 简化等待逻辑：最多重试3次，每次间隔100ms
    let retryCount = 0
    /**
     * 等待 PSD 切换渲染并尝试同步预览。
     * 处理流程：
     * 1、渲染未完成时最多延迟重试三次
     * 2、同步有效画布并释放切换同步标记
     */
    const trySync = async () => {
      // 1、在限定次数内让当前渲染先完成
      if (isRendering.value && retryCount < 3) {
        retryCount++
        console.log(`[预览同步] PSD切换：渲染中，第${retryCount}次重试`)
        setTimeout(trySync, 100)
        return
      }
      
      // 2、提交有效画布并恢复常规同步资格
      if (canvasRef.value && canvasRef.value.width > 0 && canvasRef.value.height > 0) {
        syncCanvasToPreview() // 不await，异步执行
        console.log('📂 [预览窗口] PSD文件切换，已触发画布同步')
      }
      
      // 清除定时器标记，允许后续的常规同步
      psdSwitchSyncTimer = null
    }
    
    trySync()
  }, 200) // 减少到200ms，配合重试机制更快响应
}, { deep: false })


</script>

<style scoped src="./ActionExpressionPage.css"></style>

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
