/**
 * Skills 获取与使用指引：推荐的开源 Skill 仓库（下载后放进 Skills 文件夹即可用），以及各入口的交互示例。
 * 星数为收录时的参考值；内置项已随软件附带（MIT 原文 + LICENSE）。
 */

export const RECOMMENDED_SKILLS = [
  { category: 'image', name: 'gpt-image-prompting', repo: 'RBYHNDRDS/gpt-image-prompting-skill', folder: '仓库根目录', license: 'MIT', builtin: true, note: 'gpt-image-2 提示词指南，整理自 OpenAI Cookbook：十条基本功、改图防漂移、文字渲染' },
  { category: 'image', name: 'ai-image-prompts', repo: 'YouMind-OpenLab/ai-image-prompts-skill', folder: '仓库根目录', license: 'MIT', stars: '1.2k', note: '上万条精选提示词库（Nano Banana / gpt-image 等），按场景检索；references 体积较大' },
  { category: 'image', name: 'nano-banana-image', repo: 'Emily2040/nano-banana-image-skill', folder: '仓库根目录', license: 'Apache-2.0', note: 'Nano Banana（Gemini 图像）专用提示词方法' },
  { category: 'image', name: 'cinematic-image-prompt', repo: 'Jimmy-ai-studio/cinematic-image-prompt-skill', folder: '仓库根目录', license: '未声明', note: '电影级出图：先诊断会怎么失败，再针对性加锁' },
  { category: 'video', name: 'seedance-prompt', repo: 'zhouwei713/seedance-prompt', folder: '仓库根目录', license: 'MIT', builtin: true, note: 'Seedance 真实感视频提示词，附镜头美学、氛围词典、去 AI 味清单' },
  { category: 'video', name: 'seedance', repo: 'songguoxs/seedance-prompt-skill', folder: '.claude/skills/seedance', license: '未声明', stars: '2.8k', note: '最流行的 Seedance 2.0 提示词 Skill，覆盖十大能力与 @ 引用写法' },
  { category: 'video', name: 'script-to-shootable-storyboard', repo: 'zyz254009-crypto/script-to-shootable-storyboard', folder: '仓库根目录', license: 'MIT', note: '剧本转可拍分镜：原子镜头、连续性追踪、Seedance 生成任务' },
  { category: 'video', name: 'h3-storyboard', repo: 'phileiny/h3-storyboard-skill', folder: 'skills/h3-storyboard', license: 'MIT', note: 'MiniMax H3 镜头拆解与角色表演' },
  { category: 'script', name: 'short-drama', repo: 'dingmike/short-dramas', folder: 'skills/short-drama', license: 'MIT', builtin: true, note: '微短剧编剧全流程：黄金开篇、付费卡点、爽点矩阵、钩子设计' },
  { category: 'script', name: 'dramake', repo: 'xixihhhh/ai-short-drama-skill', folder: 'skills/dramake', license: 'MIT', note: '文字转 AI 短剧：剧本、分镜、视频提示词、配音剪辑一条龙' },
  { category: 'script', name: 'short-drama-production', repo: 'suihe1/short-drama-production', folder: '仓库根目录或 skills/ 下各子目录', license: 'Apache-2.0', note: '短剧生产总控：小说改编大纲、人物、分镜、导演' },
  { category: 'general', name: 'anthropics/skills', repo: 'anthropics/skills', folder: 'skills/ 下任意子目录', license: '各 Skill 单独声明', stars: '179k', note: 'Anthropic 官方 Skills 示例库，学习 SKILL.md 写法的最佳参考' }
]

export const USAGE_STEPS = [
  { title: '配置文本模型', text: '在本页左侧填写文本模型的地址、密钥和模型名，点“测试连接”。Agent 和剧本创作台都靠它思考。' },
  { title: '获取 Skill', text: '点“安装内置 Skills”得到 3 个现成的；或在“获取更多”里打开 GitHub 仓库，下载 ZIP 解压。' },
  { title: '放进文件夹', text: '把含 SKILL.md 的那个目录（见每项的“放入目录”）整个复制到 Skills 文件夹，例如 skills/seedance/SKILL.md。' },
  { title: '刷新并启用', text: '点“刷新”，在列表中打开开关。Skill 默认不启用，只有你打开的才会被使用。' },
  { title: '去对应入口使用', text: 'AI 生图插件 →「Agent 增强」；AI 视频创作 →「Agent 增强」；剧本创作台 → 项目设定里勾选剧本 Skills。' }
]

// 示例对话展示的是“用户怎么说、Agent 怎么做”，不是成品。
export const USAGE_EXAMPLES = {
  image: {
    tryPrompts: ['帮我画一张雨夜霓虹街头撑伞的火柴人电影海报', '做一张 Transformer 编码器结构的论文配图，16:9', '把这句话变成小红书封面：周末去海边'],
    dialog: [
      { role: 'user', text: '帮我画一张雨夜霓虹街头撑伞的火柴人电影海报' },
      { role: 'skill', text: '已加载 Skill：gpt-image-prompting' },
      { role: 'prompt', text: '用途：电影海报，竖版 2:3。场景：雨夜霓虹街道，湿润地面反射粉紫与青色灯光……主体：黑色单线条火柴人撑透明雨伞，位于画面下三分之一……文字：顶部标题“雨中人”，白色粗体无衬线……No watermark. No extra text.' },
      { role: 'result', text: '（生成的图片显示在这里，可点“保存”）' },
      { role: 'assistant', text: '按 gpt-image-prompting 的“场景→主体→细节→约束”结构写了提示词，标题放进引号保证文字准确。想换风格可以说“改成水彩风”。' }
    ]
  },
  video: {
    tryPrompts: ['一个简笔画小人从左边跑进画面，停下来挥手，镜头缓慢推近', '咖啡馆窗边，女孩翻书时抬头微笑，暖色胶片感，5 秒', '城市天台日落延时，镜头环绕，9:16'],
    dialog: [
      { role: 'user', text: '咖啡馆窗边，女孩翻书时抬头微笑，暖色胶片感' },
      { role: 'skill', text: '已加载 Skill：seedance-prompt' },
      { role: 'prompt', text: '0-2秒：近景，窗边木桌，女孩低头翻书，午后侧逆光勾出发丝轮廓；2-5秒：她抬头望向窗外，嘴角慢慢上扬，镜头缓慢推近至特写……35mm 胶片颗粒，暖色调，浅景深' },
      { role: 'result', text: '（视频任务提交后显示进度，完成后在这里播放，可保存）' },
      { role: 'assistant', text: '用了 seedance-prompt 的时间轴写法，把“微笑”拆成可见动作；镜头只用一个推近，降低变形风险。' }
    ]
  },
  script: {
    dialog: [
      { role: 'user', text: '新建项目 → 选“竖屏短剧”，题材填“重生复仇 + 甜宠”，勾选 short-drama Skill' },
      { role: 'skill', text: '生成时：系统提示词 + 已勾选的剧本 Skill 正文 + 项目设定一起发送' },
      { role: 'assistant', text: '② 故事梗概 → ③ 人物小传 → ④ 世界观 → ⑤ 分集大纲，逐层“AI 生成”，每层都可以手改' },
      { role: 'assistant', text: '⑤ 大纲里点“按大纲创建分集”，到 ⑥ 正文逐集写作；写完自动生成摘要，作为下一集的前情' },
      { role: 'result', text: '某一集可“AI 审稿”“转可拍分镜”，再“发送到视频创作”交给视频 Agent' }
    ]
  }
}
