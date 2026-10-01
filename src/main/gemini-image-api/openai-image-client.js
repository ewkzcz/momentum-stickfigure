/** OpenAI 协议图像客户端：对接 /v1/images/generations 与 /v1/images/edits（含异步任务接口，gpt-image-2 系列等）。 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { Blob } from 'node:buffer';
import { buildApiUrl } from '../../shared/api-url.js';
import { buildOpenAiSize, MAX_IMAGE_COUNT } from '../../shared/image-models.js';

const MIME_BY_EXT = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

/** 追加日志文件；处理流程：1、确保目录存在后写入带时间戳的单行文本，失败时不影响主流程。 */
function appendLog(logPath, level, message) {
  // 1、日志失败不能让生图失败。
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${new Date().toISOString()} - ${level} - ${String(message).replace(/\s+/g, ' ')}\n`, 'utf8');
  } catch {
    /* 忽略日志写入异常 */
  }
}

/**
 * 整理公共请求参数。
 * 处理流程：
 * 1、优先使用显式 size，否则由宽高比和清晰度档位换算，原始尺寸不传。
 * 2、质量缺省为 auto，数量限制在 1~MAX_IMAGE_COUNT。
 */
function buildCommonFields(model, options) {
  // 1、尺寸不合法时交给网关默认值，避免本地猜测。
  const explicitSize = typeof options.size === 'string' && /^\d{2,5}x\d{2,5}$/.test(options.size) ? options.size : undefined;
  const size = explicitSize || buildOpenAiSize(options.aspectRatio, options.imageTier);
  // 2、数量取整并限幅。
  const count = Math.min(MAX_IMAGE_COUNT, Math.max(1, Math.floor(Number(options.numImages) || 1)));
  return { model, quality: options.quality || 'auto', ...(size ? { size } : {}), count };
}

/** 将接口错误转换成用户可读信息；处理流程：1、识别额度、密钥、限流和模型不可用，其余带上状态码与响应。 */
function toFriendlyError(error) {
  // 1、有响应体时按错误码分类。
  if (error.response) {
    const body = error.response.data;
    const code = String(body?.error?.code || '');
    const msg = String(body?.error?.message || '');
    if (/quota/i.test(code) || /quota/i.test(msg)) return new Error('当前令牌额度已耗尽');
    if (/invalid_api_key/i.test(code) || /invalid api key/i.test(msg)) return new Error('API密钥无效');
    if (/rate_limit/i.test(code)) return new Error('请求频率超限');
    if (/model_not_found/i.test(code)) return new Error(`当前令牌无权使用该模型：${msg}`);
    const detail = typeof body === 'object' ? JSON.stringify(body) : String(body || error.response.statusText || '');
    return new Error(`请求失败: HTTP ${error.response.status} - ${detail}`);
  }
  if (error.request) return new Error(`请求失败: 网络请求未获得响应 - ${error.message}`);
  return new Error(`请求失败: ${error.message}`);
}

const POLL_INTERVAL_MS = 3000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 提交异步任务并轮询到完成。
 * 处理流程：
 * 1、提交成功后取 task_id，按固定间隔查询任务状态。
 * 2、completed 返回结果，failed 抛出失败原因，超时则报错。
 * 3、提交接口 404/405 视为网关不支持异步，返回 null 让调用方回退同步接口。
 */
async function runAsyncTask(baseUrl, apiKey, submitPath, body, headers, timeout) {
  // 1、提交任务。
  let task;
  try {
    task = (await axios.post(buildApiUrl(baseUrl, submitPath).href, body, { headers: { Authorization: `Bearer ${apiKey}`, ...headers }, timeout })).data;
  } catch (error) {
    if ([404, 405].includes(error.response?.status)) return null;
    throw error;
  }
  const taskId = task?.task_id || task?.id;
  if (!taskId) throw new Error('异步任务未返回任务ID');
  // 2、轮询直到终态或超时。
  const deadline = Date.now() + timeout;
  const queryUrl = buildApiUrl(baseUrl, `v1/images/tasks/${encodeURIComponent(taskId)}`).href;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const { data } = await axios.get(queryUrl, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 });
    if (data?.status === 'completed') return { data: data.data || data.result?.data || [] };
    if (data?.status === 'failed') throw new Error(`图片任务失败: ${data.fail_reason || '未知原因'}`);
  }
  throw new Error('图片任务等待超时');
}

/**
 * 把响应中的 data 数组还原为 dataURL 列表。
 * 处理流程：
 * 1、b64_json 直接封装为 PNG dataURL。
 * 2、仅有 url 时下载后封装，缺失数据则抛出统一错误。
 */
async function extractImages(result, timeoutMs) {
  // 1、兼容 b64_json 与直链两种返回。
  const items = Array.isArray(result?.data) ? result.data : [];
  const images = [];
  for (const item of items) {
    if (item?.b64_json) {
      images.push(`data:image/png;base64,${item.b64_json}`);
    } else if (typeof item?.url === 'string' && /^https?:\/\//i.test(item.url)) {
      // 2、直链需要下载并保留真实类型。
      const download = await axios.get(item.url, { responseType: 'arraybuffer', timeout: timeoutMs });
      const mime = String(download.headers['content-type'] || 'image/png').split(';')[0];
      images.push(`data:${mime};base64,${Buffer.from(download.data).toString('base64')}`);
    }
  }
  if (images.length === 0) throw new Error('响应中未找到任何图片数据');
  return images;
}

/**
 * 文生图。
 * 处理流程：
 * 1、网关不保证 n>1，因此按数量并发发起独立请求，成功的结果合并。
 * 2、全部失败时抛出第一个错误。
 */
export async function generateImageOpenAI(prompt, apiKey, baseUrl, model, logPath, options = {}) {
  // 1、构造端点和请求体。
  const { count, ...fields } = buildCommonFields(model, options);
  const endpoint = buildApiUrl(baseUrl, 'v1/images/generations').href;
  const timeout = Math.max(1, Number(options.timeoutMinutes) || 5) * 60000;
  appendLog(logPath, 'INFO', `OpenAI 协议生成: model=${model} size=${fields.size || 'auto'} quality=${fields.quality} n=${count}`);
  const ratio = options.aspectRatio ? { aspect_ratio: String(options.aspectRatio) } : {};
  const requestOne = async () => {
    try {
      // 异步接口要求带 size，缺少 size（原始尺寸）时直接走同步接口。
      const asyncResult = fields.size && options.useAsync !== false
        ? await runAsyncTask(baseUrl, apiKey, 'v1/images/generations/async', { ...fields, ...ratio, prompt, n: 1, response_format: 'url' }, { 'Content-Type': 'application/json' }, timeout)
        : null;
      if (asyncResult) return await extractImages(asyncResult, timeout);
      const response = await axios.post(endpoint, { ...fields, ...ratio, prompt }, {
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout
      });
      return await extractImages(response.data, timeout);
    } catch (error) {
      throw error.response || error.request ? toFriendlyError(error) : error;
    }
  };
  // 2、并发请求并聚合。
  const settled = await Promise.allSettled(Array.from({ length: count }, requestOne));
  const images = settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));
  if (images.length === 0) {
    const reason = settled.find((item) => item.status === 'rejected')?.reason || new Error('未生成图片');
    appendLog(logPath, 'ERROR', reason.message);
    throw reason;
  }
  return images;
}

/**
 * 图生图/编辑，multipart 多图输入。
 * 处理流程：
 * 1、读取输入图片并按扩展名确定 MIME，作为 image[] 字段提交。
 * 2、按数量并发请求并聚合结果。
 */
export async function editImageOpenAI(prompt, inputPaths, apiKey, baseUrl, model, logPath, options = {}) {
  // 1、先读入文件，避免并发请求重复读盘。
  const { count, ...fields } = buildCommonFields(model, options);
  const endpoint = buildApiUrl(baseUrl, 'v1/images/edits').href;
  const timeout = Math.max(1, Number(options.timeoutMinutes) || 5) * 60000;
  const files = inputPaths.map((filePath) => ({
    name: path.basename(filePath),
    type: MIME_BY_EXT[path.extname(filePath).toLowerCase()] || 'image/png',
    data: fs.readFileSync(filePath)
  }));
  appendLog(logPath, 'INFO', `OpenAI 协议编辑: model=${model} images=${files.length} size=${fields.size || 'auto'} n=${count}`);
  const buildForm = (asyncMode) => {
    const form = new globalThis.FormData();
    form.append('prompt', prompt);
    form.append('model', fields.model);
    form.append('quality', fields.quality);
    if (fields.size) form.append('size', fields.size);
    if (options.aspectRatio) form.append('aspect_ratio', String(options.aspectRatio));
    form.append('n', '1');
    if (asyncMode) form.append('response_format', 'url');
    for (const file of files) form.append('image[]', new Blob([file.data], { type: file.type }), file.name);
    return form;
  };
  const requestOne = async () => {
    try {
      const asyncResult = fields.size && options.useAsync !== false
        ? await runAsyncTask(baseUrl, apiKey, 'v1/images/edits/async', buildForm(true), {}, timeout)
        : null;
      if (asyncResult) return await extractImages(asyncResult, timeout);
      const response = await axios.post(endpoint, buildForm(false), { headers: { Authorization: `Bearer ${apiKey}` }, timeout });
      return await extractImages(response.data, timeout);
    } catch (error) {
      throw error.response || error.request ? toFriendlyError(error) : error;
    }
  };
  // 2、聚合并发结果。
  const settled = await Promise.allSettled(Array.from({ length: count }, requestOne));
  const images = settled.flatMap((item) => (item.status === 'fulfilled' ? item.value : []));
  if (images.length === 0) {
    const reason = settled.find((item) => item.status === 'rejected')?.reason || new Error('未生成图片');
    appendLog(logPath, 'ERROR', reason.message);
    throw reason;
  }
  return images;
}
