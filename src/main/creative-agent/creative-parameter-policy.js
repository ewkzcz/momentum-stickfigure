/** 创作工作台 IPC 参数校验：限制类型、长度和枚举，拒绝多余的危险输入。 */
import { assertRecord, assertText, assertEnum } from '../ipc-parameter-policy.js';

const ID_PATTERN = /^[\w-]{1,64}$/;

/** 校验文本模型配置；处理流程：1、字段均为有限长度字符串，协议限定两种。 */
export function assertLlmConfig(value) {
  // 1、apiKey 等字段允许为空字符串，由业务层给出友好提示。
  assertRecord(value, '文本模型配置');
  for (const key of ['baseUrl', 'apiKey', 'model']) if (value[key] !== undefined) assertText(value[key], 4096, key);
  if (value.protocol !== undefined) assertEnum(value.protocol, ['chat', 'responses'], '文本模型协议');
}

/** 校验请求/运行 ID；处理流程：1、只允许字母数字下划线和连字符。 */
export function assertRequestId(value) {
  // 1、ID 会作为事件路由键使用。
  if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new TypeError('请求ID无效');
}

/** 校验 Skill 启用列表；处理流程：1、最多 50 个，每个是安全目录名。 */
export function assertSkillIds(value) {
  // 1、目录名规则与 skill-store 一致。
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length > 50) throw new TypeError('Skill 列表无效');
  for (const id of value) if (typeof id !== 'string' || !/^[\w一-龥.-]{1,80}$/.test(id)) throw new TypeError('Skill 名称无效');
}

/** 校验对话历史；处理流程：1、最多 40 条，每条角色限定、内容限长。 */
export function assertHistory(value) {
  // 1、历史由渲染进程维护。
  if (!Array.isArray(value) || value.length > 40) throw new TypeError('对话历史无效');
  for (const item of value) {
    assertRecord(item, '对话消息');
    assertEnum(item.role, ['user', 'assistant'], '消息角色');
    assertText(item.content, 64 * 1024, '消息内容');
  }
}

/** 校验剧本项目；处理流程：1、必须是对象，标题限长，ID 可选但必须安全。 */
export function assertScriptProject(value) {
  // 1、正文结构由渲染进程定义，这里只做边界校验，体积由存储层限制。
  assertRecord(value, '剧本项目');
  if (value.id !== undefined && (typeof value.id !== 'string' || !ID_PATTERN.test(value.id))) throw new TypeError('项目ID无效');
  if (value.title !== undefined) assertText(value.title, 200, '项目标题');
}
