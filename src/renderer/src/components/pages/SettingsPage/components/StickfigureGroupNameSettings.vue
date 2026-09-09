<template>
  <n-form
    :model="config"
    label-placement="left"
    label-width="140px"
    class="settings-form"
  >
    <n-alert type="info" style="margin-bottom: 20px;">
      <template #header>
        自定义图层名称说明
      </template>
      <n-text>
        配置PSD文件中各类图层组的名称预设，支持自定义多个名称。多个名称用顿号、逗号或换行分隔。
      </n-text>
    </n-alert>

    <n-form-item label="前手图组名称" path="groupNames.frontHand">
      <n-input-group>
        <n-input
          :value="config.groupNames.frontHand"
          @update:value="value => emit('update-group-field', 'frontHand', value)"
          type="textarea"
          :placeholder="defaultGroupNames.frontHand"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'frontHand')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.frontHand }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="后手图组名称" path="groupNames.backHand">
      <n-input-group>
        <n-input
          :value="config.groupNames.backHand"
          @update:value="value => emit('update-group-field', 'backHand', value)"
          type="textarea"
          :placeholder="defaultGroupNames.backHand"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'backHand')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.backHand }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="双手图组名称" path="groupNames.bothHands">
      <n-input-group>
        <n-input
          :value="config.groupNames.bothHands"
          @update:value="value => emit('update-group-field', 'bothHands', value)"
          type="textarea"
          :placeholder="defaultGroupNames.bothHands"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'bothHands')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.bothHands }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="动作图组名称" path="groupNames.action">
      <n-input-group>
        <n-input
          :value="config.groupNames.action"
          @update:value="value => emit('update-group-field', 'action', value)"
          type="textarea"
          :placeholder="defaultGroupNames.action"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'action')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.action }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="表情图组名称" path="groupNames.expression">
      <n-input-group>
        <n-input
          :value="config.groupNames.expression"
          @update:value="value => emit('update-group-field', 'expression', value)"
          type="textarea"
          :placeholder="defaultGroupNames.expression"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'expression')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.expression }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="上身图组名称" path="groupNames.upperBody">
      <n-input-group>
        <n-input
          :value="config.groupNames.upperBody"
          @update:value="value => emit('update-group-field', 'upperBody', value)"
          type="textarea"
          :placeholder="defaultGroupNames.upperBody"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'upperBody')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.upperBody }}
        </n-text>
      </template>
    </n-form-item>

    <n-form-item label="下身图组名称" path="groupNames.lowerBody">
      <n-input-group>
        <n-input
          :value="config.groupNames.lowerBody"
          @update:value="value => emit('update-group-field', 'lowerBody', value)"
          type="textarea"
          :placeholder="defaultGroupNames.lowerBody"
          :autosize="{ minRows: 2, maxRows: 2 }"
          :style="{ flex: 1 }"
        />
        <n-button
          @click="emit('reset-group-name', 'lowerBody')"
          title="重置为默认预设"
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
          默认预设：{{ defaultGroupNames.lowerBody }}
        </n-text>
      </template>
    </n-form-item>

    <slot />
  </n-form>
</template>

<script setup>
/** 自定义图层名称表单：只读父级配置与默认预设，转发输入和重置，保存按钮由父级插槽提供。 */
defineProps({
  config: { type: Object, required: true },
  defaultGroupNames: { type: Object, required: true }
})

const emit = defineEmits(['update-group-field', 'reset-group-name'])
</script>

<style scoped>
/* 根表单继承父级作用域；普通后代表单项规则需在此保留，保存按钮继续使用父级插槽样式。 */
.settings-form .n-form-item {
  margin-bottom: 18px;
}

.settings-form .n-form-item:last-child {
  margin-bottom: 0;
}
</style>
