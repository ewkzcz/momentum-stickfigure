/** PSD 预览传输回归：在真实独立窗口中检验 PNG 二进制兼容性。 */
import test from 'node:test'
import { checkPreviewPayload } from './scenarios/preview-payload.mjs'

test('PSD 独立预览：小 PNG、带偏移视图及旧数据地址保持一致', { timeout: 120000 }, () => checkPreviewPayload())
