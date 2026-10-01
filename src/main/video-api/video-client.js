/** 视频生成客户端：对接 /v1/video/generations 的提交、查询，并把结果下载到本地。 */
import axios from 'axios';
import fs from 'fs';
import path from 'path';
import { buildApiUrl } from '../../shared/api-url.js';

// 文档状态为小写（queued/in_progress/completed/failed），网关实际返回大写（SUBMITTED/IN_PROGRESS/SUCCESS/FAILURE）。
const STATUS_MAP = {
  queued: 'queued', submitted: 'queued', not_start: 'queued', pending: 'queued',
  in_progress: 'running', processing: 'running', running: 'running',
  completed: 'completed', success: 'completed', succeeded: 'completed',
  failed: 'failed', failure: 'failed', error: 'failed', cancelled: 'failed'
};

/** 统一状态名；处理流程：1、转小写后查表，未知状态保留为 unknown。 */
const normalizeStatus = (value) => STATUS_MAP[String(value || '').toLowerCase()] || 'unknown';

/** 解析进度；处理流程：1、兼容 0~100 数字与 "45%" 字符串。 */
const normalizeProgress = (value) => Math.max(0, Math.min(100, Number.parseFloat(String(value ?? 0)) || 0));

/**
 * 组装视频提交请求体。
 * 处理流程：
 * 1、公共字段始终发送，时长同时写 duration 与 seconds 以兼容不同模型。
 * 2、图生视频模型的参考图放入 images，其余模型放入 metadata.reference_images。
 * 3、比例、音频等模型扩展参数统一放入 metadata，空值不发送。
 */
export function buildVideoBody(options) {
  // 1、必填与通用字段。
  const body = { model: options.model, prompt: options.prompt };
  if (options.duration) { body.duration = options.duration; body.seconds = String(options.duration); }
  if (options.resolution) body.resolution = options.resolution;
  // 2、按模型类型放置参考图。
  const metadata = {};
  const refs = Array.isArray(options.referenceImages) ? options.referenceImages.filter(Boolean) : [];
  if (refs.length > 0) {
    if (/image-to-video/i.test(options.model)) body.images = refs;
    else metadata.reference_images = refs;
  }
  // 3、扩展参数。
  if (options.aspectRatio) metadata.aspect_ratio = options.aspectRatio;
  if (typeof options.generateAudio === 'boolean') metadata.generate_audio = options.generateAudio;
  if (Object.keys(metadata).length > 0) body.metadata = metadata;
  return body;
}

/** 把网关错误整理成中文提示；处理流程：1、识别模型无通道、未定价、额度和鉴权，其余带状态码。 */
function toVideoError(error) {
  // 1、网关错误体有 {error:{}} 与 {code,message} 两种形态。
  if (error.response) {
    const body = error.response.data || {};
    const code = String(body.error?.code || body.code || '');
    const msg = String(body.error?.message || body.message || '');
    if (code === 'model_not_found') return new Error(`当前令牌无权使用该视频模型：${msg}`);
    if (code === 'model_price_error') return new Error(`该模型站点尚未定价：${msg}`);
    if (/quota/i.test(code) || /quota/i.test(msg)) return new Error('当前令牌额度已耗尽');
    if (error.response.status === 401) return new Error('API密钥无效');
    return new Error(`请求失败: HTTP ${error.response.status} - ${msg || JSON.stringify(body)}`);
  }
  return new Error(`请求失败: ${error.message}`);
}

/** 提交视频任务；处理流程：1、发送请求体，2、返回任务 ID 与初始状态。 */
export async function submitVideoTask(baseUrl, apiKey, options) {
  // 1、提交到统一视频接口。
  try {
    const { data } = await axios.post(buildApiUrl(baseUrl, 'v1/video/generations').href, buildVideoBody(options), {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      timeout: 60000
    });
    // 2、任务 ID 缺失说明响应格式异常。
    const taskId = data?.task_id || data?.id;
    if (!taskId) throw new Error('视频任务未返回任务ID');
    const status = normalizeStatus(data.status);
    return { taskId, status: status === 'unknown' ? 'queued' : status, progress: normalizeProgress(data.progress) };
  } catch (error) {
    throw error.response || error.request ? toVideoError(error) : error;
  }
}

/** 查询视频任务；处理流程：1、请求任务状态，2、统一状态名并提取视频地址与失败原因。 */
export async function queryVideoTask(baseUrl, apiKey, taskId) {
  // 1、任务 ID 进入路径前编码。
  try {
    const { data } = await axios.get(buildApiUrl(baseUrl, `v1/video/generations/${encodeURIComponent(taskId)}`).href, {
      headers: { Authorization: `Bearer ${apiKey}` },
      timeout: 30000
    });
    // 2、网关会把任务包在 {code, data} 里，先拆包；结果地址在不同模型下位置不同，依次回退。
    const task = data?.data && typeof data.data === 'object' && data.data.task_id ? data.data : data;
    const url = task?.metadata?.url || task?.video_url || task?.result_url || task?.url || task?.result?.url || '';
    return {
      taskId,
      status: normalizeStatus(task?.status),
      progress: normalizeProgress(task?.progress),
      url,
      error: task?.error?.message || task?.fail_reason || ''
    };
  } catch (error) {
    throw error.response || error.request ? toVideoError(error) : error;
  }
}

/**
 * 下载视频到目录。
 * 处理流程：
 * 1、仅允许 http(s) 地址，按响应类型或地址推导扩展名。
 * 2、以任务 ID 命名写盘，已存在时追加序号，不覆盖。
 */
export async function downloadVideo(url, directory, taskId) {
  // 1、限制协议并下载二进制内容。
  if (!/^https?:\/\//i.test(url)) throw new Error('视频地址无效');
  const response = await axios.get(url, { responseType: 'arraybuffer', timeout: 10 * 60000 });
  const mime = String(response.headers['content-type'] || '').split(';')[0];
  const ext = mime === 'video/webm' ? '.webm' : mime === 'video/quicktime' ? '.mov' : '.mp4';
  // 2、文件名只取安全字符，避免路径穿越。
  const base = `video-${String(taskId).replace(/[^\w-]/g, '').slice(0, 40) || Date.now()}`;
  fs.mkdirSync(directory, { recursive: true });
  let target = path.join(directory, `${base}${ext}`);
  for (let index = 2; fs.existsSync(target); index += 1) target = path.join(directory, `${base}-${index}${ext}`);
  fs.writeFileSync(target, Buffer.from(response.data));
  return target;
}
