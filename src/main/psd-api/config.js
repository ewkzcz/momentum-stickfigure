/**
 * PSD API 配置文件
 * 包含PSD处理相关配置、默认参数和常量定义
 */

import path from 'path';
import { app } from 'electron';

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
 * 组件检测配置
 */
const COMPONENT_DETECTION_CONFIG = {
    // 前手关键词
    FRONT_HAND_KEYWORDS: ['前手', 'front', 'fronthand', '前臂', 'front_hand'],
    
    // 后手关键词
    BACK_HAND_KEYWORDS: ['后手', 'back', 'backhand', '后臂', 'back_hand'],
    
    // 表情关键词
    EXPRESSION_KEYWORDS: [
        '表情', 'face', 'expression', '脸', '眼', '嘴', 'eye', 'mouth',
        '开心', '生气', '惊讶', '难过', '害怕', '厌恶', '兴奋',
        'happy', 'angry', 'surprise', 'sad', 'fear', 'disgust', 'excited'
    ],
    
    // 身体关键词
    BODY_KEYWORDS: ['身体', 'body', 'torso', '胸', '躯干'],
    
    // 头发关键词
    HAIR_KEYWORDS: ['头发', 'hair', '发型', '刘海'],
    
    // 配饰关键词
    ACCESSORY_KEYWORDS: [
        '配饰', '装饰', 'accessory', '帽子', 'hat', '眼镜', 'glasses',
        '项链', 'necklace', '耳环', 'earring', '手镯', 'bracelet'
    ]
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
 * 错误消息常量
 */
const PSD_ERROR_MESSAGES = {
    INVALID_FILE: '无效的PSD文件',
    FILE_TOO_LARGE: '文件大小超过限制',
    UNSUPPORTED_FORMAT: '不支持的文件格式',
    PARSE_FAILED: 'PSD文件解析失败',
    NO_LAYERS_FOUND: '未找到有效图层',
    RENDER_FAILED: '图像渲染失败',
    NETWORK_ERROR: '网络连接错误',
    TIMEOUT: '操作超时',
    INSUFFICIENT_MEMORY: '内存不足',
    UNKNOWN_ERROR: '未知错误'
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

/**
 * 获取PSD配置
 * 处理流程：
 * 1、合并默认配置及解析、合成选项，再应用顶层覆盖值。
 * @param {object} options - 配置选项
 * @returns {object} 合并后的配置
 */
function getPSDConfig(options = {}) {
    // 1、按从默认值到调用方配置的顺序合并。
    return {
        ...PSD_API_CONFIG,
        ...PSD_PATH_CONFIG,
        parseDefaults: { ...PSD_PARSE_DEFAULTS, ...options.parseOptions },
        composeDefaults: { ...IMAGE_COMPOSE_DEFAULTS, ...options.composeOptions },
        detection: COMPONENT_DETECTION_CONFIG,
        ...options
    };
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
 * 创建默认目录
 * 处理流程：
 * 1、确定临时、缓存及输出目录。
 * 2、逐个创建缺失目录，单项失败只记录警告。
 * @param {object} config - 配置对象
 */
function createDefaultPSDDirectories(config) {
    // 1、优先使用传入目录，缺省使用应用数据路径。
    const fs = require('fs');
    const dirs = [
        config.tempDir || PSD_PATH_CONFIG.DEFAULT_TEMP_DIR,
        config.cacheDir || PSD_PATH_CONFIG.DEFAULT_CACHE_DIR,
        config.outputDir || PSD_PATH_CONFIG.DEFAULT_OUTPUT_DIR
    ];
    
    // 2、独立准备每个目录，避免单项失败终止后续创建。
    dirs.forEach(dir => {
        try {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`创建目录: ${dir}`);
            }
        } catch (error) {
            console.warn(`创建目录失败: ${dir}`, error.message);
        }
    });
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
