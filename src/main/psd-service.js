/**
 * PSD 服务 - Electron主进程服务层
 * 处理PSD相关的IPC通信和API调用
 */

import { app, ipcMain } from 'electron';
import path from 'path';

// 动态导入PSD API
let psdApi = null;
let logger = null;

/**
 * 按需加载 PSD API 并复用模块实例。
 * 处理流程：
 * 1、首次调用时动态导入模块。
 * 2、在应用数据目录创建日志器并返回缓存模块。
 */
async function loadPSDApi() {
    // 1、已加载时复用缓存，首次加载失败继续向调用方抛出。
    if (!psdApi) {
        try {
            // 动态导入ES6模块
            const api = await import('./psd-api/index.js');
            psdApi = api;
            
            // 2、日志始终写入应用数据目录。
            if (!logger) {
                logger = new api.Logger(path.join(app.getPath('userData'), 'logs', 'psd-api.log'));
            }
            
            console.log('PSD API 模块加载成功');
        } catch (error) {
            console.error('加载PSD API模块失败:', error);
            throw error;
        }
    }
    return psdApi;
}

/**
 * 注册所有PSD相关的IPC处理器
 * 处理流程：
 * 1、预加载解析模块，再注册解析、渲染和组件检测入口。
 * 2、注册文件信息、有效性和配置查询，返回带耗时的统一结果。
 */
async function registerPSDApiHandlers() {
    console.log('注册 PSD API IPC 处理器...');
    
    // 1、尝试预加载模块，失败时仍注册接口以便后续重试。
    try {
        await loadPSDApi();
        console.log('PSD API 预加载成功');
    } catch (error) {
        console.error('PSD API 预加载失败:', error);
    }

    // 2、注册 PSD 文件解析入口。
    ipcMain.handle('psd-parse-file', async (event, options) => {
        const startTime = Date.now();
        let requestId = `psd-parse-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log(`收到PSD解析请求，参数:`, { 
                ...options, 
                fileBuffer: options.fileBuffer ? `Buffer(${options.fileBuffer.length} bytes)` : 'undefined' 
            });
            
            // 验证参数
            if (!options.fileBuffer) {
                throw new Error(api.PSD_ERROR_MESSAGES.INVALID_FILE_BUFFER);
            }
            
            // 调用PSD解析API
            const result = await api.psdApiWrapper('parse', {
                fileBuffer: options.fileBuffer,
                options: options.parseOptions || {}
            });
            
            logger?.info(`PSD解析完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('PSD解析失败:', error);
            logger?.error('PSD解析失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    // 3、注册 PSD 图层渲染入口。
    ipcMain.handle('psd-render-layers', async (event, options) => {
        const startTime = Date.now();
        let requestId = `psd-render-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log('收到PSD渲染请求:', requestId);
            
            const result = await api.psdApiWrapper('render', {
                psdData: options.psdData,
                options: options.renderOptions || {}
            });
            
            logger?.info(`PSD渲染完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('PSD渲染失败:', error);
            logger?.error('PSD渲染失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    // 4、注册 PSD 组件检测入口。
    ipcMain.handle('psd-detect-components', async (event, options) => {
        const startTime = Date.now();
        let requestId = `psd-detect-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log('收到PSD组件检测请求:', requestId);
            
            const result = await api.psdApiWrapper('detect', {
                psdData: options.psdData,
                options: options.detectionOptions || {}
            });
            
            logger?.info(`PSD组件检测完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('PSD组件检测失败:', error);
            logger?.error('PSD组件检测失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    // 5、注册 PSD 头部信息查询。
    ipcMain.handle('psd-get-info', async (event, options) => {
        const startTime = Date.now();
        let requestId = `psd-info-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log('收到PSD信息请求:', requestId);
            
            const result = await api.getPSDInfo(options.fileBuffer);
            
            logger?.info(`PSD信息获取完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('获取PSD信息失败:', error);
            logger?.error('获取PSD信息失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    // 6、注册 PSD 文件有效性检查。
    ipcMain.handle('psd-validate-file', async (event, options) => {
        const startTime = Date.now();
        let requestId = `psd-validate-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log('收到PSD验证请求:', requestId);
            
            const result = await api.validatePSDFile(options.fileBuffer);
            
            logger?.info(`PSD验证完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: result,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('PSD验证失败:', error);
            logger?.error('PSD验证失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    // 7、注册配置查询并准备必要目录。
    ipcMain.handle('psd-get-config', async (event, options = {}) => {
        const startTime = Date.now();
        let requestId = `psd-config-${Date.now()}`;
        
        try {
            const api = await loadPSDApi();
            console.log('收到PSD配置请求:', requestId);
            
            const config = api.getPSDConfig(options);
            const validation = api.validatePSDConfig(config);
            
            // 确保必要目录存在
            api.createDefaultPSDDirectories(config);
            
            logger?.info(`PSD配置获取完成，耗时: ${Date.now() - startTime}ms`);
            
            return {
                success: true,
                data: {
                    config,
                    validation,
                    constants: {
                        API_CONFIG: api.PSD_API_CONFIG,
                        PARSE_DEFAULTS: api.PSD_PARSE_DEFAULTS,
                        STATUS: api.PSD_STATUS,
                        ERROR_MESSAGES: api.PSD_ERROR_MESSAGES
                    }
                },
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };

        } catch (error) {
            console.error('获取PSD配置失败:', error);
            logger?.error('获取PSD配置失败', { error: error.message, requestId });
            
            return {
                success: false,
                status: 'error',
                message: error.message,
                timestamp: new Date().toISOString(),
                requestId,
                processingTime: Date.now() - startTime
            };
        }
    });

    console.log('PSD API IPC 处理器注册完成');
}

/**
 * 注销所有PSD相关的IPC处理器
 * 处理流程：
 * 1、列出 PSD 服务通道。
 * 2、按现有监听计数判断移除处理器。
 */
function unregisterPSDApiHandlers() {
    // 1、准备本模块通道清单。
    console.log('注销 PSD API IPC 处理器...');
    
    const handlers = [
        'psd-parse-file',
        'psd-render-layers', 
        'psd-detect-components',
        'psd-get-info',
        'psd-validate-file',
        'psd-get-config'
    ];
    
    // 2、逐项检查监听计数并清理对应处理器。
    handlers.forEach(handler => {
        if (ipcMain.listenerCount(`handle:${handler}`) > 0) {
            ipcMain.removeHandler(handler);
        }
    });
    
    console.log('PSD API IPC 处理器注销完成');
}

/**
 * 获取PSD服务状态
 * 处理流程：
 * 1、尝试加载 PSD 模块。
 * 2、返回模块状态、版本与时间；失败时返回错误信息。
 */
async function getPSDServiceStatus() {
    // 1、通过实际模块加载结果生成状态快照。
    try {
        const api = await loadPSDApi();
        return {
            loaded: !!api,
            apiVersion: api?.PSD_API_CONFIG?.VERSION || 'unknown',
            status: api ? 'active' : 'inactive',
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        return {
            loaded: false,
            status: 'error',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

export {
    registerPSDApiHandlers,
    unregisterPSDApiHandlers,
    getPSDServiceStatus
};
