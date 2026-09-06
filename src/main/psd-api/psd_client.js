/**
 * PSD客户端 - 真实PSD处理功能
 * 使用ag-psd库进行真实的PSD文件解析
 */

import { readPsd, writePsdBuffer, initializeCanvas } from 'ag-psd';
import { PSD_ERROR_MESSAGES, COMPONENT_DETECTION_CONFIG } from './config.js';

const SHOULD_LOG_LAYER_DETAILS = process.env.PSD_LAYER_VERBOSE === 'true';
/**
 * 按开关输出图层详细日志。
 * 处理流程：
 * 1、仅在启用图层诊断时将参数输出到控制台。
 */
const logLayerVerbose = (...args) => {
    // 1、检查详细日志开关。
    if (SHOULD_LOG_LAYER_DETAILS) {
        console.log(...args);
    }
};

// 动态导入 @napi-rs/canvas
let canvasModule = null;

/**
 * 按需加载原生画布模块。
 * 处理流程：
 * 1、首次使用时动态导入模块。
 * 2、返回缓存实例，加载失败时说明图像解析限制。
 */
async function loadCanvasModule() {
    // 1、复用已加载模块，避免重复初始化。
    if (!canvasModule) {
        try {
            canvasModule = await import('@napi-rs/canvas');
            console.log('✅ @napi-rs/canvas 模块加载成功');
        } catch (error) {
            console.error('❌ @napi-rs/canvas 加载失败:', error);
            throw new Error('Canvas模块加载失败，无法解析PSD图像数据');
        }
    }
    return canvasModule;
}

// 初始化 Canvas（ag-psd 要求）
// 使用 @napi-rs/canvas 提供真实的 Canvas 实现
try {
    // 同步加载（模块初始化时）
    const { createCanvas } = await import('@napi-rs/canvas');
    
    initializeCanvas((width, height) => {
        return createCanvas(width, height);
    });
    
    console.log('✅ ag-psd Canvas已初始化（@napi-rs/canvas）');
} catch (error) {
    console.error('❌ Canvas初始化失败:', error);
    // 如果初始化失败，提供仅满足接口形状的后备实现；它不保存、绘制或导出真实像素。
    initializeCanvas((width, height) => {
        console.warn('⚠️ 使用后备Canvas实现，图像数据可能不完整');
        return {
            width,
            height,
            /**
             * 返回后备画布上下文。
             * 处理流程：
             * 1、提供尺寸及空像素读写接口，供解析器继续访问画布结构。
             */
            getContext: () => ({
                canvas: { width, height },
                /**
                 * 创建空白像素缓冲。
                 * 处理流程：
                 * 1、采用传入尺寸或画布尺寸，分配初值为零的四色通道数组。
                 */
                createImageData: (w, h) => ({
                    width: w || width,
                    height: h || height,
                    data: new Uint8ClampedArray((w || width) * (h || height) * 4)
                }),
                /**
                 * 接收像素写入的空操作入口。
                 * 处理流程：
                 * 1、直接结束，不保存传入像素。
                 */
                putImageData: () => {},
                /**
                 * 返回指定尺寸的空白像素。
                 * 处理流程：
                 * 1、分配全零缓冲，不读取坐标范围内的真实图像。
                 */
                getImageData: (x, y, w, h) => ({
                    width: w,
                    height: h,
                    data: new Uint8ClampedArray(w * h * 4)
                })
            }),
            /**
             * 提供不支持图像导出的占位入口。
             * 处理流程：
             * 1、返回空值，由调用方识别没有可导出的图像。
             */
            toDataURL: () => null
        };
    });
}

/**
 * 真实的PSD解析功能
 * 处理流程：
 * 1、设置超时并规范输入缓冲区。
 * 2、调用 ag-psd，转换图层树并汇总尺寸与元信息。
 * 3、清除定时器，完成或拒绝解析任务。
 * @param {Buffer|ArrayBuffer} fileBuffer - PSD文件缓冲区
 * @param {object} options - 解析选项
 * @param {number} timeout - 超时时间
 * @returns {Promise<object>} 解析结果
 */
async function parsePSD(fileBuffer, options = {}, timeout = 30000) {
    // 1、准备任务超时和输入数据转换。
    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(PSD_ERROR_MESSAGES.TIMEOUT));
        }, timeout);
        
        try {
            
            // 转换为Buffer
            let buffer = fileBuffer;
            if (fileBuffer instanceof ArrayBuffer) {
                buffer = Buffer.from(fileBuffer);
            }
            
            // 2、使用 ag-psd 解析图层及合成图像。
            const psd = readPsd(buffer, {
                skipLayerImageData: !options.parseImages, // 根据选项决定是否解析图层图像
                skipCompositeImageData: false, // 保留合成图像
                skipThumbnail: true,
                logMissingFeatures: false,
                throwForMissingFeatures: false
            });
            
            if (!psd) {
                throw new Error('PSD解析返回空结果');
            }
            
            
            // 处理图层层次结构
            const layerHierarchy = processLayers(psd.children || [], options);
            
            // 3、图层处理完成后清理计时器并返回解析结果。
            clearTimeout(timeoutId);
            
            resolve({
                success: true,
                width: psd.width,
                height: psd.height,
                layerHierarchy: layerHierarchy,
                layerCount: countLayers(layerHierarchy),
                metadata: {
                    width: psd.width,
                    height: psd.height,
                    layerCount: countLayers(layerHierarchy),
                    parseTime: Date.now(),
                    colorMode: psd.colorMode || 'RGB',
                    bitDepth: psd.bitsPerChannel || 8,
                    channels: psd.channels || 3
                },
                header: {
                    signature: '8BPS',
                    version: psd.version || 1,
                    channels: psd.channels || 3,
                    width: psd.width,
                    height: psd.height,
                    depth: psd.bitsPerChannel || 8,
                    colorMode: psd.colorMode || 'RGB'
                },
                parseOptions: options,
                timestamp: Date.now()
            });
            
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('PSD解析失败:', error);
            reject(new Error(`PSD解析失败: ${error.message}`));
        }
    });
}

/**
 * 处理图层层次结构，提取图像数据
 * 处理流程：
 * 1、规范图层类型、透明度及几何信息。
 * 2、按选项提取图像、调整层与蒙版数据。
 * 3、递归转换子图层并保持原始顺序。
 * @param {Array} layers - 图层数组
 * @param {object} options - 解析选项
 * @param {number} parentIndex - 父图层索引
 * @returns {Array} 处理后的图层数组
 */
function processLayers(layers, options = {}, parentIndex = 0) {
    // 1、过滤空集合并逐层建立基础信息。
    if (!layers || layers.length === 0) {
        return [];
    }
    
    const processed = [];
    
    for (let index = 0; index < layers.length; index++) {
        const layer = layers[index];
        // 处理透明度：ag-psd返回的opacity范围是0-255
        // 如果值异常小（< 10）且不为0，可能是PSD文件问题，设为255（完全不透明）
        let opacityValue = (layer.opacity !== undefined ? layer.opacity : 255);
        if (opacityValue > 0 && opacityValue < 10) {
            console.warn(`图层 ${layer.name || '未命名'} 透明度异常: ${opacityValue}，调整为255`);
            opacityValue = 255;
        }
        
        // 判断图层类型：优先识别调整图层
        let layerType = 'layer';
        if (layer.children && layer.children.length > 0) {
            layerType = 'group';
        } else if (layer.adjustment) {
            layerType = 'adjustment';
        }
        
        const layerData = {
            id: `${parentIndex}-${index}`,
            name: layer.name || `图层 ${index}`,
            type: layerType,
            visible: !layer.hidden,
            opacity: opacityValue,
            blendMode: layer.blendMode || 'normal',
            clipping: layer.clipping || false, // 剪切蒙版属性：true表示剪切到下面的图层
            bounds: {
                left: layer.left || 0,
                top: layer.top || 0,
                right: layer.right || 0,
                bottom: layer.bottom || 0
            },
            left: layer.left || 0,
            top: layer.top || 0,
            width: (layer.right || 0) - (layer.left || 0),
            height: (layer.bottom || 0) - (layer.top || 0),
            originalIndex: index,
            // 图层蒙版属性：用于控制图层的可见区域
            mask: null,
            // 调整图层数据
            adjustment: null
        };
        
        // 2、按需提取图像、调整参数和蒙版内容。
        if (options.parseImages && layer.canvas) {
            try {
                logLayerVerbose(`📸 处理图层图像: ${layer.name}, Canvas尺寸: ${layer.canvas?.width}x${layer.canvas?.height}`);
                // 将canvas转换为base64
                const base64 = canvasToBase64(layer.canvas);
                if (base64) {
                    layerData.imageData = base64;
                    logLayerVerbose(`✓ 图层 ${layer.name} 图像数据已提取: ${base64.length} 字符`);
                } else {
                    console.warn(`⚠️ 图层 ${layer.name} Base64转换返回空值`);
                }
            } catch (error) {
                console.warn(`❌ 图层 ${layer.name} 图像数据提取失败:`, error.message);
            }
        } else if (options.parseImages && !layer.canvas) {
            logLayerVerbose(`⏭️ 图层 ${layer.name} 没有Canvas对象`);
        }
        
        // 处理调整图层数据
        if (layer.adjustment) {
            try {
                logLayerVerbose(`🎨 处理调整图层: ${layer.name}, 类型: ${layer.adjustment.type}`);
                layerData.adjustment = parseAdjustmentData(layer.adjustment);
                logLayerVerbose(`✓ 图层 ${layer.name} 调整数据已提取:`, layerData.adjustment);
            } catch (error) {
                console.warn(`❌ 图层 ${layer.name} 调整数据提取失败:`, error.message);
            }
        }
        
        // 处理图层蒙版数据
        if (layer.mask && options.parseImages) {
            try {
                logLayerVerbose(`🎭 处理图层蒙版: ${layer.name}`, {
                    disabled: layer.mask.disabled,
                    bounds: { 
                        left: layer.mask.left, 
                        top: layer.mask.top, 
                        right: layer.mask.right, 
                        bottom: layer.mask.bottom 
                    },
                    canvasSize: layer.mask.canvas ? `${layer.mask.canvas.width}x${layer.mask.canvas.height}` : 'no canvas'
                });
                
                const maskData = {
                    disabled: layer.mask.disabled || false,
                    defaultColor: layer.mask.defaultColor !== undefined ? layer.mask.defaultColor : 255,
                    invert: !!layer.mask.invert,
                    left: layer.mask.left || 0,
                    top: layer.mask.top || 0,
                    right: layer.mask.right || 0,
                    bottom: layer.mask.bottom || 0,
                    width: (layer.mask.right || 0) - (layer.mask.left || 0),
                    height: (layer.mask.bottom || 0) - (layer.mask.top || 0)
                };
                
                // 提取蒙版图像数据
                if (layer.mask.canvas) {
                    maskData.canvasWidth = layer.mask.canvas.width;
                    maskData.canvasHeight = layer.mask.canvas.height;
                    
                    const maskBase64 = canvasToBase64(layer.mask.canvas);
                    if (maskBase64) {
                        maskData.imageData = maskBase64;
                        logLayerVerbose(`✓ 图层 ${layer.name} 蒙版数据已提取: ${maskBase64.length} 字符, canvas尺寸: ${maskData.canvasWidth}x${maskData.canvasHeight}`);
                    } else {
                        console.warn(`⚠️ 图层 ${layer.name} 蒙版Base64转换返回空值`);
                    }
                } else {
                    logLayerVerbose(`⏭️ 图层 ${layer.name} 蒙版没有Canvas对象`);
                }
                
                layerData.mask = maskData;
            } catch (error) {
                console.warn(`❌ 图层 ${layer.name} 蒙版数据提取失败:`, error.message);
            }
        }
        
        // 3、递归处理子图层，保留当前数组中的层级顺序。
        if (layer.children && layer.children.length > 0) {
            layerData.children = processLayers(layer.children, options, index);
        }
        
        processed.push(layerData);
    }
    
    return processed;
}

/**
 * 解析调整图层数据
 * 处理流程：
 * 1、验证调整类型。
 * 2、按色相、曲线、色阶等类型提取字段，未知类型保留原数据。
 * @param {object} adjustment - ag-psd的调整图层对象
 * @returns {object} 解析后的调整数据
 */
function parseAdjustmentData(adjustment) {
    // 1、缺失类型时不生成调整数据。
    if (!adjustment || !adjustment.type) {
        return null;
    }
    
    const adjustmentData = {
        type: adjustment.type
    };
    
    // 2、将各类调整参数转换为渲染侧使用的结构。
    switch (adjustment.type) {
        case 'hue/saturation':
            // 色相/饱和度调整（尽量完整透传所有可能字段，避免丢失信息）
            adjustmentData.data = {
                master: adjustment.master ? {
                    hue: adjustment.master.hue || 0,           // -180 到 180
                    saturation: adjustment.master.saturation || 0,  // -100 到 100
                    lightness: adjustment.master.lightness || 0     // -100 到 100
                } : { hue: 0, saturation: 0, lightness: 0 },
                // 六色通道（若存在）
                reds: adjustment.reds || null,
                yellows: adjustment.yellows || null,
                greens: adjustment.greens || null,
                cyans: adjustment.cyans || null,
                blues: adjustment.blues || null,
                magentas: adjustment.magentas || null,
                // 着色相关（不同导出可能字段名不同，尽量收集）
                colorize: (typeof adjustment.colorize === 'object') ? adjustment.colorize : null,
                colorizeEnabled: !!(adjustment.colorize === true || (typeof adjustment.colorize === 'object' && adjustment.colorize.enabled)),
                colorizeHue: adjustment.colorizeHue ?? (adjustment.colorize?.hue),
                colorizeSaturation: adjustment.colorizeSaturation ?? (adjustment.colorize?.saturation),
                colorizeLightness: adjustment.colorizeLightness ?? (adjustment.colorize?.lightness),
                // 兜底：保留原始对象供前端精确匹配实现
                __raw: adjustment
            };
            break;
            
        case 'curves':
            // 曲线调整
            adjustmentData.data = {
                rgb: adjustment.rgb || null,
                red: adjustment.red || null,
                green: adjustment.green || null,
                blue: adjustment.blue || null
            };
            break;
            
        case 'levels':
            // 色阶调整
            adjustmentData.data = {
                rgb: adjustment.rgb || null,
                red: adjustment.red || null,
                green: adjustment.green || null,
                blue: adjustment.blue || null
            };
            break;
            
        case 'brightness/contrast':
            // 亮度/对比度调整
            adjustmentData.data = {
                brightness: adjustment.brightness || 0,
                contrast: adjustment.contrast || 0,
                useLegacy: adjustment.useLegacy || false
            };
            break;
            
        case 'color balance':
            // 色彩平衡调整
            adjustmentData.data = {
                shadows: adjustment.shadows || null,
                midtones: adjustment.midtones || null,
                highlights: adjustment.highlights || null,
                preserveLuminosity: adjustment.preserveLuminosity !== false
            };
            break;
            
        default:
            // 其他调整类型，保存原始数据
            adjustmentData.data = adjustment;
            console.log(`⚠️ 未识别的调整图层类型: ${adjustment.type}`);
            break;
    }
    
    return adjustmentData;
}

/**
 * 将Canvas转换为Base64
 * 处理流程：
 * 1、检查画布对象及数据地址导出能力。
 * 2、导出 PNG 并验证格式，失败时返回空值。
 * @param {object} canvas - ag-psd的Canvas对象
 * @returns {string} Base64数据URL
 */
function canvasToBase64(canvas) {
    // 1、缺失画布时直接跳过图像提取。
    if (!canvas) {
        console.warn('Canvas对象为空');
        return null;
    }
    
    try {
        // 2、调用画布导出能力并校验数据地址前缀。
        if (typeof canvas.toDataURL === 'function') {
            const base64 = canvas.toDataURL('image/png');
            
            // 验证base64数据
            if (!base64 || !base64.startsWith('data:image/')) {
                console.error('生成的base64数据格式无效:', base64?.substring(0, 50));
                return null;
            }
            
            logLayerVerbose(`✓ Canvas转Base64成功，尺寸: ${canvas.width}x${canvas.height}, 数据长度: ${base64.length}`);
            return base64;
        }
        
        // 如果没有toDataURL方法，返回null（前端会处理）
        console.warn('Canvas对象没有toDataURL方法，跳过图像数据提取');
        console.warn('Canvas类型:', typeof canvas, 'Canvas属性:', Object.keys(canvas).join(', '));
        return null;
    } catch (error) {
        console.error('Canvas转Base64失败:', error);
        console.error('Canvas尺寸:', canvas?.width, 'x', canvas?.height);
        return null;
    }
}

/**
 * 统计图层数量
 * 处理流程：
 * 1、递归遍历全部图层和分组，累计节点数量。
 * @param {Array} layers - 图层数组
 * @returns {number} 图层总数
 */
function countLayers(layers) {
    // 1、初始化计数并遍历完整图层树。
    let count = 0;
    /**
     * 累计当前层级及其后代节点。
     * 处理流程：
     * 1、逐节点计数，存在子图层时递归处理。
     */
    const traverse = (layerList) => {
        // 1、计入分组自身及其全部子图层。
        for (const layer of layerList) {
            count++;
            if (layer.children && layer.children.length > 0) {
                traverse(layer.children);
            }
        }
    };
    traverse(layers || []);
    return count;
}

/**
 * 渲染PSD图层（使用 @napi-rs/canvas 进行真实渲染）
 * 处理流程：
 * 1、设置超时，加载画布模块并准备尺寸和背景。
 * 2、递归绘制可见图层，导出指定格式的数据地址。
 * 3、清理定时器，返回渲染结果或异常。
 * @param {object} psdData - PSD数据
 * @param {object} options - 渲染选项
 * @param {number} timeout - 超时时间
 * @returns {Promise<object>} 渲染结果
 */
async function renderPSDLayers(psdData, options = {}, timeout = 45000) {
    // 1、建立渲染任务超时，随后创建目标画布。
    return new Promise(async (resolve, reject) => {
        const timeoutId = setTimeout(() => {
            reject(new Error(PSD_ERROR_MESSAGES.TIMEOUT));
        }, timeout);
        
        try {
            console.log('开始渲染PSD图层...');
            
            // 加载canvas模块
            const { createCanvas, loadImage } = await loadCanvasModule();
            
            const width = options.width || psdData.width || 800;
            const height = options.height || psdData.height || 600;
            const format = options.format || 'png';
            
            // 创建真实的Canvas
            const canvas = createCanvas(width, height);
            const ctx = canvas.getContext('2d');
            
            // 设置背景
            if (options.background && options.background !== 'transparent') {
                ctx.fillStyle = options.background;
                ctx.fillRect(0, 0, width, height);
            }
            
            // 2、绘制所有可见图层并导出图像。
            await renderLayersToCanvas(ctx, psdData.layerHierarchy || [], width, height, psdData.width, psdData.height, loadImage);
            
            // 3、导出数据地址并清理计时器。
            const imageData = canvas.toDataURL(`image/${format}`);
            
            clearTimeout(timeoutId);
            
            console.log('PSD图层渲染完成');
            
            resolve({
                success: true,
                imageData: imageData,
                width,
                height,
                format,
                size: imageData.length,
                renderOptions: options,
                timestamp: Date.now()
            });
            
        } catch (error) {
            clearTimeout(timeoutId);
            console.error('PSD渲染失败:', error);
            reject(new Error(`PSD渲染失败: ${error.message}`));
        }
    });
}

/**
 * 递归渲染图层到Canvas
 * 处理流程：
 * 1、反转图层顺序以从底向上绘制。
 * 2、跳过隐藏图层，递归子图层后绘制当前图层。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {Array} layers - 图层数组
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 * @param {number} psdWidth - PSD原始宽度
 * @param {number} psdHeight - PSD原始高度
 * @param {Function} loadImage - 图像加载函数
 */
async function renderLayersToCanvas(ctx, layers, canvasWidth, canvasHeight, psdWidth, psdHeight, loadImage) {
    // 1、反转图层数组，从底部到顶部渲染。
    const reversedLayers = [...layers].reverse();
    
    for (const layer of reversedLayers) {
        // 2、过滤隐藏层，再处理子图层和当前图像。
        if (!layer.visible || layer.hidden) {
            continue;
        }
        
        // 递归渲染子图层
        if (layer.children && layer.children.length > 0) {
            await renderLayersToCanvas(ctx, layer.children, canvasWidth, canvasHeight, psdWidth, psdHeight, loadImage);
        }
        
        // 渲染当前图层
        if (layer.imageData || layer.canvas) {
            try {
                await renderSingleLayer(ctx, layer, canvasWidth, canvasHeight, psdWidth, psdHeight, loadImage);
            } catch (error) {
                console.warn(`渲染图层 ${layer.name} 失败:`, error.message);
            }
        }
    }
}

/**
 * 渲染单个图层
 * 处理流程：
 * 1、按目标画布计算缩放后的图层位置和尺寸。
 * 2、设置透明度，绘制画布或解码后的图片，再恢复透明度。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} layer - 图层数据
 * @param {number} canvasWidth - 画布宽度
 * @param {number} canvasHeight - 画布高度
 * @param {number} psdWidth - PSD原始宽度
 * @param {number} psdHeight - PSD原始高度
 * @param {Function} loadImage - 图像加载函数
 */
async function renderSingleLayer(ctx, layer, canvasWidth, canvasHeight, psdWidth, psdHeight, loadImage) {
    try {
        // 1、计算缩放比例及目标图层几何信息。
        const scaleX = canvasWidth / psdWidth;
        const scaleY = canvasHeight / psdHeight;
        
        // 计算图层位置和尺寸
        const x = (layer.left || 0) * scaleX;
        const y = (layer.top || 0) * scaleY;
        const width = layer.width * scaleX;
        const height = layer.height * scaleY;
        
        // 2、临时应用图层透明度并绘制图像。
        const oldAlpha = ctx.globalAlpha;
        ctx.globalAlpha = (layer.opacity || 255) / 255;
        
        // 绘制图层
        if (layer.canvas) {
            ctx.drawImage(layer.canvas, x, y, width, height);
        } else if (layer.imageData) {
            // 如果是base64数据，需要先加载
            const img = await loadImage(Buffer.from(layer.imageData.split(',')[1], 'base64'));
            ctx.drawImage(img, x, y, width, height);
        }
        
        // 恢复透明度
        ctx.globalAlpha = oldAlpha;
    } catch (error) {
        console.error('渲染图层失败:', error);
    }
}

/**
 * 组件自动检测功能
 * 处理流程：
 * 1、准备组件分类集合，递归匹配图层名称关键词。
 * 2、汇总各类组件及数量统计。
 * @param {Array} layerHierarchy - 图层层次结构
 * @param {object} detectionConfig - 检测配置
 * @returns {Promise<object>} 检测结果
 */
async function detectComponents(layerHierarchy, detectionConfig = COMPONENT_DETECTION_CONFIG) {
    // 1、按名称匹配规则收集组件，同一图层可命中多个类别。
    return new Promise((resolve) => {
        console.log('开始组件检测...');
        
        const components = {
            frontHand: [],
            backHand: [],
            expression: [],
            body: [],
            hair: [],
            accessories: []
        };
        
        /**
         * 将图层归入匹配的组件类别。
         * 处理流程：
         * 1、统一名称大小写并依次匹配各类关键词。
         * 2、递归处理子图层。
         */
        const traverseLayers = (layers) => {
            // 1、分别匹配全部类别，不在首次命中后停止。
            for (const layer of layers) {
                const layerName = layer.name.toLowerCase();
                
                // 前手检测
                if (detectionConfig.FRONT_HAND_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.frontHand.push(layer);
                }
                
                // 后手检测
                if (detectionConfig.BACK_HAND_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.backHand.push(layer);
                }
                
                // 表情检测
                if (detectionConfig.EXPRESSION_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.expression.push(layer);
                }
                
                // 身体检测
                if (detectionConfig.BODY_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.body.push(layer);
                }
                
                // 头发检测
                if (detectionConfig.HAIR_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.hair.push(layer);
                }
                
                // 配饰检测
                if (detectionConfig.ACCESSORY_KEYWORDS.some(keyword => 
                    layerName.includes(keyword.toLowerCase()))) {
                    components.accessories.push(layer);
                }
                
                // 2、递归处理当前分组的子图层。
                if (layer.children && layer.children.length > 0) {
                    traverseLayers(layer.children);
                }
            }
        };
        
        traverseLayers(layerHierarchy);
        
        console.log('组件检测完成');
        
        // 2、返回组件集合及图层、分类数量统计。
        resolve({
            success: true,
            components,
            statistics: {
                totalLayers: countLayers(layerHierarchy),
                frontHand: components.frontHand.length,
                backHand: components.backHand.length,
                expression: components.expression.length,
                body: components.body.length,
                hair: components.hair.length,
                accessories: components.accessories.length
            },
            detectionTime: Date.now()
        });
    });
}

/**
 * 文件格式验证
 * 处理流程：
 * 1、检查最小头部长度。
 * 2、验证 PSD 签名并返回文件容量。
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @returns {object} 验证结果
 */
function validatePSDFile(fileBuffer) {
    // 1、保证缓冲区足够读取完整 PSD 头部。
    if (!fileBuffer || fileBuffer.length < 26) {
        return {
            valid: false,
            error: PSD_ERROR_MESSAGES.INVALID_FILE
        };
    }
    
    // 2、检查 PSD 文件签名。
    const signature = fileBuffer.slice(0, 4).toString('ascii');
    if (signature !== '8BPS') {
        return {
            valid: false,
            error: PSD_ERROR_MESSAGES.UNSUPPORTED_FORMAT
        };
    }
    
    return {
        valid: true,
        fileSize: fileBuffer.length,
        signature
    };
}

/**
 * 获取PSD基本信息
 * 处理流程：
 * 1、验证缓冲区和文件签名。
 * 2、按大端格式读取固定头部字段，返回尺寸与颜色信息。
 * @param {Buffer} fileBuffer - 文件缓冲区
 * @returns {object} 基本信息
 */
function getPSDInfo(fileBuffer) {
    // 1、先验证格式，再访问固定偏移字段。
    const validation = validatePSDFile(fileBuffer);
    if (!validation.valid) {
        throw new Error(validation.error);
    }
    
    try {
        // 2、仅读取头部信息，不执行图层解析。
        const buffer = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
        
        // 读取基本信息
        const version = buffer.readUInt16BE(4);
        const channels = buffer.readUInt16BE(12);
        const height = buffer.readUInt32BE(14);
        const width = buffer.readUInt32BE(18);
        const depth = buffer.readUInt16BE(22);
        const colorMode = buffer.readUInt16BE(24);
        
        return {
            valid: true,
            fileSize: fileBuffer.length,
            signature: '8BPS',
            version,
            channels,
            width,
            height,
            depth,
            colorMode,
            estimatedDimensions: {
                width,
                height
            }
        };
    } catch (error) {
        console.error('读取PSD信息失败:', error);
        throw new Error('无法读取PSD文件信息');
    }
}

export {
    parsePSD,
    renderPSDLayers,
    detectComponents,
    validatePSDFile,
    getPSDInfo
};
