/** 视频生成 IPC：提交、查询任务，并把完成的视频下载到已授权的输出目录。 */
import { ipcMain } from 'electron';
import path from 'path';
import { isTrustedIpcSender } from '../ipc-sender-policy.js';
import { assertVideoOptions } from '../ipc-parameter-policy.js';
import { prepareOutput } from '../gemini-image-api/gemini-image-ipc.js';
import { submitVideoTask, queryVideoTask, downloadVideo } from './video-client.js';

const CHANNELS = ['video-submit', 'video-query', 'video-download'];

/**
 * 注册处理器的统一外壳。
 * 处理流程：
 * 1、校验发送方与参数，执行业务函数。
 * 2、成功返回 {success,data}，异常统一转成 {success:false,message}。
 */
function handle(channel, work) {
  // 1、所有通道共用同一套信任与参数校验。
  ipcMain.handle(channel, async (event, options) => {
    try {
      if (!isTrustedIpcSender(event)) throw new Error('未授权的视频服务操作来源');
      assertVideoOptions(options);
      if (!options.apiKey) throw new Error('请先在设置中配置API密钥');
      return { success: true, data: await work(event, options) };
    } catch (error) {
      // 2、错误不带堆栈，避免泄露内部路径。
      return { success: false, message: error.message };
    }
  });
}

/** 注册视频 IPC；处理流程：1、提交，2、查询，3、下载到授权目录。 */
export function registerVideoApiHandlers() {
  // 1、提交任务前必须有提示词和模型。
  handle('video-submit', async (_event, options) => {
    if (!options.prompt?.trim()) throw new Error('未提供有效的提示词');
    if (!options.model) throw new Error('缺少视频模型');
    return submitVideoTask(options.baseUrl, options.apiKey, options);
  });
  // 2、查询只需要任务 ID。
  handle('video-query', async (_event, options) => {
    if (!options.taskId) throw new Error('缺少任务ID');
    return queryVideoTask(options.baseUrl, options.apiKey, options.taskId);
  });
  // 3、输出目录沿用生图设置的授权流程，不能写到未确认目录。
  handle('video-download', async (event, options) => {
    if (!options.url || !options.taskId) throw new Error('缺少视频地址或任务ID');
    const config = await prepareOutput(event, { ...options, editOutputDir: options.outputDir });
    const file = await downloadVideo(options.url, path.join(config.outputDir, 'videos'), options.taskId);
    return { path: file };
  });
}

/** 注销视频 IPC；处理流程：1、逐通道移除处理器。 */
export function unregisterVideoApiHandlers() {
  // 1、与注册通道一一对应。
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}
