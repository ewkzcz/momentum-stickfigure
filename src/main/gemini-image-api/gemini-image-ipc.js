/**
 * gemini-image-api IPC 注册模块
 * --------------------------------------------
 * 负责在主进程中注册 Gemini 图像相关的 IPC 渠道。
 */

import { ipcMain } from 'electron';
import path from 'path';

// 直接从 ESM 模块中按需导入需要的函数
import { apiWrapper } from './gemini-image-service.js';
import {
  getConfig,
  validateConfig,
  createDefaultDirectories
} from './gemini-image-config.js';
import {
  validateImageFile,
  getImageInfo
} from './gemini-image-utils.js';

/**
 * 注册 Gemini 图像相关的 IPC 处理器
 * 对外依旧导出为 registerFalApiHandlers，以保持旧代码兼容。
 * 处理流程：
 * 1、注册生成与编辑通道，在调用前校验配置和图片。
 * 2、注册配置、图片校验及目录准备查询通道。
 */
export function registerFalApiHandlers() {
  console.log('注册 Gemini 图像（原 Fal.ai）IPC 处理器...');

  // 1、注册图像生成入口，校验配置后调用业务服务。
  ipcMain.handle('fal-generate-image', async (event, options) => {
    try {
      const config = getConfig(options);
      const validation = validateConfig(config);

      if (!validation.isValid) {
        return {
          success: false,
          message: validation.errors.join(', '),
          errors: validation.errors
        };
      }

      // 创建必要的输出与日志目录
      createDefaultDirectories(config);

      // 只在前端显式指定宽高比时才透传到下游
      const apiParams = {
        prompt: options.prompt,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMinutes: config.timeoutMinutes,
        model: config.model,
        logPath: config.logFile,
        savePath: config.outputDir,
        ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {})
      };

      const result = await apiWrapper('generate', apiParams);

      console.log('图像生成结果:', result.success ? '成功' : '失败');
      return result;
    } catch (error) {
      console.error('图像生成异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  // 2、注册图像编辑入口，额外检查每张原始图片。
  ipcMain.handle('fal-edit-image', async (event, options) => {
    try {
      const config = getConfig(options);
      const validation = validateConfig(config);

      if (!validation.isValid) {
        return {
          success: false,
          message: validation.errors.join(', '),
          errors: validation.errors
        };
      }

      // 校验输入图片
      if (!options.inputImages || options.inputImages.length === 0) {
        return {
          success: false,
          message: '图片编辑需要提供原始图片列表'
        };
      }

      for (const imagePath of options.inputImages) {
        if (!validateImageFile(imagePath)) {
          return {
            success: false,
            message: `无效的图片文件: ${imagePath}`
          };
        }
      }

      createDefaultDirectories(config);

      const editParams = {
        prompt: options.prompt,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        timeoutMinutes: config.timeoutMinutes,
        model: config.model,
        logPath: config.logFile,
        savePath: config.editOutputDir,
        inputImages: options.inputImages,
        ...(options.aspectRatio ? { aspectRatio: options.aspectRatio } : {})
      };

      const result = await apiWrapper('edit', editParams);

      console.log('图像编辑结果:', result.success ? '成功' : '失败');
      return result;
    } catch (error) {
      console.error('图像编辑异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  // 3、注册配置合并及有效性查询。
  ipcMain.handle('fal-get-config', async (event, userConfig = {}) => {
    try {
      const config = getConfig(userConfig);
      const validation = validateConfig(config);

      return {
        success: true,
        data: {
          config: config,
          isValid: validation.isValid,
          errors: validation.errors
        }
      };
    } catch (error) {
      console.error('获取配置异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  // 4、注册单张图片校验及信息查询。
  ipcMain.handle('fal-validate-image', async (event, imagePath) => {
    try {
      const isValid = validateImageFile(imagePath);
      let imageInfo = null;

      if (isValid) {
        imageInfo = getImageInfo(imagePath);
      }

      return {
        success: true,
        data: {
          isValid: isValid,
          imageInfo: imageInfo
        }
      };
    } catch (error) {
      console.error('校验图片异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  // 5、注册批量图片校验。
  ipcMain.handle('fal-validate-images', async (event, imagePaths) => {
    try {
      const results = [];

      for (const imagePath of imagePaths) {
        const isValid = validateImageFile(imagePath);
        let imageInfo = null;

        if (isValid) {
          imageInfo = getImageInfo(imagePath);
        }

        results.push({
          path: imagePath,
          isValid: isValid,
          imageInfo: imageInfo
        });
      }

      return {
        success: true,
        data: results
      };
    } catch (error) {
      console.error('批量校验图片异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  // 6、注册输出和日志目录创建入口。
  ipcMain.handle('fal-create-directories', async (event, config = {}) => {
    try {
      const fullConfig = getConfig(config);
      createDefaultDirectories(fullConfig);

      return {
        success: true,
        message: '目录创建成功',
        data: {
          outputDir: fullConfig.outputDir,
          editOutputDir: fullConfig.editOutputDir,
          logDir: fullConfig.logDir
        }
      };
    } catch (error) {
      console.error('创建目录异常:', error);
      return {
        success: false,
        message: error.message,
        error: error.toString()
      };
    }
  });

  console.log('✅ gemini-image IPC 处理器注册完成（兼容 fal-* 通道）');
}

/**
 * 注销 Gemini 图像相关的 IPC 处理器
 * 依旧以 unregisterFalApiHandlers 的名称对外暴露。
 * 处理流程：
 * 1、收集本模块使用的通道名称。
 * 2、逐通道清理事件监听器。
 */
export function unregisterFalApiHandlers() {
  // 1、准备需要清理的兼容通道列表。
  console.log('注销 Gemini 图像 IPC 处理器...');

  const handlers = [
    'fal-generate-image',
    'fal-edit-image',
    'fal-get-config',
    'fal-validate-image',
    'fal-validate-images',
    'fal-create-directories'
  ];

  // 2、按现有实现移除通道监听器。
  handlers.forEach((handler) => {
    ipcMain.removeAllListeners(handler);
  });

  console.log('✅ gemini-image IPC 处理器注销完成');
}
