# 时刻简笔画创作工具

时刻简笔画工具是一款面向简笔画创作者的应用，提供从素材调整、多视角排版、剧本创作到 AI 生图和 AI 视频的一站式创作流程。

点击 **欢迎回来👏** 按钮即可进入主界面。支持离线免登录使用，核心代码已开源，可自由进行二次开发和定制。

如果这个项目对你有帮助，欢迎点个 Star ⭐ 支持一下！

![](./assets/%E9%A6%96%E9%A1%B5.png)



## 一、功能

### 1、功能一览

| 工具 | 用途 |
| --- | --- |
| 人物调整 | 导入 PSD，切换图层、动作和表情，管理部件与预设，导出图片 |
| 多视角排版 | 布局多个画面、调整图片与图层、导出作品 |
| 人物对话、幻想框 | 编辑文字、气泡和装饰框，生成透明背景图片 |
| AI 绘图 | “直接生成”与“Agent 增强”两种方式，支持 Gemini 和 gpt-image-2 系列模型，参数共用，带生成记录管理 |
| 剧本创作台 | 按“设定 → 梗概 → 人物 → 世界观 → 大纲 → 逐集正文 → 分镜”分步创作短剧、电影、动画或小说 |
| 视频创作台 | “直接生成”与“Agent 增强”两种方式，支持 Seedance 等视频模型，带生成记录管理 |
| 图像处理 | 图片编辑、抠图与高清放大 |
| 字幕提取 | 使用本地 PaddleOCR 提取视频字幕，可选 AI 纠错 |
| 设置 | 配置导出目录、快捷键、主题、AI 生图、AI 视频、文本模型和 Skills，导入导出配置 |
| 教程与交流 | 查看官方教程、使用帮助和 QQ 官方群二维码 |



### 2、AI 绘图

在「AI → AI绘图」中选择“直接生成”或“Agent 增强”。

![AI 绘图：直接生成](./assets/screenshots/image-generate.png)

Agent 增强模式：用日常语言描述需求，Agent 结合已启用的图片类 Skills 写出完整提示词，再调用生图接口。

![AI 绘图：Agent 增强](./assets/screenshots/image-agent-run.png)

生成结果展示：

<img src="./assets/screenshots/drama-heroine.jpg" alt="Agent 增强生成的短剧女主概念图" width="800" />



### 3、视频创作台

在「AI → 视频创作台」中填写提示词，选择模型、分辨率、比例、时长和是否生成音频后提交。任务完成后在右侧播放，可保存到输出目录。生成记录的管理方式与 AI 绘图相同。

![视频创作台：直接生成](./assets/screenshots/video-generate.png)

“Agent 增强”使用视频类 Skills 写提示词并提交任务，剧本创作台的分镜可以一键发送到这里。

![视频创作台：Agent 增强](./assets/screenshots/video-agent.png)



### 4、剧本创作台

在「AI → 剧本创作台」新建项目并选择作品类型（竖屏短剧、电视剧、电影、动画/漫剧、小说）。

1、项目设定：填写题材、受众、基调、集数，以及完整的提示词（发给 AI 的固定角色与规则说明，每种类型都有默认模板），并勾选要使用的剧本 Skills。

![剧本创作台：项目设定](./assets/screenshots/script-settings.png)

2、逐层生成：依次生成故事梗概、人物小传、世界观与场景、分集大纲。每一层都可以修改，修改后的内容会约束后面各层的生成。

![剧本创作台：分集大纲](./assets/screenshots/script-outline.png)

3、逐集写作：在大纲页点击“按大纲创建分集”，再到“正文”中逐集写作。写完可自动生成本集摘要，作为下一集的前情；也可以让 AI 审稿。

![剧本创作台：逐集正文](./assets/screenshots/script-episode.png)

4、分镜：把正文转成可拍分镜表，再发送到视频创作台或 AI 绘图的 Agent 增强。

![剧本创作台：分镜](./assets/screenshots/script-storyboard.png)

项目自动保存到所选文件夹，可导出为 Markdown。



### 5、简笔画人物PSD调整

上传 PSD 后，在下方按分组切换动作、表情和部件，上方画布实时预览，可保存为预设或拖出导出图片。拖动中间的分隔条调整上下区域比例，在画布上滚动鼠标滚轮缩放人物。

![人物调整](./assets/screenshots/action-expression.png)

#### 通用控制

![通用控制面板](./assets/screenshots/psd-common-controls.png)

鼠标移到按钮上会显示功能提示。如果遇到标签不显示，点一下「重置」按钮。

![悬浮功能提示](./assets/screenshots/psd-tooltip.png)



#### 图层结构

提供完整的 PSD 图层结构调整功能，并提供多组快捷控制。

![图层结构](./assets/screenshots/psd-layer-tree.png)



#### 画布缩放 / 区域调整

区域调整演示：

![区域调整](./assets/screenshots/psd-region-adjust.png)

画布缩放演示：

![画布缩放](./assets/screenshots/psd-canvas-zoom.png)



### 6、人物对话与幻想框

#### 人物对话

作用：智能排版对话。在文本框里每行写一句话，生成对应数量的透明背景对话框图片。

![文本内容](./assets/screenshots/dialog-preview.png)

![预览结果](./assets/screenshots/dialog-result.png)

![设置面板](./assets/screenshots/dialog-settings.png)

支持上传并保存自定义对话框图片、水平/垂直镜像，以及更合理的排版。

![上传自定义模板](./assets/screenshots/dialog-upload-template.png)



#### 幻想框

> **注意：对话框图片内部必须是白色填充的，否则无法删除为透明像素。**

效果展示：

![幻想框效果](./assets/screenshots/frame-effect.png)

![嵌入方式](./assets/screenshots/frame-embed-mode.png)

对话框图片支持任意比例缩放宽高，**人物图片只支持等比缩放**。控制技巧：优先使用滚轮缩放图片。

![缩放控制](./assets/screenshots/frame-scale.png)



### 7、字幕提取

上传一个视频，帮你提取字幕。主要用途是高精度提取想要参考学习的爆款视频的字幕。

市面上的字幕提取工具基本都基于语音识别，对于同音字和专有名词处理效果一般（如「他」与「她」、「云溪」与「云熙」等）。本插件直接识别画面上的字幕文字，一般情况下效果会好于语音识别，当然也无法保证 100% 正确。

![字幕提取界面](./assets/screenshots/subtitle-ocr.png)

这是插件识别的结果，人名与原视频保持一致，错误率较低：

![插件识别结果](./assets/screenshots/subtitle-ocr-result.png)

如果是语音识别的，人名和专有名词过多时，修改起来比较麻烦：

![与语音识别对比](./assets/screenshots/subtitle-asr-compare.png)

AI 纠错时，违规文案会丢失一些句子：

![AI 纠错丢句](./assets/screenshots/subtitle-ai-loss.png)



### 8、创作相关设置

AI视频设置：在「设置 → AI视频设置」中填写中转站地址和 API 密钥，点击“获取模型列表”查询可用的视频模型，并设置默认分辨率、比例、时长和音频。

![AI视频设置](./assets/screenshots/video-settings.png)

文本模型设置：在「设置 → 文本模型设置」中填写文本模型的地址、密钥、模型名和接口协议，点击“测试连接”。剧本创作台和两处 Agent 增强都使用这个模型。

![文本模型设置](./assets/screenshots/llm-settings.png)

Skills设置：Skill 是一份写给 AI 的方法说明（一个包含 `SKILL.md` 的文件夹），启用后 AI 会按其中的方法写提示词或剧本。

在「设置 → Skills设置」中选择 Skills 文件夹，点击“安装内置 Skills”，或在“获取更多 Skills”中打开推荐的 GitHub 仓库，把含 `SKILL.md` 的目录复制进文件夹后点击“刷新”，再逐个打开开关启用。

![Skills设置](./assets/screenshots/skills-settings.png)

![获取更多 Skills](./assets/screenshots/skills-discover.png)

各处填写 API 密钥的输入框下方都有“对接中转站”按钮，可打开中转站注册页。本软件仅提供接口对接能力，服务由第三方提供。



## 二、本地运行与打包

### 1、本地运行

环境要求：Node.js ≥ 20.19（推荐 22 LTS 或 24 LTS），npm 随 Node.js 一并安装。进入项目目录后执行：

```sh
npm ci
npm run dev
```

执行后将自动打开 Electron 桌面窗口。

部分功能依赖桌面环境提供的文件与窗口接口，请直接在桌面窗口中使用，而非浏览器中打开。

运行生产构建：

```sh
npm run build
npm start
```



### 2、打包

```sh
# 当前平台的应用目录
npm run build:unpack

# 在对应操作系统中生成安装包
npm run build:win
npm run build:mac
```

macOS 默认生成未签名、未公证的应用。如需分发使用，请自行完成签名与公证流程。



## 三、可选服务与环境

### 1、AI 服务

AI 功能需要自行配置中转站（转发 AI 请求的接口服务）。各功能的配置位置：

| 功能 | 配置位置 |
| --- | --- |
| AI 绘图 | 设置 → AI生图设置 |
| 视频创作台 | 设置 → AI视频设置（未填写时沿用 AI生图设置的地址和密钥） |
| 剧本创作台、Agent 增强 | 设置 → 文本模型设置 |
| 字幕 AI 纠错 | 字幕提取页面 |

地址默认留空，支持 HTTP、HTTPS、自定义端口和路径前缀。模型可用性与费用由所选服务提供方决定。

各处填写 API 密钥的输入框下方都有“对接中转站”按钮，可打开中转站注册页。本软件仅提供接口对接能力，服务由第三方提供。

中转站需要兼容以下接口：

| 功能 | 请求路径 |
| --- | --- |
| Gemini 生图与编辑 | `/v1beta/models/{model}:generateContent` |
| gpt-image 生图与编辑 | `/v1/images/generations`、`/v1/images/edits`；服务支持时使用 `/async` 异步提交并通过 `/v1/images/tasks/{task_id}` 查询 |
| 视频生成 | `/v1/video/generations`、`/v1/video/generations/{task_id}` |
| 文本模型 | `/v1/chat/completions` 或 `/v1/responses`，在文本模型设置中选择 |
| 模型列表 | `/v1/models`（AI视频设置中的“获取模型列表”） |
| 字幕 AI 纠错 | `/v1/chat/completions` |

填写服务基础地址即可，例如 `https://gateway.example.com`。若地址中已包含 `/v1` 或 `/v1beta`，程序不会重复拼接版本路径。自定义地址仅替换服务端地址，接口协议不变，请确保所选服务兼容上表所列接口。

AI 请求会向所使用的服务发送提示词、用户选中的图片或字幕、剧本内容以及已启用 Skill 的正文。仅使用人物、排版和对话框工具无需这些服务。



### 2、Skills

Skills 文件夹中每个子目录是一个 Skill，必须包含 `SKILL.md`（开头写 `name`、`description`），可附带 `references/`、`assets/` 参考资料。格式兼容 Claude、Codex 等工具使用的 Agent Skills。分类按名称和描述自动识别，也可以在 `SKILL.md` 开头写 `category: image`、`video` 或 `script` 指定。

内置 Skills 原文收录自以下开源项目，安装时附带各自的 LICENSE：

| Skill | 来源 | 许可证 |
| --- | --- | --- |
| gpt-image-prompting（图片） | [RBYHNDRDS/gpt-image-prompting-skill](https://github.com/RBYHNDRDS/gpt-image-prompting-skill) | MIT |
| seedance-prompt（视频） | [zhouwei713/seedance-prompt](https://github.com/zhouwei713/seedance-prompt) | MIT |
| short-drama（剧本） | [dingmike/short-dramas](https://github.com/dingmike/short-dramas) | MIT |

从其他仓库下载的 Skill 由其作者维护，使用前请查看对应许可证和内容。



### 3、抠图、高清与 OCR

在「设置 > 抠图高清设置」中选择 Python 解释器、模型权重目录和输出目录。建议使用独立的 Python 3.10 虚拟环境。详细配置步骤可通过 QQ 交流群获取。

- 抠图使用 `rembg`，需要对应的 `u2net.onnx` 或 `isnet-anime.onnx` 权重。
- 高清放大使用 PyTorch、torchvision、Real-ESRGAN 和 BasicSR，需要页面所选模型对应的 `.pth` 权重。按自己的操作系统与 CPU/GPU 环境安装兼容版本。
- 字幕提取复用该 Python 环境，可在字幕页面安装 PaddleOCR 及视频处理依赖。环境安装和首次模型下载需要网络。

Python 环境、模型权重、及第三方素材均需用户自行准备。各模型与素材的使用须遵守其各自的许可协议。



## 四、数据与隐私

本版本为免登录离线版，已移除登录认证、账号管理、机器码检测、使用时长统计及自动更新等联网功能。

- 应用配置存储在系统应用数据目录下的 `momentum-stick-figure-open` 文件夹；

- 共享设置和提示词模板存储在 `~/.config/momentum-stickfigure-open/`；
- 输出图片、视频和字幕保存到工具中配置的目录；
- AI 绘图与视频创作台的生成记录保存在应用数据目录的 `creative-history` 文件夹；
- Skills 和剧本项目默认保存在 `文稿/MomentumCreative/` 下，可在页面中改为其他文件夹。

开源版本采用独立配置目录。API 密钥保存在本机配置文件中，导出配置时也可能包含 AI 生图密钥；文本模型密钥不包含在配置导出和自动备份中。请勿将个人配置、日志或备份文件上传至公开仓库或分享给他人。



## 五、开发与贡献

技术栈为 Electron 35、Vue 3、Vite、Pinia、Naive UI、Python、Node.js 等。

欢迎提交 Issue 和 Pull Request！反馈问题时请附上操作系统、软件版本、复现步骤和脱敏日志；提交代码前请确保完成构建，并实际运行相关页面进行验证。



## 六、联系方式

软件使用问题或获取帮助，可加入 QQ 群咨询：902990261



## 七、许可证

项目源码采用 [MIT License](LICENSE)。第三方依赖、素材及内置 Skills 保留各自许可，本软件不承担相关责任。

本软件不提供任何第三方中转站或 AI 服务，仅提供接口对接能力。请用户自行甄别服务提供方，谨防上当受骗。
