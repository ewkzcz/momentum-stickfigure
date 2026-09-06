/**
 * 图片生成模块
 * 负责对话框图片的缩放和文字排版
 */

import { analyzeDialogImage } from './image-analyzer.js';
import { calculateOptimalScale, scaleDialogImage, scaleTextArea } from './image-scaler.js';
import { findOptimalFontSize, drawTextWithLayout } from './text-layout.js';
import { convertStrokeValueToPixels } from './utils.js';

/**
 * 将绘制坐标对齐到设备像素，避免亚像素导致的模糊
 * 处理流程：1、换算到设备像素取整，再还原为逻辑坐标。
 * @param {number} value - CSS 逻辑像素坐标
 * @param {number} scale - 上下文缩放倍数（dpiScale）
 * @returns {number} 对齐后的坐标
 */
function alignToDevicePixel(value, scale) {
    // 1、使放大后的坐标落在整数像素上。
    return Math.round(value * scale) / scale;
}

/**
 * 水平镜像图片
 * 处理流程：1、创建同尺寸画布；2、翻转横向坐标后绘制并恢复上下文。
 * @param {HTMLImageElement} image - 原始图片
 * @returns {HTMLCanvasElement} 镜像后的canvas
 */
function mirrorImageH(image) {
    // 1、创建与原图同尺寸的临时画布。
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    
    // 2、将原点移到右侧后水平翻转，绘制完成再恢复坐标系。
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    
    return canvas;
}

/**
 * 垂直镜像图片
 * 处理流程：1、创建同尺寸画布；2、翻转纵向坐标后绘制并恢复上下文。
 * @param {HTMLImageElement|HTMLCanvasElement} image - 原始图片
 * @returns {HTMLCanvasElement} 镜像后的canvas
 */
function mirrorImageV(image) {
    // 1、创建与原图同尺寸的临时画布。
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    
    // 2、将原点移到底部后垂直翻转，绘制完成再恢复坐标系。
    ctx.save();
    ctx.translate(0, canvas.height);
    ctx.scale(1, -1);
    ctx.drawImage(image, 0, 0);
    ctx.restore();
    
    return canvas;
}

/**
 * 生成单张对话框图片
 * 处理流程：1、读取模板与文字设置；2、镜像并分析内容；3、确定预分行；4、构造候选布局；5、选择气泡和字号；6、绘制图像文字；7、返回结果及元数据。
 * @param {string} text - 对话框文本
 * @param {number} index - 图片索引
 * @param {object} dialogTemplate - 对话框模板（包含image）
 * @param {string|null} customAspectRatio - 自定义宽高比
 * @param {boolean} mirrorH - 是否水平镜像对话框（不镜像文字）
 * @param {boolean} mirrorV - 是否垂直镜像对话框（不镜像文字）
 * @returns {object} 包含canvas和相关信息的对象
 */
export function generateSingleImageNew(text, index, dialogTemplate, customAspectRatio = null, mirrorH = false, mirrorV = false) {
    // 1、检查模板，并从页面控件读取字体、描边和非负字间距。
    if (!dialogTemplate || !dialogTemplate.image) {
        console.error('无效的对话框模板');
        return null;
    }
    
    // 获取参数
    const fontFamily = document.getElementById('fontSelect').value;
    const fontColor = document.getElementById('fontColor').value;
    const fontSize = parseInt(document.getElementById('fontSize').value);
    const strokeColor = document.getElementById('strokeColor').value;
    const strokeValue = parseInt(document.getElementById('strokeWidth').value);
    const strokeWidth = convertStrokeValueToPixels(strokeValue, fontSize);
    const isBold = false;
    const isItalic = false;
    const letterSpacingInput = document.getElementById('letterSpacingPercent');
    let letterSpacingPercent = parseFloat(letterSpacingInput?.value);
    if (!Number.isFinite(letterSpacingPercent)) {
        letterSpacingPercent = 20;
    }
    if (letterSpacingPercent < 0) {
        letterSpacingPercent = 0;
    }
    const letterSpacingRatio = letterSpacingPercent / 100;
    
    // 计算字数（用于后续分行规则）
    const rawLen = Array.from(text).length;
    
    // 默认采用自动模式；若传入自定义（来自按钮）则使用自定义
    // 根据字数阈值选择默认形状
    let defaultAspect = 'narrow';
    if (rawLen <= 10) defaultAspect = 'wide';
    else if (rawLen <= 20) defaultAspect = 'medium';
    else defaultAspect = 'narrow';
    const aspectRatio = customAspectRatio || defaultAspect;
    
    let originalImage = dialogTemplate.image;
    
    // 2、只镜像对话框图像，再分析内容和尾部，文字保持正常方向。
    if (mirrorH) {
        originalImage = mirrorImageH(originalImage);
        console.log('🔄 已应用水平镜像');
    }
    if (mirrorV) {
        originalImage = mirrorImageV(originalImage);
        console.log('🔄 已应用垂直镜像');
    }
    
    const analysis = analyzeDialogImage(originalImage, {
        paddingRatio: 0.15  // 15%内边距
    });
    
    // 如果检测到尾部，输出提示信息
    if (analysis.hasTail) {
        console.log(`📌 对话框有垂直尾部，主区域高度=${analysis.mainArea.height}px，尾部高度=${analysis.tailHeight}px`);
    }
    if (analysis.hasHorizontalTail) {
        console.log(`📌 对话框有${analysis.tailSide === 'left' ? '左侧' : '右侧'}横向尾部，主区域宽度=${analysis.mainArea.width}px`);
    }
    
    // 创建临时canvas用于精确文本测量
    const tempCanvas = document.createElement('canvas');
    const tempCtx = tempCanvas.getContext('2d');
    
    // 扩展裁剪区域以包含边框（基于fullArea保留完整对话框含尖角）
    const borderMargin = 5; // 给边框留5px边距
    const expandedCropArea = {
        x: Math.max(0, analysis.fullArea.x - borderMargin),
        y: Math.max(0, analysis.fullArea.y - borderMargin),
        width: Math.min(originalImage.width - Math.max(0, analysis.fullArea.x - borderMargin), 
                       analysis.fullArea.width + borderMargin * 2),
        height: Math.min(originalImage.height - Math.max(0, analysis.fullArea.y - borderMargin), 
                        analysis.fullArea.height + borderMargin * 2)
    };
    
    console.log(`✂️ 裁剪完整对话框: (${expandedCropArea.x},${expandedCropArea.y},${expandedCropArea.width}x${expandedCropArea.height})`);
    
    // 3、按形状和字数确定目标行数，预分行文本供后续缩放及排版共用。
    /**
     * 按目标行数均分文字。
     * 处理流程：1、处理单行和空文本；2、向前面的行分配向上取整的字数；3、将剩余字符作为末行。
     */
    const intelligentLineBreak = (src, targetLines, textAreaWidth, ctx) => {
        // 1、单行或空文本无需拆分。
        if (targetLines === 1 || !src) return { text: src, maxLines: targetLines };
        
        const chars = Array.from(src);
        const maxWidth = textAreaWidth * 0.95;
        const letterSpacing = fontSize * letterSpacingRatio;
        const totalChars = chars.length;
        
        // 策略：平均分配，除不尽时前面每行向上取整+1，最后一行拿剩余
        const avgCharsPerLine = totalChars / targetLines;
        const targetCharsForFirstLines = Math.ceil(avgCharsPerLine);
        
        const lines = [];
        let charIndex = 0;
        
        // 2、前 n-1 行按向上取整的平均字数分配。
        for (let lineIdx = 0; lineIdx < targetLines - 1; lineIdx++) {
            let currentLine = '';
            let charCount = 0;
            
            while (charIndex < chars.length && charCount < targetCharsForFirstLines) {
                currentLine += chars[charIndex];
                charIndex++;
                charCount++;
            }
            
            if (currentLine) {
                lines.push(currentLine);
            }
        }
        
        // 3、将剩余所有字符放入最后一行。
        if (charIndex < chars.length) {
            lines.push(chars.slice(charIndex).join(''));
        }
        
        return { text: lines.join('\n'), maxLines: targetLines };
    };
    
    // 确定目标行数和分行策略
    const isManualAspect = !!customAspectRatio;
    let lineBreakResult;
    
    if (isManualAspect) {
        // 用户手动选择形状时
        if (aspectRatio === 'wide') {
            // 宽型：强制单行（添加特殊标记确保被识别为预分行）
            lineBreakResult = { text: text + '\n_SINGLE_LINE_', maxLines: 1 };
        } else if (aspectRatio === 'medium') {
            // 标准：智能分2行
            lineBreakResult = intelligentLineBreak(text, 2, analysis.textArea.width, tempCtx);
        } else {
            // 窄型：智能分多行（根据文字数量）
            const targetLines = rawLen <= 10 ? 1 : rawLen <= 20 ? 2 : Math.ceil((rawLen - 20) / 15) + 2;
            lineBreakResult = intelligentLineBreak(text, Math.max(3, targetLines), analysis.textArea.width, tempCtx);
        }
    } else {
        // 默认（自动）智能分行
        const targetLines = rawLen <= 10 ? 1 : rawLen <= 20 ? 2 : Math.ceil((rawLen - 20) / 15) + 2;
        if (rawLen <= 10) {
            lineBreakResult = { text: text + '\n_SINGLE_LINE_', maxLines: 1 };
        } else {
            lineBreakResult = intelligentLineBreak(text, targetLines, analysis.textArea.width, tempCtx);
        }
    }
    
    const forcedText = lineBreakResult.text;
    const maxLinesLimit = lineBreakResult.maxLines;

    // === 策略：优先扩大气泡，再缩小字体 ===
    // 1. 先尝试扩大气泡（增加宽高缩放比例），保持原字号
    // 2. 如果气泡扩大到最大还放不下，再逐步缩小字体
    const bubbleScaleFactors = [1.5, 1.3, 1.15, 1.0];  // 气泡扩张倍数，最大3倍
    const fontReduceFactors = [0.95, 0.85, 0.75, 0.65, 0.5];  // 字体缩小比例

    // 文字区域（相对于裁剪区域）
    const relativeTextArea = {
        x: analysis.textArea.x - expandedCropArea.x,
        y: analysis.textArea.y - expandedCropArea.y,
        width: analysis.textArea.width,
        height: analysis.textArea.height
    };
    const relativeMainArea = {
        x: analysis.mainArea.x - expandedCropArea.x,
        y: analysis.mainArea.y - expandedCropArea.y,
        width: analysis.mainArea.width,
        height: analysis.mainArea.height
    };

    const dpiScale = 4;
    const outerPadding = 50; // 50px外边距

    // 4、构造包含图像缩放、留白和文字布局的候选方案。
    /**
     * 计算指定气泡倍数与目标字号的布局候选。
     * 处理流程：1、按原字号计算图像缩放；2、应用气泡扩张；3、转换文字坐标并留出安全边距；4、搜索字号并汇总度量。
     */
    const buildMetrics = (bubbleScale, fontSizeToUse) => {
        // 1、使用原始字号计算气泡缩放，保持各字号候选的气泡基准一致。
        const scaleInfoCandidate = calculateOptimalScale(
            forcedText,
            fontSize,  // 用原始字号计算气泡大小
            expandedCropArea.width,
            expandedCropArea.height,
            analysis.textArea,
            aspectRatio,
            tempCtx,
            fontFamily,
            isBold,
            isItalic,
            letterSpacingRatio
        );

        // 2、将扩张倍数同步应用到宽高及横纵缩放比例。
        const expandedScaleInfo = {
            ...scaleInfoCandidate,
            width: Math.round(scaleInfoCandidate.width * bubbleScale),
            height: Math.round(scaleInfoCandidate.height * bubbleScale),
            widthScale: scaleInfoCandidate.widthScale * bubbleScale,
            heightScale: scaleInfoCandidate.heightScale * bubbleScale
        };

        // 3、将文字和主体区域转换到输出坐标，并增加外边距与角部安全距离。
        const scaledTextAreaCandidate = scaleTextArea(
            relativeTextArea,
            expandedScaleInfo.widthScale,
            expandedScaleInfo.heightScale
        );

        const scaledMainAreaCandidate = analysis.hasTail
            ? scaleTextArea(
                relativeMainArea,
                expandedScaleInfo.widthScale,
                expandedScaleInfo.heightScale
            )
            : scaledTextAreaCandidate;

        const finalWidthCandidate = expandedScaleInfo.width + outerPadding * 2;
        const finalHeightCandidate = expandedScaleInfo.height + outerPadding * 2;

        let dialogXCandidate = (finalWidthCandidate - expandedScaleInfo.width) / 2;
        let dialogYCandidate = outerPadding;
        dialogXCandidate = alignToDevicePixel(dialogXCandidate, dpiScale);
        dialogYCandidate = alignToDevicePixel(dialogYCandidate, dpiScale);

        const adjustedTextAreaCandidate = {
            x: alignToDevicePixel(scaledTextAreaCandidate.x + dialogXCandidate, dpiScale),
            y: alignToDevicePixel(scaledTextAreaCandidate.y + dialogYCandidate, dpiScale),
            width: Math.round(scaledTextAreaCandidate.width),
            height: Math.round(scaledTextAreaCandidate.height)
        };

        const cornerInsetXCandidate = Math.max(3, Math.round(adjustedTextAreaCandidate.width * 0.03));
        const safeAdjustedTextAreaCandidate = {
            x: adjustedTextAreaCandidate.x + cornerInsetXCandidate,
            y: adjustedTextAreaCandidate.y,
            width: Math.max(1, adjustedTextAreaCandidate.width - cornerInsetXCandidate * 2),
            height: adjustedTextAreaCandidate.height
        };

        // 4、在候选气泡内搜索可用字号，返回完整绘制参数。
        const layoutCandidate = findOptimalFontSize(
            tempCtx,
            forcedText,
            safeAdjustedTextAreaCandidate,
            fontSizeToUse,
            fontFamily,
            isBold,
            isItalic,
            Math.max(12, fontSizeToUse * 0.5),  // 最小字号
            Math.max(fontSizeToUse * 1.5, fontSizeToUse + 80),  // 最大字号
            letterSpacingRatio
        );

        return {
            bubbleScale,
            fontSizeToUse,
            scaleInfo: expandedScaleInfo,
            scaledTextArea: scaledTextAreaCandidate,
            scaledMainArea: scaledMainAreaCandidate,
            finalWidth: finalWidthCandidate,
            finalHeight: finalHeightCandidate,
            dialogX: dialogXCandidate,
            dialogY: dialogYCandidate,
            adjustedTextArea: adjustedTextAreaCandidate,
            safeAdjustedTextArea: safeAdjustedTextAreaCandidate,
            layout: layoutCandidate
        };
    };

    let selection = null;
    let fallbackSelection = null;
    
    // 5、先尝试气泡扩张方案，再降低字号；全部失败时保留最后一个候选。
    console.log(`🔍 第一阶段：尝试扩大气泡（保持字号 ${fontSize}）`);
    for (const bubbleScale of bubbleScaleFactors) {
        const metrics = buildMetrics(bubbleScale, fontSize);
        fallbackSelection = metrics;
        console.log(`  - 气泡倍数 ${bubbleScale}x: ${metrics.layout.valid ? '✓ 成功' : '✗ 失败'}`);
        if (metrics.layout.valid) {
            selection = metrics;
            console.log(`✅ 找到合适方案：气泡 ${bubbleScale}x，字号 ${fontSize}`);
            break;
        }
    }

    // 第二阶段：如果扩大气泡还不够，缩小字体
    if (!selection) {
        console.log(`🔍 第二阶段：气泡已最大化，尝试缩小字体`);
        const maxBubbleScale = bubbleScaleFactors[0];  // 使用最大气泡
        for (const fontFactor of fontReduceFactors) {
            const reducedFontSize = Math.max(12, Math.round(fontSize * fontFactor));
            const metrics = buildMetrics(maxBubbleScale, reducedFontSize);
            fallbackSelection = metrics;
            console.log(`  - 字号 ${reducedFontSize} (${(fontFactor * 100).toFixed(0)}%): ${metrics.layout.valid ? '✓ 成功' : '✗ 失败'}`);
            if (metrics.layout.valid) {
                selection = metrics;
                console.log(`✅ 找到合适方案：气泡 ${maxBubbleScale}x，字号 ${reducedFontSize}`);
                break;
            }
        }
    }

    // 兜底方案
    if (!selection) {
        console.warn(`⚠️ 所有方案都失败，使用兜底方案`);
        selection = fallbackSelection || buildMetrics(bubbleScaleFactors[0], Math.max(12, Math.round(fontSize * 0.5)));
    }

    const {
        scaleInfo,
        scaledTextArea,
        scaledMainArea,
        finalWidth,
        finalHeight,
        dialogX,
        dialogY,
        adjustedTextArea,
        safeAdjustedTextArea,
        layout
    } = selection;

    // 6、裁剪并缩放对话框，在四倍像素画布上绘制正常方向的文字。
    const scaledDialogCanvas = scaleDialogImage(
        originalImage,
        scaleInfo.width,
        scaleInfo.height,
        false,  // 禁用平滑处理，保持像素清晰
        expandedCropArea  // 传入扩展后的裁剪区域
    );

    const canvas = document.createElement('canvas');
    canvas.width = finalWidth * dpiScale;
    canvas.height = finalHeight * dpiScale;
    const ctx = canvas.getContext('2d', {
        alpha: true,
        desynchronized: false,
        willReadFrequently: false
    });

    ctx.scale(dpiScale, dpiScale);

    ctx.imageSmoothingEnabled = false;

    // 在水平居中位置绘制对话框（如果是镜像的，图片已经在之前被翻转过了）
    ctx.drawImage(scaledDialogCanvas, dialogX, dialogY);

    if (mirrorH || mirrorV) {
        const mirrorInfo = [];
        if (mirrorH) mirrorInfo.push('水平');
        if (mirrorV) mirrorInfo.push('垂直');
        console.log(`🔄 对话框${mirrorInfo.join('+')}镜像模式绘制: X=${dialogX.toFixed(2)}, Y=${dialogY}, 画布尺寸: ${finalWidth}x${finalHeight}`);
    } else {
        console.log(`🖼️ 对话框居中绘制: X=${dialogX.toFixed(2)}, Y=${dialogY}, 画布尺寸: ${finalWidth}x${finalHeight}`);
    }

    if (!layout.valid) {
        console.warn(`文字 "${text}" 无法完全适应对话框，将使用最小字体`);
    }
    
    drawTextWithLayout(
        ctx,
        layout,
        fontFamily,
        isBold,
        isItalic,
        fontColor,
        strokeColor,
        strokeWidth * dpiScale
    );
    
    // 7、返回画布、显示尺寸和实际设置，供预览、再次生成与导出使用。
    return {
        canvas,
        text,
        index,
        displayWidth: finalWidth,
        displayHeight: finalHeight,
        originalText: text,
        templateInfo: {
            id: dialogTemplate.id,
            categoryName: dialogTemplate.categoryName,
            name: dialogTemplate.name
        },
        settings: {
            fontFamily,
            fontColor,
            fontSize: layout.fontSize,
            actualFontSize: layout.fontSize,
            requestedFontSize: fontSize,
            strokeColor,
            strokeWidth,
            strokeValue,
            isBold,
            isItalic,
            letterSpacingPercent,
            letterSpacingRatio,
            // 记录实际选择的形状，便于前端显示
            aspectRatio: scaleInfo.selectedAspect || aspectRatio,
            mirrorH,
            mirrorV
        },
        analysisInfo: {
            originalSize: { width: originalImage.width, height: originalImage.height },
            scaledSize: { width: scaleInfo.width, height: scaleInfo.height },
            textArea: scaledTextArea,
            lineCount: layout.lines.length,
            hasTail: analysis.hasTail,
            mainAreaHeight: analysis.mainArea ? analysis.mainArea.height : analysis.fullArea.height,
            estimatedLines: scaleInfo.estimatedLines
        }
    };
}

/**
 * 生成所有对话框图片
 * 处理流程：1、检查文本和模板；2、过滤空行；3、逐行生成并隔离异常；4、返回成功结果。
 * @param {object} dialogTemplate - 选中的对话框模板
 * @returns {Array} 生成的图片数据数组
 */
export function generateImagesNew(dialogTemplate) {
    // 1、检查页面输入及选中模板是否具备生成条件。
    const textInput = document.getElementById('textInput').value;
    
    if (!textInput.trim()) {
        alert('请输入文本内容！');
        return [];
    }
    
    if (!dialogTemplate || !dialogTemplate.image) {
        alert('请选择一个对话框模板！');
        return [];
    }
    
    // 2、每个非空文本行对应一张独立对话框图片。
    const lines = textInput.split('\n').filter(line => line.trim() !== '');
    
    if (lines.length === 0) {
        alert('没有有效的文本内容！');
        return [];
    }
    
    // 3、逐张生成，某一行失败不会终止其余文本的处理。
    const generatedImages = [];
    lines.forEach((line, index) => {
        try {
            const imageData = generateSingleImageNew(line.trim(), index, dialogTemplate);
            if (imageData) {
                generatedImages.push(imageData);
            }
        } catch (error) {
            console.error(`生成第 ${index + 1} 张图片失败:`, error);
        }
    });
    
    // 4、返回成功生成的图片，并记录实际数量。
    console.log(`成功生成 ${generatedImages.length} 张对话框图片`);
    return generatedImages;
}
