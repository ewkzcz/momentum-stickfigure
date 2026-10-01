/**
 * 剧本创作台提示词模板。
 *
 * 生成采用层级式流程（参考 DeepMind Dramatron）：项目设定 → 梗概 → 人物 → 世界观/场景 → 分集大纲 → 逐集正文。
 * 每一层都以前面所有层为约束；逐集写作时带上前文摘要（参考 AI_NovelGenerator 的滚动摘要），保证长篇连贯。
 */

export const PROJECT_TYPES = [
  { label: '竖屏短剧', value: 'short-drama', unit: '集' },
  { label: '电视剧', value: 'series', unit: '集' },
  { label: '电影', value: 'film', unit: '场' },
  { label: '动画/漫剧', value: 'animation', unit: '集' },
  { label: '小说', value: 'novel', unit: '章' }
]

const COMMON_RULES = `通用要求：
- 严格服从“项目设定”和已确定的上游内容（梗概、人物、世界观、大纲），不得与之矛盾；发现矛盾时先指出再给方案。
- 只输出本次任务要求的内容，不写开场白、不解释你在做什么、不加总结。
- 用简体中文写作，人物对白口语化，符合人物身份。`

export const DEFAULT_SYSTEM_PROMPTS = {
  'short-drama': `你是一名资深竖屏微短剧编剧，熟悉抖音/快手/红果短剧的爆款规律。
你的作品特点：开篇 10 秒进冲突，每集都有爽点或反转，集尾必留钩子，台词短、狠、有记忆点。
单集时长 1~3 分钟，按场次书写，场景标题格式“场次. 地点 内/外景 日/夜”。
${COMMON_RULES}`,
  series: `你是一名经验丰富的电视剧编剧，擅长多线叙事、人物弧光和单集起承转合。
每集有独立的小故事和推进主线的大事件，A/B 线交织，集尾留悬念。
剧本按标准格式书写：场景标题、动作描述、人物对白。
${COMMON_RULES}`,
  film: `你是一名电影编剧，熟悉三幕结构、救猫咪节拍表和视觉化叙事。
注重画面感与潜台词，用动作和细节代替解释，每场戏都要改变人物处境。
剧本按标准格式书写：场景标题、动作描述、人物对白。
${COMMON_RULES}`,
  animation: `你是一名动画/漫剧编剧，擅长强视觉表现、鲜明的角色设定和节奏明快的叙事。
动作描述要便于分镜和绘制，角色外观特征保持一致，适当使用夸张表演和画面奇观。
${COMMON_RULES}`,
  novel: `你是一名网络小说作家，擅长长篇连载的节奏控制、伏笔埋设和人物塑造。
每章有明确的小目标和冲突，章末留钩子；描写具体可感，避免套话和总结式语句。
${COMMON_RULES}`
}

export const STAGES = [
  {
    key: 'logline',
    label: '故事梗概',
    placeholder: '一句话梗概 + 300~800 字故事梗概',
    task: () => `请写出：
1. 剧名（3 个备选，每个附一句说明，最后标出推荐项）
2. 一句话梗概（主角、目标、阻碍、代价）
3. 故事梗概（300~800 字，交代开端、发展、高潮和结局）
4. 核心看点（3~5 条）`
  },
  {
    key: 'characters',
    label: '人物小传',
    placeholder: '主要人物的姓名、身份、外貌、性格、欲望、弱点和人物关系',
    task: () => `请为主要人物写人物小传（主角、对手、关键配角，共 4~8 人）。每人包含：
姓名、年龄、身份、外貌特征（便于后续绘图保持一致）、性格、核心欲望、致命弱点、人物弧光、与其他人物的关系。
最后用一段文字说明人物关系网和主要矛盾。`
  },
  {
    key: 'world',
    label: '世界观与场景',
    placeholder: '时代背景、社会规则、主要场景地点的可视化描述',
    task: () => `请写出：
1. 时代与世界背景、社会规则（如有特殊设定写清规则和限制）
2. 主要场景地点（5~10 个），每个写一段可视化描述：空间结构、陈设、光线、氛围，便于后续分镜和绘图`
  },
  {
    key: 'outline',
    label: '分集大纲',
    placeholder: '每集/每章一行：第N集：标题 —— 本集事件与集尾钩子',
    task: (project) => `请按 ${project.episodeCount || 10}${unitOf(project)} 写分${unitOf(project)}大纲。
每${unitOf(project)}单独一行，严格使用格式：第N${unitOf(project)}：标题 —— 本${unitOf(project)}核心事件、冲突与结尾钩子（60~120 字）。
整体遵循起承转合，标出关键转折点${project.type === 'short-drama' ? '和付费卡点' : ''}。`
  }
]

/** 单位文字；处理流程：1、按项目类型返回集/场/章。 */
export function unitOf(project) {
  // 1、未知类型默认“集”。
  return PROJECT_TYPES.find((item) => item.value === project.type)?.unit || '集'
}

/** 新建项目；处理流程：1、按类型填入默认系统提示词和空白阶段。 */
export function createEmptyProject(type = 'short-drama') {
  // 1、ID 由主进程保存时生成。
  return {
    title: '未命名剧本',
    type,
    genre: '',
    audience: '',
    tone: '',
    episodeCount: type === 'short-drama' ? 30 : 10,
    wordsPerEpisode: type === 'novel' ? 3000 : 1500,
    systemPrompt: DEFAULT_SYSTEM_PROMPTS[type],
    requirements: '',
    skillIds: [],
    stages: { logline: '', characters: '', world: '', outline: '' },
    episodes: []
  }
}

/**
 * 组装上下文。
 * 处理流程：
 * 1、写入项目设定。
 * 2、按层级顺序附上已完成的阶段，upto 之后的阶段不放入（避免下游反向约束上游）。
 */
export function buildContext(project, upto = 'episodes') {
  // 1、项目设定。
  const lines = [
    '# 项目设定',
    `- 作品类型：${PROJECT_TYPES.find((item) => item.value === project.type)?.label || project.type}`,
    project.title ? `- 暂定名：${project.title}` : '',
    project.genre ? `- 题材：${project.genre}` : '',
    project.audience ? `- 目标受众：${project.audience}` : '',
    project.tone ? `- 基调：${project.tone}` : '',
    `- 规模：${project.episodeCount}${unitOf(project)}，每${unitOf(project)}约 ${project.wordsPerEpisode} 字`,
    project.requirements ? `\n## 作者补充要求\n${project.requirements}` : ''
  ].filter(Boolean)
  // 2、上游阶段。
  for (const stage of STAGES) {
    if (stage.key === upto) break
    const text = project.stages?.[stage.key]?.trim()
    if (text) lines.push(`\n# ${stage.label}\n${text}`)
  }
  return lines.join('\n')
}

/** 阶段生成提示；处理流程：1、上下文 + 任务说明 + 用户附加指令。 */
export function buildStagePrompt(project, stageKey, instruction = '') {
  // 1、附加指令放在最后，优先级最高。
  const stage = STAGES.find((item) => item.key === stageKey)
  return `${buildContext(project, stageKey)}\n\n# 本次任务：${stage.label}\n${stage.task(project)}${instruction ? `\n\n# 额外要求\n${instruction}` : ''}`
}

/** 取大纲中某集的那一行；处理流程：1、按“第N集/章/场”匹配。 */
export function outlineLineOf(project, index) {
  // 1、大纲格式由生成任务约束，用户手改后也尽量匹配。
  const pattern = new RegExp(`^\\s*第\\s*${index + 1}\\s*[集章场幕][:：]?(.*)$`)
  return (project.stages?.outline || '').split('\n').find((line) => pattern.test(line))?.trim() || ''
}

/** 从大纲创建分集；处理流程：1、解析“第N集：标题 —— …”，2、保留已有正文。 */
export function episodesFromOutline(project) {
  // 1、逐行解析。
  const parsed = []
  for (const line of (project.stages?.outline || '').split('\n')) {
    const match = /^\s*第\s*(\d+)\s*[集章场幕][:：]\s*(.+?)(?:\s*[—-]{1,2}\s*(.*))?$/.exec(line)
    if (match) parsed[Number(match[1]) - 1] = { title: match[2].trim(), brief: (match[3] || '').trim() }
  }
  // 2、合并到现有分集，正文不丢。
  return parsed.filter(Boolean).map((item, index) => ({
    content: '', summary: '', review: '', storyboard: '',
    ...(project.episodes?.[index] || {}),
    title: item.title,
    brief: item.brief
  }))
}

/**
 * 逐集正文提示。
 * 处理流程：
 * 1、带上全部设定、本集大纲和前情摘要（最近 5 集摘要 + 上一集结尾片段）。
 * 2、写明字数和格式要求。
 */
export function buildEpisodePrompt(project, index, instruction = '') {
  // 1、前情。
  const unit = unitOf(project)
  const episodes = project.episodes || []
  const recaps = episodes.slice(Math.max(0, index - 5), index)
    .map((item, offset) => item.summary ? `第${index - Math.min(5, index) + offset + 1}${unit}摘要：${item.summary}` : '')
    .filter(Boolean)
  const previousTail = index > 0 ? (episodes[index - 1]?.content || '').slice(-600) : ''
  const episode = episodes[index] || {}
  // 2、任务。
  return [
    buildContext(project, 'episodes'),
    recaps.length ? `\n# 前情摘要\n${recaps.join('\n')}` : '',
    previousTail ? `\n# 上一${unit}结尾（衔接用）\n${previousTail}` : '',
    `\n# 本次任务：写第${index + 1}${unit}正文`,
    `本${unit}大纲：${outlineLineOf(project, index) || `${episode.title || ''} ${episode.brief || ''}`}`,
    project.type === 'novel'
      ? `要求：约 ${project.wordsPerEpisode} 字的小说正文，开头不要复述前情，结尾留钩子。`
      : `要求：约 ${project.wordsPerEpisode} 字的剧本，按场次书写（场景标题、动作描述、人物对白），结尾留钩子。`,
    instruction ? `\n# 额外要求\n${instruction}` : ''
  ].filter(Boolean).join('\n')
}

/** 摘要提示；处理流程：1、要求 200 字内摘要和状态变化，供后续集使用。 */
export function buildSummaryPrompt(project, index) {
  // 1、摘要只基于本集正文。
  const unit = unitOf(project)
  return `以下是第${index + 1}${unit}正文。请输出不超过 200 字的剧情摘要，并用一行“状态变化：”记录人物关系、所知信息、位置或物品的变化，以及新埋下或回收的伏笔。\n\n${project.episodes[index]?.content || ''}`
}

/** 审稿提示；处理流程：1、对照设定做一致性、节奏和台词检查，输出问题清单与修改建议。 */
export function buildReviewPrompt(project, index) {
  // 1、审稿不改写正文，只提意见。
  const unit = unitOf(project)
  return `${buildContext(project, 'episodes')}\n\n# 待审：第${index + 1}${unit}\n${project.episodes[index]?.content || ''}\n\n# 本次任务：审稿
请以资深责任编辑的身份检查：
1. 与人物小传、世界观、大纲是否矛盾（列出具体位置）
2. 节奏：开头是否抓人、冲突是否升级、结尾钩子是否有力
3. 台词：是否符合人物身份，有无说明性台词和 AI 套话
4. 给出 3~5 条最重要的修改建议，按优先级排序
只输出审稿意见，不要改写全文。`
}

/** 分镜提示；处理流程：1、把本集转成原子镜头表，每镜附视频提示词。 */
export function buildStoryboardPrompt(project, index) {
  // 1、人物外貌来自人物小传，保证镜头间一致。
  const unit = unitOf(project)
  return `# 人物小传（外貌需在每个镜头提示词中保持一致）\n${project.stages?.characters || '（无）'}\n\n# 场景\n${project.stages?.world || '（无）'}\n\n# 第${index + 1}${unit}正文\n${project.episodes[index]?.content || ''}\n\n# 本次任务：转可拍分镜
忠实转换，不新增剧情。输出 Markdown 表格：| 镜号 | 时长(秒) | 景别 | 运镜 | 画面内容 | 台词/声音 | 视频提示词 |
每个镜头只有一个主导景别和一个主要动作；视频提示词独立完整（人物外貌 + 动作 + 场景光线 + 镜头运动 + 风格），单镜不超过 15 秒。`
}

/** 导出 Markdown；处理流程：1、设定与各阶段，2、逐集正文。 */
export function buildMarkdownExport(project) {
  // 1、头部与阶段。
  const unit = unitOf(project)
  const parts = [`# ${project.title}`, buildContext({ ...project, stages: {} }, 'episodes').replace('# 项目设定', '## 项目设定')]
  for (const stage of STAGES) if (project.stages?.[stage.key]?.trim()) parts.push(`## ${stage.label}\n\n${project.stages[stage.key].trim()}`)
  // 2、正文。
  ;(project.episodes || []).forEach((episode, index) => {
    if (episode.content?.trim()) parts.push(`## 第${index + 1}${unit} ${episode.title || ''}\n\n${episode.content.trim()}`)
  })
  return parts.join('\n\n')
}
