/** 剧本项目存储：每个项目一个 JSON 文件，保存在用户授权的剧本文件夹中；导出为 Markdown。 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_PROJECT_BYTES = 8 * 1024 * 1024;
const SAFE_ID = /^[\w-]{1,64}$/;

/** 项目文件路径；处理流程：1、校验 ID 只含安全字符后拼接文件名。 */
function projectFile(root, id) {
  // 1、ID 决定文件名，必须防止路径穿越。
  if (!SAFE_ID.test(id)) throw new Error('项目ID无效');
  return path.join(root, `${id}.script.json`);
}

/** 读取单个项目；处理流程：1、拒绝符号链接与超大文件，2、解析 JSON。 */
function readProject(file) {
  // 1、只读普通文件。
  const stat = fs.lstatSync(file);
  if (!stat.isFile()) throw new Error('项目文件无效');
  if (stat.size > MAX_PROJECT_BYTES) throw new Error('项目文件过大');
  // 2、解析。
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** 列出项目摘要；处理流程：1、扫描 *.script.json，2、按更新时间倒序返回摘要。 */
export function listProjects(root) {
  // 1、目录不存在视为空。
  if (!fs.existsSync(root)) return [];
  const items = [];
  for (const name of fs.readdirSync(root)) {
    if (!name.endsWith('.script.json')) continue;
    try {
      const project = readProject(path.join(root, name));
      items.push({ id: project.id, title: project.title || '未命名项目', type: project.type || '', updatedAt: project.updatedAt || 0 });
    } catch {
      /* 损坏的文件不阻塞列表 */
    }
  }
  // 2、最近编辑的排前面。
  return items.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 读取项目；处理流程：1、按 ID 读取完整项目。 */
export function loadProject(root, id) {
  // 1、文件名由 ID 推导。
  return readProject(projectFile(root, id));
}

/**
 * 保存项目。
 * 处理流程：
 * 1、无 ID 时生成新 ID，并补齐创建/更新时间。
 * 2、先写临时文件再重命名，避免写到一半崩溃导致项目损坏。
 */
export function saveProject(root, project) {
  // 1、补齐元数据。
  const now = Date.now();
  const saved = { ...project, id: project.id || randomUUID(), createdAt: project.createdAt || now, updatedAt: now };
  const text = JSON.stringify(saved, null, 2);
  if (Buffer.byteLength(text) > MAX_PROJECT_BYTES) throw new Error('项目内容过大（上限 8MB）');
  // 2、原子写入。
  fs.mkdirSync(root, { recursive: true });
  const file = projectFile(root, saved.id);
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, 'utf8');
  fs.renameSync(temp, file);
  return saved;
}

/** 删除项目；处理流程：1、只删除本应用生成的项目文件。 */
export function deleteProject(root, id) {
  // 1、文件不存在视为已删除。
  const file = projectFile(root, id);
  if (fs.existsSync(file)) fs.unlinkSync(file);
}

/** 导出 Markdown；处理流程：1、清理文件名，2、写入 exports 子目录，重名追加序号。 */
export function exportMarkdown(root, title, markdown) {
  // 1、文件名去掉系统保留字符。
  const base = String(title || '未命名剧本').replace(/[\\/:*?"<>|\0]/g, '_').slice(0, 80) || '未命名剧本';
  const dir = path.join(root, 'exports');
  fs.mkdirSync(dir, { recursive: true });
  // 2、不覆盖已有导出。
  let file = path.join(dir, `${base}.md`);
  for (let index = 2; fs.existsSync(file); index += 1) file = path.join(dir, `${base}-${index}.md`);
  fs.writeFileSync(file, markdown, 'utf8');
  return file;
}
