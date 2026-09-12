<!-- 文件说明：拖拽跟随与三类悬浮预览浮层；拖拽 DOM 引用回写父页，悬浮态只读展示。 -->
<template>
  <!-- 拖拽预览（传送到body，避免父级transform影响） -->
  <teleport to="body">
    <div
      v-if="isDragging"
      class="drag-follow-preview"
      :ref="node => emit('preview-ref', node)"
      :style="{
        left: Math.max(0, dragMouseX - dragCalibration.dx) + 'px',
        top: Math.max(0, dragMouseY - dragCalibration.dy) + 'px'
      }"
    >
      <canvas
        :ref="node => emit('canvas-ref', node)"
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
</template>

<script setup>
/** 预览浮层：节点挂载或卸载时直接回传父级唯一 ref，不引入后置同步监听。 */

defineProps({
  isDragging: { type: Boolean, required: true },
  dragMouseX: { type: Number, required: true },
  dragMouseY: { type: Number, required: true },
  dragCalibration: { type: Object, required: true },
  hoverPreview: { type: Object, required: true },
  presetHoverPreview: { type: Object, required: true },
  templateHoverPreview: { type: Object, required: true }
})

const emit = defineEmits(['preview-ref', 'canvas-ref'])
</script>

<style scoped>
/* teleport 到 body 的节点仍带本组件 scopeId，规则保留原选择器语义。 */
.image-hover-preview,
.preset-hover-preview,
.template-hover-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 16px 40px rgba(0,0,0,0.45);
  backdrop-filter: blur(2px);
  background: rgba(0,0,0,0.7);
}

.image-hover-preview {
  border: 2px solid rgba(79, 158, 255, 0.5);
}

.preset-hover-preview {
  border: 2px solid rgba(24, 160, 88, 0.5);
}

.template-hover-preview {
  border: 2px solid rgba(124, 58, 237, 0.5);
  padding: 8px;
  background: var(--theme-background-card);
  color: var(--theme-foreground);
  max-width: min(400px, 35vw);
  max-height: min(500px, 60vh);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.template-hover-preview img {
  max-width: min(380px, 33vw) !important;
  max-height: min(480px, 58vh) !important;
  width: auto !important;
  height: auto !important;
  object-fit: contain !important;
}

.image-hover-preview img,
.preset-hover-preview img,
.template-hover-preview img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  image-rendering: auto;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}

.drag-follow-preview {
  position: fixed;
  z-index: 9999;
  pointer-events: none;

  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;

  border-radius: 16px;
  transform: translateZ(0);
  transition: none;
}

.drag-follow-preview canvas {
  pointer-events: none;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}

.drag-follow-preview.near-boundary {
  border-color: rgba(255, 193, 7, 0.6);
  box-shadow:
    0 12px 40px rgba(255, 193, 7, 0.4),
    0 6px 20px rgba(255, 87, 34, 0.3);
  animation: dragFloatWarning 0.8s ease-in-out infinite alternate;
}

@keyframes dragFloatWarning {
  0% {
    transform: scale(0.95) translateY(0px);
    filter: brightness(1.2);
  }
  100% {
    transform: scale(1.0) translateY(-5px);
    filter: brightness(1.4);
  }
}
</style>
