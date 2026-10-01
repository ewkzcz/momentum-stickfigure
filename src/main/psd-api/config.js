/**
 * PSD API 配置文件
 * 包含PSD处理相关配置、默认参数和常量定义
 */

import path from 'path';
import fs from 'node:fs';
import { app } from 'electron';
import { COMPONENT_DETECTION_CONFIG, PSD_ERROR_MESSAGES } from './psd-constants.mjs';

/**
 * PSD API配置常量
 */
const PSD_API_CONFIG = {
    // PSD处理配置
    MAX_FILE_SIZE: 50 * 1024 * 1024, // 50MB
    SUPPORTED_EXTENSIONS: ['.psd', '.psb'],
    
    // 解析选项
    PARSE_OPTIONS: {
        parseImages: true,
        parseChannelData: false,
        validateFile: true,
        extractThumbnails: true,
        processLayers: true
    },
    
    // 渲染配置
    RENDER_CONFIG: {
        defaultWidth: 800,
        defaultHeight: 600,
        maxWidth: 4096,
        maxHeight: 4096,
        quality: 0.9,
        format: 'png'
    },
    
    // 缓存配置
    CACHE_CONFIG: {
        maxCacheSize: 100 * 1024 * 1024, // 100MB
        maxCacheItems: 50,
        cacheTimeout: 30 * 60 * 1000 // 30分钟
    },
    
    // 处理超时时间
    PROCESSING_TIMEOUT: 60000, // 60秒
    PARSE_TIMEOUT: 30000, // 30秒
    RENDER_TIMEOUT: 45000 // 45秒
};

/**
 * PSD处理默认参数
 */
const PSD_PARSE_DEFAULTS = {
    validateFile: true,
    parseImages: true,
    parseChannelData: false,
    extractThumbnails: false,
    processLayers: true,
    autoDetectComponents: true
};

/**
 * 图像合成默认参数
 */
const IMAGE_COMPOSE_DEFAULTS = {
    width: 800,
    height: 600,
    background: 'transparent',
    quality: 0.9,
    format: 'png'
};

/**
 * 状态常量
 */
const PSD_STATUS = {
    LOADING: 'loading',
    PARSING: 'parsing',
    PARSED: 'parsed',
    PROCESSING: 'processing',
    COMPLETED: 'completed',
    ERROR: 'error',
    CANCELLED: 'cancelled'
};

/**
 * 路径配置
 */
const PSD_PATH_CONFIG = {
    // 默认路径
    DEFAULT_TEMP_DIR: path.join(app.getPath('userData'), 'temp', 'psd'),
    DEFAULT_CACHE_DIR: path.join(app.getPath('userData'), 'cache', 'psd'),
    DEFAULT_OUTPUT_DIR: path.join(app.getPath('userData'), 'output', 'psd'),
    
    // 文件命名模式
    TEMP_FILE_PREFIX: 'psd_temp_',
    CACHE_FILE_PREFIX: 'psd_cache_',
    OUTPUT_FILE_PREFIX: 'psd_output_',
    
    // 支持的文件格式
    SUPPORTED_OUTPUT_FORMATS: ['.png', '.jpg', '.jpeg', '.webp']
};

/**
 * MIME类型映射
 */
const PSD_MIME_TYPES = {
    '.psd': 'application/photoshop',
    '.psb': 'application/photoshop',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp'
};

/** 目录只能采用主进程默认值；空值兼容旧表单，但不产生自定义目录授权。 */
function assertFixedPSDDirectories(config) {
    for (const [field, constant] of [
        ['tempDir', 'DEFAULT_TEMP_DIR'],
        ['cacheDir', 'DEFAULT_CACHE_DIR'],
        ['outputDir', 'DEFAULT_OUTPUT_DIR']
    ]) {
        for (const key of [field, constant]) {
            const value = config[key];
            if (value !== undefined && value !== null && value !== '' && value !== PSD_PATH_CONFIG[constant]) {
                throw new Error(`PSD目录未授权：${key}只能使用应用默认目录`);
            }
        }
    }
}

/**
 * 获取PSD配置：保留非目录选项，目录常量和显式目录字段均由主进程固定。
 */
function getPSDConfig(options = {}) {
    assertFixedPSDDirectories(options);
    const config = {
        ...PSD_API_CONFIG,
        ...PSD_PATH_CONFIG,
        parseDefaults: { ...PSD_PARSE_DEFAULTS, ...options.parseOptions },
        composeDefaults: { ...IMAGE_COMPOSE_DEFAULTS, ...options.composeOptions },
        detection: COMPONENT_DETECTION_CONFIG,
        ...options,
        DEFAULT_TEMP_DIR: PSD_PATH_CONFIG.DEFAULT_TEMP_DIR,
        DEFAULT_CACHE_DIR: PSD_PATH_CONFIG.DEFAULT_CACHE_DIR,
        DEFAULT_OUTPUT_DIR: PSD_PATH_CONFIG.DEFAULT_OUTPUT_DIR
    };
    for (const [field, constant] of [
        ['tempDir', 'DEFAULT_TEMP_DIR'],
        ['cacheDir', 'DEFAULT_CACHE_DIR'],
        ['outputDir', 'DEFAULT_OUTPUT_DIR']
    ]) {
        if (Object.prototype.hasOwnProperty.call(options, field)) config[field] = PSD_PATH_CONFIG[constant];
    }
    return config;
}

/**
 * 验证PSD配置
 * 处理流程：
 * 1、对较大文件和渲染尺寸生成性能警告。
 * 2、规范输出路径并返回有效性、警告及配置。
 * @param {object} config - 配置对象
 * @returns {object} 验证结果
 */
function validatePSDConfig(config) {
    // 1、收集体积与尺寸超出建议值的警告。
    const errors = [];
    const warnings = [];
    
    // 验证文件大小限制
    if (config.maxFileSize && config.maxFileSize > 100 * 1024 * 1024) {
        warnings.push('文件大小限制超过100MB，可能导致性能问题');
    }
    
    // 验证渲染尺寸
    if (config.renderWidth && config.renderWidth > 4096) {
        warnings.push('渲染宽度超过4096px，可能导致内存问题');
    }
    
    if (config.renderHeight && config.renderHeight > 4096) {
        warnings.push('渲染高度超过4096px，可能导致内存问题');
    }
    
    // 2、将相对输出路径转换为绝对路径。
    if (config.outputDir && !path.isAbsolute(config.outputDir)) {
        config.outputDir = path.resolve(config.outputDir);
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        config
    };
}

/**
 * 准备固定的应用目录：全部预检通过后才创建，创建后复核，任何失败交给调用方处理。
 * 第二参数仅由主进程传入共享路径检查器；原样复制的 PSD API 不依赖未复制的模块。
 */
function createDefaultPSDDirectories(config, assertOwnedPath) {
    assertFixedPSDDirectories(config);
    const root = app.getPath('userData');
    const directories = ['temp', 'cache', 'output'].map(parent => [parent, 'psd']);
    const canonicalRoot = fs.realpathSync(root);
    const checkDirectory = (segments) => {
        if (assertOwnedPath) assertOwnedPath(root, segments);
        let current = root;
        for (const segment of segments) {
            current = path.join(current, segment);
            try {
                const stat = fs.lstatSync(current);
                if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('PSD默认目录必须是非符号链接目录');
            } catch (error) {
                if (error.code !== 'ENOENT') throw error;
            }
        }
        if (fs.realpathSync(root) !== canonicalRoot) throw new Error('PSD应用目录已发生变化');
        return current;
    };

    // 包括尚未创建的目录和已存在的父分量，不能创建前一个目录后才发现后一个链接。
    directories.forEach(checkDirectory);
    for (const segments of directories) {
        const directory = checkDirectory(segments);
        fs.mkdirSync(directory, { recursive: true });
        checkDirectory(segments);
        if (!fs.lstatSync(directory).isDirectory() || fs.realpathSync(directory) !== path.join(canonicalRoot, ...segments)) {
            throw new Error('PSD默认目录创建后校验失败');
        }
    }
    directories.forEach(checkDirectory);
}

/**
 * 获取文件扩展名
 * 处理流程：
 * 1、提取扩展名并统一为小写。
 * @param {string} filename - 文件名
 * @returns {string} 扩展名
 */
function getFileExtension(filename) {
    // 1、返回包含点号的小写扩展名。
    return path.extname(filename).toLowerCase();
}

/**
 * 检查文件是否为支持的PSD格式
 * 处理流程：
 * 1、规范扩展名并与支持列表比较。
 * @param {string} filename - 文件名
 * @returns {boolean} 是否支持
 */
function isSupportedPSDFile(filename) {
    // 1、按扩展名判断是否为 PSD 或 PSB。
    const ext = getFileExtension(filename);
    return PSD_API_CONFIG.SUPPORTED_EXTENSIONS.includes(ext);
}

export {
    // 配置常量
    PSD_API_CONFIG,
    PSD_PARSE_DEFAULTS,
    IMAGE_COMPOSE_DEFAULTS,
    COMPONENT_DETECTION_CONFIG,
    PSD_STATUS,
    PSD_ERROR_MESSAGES,
    PSD_PATH_CONFIG,
    PSD_MIME_TYPES,
    
    // 工具函数
    getPSDConfig,
    validatePSDConfig,
    createDefaultPSDDirectories,
    getFileExtension,
    isSupportedPSDFile
};
