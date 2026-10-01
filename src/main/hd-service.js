/**
 * 抠图高清服务：管理本地配置、Python 执行环境以及图片处理的进程通信。
 */

import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import { canonicalFile, grantInputFilesInLease, hasAuthorizedInput, grantOutputDirectory, authorizedOutputDirectory, readAuthorizedImage, MEDIA_LIMITS, assertImageDimensions } from './local-media-authorization.js'
import { createArtifactTaskInLease, parseCompletion } from './hd-output-artifacts.js'
import { withMediaAdmission, runMediaOperation } from './media-resource-admission.js'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { runManagedProcess } from './managed-process.mjs'
import { currentTaskSignal, runOwnedTask, cancelOwnedTasks } from './owned-process-tasks.mjs'
import { isTrustedIpcSender } from './ipc-sender-policy.js'
import { assertLocalProcessOptions, assertText } from './ipc-parameter-policy.js'

const deniedSource = () => ({ success: false, message: '未授权的高清工具操作来源' })

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
  if (!pythonExec || !fs.existsSync(pythonExec)) {
    return Promise.reject(new Error('未找到可用的 Python 解释器，请在设置中配置正确路径'))
  }
  return runManagedProcess(pythonExec, ['-c', code, ...args], {
    env: buildPythonEnv(pythonHome, envExtra),
    signal: currentTaskSignal()
  })
}

// ==================== 业务执行逻辑 ====================

const REMOVE_BG_SCRIPT = `
import os
import sys
import json
from pathlib import Path
from rembg import remove, new_session

def process_single(session, source_path, target_path, alpha_flag):
    result = remove(
        source_path.read_bytes(),
        session=session,
        alpha_matting=alpha_flag,
    )
    target_path.write_bytes(result)

def main():
    if len(sys.argv) != 7:
        raise SystemExit("参数不足")

    manifest_path = Path(sys.argv[1])
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

    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not 0 < len(entries) <= 10000:
        raise SystemExit("任务清单无效")
    for entry in entries:
        input_path, target = Path(entry["input"]), Path(entry["output"])
        if not input_path.is_file() or target.exists():
            raise SystemExit("任务输入或预定产物无效")
        process_single(session, input_path, target, alpha_flag)
        print("MOMENTUM_ARTIFACT " + entry["id"], flush=True)

main()
`

const HIGHRES_SCRIPT = `
import os
import sys
import types
import json
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
    if len(sys.argv) != 13:
        raise SystemExit("参数不足")

    manifest_path = Path(sys.argv[1])
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

    entries = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(entries, list) or not 0 < len(entries) <= 10000:
        raise SystemExit("任务清单无效")
    for entry in entries:
        input_path, target = Path(entry["input"]), Path(entry["output"])
        if not input_path.is_file() or target.exists():
            raise SystemExit("任务输入或预定产物无效")
        process_single_image(upscaler, input_path, outscale, target)
        print("MOMENTUM_ARTIFACT " + entry["id"], flush=True)

main()
`

/** 原生输入/输出选择、精确用途授权和任务私有快照准备。 */
async function prepareHdTask(owner, payload, suffix) {
  const signal = currentTaskSignal()
  const check = () => { if (owner.isDestroyed() || signal?.aborted) throw signal?.reason || new Error('任务来源已关闭') }
  check()
  let inputs = payload.inputPaths || []
  let taskInputs = inputs
  const rollbacks = []
  let needsGrant = false, selectedOutput = false, task
  try {
  if (!inputs.length || !(await hasAuthorizedInput(owner, inputs, signal))) {
    needsGrant = true
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(owner), {
      title: '确认本次处理的输入文件或目录', properties: ['openFile', 'openDirectory', 'multiSelections']
    })
    check()
    if (selected.canceled || !selected.filePaths.length) throw new Error('已取消输入选择，未授权处理')
    taskInputs = selected.filePaths
    inputs = []
    for (const selectedPath of selected.filePaths) {
      canonicalFile(selectedPath)
      const candidates = fs.statSync(selectedPath).isDirectory()
        ? fs.readdirSync(selectedPath).map(name => path.join(selectedPath, name)) : [selectedPath]
      for (const file of candidates) {
        if (inputs.length >= MEDIA_LIMITS.files) throw new Error('输入文件数量超过限制')
        // 保留旧目录内普通非图片复制用途；目录/链接明确拒绝，不静默丢弃。
        inputs.push(file)
      }
    }
    check() // 原生选择只确认路径；输入授权延后到准备阶段额度内。
  }
  let base = payload.outputDir || getConfig().outputDir
  try { base = authorizedOutputDirectory(owner, base) } catch {
    const selected = await dialog.showOpenDialog(BrowserWindow.fromWebContents(owner), {
      title: '确认本次图片处理输出目录', properties: ['openDirectory']
    })
    check()
    if (selected.canceled || !selected.filePaths.length) throw new Error('已取消输出选择，未发布产物')
    base = selected.filePaths[0]
    selectedOutput = true
  }
  check()
  let destination
  await withMediaAdmission({ owner, signal }, async lease => {
    if (needsGrant) rollbacks.push((await grantInputFilesInLease(lease, owner, inputs)).rollback)
    await runMediaOperation(lease, context => {
      context.check(); check()
      if (selectedOutput) rollbacks.push(grantOutputDirectory(owner, base))
      destination = path.join(authorizedOutputDirectory(owner, base), suffix)
      try { fs.mkdirSync(destination, { mode: 0o700 }) } catch (error) { if (error.code !== 'EEXIST') throw error }
      rollbacks.push(grantOutputDirectory(owner, destination))
    })
    task = await createArtifactTaskInLease(lease, { owner, temporaryRoot: app.getPath('temp'), inputs, signal })
  })
  return { task, destination, inputs: taskInputs, rollback: () => { for (const undo of rollbacks.reverse()) undo() } }
  } catch (error) {
    for (const undo of rollbacks.reverse()) undo()
    if (task) task.cleanup(error)
    throw error
  }
}

async function completeHdBatch(task, stdout) {
  const images = task.records.filter(record => record.image)
  parseCompletion(stdout, images.map(record => record.id))
  for (const record of task.records) await task.complete(record, record.image ? `MOMENTUM_ARTIFACT ${record.id}` : '')
}

async function handleRemoveBackground(payload, owner) {
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

  const { task, destination, inputs, rollback } = await prepareHdTask(owner, payload, 'removebg-results')
  let failure
  try {
    const result = task.records.some(record => record.image) ? await runPythonInline(pythonExec, pythonHome, REMOVE_BG_SCRIPT, [
      task.manifest, task.directory, weightsDir, model.weightFile, model.rembgName,
      payload.alphaMatting === true || payload.alphaMatting === '1' ? '1' : '0'
    ], { U2NET_HOME: weightsDir }) : null
    await completeHdBatch(task, result?.stdout || '')
    const files = await task.publish(destination)
    task.commit()
    return { outputDir: destination, files, tasks: inputs.map(input => ({ input, outputDir: destination })) }
  } catch (error) { failure = error; rollback(); throw error }
  finally { task.cleanup(failure) }
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
    if (error?.code === 'PROCESS_CLEANUP_FAILED') throw error
    currentTaskSignal()?.throwIfAborted()
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
async function handleHighres(payload, owner) {
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


  const { task, destination, inputs, rollback } = await prepareHdTask(owner, payload, 'highres-results')
  let failure
  try {
  // 2、只有输入输出用途确认后才允许探测或启动Python。
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
    task.manifest, // main-owned bounded image list
    task.directory,
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

    const predictedPixels = task.records.reduce((sum, record) => sum + (record.image ? assertImageDimensions(record.width, record.height, outscale) : 0), 0)
    if (predictedPixels > MEDIA_LIMITS.batchPixels) throw new Error('高清预期产物像素超过媒体预算')
    const result = task.records.some(record => record.image) ? await runPythonInline(pythonExec, pythonHome, HIGHRES_SCRIPT, pythonArgs) : null
    await completeHdBatch(task, result?.stdout || '')
    const files = await task.publish(destination)
    task.commit()
    return { outputDir: destination, files, tasks: inputs.map(input => ({ input, outputDir: destination })) }
  } catch (error) { failure = error; rollback(); throw error }
  finally { task.cleanup(failure) }
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
  ipcMain.handle('hd:get-initial-data', async (event) => {
    if (!isTrustedIpcSender(event)) return deniedSource()
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

  ipcMain.handle('hd:save-config', async (event, payload) => {
    if (!isTrustedIpcSender(event)) return deniedSource()
    try {
      assertLocalProcessOptions(payload)
      const merged = updateConfig(payload)
      return { success: true, data: merged }
    } catch (error) {
      return { success: false, message: error.message }
    }
  })

  // 2、注册处理任务和预览入口，将异常转换为响应消息。
  ipcMain.handle('hd:run-removebg', async (event, payload) => {
    if (!isTrustedIpcSender(event)) return deniedSource()
    try {
      assertLocalProcessOptions(payload)
      const result = await runOwnedTask(event.sender, 'hd', () => handleRemoveBackground(payload, event.sender))
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

  ipcMain.handle('hd:run-highres', async (event, payload) => {
    if (!isTrustedIpcSender(event)) return deniedSource()
    try {
      assertLocalProcessOptions(payload)
      const result = await runOwnedTask(event.sender, 'hd', () => handleHighres(payload, event.sender))
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

  ipcMain.handle('hd:get-image-preview', async (event, imagePath) => {
    if (!isTrustedIpcSender(event)) return deniedSource()
    try {
      assertText(imagePath, 32768, '图片路径')
      const image = await readAuthorizedImage(event.sender, imagePath)
      const dataUrl = image.dataUrl
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

  ipcMain.handle('hd:cancel', async event => {
    if (!isTrustedIpcSender(event)) return deniedSource()
    try {
      return await cancelOwnedTasks(event.sender, 'hd')
    } catch (error) {
      return { success: false, message: error.message }
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
  ipcMain.removeHandler('hd:cancel')
  ipcMain.removeHandler('hd:get-initial-data')
  ipcMain.removeHandler('hd:save-config')
  ipcMain.removeHandler('hd:run-removebg')
  ipcMain.removeHandler('hd:run-highres')
  ipcMain.removeHandler('hd:get-image-preview')
  console.log('[HD Toolkit] IPC 处理器已移除')
}
