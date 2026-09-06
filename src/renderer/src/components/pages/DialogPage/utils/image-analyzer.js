/**
 * 图像分析模块
 * 负责分析对话框图片，找到最大的封闭白色区域用于文字排版
 */

/**
 * 判断像素是否为白色/浅色（包含边框内的白色）
 * 处理流程：1、读取颜色和透明度；2、排除透明像素；3、按加权亮度判断浅色。
 * @param {Uint8ClampedArray} imageData - 图像数据
 * @param {number} index - 像素索引
 * @param {number} threshold - 亮度阈值
 * @returns {boolean} 是否为白色
 */
function isWhitePixel(imageData, index, threshold = 200) {
    // 1、读取当前像素的四个通道。
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];
    
    // 2、透明区域不参与白色内容检测。
    if (a < 10) return false; // 透明像素不算白色
    
    // 3、按人眼亮度权重与阈值比较。
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    return brightness > threshold;
}

/**
 * 判断像素是否为黑色/深色（边框）
 * 处理流程：1、读取通道并排除透明像素；2、按加权亮度判断深色。
 * @param {Uint8ClampedArray} imageData - 图像数据
 * @param {number} index - 像素索引
 * @param {number} threshold - 亮度阈值
 * @returns {boolean} 是否为黑色
 */
function isBlackPixel(imageData, index, threshold = 50) {
    // 1、读取颜色通道，只检测具有可见透明度的像素。
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const a = imageData[index + 3];
    
    if (a < 10) return false;
    
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    // 2、亮度低于阈值时视为深色边框。
    return brightness < threshold;
}

/**
 * 判断像素是否为内容区域（白色或浅色，排除透明）
 * 处理流程：1、排除透明像素；2、将亮度高于边框阈值的像素归为内容。
 * @param {Uint8ClampedArray} imageData - 图像数据
 * @param {number} index - 像素索引
 * @returns {boolean} 是否为内容区域
 */
function isContentPixel(imageData, index) {
    // 1、透明像素不属于可排版内容。
    const a = imageData[index + 3];
    
    // 透明像素不是内容
    if (a < 10) return false;
    
    const r = imageData[index];
    const g = imageData[index + 1];
    const b = imageData[index + 2];
    const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
    
    // 2、非黑色且不透明的像素归为内容区域。
    return brightness > 40;
}

/**
 * 洪水填充算法：查找由非透明浅色像素组成的连通内容区域。
 * 处理流程：1、初始化待访问栈；2、过滤越界、已访问和非内容像素；3、扩展四邻域；4、返回连通区域。
 * @param {Uint8ClampedArray} imageData - 图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 * @param {number} startX - 起始X坐标
 * @param {number} startY - 起始Y坐标
 * @param {Set} visited - 已访问的像素集合
 * @returns {Array} 区域内的所有像素坐标
 */
function floodFill(imageData, width, height, startX, startY, visited) {
    // 1、用显式栈避免递归遍历大区域时耗尽调用栈。
    const region = [];
    const stack = [{x: startX, y: startY}];
    /**
     * 将像素坐标转换为访问集合索引。
     * 处理流程：1、按图像行宽展开二维坐标。
     */
    const key = (x, y) => y * width + x;
    
    // 2、跳过重复、越界及不符合内容条件的像素。
    while (stack.length > 0) {
        const {x, y} = stack.pop();
        const k = key(x, y);
        
        if (visited.has(k)) continue;
        
        if (x < 0 || x >= width || y < 0 || y >= height) continue;
        
        const index = (y * width + x) * 4;
        
        // 使用内容像素判断（包括白色区域）
        if (!isContentPixel(imageData, index)) continue;
        
        visited.add(k);
        region.push({x, y});
        
        // 3、将四个相邻像素加入后续搜索。
        stack.push({x: x + 1, y});
        stack.push({x: x - 1, y});
        stack.push({x, y: y + 1});
        stack.push({x, y: y - 1});
    }
    
    // 4、返回当前种子点对应的连通区域。
    return region;
}

/**
 * 找到图像中最大的内容区域（对话框区域）
 * 处理流程：1、读取图像像素；2、从中心和采样点搜索连通区域；3、选取最大主体；4、合并主体附近的尾部区域。
 * @param {HTMLImageElement} image - 对话框图片
 * @returns {Array} 最大的内容区域
 */
function findDialogContentRegion(image) {
    // 1、在离屏画布读取像素，并共享访问集合避免重复搜索。
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    
    const visited = new Set();
    const regions = [];
    
    // 2、先搜索中心区域，再每隔五像素扫描其他未访问区域。
    const centerX = Math.floor(canvas.width / 2);
    const centerY = Math.floor(canvas.height / 2);
    
    // 先从中心点开始
    const centerIndex = (centerY * canvas.width + centerX) * 4;
    if (isContentPixel(data, centerIndex)) {
        const centerRegion = floodFill(data, canvas.width, canvas.height, centerX, centerY, visited);
        if (centerRegion.length > 30) { // 降低阈值，兼容较小尾部
            regions.push(centerRegion);
        }
    }
    
    // 再搜索其他区域
    for (let y = 0; y < canvas.height; y += 5) { // 每5像素采样一次，提高效率
        for (let x = 0; x < canvas.width; x += 5) {
            const key = y * canvas.width + x;
            if (visited.has(key)) continue;
            
            const index = (y * canvas.width + x) * 4;
            if (isContentPixel(data, index)) {
                const region = floodFill(data, canvas.width, canvas.height, x, y, visited);
                if (region.length > 30) { // 降低阈值，保留小圆点尾巴
                    regions.push(region);
                }
            }
        }
    }
    
    // 3、按面积选择主体，并扩大包围盒作为尾部合并范围。
    regions.sort((a, b) => b.length - a.length);
    if (regions.length === 0) return [];

    const main = regions[0];
    const mainBox = calculateBoundingBox(main);
    const expandMargin = Math.max(20, Math.floor(Math.min(canvas.width, canvas.height) * 0.25));
    const expandedMainBox = {
        x: Math.max(0, mainBox.x - expandMargin),
        y: Math.max(0, mainBox.y - expandMargin),
        width: Math.min(canvas.width, mainBox.width + expandMargin * 2),
        height: Math.min(canvas.height, mainBox.height + expandMargin * 2)
    };

    /**
     * 判断候选区域是否与扩展主体相交。
     * 处理流程：1、计算矩形边界；2、排除四个方向完全分离的情况。
     */
    const withinExpanded = (box) => {
        // 1、计算候选区域与扩展主体的右下边界。
        const boxRight = box.x + box.width;
        const boxBottom = box.y + box.height;
        const expRight = expandedMainBox.x + expandedMainBox.width;
        const expBottom = expandedMainBox.y + expandedMainBox.height;
        // 2、任一轴没有完全分离时，矩形存在交叠。
        return !(box.x > expRight || boxRight < expandedMainBox.x || box.y > expBottom || boxBottom < expandedMainBox.y);
    };

    // 4、将附近的小块并入主体，保留气泡框分离的尾部圆点。
    let combined = [...main];
    for (let i = 1; i < regions.length; i++) {
        const r = regions[i];
        const rb = calculateBoundingBox(r);
        // 仅合并与主体相交或在扩展包围盒内的区域（典型气泡尾部）
        if (withinExpanded(rb)) {
            combined = combined.concat(r);
        }
    }

    return combined;
}

/**
 * 计算区域的边界框
 * 处理流程：1、处理空区域；2、累计坐标极值；3、转换为包含边界像素的矩形。
 * @param {Array} region - 区域像素坐标数组
 * @returns {object} 边界框 {x, y, width, height}
 */
function calculateBoundingBox(region) {
    // 1、空区域返回零尺寸边界。
    if (region.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
    }
    
    // 2、累计所有内容像素的坐标极值。
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    
    for (const {x, y} of region) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
    }
    
    // 3、尺寸加一以覆盖最大坐标对应的像素。
    return {
        x: minX,
        y: minY,
        width: maxX - minX + 1,
        height: maxY - minY + 1
    };
}

/**
 * 为文字排版添加内边距
 * 处理流程：1、按短边计算最小内边距；2、缩小矩形并保留正尺寸。
 * @param {object} bbox - 原始边界框
 * @param {number} paddingRatio - 内边距比例
 * @returns {object} 添加内边距后的区域
 */
function addTextPadding(bbox, paddingRatio = 0.1) {
    // 1、按短边缩放边距，至少留出十像素。
    const minDim = Math.min(bbox.width, bbox.height);
    const padding = Math.max(10, Math.floor(minDim * paddingRatio));
    
    // 2、缩小可排版区域，同时避免产生零或负尺寸。
    return {
        x: bbox.x + padding,
        y: bbox.y + padding,
        width: Math.max(1, bbox.width - padding * 2),
        height: Math.max(1, bbox.height - padding * 2)
    };
}

/**
 * 检测横向尾部（左侧或右侧的三角形）
 * 处理流程：1、统计每行边界；2、提取中部稳定宽度；3、检测左右延伸；4、补查上下尖角；5、返回主体横向边界。
 * @param {Array} region - 区域像素坐标数组
 * @param {object} bbox - 边界框
 * @returns {object} 横向尾部信息
 */
function detectHorizontalTail(region, bbox) {
    // 1、统计每行左右边界，并按纵坐标排列。
    const rowBounds = new Map();
    
    region.forEach(p => {
        if (!rowBounds.has(p.y)) {
            rowBounds.set(p.y, { minX: p.x, maxX: p.x, count: 1 });
        } else {
            const row = rowBounds.get(p.y);
            row.minX = Math.min(row.minX, p.x);
            row.maxX = Math.max(row.maxX, p.x);
            row.count++;
        }
    });
    
    const rows = Array.from(rowBounds.entries())
        .map(([y, data]) => ({ 
            y, 
            minX: data.minX, 
            maxX: data.maxX,
            width: data.maxX - data.minX + 1
        }))
        .sort((a, b) => a.y - b.y);
    
    if (rows.length < 10) {
        return { hasHorizontalTail: false, tailSide: null, mainMinX: bbox.x, mainMaxX: bbox.x + bbox.width };
    }
    
    // 2、使用中间 40%-60% 的区域估计主体稳定边界。
    const midStart = Math.floor(rows.length * 0.4);
    const midEnd = Math.floor(rows.length * 0.6);
    const midRows = rows.slice(midStart, midEnd);
    
    // 找到稳定区域的左右边界
    let stableMinX = Math.min(...midRows.map(r => r.minX));
    let stableMaxX = Math.max(...midRows.map(r => r.maxX));
    let stableWidth = stableMaxX - stableMinX;
    
    // 3、找出所有行相对稳定边界的最大左右延伸。
    let hasLeftTail = false;
    let hasRightTail = false;
    let maxLeftExtension = 0;
    let maxRightExtension = 0;
    
    rows.forEach(row => {
        const leftExtension = stableMinX - row.minX;
        const rightExtension = row.maxX - stableMaxX;
        
        if (leftExtension > maxLeftExtension) maxLeftExtension = leftExtension;
        if (rightExtension > maxRightExtension) maxRightExtension = rightExtension;
    });
    
    console.log(`🔍 横向尾部检测: 最大左延伸=${maxLeftExtension}px, 最大右延伸=${maxRightExtension}px, 稳定宽度=${stableWidth}px`);
    
    // 如果延伸超过稳定宽度的6%或超过15px，认为有尾部（进一步降低阈值）
    const threshold = Math.max(15, stableWidth * 0.06);
    
    if (maxLeftExtension > threshold) {
        hasLeftTail = true;
        console.log(`✅ 检测到左侧尾部，主区域左边界从${bbox.x}调整到${stableMinX}`);
    }
    
    if (maxRightExtension > threshold) {
        hasRightTail = true;
        console.log(`✅ 检测到右侧尾部，主区域右边界从${bbox.x + bbox.width}调整到${stableMaxX}`);
    }
    
    // 4、额外检查顶部和底部尖角，记录顶部尖角结束位置。
    const topRows = rows.slice(0, Math.floor(rows.length * 0.3));  // 顶部30%
    const bottomRowsCheck = rows.slice(Math.floor(rows.length * 0.7));  // 底部30%
    let topTailEndY = bbox.y;  // 顶部尖角结束的Y坐标
    
    if (topRows.length > 0) {
        const topMinX = Math.min(...topRows.map(r => r.minX));
        const topMaxX = Math.max(...topRows.map(r => r.maxX));
        const topLeftExt = stableMinX - topMinX;
        const topRightExt = topMaxX - stableMaxX;
        
        console.log(`🔍 顶部尖角检测: 左延伸=${topLeftExt}px, 右延伸=${topRightExt}px, 阈值=${threshold}px`);
        
        if (topLeftExt > threshold || topRightExt > threshold) {
            // 找到尖角结束的位置（从上往下，第一个进入稳定区域的行）
            for (let i = 0; i < rows.length; i++) {
                const row = rows[i];
                const leftExt = stableMinX - row.minX;
                const rightExt = row.maxX - stableMaxX;
                
                if (leftExt <= threshold && rightExt <= threshold) {
                    topTailEndY = row.y;
                    console.log(`📍 顶部尖角结束于Y=${topTailEndY}，占用高度=${topTailEndY - bbox.y}px`);
                    break;
                }
            }
            
            if (topLeftExt > threshold) {
                hasLeftTail = true;
                console.log(`✅ 检测到顶部左侧尖角，延伸=${topLeftExt}px`);
            }
            if (topRightExt > threshold) {
                hasRightTail = true;
                console.log(`✅ 检测到顶部右侧尖角，延伸=${topRightExt}px`);
            }
        }
    }
    
    if (bottomRowsCheck.length > 0) {
        const bottomMinX = Math.min(...bottomRowsCheck.map(r => r.minX));
        const bottomMaxX = Math.max(...bottomRowsCheck.map(r => r.maxX));
        const bottomLeftExt = stableMinX - bottomMinX;
        const bottomRightExt = bottomMaxX - stableMaxX;
        
        console.log(`🔍 底部尖角检测: 左延伸=${bottomLeftExt}px, 右延伸=${bottomRightExt}px, 阈值=${threshold}px`);
        
        if (bottomLeftExt > threshold) {
            hasLeftTail = true;
            console.log(`✅ 检测到底部左侧尖角，延伸=${bottomLeftExt}px`);
        }
        if (bottomRightExt > threshold) {
            hasRightTail = true;
            console.log(`✅ 检测到底部右侧尖角，延伸=${bottomRightExt}px`);
        }
    }
    
    // 5、检测到尾部时使用稳定边界，否则保留完整横向范围。
    if (hasLeftTail || hasRightTail) {
        return { 
            hasHorizontalTail: true, 
            tailSide: hasLeftTail ? 'left' : 'right',
            mainMinX: stableMinX,
            mainMaxX: stableMaxX,
            topTailHeight: topTailEndY - bbox.y  // 顶部尖角占用的高度
        };
    }
    
    return { 
        hasHorizontalTail: false, 
        tailSide: null,
        mainMinX: bbox.x,
        mainMaxX: bbox.x + bbox.width,
        topTailHeight: 0
    };
}

/**
 * 智能检测对话框的尾部区域
 * 处理流程：1、统计行宽；2、建立主体宽度基准；3、按宽度比例检测双向尾部；4、补查连续收窄；5、补查底部尖角；6、汇总尾部范围。
 * @param {Array} region - 区域像素坐标数组
 * @param {object} bbox - 边界框
 * @returns {object} 尾部信息 {hasTail, tailHeight, mainAreaHeight, tailStartY}
 */
function detectDialogTail(region, bbox) {
    // 1、统计每一行的像素宽度并按纵坐标排列。
    const rowWidths = new Map();
    
    region.forEach(p => {
        if (!rowWidths.has(p.y)) {
            rowWidths.set(p.y, { minX: p.x, maxX: p.x, count: 1 });
        } else {
            const row = rowWidths.get(p.y);
            row.minX = Math.min(row.minX, p.x);
            row.maxX = Math.max(row.maxX, p.x);
            row.count++;
        }
    });
    
    // 将行数据转换为数组并排序
    const rows = Array.from(rowWidths.entries())
        .map(([y, data]) => ({
            y,
            width: data.maxX - data.minX + 1,
            count: data.count,
            minX: data.minX,
            maxX: data.maxX
        }))
        .sort((a, b) => a.y - b.y);
    
    if (rows.length < 5) {
        return { hasTail: false, tailHeight: 0, mainAreaHeight: bbox.height };
    }
    
    // 2、以上半部分的最大宽度作为主体宽度基准。
    let maxWidth = 0;
    let maxWidthIndex = 0;
    const topRows = rows.slice(0, Math.floor(rows.length * 0.5));
    
    topRows.forEach((row, idx) => {
        if (row.width > maxWidth) {
            maxWidth = row.width;
            maxWidthIndex = idx;
        }
    });
    
    // 从底部向上检查宽度变化
    let tailStartY = bbox.y + bbox.height;
    let topTailEndY = bbox.y;  // 顶部尾部结束的Y坐标
    let foundTail = false;
    
    // 检查底部50%区域（扩大检测范围）
    const bottomStart = Math.floor(rows.length * 0.5);
    const bottomRows = rows.slice(bottomStart);
    
    // 输出所有行的宽度数据（调试用）
    console.log(`📊 行数据: 总计${rows.length}行, 检查底部${bottomRows.length}行, bbox起点Y=${bbox.y}`);
    if (rows.length <= 30) {
        console.log('宽度详情:', rows.slice(0, 10).map(r => `Y${r.y}:${r.width}px`).join(', '));
        console.log('底部详情:', rows.slice(-10).map(r => `Y${r.y}:${r.width}px`).join(', '));
    }
    
    // 3、比较底部最小宽度与主体宽度，双向确定尾部和主体分界。
    const bottomMinWidth = Math.min(...bottomRows.map(r => r.width));
    const widthRatio = bottomMinWidth / maxWidth;
    
    console.log(`🔍 宽度分析: 最大=${maxWidth}px, 底部最小=${bottomMinWidth}px, 比例=${widthRatio.toFixed(2)}`);
    
    // 如果底部最小宽度小于最大宽度的90%，认为有尾部（大幅降低阈值）
    if (widthRatio < 0.90) {
        foundTail = true;
        
        // 找到宽度开始持续下降的位置
        // 从中上部找到宽度稳定的区域（30%-65%）
        let stableWidth = 0;
        for (let i = Math.floor(rows.length * 0.3); i < Math.floor(rows.length * 0.65); i++) {
            if (rows[i].width > stableWidth) {
                stableWidth = rows[i].width;
            }
        }
        
        // 从上往下找第一个达到稳定宽度的位置（顶部尾部结束）
        // 从下往上找最后一个保持稳定宽度的位置（底部尾部开始）
        const threshold = stableWidth * 0.92;
        let topTailEnd = bbox.y;
        let bottomTailStart = bbox.y + bbox.height;
        
        console.log(`🔍 双向检测: 稳定宽度=${stableWidth}px, 阈值=${threshold.toFixed(0)}px`);
        
        // 从上往下找顶部尾部结束点
        for (let i = 0; i < rows.length; i++) {
            if (rows[i].width >= threshold) {
                topTailEnd = rows[i].y;
                const relativePos = ((topTailEnd - bbox.y) / bbox.height * 100).toFixed(0);
                console.log(`📍 顶部尾部结束: Y=${topTailEnd} (相对${relativePos}%), 宽度=${rows[i].width}px`);
                break;
            }
        }
        
        // 从下往上找底部尾部开始点
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].width >= threshold) {
                bottomTailStart = i < rows.length - 1 ? rows[i + 1].y : bbox.y + bbox.height;
                const relativePos = ((bottomTailStart - bbox.y) / bbox.height * 100).toFixed(0);
                console.log(`📍 底部尾部开始: Y=${bottomTailStart} (相对${relativePos}%), 宽度=${rows[i].width}px`);
                break;
            }
        }
        
        // 对于双尾：用顶部尾部结束点到底部尾部开始点之间的区域作为主区域
        // 如果只有一侧尾部，使用检测到的那一侧
        if (topTailEnd > bbox.y && bottomTailStart < bbox.y + bbox.height) {
            // 有双尾
            topTailEndY = topTailEnd;
            tailStartY = bottomTailStart;
            const topHeight = topTailEnd - bbox.y;
            const mainHeight = bottomTailStart - topTailEnd;
            const bottomHeight = bbox.y + bbox.height - bottomTailStart;
            console.log(`📍 双尾检测: 顶部${topHeight}px + 主区域${mainHeight}px + 底部${bottomHeight}px`);
        } else if (topTailEnd > bbox.y) {
            // 只有顶部尾部
            topTailEndY = topTailEnd;
            tailStartY = bbox.y + bbox.height;
            console.log(`📍 仅顶部尾部: 结束于Y=${topTailEndY}`);
        } else {
            // 只有底部尾部
            tailStartY = bottomTailStart;
            console.log(`📍 仅底部尾部: 起点Y=${tailStartY}`);
        }
    }
    
    // 4、统计底部连续收窄趋势，在前一检测未命中时补充判断。
    let narrowCount = 0;
    let totalComparisons = 0;
    
    for (let i = 1; i < bottomRows.length; i++) {
        if (bottomRows[i].width < bottomRows[i-1].width) {
            narrowCount++;
        }
        totalComparisons++;
    }
    
    const narrowRatio = narrowCount / Math.max(1, totalComparisons);
    console.log(`📉 收窄分析: ${narrowCount}/${totalComparisons} = ${(narrowRatio*100).toFixed(0)}%`);
    
    // 如果超过15%的行在收窄，也认为有尾部（大幅降低阈值）
    if (!foundTail && narrowRatio > 0.15) {
        foundTail = true;
        
        // 找到中部区域的稳定宽度
        let midWidth = 0;
        for (let i = Math.floor(rows.length * 0.4); i < Math.floor(rows.length * 0.6); i++) {
            if (rows[i].width > midWidth) {
                midWidth = rows[i].width;
            }
        }
        
        // 从下往上找宽度变化点
        const narrowThreshold = midWidth * 0.92;
        console.log(`🔍 收窄检测尾部起点: 中部宽度=${midWidth}px, 阈值=${narrowThreshold.toFixed(0)}px, 从下往上`);
        for (let i = rows.length - 1; i >= 0; i--) {
            if (rows[i].width < narrowThreshold) {
                tailStartY = i < rows.length - 1 ? rows[i + 1].y : rows[i].y;
                const relativePos = ((tailStartY - bbox.y) / bbox.height * 100).toFixed(0);
                console.log(`📍 尾部起点: Y=${tailStartY} (相对${relativePos}%, 收窄检测)`);
                break;
            }
        }
    }
    
    // 5、前两种检测未命中时，检查末尾五行是否形成尖角。
    if (!foundTail && bottomRows.length >= 5) {
        const lastFiveRows = bottomRows.slice(-5);
        const avgLastFiveWidth = lastFiveRows.reduce((sum, r) => sum + r.width, 0) / lastFiveRows.length;
        const lastFiveRatio = avgLastFiveWidth / maxWidth;
        
        console.log(`🔺 尖角检测: 最后5行平均宽度=${avgLastFiveWidth.toFixed(0)}px, 比例=${lastFiveRatio.toFixed(2)}`);
        
        // 如果最后几行平均宽度小于最大宽度的95%，认为是尖角尾部（大幅降低阈值）
        if (lastFiveRatio < 0.95) {
            foundTail = true;
            
            // 找到中间区域的稳定宽度
            let stableWidth = 0;
            for (let i = Math.floor(rows.length * 0.3); i < Math.floor(rows.length * 0.65); i++) {
                if (rows[i].width > stableWidth) {
                    stableWidth = rows[i].width;
                }
            }
            
            // 从下往上找宽度变化点
            const sharpThreshold = stableWidth * 0.92;
            console.log(`🔍 尖角检测尾部起点: 稳定宽度=${stableWidth}px, 阈值=${sharpThreshold.toFixed(0)}px, 从下往上`);
            for (let i = rows.length - 1; i >= 0; i--) {
                if (rows[i].width < sharpThreshold) {
                    tailStartY = i < rows.length - 1 ? rows[i + 1].y : rows[i].y;
                    const relativePos = ((tailStartY - bbox.y) / bbox.height * 100).toFixed(0);
                    console.log(`📍 尾部起点: Y=${tailStartY} (相对${relativePos}%, 尖角检测)`);
                    break;
                }
            }
        }
    }
    
    // 6、输出尾部与主体范围，并保证返回高度不为负。
    const tailHeight = bbox.y + bbox.height - tailStartY;
    const mainAreaHeight = tailStartY - bbox.y;
    
    if (foundTail) {
        const tailPercent = ((tailStartY - bbox.y) / bbox.height * 100).toFixed(1);
        console.log(`✅ 检测到尾部: 起点在${tailPercent}%位置, 尾部高度=${tailHeight}px, 主区域=${mainAreaHeight}px`);
    } else {
        console.log(`❌ 未检测到尾部，使用完整区域`);
    }
    
    return {
        hasTail: foundTail,
        tailHeight: Math.max(0, tailHeight),
        mainAreaHeight: foundTail ? Math.max(10, mainAreaHeight) : bbox.height,
        tailStartY: foundTail ? tailStartY : bbox.y + bbox.height,
        topTailEndY: topTailEndY  // 顶部尾部结束的Y坐标
    };
}

/**
 * 分析对话框图片，找到最大的文字排版区域
 * 处理流程：1、识别连通内容；2、空结果回退整图；3、检测横纵尾部；4、计算主体区域；5、添加排版内边距并汇总。
 * @param {HTMLImageElement} image - 对话框图片
 * @param {object} options - 选项
 * @returns {object} 文字排版区域信息
 */
export function analyzeDialogImage(image, options = {}) {
    // 1、读取分析选项并提取包含尾部的主体内容。
    const {
        paddingRatio = 0.1,
        minRegionSize = 100
    } = options;
    
    // 使用新的区域检测方法
    const contentRegion = findDialogContentRegion(image);
    
    // 2、无法识别内容时使用整幅图像，保证后续仍有区域可用。
    if (contentRegion.length === 0) {
        console.warn('⚠️ 未找到内容区域，使用整个图片');
        return {
            textArea: {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height
            },
            fullArea: {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height
            },
            mainArea: {
                x: 0,
                y: 0,
                width: image.width,
                height: image.height
            },
            imageWidth: image.width,
            imageHeight: image.height,
            regionCount: 0,
            hasTail: false
        };
    }
    
    const fullArea = calculateBoundingBox(contentRegion);
    console.log(`📦 找到内容区域: ${fullArea.width}x${fullArea.height}, 起点(${fullArea.x},${fullArea.y}), 像素数=${contentRegion.length}`);
    console.log(`📐 原始图片尺寸: ${image.width}x${image.height}, 内容区域占比: ${(fullArea.width/image.width*100).toFixed(0)}% x ${(fullArea.height/image.height*100).toFixed(0)}%`);
    
    // 3、分别识别横向尖角和垂直尾部。
    const horizontalTailInfo = detectHorizontalTail(contentRegion, fullArea);
    
    // 智能检测垂直尾部
    const tailInfo = detectDialogTail(contentRegion, fullArea);
    
    // 4、合并顶部偏移和左右范围，排除尾部占用空间。
    const horizontalTopOffset = horizontalTailInfo.topTailHeight || 0;
    const verticalTopOffset = tailInfo.topTailEndY > fullArea.y ? (tailInfo.topTailEndY - fullArea.y) : 0;
    const topOffset = Math.max(horizontalTopOffset, verticalTopOffset);
    
    const mainArea = {
        x: horizontalTailInfo.mainMinX,
        y: fullArea.y + topOffset,
        width: horizontalTailInfo.mainMaxX - horizontalTailInfo.mainMinX,
        height: tailInfo.hasTail ? (tailInfo.tailStartY - (fullArea.y + topOffset)) : (fullArea.height - topOffset)
    };
    
    if (topOffset > 0) {
        console.log(`📍 顶部偏移: 横向=${horizontalTopOffset}px, 垂直=${verticalTopOffset}px, 使用=${topOffset}px`);
        console.log(`📍 主区域Y从${fullArea.y}调整到${mainArea.y}, 高度=${mainArea.height}px`);
    }
    
    // 5、在主体内加入文字边距，返回布局及调试所需区域信息。
    const textArea = addTextPadding(mainArea, paddingRatio);
    
    console.log(`📐 主区域: ${mainArea.width}x${mainArea.height}, 起点(${mainArea.x},${mainArea.y})`);
    console.log(`📝 文字区域: ${textArea.width}x${textArea.height}, 起点(${textArea.x},${textArea.y})`);
    
    return {
        textArea,
        fullArea,
        mainArea,
        imageWidth: image.width,
        imageHeight: image.height,
        regionCount: 1,
        largestRegionSize: contentRegion.length,
        hasTail: tailInfo.hasTail,
        tailHeight: tailInfo.tailHeight,
        tailStartY: tailInfo.tailStartY,
        hasHorizontalTail: horizontalTailInfo.hasHorizontalTail,
        tailSide: horizontalTailInfo.tailSide
    };
}

/**
 * 可视化调试
 * 处理流程：1、绘制原图；2、标记完整区域；3、标记带尾部的主体；4、标记文字区域。
 * @param {HTMLImageElement} image - 对话框图片
 * @param {object} analysis - 分析结果
 * @returns {HTMLCanvasElement} 可视化结果canvas
 */
export function visualizeAnalysis(image, analysis) {
    // 1、创建同尺寸画布作为分析标记底图。
    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext('2d');
    
    ctx.drawImage(image, 0, 0);
    
    // 2、用蓝色实线标记完整内容区域。
    ctx.strokeStyle = 'rgba(0, 100, 255, 0.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(
        analysis.fullArea.x,
        analysis.fullArea.y,
        analysis.fullArea.width,
        analysis.fullArea.height
    );
    
    // 3、检测到垂直尾部时，用绿色标记主区域。
    if (analysis.mainArea && analysis.hasTail) {
        ctx.strokeStyle = 'rgba(0, 255, 100, 0.8)';
        ctx.lineWidth = 3;
        ctx.strokeRect(
            analysis.mainArea.x,
            analysis.mainArea.y,
            analysis.mainArea.width,
            analysis.mainArea.height
        );
    }
    
    // 4、用红色虚线标记实际文字排版区域。
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.strokeRect(
        analysis.textArea.x,
        analysis.textArea.y,
        analysis.textArea.width,
        analysis.textArea.height
    );
    ctx.setLineDash([]);
    
    return canvas;
}
