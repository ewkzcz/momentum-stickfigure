/**
 * PSD API 模块入口
 * 统一导出所有PSD处理功能
 */

// 主要API功能
import { mainParsePSD, mainRenderPSD, mainDetectComponents, psdApiWrapper } from './main_api.js';

// 核心客户端
import { parsePSD, renderPSDLayers, detectComponents, validatePSDFile, getPSDInfo } from './psd_client.js';

// 工具函数
import { 
    readFileAsBuffer, 
    saveBufferToFile, 
    ensureDirectoryExists,
    getFileInfo,
    validateFileExtension,
    generateUniqueFileName,
    cleanupTempFiles,
    formatFileSize,
    generateFileHash,
    checkDiskSpace,
    createBackupFile,
    Logger 
} from './psd_utils.js';

// 配置和常量
import { 
    getPSDConfig, 
    validatePSDConfig, 
    createDefaultPSDDirectories,
    PSD_API_CONFIG,
    PSD_PARSE_DEFAULTS,
    IMAGE_COMPOSE_DEFAULTS,
    COMPONENT_DETECTION_CONFIG,
    PSD_STATUS,
    PSD_ERROR_MESSAGES,
    PSD_PATH_CONFIG,
    PSD_MIME_TYPES,
    getFileExtension,
    isSupportedPSDFile
} from './config.js';

export {
    // 主要API入口
    mainParsePSD,
    mainRenderPSD,
    mainDetectComponents,
    psdApiWrapper,
    
    // 核心功能
    parsePSD,
    renderPSDLayers,
    detectComponents,
    validatePSDFile,
    getPSDInfo,
    
    // 文件处理
    readFileAsBuffer,
    saveBufferToFile,
    ensureDirectoryExists,
    getFileInfo,
    validateFileExtension,
    generateUniqueFileName,
    cleanupTempFiles,
    formatFileSize,
    generateFileHash,
    checkDiskSpace,
    createBackupFile,
    
    // 配置管理
    getPSDConfig,
    validatePSDConfig,
    createDefaultPSDDirectories,
    getFileExtension,
    isSupportedPSDFile,
    
    // 常量
    PSD_API_CONFIG,
    PSD_PARSE_DEFAULTS,
    IMAGE_COMPOSE_DEFAULTS,
    COMPONENT_DETECTION_CONFIG,
    PSD_STATUS,
    PSD_ERROR_MESSAGES,
    PSD_PATH_CONFIG,
    PSD_MIME_TYPES,
    
    // 工具类
    Logger
};
