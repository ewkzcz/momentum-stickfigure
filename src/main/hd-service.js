/**
 * 抠图高清服务：管理本地配置、Python 执行环境以及图片处理的进程通信。
 */

import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'

// ==================== 常量定义 ====================

const CONFIG_FILE_NAME = 'hd-toolkit-config.json'
const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Pictures', 'hd-toolkit')

const DEFAULT_CONFIG = {
  pythonHome: '',
  removebgWeightsDir: '',
  highresWeightsDir: '',
  outputDir: DEFAULT_OUTPUT_DIR,
  removebg: {
    modelId: 'isnet-anime',
    alphaMatting: false
  },
  highres: {
    modelId: 'RealESRGAN_x4plus_anime_6B',
    outscale: 2,      // 默认2倍放大
    mode: 'auto'      // 性能模式：auto自动检测GPU并优化所有参数
  }
}

const REMOVE_BG_MODELS = [
  {
    id: 'isnet-anime',
    display: 'ISNet-Anime (二次元；人像)',
    rembgName: 'isnet-anime',
    weightFile: 'isnet-anime.onnx',
    description: 'ISNet-Anime 去背景模型权重'
  },
  {
    id: 'u2net',
    display: 'U2Net (通用；物品)',
    rembgName: 'u2net',
    weightFile: 'u2net.onnx',
    description: 'U2Net 通用去背景模型权重'
  }
]

const HIGH_RES_MODELS = [
  {
    id: 'RealESRGAN_x4plus_anime_6B',
    display: 'RealESRGAN_x4plus_anime_6B (二次元4倍)',
    modelName: 'RealESRGAN_x4plus_anime_6B',
    weightFile: 'RealESRGAN_x4plus_anime_6B.pth',
    scale: 4,
    numBlocks: 6
  },
  {
    id: 'RealESRGAN_x4plus',
    display: 'RealESRGAN_x4plus (通用4倍)',
    modelName: 'RealESRGAN_x4plus',
    weightFile: 'RealESRGAN_x4plus.pth',
    scale: 4,
    numBlocks: 23
  },
  {
    id: 'RealESRGAN_x2plus',
    display: 'RealESRGAN_x2plus (通用2倍)',
    modelName: 'RealESRGAN_x2plus',
    weightFile: 'RealESRGAN_x2plus.pth',
    scale: 2,
    numBlocks: 23
  },
  {
    id: 'ESRGAN_x4',
    display: 'ESRGAN_x4 (经典4倍)',
    modelName: 'ESRGAN_x4',
    weightFile: 'ESRGAN_SRx4_DF2KOST_official-ff704c30.pth',
    scale: 4,
    numBlocks: 23
  }
]

// ==================== 配置读写 ====================

/**
 * 获取高清工具配置文件路径。
 * 处理流程：
 * 1、将配置文件名拼接到应用数据目录。
 */
function getConfigPath() {
  // 1、使用当前应用独立的数据目录定位配置。
  const userData = app.getPath('userData')
  return path.join(userData, CONFIG_FILE_NAME)
}

/**
 * 读取配置并补齐默认参数。
 * 处理流程：
 * 1、读取并解析配置文件，分别合并两类处理参数。
 * 2、文件缺失或读取异常时返回默认配置。
 */
function readConfig() {
  // 1、保留用户设置，同时补齐新增配置项。
  try {
    const configPath = getConfigPath()
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8')
      const parsed = JSON.parse(content)
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        removebg: {
          ...DEFAULT_CONFIG.removebg,
          ...(parsed.removebg || {})
        },
        highres: {
          ...DEFAULT_CONFIG.highres,
          ...(parsed.highres || {})
        }
      }
    }
  } catch (error) {
    console.error('[HD Toolkit] 读取配置失败:', error)
  }
  // 2、配置不可用时提供默认值。
  return { ...DEFAULT_CONFIG }
}

/**
 * 将高清工具配置保存到本地。
 * 处理流程：
 * 1、确保父目录存在并写入 JSON。
 * 2、将写入结果转换为布尔值。
 */
function persistConfig(config) {
  // 1、建立配置目录并持久化完整配置。
  try {
    const configPath = getConfigPath()
    const dir = path.dirname(configPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')
    return true
  } catch (error) {
    console.error('[HD Toolkit] 保存配置失败:', error)
    return false
  }
}

// 缓存配置，避免频繁读写
let cachedConfig = null

/**
 * 获取进程内缓存的配置。
 * 处理流程：
 * 1、缓存为空时读取磁盘，然后返回缓存。
 */
function getConfig() {
  // 1、按需加载，避免每次任务重复读取配置。
  if (!cachedConfig) {
    cachedConfig = readConfig()
  }
  return cachedConfig
}

/**
 * 合并并保存局部配置更新。
 * 处理流程：
 * 1、将顶层与模型参数分别合并到当前配置。
 * 2、保存并返回新的缓存配置。
 */
function updateConfig(newConfig) {
  // 1、分别合并嵌套参数，保留未提交的设置。
  const current = getConfig()
  cachedConfig = {
    ...current,
    ...newConfig,
    removebg: {
      ...current.removebg,
      ...(newConfig.removebg || {})
    },
    highres: {
      ...current.highres,
      ...(newConfig.highres || {})
    }
  }
  // 2、同步磁盘配置与进程内缓存。
  persistConfig(cachedConfig)
  return cachedConfig
}

// ==================== Python 执行辅助 ====================

/**
 * 从解释器文件或安装目录解析 Python 路径。
 * 处理流程：
 * 1、检查输入路径，文件路径可直接使用。
 * 2、按平台遍历安装目录中的候选解释器。
 * 3、未找到或检查异常时返回空值。
 */
function resolvePythonExecutable(pythonHomeOrFile) {
  // 1、排除空路径，并识别文件或目录。
  if (!pythonHomeOrFile) return null
  try {
    if (fs.existsSync(pythonHomeOrFile)) {
      const stats = fs.statSync(pythonHomeOrFile)
      if (stats.isFile()) {
        return pythonHomeOrFile
      }
      if (stats.isDirectory()) {
        // 2、兼容 Windows 与类 Unix 环境的解释器位置。
        const candidates = []
        if (process.platform === 'win32') {
          candidates.push(
            path.join(pythonHomeOrFile, 'python.exe'),
            path.join(pythonHomeOrFile, 'python3.exe'),
            path.join(pythonHomeOrFile, 'Scripts', 'python.exe'),
            path.join(pythonHomeOrFile, 'Scripts', 'python3.exe')
          )
        }
        candidates.push(
          path.join(pythonHomeOrFile, 'bin', 'python3'),
          path.join(pythonHomeOrFile, 'bin', 'python'),
          path.join(pythonHomeOrFile, 'python')
        )
        for (const candidate of candidates) {
          if (fs.existsSync(candidate)) {
            return candidate
          }
        }
      }
    }
  } catch (error) {
    console.error('[HD Toolkit] 解析 Python 路径失败:', error)
  }
  return null
}

/**
 * 根据解释器位置推断环境根目录。
 * 处理流程：
 * 1、移除常见的 Scripts 或 bin 层级，返回环境目录。
 */
function guessPythonHome(pythonExec) {
  // 1、兼容直接安装目录与虚拟环境目录。
  if (!pythonExec) return null
  const dir = path.dirname(pythonExec)
  if (dir.endsWith('Scripts')) {
    return path.resolve(dir, '..')
  }
  if (dir.endsWith('bin')) {
    return path.resolve(dir, '..')
  }
  return dir
}

/**
 * 构造 Python 子进程环境变量。
 * 处理流程：
 * 1、继承当前环境并收集可用的库与脚本目录。
 * 2、补充搜索路径，最后应用调用方覆盖项。
 */
function buildPythonEnv(pythonHome, overrides = {}) {
  // 1、保留宿主环境，允许没有独立 Python 目录。
  const env = { ...process.env }
  if (!pythonHome) {
    return { ...env, ...overrides }
  }

  const libDir = path.join(pythonHome, 'Lib')
  const sitePackagesDir = path.join(libDir, 'site-packages')
  const scriptsDir = process.platform === 'win32'
    ? path.join(pythonHome, 'Scripts')
    : path.join(pythonHome, 'bin')

  // 2、仅把实际存在的目录加入模块和命令搜索路径。
  const pythonPathEntries = []
  if (fs.existsSync(libDir)) pythonPathEntries.push(libDir)
  if (fs.existsSync(sitePackagesDir)) pythonPathEntries.push(sitePackagesDir)

  if (pythonPathEntries.length > 0) {
    env.PYTHONPATH = pythonPathEntries.join(path.delimiter)
  }

  if (fs.existsSync(scriptsDir)) {
    env.PATH = `${scriptsDir}${path.delimiter}${env.PATH || ''}`
  }

  return { ...env, ...overrides }
}

/**
 * 执行内联 Python 脚本并收集输出。
 * 处理流程：
 * 1、验证解释器并以独立参数启动子进程。
 * 2、收集标准输出与错误输出。
 * 3、根据退出码返回结果或携带输出的错误。
 */
function runPythonInline(pythonExec, pythonHome, code, args, envExtra = {}) {
  // 1、将子进程生命周期转换为可等待的任务。
  return new Promise((resolve, reject) => {
    if (!pythonExec || !fs.existsSync(pythonExec)) {
      reject(new Error('未找到可用的 Python 解释器，请在设置中配置正确路径'))
      return
    }
    const env = buildPythonEnv(pythonHome, envExtra)
    const child = spawn(pythonExec, ['-c', code, ...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    // 2、保留脚本诊断信息，供成功结果或错误展示使用。
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    child.on('error', (error) => {
      reject(error)
    })
    // 3、以进程退出码判断脚本是否执行成功。
    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
      } else {
        const error = new Error(`Python 脚本执行失败，退出码 ${code}`)
        error.stdout = stdout
        error.stderr = stderr
        reject(error)
      }
    })
  })
}

// ==================== 业务执行逻辑 ====================

const REMOVE_BG_SCRIPT = `
import os
import sys
import shutil
from pathlib import Path
from rembg import remove, new_session

def ensure_unique_path(base_path):
    if not base_path.exists():
        return base_path
    stem = base_path.stem
    suffix = base_path.suffix
    parent = base_path.parent
    index = 1
    while True:
        candidate = parent / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1

def process_single(session, source_path, target_path, alpha_flag):
    result = remove(
        source_path.read_bytes(),
        session=session,
        alpha_matting=alpha_flag,
    )
    target_path.write_bytes(result)

def main():
    if len(sys.argv) < 6:
        raise SystemExit("参数不足")

    input_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    weight_dir = Path(sys.argv[3])
    weight_name = sys.argv[4]
    model_name = sys.argv[5]
    alpha_flag = sys.argv[6] == "1"

    weight_path = weight_dir / weight_name

    if not weight_path.exists():
        raise SystemExit(f"未找到权重文件：{weight_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("U2NET_HOME", str(weight_dir))
    session = new_session(model_name)

    if input_path.is_file():
        target = ensure_unique_path(output_dir / input_path.name)
        process_single(session, input_path, target, alpha_flag)
        return

    if input_path.is_dir():
        for item in input_path.iterdir():
            if item.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}:
                target = ensure_unique_path(output_dir / item.name)
                process_single(session, item, target, alpha_flag)
            else:
                target = ensure_unique_path(output_dir / item.name)
                shutil.copy2(item, target)
        return

    raise SystemExit(f"无法识别的输入路径：{input_path}")

main()
`

const HIGHRES_SCRIPT = `
import os
import sys
import types
import shutil
import time
from pathlib import Path

import numpy as np
from PIL import Image

try:
    from torchvision.transforms import functional as _tv_functional
    stub = types.ModuleType("torchvision.transforms.functional_tensor")
    if hasattr(_tv_functional, "rgb_to_grayscale"):
        stub.rgb_to_grayscale = _tv_functional.rgb_to_grayscale
        sys.modules.setdefault("torchvision.transforms.functional_tensor", stub)
except Exception:
    pass

import torch
from realesrgan import RealESRGANer
from basicsr.archs.rrdbnet_arch import RRDBNet

def ensure_unique_path(base_path):
    if not base_path.exists():
        return base_path
    stem = base_path.stem
    suffix = base_path.suffix
    parent = base_path.parent
    index = 1
    while True:
        candidate = parent / f"{stem}_{index}{suffix}"
        if not candidate.exists():
            return candidate
        index += 1

def process_single_image(upscaler, image_path, outscale, target_path):
    """处理单张图片，支持透明通道"""
    image = Image.open(image_path)
    has_alpha = image.mode in ('RGBA', 'LA') or (image.mode == 'P' and 'transparency' in image.info)
    
    start_time = time.time()
    
    if has_alpha:
        # 处理带透明通道的图片
        print(f"  检测到透明通道，分离处理RGB和Alpha", flush=True)
        image = image.convert('RGBA')
        # 分离RGB和Alpha通道
        rgb = np.array(image.convert('RGB'))
        alpha = np.array(image.split()[-1])
        
        # 对RGB部分进行超分辨率处理（使用分块优化）
        rgb_result, _ = upscaler.enhance(rgb, outscale=outscale)
        
        # 对Alpha通道也进行相同比例的缩放，保持清晰
        alpha_img = Image.fromarray(alpha)
        new_size = (rgb_result.shape[1], rgb_result.shape[0])  # (width, height)
        alpha_resized = alpha_img.resize(new_size, Image.Resampling.LANCZOS)
        alpha_result = np.array(alpha_resized)
        
        # 合并RGB和Alpha通道
        result_rgba = np.dstack((rgb_result, alpha_result))
        result_image = Image.fromarray(result_rgba, 'RGBA')
    else:
        # 处理不带透明通道的图片
        image_rgb = image.convert("RGB")
        result, _ = upscaler.enhance(np.array(image_rgb), outscale=outscale)
        result_image = Image.fromarray(result)
    
    elapsed = time.time() - start_time
    
    # 保存图片，保留原始格式
    if target_path.suffix.lower() == '.png':
        result_image.save(target_path, 'PNG')
    else:
        if result_image.mode == 'RGBA':
            result_image = result_image.convert('RGB')
        result_image.save(target_path)
    
    return elapsed

def main():
    if len(sys.argv) < 13:
        raise SystemExit("参数不足")

    input_path = Path(sys.argv[1])
    output_dir = Path(sys.argv[2])
    weight_dir = Path(sys.argv[3])
    weight_file = sys.argv[4]
    model_name = sys.argv[5]
    scale = int(sys.argv[6])
    num_blocks = int(sys.argv[7])
    outscale = float(sys.argv[8])
    tile = int(sys.argv[9])
    tile_pad = int(sys.argv[10])
    pre_pad = int(sys.argv[11])
    half = sys.argv[12] == "1"

    weight_path = weight_dir / weight_file

    if not weight_path.exists():
        raise SystemExit(f"未找到权重文件：{weight_path}")

    output_dir.mkdir(parents=True, exist_ok=True)

    # 检测GPU可用性
    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"使用设备: {device.upper()}", flush=True)
    
    if device == "cuda":
        gpu_name = torch.cuda.get_device_name(0)
        gpu_memory = torch.cuda.get_device_properties(0).total_memory / 1024**3
        print(f"GPU信息: {gpu_name} ({gpu_memory:.1f} GB)", flush=True)
        if half:
            print("启用半精度模式 (FP16)，速度更快", flush=True)
    else:
        print("提示: 使用CPU模式，速度较慢", flush=True)
        if half:
            print("警告: CPU不支持半精度，已自动禁用", flush=True)
            half = False
    
    if tile > 0:
        print(f"分块处理: {tile}x{tile} (提升速度和内存效率)", flush=True)
    else:
        print("分块处理: 已禁用 (整图处理，质量更高但内存占用更大)", flush=True)

    network = RRDBNet(
        num_in_ch=3,
        num_out_ch=3,
        num_feat=64,
        num_block=num_blocks,
        num_grow_ch=32,
        scale=scale,
    )

    upscaler = RealESRGANer(
        scale=scale,
        model_path=str(weight_path),
        model=network,
        tile=tile,
        tile_pad=tile_pad,
        pre_pad=pre_pad,
        half=half,
        device=device,
    )

    total_images = 0
    total_time = 0.0

    if input_path.is_file():
        target = ensure_unique_path(output_dir / input_path.name)
        print(f"处理: {input_path.name}", flush=True)
        elapsed = process_single_image(upscaler, input_path, outscale, target)
        total_images = 1
        total_time = elapsed
        print(f"完成: {target.name} (耗时: {elapsed:.2f}秒)", flush=True)
        return

    if input_path.is_dir():
        images = [item for item in input_path.iterdir() 
                 if item.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}]
        total = len(images)
        
        for idx, item in enumerate(images, 1):
            target = ensure_unique_path(output_dir / item.name)
            print(f"[{idx}/{total}] 处理: {item.name}", flush=True)
            elapsed = process_single_image(upscaler, item, outscale, target)
            total_time += elapsed
            total_images += 1
            print(f"  完成: {target.name} (耗时: {elapsed:.2f}秒)", flush=True)
        
        # 复制非图片文件
        for item in input_path.iterdir():
            if item.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
                target = ensure_unique_path(output_dir / item.name)
                shutil.copy2(item, target)
        
        if total_images > 0:
            avg_time = total_time / total_images
            print(f"\\n处理完成: {total_images}张图片，总耗时: {total_time:.2f}秒，平均: {avg_time:.2f}秒/张", flush=True)
        return

    raise SystemExit(f"无法识别的输入路径：{input_path}")

main()
`

/**
 * 确保目标目录存在。
 * 处理流程：
 * 1、忽略空路径，按需递归创建目录。
 */
function ensureDirectory(target) {
  // 1、仅为有效且不存在的路径创建目录。
  if (!target) return
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
  }
}

/**
 * 创建带时间戳的任务输出目录。
 * 处理流程：
 * 1、组合子目录前缀与时间戳，创建目录并返回路径。
 */
function createSessionOutputDir(base, subFolder) {
  // 1、将时间戳中的路径不兼容字符替换为短横线。
  if (!base) return null
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const folderName = subFolder ? `${subFolder}-${timestamp}` : timestamp
  const finalDir = path.join(base, folderName)
  ensureDirectory(finalDir)
  return finalDir
}

/**
 * 批量执行本地图片去背景任务。
 * 处理流程：
 * 1、验证解释器、模型权重及输入输出路径。
 * 2、逐个调用 Python 去背景脚本。
 * 3、整理结果并仅返回本次新增文件。
 */
async function handleRemoveBackground(payload) {
  // 1、根据保存配置与任务参数检查运行条件。
  const config = getConfig()
  const pythonExec = resolvePythonExecutable(config.pythonHome)
  const pythonHome = guessPythonHome(pythonExec)

  if (!pythonExec) {
    throw new Error('未配置有效的 Python 解释器路径，请前往设置页面完成配置')
  }

  const weightsDir = payload.weightsDir || config.removebgWeightsDir
  if (!weightsDir) {
    throw new Error('未配置去背景模型权重目录，请前往设置页面完成配置')
  }
  if (!fs.existsSync(weightsDir)) {
    throw new Error(`去背景模型权重目录不存在：${weightsDir}`)
  }

  const modelId = payload.modelId || config.removebg.modelId
  const model = REMOVE_BG_MODELS.find((item) => item.id === modelId)
  if (!model) {
    throw new Error(`未找到对应的去背景模型配置: ${modelId}`)
  }

  const outputBase = payload.outputDir || config.outputDir
  if (!outputBase) {
    throw new Error('未配置输出目录，请前往设置页面完成配置')
  }

  ensureDirectory(outputBase)
  const sessionDir = path.join(outputBase, 'removebg-results')
  ensureDirectory(sessionDir)
  const existingNames = new Set(fs.readdirSync(sessionDir))

  const inputPaths = Array.isArray(payload.inputPaths) ? payload.inputPaths : []
  if (inputPaths.length === 0) {
    throw new Error('请至少选择一个待处理的文件或文件夹')
  }

  // 2、顺序处理输入，避免多个模型实例同时占用内存。
  const results = []
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`输入路径不存在：${inputPath}`)
    }

    await runPythonInline(
      pythonExec,
      pythonHome,
      REMOVE_BG_SCRIPT,
      [
        inputPath,
        sessionDir,
        weightsDir,
        model.weightFile,
        model.rembgName,
        payload.alphaMatting === true || payload.alphaMatting === '1' ? '1' : '0'
      ],
      {
        U2NET_HOME: weightsDir
      }
    )
    results.push({
      input: inputPath,
      outputDir: sessionDir
    })
  }

  // 3、通过任务开始前的文件名集合筛出新增结果。
  const files = finalizeOutputFiles(sessionDir, { renameDuplicates: true })
  const newFiles = files.filter((filePath) => {
    const name = path.basename(filePath)
    return !existingNames.has(name)
  })
  return {
    outputDir: sessionDir,
    files: newFiles,
    tasks: results
  }
}

// 性能优化的默认参数配置（与hd-remove_bg项目保持一致）
const HIGH_RES_DEFAULT_PARAMS = {
  cpu: {
    tile: 256,
    tilePad: 10,
    prePad: 0,
    half: false,
    outscale: 2       // 默认2倍放大
  },
  gpu: {
    tile: 512,
    tilePad: 10,
    prePad: 0,
    half: true,
    outscale: 2       // 默认2倍放大
  },
  fast: {
    tile: 128,
    tilePad: 5,
    prePad: 0,
    half: false,
    outscale: 2       // 快速模式2倍
  }
}

/**
 * 通过 Python 检查 CUDA 是否可用。
 * 处理流程：
 * 1、执行检测脚本，成功使用显卡模式，失败回退到处理器模式。
 */
async function detectGPUMode(pythonExec, pythonHome) {
  // 1、利用脚本退出码转换为性能模式。
  try {
    const detectScript = `import torch; import sys; sys.exit(0 if torch.cuda.is_available() else 1)`
    await runPythonInline(pythonExec, pythonHome, detectScript, [])
    return 'gpu'
  } catch (error) {
    return 'cpu'
  }
}

/**
 * 批量执行本地图片高清放大任务。
 * 处理流程：
 * 1、验证解释器、模型和文件路径。
 * 2、根据性能模式合并本次推理参数。
 * 3、逐个运行放大脚本，整理本次新增结果。
 */
async function handleHighres(payload) {
  // 1、准备运行环境并检查任务配置。
  const config = getConfig()
  const pythonExec = resolvePythonExecutable(config.pythonHome)
  const pythonHome = guessPythonHome(pythonExec)

  if (!pythonExec) {
    throw new Error('未配置有效的 Python 解释器路径，请前往设置页面完成配置')
  }

  const weightsDir = payload.weightsDir || config.highresWeightsDir
  if (!weightsDir) {
    throw new Error('未配置高清模型权重目录，请前往设置页面完成配置')
  }

  if (!fs.existsSync(weightsDir)) {
    throw new Error(`高清模型权重目录不存在：${weightsDir}`)
  }

  const modelId = payload.modelId || config.highres.modelId
  const model = HIGH_RES_MODELS.find((item) => item.id === modelId)
  if (!model) {
    throw new Error(`未找到对应的高清模型配置: ${modelId}`)
  }

  const outputBase = payload.outputDir || config.outputDir
  if (!outputBase) {
    throw new Error('未配置输出目录，请前往设置页面完成配置')
  }
  ensureDirectory(outputBase)
  const sessionDir = path.join(outputBase, 'highres-results')
  ensureDirectory(sessionDir)
  const existingNames = new Set(fs.readdirSync(sessionDir))

  const inputPaths = Array.isArray(payload.inputPaths) ? payload.inputPaths : []
  if (inputPaths.length === 0) {
    throw new Error('请至少选择一个待处理的文件或文件夹')
  }

  // 2、性能参数优化：根据模式选择最优参数。
  const performanceMode = payload.mode || config.highres.mode || 'auto'
  let defaultParams
  let useAutoOptimization = false
  
  if (performanceMode === 'auto') {
    // 自动检测GPU并选择参数
    console.log('[HD Toolkit] 检测GPU环境...')
    const detectedMode = await detectGPUMode(pythonExec, pythonHome)
    defaultParams = HIGH_RES_DEFAULT_PARAMS[detectedMode]
    useAutoOptimization = true
    console.log(`[HD Toolkit] 检测到${detectedMode.toUpperCase()}模式，将使用优化参数`)
  } else if (HIGH_RES_DEFAULT_PARAMS[performanceMode]) {
    defaultParams = HIGH_RES_DEFAULT_PARAMS[performanceMode]
    useAutoOptimization = true
    console.log(`[HD Toolkit] 使用${performanceMode.toUpperCase()}模式参数`)
  } else {
    // 兜底使用CPU参数
    defaultParams = HIGH_RES_DEFAULT_PARAMS.cpu
    useAutoOptimization = false
  }

  // 参数优先级：
  // auto/gpu/cpu/fast模式时：用户明确传值 > 优化参数（忽略config）
  // 其他情况：用户明确传值 > config > 优化参数
  let outscale, tile, tilePad, prePad, half
  
  if (useAutoOptimization) {
    // auto模式：优先使用优化参数，忽略config中可能的旧值
    outscale = payload.outscale !== undefined ? Number(payload.outscale) : defaultParams.outscale
    tile = payload.tile !== undefined ? Number(payload.tile) : defaultParams.tile
    tilePad = payload.tilePad !== undefined ? Number(payload.tilePad) : defaultParams.tilePad
    prePad = payload.prePad !== undefined ? Number(payload.prePad) : defaultParams.prePad
    half = payload.half !== undefined ? Boolean(payload.half) : defaultParams.half
  } else {
    // 手动模式：payload > config > defaultParams
    outscale = Number(payload.outscale ?? config.highres.outscale ?? defaultParams.outscale) || defaultParams.outscale
    tile = Number(payload.tile ?? config.highres.tile ?? defaultParams.tile) || defaultParams.tile
    tilePad = Number(payload.tilePad ?? config.highres.tilePad ?? defaultParams.tilePad) || defaultParams.tilePad
    prePad = Number(payload.prePad ?? config.highres.prePad ?? defaultParams.prePad) || defaultParams.prePad
    half = payload.half !== undefined ? Boolean(payload.half) : (config.highres.half !== undefined ? Boolean(config.highres.half) : defaultParams.half)
  }
  
  console.log(`[HD Toolkit] 性能参数: tile=${tile}, outscale=${outscale}, half=${half}`)

  const pythonArgs = [
    '', // placeholder for input path
    sessionDir,
    weightsDir,
    model.weightFile,
    model.modelName,
    String(model.scale),
    String(model.numBlocks),
    String(outscale),
    String(tile),
    String(tilePad),
    String(prePad),
    half ? '1' : '0'
  ]

  // 3、复用公共参数，逐个执行输入文件的高清任务。
  const tasks = []
  for (const inputPath of inputPaths) {
    if (!fs.existsSync(inputPath)) {
      throw new Error(`输入路径不存在：${inputPath}`)
    }

    pythonArgs[0] = inputPath
    await runPythonInline(
      pythonExec,
      pythonHome,
      HIGHRES_SCRIPT,
      pythonArgs
    )
    tasks.push({
      input: inputPath,
      outputDir: sessionDir
    })
  }

  const files = finalizeOutputFiles(sessionDir, { renameDuplicates: true })
  const newFiles = files.filter((filePath) => {
    const name = path.basename(filePath)
    return !existingNames.has(name)
  })
  return {
    outputDir: sessionDir,
    files: newFiles,
    tasks
  }
}

/**
 * 收集输出文件并按需处理同名文件。
 * 处理流程：
 * 1、排序目录条目并过滤不可访问项与目录。
 * 2、按文件主名计数，必要时追加未占用的序号。
 * 3、返回最终文件路径列表。
 */
function finalizeOutputFiles(dir, options = {}) {
  // 1、初始化稳定的遍历顺序与文件主名计数。
  const { renameDuplicates = false } = options
  if (!fs.existsSync(dir)) return []
  const entries = fs.readdirSync(dir)
  entries.sort((a, b) => a.localeCompare(b))
  const baseCounts = new Map()
  const result = []

  for (const name of entries) {
    const fullPath = path.join(dir, name)
    let stat
    try {
      stat = fs.statSync(fullPath)
    } catch (error) {
      console.warn('[HD Toolkit] 跳过无法访问的文件:', fullPath, error)
      continue
    }
    if (!stat.isFile()) {
      continue
    }

    if (!renameDuplicates) {
      result.push(fullPath)
      continue
    }

    // 2、需要重命名时查找未占用的序号路径。
    const ext = path.extname(name)
    const base = path.basename(name, ext)
    let count = baseCounts.get(base) || 0
    let finalPath = fullPath

    if (count > 0) {
      let suffix = count
      while (true) {
        const candidateName = `${base}_${suffix}${ext}`
        const candidatePath = path.join(dir, candidateName)
        if (!fs.existsSync(candidatePath)) {
          fs.renameSync(fullPath, candidatePath)
          finalPath = candidatePath
          baseCounts.set(base, suffix + 1)
          break
        }
        suffix += 1
      }
    } else {
      baseCounts.set(base, 1)
    }

    result.push(finalPath)
  }

  // 3、返回整理后的实际文件路径。
  return result
}

/**
 * 将本地图片编码为页面可预览的数据地址。
 * 处理流程：
 * 1、检查文件并根据扩展名选择媒体类型。
 * 2、读取内容生成 Base64 地址，读取失败时抛出错误。
 */
function readImageAsDataUrl(imagePath) {
  // 1、确认文件存在并识别常用图片格式。
  try {
    if (!fs.existsSync(imagePath)) {
      throw new Error('文件不存在')
    }
    const ext = path.extname(imagePath).toLowerCase()
    const mimeMap = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.webp': 'image/webp'
    }
    const mime = mimeMap[ext] || 'image/png'
    // 2、把图片字节转换为可直接绑定到预览组件的地址。
    const data = fs.readFileSync(imagePath)
    const base64 = data.toString('base64')
    return `data:${mime};base64,${base64}`
  } catch (error) {
    console.error('[HD Toolkit] 读取图片失败:', imagePath, error)
    throw error
  }
}

// ==================== IPC 注册 ====================

/**
 * 注册抠图高清功能的进程通信接口。
 * 处理流程：
 * 1、提供配置与模型列表的读写接口。
 * 2、提供去背景、高清和预览接口，并统一封装结果。
 */
export function registerHdServiceHandlers() {
  // 1、注册配置查询和保存入口。
  ipcMain.handle('hd:get-initial-data', async () => {
    // 清除缓存，确保获取最新配置
    cachedConfig = null
    const config = getConfig()
    return {
      success: true,
      data: {
        config,
        removebgModels: REMOVE_BG_MODELS,
        highresModels: HIGH_RES_MODELS
      }
    }
  })

  ipcMain.handle('hd:save-config', async (_event, payload) => {
    const merged = updateConfig(payload || {})
    return {
      success: true,
      data: merged
    }
  })

  // 2、注册处理任务和预览入口，将异常转换为响应消息。
  ipcMain.handle('hd:run-removebg', async (_event, payload) => {
    try {
      const result = await handleRemoveBackground(payload || {})
      return {
        success: true,
        data: result
      }
    } catch (error) {
      console.error('[HD Toolkit] 去背景执行失败:', error)
      return {
        success: false,
        message: error.message,
        stderr: error.stderr,
        stdout: error.stdout
      }
    }
  })

  ipcMain.handle('hd:run-highres', async (_event, payload) => {
    try {
      const result = await handleHighres(payload || {})
      return {
        success: true,
        data: result
      }
    } catch (error) {
      console.error('[HD Toolkit] 高清执行失败:', error)
      return {
        success: false,
        message: error.message,
        stderr: error.stderr,
        stdout: error.stdout
      }
    }
  })

  ipcMain.handle('hd:get-image-preview', async (_event, imagePath) => {
    try {
      const dataUrl = readImageAsDataUrl(imagePath)
      return {
        success: true,
        data: {
          path: imagePath,
          dataUrl
        }
      }
    } catch (error) {
      return {
        success: false,
        message: error.message
      }
    }
  })

  console.log('[HD Toolkit] IPC 处理器已注册')
}

/**
 * 注销抠图高清功能的进程通信接口。
 * 处理流程：
 * 1、移除本模块注册的所有处理器。
 */
export function unregisterHdServiceHandlers() {
  // 1、按注册通道逐个清理，避免重复注册。
  ipcMain.removeHandler('hd:get-initial-data')
  ipcMain.removeHandler('hd:save-config')
  ipcMain.removeHandler('hd:run-removebg')
  ipcMain.removeHandler('hd:run-highres')
  ipcMain.removeHandler('hd:get-image-preview')
  console.log('[HD Toolkit] IPC 处理器已移除')
}
