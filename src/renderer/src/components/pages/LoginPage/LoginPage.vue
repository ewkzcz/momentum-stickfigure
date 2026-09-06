<template>
  <div class="login-page">
    <!-- 欢迎容器 -->
    <div class="login-container">
      <!-- 左侧信息面板 -->
      <div class="login-info">
        <div class="info-content">
          <div class="logo-section">
            <div class="logo">
              <svg width="80" height="80" viewBox="0 0 80 80" fill="none">
                <circle cx="40" cy="40" r="35" fill="#3b82f6" opacity="0.2"/>
                <path d="M40 20 L25 50 L40 45 L55 50 Z" fill="white"/>
              </svg>
            </div>
            <h1 class="system-title">时刻简笔画</h1>
            <p class="system-subtitle">Momentum Stick Figure</p>
          </div>

          <div class="features">
            <div class="feature-item">
              <span class="icon">✓</span>
              <span>nano-banana纳米香蕉生图</span>
            </div>
            <div class="feature-item">
              <span class="icon">✓</span>
              <span>简笔画人物调整插件</span>
            </div>
            <div class="feature-item">
              <span class="icon">✓</span>
              <span>多视角排版制作</span>
            </div>
            <div class="feature-item">
              <span class="icon">✓</span>
              <span>快速拖拽到剪映</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧欢迎表单 -->
      <div class="login-form-section">
        <div class="form-container">
          <div class="form-header">
            <h2 class="form-title">欢迎回来</h2>
            <p class="form-subtitle">时刻简笔画免登录版本</p>
          </div>

          <form class="login-form" @submit.prevent="enterWorkspace">
            <div class="form-item">
              <label class="form-label" for="welcome-account">用户名</label>
              <input id="welcome-account" class="form-input" type="text" placeholder="免登录" readonly autocomplete="off" />
            </div>
            <div class="form-item">
              <label class="form-label" for="welcome-password">密码</label>
              <input id="welcome-password" class="form-input" type="text" placeholder="免登录" readonly autocomplete="off" />
            </div>
            <button type="submit" class="login-button">欢迎回来👏</button>
          </form>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
/** 欢迎页：保留原有表单外观，点击欢迎按钮直接进入工作区。 */
import { useRouter } from 'vue-router'

const router = useRouter()

/**
 * 进入工作区。
 * 处理流程：1、替换当前路由为首页，避免返回欢迎页。
 * 表单只保留旧版外观，不读取输入、不保存账号、不发起网络请求。
 */
const enterWorkspace = () => router.replace('/home')
</script>

<style scoped src="./LoginPage.css"></style>
