/**
 * gemini-image-api 配置模块
 */

import path from 'path';
import { buildApiUrl, normalizeApiBaseUrl } from '../../shared/api-url.js';

/**
 * API 配置常量
 */
export const API_CONFIG = {
  // 默认 API 网关地址
  DEFAULT_BASE_URL: '',
  // 默认使用 Gemini 图像模型
  DEFAULT_MODEL: 'gemini-2.5-flash-image',
  // 默认超时时间（分钟）
  DEFAULT_TIMEOUT_MINUTES: 5,

  // API 端点（Gemini 风格）
  ENDPOINTS: {
    /**
     * 构造图像生成接口地址。
     * 处理流程：
     * 1、将模型生成端点拼接到自定义网关地址。
     */
    GENERATE: (baseUrl, model) => buildApiUrl(baseUrl, `v1beta/models/${model}:generateContent`).href,
    /**
     * 构造图像编辑接口地址（与生成共用端点）。
     * 处理流程：
     * 1、将模型生成端点拼接到自定义网关地址。
     */
    EDIT: (baseUrl, model) => buildApiUrl(baseUrl, `v1beta/models/${model}:generateContent`).href
  },

  // HTTP 相关默认配置
  HTTP_TIMEOUT: 120000 // 120 秒（Gemini 生成请求可能较慢）
};

/**
 * 图像生成默认参数
 */
export const GENERATE_DEFAULTS = {
  // 默认生成图片数量
  num_images: 1
};

/**
 * 图像编辑默认参数
 */
export const EDIT_DEFAULTS = {
  // 默认编辑结果图片数量
  num_images: 1
};

/**
 * 生成数量可选项（可用于前端下拉框）
 */
export const NUM_IMAGES_OPTIONS = [
  { label: '1张', value: 1 },
  { label: '2张', value: 2 },
  { label: '3张', value: 3 },
  { label: '4张', value: 4 }
];

/**
 * 路径与文件相关配置
 */
export const PATH_CONFIG = {
  // 输出相关默认路径（相对于项目根目录）
  DEFAULT_OUTPUT_DIR: './output',
  DEFAULT_EDIT_OUTPUT_DIR: './output',
  DEFAULT_LOG_DIR: './logs',

  // 默认日志文件名
  DEFAULT_LOG_FILE: 'fal-api.log',

  // 支持的图片格式
  SUPPORTED_IMAGE_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'],

  // 单文件大小上限（10MB）
  MAX_IMAGE_SIZE: 10 * 1024 * 1024,

  // 扩展名到 MIME 的映射
  MIME_TYPES: {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp'
  }
};

/**
 * 状态常量
 */
export const STATUS = {
  // 任务状态
  TASK: {
    IN_QUEUE: 'IN_QUEUE',
    IN_PROGRESS: 'IN_PROGRESS',
    COMPLETED: 'COMPLETED',
    FAILED: 'FAILED'
  },

  // HTTP 状态码
  HTTP: {
    OK: 200,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404
  }
};

/**
 * 错误消息常量
 * 说明：保持原始内容不变，避免影响前端错误提示逻辑。
 */
export const ERROR_MESSAGES = {
  INVALID_API_KEY: 'API密钥无效',
  TASK_NOT_FOUND: '任务不存在',
  TASK_FAILED: '任务失败',
  TASK_TIMEOUT: '任务超时',
  FILE_NOT_FOUND: '图片文件不存在',
  INVALID_PROMPT: '未提供有效的提示词',
  NO_INPUT_IMAGES: '图片编辑需要提供原始图片列表',
  IMAGE_CONVERSION_FAILED: '图片转换失败',
  DOWNLOAD_FAILED: '图片下载失败',
  NO_IMAGE_DATA: '响应中未找到图片数据',
  UNSUPPORTED_ACTION: '不支持的操作类型',
  NETWORK_ERROR: '网络请求失败'
};

/**
 * 读取并合并 gemini-image 配置
 * 处理流程：
 * 1、确定项目根目录，将输出和日志路径转为绝对路径。
 * 2、合并用户参数、环境密钥和默认值，返回完整配置。
 * @param {Object} userConfig 用户传入的自定义配置
 * @returns {Object} 合并后的完整配置对象
 */
export function getConfig(userConfig = {}) {
  // 1、确定路径基准，优先使用用户传入的项目根目录。
  const projectRoot = userConfig.projectRoot || process.cwd();

  // 读取输出、编辑输出与日志目录配置
  const outputDir = userConfig.outputDir || PATH_CONFIG.DEFAULT_OUTPUT_DIR;
  const editOutputDir = userConfig.editOutputDir || PATH_CONFIG.DEFAULT_EDIT_OUTPUT_DIR;
  const logDir = userConfig.logDir || PATH_CONFIG.DEFAULT_LOG_DIR;

  // 将相对路径转换为以项目根目录为基准的绝对路径
  const fullOutputDir = path.isAbsolute(outputDir) ? outputDir : path.join(projectRoot, outputDir);
  const fullEditOutputDir = path.isAbsolute(editOutputDir) ? editOutputDir : path.join(projectRoot, editOutputDir);
  const fullLogDir = path.isAbsolute(logDir) ? logDir : path.join(projectRoot, logDir);

  // 2、合并接口参数和已解析的目录。
  const config = {
    // API 相关配置
    apiKey: userConfig.apiKey || process.env.FAL_API_KEY || '',
    baseUrl: userConfig.baseUrl || API_CONFIG.DEFAULT_BASE_URL,
    model: userConfig.model || API_CONFIG.DEFAULT_MODEL,
    timeoutMinutes: userConfig.timeoutMinutes || API_CONFIG.DEFAULT_TIMEOUT_MINUTES,

    // 路径配置（均为绝对路径）
    projectRoot: projectRoot,
    outputDir: fullOutputDir,
    editOutputDir: fullEditOutputDir,
    logDir: fullLogDir,
    logFile: path.join(fullLogDir, PATH_CONFIG.DEFAULT_LOG_FILE),

    // 默认参数（允许用户覆盖）
    generateDefaults: { ...GENERATE_DEFAULTS, ...userConfig.generateDefaults },
    editDefaults: { ...EDIT_DEFAULTS, ...userConfig.editDefaults }
  };

  console.log('Gemini 图像 API 配置:', {
    projectRoot: config.projectRoot,
    outputDir: config.outputDir,
    logDir: config.logDir,
    logFile: config.logFile
  });

  return config;
}

/**
 * 校验配置是否有效
 * 处理流程：
 * 1、收集密钥、网关地址、模型和超时参数的问题。
 * 2、返回整体有效性及全部错误消息。
 * @param {Object} config 配置对象
 * @returns {{isValid: boolean, errors: string[]}} 校验结果
 */
export function validateConfig(config) {
  // 1、累积各项配置错误，便于一次展示全部问题。
  const errors = [];

  if (!config.apiKey || config.apiKey === 'your_api_key_here') {
    errors.push(ERROR_MESSAGES.INVALID_API_KEY);
  }

  try {
    normalizeApiBaseUrl(config.baseUrl);
  } catch (error) {
    errors.push(error.message);
  }

  if (!config.model) {
    errors.push('缺少模型名称');
  }

  if (config.timeoutMinutes <= 0) {
    errors.push('超时时间必须大于 0');
  }

  // 2、依据错误集合生成校验结果。
  return {
    isValid: errors.length === 0,
    errors: errors
  };
}

/**
 * 创建默认输出与日志目录
 * 处理流程：
 * 1、汇总生成输出、编辑输出和日志目录。
 * 2、递归创建尚不存在的目录。
 * @param {Object} config 完整配置对象
 */
export function createDefaultDirectories(config) {
  // 1、取得需要准备的目录列表。
  const fs = require('fs');
  const directories = [config.outputDir, config.editOutputDir, config.logDir];

  // 2、保留现有目录，仅创建缺失目录。
  directories.forEach((dir) => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`创建目录: ${dir}`);
    }
  });
}

export default {
  API_CONFIG,
  GENERATE_DEFAULTS,
  EDIT_DEFAULTS,
  NUM_IMAGES_OPTIONS,
  PATH_CONFIG,
  STATUS,
  ERROR_MESSAGES,
  getConfig,
  validateConfig,
  createDefaultDirectories
};
