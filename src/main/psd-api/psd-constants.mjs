/** PSD纯常量：提供组件检测规则和错误消息，不读取Electron或应用目录。 */

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

export { COMPONENT_DETECTION_CONFIG, PSD_ERROR_MESSAGES };
