/** Gemini 图像客户端：组装生成与编辑请求并解析图像响应。 */
import { buildApiUrl } from '../../shared/api-url.js';
/**
 * gemini-image-api HTTP 客户端模块
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';

/**
 * 内部日志记录器初始化
 * 处理流程：
 * 1、准备日志目录。
 * 2、返回同时写入文件和控制台的分级日志方法。
 * @param {string} logPath 日志文件路径
 * @returns {{info: Function, error: Function, warning: Function}} 日志对象
 */
function _setupLogger(logPath) {
  // 1、解析并准备日志目录。
  const logDir = path.dirname(logPath);

  // 确保日志目录存在
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // 2、构造各级别日志方法。
  const logger = {
    /**
     * 记录普通信息。
     * 处理流程：
     * 1、添加时间戳后写入文件及控制台。
     */
    info: (message) => {
      // 1、格式化并输出普通日志。
      const timestamp = new Date().toISOString();
      const logMessage = `${timestamp} - INFO - ${message}\n`;
      fs.appendFileSync(logPath, logMessage, 'utf8');
      console.log(`[INFO] ${message}`);
    },
    /**
     * 记录错误信息。
     * 处理流程：
     * 1、清理换行并附加时间戳，写入文件及错误控制台。
     */
    error: (message) => {
      // 1、规范错误文本，保证一条记录占一行。
      const timestamp = new Date().toISOString();
      // 将换行等不可见字符统一清理，保证日志一行一个记录
      const cleanMessage = String(message).replace(/\n/g, ' ').replace(/\r/g, '');
      const logMessage = `${timestamp} - ERROR - ${cleanMessage}\n`;
      fs.appendFileSync(logPath, logMessage, 'utf8');
      console.error(`[ERROR] ${cleanMessage}`);
    },
    /**
     * 记录警告信息。
     * 处理流程：
     * 1、添加时间戳后写入文件及警告控制台。
     */
    warning: (message) => {
      // 1、格式化并输出警告日志。
      const timestamp = new Date().toISOString();
      const logMessage = `${timestamp} - WARNING - ${message}\n`;
      fs.appendFileSync(logPath, logMessage, 'utf8');
      console.warn(`[WARNING] ${message}`);
    }
  };

  return logger;
}

/**
 * 调用 Gemini 图像生成接口
 * 处理流程：
 * 1、构造文字提示、图像输出配置和网关请求地址。
 * 2、发起请求并提取图像数据，按网络或服务错误生成提示。
 * @param {string} prompt 文本提示词
 * @param {string} apiKey API 密钥
 * @param {string} baseUrl API 网关地址
 * @param {number} timeoutMinutes 超时时长（分钟）
 * @param {string} model 模型名称（如 gemini-2.5-flash-image）
 * @param {string} logPath 日志文件路径
 * @param {string} savePath 图片保存目录
 * @param {Object} options 附加参数（如 aspectRatio）
 * @returns {Promise<Array<string>>} 生成后的图片 URL 列表
 */
export async function generateImage(
  prompt,
  apiKey,
  baseUrl,
  timeoutMinutes,
  model,
  logPath,
  savePath = './output',
  options = {}
) {
  // 1、建立日志并组装生成请求。
  const logger = _setupLogger(logPath);
  logger.info(`开始图像生成请求 - 提示词: ${prompt}`);

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  // Gemini API 标准请求体
  const data = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      // 图像生成：仅返回 IMAGE，避免混入文本
      responseModalities: ['IMAGE'],
      // 支持宽高比配置（例如 1:1、9:16 等）
      imageConfig: options?.aspectRatio ? { aspectRatio: String(options.aspectRatio) } : undefined
    }
  };

  // 2、通过共享路径工具拼接接口，保留自定义网关前缀。
  const endpoint = buildApiUrl(baseUrl, `v1beta/models/${model}:generateContent`).href;

  try {
    const response = await axios.post(endpoint, data, {
      headers: headers,
      timeout: 120000 // 与旧实现保持一致：120 秒
    });

    if (response.status === 200) {
      const result = response.data;

      // 记录完整响应，方便排查问题
      logger.info('=== API 响应数据（摘要） ===');
      logger.info(JSON.stringify(result, null, 2));

      console.log('🌌 Gemini API 响应（摘要）:', result);

      // 从 Gemini 响应中提取图片 URL 列表
      const imageUrls = _extractGeminiImageUrls(result, logger);

      // 保存图片到本地
      // ⚠️ 仅保留图像数据，真正保存由拖拽等导出动作触发
      logger.info('🎨 生成完成：仅返回图像数据，未写入本地');
      return imageUrls;
    }
  } catch (error) {
    let errorData = '';
    let friendlyMessage = ''; // 用户友好的错误提示

    if (error.response) {
      // HTTP 层错误
      const status = error.response.status;
      const statusText = error.response.statusText;

      if (error.response.data) {
        if (typeof error.response.data === 'object') {
          try {
            errorData = JSON.stringify(error.response.data, null, 2);

            // 检查是否是quota相关错误
            const errorObj = error.response.data;
            const errorCode = errorObj?.error?.code || '';
            const errorMessage = errorObj?.error?.message || '';

            if (errorCode.includes('insufficient_quota') ||
                errorCode.includes('quota_exceeded') ||
                errorCode.includes('quota') ||
                errorMessage.toLowerCase().includes('quota')) {
              friendlyMessage = '当前令牌额度已耗尽';
            } else if (errorCode.includes('invalid_api_key') ||
                       errorMessage.toLowerCase().includes('invalid api key')) {
              friendlyMessage = 'API密钥无效';
            } else if (errorCode.includes('rate_limit')) {
              friendlyMessage = '请求频率超限';
            }
          } catch {
            errorData = '无法序列化的错误响应体';
          }
        } else {
          errorData = String(error.response.data);
        }
      } else {
        errorData = statusText || '无更详细的错误信息';
      }

      // 如果有友好提示，优先使用友好提示；否则使用详细错误信息
      const errorMsg = friendlyMessage || `请求失败: HTTP ${status} - ${errorData}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    } else if (error.request) {
      // 请求已发出但没有收到响应
      const errorMsg = `请求失败: 网络请求未获得响应 - ${error.message}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    } else {
      // 其它错误
      const errorMsg = `请求失败: ${error.message}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}

/**
 * 调用 Gemini 图像编辑接口
 * 处理流程：
 * 1、将输入图片和文本组装为多模态请求。
 * 2、请求编辑接口并提取图像数据，统一处理服务和网络错误。
 * @param {string} prompt 文本编辑说明
 * @param {Array<string>} imageUrls 原始图片的 base64 DataURL 列表
 * @param {string} apiKey API 密钥
 * @param {string} baseUrl API 网关地址
 * @param {number} timeoutMinutes 超时时长（分钟）
 * @param {string} model 模型名称
 * @param {string} logPath 日志文件路径
 * @param {string} savePath 输出目录
 * @param {Object} options 附加参数（如 aspectRatio）
 * @returns {Promise<Array<string>>} 编辑结果图片 URL 列表
 */
export async function editImage(
  prompt,
  imageUrls,
  apiKey,
  baseUrl,
  timeoutMinutes,
  model,
  logPath,
  savePath = './output',
  options = {}
) {
  // 1、准备编辑请求的日志、图片及文字参数。
  const logger = _setupLogger(logPath);
  logger.info(
    `开始图像编辑请求 - 提示词: ${prompt}, 原始图片数量: ${imageUrls.length}`
  );

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json'
  };

  // 构造 parts：先放图片，再放文本
  const parts = [];

  for (const imageUrl of imageUrls) {
    let imageData = imageUrl;
    if (imageUrl.startsWith('data:image/')) {
      const base64Match = imageUrl.match(/^data:image\/\w+;base64,(.+)$/);
      if (base64Match) {
        imageData = base64Match[1];
      }
    }

    parts.push({
      inline_data: {
        mime_type: 'image/png',
        data: imageData
      }
    });
  }

  // 再追加文本指令
  parts.push({ text: prompt });

  const data = {
    contents: [
      {
        role: 'user',
        parts: parts
      }
    ],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: options?.aspectRatio ? { aspectRatio: String(options.aspectRatio) } : undefined
    }
  };

  // 2、发送编辑请求，成功时仅返回图像数据。
  const endpoint = buildApiUrl(baseUrl, `v1beta/models/${model}:generateContent`).href;

  try {
    const response = await axios.post(endpoint, data, {
      headers: headers,
      timeout: 120000
    });

    if (response.status === 200) {
      const result = response.data;

      logger.info('=== API 图像编辑响应（摘要） ===');
      logger.info(JSON.stringify(result, null, 2));
      console.log('🛠 Gemini 图像编辑响应（摘要）:', result);

      const imageUrlsResult = _extractGeminiImageUrls(result, logger);
      // ⚠️ 同样仅返回图像数据，避免重复写盘
      logger.info('🛠️ 编辑完成：仅返回图像数据，未写入本地');
      return imageUrlsResult;
    }
  } catch (error) {
    let errorData = '';
    let friendlyMessage = ''; // 用户友好的错误提示

    if (error.response) {
      const status = error.response.status;
      const statusText = error.response.statusText;

      if (error.response.data) {
        if (typeof error.response.data === 'object') {
          try {
            errorData = JSON.stringify(error.response.data, null, 2);

            // 检查是否是quota相关错误
            const errorObj = error.response.data;
            const errorCode = errorObj?.error?.code || '';
            const errorMessage = errorObj?.error?.message || '';

            if (errorCode.includes('insufficient_quota') ||
                errorCode.includes('quota_exceeded') ||
                errorCode.includes('quota') ||
                errorMessage.toLowerCase().includes('quota')) {
              friendlyMessage = '当前令牌额度已耗尽';
            } else if (errorCode.includes('invalid_api_key') ||
                       errorMessage.toLowerCase().includes('invalid api key')) {
              friendlyMessage = 'API密钥无效';
            } else if (errorCode.includes('rate_limit')) {
              friendlyMessage = '请求频率超限';
            }
          } catch {
            errorData = '无法序列化的错误响应体';
          }
        } else {
          errorData = String(error.response.data);
        }
      } else {
        errorData = statusText || '无更详细的错误信息';
      }

      // 如果有友好提示，优先使用友好提示；否则使用详细错误信息
      const errorMsg = friendlyMessage || `请求失败: HTTP ${status} - ${errorData}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    } else if (error.request) {
      const errorMsg = `请求失败: 网络请求未获得响应 - ${error.message}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    } else {
      const errorMsg = `请求失败: ${error.message}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }
}

/**
 * 从 Gemini 响应中提取图片 base64 URL 列表
 * 处理流程：
 * 1、验证候选结果集合并遍历内容片段。
 * 2、兼容两种内联数据字段写法，组装图像数据地址。
 * 3、无图像时抛出解析异常。
 * @param {Object} result Gemini 接口返回的完整 JSON
 * @param {Object} logger 日志对象
 * @returns {Array<string>} 图片 URL 列表
 */
function _extractGeminiImageUrls(result, logger) {
  // 1、校验候选集合的基本结构。
  try {
    const imageUrls = [];

    if (!result || !Array.isArray(result.candidates)) {
      throw new Error('响应中不包含候选结果');
    }

    // 2、兼容驼峰和下划线字段，收集包含数据的图像片段。
    for (const candidate of result.candidates) {
      if (!candidate.content || !Array.isArray(candidate.content.parts)) {
        continue;
      }

      for (const part of candidate.content.parts) {
        if (part.inlineData || part.inline_data) {
          const inlineData = part.inlineData || part.inline_data;
          const mimeType = inlineData.mimeType || inlineData.mime_type || 'image/png';
          const data = inlineData.data || '';

          if (data) {
            const url = `data:${mimeType};base64,${data}`;
            imageUrls.push(url);
          }
        }
      }
    }

    // 3、响应成功但没有图像时，也向调用方报告失败。
    if (imageUrls.length === 0) {
      throw new Error('响应中未找到任何图片数据');
    }

    return imageUrls;
  } catch (error) {
    logger.error(`解析图片数据失败: ${error.message}`);
    throw error;
  }
}

/**
 * 将图片 base64 URL 列表保存到本地文件系统
 * 处理流程：
 * 1、确保输出目录存在。
 * 2、逐张解析数据地址并写入文件，记录单项失败后继续。
 * @param {Array<string>} imageUrls 图片 URL 列表（dataURL）
 * @param {string} savePath 保存目录
 * @param {string} model 模型名称（用于文件命名）
 * @param {string} action 操作类型（generate / edit）
 * @param {Object} logger 日志对象
 * @returns {Promise<void>}
 */
async function _saveImagesToLocal(imageUrls, savePath, model, action, logger) {
  // 1、确保输出目录存在。
  if (!fs.existsSync(savePath)) {
    fs.mkdirSync(savePath, { recursive: true });
  }

  // 2、按操作、模型和时间命名文件，逐张解码保存。
  for (let i = 0; i < imageUrls.length; i++) {
    const imageUrl = imageUrls[i];
    try {
      const base64Match = imageUrl.match(/^data:(image\/\w+);base64,(.+)$/);
      if (!base64Match) {
        logger.warning(`第 ${i + 1} 张图片不是标准的 dataURL，跳过保存`);
        continue;
      }

      const mimeType = base64Match[1];
      const data = base64Match[2];
      const ext = mimeType.split('/')[1] || 'png';

      const filename = `${action}-${model}-${Date.now()}-${i + 1}.${ext}`;
      const filePath = path.join(savePath, filename);

      fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
      logger.info(`图片保存成功: ${filePath}`);
    } catch (error) {
      logger.error(`保存第 ${i + 1} 张图片失败: ${error.message}`);
    }
  }
}

export default {
  generateImage,
  editImage
};
