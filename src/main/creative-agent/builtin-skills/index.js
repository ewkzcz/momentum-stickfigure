/**
 * 内置 Skills：直接复用 GitHub 上 MIT 许可的成熟 Skill（逐字收录，附 LICENSE），由 scripts/vendor-skills.mjs 生成。
 * 用户点击“安装内置 Skills”时写入其 Skills 文件夹，默认不启用。
 */
import gptImagePrompting from './vendored-gpt-image-prompting.js';
import seedancePrompt from './vendored-seedance-prompt.js';
import shortDrama from './vendored-short-drama.js';

export const BUILTIN_SKILLS = [gptImagePrompting, seedancePrompt, shortDrama];
