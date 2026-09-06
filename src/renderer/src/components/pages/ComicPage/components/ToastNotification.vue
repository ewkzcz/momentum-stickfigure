<template>
  <div class="toast" :class="type">
    {{ message }}
  </div>
</template>

<script>
/**
 * 提示通知组件
 * 
 * 显示操作结果的提示信息
 */

export default {
  name: 'ToastNotification',
  props: {
    type: {
      type: String,
      default: 'success',
      validator: (value) => ['success', 'error', 'warning'].includes(value)
    },
    message: {
      type: String,
      required: true
    }
  },
  emits: ['close']
}
</script>

<style scoped>
.toast {
  position: fixed;
  top: 20px;
  right: 20px;
  padding: 12px 24px;
  border-radius: 6px;
  color: white;
  font-weight: 500;
  z-index: 1000;
  min-width: 200px;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  transition: all 0.3s ease;
}

.toast.success {
  background-color: #10b981;
}

.toast.error {
  background-color: #ef4444;
}

.toast.warning {
  background-color: #f59e0b;
}
</style>
