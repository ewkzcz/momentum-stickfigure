/**
 * gemini-image-api 业务主入口模块
 *
 * 说明：
 * - 内部调用 `gemini-image-client` 发送 HTTP 请求；
 * - 同时复用 `gemini-image-utils` 进行图片的本地读取与 base64 转换；
 */

import {
  uploadImageToBase64,
  batchUploadImagesToBase64
} from './gemini-image-utils.js';
import { generateImage, editImage } from './gemini-image-client.js';

/**
 * 图像生成功能封装
 * 处理流程：
 * 1、检查密钥与提示词，按需设置宽高比。
 * 2、调用生成客户端并返回图片地址，统一补充失败上下文。
 * @param {string} prompt 文本提示词
 * @param {string} apiKey API 密钥
 * @param {string} baseUrl 服务地址
 * @param {number} timeoutMinutes 超时时间（分钟）
 * @param {string} model 模型名称
 * @param {string} logPath 日志路径
 * @param {string} savePath 输出目录
 * @param {string} aspectRatio 宽高比
 * @returns {Promise<Array<string>>} 图片 URL 列表
 */
export async function mainGenerate(
  prompt,
  apiKey,
  baseUrl,
  timeoutMinutes,
  model,
  logPath,
  savePath = './output',
  // 默认不指定宽高比：当为 undefined 时表示“原始尺寸（不传参）”
  aspectRatio = undefined
) {
  // 1、校验请求所需的密钥和提示词。
  if (!apiKey || apiKey === 'your_api_key_here') {
    const error = '请先在设置中配置正确的 API_KEY';
    console.error(error);
    throw new Error(error);
  }

  if (!prompt) {
    const error = '未提供有效的提示词';
    console.error(error);
    throw new Error(error);
  }

  console.log('开始 Gemini 图像生成任务');
  console.log(`提示词: ${prompt}`);
  console.log(
    `宽高比: ${aspectRatio ? aspectRatio : '原始尺寸（不传参）'}`
  );
  console.log(`输出目录: ${savePath}`);

  try {
    // 2、仅在明确指定宽高比时传递该选项。
    const clientOptions = aspectRatio ? { aspectRatio } : {};

    const imageUrls = await generateImage(
      prompt,
      apiKey,
      baseUrl,
      timeoutMinutes,
      model,
      logPath,
      savePath,
      clientOptions
    );

    console.log(`✅ 生成成功，共生成 ${imageUrls.length} 张图片`);
    imageUrls.forEach((url, i) => {
      console.log(`图片 ${i + 1}: ${url}`);
    });

    return imageUrls;
  } catch (error) {
    const errorMsg = `❌ 生成失败: ${error.message}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * 图像编辑功能封装
 * 处理流程：
 * 1、校验密钥、提示词及输入图片。
 * 2、将原始图片转为数据地址，调用编辑客户端并返回结果。
 * @param {string} prompt 编辑说明
 * @param {string} apiKey API 密钥
 * @param {string} baseUrl 服务地址
 * @param {number} timeoutMinutes 超时时间（分钟）
 * @param {string} model 模型名称
 * @param {string} logPath 日志路径
 * @param {string} savePath 输出目录
 * @param {Array<string>} inputImages 原始图片路径列表
 * @param {string} aspectRatio 宽高比
 * @returns {Promise<Array<string>>} 编辑后的图片 URL 列表
 */
export async function mainEdit(
  prompt,
  apiKey,
  baseUrl,
  timeoutMinutes,
  model,
  logPath,
  savePath = './output',
  inputImages = null,
  aspectRatio = undefined
) {
  // 1、校验密钥、编辑说明及原始图片集合。
  if (!apiKey || apiKey === 'your_api_key_here') {
    const error = '请先在设置中配置正确的 API_KEY';
    console.error(error);
    throw new Error(error);
  }

  if (!prompt) {
    const error = '未提供有效的编辑提示词';
    console.error(error);
    throw new Error(error);
  }

  // 校验输入图片
  if (!inputImages || inputImages.length === 0) {
    const error = '进行图片编辑时至少需要提供一张原始图片';
    console.error(error);
    throw new Error(error);
  }

  console.log('开始 Gemini 图像编辑任务');
  console.log(`提示词: ${prompt}`);
  console.log(`输入图片数量: ${inputImages.length} 张`);
  console.log(
    `宽高比: ${aspectRatio ? aspectRatio : '原始尺寸（不传参）'}`
  );
  console.log(`输出目录: ${savePath}`);

  try {
    // 2、先将本地图片批量转换成数据地址，再调用编辑接口。
    console.log('开始转换原始图片为 base64...');
    const imageUrls = await batchUploadImagesToBase64(inputImages);

    console.log('图片转换完成，开始调用编辑接口...');

    const clientOptions = aspectRatio ? { aspectRatio } : {};

    const editedUrls = await editImage(
      prompt,
      imageUrls,
      apiKey,
      baseUrl,
      timeoutMinutes,
      model,
      logPath,
      savePath,
      clientOptions
    );

    console.log(`✅ 图片编辑成功，共输出 ${editedUrls.length} 张图片`);
    editedUrls.forEach((url, i) => {
      console.log(`  编辑结果 ${i + 1}: ${url}`);
    });

    return editedUrls;
  } catch (error) {
    const errorMsg = `❌ 编辑失败: ${error.message}`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * 统一 API 包装函数（供 IPC 层调用）
 * 处理流程：
 * 1、提取配置并按操作类型分派生成或编辑。
 * 2、将图片结果或异常统一转换为 IPC 返回结构。
 * @param {'generate'|'edit'} action 操作类型
 * @param {Object} config 参数配置
 * @returns {Promise<{success:boolean,data:any,message:string,error?:string}>}
 */
export async function apiWrapper(action, config) {
  // 1、提取调用参数，随后按操作类型分派。
  const {
    prompt,
    apiKey,
    baseUrl,
    timeoutMinutes,
    model,
    logPath,
    savePath,
    aspectRatio,
    inputImages
  } = config;

  try {
    let result;

    if (action === 'generate') {
      result = await mainGenerate(
        prompt,
        apiKey,
        baseUrl,
        timeoutMinutes,
        model,
        logPath,
        savePath,
        aspectRatio
      );
    } else if (action === 'edit') {
      result = await mainEdit(
        prompt,
        apiKey,
        baseUrl,
        timeoutMinutes,
        model,
        logPath,
        savePath,
        inputImages,
        aspectRatio
      );
    } else {
      throw new Error(`不支持的操作类型: ${action}`);
    }

    // 2、将业务结果包装为统一成功载荷。
    return {
      success: true,
      data: result,
      message: '请求成功'
    };
  } catch (error) {
    return {
      success: false,
      data: null,
      message: error.message,
      error: error.toString()
    };
  }
}

export default {
  mainGenerate,
  mainEdit,
  apiWrapper
};
