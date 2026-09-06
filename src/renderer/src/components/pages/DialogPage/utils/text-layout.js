/**
 * 文本布局计算模块
 * 负责在封闭区域内智能排版文字
 */

/**
 * 在指定区域内计算文字的最佳排版
 * 处理流程：1、设置字体与间距；2、按显式换行或宽度拆行；3、计算居中位置并返回有效性。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容（可能包含\n预分行）
 * @param {object} textArea - 文字区域 {x, y, width, height}
 * @param {number} fontSize - 字体大小
 * @param {string} fontFamily - 字体名称
 * @param {boolean} isBold - 是否加粗
 * @param {boolean} isItalic - 是否斜体
 * @returns {object} 布局信息
 */
export function calculateTextLayoutInArea(ctx, text, textArea, fontSize, fontFamily, isBold, isItalic, letterSpacingRatio = 0.4) {
    // 1、统一测量字体、行高和非负字间距。
    const fontStyle = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fontSize}px ${fontFamily}`;
    ctx.font = fontStyle;
    
    const lineHeight = fontSize * 1.3;
    const normalizedRatio = Number.isFinite(letterSpacingRatio) ? Math.max(0, letterSpacingRatio) : 0;
    const letterSpacing = fontSize * normalizedRatio;
    
    const availableWidth = textArea.width;
    const availableHeight = textArea.height;
    
    // 2、优先保留显式分行，否则按可用宽度自动换行。
    const hasExplicitLineBreaks = (text || '').includes('\n');

    let lines = [];
    let exceedsLimits = false;
    
    if (hasExplicitLineBreaks) {
        // 文本已预先分行，直接按换行符拆分，不再自动换行
        lines = (text || '').split('\n').filter(line => line.length > 0 && line !== '_SINGLE_LINE_');
        // 检查是否超出高度
        const totalHeight = lines.length * lineHeight;
        exceedsLimits = totalHeight > availableHeight;
    } else {
        // 文本未分行，按原逻辑自动换行
        const maxLines = Math.floor(availableHeight / lineHeight);
        
        if (maxLines < 1) {
            console.warn('文字区域太小，无法容纳文字');
            return {
                lines: [],
                fontSize,
                lineHeight,
                letterSpacing,
                startX: textArea.x,
                startY: textArea.y,
                valid: false
            };
        }
        lines = splitTextIntoLines(ctx, text, availableWidth, maxLines, letterSpacing);
        exceedsLimits = lines.exceedsMaxLines || false;
    }
    
    // 3、计算文字块的垂直居中位置，越界状态交给上层调整字号。
    const totalTextHeight = lines.length * lineHeight;
    const startY = textArea.y + (textArea.height - totalTextHeight) / 2 + lineHeight / 2;
    
    const textAreaCenterX = textArea.x + textArea.width / 2;
    
    // 如果超出限制，标记为无效，让上层调整
    const isValid = lines.length > 0 && !exceedsLimits;
    
    return {
        lines,
        fontSize,
        lineHeight,
        letterSpacing,
        startX: textArea.x,
        startY,
        textAreaCenterX,
        textAreaWidth: textArea.width,
        textAreaHeight: textArea.height,
        valid: isValid
    };
}

/**
 * 将文字分行（考虑字间距）
 * 处理流程：1、按码点拆分文本；2、逐字符测量并断行；3、补齐末行并标记超限。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容
 * @param {number} maxWidth - 最大宽度
 * @param {number} maxLines - 最大行数
 * @param {number} letterSpacing - 字间距
 * @returns {Array<string>} 分行后的文字数组
 */
function splitTextIntoLines(ctx, text, maxWidth, maxLines, letterSpacing) {
    // 1、使用 Array.from 支持完整 Unicode 码点。
    const chars = Array.from(text);
    const lines = [];
    let currentLine = '';
    
    // 2、保留显式换行，并在下一字符超过宽度时换行。
    for (let i = 0; i < chars.length; i++) {
        // 显式换行：强制断行
        if (chars[i] === '\n') {
            if (currentLine) {
                lines.push(currentLine);
            }
            currentLine = '';
            continue;
        }
        const testLine = currentLine + chars[i];
        const testWidth = measureTextWithSpacing(ctx, testLine, letterSpacing);
        
        if (testWidth > maxWidth && currentLine !== '') {
            lines.push(currentLine);
            currentLine = chars[i];
        } else {
            currentLine = testLine;
        }
    }
    
    // 3、添加末行，保留全部文本并额外记录是否超过行数限制。
    if (currentLine) {
        lines.push(currentLine);
    }
    
    // 检查是否超出最大行数限制
    lines.exceedsMaxLines = lines.length > maxLines;
    
    return lines;
}

/**
 * 测量文字宽度（考虑字间距）
 * 处理流程：1、处理空文本；2、将原生测量宽度与字符间距相加。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容
 * @param {number} letterSpacing - 字间距
 * @returns {number} 文字宽度
 */
function measureTextWithSpacing(ctx, text, letterSpacing) {
    // 1、空文本没有字符宽度和间距。
    if (!text) return 0;
    // 2、按当前实现的字符串长度计算字符之间的额外间距。
    const baseWidth = ctx.measureText(text).width;
    const spacingWidth = letterSpacing * (text.length - 1);
    return baseWidth + spacingWidth;
}

/**
 * 自适应字体大小 - 在区域内找到最合适的字体大小
 * 处理流程：1、限制初始字号并测量；2、向可容纳的方向搜索字号；3、无有效布局时返回最小字号后备结果。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {string} text - 文本内容（可能包含\n预分行）
 * @param {object} textArea - 文字区域
 * @param {number} initialFontSize - 初始字体大小
 * @param {string} fontFamily - 字体名称
 * @param {boolean} isBold - 是否加粗
 * @param {boolean} isItalic - 是否斜体
 * @param {number} minFontSize - 最小字体大小
 * @param {number} maxFontSize - 最大字体大小
 * @returns {object} 最佳布局信息
 */
export function findOptimalFontSize(ctx, text, textArea, initialFontSize, fontFamily, isBold, isItalic, minFontSize = 12, maxFontSize = 320, letterSpacingRatio = 0.4) {
    // 1、约束初始字号并根据字号大小选择搜索步长。
    let currentFontSize = Math.min(Math.max(initialFontSize, minFontSize), maxFontSize);
    let bestLayout = null;
    let step = currentFontSize >= 120 ? 6 : 2;
    
    // 先尝试初始字体大小
    let layout = calculateTextLayoutInArea(ctx, text, textArea, currentFontSize, fontFamily, isBold, isItalic, letterSpacingRatio);
    
    // 2、初始布局有效时尝试放大；无效时缩小并细化搜索。
    if (layout.valid) {
        bestLayout = { ...layout, fontSize: currentFontSize };
        
        // 尝试增大字体，找到最大可用字体
        let testSize = currentFontSize + step;
        while (testSize <= maxFontSize) {
            const testLayout = calculateTextLayoutInArea(ctx, text, textArea, testSize, fontFamily, isBold, isItalic, letterSpacingRatio);
            if (testLayout.valid && testLayout.lines.length > 0) {
                bestLayout = { ...testLayout, fontSize: testSize };
                testSize += step;
            } else {
                break;
            }
        }
    } else {
        // 当前字体太大，尝试缩小
        let testSize = currentFontSize - step;
        while (testSize >= minFontSize) {
            const testLayout = calculateTextLayoutInArea(ctx, text, textArea, testSize, fontFamily, isBold, isItalic, letterSpacingRatio);
            if (testLayout.valid && testLayout.lines.length > 0) {
                bestLayout = { ...testLayout, fontSize: testSize };
                // 继续尝试稍大一点的字体
                let refineSize = testSize + 1;
                while (refineSize < currentFontSize) {
                    const refineLayout = calculateTextLayoutInArea(ctx, text, textArea, refineSize, fontFamily, isBold, isItalic, letterSpacingRatio);
                    if (refineLayout.valid && refineLayout.lines.length > 0) {
                        bestLayout = { ...refineLayout, fontSize: refineSize };
                        refineSize++;
                    } else {
                        break;
                    }
                }
                break;
            }
            testSize -= step;
        }
    }
    
    // 3、没有合适布局时返回最小字号后备信息，仍保留无效标记供调用方判断。
    if (!bestLayout) {
        bestLayout = {
            lines: [text],
            fontSize: minFontSize,
            lineHeight: minFontSize * 1.4,
            letterSpacing: Math.max(0, minFontSize * (Number.isFinite(letterSpacingRatio) ? letterSpacingRatio : 0)),
            startX: textArea.x,
            startY: textArea.y + textArea.height / 2,
            textAreaCenterX: textArea.x + textArea.width / 2,
            valid: false
        };
    }
    
    console.log(`找到最佳字体: ${bestLayout.fontSize}px (初始: ${initialFontSize}px), 行数: ${bestLayout.lines.length}`);
    
    return bestLayout;
}

/**
 * 在canvas上绘制文字（使用布局信息）
 * 处理流程：1、验证布局；2、设置字体与渲染质量；3、逐行计算边界；4、按字符绘制描边和填充。
 * @param {CanvasRenderingContext2D} ctx - Canvas上下文
 * @param {object} layout - 布局信息
 * @param {string} fontFamily - 字体名称
 * @param {boolean} isBold - 是否加粗
 * @param {boolean} isItalic - 是否斜体
 * @param {string} fillColor - 填充颜色
 * @param {string} strokeColor - 描边颜色
 * @param {number} strokeWidth - 描边宽度
 */
export function drawTextWithLayout(ctx, layout, fontFamily, isBold, isItalic, fillColor, strokeColor, strokeWidth) {
    // 1、无效或空布局不参与绘制。
    if (!layout.valid || layout.lines.length === 0) {
        console.warn('布局无效，跳过绘制');
        return;
    }
    
    // 2、设置与布局计算相同的字体以及垂直居中基线。
    const fontStyle = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${layout.fontSize}px ${fontFamily}`;
    ctx.font = fontStyle;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    
    // 3、逐行计算居中起点，并将可绘制起点约束在文字区域边界内。
    layout.lines.forEach((line, i) => {
        const y = layout.startY + i * layout.lineHeight;
        
        const baseWidth = ctx.measureText(line).width;
        const spacingWidth = layout.letterSpacing * (line.length - 1);
        const totalWidth = baseWidth + spacingWidth;
        
        let x = layout.textAreaCenterX - totalWidth / 2;
        
        // 添加边界检查：左、右边界保护
        const minX = layout.startX;
        if (x < minX) {
            x = minX;
        }
        const hasWidth = typeof layout.textAreaWidth === 'number' && layout.textAreaWidth > 0;
        if (hasWidth) {
            const maxX = minX + layout.textAreaWidth;
            if (x + totalWidth > maxX) {
                const adjusted = maxX - totalWidth;
                if (adjusted < x) {
                    x = Math.max(minX, adjusted);
                }
            }
        }
        
        // 4、先描边再填充每个字符，并推进包含字间距的横向位置。
        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            const charWidth = ctx.measureText(char).width;
            
            if (strokeWidth > 0) {
                ctx.strokeStyle = strokeColor;
                ctx.lineWidth = strokeWidth;
                ctx.lineJoin = 'round';
                ctx.miterLimit = 2;
                ctx.strokeText(char, x, y);
            }
            
            ctx.fillStyle = fillColor;
            ctx.fillText(char, x, y);
            
            x += charWidth + layout.letterSpacing;
        }
    });
}
