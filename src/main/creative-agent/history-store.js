/**
 * 生成历史记录：图片/视频的直接生成与 Agent 增强结果。
 *
 * 目录结构（应用数据目录下）：
 *   index.json           记录列表（含缩略图，不含原图）
 *   media/<id>-<n>.png   原图文件
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCanvas, loadImage } from '@momentum/media-canvas';

const MAX_RECORDS = 2000;
const THUMB_WIDTH = 360;
const SAFE_ID = /^[\w-]{1,64}$/;
const KINDS = new Set(['image', 'video']);
const MODES = new Set(['direct', 'agent']);

const indexFile = (root) => path.join(root, 'index.json');
const mediaDir = (root) => path.join(root, 'media');

/** 读取索引；处理流程：1、文件不存在或损坏时返回空列表。 */
function readIndex(root) {
  // 1、损坏的索引不阻塞新记录写入。
  try {
    const records = JSON.parse(fs.readFileSync(indexFile(root), 'utf8'));
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

/** 写入索引；处理流程：1、先写临时文件再重命名，避免写到一半损坏。 */
function writeIndex(root, records) {
  // 1、原子写入。
  fs.mkdirSync(root, { recursive: true });
  const temp = `${indexFile(root)}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(records), 'utf8');
  fs.renameSync(temp, indexFile(root));
}

/** 生成缩略图；处理流程：1、按宽度等比缩小并编码为 JPEG 数据地址，失败时返回空。 */
async function makeThumb(buffer) {
  // 1、缩略图只用于列表展示。
  try {
    const image = await loadImage(buffer);
    const width = Math.min(THUMB_WIDTH, image.width);
    const height = Math.max(1, Math.round((image.height * width) / image.width));
    const canvas = createCanvas(width, height);
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    return `data:image/jpeg;base64,${canvas.toBuffer('image/jpeg', 80).toString('base64')}`;
  } catch {
    return '';
  }
}

/** 默认标题；处理流程：1、取提示词或输入的前 30 个字符。 */
function defaultTitle(record) {
  // 1、去掉换行，避免列表错位。
  const text = String(record.input || record.prompt || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, 30) : (record.kind === 'video' ? '视频生成' : '图片生成');
}

/** 去掉内部字段；处理流程：1、返回给界面的记录不含原图文件名。 */
function publicRecord(record) {
  // 1、界面通过 readMedia 按序号获取原图。
  return { ...record, media: record.media.map(({ file, ...rest }) => ({ ...rest, hasFile: Boolean(file) })) };
}

/**
 * 新增记录。
 * 处理流程：
 * 1、图片数据地址写成原图文件并生成缩略图；视频只记录地址。
 * 2、写入索引，超过上限时删除最早且未收藏、未置顶的记录。
 */
export async function addRecord(root, input) {
  // 1、保存媒体。
  if (!KINDS.has(input.kind) || !MODES.has(input.mode)) throw new Error('记录类型无效');
  const id = randomUUID();
  const media = [];
  fs.mkdirSync(mediaDir(root), { recursive: true });
  for (const [index, dataUrl] of (input.images || []).entries()) {
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!match) continue;
    const buffer = Buffer.from(match[2], 'base64');
    const file = `${id}-${index}.${match[1] === 'jpeg' ? 'jpg' : match[1]}`;
    fs.writeFileSync(path.join(mediaDir(root), file), buffer);
    media.push({ type: 'image', file, mime: `image/${match[1]}`, thumb: await makeThumb(buffer) });
  }
  for (const url of input.videos || []) {
    if (/^(https?:|data:video\/)/i.test(url)) media.push({ type: 'video', url });
  }
  const now = Date.now();
  const record = {
    id,
    kind: input.kind,
    mode: input.mode,
    title: String(input.title || '').trim().slice(0, 100) || defaultTitle(input),
    prompt: String(input.prompt || ''),
    input: String(input.input || ''),
    reply: String(input.reply || ''),
    params: input.params && typeof input.params === 'object' ? input.params : {},
    media,
    favorite: false,
    pinned: false,
    createdAt: now,
    updatedAt: now
  };
  // 2、写索引并清理超量的旧记录。
  const records = [record, ...readIndex(root)];
  while (records.length > MAX_RECORDS) {
    const index = records.findLastIndex((item) => !item.favorite && !item.pinned);
    if (index < 0) break;
    removeMedia(root, records[index]);
    records.splice(index, 1);
  }
  writeIndex(root, records);
  return publicRecord(record);
}

/**
 * 查询记录。
 * 处理流程：
 * 1、按类型、模式、收藏和关键词（标题、提示词、输入）过滤。
 * 2、置顶在前，其余按创建时间倒序。
 */
export function listRecords(root, query = {}) {
  // 1、过滤。
  const keyword = String(query.keyword || '').trim().toLowerCase();
  const records = readIndex(root).filter((item) => (
    (!query.kind || item.kind === query.kind)
    && (!query.mode || item.mode === query.mode)
    && (!query.favoriteOnly || item.favorite)
    && (!keyword || `${item.title}\n${item.prompt}\n${item.input}`.toLowerCase().includes(keyword))
  ));
  // 2、排序。
  records.sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt - a.createdAt);
  return records.map(publicRecord);
}

/** 修改记录；处理流程：1、只允许改标题、收藏、置顶，2、更新时间并写回。 */
export function updateRecord(root, id, patch) {
  // 1、字段白名单。
  if (!SAFE_ID.test(id)) throw new Error('记录ID无效');
  const records = readIndex(root);
  const record = records.find((item) => item.id === id);
  if (!record) throw new Error('记录不存在');
  if (patch.title !== undefined) {
    const title = String(patch.title).trim().slice(0, 100);
    if (!title) throw new Error('名称不能为空');
    record.title = title;
  }
  if (patch.favorite !== undefined) record.favorite = Boolean(patch.favorite);
  if (patch.pinned !== undefined) record.pinned = Boolean(patch.pinned);
  // 2、写回。
  record.updatedAt = Date.now();
  writeIndex(root, records);
  return publicRecord(record);
}

/** 删除记录的原图文件；处理流程：1、只删除 media 目录内本记录的文件。 */
function removeMedia(root, record) {
  // 1、文件名由本模块生成，仍做一次安全检查。
  for (const item of record.media || []) {
    if (item.file && /^[\w.-]+$/.test(item.file)) fs.rmSync(path.join(mediaDir(root), item.file), { force: true });
  }
}

/** 删除记录（支持批量）；处理流程：1、删除原图文件，2、写回剩余记录，返回删除数量。 */
export function deleteRecords(root, ids) {
  // 1、只处理合法 ID。
  const targets = new Set(ids.filter((id) => SAFE_ID.test(id)));
  const records = readIndex(root);
  const kept = [];
  let removed = 0;
  for (const record of records) {
    if (targets.has(record.id)) {
      removeMedia(root, record);
      removed += 1;
    } else kept.push(record);
  }
  // 2、写回。
  writeIndex(root, kept);
  return removed;
}

/** 读取原图；处理流程：1、按记录与序号找到文件，2、返回数据地址。 */
export function readMedia(root, id, index) {
  // 1、定位文件。
  if (!SAFE_ID.test(id) || !Number.isInteger(index) || index < 0) throw new Error('参数无效');
  const record = readIndex(root).find((item) => item.id === id);
  const item = record?.media?.[index];
  if (!item) throw new Error('媒体不存在');
  if (item.type === 'video') return { type: 'video', url: item.url };
  // 2、读取原图。
  const buffer = fs.readFileSync(path.join(mediaDir(root), item.file));
  return { type: 'image', url: `data:${item.mime};base64,${buffer.toString('base64')}` };
}
