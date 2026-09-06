<template>
  <div 
    class="dialog-page"
    v-motion
    :initial="{ opacity: 0 }"
    :enter="{ opacity: 1, transition: { duration: 450 } }"
  >
    <!-- 主内容区域 -->
    <div class="page-content">
      <!-- 顶部工具栏 -->
      <div class="mode-toolbar">
        <n-button
          size="large"
          round
          type="primary"
          class="mode-button"
          :disabled="!selectedTemplate || !textInput.trim()"
          @click="generateImages"
        >
          生成预览
        </n-button>
        <n-button
          size="large"
          round
          class="mode-button"
          :disabled="generatedImages.length === 0"
          @click="exportAllImages"
        >
          导出所有
        </n-button>
      </div>

      <!-- 主工作区（可滚动） -->
      <div class="sections-scroll">
        <div class="workspace">
          <!-- 模板选择区域 -->
          <section class="section template-section" :class="{ 'is-collapsed': collapsedTemplate }">
            <div class="section-header" @click="collapsedTemplate = !collapsedTemplate">
              <div class="header-left">
                <span class="section-title">📋 对话框模板</span>
                <n-tag v-if="templates.length > 0" size="small" type="info" round>
                  {{ templates.length }} 个模板
                </n-tag>
              </div>
              <div class="header-actions">
                <n-button size="small" @click.stop="onClickUploadTemplates">上传模板</n-button>
                <input 
                  ref="fileInputRef"
                  type="file"
                  accept="image/*"
                  multiple
                  style="display: none;"
                  @change="onFilesSelected"
                />
                <button
                  class="collapse-btn"
                  @click.stop
                  :title="collapsedTemplate ? '展开' : '收起'"
                >
                  {{ collapsedTemplate ? '▼' : '▲' }}
                </button>
              </div>
            </div>
            <div class="collapsible-content" v-show="!collapsedTemplate">
              <div class="template-container">
                <div v-for="category in categories" :key="category.id" class="template-category">
                  <div 
                    class="category-title" 
                    @click="toggleCategory(category.id)"
                  >
                    <span>{{ category.name }} ({{ getCategoryTemplates(category.id).length }})</span>
                    <span class="collapse-icon" :class="{ 'expanded': expandedCategories.includes(category.id) }">
                      ▼
                    </span>
                  </div>
                  <div 
                    v-show="expandedCategories.includes(category.id)" 
                    class="templates-grid"
                  >
                    <div
                      v-for="template in getCategoryTemplates(category.id)"
                      :key="template.id"
                      class="template-item"
                      :class="{ 'active': selectedTemplate && selectedTemplate.id === template.id }"
                      @click="selectTemplate(template)"
                    >
                      <canvas :ref="el => templateCanvasRefs[template.id] = el" class="template-preview"></canvas>
                      <div class="template-name">{{ template.index }}</div>
                      <!-- 自定义模板的删除按钮 -->
                      <button
                        v-if="template.categoryId === CUSTOM_CATEGORY_ID"
                        class="template-delete-btn"
                        @click.stop="deleteCustomTemplate(template)"
                        title="删除"
                      >
                        <svg viewBox="0 0 16 16" width="12" height="12">
                          <path d="M2 4h12M5.5 4V3a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1m2 0v9a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1V4h9z" 
                                stroke="currentColor" 
                                stroke-width="1.5" 
                                fill="none" 
                                stroke-linecap="round"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- 文本输入区域 -->
          <section class="section text-input-section" :class="{ 'is-collapsed': collapsedTextInput }">
            <div class="section-header" @click="collapsedTextInput = !collapsedTextInput">
              <div class="header-left">
                <span class="section-title">✏️ 文本内容</span>
              </div>
              <div class="header-actions">
                <button
                  class="collapse-btn"
                  @click.stop
                  :title="collapsedTextInput ? '展开' : '收起'"
                >
                  {{ collapsedTextInput ? '▼' : '▲' }}
                </button>
              </div>
            </div>
            <div class="collapsible-content" v-show="!collapsedTextInput">
              <div class="text-input-wrapper">
                <label class="input-label">每行一张图片：</label>
                <n-input
                  v-model:value="textInput"
                  type="textarea"
                  :rows="6"
                  placeholder="请输入文本内容，每行将生成一张图片...&#10;例如：&#10;你好，很高兴认识你！&#10;今天天气真不错。&#10;我们一起去玩吧！"
                  maxlength="1000"
                  show-count
                />
              </div>
            </div>
          </section>

          <!-- 预览结果区域 -->
          <section class="section preview-section" :class="{ 'is-collapsed': collapsedPreview }">
            <div class="section-header" @click="collapsedPreview = !collapsedPreview">
              <div class="header-left">
                <span class="section-title">👁️ 预览结果</span>
                <n-tag v-if="generatedImages.length > 0" size="small" type="success" round>
                  {{ generatedImages.length }} 张
                </n-tag>
              </div>
              <div class="header-actions">
                <div class="preview-scale-control" @click.stop v-if="generatedImages.length > 0">
                  <span class="scale-label">缩放</span>
                  <n-slider 
                    v-model:value="previewScale" 
                    :min="60" 
                    :max="200" 
                    :step="10"
                    style="width: 100px;"
                    size="small"
                  />
                  <span class="scale-value">{{ previewScale }}%</span>
                </div>
                <button
                  class="collapse-btn"
                  @click.stop
                  :title="collapsedPreview ? '展开' : '收起'"
                >
                  {{ collapsedPreview ? '▼' : '▲' }}
                </button>
              </div>
            </div>
            <div class="collapsible-content" v-show="!collapsedPreview">
              <div v-if="generatedImages.length === 0" class="empty-state">
                请先选择模板、输入文本并生成图片
              </div>
              <div v-else class="preview-grid" :style="{ '--preview-scale': previewScale / 100 }">
                <div
                  v-for="(imageData, index) in generatedImages"
                  :key="index"
                  class="preview-item"
                >
                  <canvas 
                    :ref="el => previewCanvasRefs[index] = el"
                    class="preview-canvas"
                    @click="showImagePreview(imageData)"
                    @mousedown="(e) => handleImageMouseDown(e, imageData.canvas)"
                    :title="`${index + 1}. ${imageData.text}`"
                  ></canvas>
                  <div class="adjust-controls">
                    <div class="adjust-row">
                      <n-button 
                        size="tiny" 
                        :type="imageData.settings?.aspectRatio === 'wide' ? 'primary' : 'default'"
                        @click="regenerateImage(index, 'wide')"
                      >
                        宽型
                      </n-button>
                      <n-button 
                        size="tiny" 
                        :type="imageData.settings?.aspectRatio === 'medium' ? 'primary' : 'default'"
                        @click="regenerateImage(index, 'medium')"
                      >
                        标准
                      </n-button>
                      <n-button 
                        size="tiny" 
                        :type="imageData.settings?.aspectRatio === 'narrow' ? 'primary' : 'default'"
                        @click="regenerateImage(index, 'narrow')"
                      >
                        窄型
                      </n-button>
                    </div>
                    <div class="adjust-row">
                      <n-button 
                        size="tiny" 
                        :type="imageData.settings?.mirrorH ? 'primary' : 'default'"
                        @click="toggleMirror(index, 'horizontal')"
                        :title="imageData.settings?.mirrorH ? '取消水平镜像' : '水平镜像'"
                      >
                        水平镜像
                      </n-button>
                      <n-button 
                        size="tiny" 
                        :type="imageData.settings?.mirrorV ? 'primary' : 'default'"
                        @click="toggleMirror(index, 'vertical')"
                        :title="imageData.settings?.mirrorV ? '取消垂直镜像' : '垂直镜像'"
                      >
                        垂直镜像
                      </n-button>
                    </div>
                <div class="adjust-row">
                  <n-button 
                    size="tiny"
                    @click="adjustFontSize(index, 'increase')"
                  >
                    字体-
                  </n-button>
                  <n-button 
                    size="tiny"
                    @click="adjustFontSize(index, 'decrease')"
                  >
                    字体+
                  </n-button>
                </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>

        <!-- 底部控制面板 -->
        <footer class="control-panel" :class="{ 'is-collapsed': collapsedSettings }">
          <div class="section-header" @click="collapsedSettings = !collapsedSettings">
            <div class="header-left">
              <span class="section-title">⚙️ 设置面板</span>
            </div>
            <div class="header-actions">
              <button 
                class="collapse-btn" 
                @click.stop
                :title="collapsedSettings ? '展开' : '收起'"
              >
                {{ collapsedSettings ? '▼' : '▲' }}
              </button>
            </div>
          </div>
          <div class="collapsible-content" v-show="!collapsedSettings">
            <!-- 预设样式 -->
            <div class="params-group">
              <div class="params-group-header">
                <label class="params-label">预设样式</label>
                <span class="current-style-hint">
                  当前: {{ currentPresetStyle?.name }}
                </span>
              </div>
              <div class="preset-styles-grid">
                <div
                  v-for="(style, index) in presetStyles"
                  :key="index"
                  class="preset-style-item"
                  :class="{ 'active': currentPresetIndex === index }"
                  :style="{ color: style.fontColor, backgroundColor: style.strokeColor }"
                  :title="`${style.name} (样式 ${index + 1})`"
                  @click="applyPresetStyle(index)"
                >
                  <span>T</span>
                </div>
              </div>
            </div>

            <!-- 字体样式设置 -->
            <div class="params-group">
              <div class="params-group-header">
                <label class="params-label">字体样式</label>
              </div>
              <div class="params-grid">
                <div class="param-item param-item-with-action">
                  <label>字体</label>
                  <div class="param-input-group">
                    <n-select v-model:value="fontFamily" :options="fontOptions" size="small" />
                    <n-button 
                      size="small" 
                      @click="refreshFontList"
                      :loading="fontRefreshing"
                      title="刷新字体列表（可检测新安装的字体）"
                      style="flex-shrink: 0;"
                    >
                      <svg v-if="!fontRefreshing" viewBox="0 0 16 16" width="14" height="14" fill="currentColor">
                        <path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                        <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/>
                      </svg>
                    </n-button>
                  </div>
                </div>
                <div class="param-item">
                  <label>宽高比</label>
                  <n-select v-model:value="aspectRatio" :options="aspectRatioOptions" size="small" />
                </div>
                <div class="param-item">
                  <label>字体颜色</label>
                  <div class="color-input-group">
                    <input type="color" v-model="fontColor" class="color-picker" />
                    <n-input :value="fontColor" readonly size="small" />
                  </div>
                </div>
                <div class="param-item">
                  <label>字体大小</label>
                  <n-input-number v-model:value="fontSize" :min="12" :max="100" size="small" />
                </div>
                <div class="param-item">
                  <label>字间距</label>
                  <n-input-number
                    v-model:value="letterSpacingPercent"
                    :min="0"
                    :max="200"
                    :step="1"
                    size="small"
                  >
                    <template #suffix>%</template>
                  </n-input-number>
                </div>
                <div class="param-item">
                  <label>描边颜色</label>
                  <div class="color-input-group">
                    <input type="color" v-model="strokeColor" class="color-picker" />
                    <n-input :value="strokeColor" readonly size="small" />
                  </div>
                </div>
                <div class="param-item">
                  <label>描边大小</label>
                  <n-input-number v-model:value="strokeWidth" :min="0" :max="100" :step="1" size="small" />
                </div>
              </div>
            </div>
          </div>
        </footer>
      </div>
    </div>

    <!-- 预览图弹窗 -->
    <n-modal
      v-model:show="showPreviewModal"
      preset="card"
      title="🔍 高清"
      style="width: 80%; max-width: 1200px;"
      :bordered="false"
    >
      <div class="preview-modal-content">
        <canvas 
          ref="previewModalCanvas" 
          class="preview-modal-canvas"
        ></canvas>
        <div class="preview-modal-hint">
          💡 点击外部区域或按 ESC 关闭
        </div>
      </div>
    </n-modal>

    <!-- 拖拽跟随预览层 -->
    <div
      v-show="isDragging"
      ref="dragFollowPreview"
      class="drag-follow-preview"
      :style="{
        left: (dragMouseX - dragCalibration.dx) + 'px',
        top: (dragMouseY - dragCalibration.dy) + 'px',
        opacity: hasTriggeredSystemDrag ? 0 : 1
      }"
    >
      <canvas ref="dragFollowCanvas" class="drag-preview-canvas"></canvas>
      <div v-if="isNearBoundary && !hasTriggeredSystemDrag" class="drag-hint">
        松开鼠标保存图片
      </div>
    </div>
  </div>
</template>

<script setup>
/** 对话框文字生成页面：管理模板懒加载、文本样式、图片重生成与批量导出。 */
import { ref, reactive, computed, onMounted, onBeforeUnmount, nextTick, watch } from 'vue'
import { useRouter, onBeforeRouteLeave } from 'vue-router'
import { NButton, NInput, NInputNumber, NSelect, NModal, NSlider, NTag, useMessage } from 'naive-ui'
import { loadAllDialogImages, getCategories } from './utils/image-loader.js'
import { generateSingleImageNew } from './utils/image-generator.js'
import { presetStyles } from './utils/preset-styles.js'
import { getSystemFonts } from './utils/utils.js'
import { useDragState } from './composables/useDragState.js'
import { useDragHandlers } from './composables/useDragHandlers.js'
import * as dragConstants from './constants/dragConstants.js'

const router = useRouter()
const message = useMessage()

// ==================== 拖拽功能 ====================
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

// 窗口边界信息
const windowBounds = ref({ x: 0, y: 0, width: 0, height: 0 })
/**
 * 读取窗口边界供图片拖拽判断使用。
 * 处理流程：
 * 1、调用桌面接口并在成功时更新边界
 */
const updateWindowBounds = async () => {
  // 1、同步当前桌面窗口边界，异常时保留原值。
  try {
    const result = await window.electronAPI?.windowGetBounds()
    if (result && result.success) {
      windowBounds.value = result.bounds
    }
  } catch (error) {
    console.warn('获取窗口边界失败:', error)
  }
}

/**
 * 构建带时间戳的建议导出文件名。
 * 处理流程：
 * 1、格式化当前日期时间并添加图片扩展名
 */
const buildSuggestedFileName = () => {
  // 1、将当前时间转换为文件名中的年月日时分秒。
  const now = new Date()
  const timestamp = now.getFullYear() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') +
    '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0')
  return `dialog_${timestamp}.png`
}

// 初始化拖拽处理器
const dragHandlers = useDragHandlers({
  state: dragState,
  constants: dragConstants,
  deps: {
    canvasRef: null, // 临时存储当前拖拽的canvas
    currentCanvas: null,
    updateWindowBounds,
    windowBounds,
    message,
    buildSuggestedFileName
  }
})

const { handleImageMouseDown, handleDragFinished } = dragHandlers

// ==================== 模板管理 ====================
const templates = ref([])
const categories = ref([])
const selectedTemplate = ref(null)
const expandedCategories = ref([])
const templateCanvasRefs = reactive({})

// 模板资源懒加载 & 缓存控制
const CATEGORY_UNLOAD_DELAY = 45 * 1000 // 45秒未使用后释放资源
const categoryLoadState = reactive({})
const categoryLoadPromises = new Map()
const categoryUnloadTimers = new Map()
const templateImagePromises = new Map()
const generatedImages = ref([])

/**
 * 获取指定分类下的模板。
 * 处理流程：
 * 1、按分类编号筛选模板列表
 */
const getCategoryTemplates = (categoryId) => {
  // 1、返回属于目标分类的模板。
  return templates.value.filter(t => t.categoryId === categoryId)
}

/**
 * 切换模板分类的展开状态。
 * 处理流程：
 * 1、已展开时折叠并安排资源释放
 * 2、未展开时展开并加载图片
 */
const toggleCategory = (categoryId) => {
  // 1、定位当前分类，折叠时延迟释放图片。
  const index = expandedCategories.value.indexOf(categoryId)
  if (index > -1) {
    expandedCategories.value.splice(index, 1)
    scheduleCategoryUnload(categoryId)
  } else {
    // 2、展开分类并触发按需加载。
    expandedCategories.value.push(categoryId)
    loadCategoryImages(categoryId)
  }
}

// ==================== 模板资源懒加载 ====================
/**
 * 为有效分类补齐懒加载状态。
 * 处理流程：
 * 1、分类编号有效且尚无状态时创建默认记录
 */
const ensureCategoryState = (categoryId) => {
  // 1、避免覆盖已有分类的加载状态。
  if (!categoryId) return
  if (!categoryLoadState[categoryId]) {
    categoryLoadState[categoryId] = {
      loaded: false,
      loading: false,
      lastUsed: 0
    }
  }
}

/**
 * 将图片地址加载为可绘制的图片元素。
 * 处理流程：
 * 1、检查图片地址
 * 2、监听加载结果并设置图片源
 */
const loadImageElement = (source) => new Promise((resolve, reject) => {
  // 1、拒绝缺少地址的图片请求。
  if (!source) {
    reject(new Error('无效的图片地址'))
    return
  }
  // 2、将图片加载事件转换为异步任务结果。
  const img = new Image()
  img.onload = () => resolve(img)
  img.onerror = (err) => reject(err || new Error(`加载图片失败: ${source}`))
  img.src = source
})

/**
 * 判断模板图片是否已有加载任务。
 * 处理流程：
 * 1、检查模板编号对应的任务缓存
 */
const templateImageIsPending = (templateId) => templateImagePromises.has(templateId)

/**
 * 确保模板图片已加载并合并重复请求。
 * 处理流程：
 * 1、检查模板并直接复用已加载图片
 * 2、复用或创建加载任务，成功时保存图片
 * 3、任务结束后清除待处理记录并返回结果
 */
const ensureTemplateImage = async (template) => {
  // 1、验证模板及图片源并优先复用已解码图片。
  if (!template) return null
  if (template.image) return template.image
  if (!template.imageSource) {
    console.warn('模板缺少 imageSource，无法加载:', template)
    return null
  }
  
  // 2、同一模板同时只创建一个图片加载任务。
  let pending = templateImagePromises.get(template.id)
  if (!pending) {
    pending = loadImageElement(template.imageSource)
      .then((img) => {
        template.image = img
        return img
      })
      .catch((error) => {
        console.error(`加载模板 "${template.name}" 失败:`, error)
        return null
      })
      .finally(() => {
        // 3、无论成功失败都允许后续请求重新尝试。
        templateImagePromises.delete(template.id)
      })
    templateImagePromises.set(template.id, pending)
  }
  return pending
}

/**
 * 取消分类的延迟资源释放任务。
 * 处理流程：
 * 1、清除已登记的定时器及缓存记录
 */
const clearCategoryUnloadTimer = (categoryId) => {
  // 1、同时取消定时回调和分类任务记录。
  const timer = categoryUnloadTimers.get(categoryId)
  if (timer) {
    clearTimeout(timer)
    categoryUnloadTimers.delete(categoryId)
  }
}

/**
 * 判断模板是否仍被当前选择或生成结果引用。
 * 处理流程：
 * 1、检查模板编号、当前选择及生成图片中的模板信息
 */
const isTemplateInUse = (templateId) => {
  // 1、保留当前选择或已有生成结果所依赖的模板。
  if (!templateId) return false
  if (selectedTemplate.value?.id === templateId) return true
  return generatedImages.value.some(image => image?.templateInfo?.id === templateId)
}

/**
 * 释放指定分类中可卸载的图片资源。
 * 处理流程：
 * 1、取得分类模板并跳过仍在使用的资源
 * 2、清空预览和图片元素引用
 * 3、同步分类状态，必要时再次安排释放
 */
const releaseCategoryImages = (categoryId, { force = false } = {}) => {
  // 1、限定释放范围，非强制模式保留被引用的模板。
  const targetTemplates = templates.value.filter(t => t.categoryId === categoryId)
  if (targetTemplates.length === 0) return
  
  let released = 0
  targetTemplates.forEach(template => {
    const shouldKeep = !force && isTemplateInUse(template.id)
    if (shouldKeep || !template.image) return
    
    // 2、清理预览像素及已加载图片引用。
    const canvas = templateCanvasRefs[template.id]
    if (canvas) {
      const ctx = canvas.getContext('2d')
      ctx?.clearRect(0, 0, canvas.width, canvas.height)
    }
    if (template.image instanceof HTMLImageElement) {
      template.image.src = ''
    }
    template.image = null
    released++
  })
  
  if (released > 0) {
    console.log(`♻️ 已释放 ${released} 个模板资源（分类: ${categoryId}）`)
  }
  
  // 3、更新分类加载标记并按需等待剩余资源解除引用。
  ensureCategoryState(categoryId)
  const stillLoaded = targetTemplates.some(t => t.image)
  categoryLoadState[categoryId].loaded = stillLoaded
  categoryLoadState[categoryId].loading = false
  
  if (!force && stillLoaded && !expandedCategories.value.includes(categoryId)) {
    // 仍有模板因正在使用而保留，稍后再次尝试释放
    scheduleCategoryUnload(categoryId)
  }
}

/**
 * 安排分类图片的延迟释放。
 * 处理流程：
 * 1、初始化分类状态并替换旧定时器
 * 2、到期时移除任务记录并执行资源释放
 */
const scheduleCategoryUnload = (categoryId) => {
  // 1、每个分类只保留一个延迟释放任务。
  if (!categoryId) return
  ensureCategoryState(categoryId)
  clearCategoryUnloadTimer(categoryId)
  const timer = setTimeout(() => {
    // 2、到期后释放当前可卸载的模板图片。
    categoryUnloadTimers.delete(categoryId)
    releaseCategoryImages(categoryId)
  }, CATEGORY_UNLOAD_DELAY)
  categoryUnloadTimers.set(categoryId, timer)
}

/**
 * 读取分类是否正在加载。
 * 处理流程：
 * 1、返回已有分类状态中的加载标记
 */
const categoryIsLoading = (categoryId) => categoryLoadState[categoryId]?.loading

/**
 * 按需加载分类图片并合并并发请求。
 * 处理流程：
 * 1、检查分类并取消待释放任务
 * 2、复用已加载状态或当前加载任务
 * 3、并行加载模板并更新状态和预览
 */
const loadCategoryImages = async (categoryId) => {
  // 1、确认可加载的分类并阻止其资源提前释放。
  if (!categoryId || templates.value.length === 0) return
  ensureCategoryState(categoryId)
  clearCategoryUnloadTimer(categoryId)
  
  // 2、已完成或正在执行的加载直接复用。
  if (categoryLoadState[categoryId].loaded) {
    categoryLoadState[categoryId].lastUsed = Date.now()
    return
  }
  
  if (categoryIsLoading(categoryId)) {
    return categoryLoadPromises.get(categoryId)
  }
  
  // 3、为分类创建统一任务并绘制已加载模板预览。
  const promise = (async () => {
    categoryLoadState[categoryId].loading = true
    const targetTemplates = templates.value.filter(t => t.categoryId === categoryId)
    if (targetTemplates.length === 0) {
      categoryLoadState[categoryId].loading = false
      return
    }
    await Promise.all(targetTemplates.map(template => ensureTemplateImage(template)))
    categoryLoadState[categoryId].loaded = true
    categoryLoadState[categoryId].loading = false
    categoryLoadState[categoryId].lastUsed = Date.now()
    renderTemplatePreview(targetTemplates)
  })().finally(() => {
    categoryLoadPromises.delete(categoryId)
  })
  
  categoryLoadPromises.set(categoryId, promise)
  return promise
}

/**
 * 清理模板分类的定时器和图片资源。
 * 处理流程：
 * 1、取消全部延迟卸载任务
 * 2、按分类去重后执行资源释放
 */
const cleanupAllTemplateResources = (force = false) => {
  // 1、取消仍在等待的释放任务。
  categoryUnloadTimers.forEach(timer => clearTimeout(timer))
  categoryUnloadTimers.clear()
  
  // 2、每个分类仅释放一次。
  const processedCategories = new Set()
  templates.value.forEach(template => {
    if (!processedCategories.has(template.categoryId)) {
      releaseCategoryImages(template.categoryId, { force })
      processedCategories.add(template.categoryId)
    }
  })
}

// ==================== 自定义上传 ====================
const fileInputRef = ref(null)
const CUSTOM_CATEGORY_ID = 'custom_upload'
const CUSTOM_CATEGORY = { id: CUSTOM_CATEGORY_ID, name: '自定义上传', folder: '', count: 0 }

/**
 * 确保自定义上传分类存在。
 * 处理流程：
 * 1、分类缺失时插入列表并创建加载状态
 */
const ensureCustomCategory = () => {
  // 1、避免重复添加自定义分类。
  if (!categories.value.find(c => c.id === CUSTOM_CATEGORY_ID)) {
    categories.value = [CUSTOM_CATEGORY, ...categories.value]
    ensureCategoryState(CUSTOM_CATEGORY_ID)
  }
}

/**
 * 打开自定义模板的文件选择器。
 * 处理流程：
 * 1、文件输入已挂载时触发选择
 */
const onClickUploadTemplates = () => {
  // 1、让用户选择自定义图片模板。
  if (fileInputRef.value) fileInputRef.value.click()
}

/**
 * 读取并持久化用户选择的自定义模板。
 * 处理流程：
 * 1、取得文件列表并确保自定义分类存在
 * 2、逐个读取图片并保存到系统目录
 * 3、合并成功模板、展开分类并刷新预览
 * 4、清空输入并报告导入结果
 */
const onFilesSelected = async (e) => {
  // 1、确认文件列表并准备新模板集合。
  try {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    ensureCustomCategory()
    const newItems = []
    
    // 2、按文件顺序读取图片并持久化成功项。
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const dataURL = await readFileAsDataURL(file)
      const img = await loadImageFromDataURL(dataURL)
      
      // 提取base64数据（去掉data:image/xxx;base64,前缀）
      const base64Data = dataURL.split(',')[1]
      
      // 保存到系统目录
      const result = await window.customDialog.save(file.name, base64Data)
      
      if (result.success) {
        const id = `${CUSTOM_CATEGORY_ID}_${result.fileName}`
        newItems.push({
          id,
          categoryId: CUSTOM_CATEGORY_ID,
          categoryName: CUSTOM_CATEGORY.name,
          name: file.name,
          fileName: result.fileName,
          image: img,
          imageSource: dataURL,
          index: templates.value.length + i + 1
        })
      } else {
        console.error('保存文件失败:', result.error)
      }
    }
    
    // 3、将新模板放在列表前方并显示预览。
    templates.value = [...newItems, ...templates.value]
    
    // 展开"自定义上传"分类并滚动渲染
    if (!expandedCategories.value.includes(CUSTOM_CATEGORY_ID)) {
      expandedCategories.value.unshift(CUSTOM_CATEGORY_ID)
      loadCategoryImages(CUSTOM_CATEGORY_ID)
    }
    await nextTick()
    renderTemplatePreview()
    if (!selectedTemplate.value && newItems.length > 0) {
      selectedTemplate.value = newItems[0]
    }
    // 4、清空输入以便下次选择同一文件也会触发变化事件。
    if (fileInputRef.value) fileInputRef.value.value = ''
    message.success(`已添加 ${newItems.length} 个自定义模板`)
  } catch (err) {
    console.error('自定义模板上传失败:', err)
    message.error('上传失败')
  }
}

/**
 * 将文件读取为图片数据地址。
 * 处理流程：
 * 1、监听文件读取结果并启动数据地址读取
 */
const readFileAsDataURL = (file) => new Promise((resolve, reject) => {
  // 1、将文件读取事件转换为异步结果。
  const reader = new FileReader()
  reader.onload = () => resolve(reader.result)
  reader.onerror = reject
  reader.readAsDataURL(file)
})

/**
 * 解码图片数据地址。
 * 处理流程：
 * 1、复用统一图片元素加载函数
 */
const loadImageFromDataURL = (dataURL) => loadImageElement(dataURL)

/**
 * 扫描并加载已保存的自定义对话框。
 * 处理流程：
 * 1、读取系统目录中的自定义模板记录
 * 2、构造懒加载模板并替换旧自定义列表
 * 3、返回加载数量，异常时返回零
 */
const loadCustomDialogs = async () => {
  // 1、向主进程请求已保存的自定义模板。
  try {
    const result = await window.customDialog.scan()
    if (result.success && result.dialogs.length > 0) {
      ensureCustomCategory()
      // 2、保留图片源并延迟实际解码。
      const customItems = []
      for (const dialog of result.dialogs) {
        const id = `${CUSTOM_CATEGORY_ID}_${dialog.fileName}`
        customItems.push({
          id,
          categoryId: CUSTOM_CATEGORY_ID,
          categoryName: CUSTOM_CATEGORY.name,
          name: dialog.fileName,
          fileName: dialog.fileName,
          image: null,
          imageSource: dialog.dataURL,
          index: templates.value.length + customItems.length + 1
        })
      }
      
      // 移除旧的自定义模板
      templates.value = templates.value.filter(t => t.categoryId !== CUSTOM_CATEGORY_ID)
      // 添加新扫描的模板
      templates.value = [...customItems, ...templates.value]
      
      console.log(`加载了 ${customItems.length} 个自定义模板`)
      // 3、将扫描结果数量提供给初始化提示。
      return customItems.length
    }
    return 0
  } catch (err) {
    console.error('加载自定义模板失败:', err)
    return 0
  }
}

/**
 * 设置当前使用的对话框模板。
 * 处理流程：
 * 1、更新模板选择并记录选择信息
 */
const selectTemplate = (template) => {
  // 1、让后续生成使用指定模板。
  selectedTemplate.value = template
  console.log('已选择模板:', template.name)
}

/**
 * 删除用户选择的自定义模板。
 * 处理流程：
 * 1、确认删除意图并调用本地模板删除接口
 * 2、成功后清理列表、当前选择和空分类
 * 3、刷新预览并提示删除结果
 */
const deleteCustomTemplate = async (template) => {
  // 1、确认后删除持久化模板文件。
  try {
    const confirmed = window.confirm(`确定要删除自定义模板"${template.name}"吗？`)
    if (!confirmed) return
    
    const result = await window.customDialog.delete(template.fileName)
    
    if (result.success) {
      // 2、从模板列表中移除，并同步当前选择和分类状态。
      templates.value = templates.value.filter(t => t.id !== template.id)
      
      // 如果删除的是当前选中的模板，清空选择
      if (selectedTemplate.value && selectedTemplate.value.id === template.id) {
        selectedTemplate.value = null
      }
      
      // 如果自定义分类已经没有模板了，移除该分类
      const customTemplatesCount = templates.value.filter(t => t.categoryId === CUSTOM_CATEGORY_ID).length
      if (customTemplatesCount === 0) {
        categories.value = categories.value.filter(c => c.id !== CUSTOM_CATEGORY_ID)
        delete categoryLoadState[CUSTOM_CATEGORY_ID]
      }
      
      // 3、等待模板节点更新后重新绘制预览。
      await nextTick()
      renderTemplatePreview()
      
      message.success('模板已删除')
    } else {
      message.error('删除失败: ' + result.error)
    }
  } catch (err) {
    console.error('删除模板失败:', err)
    message.error('删除失败')
  }
}

// ==================== 参数设置 ====================
const textInput = ref('')
const fontFamily = ref('微软雅黑')
const fontColor = ref('#000000')
const fontSize = ref(32)
const letterSpacingPercent = ref(20)
const strokeColor = ref('#ffffff')
const strokeWidth = ref(40)
const aspectRatio = ref('wide')

// 动态获取的系统字体列表
const availableFonts = ref([])
const fontRefreshing = ref(false)

const fontOptions = computed(() => {
  return availableFonts.value.map(font => ({
    label: font,
    value: font
  }))
})

/**
 * 刷新可用于文字绘制的系统字体列表。
 * 处理流程：
 * 1、显示加载状态并重新读取字体
 * 2、更新列表并提示结果，最终恢复空闲状态
 */
const refreshFontList = async () => {
  // 1、标记刷新中并请求系统字体。
  try {
    fontRefreshing.value = true
    message.loading('正在刷新字体列表...', { duration: 0 })
    
    const systemFonts = await getSystemFonts()
    // 2、同步字体列表并结束加载提示。
    availableFonts.value = systemFonts
    
    message.destroyAll()
    message.success(`字体列表已刷新：${systemFonts.length} 个字体`)
    console.log(`刷新字体列表完成：${systemFonts.length} 个字体`)
  } catch (error) {
    console.error('刷新字体列表失败:', error)
    message.destroyAll()
    message.error('刷新字体列表失败')
  } finally {
    fontRefreshing.value = false
  }
}

const aspectRatioOptions = [
  { label: '宽型（默认）', value: 'wide' },
  { label: '标准型', value: 'medium' },
  { label: '窄型', value: 'narrow' }
]

// ==================== 预设样式 ====================
const currentPresetIndex = ref(0)
const currentPresetStyle = computed(() => presetStyles[currentPresetIndex.value])

/**
 * 应用预设文字配色和描边样式。
 * 处理流程：
 * 1、读取预设并同步颜色、描边和选中编号
 */
const applyPresetStyle = (index) => {
  // 1、将所选预设写入当前文字样式。
  const style = presetStyles[index]
  currentPresetIndex.value = index
  
  fontColor.value = style.fontColor
  strokeColor.value = style.strokeColor
  strokeWidth.value = style.strokeWidth
  
  console.log('应用预设样式:', style.name)
}

// ==================== 图片生成 ====================
const previewCanvasRefs = reactive({})

/**
 * 按每行文本批量生成对话框图片。
 * 处理流程：
 * 1、验证模板、文本并确保模板图片已加载
 * 2、清空旧结果并筛选有效文本行
 * 3、逐行临时映射生成参数并调用图片生成器
 * 4、保存结果、刷新预览并报告生成结果
 */
const generateImages = async () => {
  // 1、检查生成所需的模板和非空文本。
  if (!selectedTemplate.value) {
    message.warning('请先选择一个对话框模板！')
    return
  }
  
  if (!textInput.value.trim()) {
    message.warning('请输入文本内容！')
    return
  }
  
  // 确保模板资源已加载
  const activeTemplate = selectedTemplate.value
  await ensureTemplateImage(activeTemplate)
  if (!activeTemplate?.image) {
    message.error('模板资源加载失败，请稍后重试')
    return
  }
  
  // 2、清空之前的结果并提取有效文本行。
  generatedImages.value = []
  
  const lines = textInput.value.split('\n').filter(line => line.trim())
  
  if (lines.length === 0) {
    message.warning('没有有效的文本内容！')
    return
  }
  
  message.loading('正在生成图片...', { duration: 1000 })
  
  // 3、延后执行逐行生成，让加载提示先显示。
  setTimeout(() => {
    try {
      const images = []
      
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i].trim()
        if (!text) continue
        
        // 创建临时DOM元素来存储参数
        const tempFontSelect = { value: fontFamily.value }
        const tempFontColor = { value: fontColor.value }
        const tempFontSize = { value: fontSize.value }
        const tempStrokeColor = { value: strokeColor.value }
        const tempStrokeWidth = { value: strokeWidth.value }
        const tempAspectRatio = { value: aspectRatio.value }
        const tempLetterSpacing = { value: letterSpacingPercent.value }
        
        // 临时设置document.getElementById
        const originalGetElementById = document.getElementById
        document.getElementById = (id) => {
          if (id === 'fontSelect') return tempFontSelect
          if (id === 'fontColor') return tempFontColor
          if (id === 'fontSize') return tempFontSize
          if (id === 'strokeColor') return tempStrokeColor
          if (id === 'strokeWidth') return tempStrokeWidth
          if (id === 'aspectRatio') return tempAspectRatio
          if (id === 'letterSpacingPercent') return tempLetterSpacing
          return originalGetElementById.call(document, id)
        }
        
        const imageData = generateSingleImageNew(text, i, activeTemplate, null, false, false) // 默认不镜像
        
        // 恢复document.getElementById
        document.getElementById = originalGetElementById
        
        if (imageData) {
          images.push(imageData)
        }
      }
      
      // 4、发布本次结果并在节点更新后绘制预览。
      generatedImages.value = images
      
      // 渲染预览
      nextTick(() => {
        renderPreviewCanvases()
      })
      
      message.success(`成功生成 ${images.length} 张图片`)
    } catch (error) {
      console.error('生成图片失败:', error)
      message.error(`生成失败: ${error.message}`)
    }
  }, 100)
}

/**
 * 将生成结果复制到对应的预览画布。
 * 处理流程：
 * 1、逐项匹配已挂载的预览画布
 * 2、同步像素尺寸并绘制结果，显示尺寸交给样式适配
 */
const renderPreviewCanvases = () => {
  // 1、按结果索引找到目标预览。
  generatedImages.value.forEach((imageData, index) => {
    const canvas = previewCanvasRefs[index]
    if (canvas) {
      // 2、设置画布的实际像素尺寸并复制图片。
      canvas.width = imageData.canvas.width
      canvas.height = imageData.canvas.height
      
      // 绘制图像
      const ctx = canvas.getContext('2d', { alpha: true })
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(imageData.canvas, 0, 0)
      
      // 使用CSS让canvas自适应容器，保持宽高比
      // 不设置固定的style.width和style.height，让CSS来控制
      canvas.style.width = '100%'
      canvas.style.height = 'auto'
      canvas.style.display = 'block'
    }
  })
}

/**
 * 按新的宽高比重新生成指定图片。
 * 处理流程：
 * 1、覆盖宽高比执行重生成并在成功时提示
 */
const regenerateImage = async (index, newAspectRatio) => {
  // 1、保留该图片其他参数，仅覆盖本次宽高比。
  const result = await regenerateExistingImage(index, { aspectRatio: newAspectRatio })
  if (result) {
    message.success('图片已重新生成')
  }
}

/**
 * 切换对话框的镜像方向并保持文字可读。
 * 处理流程：
 * 1、读取当前图片和横纵镜像标记
 * 2、切换指定方向后重生成并提示结果
 */
const toggleMirror = async (index, direction = 'horizontal') => {
  // 1、读取目标图片的现有镜像状态。
  const imageData = generatedImages.value[index]
  if (!imageData) return

  const currentMirrorH = imageData.settings?.mirrorH || false
  const currentMirrorV = imageData.settings?.mirrorV || false
  // 2、仅覆盖选定方向的镜像标记。
  const overrides = direction === 'horizontal'
    ? { mirrorH: !currentMirrorH }
    : { mirrorV: !currentMirrorV }
  const result = await regenerateExistingImage(index, overrides)
  if (result) {
    const isApplied = direction === 'horizontal' ? !currentMirrorH : !currentMirrorV
    const directionName = direction === 'horizontal' ? '水平' : '垂直'
    const action = isApplied ? '已应用' : '已取消'
    message.success(`${action}${directionName}镜像`)
  }
}

// ==================== 导出功能 ====================
/**
 * 批量保存全部生成图片。
 * 处理流程：
 * 1、确认存在结果并选择输出目录
 * 2、按编号将各画布保存为图片
 * 3、提示完成并打开目录，异常时关闭加载提示
 */
const exportAllImages = async () => {
  // 1、检查可导出结果并取得用户选择的目录。
  if (generatedImages.value.length === 0) {
    message.warning('请先生成图片！')
    return
  }
  
  try {
    // 选择导出文件夹
    const result = await window.fileSystem?.selectFolder()
    
    if (!result || !result.success) {
      if (!result?.canceled) {
        message.error('选择文件夹失败')
      }
      return
    }
    
    const exportPath = result.path
    message.loading('正在导出图片...', { duration: 0 })
    
    // 2、导出每张图片。
    for (let i = 0; i < generatedImages.value.length; i++) {
      const imageData = generatedImages.value[i]
      // 获取 base64 数据，去掉 data URL 前缀
      const dataURL = imageData.canvas.toDataURL('image/png', 1.0)
      const base64Data = dataURL.split(',')[1]
      const fileName = `dialog_${String(i + 1).padStart(3, '0')}.png`
      const filePath = `${exportPath}\\${fileName}`
      
      await window.api?.writeFile(filePath, base64Data)
    }
    
    message.destroyAll()
    // 3、报告导出数量并展示输出目录。
    message.success(`成功导出 ${generatedImages.value.length} 张图片`)
    
    // 打开文件夹
    if (window.fileSystem?.openFolder) {
      await window.fileSystem.openFolder(exportPath)
    }
  } catch (error) {
    console.error('导出失败:', error)
    message.destroyAll()
    message.error(`导出失败: ${error.message}`)
  }
}

// ==================== 图片预览 ====================
const showPreviewModal = ref(false)
const previewModalCanvas = ref(null)

/**
 * 在预览弹窗中显示生成图片。
 * 处理流程：
 * 1、打开弹窗并等待画布节点挂载
 * 2、同步原始像素尺寸并绘制图片
 */
const showImagePreview = (imageData) => {
  // 1、先使弹窗及其画布进入文档。
  showPreviewModal.value = true
  
  nextTick(() => {
    if (previewModalCanvas.value) {
      // 2、以原始像素尺寸复制生成结果。
      previewModalCanvas.value.width = imageData.canvas.width
      previewModalCanvas.value.height = imageData.canvas.height
      const ctx = previewModalCanvas.value.getContext('2d', { alpha: true })
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(imageData.canvas, 0, 0)
    }
  })
}

// ==================== 折叠面板管理 ====================
// 默认展开状态
const collapsedTemplate = ref(true)  // 改为默认折叠
const collapsedTextInput = ref(true)  // 改为默认折叠
const collapsedPreview = ref(false)
const collapsedSettings = ref(false)

// ==================== 预览缩放控制 ====================
const previewScale = ref(100) // 预览缩放比例，默认100%

// ==================== 设置持久化 ====================
/**
 * 将当前文字生成设置保存到本地存储。
 * 处理流程：
 * 1、收集字体、配色、描边和宽高比参数
 * 2、序列化写入本地存储，失败时记录日志
 */
const saveSettings = () => {
  // 1、创建当前设置的可序列化快照。
  try {
    const settings = {
      fontFamily: fontFamily.value,
      aspectRatio: aspectRatio.value,
      fontColor: fontColor.value,
      fontSize: fontSize.value,
    letterSpacingPercent: letterSpacingPercent.value,
      strokeColor: strokeColor.value,
      strokeWidth: strokeWidth.value,
      currentPresetIndex: currentPresetIndex.value
    }
    // 2、保存设置供下次进入页面恢复。
    localStorage.setItem('dialogGenerator_settings_v1', JSON.stringify(settings))
  } catch (error) {
    console.warn('保存设置失败:', error)
  }
}

/**
 * 从本地存储恢复文字生成设置。
 * 处理流程：
 * 1、读取并解析已保存的设置
 * 2、逐项恢复存在的字段并返回是否成功加载
 */
const loadSettings = () => {
  // 1、尝试读取之前保存的设置记录。
  try {
    const savedSettings = localStorage.getItem('dialogGenerator_settings_v1')
    if (savedSettings) {
      const settings = JSON.parse(savedSettings)
      
      // 2、恢复各项已有设置，缺失字段沿用默认值。
      if (settings.fontFamily !== undefined) fontFamily.value = settings.fontFamily
      if (settings.aspectRatio !== undefined) aspectRatio.value = settings.aspectRatio
      if (settings.fontColor !== undefined) fontColor.value = settings.fontColor
      if (settings.fontSize !== undefined) fontSize.value = settings.fontSize
      if (settings.letterSpacingPercent !== undefined) letterSpacingPercent.value = settings.letterSpacingPercent
      if (settings.strokeColor !== undefined) strokeColor.value = settings.strokeColor
      if (settings.strokeWidth !== undefined) strokeWidth.value = settings.strokeWidth
      if (settings.currentPresetIndex !== undefined) currentPresetIndex.value = settings.currentPresetIndex
      
      console.log('已恢复用户设置')
      return true
    }
  } catch (error) {
    console.warn('加载设置失败:', error)
  }
  return false
}

// 监听设置变化并自动保存
watch([fontFamily, aspectRatio, fontColor, fontSize, letterSpacingPercent, strokeColor, strokeWidth, currentPresetIndex], () => {
  saveSettings()
}, { deep: true })

// ==================== 初始化 ====================
/**
 * 初始化对话框页面的素材、字体和用户设置。
 * 处理流程：
 * 1、并行加载内置模板与系统字体，初始化素材分类。
 * 2、补充自定义模板并显示加载结果，默认选择首个内置模板。
 * 3、恢复已保存的样式和文本；没有样式记录时应用默认预设。
 * 4、加载异常时清除等待提示并显示失败原因。
 */
onMounted(async () => {
  try {
    // 1、并行加载模板和字体。
    message.loading('正在初始化...', { duration: 0 })
    
    const [loadedTemplates, systemFonts] = await Promise.all([
      loadAllDialogImages(),
      getSystemFonts()
    ])
    
    // 2、写入字体、内置模板与分类，并初始化分类状态。
    availableFonts.value = systemFonts
    console.log(`获取到 ${systemFonts.length} 个系统字体`)
    
    // 设置模板
    templates.value = loadedTemplates
    categories.value = getCategories()
    categories.value.forEach(category => ensureCategoryState(category.id))
    
    // 3、加载自定义对话框后汇总本次加载数量。
    const customCount = await loadCustomDialogs()
    
    message.destroyAll()
    const totalCount = loadedTemplates.length + customCount
    message.success(`加载完成：${totalCount} 个模板（内置 ${loadedTemplates.length} 个，自定义 ${customCount} 个），${systemFonts.length} 个字体`)
    
    // 4、默认选中第一个内置模板，分类保持折叠状态。
    if (loadedTemplates.length > 0) {
      selectedTemplate.value = loadedTemplates[0]
      // expandedCategories.value = categories.value.map(c => c.id).filter(Boolean) // 注释掉自动展开
    }
    
    // 5、恢复用户设置，缺失时应用默认预设样式。
    const hasLoadedSettings = loadSettings()
    if (!hasLoadedSettings) {
      applyPresetStyle(0)
    }
    
    // 6、从本地存储恢复文本内容。
    const savedText = localStorage.getItem('dialogGenerator_textInput_v1')
    if (savedText) {
      textInput.value = savedText
    }
  } catch (error) {
    // 7、关闭等待消息并提示本次初始化失败。
    console.error('初始化失败:', error)
    message.destroyAll()
    message.error(`初始化失败: ${error.message}`)
  }
})

// 自动保存文本内容
watch(textInput, (newValue) => {
  try {
    localStorage.setItem('dialogGenerator_textInput_v1', newValue)
  } catch (error) {
    console.warn('保存文本失败:', error)
  }
}, { debounce: 150 })

/**
 * 渲染全部或指定模板的缩略预览。
 * 处理流程：
 * 1、等待节点更新并确定本次模板范围
 * 2、将已加载模板等比绘制到对应缩略画布
 * 3、记录成功绘制数量
 */
const renderTemplatePreview = (targetTemplates = null) => {
  // 1、兼容单个模板、模板列表和全部模板三种范围。
  nextTick(() => {
    const templateList = Array.isArray(targetTemplates)
      ? targetTemplates
      : targetTemplates
        ? [targetTemplates]
        : templates.value
    
    // 2、跳过尚未加载图片或挂载画布的模板。
    let rendered = 0
    templateList.forEach(template => {
      if (!template?.image) return
      const canvas = templateCanvasRefs[template.id]
      if (!canvas) return
      try {
        const maxWidth = 120
        const scale = maxWidth / template.image.width
        canvas.width = maxWidth
        canvas.height = template.image.height * scale
        
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.drawImage(template.image, 0, 0, canvas.width, canvas.height)
        rendered++
      } catch (error) {
        console.error(`渲染模板 ${template.id} 失败:`, error)
      }
    })
    
    // 3、记录本次实际完成的缩略图数量。
    if (rendered > 0) {
      console.log(`成功渲染 ${rendered} 个模板预览`)
    }
  })
}

const FONT_SIZE_MIN = 12
const FONT_SIZE_MAX = 999 // 移除实际限制，设置为极大值
const FONT_SIZE_ADJUST_STEP = 12 // 每次调整12个字号单位
/**
 * 将数值限制在指定区间。
 * 处理流程：
 * 1、先约束下限，再约束上限
 */
const clampValue = (value, min, max) => Math.min(Math.max(value, min), max)

/**
 * 为依赖表单节点的生成器临时提供参数。
 * 处理流程：
 * 1、保存节点查询接口并定义参数字符串转换
 * 2、为已知参数节点返回当前值，其余查询沿用原实现
 * 3、执行生成回调并始终恢复原节点查询接口
 */
const runWithGeneratorParams = (params, generator) => {
  // 1、保存原始接口，供参数映射与最终恢复使用。
  const originalGetElementById = document.getElementById
  /**
   * 将参数转换为表单可读的字符串。
   * 处理流程：
   * 1、空值转换为空串，其余值转为字符串
   */
  const toStringValue = (val) => {
    // 1、避免空值被序列化为字面量字符串。
    if (val === null || val === undefined) return ''
    return String(val)
  }
  // 2、仅为生成器需要的表单编号提供参数对象。
  document.getElementById = (id) => {
    switch (id) {
      case 'fontSelect':
        return { value: toStringValue(params.fontFamily) }
      case 'fontColor':
        return { value: toStringValue(params.fontColor) }
      case 'fontSize':
        return { value: toStringValue(params.fontSize) }
      case 'strokeColor':
        return { value: toStringValue(params.strokeColor) }
      case 'strokeWidth':
        return { value: toStringValue(params.strokeValue) }
      case 'aspectRatio':
        return { value: toStringValue(params.aspectRatio) }
      case 'letterSpacingPercent':
        return { value: toStringValue(params.letterSpacingPercent) }
      default:
        return originalGetElementById.call(document, id)
    }
  }
  // 3、生成回调结束后恢复原始节点查询，异常时也执行恢复。
  try {
    return generator()
  } finally {
    document.getElementById = originalGetElementById
  }
}

/**
 * 查找生成结果对应的原始模板。
 * 处理流程：
 * 1、优先按图片记录的模板编号查找，否则使用当前选择
 */
const getTemplateForImage = (imageData) => {
  // 1、优先保持重生成使用原模板。
  if (imageData?.templateInfo?.id) {
    const found = templates.value.find(t => t.id === imageData.templateInfo.id)
    if (found) {
      return found
    }
  }
  return selectedTemplate.value
}

/**
 * 合并局部参数并重新生成已有图片。
 * 处理流程：
 * 1、查找目标结果并确保对应模板可用
 * 2、按覆盖值、图片原设置、页面当前值合并参数
 * 3、规范字号、描边及字间距后执行生成
 * 4、替换结果并保留完整设置，随后刷新预览
 */
const regenerateExistingImage = async (index, overrides = {}) => {
  // 1、确认目标图片及其模板资源。
  const imageData = generatedImages.value[index]
  if (!imageData) return null

  const template = getTemplateForImage(imageData)
  if (!template) {
    message.error('原模板不可用，无法重新生成')
    return null
  }
  
  await ensureTemplateImage(template)
  if (!template.image) {
    message.error('模板资源加载失败，无法重新生成')
    return null
  }

  // 2、局部覆盖参数优先于图片原始设置和页面默认值。
  const baseSettings = imageData.settings || {}
  const params = {
    fontFamily: overrides.fontFamily ?? baseSettings.fontFamily ?? fontFamily.value,
    fontColor: overrides.fontColor ?? baseSettings.fontColor ?? fontColor.value,
    fontSize: overrides.fontSize ?? baseSettings.requestedFontSize ?? fontSize.value,
    strokeColor: overrides.strokeColor ?? baseSettings.strokeColor ?? strokeColor.value,
    strokeValue: overrides.strokeValue ?? baseSettings.strokeValue ?? strokeWidth.value,
    aspectRatio: overrides.aspectRatio ?? baseSettings.aspectRatio ?? aspectRatio.value,
    letterSpacingPercent: overrides.letterSpacingPercent ?? baseSettings.letterSpacingPercent ?? letterSpacingPercent.value,
    mirrorH: overrides.mirrorH ?? baseSettings.mirrorH ?? false,
    mirrorV: overrides.mirrorV ?? baseSettings.mirrorV ?? false
  }

  // 3、修正数值参数后在临时参数环境中重新绘制。
  params.fontSize = clampValue(Number(params.fontSize) || fontSize.value, FONT_SIZE_MIN, FONT_SIZE_MAX)
  params.strokeValue = Number(params.strokeValue)
  if (!Number.isFinite(params.strokeValue)) {
    params.strokeValue = 0
  }
  params.letterSpacingPercent = Number(params.letterSpacingPercent)
  if (!Number.isFinite(params.letterSpacingPercent) || params.letterSpacingPercent < 0) {
    params.letterSpacingPercent = Math.max(0, Number(letterSpacingPercent.value) || 0)
  }

  const result = runWithGeneratorParams(params, () =>
    generateSingleImageNew(
      imageData.originalText || imageData.text,
      index,
      template,
      params.aspectRatio,
      params.mirrorH,
      params.mirrorV
    )
  )

  // 4、将生成结果及本次实际参数一起写回指定位置。
  if (result) {
    generatedImages.value.splice(index, 1, {
      ...result,
      settings: {
        ...result.settings,
        fontFamily: params.fontFamily,
        fontColor: params.fontColor,
        strokeColor: params.strokeColor,
        strokeValue: params.strokeValue,
        requestedFontSize: params.fontSize,
        letterSpacingPercent: params.letterSpacingPercent,
        letterSpacingRatio: params.letterSpacingPercent / 100,
        mirrorH: params.mirrorH,
        mirrorV: params.mirrorV,
        aspectRatio: params.aspectRatio
      }
    })
    nextTick(() => {
      renderPreviewCanvases()
    })
  }

  return result
}

/**
 * 按固定步长调整某张图片的文字字号。
 * 处理流程：
 * 1、读取当前字号并计算限制范围内的新值
 * 2、达到边界时提示，否则重生成并报告变化
 */
const adjustFontSize = async (index, direction) => {
  // 1、根据增减方向计算下一字号。
  const imageData = generatedImages.value[index]
  if (!imageData) return

  const currentFontSize = Number(imageData.settings?.requestedFontSize ?? fontSize.value)
  const delta = direction === 'increase' ? FONT_SIZE_ADJUST_STEP : -FONT_SIZE_ADJUST_STEP
  const newFontSize = clampValue(currentFontSize + delta, FONT_SIZE_MIN, FONT_SIZE_MAX)

  // 2、避免在字号边界重复生成。
  if (newFontSize === currentFontSize) {
    message.warning(direction === 'increase' ? '已达到最大字号' : '已达到最小字号')
    return
  }

  const result = await regenerateExistingImage(index, { fontSize: newFontSize })
  if (result) {
    message.success(direction === 'increase' ? `字体已放大 (${currentFontSize} → ${newFontSize})` : `字体已减小 (${currentFontSize} → ${newFontSize})`)
  }
}

const previousExpandedCategories = new Set()
// 监听分类展开，按需加载 / 释放模板资源
watch(expandedCategories, (newVal) => {
  const currentSet = new Set(newVal)
  
  currentSet.forEach(id => {
    if (!previousExpandedCategories.has(id)) {
      loadCategoryImages(id)
    }
  })
  previousExpandedCategories.forEach(id => {
    if (!currentSet.has(id)) {
      scheduleCategoryUnload(id)
    }
  })
  
  previousExpandedCategories.clear()
  currentSet.forEach(id => previousExpandedCategories.add(id))
}, { deep: true })

// 选中的模板如果尚未加载，立即加载
watch(selectedTemplate, (template) => {
  if (template && !template.image && !templateImageIsPending(template.id)) {
    ensureTemplateImage(template)
  }
})

onBeforeUnmount(() => {
  cleanupAllTemplateResources(true)
})

// 路由离开前处理
onBeforeRouteLeave(async () => {
  cleanupAllTemplateResources(true)
  return true
})
</script>

<style scoped src="./DialogPage.css"></style>
