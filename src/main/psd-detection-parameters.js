import { assertRecord, assertText } from './ipc-parameter-policy.js'

/** 直接组件检测采用既有六类关键词，限制比较工作量而不改变分类规则。 */
export function assertDetectionOptions(options) {
  assertRecord(options, 'PSD检测选项')
  if (options.detection === undefined) return
  assertRecord(options.detection, 'PSD检测规则')
  for (const key of ['FRONT_HAND_KEYWORDS', 'BACK_HAND_KEYWORDS', 'EXPRESSION_KEYWORDS', 'BODY_KEYWORDS', 'HAIR_KEYWORDS', 'ACCESSORY_KEYWORDS']) {
    const keywords = options.detection[key]
    if (!Array.isArray(keywords) || keywords.length > 256) throw new TypeError(`${key}参数必须是最多256项的数组`)
    for (const keyword of keywords) assertText(keyword, 256, 'PSD检测关键词')
  }
}
