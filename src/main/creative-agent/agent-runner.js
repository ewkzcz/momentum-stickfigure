/**
 * 图片/视频创作小 Agent：读取已启用的 Skills，写出专业提示词并调用生成工具。
 *
 * 采用“渐进加载”：系统提示词里只放已启用 Skills 的名称和描述，
 * 模型需要时调用 load_skill 读取正文，再按需读取 references/ 下的资料。
 */
import { callLlm } from './llm-client.js';
import { buildSkillContext, listSkills, readSkill, readSkillFile } from './skill-store.js';
import { apiWrapper } from '../gemini-image-api/gemini-image-service.js';
import { submitVideoTask, queryVideoTask } from '../video-api/video-client.js';

const MAX_ROUNDS = 8;
const MAX_GENERATIONS_PER_RUN = 2;
const VIDEO_POLL_MS = 5000;
const VIDEO_MAX_WAIT_MS = 20 * 60000;

const SKILL_TOOLS = [
  {
    name: 'load_skill',
    description: '读取一个已启用 Skill 的完整说明。写提示词前先加载与任务相关的 Skill。',
    parameters: { type: 'object', properties: { name: { type: 'string', description: 'Skill 目录名' } }, required: ['name'] }
  },
  {
    name: 'read_skill_reference',
    description: '读取 Skill 附带的参考资料（references/ 或 assets/ 下的文件，load_skill 结果末尾会列出可用文件）。',
    parameters: {
      type: 'object',
      properties: { name: { type: 'string' }, file: { type: 'string', description: '例如 references/xxx.md' } },
      required: ['name', 'file']
    }
  }
];

const IMAGE_TOOL = {
  name: 'generate_image',
  description: '用最终提示词调用图像生成接口。每次运行最多调用 2 次。',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '完整的最终提示词' },
      aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'] }
    },
    required: ['prompt']
  }
};

const VIDEO_TOOL = {
  name: 'generate_video',
  description: '用最终提示词提交视频生成任务并等待完成（通常需要 1~5 分钟）。每次运行最多调用 2 次。',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: '完整的最终视频提示词' },
      duration: { type: 'integer', minimum: 4, maximum: 15 },
      aspect_ratio: { type: 'string', enum: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'] }
    },
    required: ['prompt']
  }
};

/**
 * 组装系统提示词。
 * 处理流程：
 * 1、说明角色、工作步骤和成本约束。
 * 2、附上已启用 Skills 索引和用户默认参数。
 */
function buildInstructions(mode, skillIndex, defaults, allowGenerate) {
  // 1、角色与流程。
  const target = mode === 'image' ? '图片' : '视频';
  const lines = [
    `你是一名专业的 AI ${target}创作助手，运行在桌面创作软件中。用户会用大白话描述想要的${target}。`,
    '工作步骤：',
    '1. 从下方已启用 Skills 中挑选与任务相关的，调用 load_skill 读取（不相关的不要读）。',
    `2. 按 Skill 的方法写出可直接提交的${target}提示词；信息不足时用合理常识补全，不要反复追问。`,
    allowGenerate
      ? `3. 调用 ${mode === 'image' ? 'generate_image' : 'generate_video'} 生成；除非用户要求多个版本，只调用一次。`
      : '3. 当前为“只写提示词”模式，不能调用生成工具；把最终提示词放在以“最终提示词：”开头的段落里。',
    '4. 最后用中文简短说明你用了哪些 Skill、做了哪些关键取舍，以及可以如何继续调整。',
    '',
    '## 已启用的 Skills',
    skillIndex || '（用户未启用任何 Skill，按通用经验完成即可）',
    '',
    '## 用户默认参数',
    JSON.stringify(defaults)
  ];
  // 2、合并成一段。
  return lines.join('\n');
}

/** 安全解析工具参数；处理流程：1、解析 JSON，失败时返回空对象并由工具报错。 */
function parseArgs(text) {
  // 1、模型偶尔输出非法 JSON。
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}

/**
 * 运行一次 Agent。
 * 处理流程：
 * 1、准备工具和系统提示词，进入“模型 → 工具 → 模型”循环。
 * 2、每轮把工具调用与结果写回上下文，直到模型不再调用工具或达到轮数上限。
 * 3、生成类工具受次数上限保护，并通过 emit 推送进度和结果。
 * @param {object} options 运行参数（见 creative-ipc 中的 agent-run）
 * @param {(event: object) => void} emit 事件回调
 * @param {AbortSignal} signal 取消信号
 */
export async function runCreativeAgent(options, emit, signal) {
  // 1、工具与提示词。
  const { mode, llm, skillsRoot, skillIds = [], history = [], imageConfig, videoConfig, allowGenerate } = options;
  const tools = [...SKILL_TOOLS, ...(allowGenerate ? [mode === 'image' ? IMAGE_TOOL : VIDEO_TOOL] : [])];
  const skillIndex = skillsRoot ? buildSkillContext(skillsRoot, skillIds, { mode: 'index' }) : '';
  const defaults = mode === 'image'
    ? { model: imageConfig?.model, aspect_ratio: imageConfig?.aspectRatio, quality: imageConfig?.quality }
    : { model: videoConfig?.model, duration: videoConfig?.duration, resolution: videoConfig?.resolution, aspect_ratio: videoConfig?.aspectRatio };
  const instructions = buildInstructions(mode, skillIndex, defaults, allowGenerate);
  const messages = history.map((item) => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: String(item.content || '') }));
  let generations = 0;

  // 工具实现：返回给模型的是简短文本，大体积结果（图片、视频地址）通过 emit 推给界面。
  const handlers = {
    load_skill: ({ name }) => {
      if (!skillIds.includes(name)) return `Skill ${name} 未启用或不存在`;
      const { body } = readSkill(skillsRoot, name);
      emit({ type: 'skill', name });
      const files = listSkills(skillsRoot).find((skill) => skill.id === name)?.references || [];
      const text = body.length > 16000 ? `${body.slice(0, 16000)}\n…（已截断）` : body;
      return files.length ? `${text}\n\n可用参考资料（用 read_skill_reference 读取）：${files.join('、')}` : text;
    },
    read_skill_reference: ({ name, file }) => {
      if (!skillIds.includes(name)) return `Skill ${name} 未启用或不存在`;
      return readSkillFile(skillsRoot, name, file).slice(0, 16000);
    },
    generate_image: async ({ prompt, aspect_ratio: aspectRatio }) => {
      if (!prompt) return '缺少 prompt';
      emit({ type: 'status', text: '正在生成图片…', prompt });
      const result = await apiWrapper('generate', {
        ...imageConfig,
        prompt,
        aspectRatio: aspectRatio || imageConfig.aspectRatio,
        logPath: imageConfig.logPath,
        savePath: imageConfig.savePath
      });
      if (!result.success) return `生成失败：${result.message}`;
      emit({ type: 'images', prompt, images: result.data });
      return `已生成 ${result.data.length} 张图片并展示给用户。`;
    },
    generate_video: async ({ prompt, duration, aspect_ratio: aspectRatio }) => {
      if (!prompt) return '缺少 prompt';
      const params = { ...videoConfig, prompt, duration: duration || videoConfig.duration, aspectRatio: aspectRatio || videoConfig.aspectRatio };
      const task = await submitVideoTask(videoConfig.baseUrl, videoConfig.apiKey, params);
      emit({ type: 'status', text: `视频任务已提交：${task.taskId}`, prompt, taskId: task.taskId });
      const deadline = Date.now() + VIDEO_MAX_WAIT_MS;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, VIDEO_POLL_MS));
        signal.throwIfAborted();
        const state = await queryVideoTask(videoConfig.baseUrl, videoConfig.apiKey, task.taskId);
        emit({ type: 'progress', taskId: task.taskId, status: state.status, progress: state.progress });
        if (state.status === 'completed') {
          emit({ type: 'video', prompt, taskId: task.taskId, url: state.url });
          return '视频已生成并展示给用户。';
        }
        if (state.status === 'failed') return `视频生成失败：${state.error || '未知原因'}`;
      }
      return `视频仍在生成，任务 ID：${task.taskId}，可稍后在视频页查询。`;
    }
  };

  // 2、主循环。
  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    signal.throwIfAborted();
    emit({ type: 'thinking', round });
    const reply = await callLlm(llm, { instructions, messages, tools, temperature: 0.7, signal });
    if (!reply.toolCalls.length) {
      emit({ type: 'message', text: reply.text });
      return { text: reply.text };
    }
    messages.push({ role: 'assistant', content: reply.text, toolCalls: reply.toolCalls });
    if (reply.text) emit({ type: 'message', text: reply.text, partial: true });
    for (const call of reply.toolCalls) {
      const args = parseArgs(call.arguments);
      emit({ type: 'tool', name: call.name, args });
      let output;
      // 3、生成次数保护：防止模型反复重试烧掉额度。
      if (/^generate_/.test(call.name) && generations >= MAX_GENERATIONS_PER_RUN) output = '本次运行的生成次数已达上限，请总结结果。';
      else if (!handlers[call.name] || !tools.some((tool) => tool.name === call.name)) output = `未知工具：${call.name}`;
      else {
        if (/^generate_/.test(call.name)) generations += 1;
        try {
          output = await handlers[call.name](args);
        } catch (error) {
          if (signal.aborted) throw error;
          output = `工具执行失败：${error.message}`;
        }
      }
      messages.push({ role: 'tool', callId: call.id, content: String(output) });
    }
  }
  const text = '已达到最大推理轮数，请缩小需求后重试。';
  emit({ type: 'message', text });
  return { text };
}
