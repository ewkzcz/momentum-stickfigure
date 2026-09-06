/**
 * 导出工具函数模块
 * 
 * 提供与generate_image_plus模块对齐的文件命名和路径处理功能
 */

/**
 * 生成导出文件名（对齐generate_image_plus的命名方式）
 * 处理流程：1、读取默认选项；2、清理名称；3、生成文件名；4、拼接导出路径。
 * 
 * @param {Object} options - 选项对象
 * @param {string} options.presetName - 预设名称/模板名称
 * @param {string} options.variantName - 变体名称/图层名称
 * @param {string} options.exportPath - 导出路径（可选）
 * @param {string} options.fileType - 文件类型（默认png）
 * @returns {Object} 包含文件名和完整路径的对象
 */
export function generateExportFileName(options) {
    // 1、补齐模板、图层名称和文件格式的默认值。
    const {
        presetName = '漫画模板',
        variantName = '图层',
        exportPath = './',
        fileType = 'png'
    } = options

    // 2、清理文件名中的特殊字符，对齐 generate_image_plus 的处理方式。
    const cleanPresetName = presetName.replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fa5_-]/g, '')
    const cleanVariantName = variantName.replace(/\s+/g, '_').replace(/[^\w\u4e00-\u9fa5_-]/g, '')
    
    // 3、生成文件名：预设名称_变体名称.文件类型。
    const fileName = `${cleanPresetName}_${cleanVariantName}.${fileType}`
    
    // 4、根据路径末尾及扩展名判断是否需要追加文件名。
    let fullPath = exportPath
    if (exportPath.endsWith('/') || exportPath.endsWith('\\')) {
        fullPath = exportPath + fileName
    } else if (!exportPath.includes('.')) {
        // 如果exportPath不包含文件扩展名，认为是目录
        fullPath = exportPath + (exportPath.endsWith('/') || exportPath.endsWith('\\') ? '' : '/') + fileName
    }
    
    return {
        fileName,
        fullPath,
        cleanPresetName,
        cleanVariantName
    }
}

/**
 * 生成批量导出的文件名列表
 * 处理流程：1、为每层生成名称；2、将路径信息与原图层一起返回。
 * 
 * @param {Array} layers - 图层数组
 * @param {string} templateName - 模板名称
 * @param {string} exportPath - 导出路径
 * @returns {Array} 文件名信息数组
 */
export function generateBatchExportFileNames(layers, templateName, exportPath) {
    // 1、沿用统一命名规则处理每一个图层。
    return layers.map(layer => {
        const fileInfo = generateExportFileName({
            presetName: templateName,
            variantName: layer.name,
            exportPath: exportPath
        })
        
        // 2、保留原图层引用供批量导出使用。
        return {
            layer,
            ...fileInfo
        }
    })
}

/**
 * 验证导出路径是否有效
 * 处理流程：1、检查路径类型与空值；2、拒绝非法字符；3、返回目录标记和归一化路径。
 * 
 * @param {string} path - 路径字符串
 * @returns {Object} 验证结果
 */
export function validateExportPath(path) {
    // 1、排除空路径及非字符串输入。
    if (!path || typeof path !== 'string') {
        return {
            valid: false,
            error: '路径不能为空'
        }
    }
    
    // 2、检查当前规则禁止的路径字符。
    const invalidChars = /[<>:"|?*]/
    if (invalidChars.test(path)) {
        return {
            valid: false,
            error: '路径包含非法字符'
        }
    }
    
    // 3、统一路径分隔符，保留目录尾分隔符判断结果。
    return {
        valid: true,
        isDirectory: path.endsWith('/') || path.endsWith('\\'),
        normalizedPath: path.replace(/\\/g, '/')
    }
}

/**
 * 格式化导出选项（对齐generate_image_plus的选项格式）
 * 处理流程：1、按样式、画布和调试分组补齐导出选项。
 * 
 * @param {Object} options - 原始选项
 * @returns {Object} 格式化后的选项
 */
export function formatExportOptions(options = {}) {
    // 1、将页面配置转换为导出模块所需结构。
    return {
        style: {
            fillColor: options.fillColor || '#FFFFFF',
            strokeColor: options.strokeColor || '#000000',
            strokeWidth: options.strokeWidth || 5,
            fill: options.fill !== false, // 默认true
            stroke: options.stroke !== false // 默认true
        },
        canvas: {
            width: options.canvasWidth || 1920,
            height: options.canvasHeight || 1080
        },
        debug: {
            showGrid: options.showGrid || false,
            showVertices: options.showVertices || false
        },
        quality: options.quality || 1.0, // 100%质量
        format: options.format || 'png'
    }
}

/**
 * 创建导出状态管理器
 * 处理流程：1、初始化独立状态；2、返回开始、进度、完成及重置操作。
 * 
 * @returns {Object} 状态管理器对象
 */
export function createExportStateManager() {
    // 1、每个管理器实例持有独立的批量导出状态。
    let isExporting = false
    let currentProgress = 0
    let totalItems = 0
    let exportedItems = []
    
    // 2、通过统一方法维护进度，读取时复制导出列表。
    return {
        /**
         * 开始一次导出。
         * 处理流程：1、清空上次进度并记录本次总量。
         */
        startExport(total = 1) {
            // 1、初始化新一轮导出的状态。
            isExporting = true
            currentProgress = 0
            totalItems = total
            exportedItems = []
        },
        
        /**
         * 记录一个已完成项目。
         * 处理流程：1、递增进度并保存项目。
         */
        updateProgress(item) {
            // 1、使进度计数与完成项目同步增长。
            currentProgress++
            exportedItems.push(item)
        },
        
        /**
         * 结束当前导出。
         * 处理流程：1、解除导出状态并将进度置为总量。
         */
        finishExport() {
            // 1、标记当前批次已经完成。
            isExporting = false
            currentProgress = totalItems
        },
        
        /**
         * 获取导出进度快照。
         * 处理流程：1、复制结果列表并计算百分比。
         */
        getProgress() {
            // 1、复制数组，避免读取方直接修改内部列表。
            return {
                isExporting,
                currentProgress,
                totalItems,
                exportedItems: [...exportedItems],
                percentage: totalItems > 0 ? Math.round((currentProgress / totalItems) * 100) : 0
            }
        },
        
        /**
         * 清空导出状态。
         * 处理流程：1、恢复计数、标记和结果列表的初始值。
         */
        reset() {
            // 1、丢弃当前批次状态，准备下一次导出。
            isExporting = false
            currentProgress = 0
            totalItems = 0
            exportedItems = []
        }
    }
}
