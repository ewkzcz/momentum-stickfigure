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
import { ref, reactive, computed, onMounted, onUnmounted, onActivated, nextTick, watch, shallowRef } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NButton, NTooltip, NDropdown, NCheckbox, useMessage, useDialog } from 'naive-ui'
import PsdTabsBar from './components/PsdTabsBar.vue'
import LayerTreePanel from './components/LayerTreePanel.vue'
import PartSearchModal from './components/PartSearchModal.vue'
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
import { usePartImageDrag } from './composables/usePartImageDrag.js'
import {
  useLayerTree
} from './composables/useLayerTree.js'
import { usePsdParser } from './composables/usePsdParser.js'
import { usePsdUpload } from './composables/usePsdUpload.js'
import { useTabsScroll } from './composables/useTabsScroll.js'
import { useCommonControls } from './composables/useCommonControls.js'
import { usePsdSession } from './composables/usePsdSession.js'
import { useCanvasState } from './composables/useCanvasState.js'
import { useKeyboard } from './composables/useKeyboard.js'
import { useMoreMenu } from './composables/useMoreMenu.js'
import { useCanvasRender } from './composables/useCanvasRender.js'
import { usePartTabLayout } from './composables/usePartTabLayout.js'
import { usePartSelectionCoordinator } from './composables/usePartSelectionCoordinator.js'
import { useExpressionAnalysis } from './composables/useExpressionAnalysis.js'
import { useVirtualScroll } from './composables/useVirtualScroll.js'
import { useCanvasOutputCoordinator, createCanvasJumpOptions } from './composables/useCanvasOutputCoordinator.js'
import { buildCanvasOutputFileName } from './utils/canvasOutputName.js'
import { useCanvasPresetHoverPreview } from './composables/useCanvasPresetHoverPreview.js'
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
// 2、hasRenderedContent 在下方声明；getter 只在默认标签查询或首次分行求值时读取。
// 3、选中推导仍在页面，单双击由选择协调模块负责；跨 PSD 会话复用唯一的 initialSorted 重置标记。
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
// 1、在原函数位置接线；已就绪的 const 依赖复用原引用，选择推导与监听仍留在页面。
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
