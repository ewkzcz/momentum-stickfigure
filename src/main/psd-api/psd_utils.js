/**
 * PSD工具函数
 * 提供PSD文件处理相关的工具函数
 */

import fs from 'fs';
import path from 'path';

/**
 * 读取文件为Buffer
 * 处理流程：
 * 1、异步读取文件，记录容量后返回字节缓冲区。
 * @param {string} filePath - 文件路径
 * @returns {Promise<Buffer>} 文件Buffer
 */
async function readFileAsBuffer(filePath) {
    // 1、读取完整文件内容，失败时保留原异常。
    try {
        const buffer = await fs.promises.readFile(filePath);
        console.log(`读取文件: ${filePath}, 大小: ${Math.round(buffer.length / 1024)}KB`);
        return buffer;
    } catch (error) {
        console.error(`读取文件失败: ${filePath}`, error.message);
        throw error;
    }
}

/**
 * 保存Buffer到文件
 * 处理流程：
 * 1、确保父目录存在。
 * 2、异步写入数据并记录保存信息。
 * @param {Buffer} buffer - 数据Buffer
 * @param {string} filePath - 保存路径
 * @returns {Promise<void>}
 */
async function saveBufferToFile(buffer, filePath) {
    try {
        // 1、确保父目录存在。
        const dir = path.dirname(filePath);
        await ensureDirectoryExists(dir);
        
        // 2、写入完整字节缓冲区。
        await fs.promises.writeFile(filePath, buffer);
        console.log(`保存文件: ${filePath}, 大小: ${Math.round(buffer.length / 1024)}KB`);
    } catch (error) {
        console.error(`保存文件失败: ${filePath}`, error.message);
        throw error;
    }
}

/**
 * 确保目录存在
 * 处理流程：
 * 1、检查目录可访问性。
 * 2、仅在路径缺失时递归创建，其他异常继续抛出。
 * @param {string} dirPath - 目录路径
 * @returns {Promise<void>}
 */
async function ensureDirectoryExists(dirPath) {
    // 1、已有路径直接通过，缺失路径交由异常分支创建。
    try {
        await fs.promises.access(dirPath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            await fs.promises.mkdir(dirPath, { recursive: true });
            console.log(`创建目录: ${dirPath}`);
        } else {
            throw error;
        }
    }
}

/**
 * 获取文件信息
 * 处理流程：
 * 1、读取文件状态及路径组成。
 * 2、将路径不存在转为结果对象，其他异常继续抛出。
 * @param {string} filePath - 文件路径
 * @returns {Promise<object>} 文件信息
 */
async function getFileInfo(filePath) {
    // 1、读取元数据并统一文件不存在的返回结构。
    try {
        const stats = await fs.promises.stat(filePath);
        return {
            exists: true,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime,
            extension: path.extname(filePath).toLowerCase(),
            basename: path.basename(filePath),
            dirname: path.dirname(filePath)
        };
    } catch (error) {
        if (error.code === 'ENOENT') {
            return {
                exists: false,
                error: '文件不存在'
            };
        }
        throw error;
    }
}

/**
 * 验证文件扩展名
 * 处理流程：
 * 1、将扩展名转为小写并查询允许列表。
 * @param {string} filePath - 文件路径
 * @param {Array<string>} allowedExtensions - 允许的扩展名
 * @returns {boolean} 是否有效
 */
function validateFileExtension(filePath, allowedExtensions) {
    // 1、按扩展名进行格式筛选。
    const ext = path.extname(filePath).toLowerCase();
    return allowedExtensions.includes(ext);
}

/**
 * 生成唯一文件名
 * 处理流程：
 * 1、从基础文件名开始检查占用情况。
 * 2、冲突时递增编号，尝试过多时改用时间戳后缀。
 * @param {string} baseName - 基础名称
 * @param {string} extension - 扩展名
 * @param {string} directory - 目录路径
 * @returns {Promise<string>} 唯一文件路径
 */
async function generateUniqueFileName(baseName, extension, directory = './') {
    // 1、构造首个候选路径。
    let counter = 0;
    let fileName = `${baseName}${extension}`;
    let filePath = path.join(directory, fileName);
    
    // 2、逐次探测未占用名称，设置编号尝试上限。
    while (true) {
        const fileInfo = await getFileInfo(filePath);
        if (!fileInfo.exists) {
            return filePath;
        }
        
        counter++;
        fileName = `${baseName}_${counter}${extension}`;
        filePath = path.join(directory, fileName);
        
        // 防止无限循环
        if (counter > 9999) {
            fileName = `${baseName}_${Date.now()}${extension}`;
            filePath = path.join(directory, fileName);
            break;
        }
    }
    
    return filePath;
}

/**
 * 清理临时文件
 * 处理流程：
 * 1、枚举目录并读取每项修改时间。
 * 2、删除超龄项，单项失败继续执行并汇总成功数量。
 * @param {string} directory - 目录路径
 * @param {number} maxAge - 最大年龄（毫秒）
 * @returns {Promise<number>} 清理的文件数量
 */
async function cleanupTempFiles(directory, maxAge = 24 * 60 * 60 * 1000) { // 默认24小时
    // 1、读取目录内容和统一的时间比较基准。
    try {
        const files = await fs.promises.readdir(directory);
        const now = Date.now();
        let cleanedCount = 0;
        
        // 2、只清理修改时间超过保留期限的文件。
        for (const file of files) {
            const filePath = path.join(directory, file);
            const fileInfo = await getFileInfo(filePath);
            
            if (fileInfo.exists && (now - fileInfo.modified.getTime()) > maxAge) {
                try {
                    await fs.promises.unlink(filePath);
                    cleanedCount++;
                    console.log(`清理临时文件: ${filePath}`);
                } catch (error) {
                    console.warn(`清理文件失败: ${filePath}`, error.message);
                }
            }
        }
        
        console.log(`清理完成，共清理 ${cleanedCount} 个临时文件`);
        return cleanedCount;
    } catch (error) {
        console.error(`清理临时文件失败: ${directory}`, error.message);
        return 0;
    }
}

/**
 * 格式化文件大小
 * 处理流程：
 * 1、单独处理零值，再按 1024 进位选择单位并保留两位精度。
 * @param {number} bytes - 字节数
 * @returns {string} 格式化后的大小
 */
function formatFileSize(bytes) {
    // 1、根据字节量选择单位并生成显示文本。
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 生成文件哈希
 * 处理流程：
 * 1、使用指定算法处理完整缓冲区，返回十六进制摘要。
 * @param {Buffer} buffer - 文件Buffer
 * @param {string} algorithm - 哈希算法
 * @returns {string} 哈希值
 */
function generateFileHash(buffer, algorithm = 'md5') {
    // 1、创建摘要实例并计算文件内容哈希。
    const crypto = require('crypto');
    const hash = crypto.createHash(algorithm);
    hash.update(buffer);
    return hash.digest('hex');
}

/**
 * 检查磁盘空间
 * 处理流程：
 * 1、尝试读取文件系统统计并计算空间。
 * 2、不支持时返回固定后备值，异常时返回零值及错误。
 * @param {string} directory - 目录路径
 * @returns {Promise<object>} 磁盘空间信息
 */
async function checkDiskSpace(directory) {
    // 1、检查可用的统计接口；后备容量是固定估值。
    try {
        const stats = await fs.promises.statvfs ? fs.promises.statvfs(directory) : null;
        if (stats) {
            return {
                free: stats.bavail * stats.bsize,
                total: stats.blocks * stats.bsize,
                used: (stats.blocks - stats.bavail) * stats.bsize
            };
        } else {
            // Windows 或不支持 statvfs 的系统的后备方案
            return {
                free: 1024 * 1024 * 1024, // 模拟1GB可用空间
                total: 10 * 1024 * 1024 * 1024, // 模拟10GB总空间
                used: 9 * 1024 * 1024 * 1024
            };
        }
    } catch (error) {
        console.warn('检查磁盘空间失败:', error.message);
        return {
            free: 0,
            total: 0,
            used: 0,
            error: error.message
        };
    }
}

/**
 * 创建备份文件
 * 处理流程：
 * 1、确认原文件存在，生成带时间戳的备份路径。
 * 2、读取原内容并写入备份文件。
 * @param {string} filePath - 原文件路径
 * @returns {Promise<string>} 备份文件路径
 */
async function createBackupFile(filePath) {
    // 1、验证源文件并生成备份名称。
    const fileInfo = await getFileInfo(filePath);
    if (!fileInfo.exists) {
        throw new Error('原文件不存在，无法创建备份');
    }
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = `${filePath}.backup.${timestamp}`;
    
    // 2、复制完整文件内容到备份路径。
    const buffer = await readFileAsBuffer(filePath);
    await saveBufferToFile(buffer, backupPath);
    
    console.log(`创建备份文件: ${backupPath}`);
    return backupPath;
}

/**
 * 日志记录工具
 */
class Logger {
    /**
     * 初始化日志器。
     * 处理流程：
     * 1、保存日志路径并启动目录准备。
     */
    constructor(logFile = './logs/psd-api.log') {
        // 1、记录文件位置并准备父目录。
        this.logFile = logFile;
        this.ensureLogDirectory();
    }
    
    /**
     * 准备日志目录。
     * 处理流程：
     * 1、提取日志父目录并确保存在。
     */
    async ensureLogDirectory() {
        // 1、复用目录创建工具。
        const logDir = path.dirname(this.logFile);
        await ensureDirectoryExists(logDir);
    }
    
    /**
     * 写入结构化日志并输出到控制台。
     * 处理流程：
     * 1、补充时间与进程信息并序列化为单行 JSON。
     * 2、追加日志文件，再输出控制台信息。
     */
    async log(level, message, data = null) {
        // 1、组装包含上下文的日志记录。
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            data,
            pid: process.pid
        };
        
        const logLine = JSON.stringify(logEntry) + '\n';
        
        // 2、文件写入失败仍继续输出控制台。
        try {
            await fs.promises.appendFile(this.logFile, logLine);
        } catch (error) {
            console.error('写入日志文件失败:', error.message);
        }
        
        // 同时输出到控制台
        console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`);
        if (data) {
            console.log('数据:', data);
        }
    }
    
    /**
     * 记录普通信息。
     * 处理流程：
     * 1、使用普通级别调用统一日志入口。
     */
    async info(message, data = null) {
        // 1、透传普通日志及附加数据。
        return this.log('info', message, data);
    }
    
    /**
     * 记录警告信息。
     * 处理流程：
     * 1、使用警告级别调用统一日志入口。
     */
    async warn(message, data = null) {
        // 1、透传警告日志及附加数据。
        return this.log('warn', message, data);
    }
    
    /**
     * 记录错误信息。
     * 处理流程：
     * 1、使用错误级别调用统一日志入口。
     */
    async error(message, data = null) {
        // 1、透传错误日志及附加数据。
        return this.log('error', message, data);
    }
    
    /**
     * 在开发环境记录调试信息。
     * 处理流程：
     * 1、检查运行环境，开发模式才写入调试级别日志。
     */
    async debug(message, data = null) {
        // 1、生产环境跳过调试日志。
        if (process.env.NODE_ENV === 'development') {
            return this.log('debug', message, data);
        }
    }
}

export {
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
};
