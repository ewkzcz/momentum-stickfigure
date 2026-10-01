/** PSD 悬浮预览测试组：从原版独立参考验证主画布、预设图片及真实开关和鼠标行为。 */
import test from 'node:test'
import { checkCanvasPresetHover } from './scenarios/canvas-preset-hover.mjs'

// 1、缺素材、缺完整参考、环境变化或任意像素差异均返回失败，不现场生成预期。
test('PSD 主画布及预设悬浮：开关、移动、离开和 PNG 像素保持一致', { timeout: 180000 }, () => checkCanvasPresetHover())
