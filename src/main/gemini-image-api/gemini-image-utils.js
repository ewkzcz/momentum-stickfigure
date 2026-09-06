/**
 * gemini-image-api 工具函数模块
 */

import fs from 'fs';
import path from 'path';

/**
 * 将本地图片读取为 base64 DataURL
 * 处理流程：
 * 1、检查文件并读取为 Base64 内容。
 * 2、依据扩展名选择媒体类型并组成数据地址。
 * @param {string} imagePath 图片文件路径
 * @returns {Promise<string>} base64 DataURL 字符串
 */
export async function uploadImageToBase64(imagePath) {
  // 1、确认文件存在后读取图片字节。
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`图片文件不存在: ${imagePath}`);
    }

    const imageBuffer = fs.readFileSync(imagePath);
    const imageB64 = imageBuffer.toString('base64');

    // 2、根据扩展名推断媒体类型，未知格式沿用 PNG。
    const ext = path.extname(imagePath).toLowerCase();
    let mimeType = 'image/png';

    switch (ext) {
      case '.jpg':
      case '.jpeg':
        mimeType = 'image/jpeg';
        break;
      case '.png':
        mimeType = 'image/png';
        break;
      case '.gif':
        mimeType = 'image/gif';
        break;
      case '.webp':
        mimeType = 'image/webp';
        break;
      case '.bmp':
        mimeType = 'image/bmp';
        break;
      default:
        mimeType = 'image/png';
    }

    return `data:${mimeType};base64,${imageB64}`;
  } catch (error) {
    throw new Error(`图片转换失败: ${error.message}`);
  }
}

/**
 * 准备图片（目前主要做体积检查，预留压缩扩展点）
 * 处理流程：
 * 1、读取文件大小，对超过阈值的图片提示建议。
 * 2、保持原始图片路径，不执行压缩。
 * @param {string} imagePath 图片文件路径
 * @returns {Promise<string>} 返回可用于后续处理的图片路径
 */
async function _prepareImage(imagePath) {
  // 1、检查体积是否超过建议阈值。
  const maxSize = 10 * 1024 * 1024; // 10MB
  const stats = fs.statSync(imagePath);

  // 检查文件大小
  if (stats.size > maxSize) {
    console.warn(
      `警告: 图片文件过大 (${(stats.size / 1024 / 1024).toFixed(2)}MB)，可能影响上传速度`
    );
    console.warn('建议安装 sharp 对图片进行压缩: npm install sharp');

    // 目前未进行任何压缩，避免降低图像质量
    return imagePath;
  }

  // 2、文件体积正常，直接返回原始路径。
  return imagePath;
}

/**
 * 批量将本地图片转换为 base64 DataURL
 * 处理流程：
 * 1、按输入顺序逐张读取转换。
 * 2、汇总数据地址，任一图片失败时立即抛出异常。
 * @param {Array<string>} imagePaths 图片路径数组
 * @returns {Promise<Array<string>>} base64 DataURL 数组
 */
export async function batchUploadImagesToBase64(imagePaths) {
  // 1、顺序转换图片，保持返回结果与输入顺序一致。
  const results = [];

  for (let i = 0; i < imagePaths.length; i++) {
    try {
      const base64Url = await uploadImageToBase64(imagePaths[i]);
      results.push(base64Url);
      console.log(`图片转换成功 ${i + 1}/${imagePaths.length}: ${imagePaths[i]}`);
    } catch (error) {
      console.error(
        `图片转换失败 ${i + 1}/${imagePaths.length}: ${imagePaths[i]} - ${error.message}`
      );
      // 任意一张失败即抛出异常，保持与旧实现一致
      throw error;
    }
  }

  // 2、全部转换完成后返回结果集合。
  return results;
}

/**
 * 校验指定路径是否为有效的图片文件
 * 处理流程：
 * 1、检查文件存在性和支持的扩展名。
 * 2、确认文件非空，异常时返回无效结果。
 * @param {string} imagePath 图片文件路径
 * @returns {boolean} 是否为有效图片
 */
export function validateImageFile(imagePath) {
  try {
    // 1、检查文件是否存在。
    if (!fs.existsSync(imagePath)) {
      return false;
    }

    // 2、检查扩展名是否受支持。
    const ext = path.extname(imagePath).toLowerCase();
    const validExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];

    if (!validExtensions.includes(ext)) {
      return false;
    }

    // 3、检查文件是否为空。
    const stats = fs.statSync(imagePath);
    if (stats.size === 0) {
      return false;
    }

    return true;
  } catch (error) {
    return false;
  }
}

/**
 * 获取图片的基本信息（体积、扩展名等）
 * 处理流程：
 * 1、确认文件存在并读取文件状态。
 * 2、汇总名称、容量、时间及有效性。
 * @param {string} imagePath 图片文件路径
 * @returns {Object} 图片信息对象
 */
export function getImageInfo(imagePath) {
  // 1、读取文件状态及路径信息。
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error(`图片文件不存在: ${imagePath}`);
    }

    const stats = fs.statSync(imagePath);
    const ext = path.extname(imagePath).toLowerCase();
    const filename = path.basename(imagePath);

    // 2、返回元信息及基础文件校验结果。
    return {
      path: imagePath,
      filename: filename,
      extension: ext,
      size: stats.size,
      sizeInMB: (stats.size / 1024 / 1024).toFixed(2),
      modified: stats.mtime,
      isValid: validateImageFile(imagePath)
    };
  } catch (error) {
    throw new Error(`获取图片信息失败: ${error.message}`);
  }
}

export default {
  uploadImageToBase64,
  batchUploadImagesToBase64,
  validateImageFile,
  getImageInfo
};
