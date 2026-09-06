/**
 * PSD API 主入口
 * 提供PSD处理的主要API入口
 */

import { getPSDConfig, validatePSDConfig, createDefaultPSDDirectories, PSD_ERROR_MESSAGES, PSD_STATUS } from './config.js';
import { parsePSD, renderPSDLayers, detectComponents } from './psd_client.js';

/**
 * PSD文件解析入口
 * 处理流程：
 * 1、合并配置并检查文件缓冲区和大小。
 * 2、准备目录后执行解析，返回解析结果或失败状态。
 * @param {Buffer|ArrayBuffer} fileBuffer - PSD文件缓冲区
 * @param {object} options - 解析选项
 * @returns {Promise<object>} 解析结果
 */
async function mainParsePSD(fileBuffer, options = {}) {
    // 1、获取并验证解析配置。
    const config = getPSDConfig(options);
    const validation = validatePSDConfig(config);
    
    if (!validation.valid) {
        const error = validation.errors.join(', ');
        console.error('PSD配置验证失败:', error);
        throw new Error(error);
    }
    
    if (validation.warnings.length > 0) {
        console.warn('PSD配置警告:', validation.warnings.join(', '));
    }
    
    // 2、检查文件缓冲区及大小限制。
    if (!fileBuffer) {
        const error = PSD_ERROR_MESSAGES.INVALID_FILE;
        console.error(error);
        throw new Error(error);
    }
    
    // 检查文件大小
    const fileSize = fileBuffer.byteLength || fileBuffer.length;
    if (fileSize > config.MAX_FILE_SIZE) {
        const error = `${PSD_ERROR_MESSAGES.FILE_TOO_LARGE}: ${Math.round(fileSize / 1024 / 1024)}MB`;
        console.error(error);
        throw new Error(error);
    }
    
    console.log('开始PSD文件解析任务');
    console.log(`文件大小: ${Math.round(fileSize / 1024)}KB`);
    console.log(`解析选项:`, config.parseDefaults);
    
    try {
        // 3、创建必要目录并执行带超时约束的解析。
        createDefaultPSDDirectories(config);
        
        // 执行PSD解析
        const result = await parsePSD(
            fileBuffer,
            config.parseDefaults,
            config.PROCESSING_TIMEOUT
        );
        
        console.log('PSD文件解析完成');
        console.log(`解析出 ${result.layerCount || 0} 个图层`);
        console.log(`尺寸: ${result.width}×${result.height}`);
        
        return {
            success: true,
            status: PSD_STATUS.PARSED,
            data: result,
            metadata: {
                fileSize,
                parseTime: Date.now(),
                config: config.parseDefaults
            }
        };
        
    } catch (error) {
        console.error('PSD解析失败:', error);
        return {
            success: false,
            status: PSD_STATUS.ERROR,
            error: error.message,
            errorCode: 'PARSE_FAILED'
        };
    }
}

/**
 * PSD图层渲染入口
 * 处理流程：
 * 1、合并渲染配置并检查图层数据。
 * 2、执行图层合成，统一返回图像或渲染错误。
 * @param {object} psdData - 解析后的PSD数据
 * @param {object} renderOptions - 渲染选项
 * @returns {Promise<object>} 渲染结果
 */
async function mainRenderPSD(psdData, renderOptions = {}) {
    // 1、获取渲染配置并检查图层层级。
    const config = getPSDConfig({ composeOptions: renderOptions });
    const validation = validatePSDConfig(config);
    
    if (!validation.valid) {
        const error = validation.errors.join(', ');
        console.error('渲染配置验证失败:', error);
        throw new Error(error);
    }
    
    // 检查PSD数据
    if (!psdData || !psdData.layerHierarchy) {
        const error = PSD_ERROR_MESSAGES.NO_LAYERS_FOUND;
        console.error(error);
        throw new Error(error);
    }
    
    console.log('开始PSD图层渲染任务');
    console.log(`目标尺寸: ${renderOptions.width || config.composeDefaults.width}×${renderOptions.height || config.composeDefaults.height}`);
    console.log(`输出格式: ${renderOptions.format || config.composeDefaults.format}`);
    
    try {
        // 2、执行带超时约束的图层渲染。
        const result = await renderPSDLayers(
            psdData,
            config.composeDefaults,
            config.RENDER_TIMEOUT
        );
        
        console.log('PSD渲染完成');
        console.log(`生成图像: ${result.width}×${result.height}`);
        
        return {
            success: true,
            status: PSD_STATUS.COMPLETED,
            data: result,
            metadata: {
                renderTime: Date.now(),
                config: config.composeDefaults
            }
        };
        
    } catch (error) {
        console.error('PSD渲染失败:', error);
        return {
            success: false,
            status: PSD_STATUS.ERROR,
            error: error.message,
            errorCode: 'RENDER_FAILED'
        };
    }
}

/**
 * 组件自动检测入口
 * 处理流程：
 * 1、取得检测配置并检查图层层级。
 * 2、执行组件分类并返回结果和检测元信息。
 * @param {object} psdData - 解析后的PSD数据
 * @param {object} options - 检测选项
 * @returns {Promise<object>} 检测结果
 */
async function mainDetectComponents(psdData, options = {}) {
    // 1、取得配置并检查待检测图层。
    const config = getPSDConfig(options);
    
    // 检查PSD数据
    if (!psdData || !psdData.layerHierarchy) {
        const error = PSD_ERROR_MESSAGES.NO_LAYERS_FOUND;
        console.error(error);
        throw new Error(error);
    }
    
    console.log('开始组件自动检测任务');
    console.log(`检测图层数量: ${psdData.layerHierarchy.length}`);
    
    try {
        // 2、按关键词配置执行组件分类。
        const result = await detectComponents(
            psdData.layerHierarchy,
            config.detection
        );
        
        console.log('组件检测完成');
        console.log(`检测到前手: ${result.frontHand.length} 个`);
        console.log(`检测到后手: ${result.backHand.length} 个`);
        console.log(`检测到表情: ${result.expression.length} 个`);
        
        return {
            success: true,
            status: PSD_STATUS.COMPLETED,
            data: result,
            metadata: {
                detectionTime: Date.now(),
                totalLayers: psdData.layerHierarchy.length
            }
        };
        
    } catch (error) {
        console.error('组件检测失败:', error);
        return {
            success: false,
            status: PSD_STATUS.ERROR,
            error: error.message,
            errorCode: 'DETECTION_FAILED'
        };
    }
}

/**
 * API包装器 - 统一错误处理和日志记录
 * 处理流程：
 * 1、记录开始时间，按操作类型分派业务入口。
 * 2、为成功或异常结果补充耗时及操作名称。
 * @param {string} operation - 操作类型
 * @param {object} params - 操作参数
 * @returns {Promise<object>} 操作结果
 */
async function psdApiWrapper(operation, params) {
    // 1、记录计时起点并按操作分派。
    const startTime = Date.now();
    
    try {
        console.log(`开始执行PSD操作: ${operation}`);
        
        let result;
        switch (operation) {
            case 'parse':
                result = await mainParsePSD(params.fileBuffer, params.options);
                break;
            case 'render':
                result = await mainRenderPSD(params.psdData, params.options);
                break;
            case 'detect':
                result = await mainDetectComponents(params.psdData, params.options);
                break;
            default:
                throw new Error(`未知操作类型: ${operation}`);
        }
        
        // 2、附加耗时及操作名称，保留业务结果状态。
        const duration = Date.now() - startTime;
        console.log(`PSD操作完成: ${operation}, 耗时: ${duration}ms`);
        
        return {
            ...result,
            duration,
            operation
        };
        
    } catch (error) {
        const duration = Date.now() - startTime;
        console.error(`PSD操作失败: ${operation}, 耗时: ${duration}ms, 错误:`, error.message);
        
        return {
            success: false,
            status: PSD_STATUS.ERROR,
            error: error.message,
            operation,
            duration
        };
    }
}

export {
    mainParsePSD,
    mainRenderPSD,
    mainDetectComponents,
    psdApiWrapper
};
