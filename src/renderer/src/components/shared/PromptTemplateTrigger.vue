<template>
  <div class="prompt-template-trigger">
    <n-popover
      placement="top"
      trigger="hover"
      :show-arrow="true"
    >
      <template #trigger>
        <n-button
          :type="buttonType"
          :size="buttonSize"
          :circle="circle"
          :quaternary="quaternary"
          @click="handleOpenManager"
          :disabled="disabled"
          class="template-trigger-btn"
        >
          <template #icon>
            <n-icon :size="iconSize">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                <path fill="currentColor" d="M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1s-1-.45-1-1s.45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
              </svg>
            </n-icon>
          </template>
          <span v-if="!circle && showText">{{ buttonText }}</span>
        </n-button>
      </template>
      <div style="max-width: 200px;">
        <div style="font-weight: 500; margin-bottom: 4px;">提示词模板库</div>
        <div style="font-size: 12px; opacity: 0.8;">
          管理和使用提示词模板<br/>
          快捷键：{{ shortcutText }}
        </div>
        <div v-if="templateCount > 0" style="margin-top: 8px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.1);">
          <n-tag size="small" :bordered="false" type="info">
            {{ templateCount }} 个模板
          </n-tag>
          <n-tag v-if="favoriteCount > 0" size="small" :bordered="false" type="warning" style="margin-left: 4px;">
            ⭐ {{ favoriteCount }}
          </n-tag>
        </div>
      </div>
    </n-popover>

    <!-- 模板管理器弹窗 -->
    <PromptTemplateManager
      v-model:show="showManager"
      :template-manager="manager"
      @select="handleSelectTemplate"
    />
  </div>
</template>

<script setup>
/** 提示词模板入口：打开管理弹窗、处理选择与快捷键，并同步模板数量。 */
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import PromptTemplateManager from './PromptTemplateManager.vue'
import promptTemplateManager, { videoTemplateManager } from '@renderer/utils/promptTemplateManager'

const props = defineProps({
  buttonType: {
    type: String,
    default: 'default'
  },
  buttonSize: {
    type: String,
    default: 'medium'
  },
  circle: {
    type: Boolean,
    default: false
  },
  quaternary: {
    type: Boolean,
    default: false
  },
  iconSize: {
    type: Number,
    default: 18
  },
  buttonText: {
    type: String,
    default: '模板'
  },
  showText: {
    type: Boolean,
    default: true
  },
  disabled: {
    type: Boolean,
    default: false
  },
  shortcut: {
    type: String,
    default: 'Ctrl+Shift+P'
  },
  enableShortcut: {
    type: Boolean,
    default: true
  },
  templateType: {
    type: String,
    default: 'image',
    validator: (value) => ['image', 'video'].includes(value)
  }
})

const emit = defineEmits(['select', 'open', 'close'])

const showManager = ref(false)
const templateCount = ref(0)
const favoriteCount = ref(0)
const storageKey = computed(() => `prompt-templates-${props.templateType}`)
let stopStorageListener = null

/**
 * 选择当前类型的模板管理器。
 * 处理流程：
 * 1、根据类型选择对应的共享管理器实例。
 */
const manager = computed(() => {
  // 1、同类型入口共享一份内存模板列表。
  return props.templateType === 'video' ? videoTemplateManager : promptTemplateManager
})

/**
 * 生成快捷键提示。
 * 处理流程：
 * 1、禁用快捷键时返回状态文本，否则显示配置的组合键。
 */
const shortcutText = computed(() => {
  // 1、提示文本与快捷键开关保持一致。
  if (!props.enableShortcut) return '禁用'
  return props.shortcut
})

/**
 * 打开模板管理弹窗。
 * 处理流程：
 * 1、显示弹窗并刷新统计，再通知父组件已打开。
 */
const handleOpenManager = async () => {
  // 1、先打开弹窗，不因统计读取延迟阻塞显示。
  showManager.value = true
  await updateCounts()
  emit('open')
}

/**
 * 转发选中的模板内容。
 * 处理流程：
 * 1、通知父组件使用内容，关闭弹窗并发送关闭事件。
 */
const handleSelectTemplate = (content) => {
  // 1、父组件收到内容后自行决定替换或追加提示词。
  emit('select', content)
  showManager.value = false
  emit('close')
}

/**
 * 刷新模板总数与收藏数。
 * 处理流程：
 * 1、向当前管理器查询两项统计，失败时保留原值并记录日志。
 */
const updateCounts = async () => {
  // 1、管理器负责等待模板初始化完成。
  try {
    templateCount.value = await manager.value.getCount()
    favoriteCount.value = await manager.value.getFavoriteCount()
  } catch (error) {
    console.warn('[PromptTemplateTrigger] 更新模板统计失败:', error)
  }
}

/**
 * 根据配置组合键打开模板管理器。
 * 处理流程：
 * 1、禁用状态下忽略按键，并解析配置中的修饰键和主键。
 * 2、严格比较修饰键与主键，匹配时阻止默认行为并打开弹窗。
 */
const handleKeydown = (event) => {
  // 1、将 macOS 的 Command 与 Ctrl 视为同一种修饰键。
  if (!props.enableShortcut || props.disabled) return

  const keys = props.shortcut.toLowerCase().split('+')
  const needsCtrl = keys.includes('ctrl') || keys.includes('control')
  const needsShift = keys.includes('shift')
  const needsAlt = keys.includes('alt')
  const mainKey = keys[keys.length - 1].toLowerCase()

  const ctrlPressed = event.ctrlKey || event.metaKey
  const shiftPressed = event.shiftKey
  const altPressed = event.altKey
  const keyPressed = event.key.toLowerCase()

  // 2、额外按住未配置的修饰键也不会触发。
  if (
    (needsCtrl === ctrlPressed) &&
    (needsShift === shiftPressed) &&
    (needsAlt === altPressed) &&
    (keyPressed === mainKey)
  ) {
    event.preventDefault()
    handleOpenManager()
  }
}

/**
 * 订阅当前类型的模板变化。
 * 处理流程：
 * 1、确认窗口存在，先释放旧订阅。
 * 2、优先监听专用模板服务，否则监听通用存储键并刷新统计。
 */
const subscribeStorageChanges = () => {
  // 1、重新订阅前解除旧监听，避免一次变化重复刷新。
  if (typeof window === 'undefined') {
    return
  }

  if (typeof stopStorageListener === 'function') {
    stopStorageListener()
    stopStorageListener = null
  }

  // 2、专用服务和通用存储只选择一个事件来源。
  if (window.promptTemplates?.onTemplatesChanged) {
    stopStorageListener = window.promptTemplates.onTemplatesChanged((payload) => {
      if (!payload || payload.type === props.templateType) {
        updateCounts()
      }
    })
    return
  }

  if (window.storage?.onStorageChanged) {
    stopStorageListener = window.storage.onStorageChanged((change) => {
      if (change?.key === storageKey.value) {
        updateCounts()
      }
    })
  }
}

watch(() => props.templateType, () => {
  updateCounts()
})

// 挂载时读取统计、注册快捷键和模板变化监听。
onMounted(() => {
  updateCounts()

  if (props.enableShortcut) {
    window.addEventListener('keydown', handleKeydown)
  }

  subscribeStorageChanges()
})

// 卸载时同步解除键盘与存储监听。
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
  if (typeof stopStorageListener === 'function') {
    stopStorageListener()
  }
})

defineExpose({
  openManager: handleOpenManager,
  updateCounts
})
</script>

<style scoped>
.prompt-template-trigger {
  display: inline-block;
}

.template-trigger-btn {
  position: relative;
}

.template-trigger-btn::after {
  content: '';
  position: absolute;
  top: -2px;
  right: -2px;
  width: 8px;
  height: 8px;
  background: #18a058;
  border-radius: 50%;
  opacity: 0;
  transition: opacity 0.2s;
}

.template-trigger-btn:hover::after {
  opacity: 0.8;
}
</style>
