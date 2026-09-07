<template>
  <div class="integrated-controls-panel">
    <div class="panel-header-tabs" @click="emit('header-click', $event)">
      <button
        class="panel-tab-button"
        :class="{ active: integratedPanelTab === 'commonControls' }"
        @click="emit('switch-tab', 'commonControls')"
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
        @click="emit('switch-tab', 'layerTree')"
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
        @click="emit('save-preset', $event)"
        title="添加当前画布为预设"
      >
        预设
      </button>

      <button
        class="save-template-button"
        @click="emit('save-template1', $event)"
        title="保存当前动作配置为动作模板"
      >
        动作模板
      </button>

      <button
        class="save-template-button"
        @click="emit('save-template2', $event)"
        title="保存当前表情配置为表情模板"
      >
        表情模板
      </button>

      <button
        class="search-preset-button"
        @click="emit('search', $event)"
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
          @keyup.enter="emit('size-confirm', $event)"
          @blur="emit('size-confirm', $event)"
          title="输入数值后按回车或失去焦点生效"
        />
        <span class="size-control-unit">px</span>
      </div>

      <span
        class="collapse-icon"
        :class="{ expanded: !integratedPanelCollapsed }"
        @click="emit('toggle', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('common-control-change', $event)"
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
              @change="emit('select-head-only-change', $event)"
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
              @change="emit('select-non-head-change', $event)"
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
            @click="emit('reset', $event)"
            title="重置控制面板到默认状态"
          >
            重置
          </button>
        </div>
        </div>

        <!-- 图层结构内容由页面插槽保留实例、事件及父作用域 -->
        <slot name="layer-tree" />
      </div>
    </transition>
  </div>
</template>

<script setup>
/** 整合控制面板：只展示通用控件和顶栏；状态、校正、图层选择及渲染仍由页面负责。 */
import { computed } from 'vue'
import { NTooltip, NSelect } from 'naive-ui'

/**
 * 通用控制展示值；不接收页面会话、设置对象或渲染上下文。
 * @typedef {Object} CommonControlValues
 * @property {boolean} exclusiveMode
 * @property {boolean} actionExclusiveMode
 * @property {boolean} expressionExclusiveMode
 * @property {boolean} showFront
 * @property {boolean} showSide
 * @property {boolean} showBack
 * @property {boolean} showBackground
 * @property {boolean} showBaseLayer
 * @property {boolean} showSecondBaseLayer
 * @property {boolean} showWeapon
 * @property {boolean} showBackHair
 * @property {boolean} showShadow
 * @property {boolean} showShakeHead
 * @property {boolean} showHoldSword
 * @property {boolean} showBackHandSword
 * @property {boolean} showDownwardSlash
 * @property {boolean} selectHeadOnly
 * @property {boolean} selectNonHead
 * @property {'no-trim'|'trim'|'trim-horizontal'} enableTrimWhitespace
 */
const props = defineProps({
  commonControls: { type: /** @type {import('vue').PropType<CommonControlValues>} */ (Object), required: true },
  integratedPanelTab: { type: String, required: true },
  integratedPanelCollapsed: { type: Boolean, required: true },
  partItemSizeInput: { type: [Number, String], required: true }
})

const emit = defineEmits([
  'update-common-control', 'update:partItemSizeInput',
  'header-click', 'switch-tab', 'toggle', 'save-preset', 'save-template1', 'save-template2',
  'search', 'size-confirm', 'common-control-change', 'select-head-only-change',
  'select-non-head-change', 'reset'
])

/**
 * 为原 v-model 提供无独立状态的读写转接。
 * 处理流程：1、直接读取父展示值；2、同步传出更新，先于原 change 事件写回页面原 ref。
 * @param {keyof CommonControlValues} key 控件字段
 */
const controlModel = (key) => computed({
  // 1、仅派生父 prop，不创建本地 ref、默认值或同步 watch。
  get: () => props.commonControls[key],
  // 2、组件事件同步交给页面，不在展示层执行业务变更。
  set: value => emit('update-common-control', key, value)
})

const exclusiveMode = controlModel('exclusiveMode')
const actionExclusiveMode = controlModel('actionExclusiveMode')
const expressionExclusiveMode = controlModel('expressionExclusiveMode')
const showFront = controlModel('showFront')
const showSide = controlModel('showSide')
const showBack = controlModel('showBack')
const showBackground = controlModel('showBackground')
const showBaseLayer = controlModel('showBaseLayer')
const showSecondBaseLayer = controlModel('showSecondBaseLayer')
const showWeapon = controlModel('showWeapon')
const showBackHair = controlModel('showBackHair')
const showShadow = controlModel('showShadow')
const showShakeHead = controlModel('showShakeHead')
const showHoldSword = controlModel('showHoldSword')
const showBackHandSword = controlModel('showBackHandSword')
const showDownwardSlash = controlModel('showDownwardSlash')
const selectHeadOnly = controlModel('selectHeadOnly')
const selectNonHead = controlModel('selectNonHead')
const enableTrimWhitespace = controlModel('enableTrimWhitespace')
const partItemSizeInput = computed({
  get: () => props.partItemSizeInput,
  set: value => emit('update:partItemSizeInput', value)
})
</script>

<style scoped>
/* 仅迁移面板闭合规则：依次对应原基础、部件面板、响应式覆盖；同名后置规则不可合并。 */
/* 折叠动画与画布共用名称，此处只作用于新面板，画布规则留在页面。 */
.panel-collapse-enter-active,
.panel-collapse-leave-active {
  transition: opacity 0.3s ease, max-height 0.3s ease;
  overflow: hidden;
}

.panel-collapse-enter-from,
.panel-collapse-leave-to {
  opacity: 0;
  max-height: 0;
}

.panel-collapse-enter-to,
.panel-collapse-leave-from {
  opacity: 1;
  max-height: 2000px; /* 足够大的值以容纳画布 */
}

.panel-header-tabs {
  display: flex;
  align-items: center;
  background: var(--theme-background-tertiary);
  border-bottom: 1px solid var(--theme-border); /* 保持顶部内部分割线 */
  padding: 1px;
  gap: 1px;
  cursor: pointer;
  user-select: none;
}

.panel-tab-button {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 5px;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  color: var(--theme-text-secondary);
  font-size: 13px;
  font-weight: 500;
  transition: all 0.2s;
  user-select: none;
}

.panel-tab-button svg {
  width: 16px;
  height: 16px;
  opacity: 0.6;
}

.panel-tab-button:hover {
  background: var(--theme-background-hover);
  color: var(--theme-text-primary);
}

.panel-tab-button.active {
  background: var(--theme-background-primary);
  color: var(--theme-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.panel-tab-button.active svg {
  opacity: 1;
}

/* 已移除旧的 .panel-header-tabs .save-preset-button 样式 */
/* 使用统一的按钮样式（在文件末尾定义） */

.panel-header-tabs .size-control-compact {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.panel-header-tabs .size-control-compact .size-control-label {
  font-size: 12px;
  color: var(--theme-text-secondary);
  white-space: nowrap;
}

.panel-header-tabs .size-control-compact .size-control-input {
  width: 50px;
  padding: 3px 6px;
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  background: var(--theme-background-secondary);
  color: var(--theme-text-primary);
  font-size: 12px;
  text-align: center;
  transition: all 0.2s;
}

.panel-header-tabs .size-control-compact .size-control-input:focus {
  outline: none;
  border-color: var(--theme-primary);
  box-shadow: 0 0 0 2px rgba(32, 128, 240, 0.1);
}

.panel-header-tabs .size-control-compact .size-control-unit {
  font-size: 11px;
  color: var(--theme-text-secondary);
}

.panel-header-tabs .collapse-icon {
  padding: 6px 8px;
  cursor: pointer;
  font-size: 12px;
  color: var(--theme-text-secondary);
  transition: transform 0.2s;
  transform: rotate(-90deg);
  user-select: none;
}

.panel-header-tabs .collapse-icon:hover {
  color: var(--theme-text-primary);
}

.panel-header-tabs .collapse-icon.expanded {
  transform: rotate(0deg);
}

.integrated-panel-content {
  background: var(--theme-background-primary);
  overflow: hidden;
}

.common-controls-content {
  padding: 12px 16px;
  overflow-y: auto;
  max-height: 300px;
}

.common-controls {
  display: flex;
  gap: 16px 20px;
  flex-wrap: wrap;
}

.control-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 12px;
  color: var(--theme-text-primary);
  white-space: nowrap;
}

.control-item input[type="checkbox"] {
  cursor: pointer;
}

.control-item span {
  user-select: none;
}

.warning-text {
  color: #f5a623;
}

.reset-button-inline {
  padding: 6px 6px;
  font-size: 13px;
  background: #2080f0;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
  white-space: nowrap;
  height: fit-content;
}

.reset-button-inline:hover {
  background: #4098ff;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(32, 128, 240, 0.3);
}

.reset-button-inline:active {
  transform: translateY(0);
  box-shadow: 0 1px 4px rgba(32, 128, 240, 0.2);
}

/* 保留原基础文件后置的通用控件覆盖顺序。 */
.common-controls {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  overflow-y: auto;
  flex: 1;
  padding-right: 8px;
}

/* 内联重置按钮样式 */
.reset-button-inline {
  padding: 8px 16px;
  font-size: 13px;
  background: #2080f0;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-weight: 500;
  white-space: nowrap;
  height: fit-content;
  align-self: center;
}

.reset-button-inline:hover {
  background: #1c6ed9;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(32, 128, 240, 0.3);
}

.reset-button-inline:active {
  transform: translateY(0);
}

.common-controls::-webkit-scrollbar {
  width: 8px;
}

.common-controls::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 4px;
}

.common-controls::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 4px;
}

.common-controls::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

.control-item {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: var(--theme-foreground);
  user-select: none;
}

.control-item input[type="checkbox"] {
  width: 18px;
  height: 18px;
  cursor: pointer;
  accent-color: var(--theme-primary);
}

.control-item span {
  font-weight: 500;
}

.control-item .warning-text {
  color: #f56565;
  font-weight: 600;
}

.select-control-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.select-control-item .control-label {
  font-weight: 500;
  white-space: nowrap;
}

/* 原 part-panels.css 的缩放输入规则，保留低优先级补充属性。 */
.size-control-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--theme-foreground);
  white-space: nowrap;
}

.size-control-label svg {
  width: 16px;
  height: 16px;
  opacity: 0.7;
}

.size-control-input {
  width: 65px;
  padding: 4px 8px;
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-primary);
  background: var(--theme-background-secondary);
  border: 1px solid var(--theme-border);
  border-radius: 4px;
  text-align: center;
  outline: none;
  transition: all 0.2s ease;
}

.size-control-input:focus {
  border-color: var(--theme-primary);
  background: var(--theme-background);
  box-shadow: 0 0 0 2px rgba(24, 160, 88, 0.1);
}

.size-control-input:hover {
  border-color: var(--theme-primary);
}

/* 移除number类型输入框的上下箭头 */
.size-control-input::-webkit-inner-spin-button,
.size-control-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}

.size-control-input[type="number"] {
  -moz-appearance: textfield;
  appearance: textfield;
}

.size-control-unit {
  font-size: 13px;
  font-weight: 600;
  color: var(--theme-muted);
  margin-left: -4px;
}

/* 原 overrides.css 的相关媒体查询和按钮覆盖，条件与规则相对顺序不变。 */
@media (max-width: 800px) {
  .size-control-label {
    font-size: 12px;
  }

  .size-control-input {
    width: 55px;
    font-size: 12px;
    padding: 3px 6px;
  }

  .size-control-unit {
    font-size: 12px;
  }
}

@media (max-width: 600px) {
  .size-control-label span {
    display: none; /* 极窄屏幕隐藏文字，只保留图标 */
  }

  .size-control-input {
    width: 50px;
    font-size: 11px;
    padding: 3px 5px;
  }

  .size-control-unit {
    font-size: 11px;
  }
}

@media (max-width: 400px) {
  .size-control-input {
    width: 45px;
    font-size: 11px;
    padding: 2px 4px;
  }

  .size-control-unit {
    font-size: 11px;
  }
}

/* 按钮基础样式 - 完全对齐 */
.save-preset-button,
.save-template-button,
.search-preset-button {
  padding: 6px 5px;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s ease;
  font-weight: 500;
  min-width: 40px;
  height: 30px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  line-height: 1;
}

/* 预设按钮 - 绿色 */
.save-preset-button {
  background: #18a058;
}

.save-preset-button:hover {
  background: #16936d;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(24, 160, 88, 0.3);
}

.save-preset-button:active {
  transform: translateY(0);
}

/* 模板按钮 - 紫色 */
.save-template-button {
  background: #7c3aed;
}

.save-template-button:hover {
  background: #6d28d9;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
}

.save-template-button:active {
  transform: translateY(0);
}

/* 搜索按钮 - 蓝色 */
.search-preset-button {
  background: #2080f0;
}

.search-preset-button:hover {
  background: #1868d5;
  transform: translateY(-1px);
  box-shadow: 0 2px 8px rgba(32, 128, 240, 0.3);
}

.search-preset-button:active {
  transform: translateY(0);
}
</style>
