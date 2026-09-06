/**
 * 统一的错误信息过滤工具，确保将后端返回的英文/编码提示
 * 转换为用户能读懂的中文描述，并处理各种常见的异常关键字。
 */
/**
 * 将生图接口异常转换为中文提示。
 * 处理流程：
 * 1、提取异常文本，无文本时保留原值。
 * 2、依次识别渠道、令牌、额度、连接和模型错误。
 * 3、未匹配的消息原样返回，保留诊断信息。
 */
export const filterGeminiExceptionMessage = (error) => {
  // 1、兼容字符串和带 message 属性的异常对象。
  const message = typeof error === 'string' ? error : error?.message || '';
  if (!message) {
    return error;
  }

  // 2、优先匹配具体原因，防止额度错误被后面的模型规则覆盖。
  if (message.includes('无可用渠道')) {
    return '当前模型上游API不可用，请联系管理员';
  }
  if (message.includes('该令牌状态不可用')) {
    return '当前令牌不可用或已禁用';
  }
  if (message.includes('Token quota exhausted') ||
      message.includes('insufficient_quota') ||
      message.includes('quota failed') ||
      message.includes('quota_exceeded') ||
      message.includes('额度不足') ||
      message.includes('已耗尽')) {
    return '当前令牌额度已耗尽';
  }
  if (message.includes('Connection error')) {
    return '上游API网络连接错误，请检查代理或者切换热备';
  }

  const lower = message.toLowerCase();

  // 3、识别模型关键字，同时排除额度错误。
  if (['gpt', 'deepseek', 'claude', 'gemini', 'kimi', 'o3'].some(keyword => lower.includes(keyword))) {
    // 排除已经被识别为quota错误的情况
    if (!lower.includes('quota') && !lower.includes('额度')) {
      return '当前模型异常';
    }
  }

  // 4、未知错误保留原始文本。
  return message;
};
