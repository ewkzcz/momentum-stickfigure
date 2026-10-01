/**
 * 创作工作台 IPC：Skills 管理、文本模型生成（流式）、图片/视频小 Agent、剧本项目存储。
 *
 * 目录授权沿用 configured-output-policy：
 *   skills-root      Skills 文件夹（读取 + 安装内置 Skills）
 *   script-projects  剧本项目文件夹（读写项目、导出）
 *   gemini-output    AI 生图输出目录（Agent 生成图片与保存）
 */
import { ipcMain } from 'electron';
import axios from 'axios';
import fs from 'node:fs';
import path from 'node:path';
import { isTrustedIpcSender } from '../ipc-sender-policy.js';
import { authorizeConfiguredOutput } from '../configured-output-policy.js';
import { assertRecord, assertText, assertEnum, assertGeminiOptions, assertVideoOptions } from '../ipc-parameter-policy.js';
import { prepareOutput } from '../gemini-image-api/gemini-image-ipc.js';
import { assertLlmConfig, assertRequestId, assertSkillIds, assertHistory, assertScriptProject } from './creative-parameter-policy.js';
import { callLlm } from './llm-client.js';
import { listSkills, readSkill, readSkillFile, installBuiltinSkills, buildSkillContext } from './skill-store.js';
import { runCreativeAgent } from './agent-runner.js';
import { listProjects, loadProject, saveProject, deleteProject, exportMarkdown } from './script-store.js';
import { buildApiUrl } from '../../shared/api-url.js';

const CHANNELS = [
  'creative-skills-list', 'creative-skills-install', 'creative-skill-read',
  'creative-llm-test', 'creative-llm-generate', 'creative-agent-run', 'creative-cancel',
  'creative-script-list', 'creative-script-load', 'creative-script-save', 'creative-script-delete', 'creative-script-export',
  'creative-save-image',
  'creative-list-models'
];
const running = new Map();

/**
 * 注册处理器的统一外壳。
 * 处理流程：
 * 1、校验发送方与参数对象，执行业务。
 * 2、统一返回 {success,data} 或 {success:false,message}。
 */
function handle(channel, work) {
  // 1、所有通道只接受主窗口。
  ipcMain.handle(channel, async (event, options = {}) => {
    try {
      if (!isTrustedIpcSender(event)) throw new Error('未授权的创作工作台操作来源');
      assertRecord(options, '请求');
      return { success: true, data: await work(event, options) };
    } catch (error) {
      // 2、取消不视为错误提示。
      return { success: false, message: error.name === 'AbortError' ? '已取消' : error.message, canceled: error.name === 'AbortError' };
    }
  });
}

/** 授权目录并返回根路径；处理流程：1、按用途确认目录，路径为空时使用默认目录。 */
async function authorizedRoot(event, purpose, requested) {
  // 1、未授权的非默认目录会弹出系统对话框请用户确认。
  if (requested !== undefined) assertText(requested, 32768, '目录');
  return (await authorizeConfiguredOutput(event, purpose, requested || undefined)).root;
}

/** 向发送窗口推送事件；处理流程：1、窗口已销毁时静默忽略。 */
function sendTo(event, channel, payload) {
  // 1、生成过程中用户可能关闭窗口。
  if (!event.sender.isDestroyed()) event.sender.send(channel, payload);
}

/** 登记可取消任务；处理流程：1、创建控制器，2、结束后自动移除。 */
async function withCancel(id, work) {
  // 1、同一 ID 重复提交时先取消旧任务。
  running.get(id)?.abort();
  const controller = new globalThis.AbortController();
  running.set(id, controller);
  try {
    return await work(controller.signal);
  } finally {
    // 2、只移除自己登记的控制器。
    if (running.get(id) === controller) running.delete(id);
  }
}

/** 注册创作工作台 IPC；处理流程：1、Skills，2、文本模型，3、Agent，4、剧本项目，5、图片保存。 */
export function registerCreativeHandlers() {
  // 1、Skills 管理。
  handle('creative-skills-list', async (event, { skillsRoot }) => {
    const root = await authorizedRoot(event, 'skills-root', skillsRoot);
    return { root, skills: listSkills(root) };
  });
  handle('creative-skills-install', async (event, { skillsRoot }) => installBuiltinSkills(await authorizedRoot(event, 'skills-root', skillsRoot)));
  handle('creative-skill-read', async (event, { skillsRoot, id, file }) => {
    assertText(id, 80, 'Skill 名称');
    const root = await authorizedRoot(event, 'skills-root', skillsRoot);
    if (file !== undefined) {
      assertText(file, 256, '文件');
      return { content: readSkillFile(root, id, file) };
    }
    const { meta, body } = readSkill(root, id);
    return { meta, content: body };
  });

  // 2、文本模型：连通性测试与流式生成。
  handle('creative-llm-test', async (_event, { llm }) => {
    assertLlmConfig(llm);
    const reply = await callLlm(llm, { messages: [{ role: 'user', content: '请只回复“连接成功”。' }], temperature: 0 });
    return { text: reply.text.slice(0, 200) };
  });
  handle('creative-llm-generate', async (event, options) => {
    const { requestId, llm, instructions = '', prompt, skillsRoot, skillIds } = options;
    assertRequestId(requestId);
    assertLlmConfig(llm);
    assertText(instructions, 256 * 1024, '系统提示词');
    assertText(prompt, 512 * 1024, '生成内容');
    assertSkillIds(skillIds);
    // 启用的剧本 Skills 直接拼入系统提示词（剧本生成需要完整方法论，不走按需加载）。
    const skillText = skillIds?.length ? buildSkillContext(await authorizedRoot(event, 'skills-root', skillsRoot), skillIds) : '';
    const fullInstructions = skillText ? `${instructions}\n\n## 已启用的创作 Skills\n${skillText}` : instructions;
    return withCancel(requestId, async (signal) => {
      const reply = await callLlm(llm, {
        instructions: fullInstructions,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.8,
        stream: options.stream !== false,
        onDelta: (delta) => sendTo(event, 'creative-llm-delta', { requestId, delta }),
        signal
      });
      return { text: reply.text };
    });
  });

  // 3、图片/视频小 Agent。
  handle('creative-agent-run', async (event, options) => {
    const { runId, mode, llm, skillsRoot, skillIds, history, imageConfig, videoConfig, allowGenerate } = options;
    assertRequestId(runId);
    assertEnum(mode, ['image', 'video'], 'Agent 模式');
    assertLlmConfig(llm);
    assertSkillIds(skillIds);
    assertHistory(history);
    if (typeof allowGenerate !== 'boolean') throw new TypeError('allowGenerate参数必须是布尔值');
    const root = skillIds?.length ? await authorizedRoot(event, 'skills-root', skillsRoot) : '';
    let image = imageConfig;
    if (mode === 'image' && allowGenerate) {
      // 图片生成需要日志目录授权，与 AI 生图插件一致。
      assertGeminiOptions(imageConfig);
      const output = await prepareOutput(event, imageConfig);
      image = { ...imageConfig, logPath: output.logFile, savePath: output.outputDir };
    }
    if (mode === 'video') assertVideoOptions(videoConfig || {});
    return withCancel(runId, (signal) => runCreativeAgent(
      { mode, llm, skillsRoot: root, skillIds, history, imageConfig: image, videoConfig, allowGenerate },
      (payload) => sendTo(event, 'creative-agent-event', { runId, ...payload }),
      signal
    ));
  });
  handle('creative-cancel', async (_event, { id }) => {
    assertRequestId(id);
    running.get(id)?.abort();
    return { canceled: running.has(id) };
  });

  // 4、剧本项目。
  handle('creative-script-list', async (event, { projectsRoot }) => {
    const root = await authorizedRoot(event, 'script-projects', projectsRoot);
    return { root, projects: listProjects(root) };
  });
  handle('creative-script-load', async (event, { projectsRoot, id }) => {
    assertText(id, 64, '项目ID');
    return loadProject(await authorizedRoot(event, 'script-projects', projectsRoot), id);
  });
  handle('creative-script-save', async (event, { projectsRoot, project }) => {
    assertScriptProject(project);
    return saveProject(await authorizedRoot(event, 'script-projects', projectsRoot), project);
  });
  handle('creative-script-delete', async (event, { projectsRoot, id }) => {
    assertText(id, 64, '项目ID');
    deleteProject(await authorizedRoot(event, 'script-projects', projectsRoot), id);
    return {};
  });
  handle('creative-script-export', async (event, { projectsRoot, title, markdown }) => {
    assertText(title, 200, '标题');
    assertText(markdown, 8 * 1024 * 1024, '导出内容');
    return { path: exportMarkdown(await authorizedRoot(event, 'script-projects', projectsRoot), title, markdown) };
  });

  // 5、保存 Agent 生成的图片到 AI 生图输出目录的 agent 子目录。
  handle('creative-save-image', async (event, { dataUrl, imageConfig }) => {
    assertText(dataUrl, 64 * 1024 * 1024, '图片数据');
    assertGeminiOptions(imageConfig);
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) throw new Error('图片数据格式无效');
    const output = await prepareOutput(event, imageConfig);
    const dir = path.join(output.outputDir, 'agent');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `agent-${Date.now()}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`);
    fs.writeFileSync(file, Buffer.from(match[2], 'base64'));
    return { path: file };
  });

  registerModelListHandler();
}

/**
 * 注册模型列表通道。
 * 处理流程：
 * 1、用用户填写的地址和密钥请求 /v1/models，只返回模型 ID 与接口类型。
 */
function registerModelListHandler() {
  // 1、模型列表。
  handle('creative-list-models', async (_event, { baseUrl, apiKey }) => {
    assertText(baseUrl, 4096, '接口地址');
    assertText(apiKey, 4096, 'API 密钥');
    if (!apiKey) throw new Error('请先填写 API 密钥');
    try {
      const { data } = await axios.get(buildApiUrl(baseUrl, 'v1/models').href, { headers: { Authorization: `Bearer ${apiKey}` }, timeout: 30000 });
      return (Array.isArray(data?.data) ? data.data : []).map((item) => ({ id: String(item.id), types: item.supported_endpoint_types || [] }));
    } catch (error) {
      const body = error.response?.data;
      throw new Error(error.response ? `获取模型失败：HTTP ${error.response.status} ${body?.error?.message || body?.message || ''}` : `获取模型失败：${error.message}`);
    }
  });
}

/** 注销创作工作台 IPC；处理流程：1、取消进行中的任务，2、移除处理器。 */
export function unregisterCreativeHandlers() {
  // 1、退出时中止网络请求。
  for (const controller of running.values()) controller.abort();
  running.clear();
  // 2、逐通道移除。
  for (const channel of CHANNELS) ipcMain.removeHandler(channel);
}
