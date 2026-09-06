/** PSD 会话测试：严格回放原版两份不同素材的编辑、往返、关闭及重新导入。 */
import test from 'node:test'
import { checkPsdSession } from './scenarios/psd-session.mjs'

// 1、缺失参考、环境改变或任意 DOM 与像素差异均失败，不跳过也不现场生成预期。
test('PSD 会话：不同素材编辑十轮往返、互斥恢复及关闭重导入', { timeout: 180000 }, () => checkPsdSession())
