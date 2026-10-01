/** 文本模型客户端：兼容 OpenAI Chat Completions 与 Responses 两种协议，支持流式输出与工具调用。 */
import { buildApiUrl } from '../../shared/api-url.js';

const DEFAULT_TIMEOUT_MS = 5 * 60000;

/**
 * 把统一的消息结构转换成各协议请求体。
 * 处理流程：
 * 1、chat 协议：instructions 作为 system 消息，工具使用 {type:function,function:{}} 包装。
 * 2、responses 协议：instructions 独立字段，消息与工具调用结果展开为 input items。
 */
function buildBody({ protocol, model, instructions, messages, tools, temperature, stream }) {
  // 1、Chat Completions。
  if (protocol === 'chat') {
    const chatMessages = [];
    if (instructions) chatMessages.push({ role: 'system', content: instructions });
    for (const message of messages) {
      if (message.role === 'tool') chatMessages.push({ role: 'tool', tool_call_id: message.callId, content: message.content });
      else if (message.toolCalls?.length) {
        chatMessages.push({
          role: 'assistant',
          content: message.content || null,
          tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function', function: { name: call.name, arguments: call.arguments } }))
        });
      } else chatMessages.push({ role: message.role, content: message.content });
    }
    return {
      model,
      messages: chatMessages,
      ...(tools?.length ? { tools: tools.map((tool) => ({ type: 'function', function: tool })) } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(stream ? { stream: true } : {})
    };
  }
  // 2、Responses：无状态调用，每轮都带完整上下文，不依赖网关保存 previous_response_id。
  const input = [];
  for (const message of messages) {
    if (message.role === 'tool') input.push({ type: 'function_call_output', call_id: message.callId, output: message.content });
    else if (message.toolCalls?.length) {
      if (message.content) input.push({ role: 'assistant', content: message.content });
      for (const call of message.toolCalls) input.push({ type: 'function_call', call_id: call.id, name: call.name, arguments: call.arguments });
    } else input.push({ role: message.role, content: message.content });
  }
  return {
    model,
    input,
    ...(instructions ? { instructions } : {}),
    ...(tools?.length ? { tools: tools.map((tool) => ({ type: 'function', ...tool })) } : {}),
    ...(temperature !== undefined ? { temperature } : {}),
    ...(stream ? { stream: true } : {})
  };
}

/**
 * 从非流式响应中提取文本与工具调用。
 * 处理流程：
 * 1、chat：取 choices[0].message 的 content 与 tool_calls。
 * 2、responses：遍历 output，收集 output_text 与 function_call。
 */
function parseResponse(protocol, data) {
  // 1、Chat Completions。
  if (protocol === 'chat') {
    const message = data?.choices?.[0]?.message || {};
    return {
      text: typeof message.content === 'string' ? message.content : '',
      toolCalls: (message.tool_calls || []).map((call) => ({ id: call.id, name: call.function?.name, arguments: call.function?.arguments || '{}' }))
    };
  }
  // 2、Responses。
  let text = typeof data?.output_text === 'string' ? data.output_text : '';
  const toolCalls = [];
  for (const item of data?.output || []) {
    if (item.type === 'function_call') toolCalls.push({ id: item.call_id || item.id, name: item.name, arguments: item.arguments || '{}' });
    if (item.type === 'message' && !data.output_text) {
      for (const part of item.content || []) if (part.type === 'output_text') text += part.text || '';
    }
  }
  return { text, toolCalls };
}

/** 把网关错误整理成可读提示；处理流程：1、兼容 {error:{message}} 与 {message} 两种错误体。 */
async function toLlmError(response) {
  // 1、读取错误体，失败时只报状态码。
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || JSON.stringify(body);
  } catch {
    detail = response.statusText;
  }
  if (response.status === 401) return new Error('文本模型 API 密钥无效');
  return new Error(`文本模型请求失败: HTTP ${response.status} - ${detail}`);
}

/**
 * 解析 SSE 流，逐段回调增量文本。
 * 处理流程：
 * 1、按行切分 data: 事件，遇到 [DONE] 结束。
 * 2、chat 取 choices[0].delta.content，responses 取 response.output_text.delta。
 */
async function readStream(protocol, response, onDelta) {
  // 1、逐块解码并保留未完整的行。
  const reader = response.body.getReader();
  const decoder = new globalThis.TextDecoder();
  let buffer = '';
  let text = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const payload = line.trim().startsWith('data:') ? line.trim().slice(5).trim() : '';
      if (!payload || payload === '[DONE]') continue;
      let event;
      try {
        event = JSON.parse(payload);
      } catch {
        continue;
      }
      // 2、只累计文本增量，其他事件忽略。
      const delta = protocol === 'chat'
        ? event?.choices?.[0]?.delta?.content
        : event?.type === 'response.output_text.delta' ? event.delta : '';
      if (delta) {
        text += delta;
        onDelta?.(delta);
      }
    }
  }
  return text;
}

/**
 * 调用文本模型。
 * 处理流程：
 * 1、校验配置并按协议选择端点和请求体。
 * 2、流式时边读边回调，非流式时解析文本和工具调用。
 * @param {object} config {baseUrl, apiKey, model, protocol: 'chat'|'responses'}
 * @param {object} request {instructions, messages, tools, temperature, stream, onDelta, signal}
 * @returns {Promise<{text: string, toolCalls: Array}>}
 */
export async function callLlm(config, request) {
  // 1、配置校验。
  if (!config?.apiKey) throw new Error('请先在「创作 Skills 设置」中配置文本模型 API 密钥');
  if (!config.model) throw new Error('请先配置文本模型名称');
  const protocol = config.protocol === 'responses' ? 'responses' : 'chat';
  const endpoint = buildApiUrl(config.baseUrl, protocol === 'chat' ? 'v1/chat/completions' : 'v1/responses').href;
  const body = buildBody({ protocol, model: config.model, ...request, stream: Boolean(request.stream) });
  const timeout = globalThis.AbortSignal.timeout(DEFAULT_TIMEOUT_MS);
  const signal = request.signal ? globalThis.AbortSignal.any([request.signal, timeout]) : timeout;
  const response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
  if (!response.ok) throw await toLlmError(response);
  // 2、流式只返回文本；工具调用场景使用非流式。
  if (request.stream) return { text: await readStream(protocol, response, request.onDelta), toolCalls: [] };
  return parseResponse(protocol, await response.json());
}
