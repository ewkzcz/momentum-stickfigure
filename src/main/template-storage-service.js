/**
 * 模板存储服务 - Electron主进程服务层
 * 负责将模板预览图保存到本地文件系统，避免localStorage存储限制
 */

import { ipcMain, app } from 'electron';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);
const unlink = promisify(fs.unlink);
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

// 简单的内存缓存，用于减轻频繁读盘
const templateImageCache = new Map(); // key: fullPath, value: { base64, mtimeMs, size }
const CACHE_LIMIT = 200;

/**
 * 取得图片缓存键。
 * 处理流程：
 * 1、直接使用完整文件路径作为缓存标识。
 */
const getCacheKey = (fullPath) => fullPath;

/**
 * 更新模板图片缓存。
 * 处理流程：
 * 1、检查数据并将当前条目移到插入顺序末尾。
 * 2、保存文件版本信息，超限时淘汰最早条目。
 */
const setCacheEntry = (fullPath, base64Data, fileStats) => {
  // 1、过滤不完整数据并刷新条目顺序。
  if (!fullPath || !base64Data || !fileStats) return;
  if (templateImageCache.has(fullPath)) {
    templateImageCache.delete(fullPath);
  }
  // 2、记录图片及文件状态，用于读取时校验缓存有效性。
  templateImageCache.set(fullPath, {
    base64: base64Data,
    mtimeMs: fileStats.mtimeMs,
    size: fileStats.size
  });
  if (templateImageCache.size > CACHE_LIMIT) {
    const firstKey = templateImageCache.keys().next().value;
    templateImageCache.delete(firstKey);
  }
};

/**
 * 移除指定图片缓存。
 * 处理流程：
 * 1、路径有效时删除对应条目。
 */
const removeCacheEntry = (fullPath) => {
  // 1、忽略空路径并删除缓存项。
  if (!fullPath) return;
  templateImageCache.delete(fullPath);
};

/**
 * 获取模板存储目录
 * 使用应用数据目录，确保不会被轻易删除
 * 处理流程：
 * 1、定位应用数据目录下的模板目录。
 * 2、创建缺失目录并返回路径。
 */
function getTemplateStorageDir() {
  // 1、使用 app.getPath('userData') 获取应用专用数据目录。
  // Windows: C:\Users\<用户名>\AppData\Roaming\<应用名>\templates
  // macOS: ~/Library/Application Support/<应用名>/templates
  // Linux: ~/.config/<应用名>/templates
  const userDataPath = app.getPath('userData');
  const templatesDir = path.join(userDataPath, 'templates');
  
  // 2、确保模板目录存在。
  if (!fs.existsSync(templatesDir)) {
    fs.mkdirSync(templatesDir, { recursive: true });
    console.log('✅ 创建模板存储目录:', templatesDir);
  }
  
  return templatesDir;
}

/**
 * 获取特定模板类型的子目录
 * 处理流程：
 * 1、在模板根目录下拼接类型路径。
 * 2、创建缺失子目录并返回路径。
 * @param {string} templateType - 模板类型 ('actionTemplate' 或 'expressionTemplate')
 */
function getTemplateTypeDir(templateType) {
  // 1、定位并准备类型专属目录。
  const baseDir = getTemplateStorageDir();
  const typeDir = path.join(baseDir, templateType);
  
  if (!fs.existsSync(typeDir)) {
    fs.mkdirSync(typeDir, { recursive: true });
    console.log(`✅ 创建${templateType}子目录:`, typeDir);
  }
  
  return typeDir;
}

/**
 * 将base64图片保存到文件系统
 * 处理流程：
 * 1、校验并解码图片，定位类型目录中的模板文件。
 * 2、写入图片、刷新缓存，返回相对于应用数据目录的路径。
 * @param {string} templateType - 模板类型
 * @param {string} templateId - 模板ID
 * @param {string} base64Data - base64图片数据
 * @returns {Promise<string>} 返回文件路径
 */
async function saveTemplateImage(templateType, templateId, base64Data) {
  // 1、验证图片数据并准备文件内容和目标路径。
  try {
    if (!base64Data || typeof base64Data !== 'string') {
      throw new Error('无效的base64数据');
    }
    
    // 移除base64前缀（如果存在）
    const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
    
    // 将base64转换为Buffer
    const imageBuffer = Buffer.from(base64Content, 'base64');
    
    // 获取存储目录
    const typeDir = getTemplateTypeDir(templateType);
    
    // 生成文件名：模板ID.png
    const fileName = `${templateId}.png`;
    const filePath = path.join(typeDir, fileName);
    
    // 2、保存文件并使用最新文件状态刷新缓存。
    await writeFile(filePath, imageBuffer);
    const fileStats = await stat(filePath);
    
    const normalizedBase64 = base64Data.startsWith('data:image')
      ? base64Data
      : `data:image/png;base64,${base64Content}`;
    setCacheEntry(filePath, normalizedBase64, fileStats);
    
    console.log(`✅ 保存模板图片: ${templateType}/${fileName} (${(imageBuffer.length / 1024).toFixed(2)}KB)`);
    
    // 返回相对于userData的路径（便于跨平台）
    return path.relative(app.getPath('userData'), filePath);
    
  } catch (error) {
    console.error('❌ 保存模板图片失败:', error);
    throw error;
  }
}

/**
 * 从文件系统读取图片并转换为base64
 * 处理流程：
 * 1、解析相对路径并检查文件存在性。
 * 2、优先返回文件状态匹配的缓存，否则读盘转换并更新缓存。
 * @param {string} relativePath - 相对于userData的文件路径
 * @returns {Promise<string>} 返回base64格式的图片数据
 */
async function loadTemplateImage(relativePath) {
  // 1、定位图片文件，不存在时同时清理旧缓存。
  try {
    if (!relativePath) {
      throw new Error('文件路径为空');
    }
    
    // 构建完整路径
    const fullPath = path.join(app.getPath('userData'), relativePath);
    
    // 检查文件是否存在
    if (!fs.existsSync(fullPath)) {
      console.warn(`⚠️ 模板图片不存在: ${fullPath}`);
      removeCacheEntry(fullPath);
      return null;
    }
    
    // 2、用修改时间和大小判断缓存是否仍然有效。
    const fileStats = await stat(fullPath);
    const cacheKey = getCacheKey(fullPath);
    const cached = templateImageCache.get(cacheKey);
    if (cached && cached.mtimeMs === fileStats.mtimeMs && cached.size === fileStats.size) {
      return cached.base64;
    }
    
    // 读取文件
    const imageBuffer = await readFile(fullPath);
    
    // 转换为base64
    const base64Data = `data:image/png;base64,${imageBuffer.toString('base64')}`;
    setCacheEntry(fullPath, base64Data, fileStats);
    
    console.log(`✅ 加载模板图片: ${relativePath} (${(imageBuffer.length / 1024).toFixed(2)}KB)`);
    
    return base64Data;
    
  } catch (error) {
    console.error('❌ 加载模板图片失败:', error);
    return null;
  }
}

/**
 * 批量保存模板图片
 * 处理流程：
 * 1、检查输入列表并以四项为一组并发保存。
 * 2、跳过无效或失败项，汇总成功的模板标识及路径。
 * @param {string} templateType - 模板类型
 * @param {Array} imagePreviews - 图片数据数组 [{ id, base64_data }]
 * @returns {Promise<Array>} 返回路径数组 [{ id, file_path }]
 */
async function batchSaveTemplateImages(templateType, imagePreviews) {
  // 1、空列表直接返回，随后按固定并发量分组处理。
  try {
    if (!Array.isArray(imagePreviews) || imagePreviews.length === 0) {
      return [];
    }
    
    console.log(`📦 批量保存${templateType}图片: ${imagePreviews.length}个`);
    
    const results = [];
    const CONCURRENCY = 4;
    
    // 2、各组依次执行，仅收集成功写入的图片。
    for (let i = 0; i < imagePreviews.length; i += CONCURRENCY) {
      const chunk = imagePreviews.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (preview) => {
        if (!preview.id || !preview.base64_data) {
          console.warn('⚠️ 跳过无效的预览图数据');
          return null;
        }
        try {
          const filePath = await saveTemplateImage(templateType, preview.id, preview.base64_data);
          return { id: preview.id, file_path: filePath };
        } catch (error) {
          console.error(`❌ 保存模板图片失败 (ID: ${preview.id}):`, error);
          return null;
        }
      }));
      
      chunkResults.forEach((item) => {
        if (item) {
          results.push(item);
        }
      });
    }
    
    console.log(`✅ 批量保存完成: ${results.length}/${imagePreviews.length}个成功`);
    
    return results;
    
  } catch (error) {
    console.error('❌ 批量保存模板图片失败:', error);
    throw error;
  }
}

/**
 * 批量加载模板图片
 * 处理流程：
 * 1、检查路径列表并以四项为一组加载。
 * 2、过滤缺失或失败图片，返回模板标识与图片数据。
 * @param {Array} filePathsData - 文件路径数组 [{ id, file_path }]
 * @returns {Promise<Array>} 返回base64数据数组 [{ id, base64_data }]
 */
async function batchLoadTemplateImages(filePathsData) {
  // 1、验证输入集合并准备分组加载。
  try {
    if (!Array.isArray(filePathsData) || filePathsData.length === 0) {
      return [];
    }
    
    console.log(`📦 批量加载模板图片: ${filePathsData.length}个`);
    
    const results = [];
    const CONCURRENCY = 4;
    
    // 2、受限并发读取各组图片并收集有效结果。
    for (let i = 0; i < filePathsData.length; i += CONCURRENCY) {
      const chunk = filePathsData.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (pathData) => {
        if (!pathData.id || !pathData.file_path) {
          console.warn('⚠️ 跳过无效的路径数据');
          return null;
        }
        try {
          const base64Data = await loadTemplateImage(pathData.file_path);
          if (base64Data) {
            return {
              id: pathData.id,
              base64_data: base64Data
            };
          }
        } catch (error) {
          console.error(`❌ 加载模板图片失败 (ID: ${pathData.id}):`, error);
        }
        return null;
      }));
      
      chunkResults.forEach((item) => {
        if (item) {
          results.push(item);
        }
      });
    }
    
    console.log(`✅ 批量加载完成: ${results.length}/${filePathsData.length}个成功`);
    
    return results;
    
  } catch (error) {
    console.error('❌ 批量加载模板图片失败:', error);
    throw error;
  }
}

/**
 * 删除模板图片
 * 处理流程：
 * 1、解析路径并确认文件存在。
 * 2、删除文件及缓存，返回是否实际删除。
 * @param {string} relativePath - 相对于userData的文件路径
 * @returns {Promise<boolean>} 成功返回true
 */
async function deleteTemplateImage(relativePath) {
  // 1、忽略空路径，检查目标文件。
  try {
    if (!relativePath) {
      return false;
    }
    
    const fullPath = path.join(app.getPath('userData'), relativePath);
    
    if (fs.existsSync(fullPath)) {
      // 2、文件删除成功后同步失效缓存。
      await unlink(fullPath);
      removeCacheEntry(fullPath);
      console.log(`🗑️ 删除模板图片: ${relativePath}`);
      return true;
    }
    
    return false;
    
  } catch (error) {
    console.error('❌ 删除模板图片失败:', error);
    return false;
  }
}

/**
 * 批量删除模板图片
 * 处理流程：
 * 1、检查路径列表并分组并发删除。
 * 2、累计删除成功的数量，失败项不影响同组其他项。
 * @param {Array} filePathsData - 文件路径数组 [{ id, file_path }]
 * @returns {Promise<number>} 返回删除成功的数量
 */
async function batchDeleteTemplateImages(filePathsData) {
  // 1、验证路径列表并按固定并发量执行删除。
  try {
    if (!Array.isArray(filePathsData) || filePathsData.length === 0) {
      return 0;
    }
    
    console.log(`🗑️ 批量删除模板图片: ${filePathsData.length}个`);
    
    // 2、以单项删除的布尔结果累计成功数量。
    let deleteCount = 0;
    const CONCURRENCY = 4;
    
    for (let i = 0; i < filePathsData.length; i += CONCURRENCY) {
      const chunk = filePathsData.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (pathData) => {
        if (!pathData.file_path) {
          return false;
        }
        return deleteTemplateImage(pathData.file_path);
      }));
      
      chunkResults.forEach((success) => {
        if (success) {
          deleteCount++;
        }
      });
    }
    
    console.log(`✅ 批量删除完成: ${deleteCount}/${filePathsData.length}个成功`);
    
    return deleteCount;
    
  } catch (error) {
    console.error('❌ 批量删除模板图片失败:', error);
    return 0;
  }
}

/**
 * 清理未使用的模板图片
 * @param {string} templateType - 模板类型
 * @param {Array} validTemplateIds - 有效的模板ID列表
 * @returns {Promise<number>} 返回清理的文件数量
 */
const cleanupLocks = new Map();

/**
 * 按有效模板标识清理遗留图片。
 * 处理流程：
 * 1、取得类型清理锁，跳过同类型并发请求。
 * 2、删除不在有效列表中的 PNG 及缓存，最终释放锁。
 */
async function cleanupUnusedTemplateImages(templateType, validTemplateIds = []) {
  // 1、同类型同一时刻只执行一次清理。
  const lockKey = templateType || 'unknown';
  if (cleanupLocks.get(lockKey)) {
    console.log(`⚠️ ${templateType} 清理正在进行中，跳过本次请求`);
    return 0;
  }

  cleanupLocks.set(lockKey, true);

  try {
    const typeDir = getTemplateTypeDir(templateType);
    const files = await readdir(typeDir);
    
    let cleanCount = 0;
    
    // 2、按文件名提取模板标识，只删除无引用的 PNG。
    for (const file of files) {
      // 只处理.png文件
      if (!file.endsWith('.png')) {
        continue;
      }
      
      // 提取模板ID（文件名去掉扩展名）
      const templateId = path.basename(file, '.png');
      
      // 检查是否在有效ID列表中
      if (!validTemplateIds.includes(templateId)) {
        const filePath = path.join(typeDir, file);
        try {
          await unlink(filePath);
          removeCacheEntry(filePath);
          cleanCount++;
          console.log(`🧹 清理未使用的模板图片: ${file}`);
        } catch (error) {
          console.error(`❌ 清理失败: ${file}`, error);
        }
      }
    }
    
    if (cleanCount > 0) {
      console.log(`✅ 清理完成: ${templateType}共清理${cleanCount}个未使用的文件`);
    }
    
    return cleanCount;
    
  } catch (error) {
    console.error('❌ 清理未使用的模板图片失败:', error);
    return 0;
  } finally {
    cleanupLocks.delete(lockKey);
  }
}

/**
 * 获取存储统计信息
 * 处理流程：
 * 1、读取动作与表情模板目录中的 PNG 列表。
 * 2、累计文件数量和容量，返回各类型统计。
 * @returns {Promise<Object>} 返回存储统计数据
 */
async function getStorageStats() {
  // 1、建立统计结构并枚举两个模板类型。
  try {
    const baseDir = getTemplateStorageDir();
    const stats = {
      baseDir,
      types: {}
    };
    
    for (const templateType of ['actionTemplate', 'expressionTemplate']) {
      const typeDir = getTemplateTypeDir(templateType);
      const files = await readdir(typeDir);
      const pngFiles = files.filter(f => f.endsWith('.png'));
      
      // 2、累计当前类型的图片容量。
      let totalSize = 0;
      for (const file of pngFiles) {
        const filePath = path.join(typeDir, file);
        const fileStat = await stat(filePath);
        totalSize += fileStat.size;
      }
      
      stats.types[templateType] = {
        dir: typeDir,
        count: pngFiles.length,
        totalSizeMB: (totalSize / 1024 / 1024).toFixed(2)
      };
    }
    
    return stats;
    
  } catch (error) {
    console.error('❌ 获取存储统计失败:', error);
    return null;
  }
}

/**
 * 注册所有模板存储相关的IPC处理器
 * 处理流程：
 * 1、注册单张及批量图片读写、删除接口。
 * 2、注册清理、统计和目录查询接口，统一包装异常。
 */
export function registerTemplateStorageHandlers() {
  console.log('注册模板存储服务 IPC 处理器...');
  
  // 1、注册单个模板图片保存接口。
  ipcMain.handle('template-storage-save-image', async (event, { templateType, templateId, base64Data }) => {
    try {
      const filePath = await saveTemplateImage(templateType, templateId, base64Data);
      return { success: true, filePath };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 2、注册单个模板图片加载接口。
  ipcMain.handle('template-storage-load-image', async (event, { relativePath }) => {
    try {
      const base64Data = await loadTemplateImage(relativePath);
      return { success: true, base64Data };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 3、注册批量模板图片保存接口。
  ipcMain.handle('template-storage-batch-save', async (event, { templateType, imagePreviews }) => {
    try {
      const results = await batchSaveTemplateImages(templateType, imagePreviews);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 4、注册批量模板图片加载接口。
  ipcMain.handle('template-storage-batch-load', async (event, { filePathsData }) => {
    try {
      const results = await batchLoadTemplateImages(filePathsData);
      return { success: true, results };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 5、注册单个模板图片删除接口。
  ipcMain.handle('template-storage-delete-image', async (event, { relativePath }) => {
    try {
      const success = await deleteTemplateImage(relativePath);
      return { success };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 6、注册批量模板图片删除接口。
  ipcMain.handle('template-storage-batch-delete', async (event, { filePathsData }) => {
    try {
      const deleteCount = await batchDeleteTemplateImages(filePathsData);
      return { success: true, deleteCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 7、注册未使用图片清理接口。
  ipcMain.handle('template-storage-cleanup', async (event, { templateType, validTemplateIds }) => {
    try {
      const cleanCount = await cleanupUnusedTemplateImages(templateType, validTemplateIds);
      return { success: true, cleanCount };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 8、注册存储统计查询。
  ipcMain.handle('template-storage-stats', async () => {
    try {
      const stats = await getStorageStats();
      return { success: true, stats };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  // 9、注册模板根目录查询。
  ipcMain.handle('template-storage-get-dir', async () => {
    try {
      const dir = getTemplateStorageDir();
      return { success: true, dir };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });
  
  console.log('✅ 模板存储服务 IPC 处理器注册完成');
}

/**
 * 注销所有模板存储相关的IPC处理器
 * 处理流程：
 * 1、移除本模块注册的全部模板存储通道。
 */
export function unregisterTemplateStorageHandlers() {
  // 1、解除模板图片管理及查询处理器。
  console.log('注销模板存储服务 IPC 处理器...');
  
  ipcMain.removeHandler('template-storage-save-image');
  ipcMain.removeHandler('template-storage-load-image');
  ipcMain.removeHandler('template-storage-batch-save');
  ipcMain.removeHandler('template-storage-batch-load');
  ipcMain.removeHandler('template-storage-delete-image');
  ipcMain.removeHandler('template-storage-batch-delete');
  ipcMain.removeHandler('template-storage-cleanup');
  ipcMain.removeHandler('template-storage-stats');
  ipcMain.removeHandler('template-storage-get-dir');
  
  console.log('✅ 模板存储服务 IPC 处理器注销完成');
}
