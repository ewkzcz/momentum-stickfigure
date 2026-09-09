<template>
      <!-- 应用与配置 -->
      <div v-show="activeTab === 'about'" class="settings-tab-content">
        <div class="settings-content">
          <h2>时刻简笔画免登录版本</h2>
          <n-text depth="3">版本 {{ appVersion }}</n-text>
            <!-- 设置导入导出 -->
            <n-card title="设置导入导出" class="settings-transfer" style="margin-top: 16px;">
              <div class="settings-actions">
                <n-button
                  type="primary"
                  @click="$emit('export-settings')"
                  :loading="isExportingSettings"
                >
                  <template #icon>
                    <n-icon>
                      <svg viewBox="0 0 24 24">
                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,19L8,15H10.5V12H13.5V15H16L12,19Z" fill="currentColor"/>
                      </svg>
                    </n-icon>
                  </template>
                  导出设置
                </n-button>
                <n-button
                  type="success"
                  @click="$emit('import-settings')"
                  :loading="isImportingSettings"
                >
                  <template #icon>
                    <n-icon>
                      <svg viewBox="0 0 24 24">
                        <path d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20M12,12L16,16H13.5V19H10.5V16H8L12,12Z" fill="currentColor"/>
                      </svg>
                    </n-icon>
                  </template>
                  导入设置
                </n-button>
              </div>
            </n-card>
          </div>
      </div>
      <!-- 教程与帮助 -->
      <div v-show="activeTab === 'tutorial'" class="settings-tab-content">
          <div class="settings-content">
            <!-- 软件教程 -->
            <n-card title="📚 软件教程" class="help-section compact-card">
              <n-space vertical style="width: 100%; gap: 16px;">
                <n-space align="center" style="justify-content: flex-start;">
                  <span style="min-width: 140px;">感谢大佬 @崔雪莉 （麒麟）协助创作：</span>
                  <n-button
                    type="success"
                    size="small"
                    tag="a"
                    href="https://gxpdma05aj9.feishu.cn/wiki/F3H9w8ypZiXULQkV50rcEPcXn5d"
                    target="_blank"
                  >
                    📖 时刻简笔画教程
                  </n-button>
                </n-space>
                <!-- <div style="border-top: 1px solid #e0e0e6; margin: 4px 0;"></div> -->
                <div style="font-size: 13px; color: #666; padding-left: 4px;">
                  💝 真诚感谢大佬 <span style="color: #18a058; font-weight: 600;">@崔雪莉（麒麟）</span> 的热心帮助和分享！！！
                </div>
              </n-space>
            </n-card>

            <!-- BUG反馈提示 -->
            <n-card title="🛠️ 问题反馈" class="help-section" style="margin-top: 16px;">
              <n-alert type="info">
                <template #header>
                  反馈问题
                </template>
                使用中遇到问题，可通过 QQ 官方群反馈，请提供：
                <ol style="margin: 8px 0 0 20px; padding: 0;">
                  <li style="margin: 4px 0;">操作系统和软件版本</li>
                  <li style="margin: 4px 0;">具体操作步骤、预期结果和实际现象</li>
                  <li style="margin: 4px 0;">已遮盖 API 密钥等个人信息的截图或错误日志</li>
                </ol>
              </n-alert>
            </n-card>

            <!-- 分组读取问题 -->
            <n-card title="🔧 分组读取问题解决" class="help-section" style="margin-top: 16px;">
              <n-alert type="info" style="margin-bottom: 12px;">
                <template #header>
                  常见问题解决方案
                </template>
                如果遇到部分动作、表情分组读取不到的问题，请尝试以下操作：
                <ol style="margin: 8px 0 0 20px; padding: 0;">
                  <li style="margin: 4px 0;">前往"人物插件设置"标签页</li>
                  <li style="margin: 4px 0;">找到对应的分组配置（前手、后手、表情等）</li>
                  <li style="margin: 4px 0;">尝试点击"🔄重置"按钮恢复默认预设</li>
                  <li style="margin: 4px 0;">或手动修改预设，添加您PSD中的图层组名称</li>
                  <li style="margin: 4px 0;">如问题仍未解决，请加入 QQ 官方群咨询。</li>
                </ol>
              </n-alert>
              <n-button
                type="primary"
                size="small"
                @click="$router.push('/settings/stickfigure')"
                style="margin-top: 8px;"
              >
                前往人物插件设置
              </n-button>
            </n-card>
          </div>
      </div>

      <!-- QQ交流群 -->
      <div v-show="activeTab === 'qq-group'" class="settings-tab-content">
          <div class="settings-content">
            <!-- QQ官方群 -->
            <n-card title="💬 时刻简笔画官方群" class="help-section">
              <div style="display: flex; gap: 24px; padding: 20px 0;">
                <div style="flex-shrink: 0;">
                  <div style="border: 3px solid #18a058; border-radius: 12px; padding: 16px; background: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
                    <img
                      src="../../../../assets/images/qq-link.png"
                      alt="QQ群二维码"
                      style="width: 240px; height: 240px; display: block;"
                    />
                  </div>
                </div>
                <div style="flex: 1; display: flex; flex-direction: column; gap: 16px;">
                  <div>
                    <div style="font-size: 20px; font-weight: 600; color: #18a058; margin-bottom: 8px;">
                      QQ群号：902990261
                    </div>
                    <n-text depth="3" style="font-size: 14px;">
                      扫描左侧二维码或搜索群号加入交流群
                    </n-text>
                  </div>

                  <n-alert type="success">
                    <template #header>
                      欢迎加入交流群
                    </template>
                    <n-space vertical size="small">
                      <n-text>
                        💬 软件咨询与解答
                      </n-text>
                      <n-text>
                        🛠️ BUG反馈
                      </n-text>
                      <n-text>
                        📢 项目动态
                      </n-text>
                      <n-text>
                        🎨 创作经验交流与分享
                      </n-text>
                    </n-space>
                  </n-alert>
                </div>
              </div>
            </n-card>
          </div>
      </div>
</template>

<script setup>
/** 设置帮助内容：按路由展示应用信息、教程与交流群，配置操作交给父页面。 */
defineProps({
  activeTab: { type: String, required: true },
  appVersion: { type: [String, Number], required: true },
  isExportingSettings: Boolean,
  isImportingSettings: Boolean
})
defineEmits(['export-settings', 'import-settings'])
</script>

<style scoped>
/* 多根组件不继承父级作用域，原容器和内容样式在此保持同值。 */
.settings-tab-content {
  height: 100%;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.settings-content {
  height: 100%;
  padding: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.settings-content > .n-card {
  margin-top: 8px;
}

.settings-content::-webkit-scrollbar {
  width: 6px;
}

.settings-content::-webkit-scrollbar-track {
  background: var(--theme-background-secondary);
  border-radius: 3px;
}

.settings-content::-webkit-scrollbar-thumb {
  background: var(--theme-border);
  border-radius: 3px;
  transition: background 0.3s ease;
}

.settings-content::-webkit-scrollbar-thumb:hover {
  background: var(--theme-primary);
}

.settings-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.compact-card :deep(.n-card__content) {
  padding: 12px 16px !important;
}
</style>
