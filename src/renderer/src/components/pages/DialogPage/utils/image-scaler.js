/**
 * 图像缩放模块
 * 负责对对话框进行非等比例缩放，以适应不同的文字长度
 */

/**
 * 根据文字量智能计算最佳缩放尺寸
 * 处理流程：1、确定形状边距；2、无画布时估算文字尺寸；3、有画布时精确测量；4、分别计算横纵缩放。
 * @param {string} text - 文字内容（已分行，用\n分隔）
 * @param {number} fontSize - 字体大小
 * @param {number} originalWidth - 原始图片宽度
 * @param {number} originalHeight - 原始图片高度
 * @param {object} textArea - 文字区域
 * @param {string} aspectRatio - 形状标识（用于区分宽/标准/窄的上下边距）
 * @param {CanvasRenderingContext2D} ctx - canvas上下文用于精确测量
 * @param {string} fontFamily - 字体名称
 * @param {boolean} isBold - 是否加粗
 * @param {boolean} isItalic - 是否斜体
 * @returns {object} 缩放后的尺寸
 */
export function calculateOptimalScale(text, fontSize, originalWidth, originalHeight, textArea, aspectRatio = 'auto', ctx = null, fontFamily = 'Arial', isBold = false, isItalic = false, letterSpacingRatio = 0.4) {
    // 1、根据文本行数和动态边距计算宽高，形状仅影响垂直边距。
    const selectedAspect = aspectRatio || 'dynamic';
    
    /**
     * 获取形状对应的垂直边距比例。
     * 处理流程：1、宽型使用较大边距，其余形状使用紧凑边距。
     */
    const getVerticalMarginRatio = (aspect) => {
        // 1、让宽型保留更宽松的上下空间。
        if (aspect === 'wide') return 0.15;
        return 0.1; // 标准和窄型更紧凑
    };
    
    // 2、缺少绘图上下文时，用字数和字号估算宽高及缩放比例。
    if (!ctx) {
        // 没有上下文时做一个合理的估算
        const approxCharW = fontSize * 0.6;
        const lines = (text || '').split('\n');
        const longestLineLen = Math.max(...lines.map(s => Array.from(s).length));
        const normalizedRatio = Number.isFinite(letterSpacingRatio) ? Math.max(0, letterSpacingRatio) : 0;
        const letterSpacing = fontSize * normalizedRatio;
        const maxLineWidth = longestLineLen * approxCharW + Math.max(0, (longestLineLen - 1)) * letterSpacing;
        const lineHeight = fontSize * 1.3;
        const totalTextHeight = lines.length * lineHeight;
        const charWidthEst = approxCharW;
        const horizontalMargin = Math.max(2, charWidthEst * 0.5);
        const verticalMargin = Math.max(2, fontSize * getVerticalMarginRatio(selectedAspect));
        const extraInsetRatio = 0.035;
        const extraInsetWidth = textArea.width * extraInsetRatio;
        const requiredWidth = maxLineWidth + 2 * horizontalMargin + 2 * extraInsetWidth;
        const requiredHeight = totalTextHeight + 2 * verticalMargin;
        const widthScale = requiredWidth / Math.max(1, textArea.width);
        const heightScale = requiredHeight / Math.max(1, textArea.height);
        
        return {
            width: Math.round(originalWidth * widthScale),
            height: Math.round(originalHeight * heightScale),
            widthScale,
            heightScale,
            baseScale: 1,
            estimatedLines: lines.length,
            estimatedTextWidth: maxLineWidth,
            selectedAspect
        };
    }

    // 3、使用实际字体测量每行宽度，并计入字间距。
    ctx.font = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    const linesArr = (text || '').split('\n');
    const normalizedRatio = Number.isFinite(letterSpacingRatio) ? Math.max(0, letterSpacingRatio) : 0;
    const letterSpacing = fontSize * normalizedRatio;
    const lineHeight = fontSize * 1.3;
    
    let maxLineWidth = 0;
    linesArr.forEach(line => {
        const lineChars = Array.from(line);
        const baseW = ctx.measureText(line).width;
        const spacing = Math.max(0, lineChars.length - 1) * letterSpacing;
        const totalW = baseW + spacing;
        if (totalW > maxLineWidth) maxLineWidth = totalW;
    });
    
    const totalTextHeight = linesArr.length * lineHeight;
    const charWidthEst = Math.max(1, ctx.measureText('中')?.width || fontSize * 0.6);
    const horizontalMargin = Math.max(2, charWidthEst * 0.5);
    const verticalMargin = Math.max(2, fontSize * getVerticalMarginRatio(selectedAspect));
    const extraInsetRatio = 0.035;
    const extraInsetWidth = textArea.width * extraInsetRatio;
    
    // 4、根据文字区域和动态边距独立计算横纵缩放，防止除以零。
    const requiredWidth = maxLineWidth + 2 * horizontalMargin + 2 * extraInsetWidth;
    const requiredHeight = totalTextHeight + 2 * verticalMargin;
    const widthScale = requiredWidth / Math.max(1, textArea.width);
    const heightScale = requiredHeight / Math.max(1, textArea.height);

    console.log(`缩放(形状=${selectedAspect}): 行数=${linesArr.length}, 宽度缩放=${widthScale.toFixed(2)}, 高度缩放=${heightScale.toFixed(2)}`);

    return {
        width: Math.round(originalWidth * widthScale),
        height: Math.round(originalHeight * heightScale),
        widthScale,
        heightScale,
        baseScale: 1,
        estimatedLines: linesArr.length,
        estimatedTextWidth: maxLineWidth,
        selectedAspect
    };
}

/**
 * 缩放对话框图片
 * 处理流程：1、创建目标画布；2、设置插值质量；3、绘制裁剪区域或完整图像。
 * @param {HTMLImageElement} image - 原始图片
 * @param {number} targetWidth - 目标宽度
 * @param {number} targetHeight - 目标高度
 * @param {boolean} highQuality - 是否使用高质量缩放
 * @param {object} cropArea - 可选的裁剪区域 {x, y, width, height}
 * @returns {HTMLCanvasElement} 缩放后的canvas
 */
export function scaleDialogImage(image, targetWidth, targetHeight, highQuality = true, cropArea = null) {
    // 1、创建透明背景的目标尺寸画布。
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: true });
    
    // 2、按质量开关决定是否使用图像平滑插值。
    if (highQuality) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
    } else {
        ctx.imageSmoothingEnabled = false;
    }
    
    // 3、存在裁剪区域时仅缩放该区域，否则缩放原图。
    if (cropArea) {
        // 裁剪并缩放指定区域
        ctx.drawImage(
            image,
            cropArea.x, cropArea.y, cropArea.width, cropArea.height,  // 源区域
            0, 0, targetWidth, targetHeight  // 目标区域
        );
        console.log(`✂️ 裁剪区域(${cropArea.x},${cropArea.y},${cropArea.width}x${cropArea.height}) → 缩放到${targetWidth}x${targetHeight}`);
    } else {
        // 直接缩放整个图片
        ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
    }
    
    return canvas;
}

/**
 * 根据缩放比例调整文字区域
 * 处理流程：1、对位置与尺寸分别应用横纵缩放并取整。
 * @param {object} originalTextArea - 原始文字区域
 * @param {number} widthScale - 宽度缩放比例
 * @param {number} heightScale - 高度缩放比例
 * @returns {object} 缩放后的文字区域
 */
export function scaleTextArea(originalTextArea, widthScale, heightScale) {
    // 1、让文字区域与变形后的对话框使用相同坐标比例。
    return {
        x: Math.round(originalTextArea.x * widthScale),
        y: Math.round(originalTextArea.y * heightScale),
        width: Math.round(originalTextArea.width * widthScale),
        height: Math.round(originalTextArea.height * heightScale)
    };
}

/**
 * 获取所有可用的宽高比选项
 * 处理流程：1、返回页面使用的形状选项。
 * @returns {Array} 宽高比选项数组
 */
export function getAspectRatioOptions() {
    // 1、提供宽型、标准型和窄型的展示配置。
    return [
        { value: 'wide', label: '宽型', emoji: '▭' },
        { value: 'medium', label: '标准型', emoji: '▬' },
        { value: 'narrow', label: '窄型', emoji: '⬜' }
    ];
}
