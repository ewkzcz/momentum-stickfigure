/**
 * Skills 仓库：在用户授权的 Skills 文件夹内扫描、读取和安装 Skill。
 *
 * 目录约定（兼容 Claude/Codex 等 Agent Skills 格式）：
 *   <skills 根>/<skill 目录>/SKILL.md          必需，YAML 头含 name / description（category 可选，缺省时自动推断）
 *   <skills 根>/<skill 目录>/references|assets/*  可选，按需由 Agent 读取（md/txt/yaml/json/csv）
 */
import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_SKILLS } from './builtin-skills/index.js';

const SKILL_FILE = 'SKILL.md';
const MAX_SKILL_BYTES = 256 * 1024;
const MAX_SKILLS = 200;
const CATEGORIES = new Set(['image', 'video', 'script', 'general']);
const SAFE_DIR = /^[\w一-龥.-]{1,80}$/;
const RESOURCE_DIRS = ['references', 'assets'];
const RESOURCE_FILE = /^(references|assets)\/[\w一-龥.-]+\.(md|txt|ya?ml|json|csv)$/i;
// 大多数开源 Skill 的头部没有 category，按关键词推断分类（顺序即优先级）。
const CATEGORY_KEYWORDS = [
  ['video', /video|seedance|storyboard|分镜|视频|运镜|kling|veo|sora/i],
  ['script', /screenplay|script|novel|drama|story|剧本|小说|短剧|编剧|网文/i],
  ['image', /image|prompt|banana|midjourney|flux|生图|绘图|画|海报|插画/i]
];

/**
 * 确定 Skill 分类。
 * 处理流程：
 * 1、头部显式写了合法 category 时直接使用。
 * 2、内置 Skill 用清单中的分类。
 * 3、否则按名称与描述关键词推断，都不命中归为 general。
 */
function resolveCategory(meta, id) {
  // 1、显式分类。
  if (CATEGORIES.has(meta.category)) return meta.category;
  // 2、内置清单。
  const builtin = BUILTIN_SKILLS.find((skill) => skill.id === id);
  if (builtin) return builtin.category;
  // 3、关键词推断。
  const text = `${id} ${meta.name || ''} ${meta.description || ''}`;
  return CATEGORY_KEYWORDS.find(([, pattern]) => pattern.test(text))?.[0] || 'general';
}

/**
 * 解析 SKILL.md 的 YAML 头。
 * 处理流程：
 * 1、只支持单行 key: value 与 `|`/`>` 多行块，足够覆盖常见 Skill 头部。
 * 2、没有头部时返回空元数据，正文为全文。
 */
export function parseSkillMarkdown(text) {
  // 1、头部必须以 --- 开始。
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!match) return { meta: {}, body: text };
  const meta = {};
  let blockKey = '';
  for (const line of match[1].split(/\r?\n/)) {
    const pair = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line);
    if (pair) {
      const value = pair[2].trim();
      blockKey = value === '|' || value === '>' ? pair[1] : '';
      meta[pair[1]] = blockKey ? '' : value.replace(/^["']|["']$/g, '');
    } else if (blockKey && line.trim()) {
      meta[blockKey] = `${meta[blockKey]} ${line.trim()}`.trim();
    }
  }
  // 2、返回元数据和正文。
  return { meta, body: match[2] };
}

/**
 * 在授权根内解析相对路径并拒绝越界和符号链接。
 * 处理流程：
 * 1、拒绝绝对路径和 ..，拼接后确认仍在根目录内。
 * 2、逐级 lstat，任何一级是符号链接都拒绝。
 */
function resolveInside(root, relative) {
  // 1、相对路径检查。
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Skill 路径无效');
  const target = path.resolve(root, relative);
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Skill 路径超出 Skills 文件夹');
  // 2、符号链接可能把读取引到根外。
  let current = root;
  for (const part of rel.split(path.sep)) {
    current = path.join(current, part);
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('Skills 文件夹内不允许符号链接');
  }
  return target;
}

/** 读取受限大小的文本；处理流程：1、确认是普通文件且不超限后按 UTF-8 读取。 */
function readLimited(file) {
  // 1、大文件直接拒绝，避免拖慢界面和撑爆上下文。
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new Error('不是文件');
  if (stat.size > MAX_SKILL_BYTES) throw new Error('Skill 文件过大（上限 256KB）');
  return fs.readFileSync(file, 'utf8');
}

/**
 * 列出 Skills。
 * 处理流程：
 * 1、遍历根下一级目录，读取含 SKILL.md 的目录。
 * 2、解析元数据，缺失 name 时用目录名，未知分类归入 general。
 * 3、单个 Skill 解析失败只记录错误，不影响其他 Skill。
 */
export function listSkills(root) {
  // 1、根目录不存在时返回空列表。
  if (!fs.existsSync(root)) return [];
  const skills = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).slice(0, MAX_SKILLS)) {
    if (!entry.isDirectory() || !SAFE_DIR.test(entry.name)) continue;
    try {
      const file = resolveInside(root, path.join(entry.name, SKILL_FILE));
      if (!fs.existsSync(file)) continue;
      // 2、提取元数据和引用文件列表。
      const { meta, body } = parseSkillMarkdown(readLimited(file));
      const references = [];
      for (const dirName of RESOURCE_DIRS) {
        const dir = path.join(root, entry.name, dirName);
        if (!fs.existsSync(dir) || fs.lstatSync(dir).isSymbolicLink()) continue;
        for (const name of fs.readdirSync(dir)) if (RESOURCE_FILE.test(`${dirName}/${name}`)) references.push(`${dirName}/${name}`);
      }
      const builtin = BUILTIN_SKILLS.find((skill) => skill.id === entry.name);
      skills.push({
        id: entry.name,
        name: meta.name || entry.name,
        description: meta.description || body.trim().split('\n').find(Boolean)?.slice(0, 200) || '',
        category: resolveCategory(meta, entry.name),
        version: meta.version || '',
        source: meta.source || (builtin ? `https://github.com/${builtin.repo}（${builtin.license}）` : ''),
        builtin: Boolean(builtin),
        references
      });
    } catch (error) {
      // 3、记录错误项，界面可提示用户修复。
      skills.push({ id: entry.name, name: entry.name, description: '', category: 'general', error: error.message, references: [] });
    }
  }
  return skills.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

/** 读取 Skill 正文；处理流程：1、读取 SKILL.md 并返回元数据与正文。 */
export function readSkill(root, id) {
  // 1、目录名必须是安全名称。
  if (!SAFE_DIR.test(id)) throw new Error('Skill 名称无效');
  return parseSkillMarkdown(readLimited(resolveInside(root, path.join(id, SKILL_FILE))));
}

/** 读取 Skill 附带文件；处理流程：1、仅允许 references/、assets/ 下的文本文件。 */
export function readSkillFile(root, id, relative) {
  // 1、限制读取范围，Agent 不能借此读取任意文件。
  if (!SAFE_DIR.test(id)) throw new Error('Skill 名称无效');
  if (!RESOURCE_FILE.test(relative)) throw new Error('只能读取 references/ 或 assets/ 下的文本文件');
  return readLimited(resolveInside(root, path.join(id, relative)));
}

/**
 * 安装内置 Skills。
 * 处理流程：
 * 1、逐个写入内置 Skill 目录，已存在的目录跳过，不覆盖用户修改。
 * 2、返回新安装和跳过的列表。
 */
export function installBuiltinSkills(root) {
  // 1、逐个安装。
  const installed = [];
  const skipped = [];
  fs.mkdirSync(root, { recursive: true });
  for (const skill of BUILTIN_SKILLS) {
    const dir = resolveInside(root, skill.id);
    if (fs.existsSync(dir)) {
      skipped.push(skill.id);
      continue;
    }
    for (const [relative, content] of Object.entries(skill.files)) {
      const file = resolveInside(root, path.join(skill.id, relative));
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content, 'utf8');
    }
    installed.push(skill.id);
  }
  // 2、返回结果供界面提示。
  return { installed, skipped };
}

/**
 * 组装启用 Skills 的上下文。
 * 处理流程：
 * 1、full 模式拼接正文（剧本生成直接注入）；index 模式只给名称和描述（Agent 按需加载）。
 * 2、单个 Skill 截断到上限，防止上下文过长。
 */
export function buildSkillContext(root, ids, { mode = 'full', maxCharsPerSkill = 12000 } = {}) {
  // 1、按启用顺序处理，读取失败的跳过。
  const sections = [];
  for (const id of ids || []) {
    try {
      const { meta, body } = readSkill(root, id);
      if (mode === 'index') sections.push(`- ${id}：${meta.description || meta.name || ''}`);
      // 2、正文截断。
      else sections.push(`### Skill：${meta.name || id}\n${body.length > maxCharsPerSkill ? `${body.slice(0, maxCharsPerSkill)}\n…（已截断）` : body}`);
    } catch {
      /* 已删除或损坏的 Skill 直接跳过 */
    }
  }
  return sections.join('\n\n');
}
