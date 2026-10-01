<template>
  <n-form
    ref="stickfigureFormRef"
    :model="config"
    label-placement="left"
    label-width="140px"
    class="settings-form"
  >
    <!-- 保存根目录 -->
    <n-form-item label="图片保存根目录" path="outputRoot">
      <n-input-group>
        <n-input
          v-model:value="outputRoot"
          placeholder="请选择图片保存的根目录"
          readonly
          :style="{ flex: 1 }"
        />
        <n-button
          type="primary"
          @click="emit('select-output-folder')"
          :loading="isSelectingStickfigureFolder"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          选择文件夹
        </n-button>
        <n-button
          @click="emit('reset-output-folder')"
          title="重置为默认路径（系统图片目录）"
        >
          <template #icon>
            <n-icon>
              <svg viewBox="0 0 24 24">
                <path d="M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z" fill="currentColor"/>
              </svg>
            </n-icon>
          </template>
          重置
        </n-button>
      </n-input-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px;">
          简笔画人物导出图片的保存位置，默认为系统图片目录
        </n-text>
      </template>
    </n-form-item>

    <!-- 导出文件名规则 -->
    <n-form-item label="导出文件名规则" path="fileNamingRule">
      <n-select
        v-model:value="fileNamingRule"
        :options="fileNamingRuleOptions"
        placeholder="请选择文件名规则"
      />
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          控制导出图片的文件名格式，时间戳格式为YYYYMMDDHHmmss（精确到秒）
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 语义信息只包含实际选择的动作和表情，如：20251028142530双手惊恐.png
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #f0a020; line-height: 1.6;">
          ⚠️ <strong>图层结构模式特殊说明：</strong><br/>
          当使用PSD图层结构树控制时，文件名将自动转为纯时间戳或纯Hash格式（不含语义信息），避免命名混乱。<br/>
          • 时间戳+语义 → 仅时间戳：20251028142530.png<br/>
          • Hash+语义 → 仅Hash：a3f9b2k5m7p4q8.png<br/>
          切换回部件控制模式后，自动恢复带语义的命名规则。
        </n-text>
      </template>
    </n-form-item>

    <!-- 同名文件处理方式 -->
    <n-form-item label="同名文件处理" path="duplicateFileHandling">
      <n-radio-group v-model:value="duplicateFileHandling">
        <n-space>
          <n-radio value="addIndex">
            添加序号（默认）
          </n-radio>
          <n-radio value="addTimestamp">
            添加时间戳后缀
          </n-radio>
        </n-space>
      </n-radio-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          遇到同名文件时自动重命名的方式
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 添加序号：文件名_1.png、文件名_2.png<br/>
          💡 添加时间戳：文件名_20251027143052.png
        </n-text>
      </template>
    </n-form-item>

    <!-- 是否对PSD建立文件夹 -->
    <n-form-item label="PSD文件夹组织" path="createPsdFolder" style="margin-top: 12px;">
      <n-radio-group v-model:value="createPsdFolder">
        <n-space>
          <n-radio :value="true">
            是（推荐）
          </n-radio>
          <n-radio :value="false">
            否
          </n-radio>
        </n-space>
      </n-radio-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          导出是否对PSD建立子文件夹
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 推荐选择"是"：将同一个PSD的导出图片在保存路径下按PSD文件名创建文件夹，便于管理和组织
        </n-text>
      </template>
    </n-form-item>

    <!-- 动作表情模糊匹配 -->
    <n-form-item label="动作表情模糊匹配" path="enableFuzzyMatch" style="margin-top: 12px;">
      <n-radio-group v-model:value="enableFuzzyMatch">
        <n-space>
          <n-radio :value="true">
            是（推荐）
          </n-radio>
          <n-radio :value="false">
            否
          </n-radio>
        </n-space>
      </n-radio-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          启用后，表情图组名称支持子串包含匹配
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 例如：设置"表情"时，"表情123"、"新表情"等包含"表情"的图组名也会被匹配上
        </n-text>
      </template>
    </n-form-item>

    <!-- 悬浮预览（主画布）开关 -->
    <n-form-item label="悬浮预览（主画布）" path="enableCanvasHoverPreview" style="margin-top: 12px;">
      <n-radio-group v-model:value="canvasHoverPreviewEnabled">
        <n-space>
          <n-radio :value="true">
            开启
          </n-radio>
          <n-radio :value="false">
            关闭
          </n-radio>
        </n-space>
      </n-radio-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          开启鼠标悬浮预览效果（画布、预设）
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 开启后，鼠标悬停在画布、预设上时会显示预览效果
        </n-text>
      </template>
    </n-form-item>

    <!-- 悬浮预览（部件）开关 -->
    <n-form-item label="悬浮预览（部件）" path="enablePartHoverPreview" style="margin-top: 12px;">
      <n-radio-group v-model:value="partHoverPreviewEnabled">
        <n-space>
          <n-radio :value="true">
            开启
          </n-radio>
          <n-radio :value="false">
            关闭
          </n-radio>
        </n-space>
      </n-radio-group>
      <template #feedback>
        <n-text depth="3" style="font-size: 12px; display: block; margin-top: 6px;">
          开启鼠标悬浮预览效果（部件列表、模板）
        </n-text>
        <n-text depth="3" style="font-size: 12px; margin-top: 8px; display: block; color: #18a058; line-height: 1.6;">
          💡 开启后，鼠标悬停在部件列表和模板上时会显示预览效果
        </n-text>
      </template>
    </n-form-item>

    <!-- 保存按钮 -->
    <div class="save-button-container">
      <n-button
        type="primary"
        size="large"
        @click="emit('save')"
        :loading="isSavingStickfigure"
      >
        保存配置
      </n-button>
    </div>
  </n-form>
</template>

<script setup>
/** 人物基础设置展示：只转发字段更新和操作事件，配置校验与持久化由父页面唯一维护。 */
import { computed } from 'vue'

const props = defineProps({
  config: { type: Object, required: true },
  fileNamingRuleOptions: { type: Array, required: true },
  canvasHoverEnabled: { type: Boolean, required: true },
  partHoverEnabled: { type: Boolean, required: true },
  isSelectingStickfigureFolder: { type: Boolean, default: false },
  isSavingStickfigure: { type: Boolean, default: false }
})
const emit = defineEmits([
  'update-field',
  'update:canvasHoverEnabled',
  'update:partHoverEnabled',
  'select-output-folder',
  'reset-output-folder',
  'save'
])

/** 为原配置字段提供同步读写转接。处理流程：1、读取父对象；2、同步传回字段和值。 */
const fieldModel = (key) => computed({
  // 1、直接派生父页面原字段，不缓存副本。
  get: () => props.config[key],
  // 2、由父页面同步写回原配置对象。
  set: (value) => emit('update-field', key, value)
})
const outputRoot = fieldModel('outputRoot')
const fileNamingRule = fieldModel('fileNamingRule')
const duplicateFileHandling = fieldModel('duplicateFileHandling')
const createPsdFolder = fieldModel('createPsdFolder')
const enableFuzzyMatch = fieldModel('enableFuzzyMatch')
const canvasHoverPreviewEnabled = computed({
  get: () => props.canvasHoverEnabled,
  set: (value) => emit('update:canvasHoverEnabled', value)
})
const partHoverPreviewEnabled = computed({
  get: () => props.partHoverEnabled,
  set: (value) => emit('update:partHoverEnabled', value)
})
// 原 stickfigureFormRef 仅为模板字符串引用，无脚本声明或业务调用；随表单保留。
</script>

<style scoped>
/* 与父页面同值；父 scoped 选择器不能穿透子组件内部的按钮容器。 */
.save-button-container {
  text-align: left;
  margin-top: 24px;
  margin-left: 140px; /* 与表单label-width对齐 */
  padding-bottom: 12px;
}

/* 保留原非 deep 规则及其优先级；父页面 deep 规则仍通过表单根作用。 */
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
