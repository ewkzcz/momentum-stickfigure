/**
 * 视频字幕识别服务：管理 PaddleOCR 环境、视频文字提取和可选的 AI 纠错。
 */

import { app, ipcMain } from 'electron'
import path from 'path'
import fs from 'fs'
import os from 'os'
import { spawn } from 'child_process'
import { buildApiUrl } from '../shared/api-url.js'

// ==================== 常量定义 ====================

const DEFAULT_OUTPUT_DIR = path.join(os.homedir(), 'Documents', 'VideoSubtitles')

// ==================== Python 执行辅助 ====================

/**
 * 解析用户指定的 Python 文件或安装目录。
 * 处理流程：
 * 1、检查输入类型，并在目录内查找各平台常见解释器。
 * 2、返回可用路径，未找到或检查异常时返回空值。
 */
function resolvePythonExecutable(pythonHomeOrFile) {
  // 1、先接受直接指定的文件，再尝试安装目录中的候选路径。
  if (!pythonHomeOrFile) return null
  try {
    if (fs.existsSync(pythonHomeOrFile)) {
      const stats = fs.statSync(pythonHomeOrFile)
      if (stats.isFile()) {
        return pythonHomeOrFile
      }
      if (stats.isDirectory()) {
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
    console.error('[Video OCR] 解析 Python 路径失败:', error)
  }
  return null
}

/**
 * 构造字幕处理子进程的环境变量。
 * 处理流程：
 * 1、继承当前环境并收集实际存在的库目录。
 * 2、补充模块与命令搜索路径，应用外部覆盖项。
 */
function buildPythonEnv(pythonHome, overrides = {}) {
  // 1、保留宿主环境，兼容未单独指定环境目录的情况。
  const env = { ...process.env }
  if (!pythonHome) {
    return { ...env, ...overrides }
  }

  const libDir = path.join(pythonHome, 'Lib')
  const sitePackagesDir = path.join(libDir, 'site-packages')
  const scriptsDir = process.platform === 'win32'
    ? path.join(pythonHome, 'Scripts')
    : path.join(pythonHome, 'bin')

  // 2、仅加入存在的目录，避免无效路径影响模块查找。
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

// ==================== PaddleOCR 视频处理脚本（v2 API版本）====================
// 本脚本与 video_srt_ocr_gui.py 保持一致，使用 PaddleOCR 2.7.0.0 版本

const VIDEO_OCR_SCRIPT = `
# -*- coding: utf-8 -*-
"""
PaddleOCR v2.7.0.0 视频字幕提取脚本
与 video_srt_ocr_gui.py 保持 API 一致性
"""
import sys
import os
import json
import cv2
import numpy as np
import warnings

# 过滤警告信息，避免干扰输出
warnings.filterwarnings("ignore", category=UserWarning)
warnings.filterwarnings("ignore", category=DeprecationWarning)

from paddleocr import PaddleOCR
from pathlib import Path
from tqdm import tqdm

def auto_crop_and_resize_frame(frame):
    """
    智能裁剪和缩放帧（在内存中离屏处理）：
    1. 裁剪底部25%区域（字幕通常在此位置）
    2. 如果清晰度过高，压缩到480P标准的底部区域尺寸
    
    示例：
    - 1920x1080 (1080P) -> 裁剪后 1920x270 -> 压缩到 853x120 (480P底部25%)
    - 1280x720 (720P) -> 裁剪后 1280x180 -> 保持不变或压缩到 853x120
    - 3840x2160 (4K) -> 裁剪后 3840x540 -> 压缩到 853x120
    """
    h, w = frame.shape[:2]
    
    # 步骤1: 裁剪底部25%高度（保留全宽度）
    crop_start_y = int(h * 0.75)  # 从75%高度位置开始裁剪
    frame_cropped = frame[crop_start_y:h, 0:w]
    cropped_h, cropped_w = frame_cropped.shape[:2]
    
    print(f"[裁剪] 原始视频: {w}x{h} -> 裁剪后（底部25%）: {cropped_w}x{cropped_h}", flush=True)
    
    # 步骤2: 智能压缩到480P标准
    # 480P标准分辨率: 854x480 或 640x480
    # 底部25%对应高度: 120像素
    # 宽度保持16:9比例: 853像素 (或按实际比例计算)
    
    target_height = 120  # 480P视频底部25%的目标高度
    
    # 如果裁剪后的高度超过240像素（相当于960P+），进行压缩
    if cropped_h > 240:
        # 计算缩放比例（基于高度）
        scale_factor = target_height / cropped_h
        new_height = target_height
        new_width = int(cropped_w * scale_factor)
        
        # 使用INTER_AREA插值算法（最适合缩小图像）
        frame_cropped = cv2.resize(frame_cropped, (new_width, new_height), interpolation=cv2.INTER_AREA)
        print(f"[压缩] {cropped_w}x{cropped_h} -> {new_width}x{new_height} (目标480P标准)", flush=True)
    
    # 如果高度在120-240之间，可选择性压缩到标准尺寸以提升OCR速度
    elif cropped_h > 160:
        scale_factor = target_height / cropped_h
        new_height = target_height
        new_width = int(cropped_w * scale_factor)
        frame_cropped = cv2.resize(frame_cropped, (new_width, new_height), interpolation=cv2.INTER_AREA)
        print(f"[优化] {cropped_w}x{cropped_h} -> {new_width}x{new_height} (优化OCR性能)", flush=True)
    else:
        print(f"[保持] {cropped_w}x{cropped_h} (尺寸已合适，无需压缩)", flush=True)
    
    return frame_cropped

def process_video(video_path, output_path, interval_seconds):
    """处理视频并提取字幕（两阶段：先抽帧，再OCR）"""
    
    # ==================== 阶段1: 快速抽帧 ====================
    print("[阶段1/3] 分析视频并抽取关键帧...", flush=True)
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError("无法读取视频")
    
    # 获取视频信息
    fps = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    interval_frames = int(fps * interval_seconds)
    
    # 跳过前5帧的封面内容
    skip_frames = 5
    start_frame = skip_frames
    
    # 计算实际需要OCR处理的帧数
    estimated_ocr_frames = ((total_frames - start_frame) // interval_frames) + 1
    
    print(f"[视频信息] 分辨率: {width}x{height}, FPS: {fps}, 总帧数: {total_frames}", flush=True)
    print(f"[跳过封面] 跳过前 5 帧", flush=True)
    print(f"[采样策略] 每隔 {interval_seconds} 秒提取一帧（间隔{interval_frames}帧）", flush=True)
    print(f"[预计抽取] 约 {estimated_ocr_frames} 帧（跳过 {total_frames - estimated_ocr_frames} 帧）", flush=True)
    
    # 快速抽帧：直接在内存中处理（裁剪+压缩），存储为numpy数组列表
    extracted_frames = []
    
    print("[抽帧] 开始快速抽取并预处理帧...", flush=True)
    first_frame = True
    frame_count = 0
    
    with tqdm(total=estimated_ocr_frames, desc="抽帧进度", ncols=80, file=sys.stdout, unit="帧") as pbar:
        for frame_idx in range(start_frame, total_frames, interval_frames):
            # 直接跳到指定帧
            cap.set(cv2.CAP_PROP_POS_FRAMES, frame_idx)
            ret, frame = cap.read()
            if not ret:
                break
            
            # 裁剪底部25%区域并智能压缩（仅首帧输出日志）
            if first_frame:
                frame_processed = auto_crop_and_resize_frame(frame)
                first_frame = False
            else:
                # 后续帧静默处理
                h, w = frame.shape[:2]
                crop_start_y = int(h * 0.75)
                frame_cropped = frame[crop_start_y:h, 0:w]
                cropped_h, cropped_w = frame_cropped.shape[:2]
                
                target_height = 120
                if cropped_h > 240:
                    scale_factor = target_height / cropped_h
                    new_width = int(cropped_w * scale_factor)
                    frame_processed = cv2.resize(frame_cropped, (new_width, target_height), interpolation=cv2.INTER_AREA)
                elif cropped_h > 160:
                    scale_factor = target_height / cropped_h
                    new_width = int(cropped_w * scale_factor)
                    frame_processed = cv2.resize(frame_cropped, (new_width, target_height), interpolation=cv2.INTER_AREA)
                else:
                    frame_processed = frame_cropped
            
            # 保存处理后的帧到内存
            extracted_frames.append(frame_processed)
            frame_count += 1
            pbar.update(1)
            
            # 发送抽帧进度（占总进度的0-30%）
            progress = int((frame_count / estimated_ocr_frames) * 30)
            print(f"PROGRESS:{progress}", flush=True)
    
    # 释放视频资源
    cap.release()
    print(f"[抽帧完成] 已提取 {len(extracted_frames)} 帧，视频文件已释放", flush=True)
    
    # ==================== 阶段2: 初始化OCR ====================
    print("\\n[阶段2/3] 初始化PaddleOCR v2.7.0.0 引擎（CPU模式）...", flush=True)
    
    # 使用v2版本API（与 video_srt_ocr_gui.py 完全一致）
    # 参数说明：
    # - use_angle_cls=True: 启用文字方向分类
    # - lang='ch': 中文识别
    # - use_gpu=False: 使用CPU模式
    # - show_log=False: 关闭详细日志输出
    ocr = PaddleOCR(
        use_angle_cls=True,
        lang='ch',
        use_gpu=False,
        show_log=False
    )
    print("[OCR] PaddleOCR v2.7.0.0 CPU模型加载完成", flush=True)
    
    # ==================== 阶段3: OCR识别（单线程批处理）====================
    print("\\n[阶段3/3] 开始OCR识别（批处理模式）...", flush=True)
    
    previous_text = ""
    ocr_results = []
    
    import time
    first_frame_time = None
    
    with tqdm(total=len(extracted_frames), desc="OCR识别进度", ncols=80, file=sys.stdout, unit="帧") as pbar:
        for idx, frame in enumerate(extracted_frames):
            try:
                # 首帧性能测试
                if idx == 0:
                    start_time = time.time()
                
                # OCR识别（使用v2版本API: ocr.ocr(img, cls=True) 方法）
                # 与 video_srt_ocr_gui.py 完全一致
                result = ocr.ocr(frame, cls=True)
                
                # 首帧性能记录
                if idx == 0:
                    first_frame_time = time.time() - start_time
                    print(f"\\n[性能] 首帧OCR耗时: {first_frame_time:.2f}秒", flush=True)
                    if first_frame_time > 2:
                        print("[警告] OCR速度较慢，可能未使用GPU加速！", flush=True)
                    else:
                        print("[OK] OCR速度正常，GPU加速工作中", flush=True)
                
                # 提取文本（v2版本API返回格式）
                # result 结构：[[line1, line2, ...]] 其中 line = [[x1,y1,x2,y2,...], (text, confidence)]
                current_text = ""
                if result and result[0]:
                    for line in result[0]:
                        # line[1][0] 是识别出的文本，line[1][1] 是置信度
                        current_text += line[1][0]
                
                # 去重
                if current_text != previous_text and len(current_text.strip()) > 0:
                    ocr_results.append(current_text)
                    previous_text = current_text
                    
            except Exception as e:
                print(f"[警告] 第{idx}帧OCR失败: {e}", flush=True)
                import traceback
                traceback.print_exc()
            
            pbar.update(1)
            
            # 发送进度到主进程
            progress = 30 + int((idx / len(extracted_frames)) * 60)
            print(f"PROGRESS:{progress}", flush=True)
    
    # 清理内存
    del extracted_frames
    print(f"\\n[✓ 全部完成] 识别出 {len(ocr_results)} 行字幕（已去重）", flush=True)
    
    # 输出结果到标准输出（不写文件，由Node.js端处理）
    print("OCR_RESULT_START", flush=True)
    for line in ocr_results:
        print(line, flush=True)
    print("OCR_RESULT_END", flush=True)
    
    return len(ocr_results)

def main():
    if len(sys.argv) < 4:
        print("参数不足")
        sys.exit(1)
    
    video_path = sys.argv[1]
    output_path = sys.argv[2]
    interval_seconds = float(sys.argv[3])
    
    try:
        line_count = process_video(video_path, output_path, interval_seconds)
        print(f"SUCCESS:{line_count}")
    except Exception as e:
        print(f"ERROR:{str(e)}")
        sys.exit(1)

if __name__ == "__main__":
    main()
`

// ==================== 业务执行逻辑 ====================

/**
 * 检查字幕识别依赖是否安装且版本兼容。
 * 处理流程：
 * 1、解析解释器路径。
 * 2、在超时限制内查询依赖包及版本。
 * 3、汇总可用状态与重新安装提示。
 */
async function checkEnvironment(pythonHome) {
  // 1、解释器缺失时直接返回未配置状态。
  const pythonExec = resolvePythonExecutable(pythonHome)
  if (!pythonExec || !fs.existsSync(pythonExec)) {
    return { installed: false, message: 'Python环境未配置' }
  }

  // 2、快速检查：验证环境依赖是否存在。
  console.log('[Video OCR] 快速检查环境...')
  try {
    const pythonHomeDir = path.dirname(pythonExec)
    const env = buildPythonEnv(pythonHomeDir)
    
    // 检查paddleocr和paddlepaddle
    const packagesToCheck = ['paddleocr', 'paddlepaddle']
    const results = {}
    
    for (const pkg of packagesToCheck) {
      await Promise.race([
        new Promise((resolve, reject) => {
          const child = spawn(pythonExec, ['-m', 'pip', 'show', pkg], {
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          })
          
          let stdout = ''
          child.stdout.on('data', (chunk) => {
            stdout += chunk.toString()
          })
          
          child.on('close', (code) => {
            if (code === 0 && stdout.includes(`Name: ${pkg}`)) {
              // 提取版本号
              const versionMatch = stdout.match(/Version:\s*([^\s]+)/)
              const version = versionMatch ? versionMatch[1] : 'unknown'
              
              console.log(`[Video OCR] ${pkg}包已安装，版本: ${version}`)
              
              // 对于 paddleocr，检查是否是 2.7.0.0 版本
              if (pkg === 'paddleocr') {
                if (version === '2.7.0.0') {
                  results[pkg] = { installed: true, version, correct: true }
                } else {
                  results[pkg] = { installed: true, version, correct: false }
                  console.warn(`[Video OCR] 警告：PaddleOCR 版本不匹配，当前: ${version}，期望: 2.7.0.0`)
                }
              } else {
                results[pkg] = { installed: true, version, correct: true }
              }
              resolve()
            } else {
              console.log(`[Video OCR] ${pkg}未安装`)
              results[pkg] = { installed: false, version: null, correct: false }
              resolve()
            }
          })
          
          child.on('error', (error) => {
            console.error(`[Video OCR] 检查${pkg}失败:`, error)
            results[pkg] = { installed: false, version: null, correct: false }
            resolve()
          })
        }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error(`检查${pkg}超时`)), 3000)
        )
      ]).catch(() => {
        results[pkg] = { installed: false, version: null, correct: false }
      })
    }
    
    // 3、结合识别工具版本与引擎安装状态生成最终结论。
    const paddleocrOK = results['paddleocr']?.installed && results['paddleocr']?.correct
    const paddlepadOK = results['paddlepaddle']?.installed
    const allInstalled = paddleocrOK && paddlepadOK
    
    let message = '环境已安装'
    if (!allInstalled) {
      if (!paddleocrOK) {
        message = results['paddleocr']?.installed 
          ? `环境版本不匹配，需要重新安装`
          : '环境未安装'
      } else if (!paddlepadOK) {
        message = '环境不完整，需要重新安装'
      }
    } else {
      message = `环境已安装`
    }
    
    return { 
      installed: allInstalled, 
      message,
      details: results
    }
  } catch (error) {
    return { installed: false, message: error.message }
  }
}

/**
 * 清理旧的字幕识别依赖和模型缓存。
 * 处理流程：
 * 1、验证解释器并准备子进程环境。
 * 2、逐个卸载相关包，持续发送进度。
 * 3、清理模型缓存并报告完成。
 */
async function cleanEnvironment(pythonHome, progressCallback) {
  // 1、清理操作使用用户配置的解释器环境。
  const pythonExec = resolvePythonExecutable(pythonHome)
  if (!pythonExec || !fs.existsSync(pythonExec)) {
    throw new Error('Python环境未配置，请先配置Python路径')
  }

  const pythonHomeDir = path.dirname(pythonExec)
  const env = buildPythonEnv(pythonHomeDir)
  
  progressCallback?.({ percentage: 0, message: '开始清理环境...', log: '[清理] 开始卸载旧版本' })

  // 2、逐个卸载所有相关包。
  const packagesToUninstall = [
    { pkg: 'paddleocr', displayName: '字幕提取工具' },
    { pkg: 'paddlepaddle-gpu', displayName: '字幕提取引擎（GPU）' },
    { pkg: 'paddlepaddle', displayName: '字幕核心引擎' },
    { pkg: 'paddlex', displayName: '字幕提取环境' }
  ]
  
  for (let i = 0; i < packagesToUninstall.length; i++) {
    const item = packagesToUninstall[i]
    const progress = 10 + (i / packagesToUninstall.length) * 30
    
    progressCallback?.({ 
      percentage: progress, 
      message: `正在卸载旧版本...`, 
      log: `[${i + 1}/${packagesToUninstall.length}] 正在卸载${item.displayName}...` 
    })
    
    try {
      await new Promise((resolve) => {
        const child = spawn(pythonExec, ['-m', 'pip', 'uninstall', '-y', item.pkg], {
          env,
          stdio: ['ignore', 'pipe', 'pipe']
        })
        
        child.stdout.on('data', (chunk) => {
          // 不输出详细信息
        })
        
        child.on('close', () => {
          progressCallback?.({ percentage: progress, message: `正在卸载旧版本...`, log: `  ✓ ${item.displayName}卸载完成` })
          resolve()
        })
      })
    } catch (e) {
      console.log(`[Video OCR] 跳过卸载 ${item.pkg}`)
    }
  }
  
  // 3、清理缓存，并在删除工具不可用时使用文件系统接口。
  progressCallback?.({ percentage: 50, message: '正在清理缓存...', log: '\n[清理] 正在清理缓存文件' })
  
  const paddlexCachePath = path.join(os.homedir(), '.paddlex', 'official_models')
  if (fs.existsSync(paddlexCachePath)) {
    try {
      // 尝试使用 rimraf 清理
      try {
        const { rimraf } = await import('rimraf')
        await rimraf(paddlexCachePath)
        progressCallback?.({ percentage: 70, message: '正在清理缓存...', log: '  ✓ 缓存已清理' })
      } catch (rimrafError) {
        // rimraf 失败，使用 fs 递归删除
        fs.rmSync(paddlexCachePath, { recursive: true, force: true })
        progressCallback?.({ percentage: 70, message: '正在清理缓存...', log: '  ✓ 缓存已清理' })
      }
    } catch (e) {
      console.error('[Video OCR] 清理缓存失败:', e)
      progressCallback?.({ percentage: 70, message: '正在清理缓存...', log: '  ! 缓存清理失败' })
    }
  } else {
    progressCallback?.({ percentage: 70, message: '正在清理缓存...', log: '  - 无缓存需要清理' })
  }
  
  progressCallback?.({ percentage: 100, message: '清理完成', log: '\n✓ 清理完成！可以重新安装了' })
}

/**
 * 安装字幕识别依赖并初始化模型。
 * 处理流程：
 * 1、准备解释器、环境变量和下载源。
 * 2、升级安装工具并卸载不兼容的旧包。
 * 3、依次安装固定版本及依赖，失败时尝试后续源。
 * 4、初始化识别模型并通知安装完成。
 */
async function installEnvironment(pythonHome, useMirror, progressCallback) {
  // 1、验证解释器并按用户选项准备镜像参数。
  const pythonExec = resolvePythonExecutable(pythonHome)
  if (!pythonExec || !fs.existsSync(pythonExec)) {
    throw new Error('Python环境未配置，请先配置Python路径')
  }

  const pythonHomeDir = path.dirname(pythonExec)
  const env = buildPythonEnv(pythonHomeDir)
  
  // 镜像源配置（国内镜像加速）
  const mirrorUrl = 'https://pypi.tuna.tsinghua.edu.cn/simple'
  const mirrorArgs = useMirror ? ['-i', mirrorUrl, '--trusted-host', 'pypi.tuna.tsinghua.edu.cn'] : []
  
  progressCallback?.({ 
    percentage: 0, 
    message: '准备安装...', 
    log: `[安装模式] ${useMirror ? '使用国内镜像加速' : '使用官方源'}` 
  })
  
  progressCallback?.({ 
    percentage: 0, 
    message: '准备安装...', 
    log: `[准备安装] 正在准备安装环境...` 
  })

  // 2、先升级安装工具，再清理旧版识别依赖。
  progressCallback?.({ percentage: 5, message: '正在准备环境...', log: '[1/5] 正在检查安装工具' })
  await new Promise((resolve, reject) => {
    const pipArgs = ['-m', 'pip', 'install', '--upgrade', 'pip', ...mirrorArgs]
    const child = spawn(pythonExec, pipArgs, {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      // 不输出详细日志
    })
    
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      // 不输出详细日志
    })

    child.on('close', (code) => {
      if (code === 0) {
        progressCallback?.({ percentage: 5, message: '正在准备环境...', log: '  ✓ 安装工具就绪' })
        resolve()
      } else {
        console.warn('pip升级失败:', stderr)
        progressCallback?.({ percentage: 5, message: '正在准备环境...', log: '  ✓ 安装工具就绪' })
        resolve() // 继续执行，即使pip升级失败
      }
    })
  })

  // 先卸载旧版本（如果存在）
  progressCallback?.({ percentage: 10, message: '正在检查环境...', log: '\n[2/5] 正在检查旧版本' })
  try {
    await new Promise((resolve) => {
      const uninstall = spawn(pythonExec, ['-m', 'pip', 'uninstall', '-y', 'paddleocr', 'paddlex'], {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })
      
      uninstall.stdout.on('data', (chunk) => {
        // 不输出详细信息
      })
      
      uninstall.on('close', () => {
        progressCallback?.({ percentage: 10, message: '正在检查环境...', log: '  ✓ 环境检查完成' })
        resolve()
      })
    })
  } catch (e) {
    console.log('[Video OCR] 跳过卸载步骤')
    progressCallback?.({ percentage: 10, message: '正在检查环境...', log: '  ✓ 环境检查完成' })
  }

  // 3、安装指定版本的识别引擎、工具和依赖包。
  progressCallback?.({ percentage: 15, message: '安装字幕提取工具...', log: '\n[3/5] 安装字幕提取工具及依赖包' })
  
  const packages = [
    {
      name: 'paddlepaddle',
      version: '2.6.2',
      displayName: '字幕提取引擎',
      sources: [
        {
          args: ['paddlepaddle==2.6.2', ...mirrorArgs],
          desc: useMirror ? '国内镜像源' : '官方源'
        }
      ]
    },
    {
      name: 'paddleocr',
      version: '2.7.0.0',
      displayName: '字幕提取模型',
      sources: [
        {
          args: ['paddleocr==2.7.0.0', '--no-deps', ...mirrorArgs],
          desc: useMirror ? '国内镜像源' : '官方源'
        }
      ]
    },
    {
      name: 'paddleocr-dependencies-all',
      displayName: '字幕提取相关环境',
      sources: [
        {
          args: ['numpy<2.0', 'opencv-python', 'opencv-contrib-python', 'Pillow', 'pyclipper', 'lmdb', 'tqdm', 'visualdl', 'rapidfuzz', 'beautifulsoup4', 'lxml', 'premailer', 'openpyxl', 'attrdict', 'Shapely', 'scikit-image', 'imgaug', 'pyyaml', 'python-Levenshtein', ...mirrorArgs],
          desc: '全部依赖包'
        }
      ]
    }
  ]

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i]
    const stepPercentage = 15 + (i / packages.length) * 65
    
    // 显示更友好的包名称
    const displayName = pkg.displayName || '组件'
    const stepInfo = `[3/5] (${i + 1}/${packages.length})`
    
    progressCallback?.({ 
      percentage: stepPercentage, 
      message: `正在安装${displayName}...`,
      log: `\n  ${stepInfo} 正在安装${displayName}`
    })

    // 尝试多个镜像源
    let installed = false
    let lastError = null
    
    for (let sourceIdx = 0; sourceIdx < pkg.sources.length; sourceIdx++) {
      const source = pkg.sources[sourceIdx]
      
      progressCallback?.({ 
        percentage: stepPercentage, 
        message: `正在安装${displayName}...`,
        log: `    正在下载安装...`
      })
      
      try {
        await new Promise((resolve, reject) => {
          // 使用 python -m pip install 方式
          const args = ['-m', 'pip', 'install', ...source.args]
          
          const child = spawn(pythonExec, args, {
            env,
            stdio: ['ignore', 'pipe', 'pipe']
          })

          let stdout = ''
          let stderr = ''
          
          child.stdout.on('data', (chunk) => {
            const text = chunk.toString()
            stdout += text
            // 不输出详细的stdout信息，避免暴露技术细节
          })
          
          child.stderr.on('data', (chunk) => {
            const text = chunk.toString()
            stderr += text
            // pip的输出通常在stderr，简化输出避免暴露技术细节
            const lines = text.split('\n').filter(line => line.trim())
            lines.forEach(line => {
              // 只显示关键信息：成功安装
              const shouldShow = 
                line.includes('Successfully installed') ||
                line.includes('Requirement already satisfied')
              
              if (shouldShow) {
                progressCallback?.({ 
                  percentage: stepPercentage, 
                  message: `正在安装${displayName}...`,
                  log: `      安装中...`
                })
              }
            })
          })

          child.on('close', (code) => {
            if (code === 0) {
              progressCallback?.({ 
                percentage: stepPercentage, 
                message: `正在安装${displayName}...`,
                log: `    ✓ ${displayName}安装成功`
              })
              resolve()
            } else {
              reject(new Error(`${displayName}安装失败`))
            }
          })
        })
        
        // 安装成功，跳出循环
        installed = true
        break
        
      } catch (error) {
        lastError = error
        progressCallback?.({ 
          percentage: stepPercentage, 
          message: `正在安装${displayName}...`,
          log: `    ✗ 安装失败，正在重试...`
        })
        
        // 如果不是最后一个源，继续尝试下一个
        if (sourceIdx < pkg.sources.length - 1) {
          progressCallback?.({ 
            percentage: stepPercentage, 
            message: `正在安装${displayName}...`,
            log: `    → 切换下载源重试中...`
          })
          continue
        }
      }
    }
    
    // 所有源都失败
    if (!installed) {
      const errorMsg = `${displayName}安装失败`
      progressCallback?.({ 
        percentage: stepPercentage, 
        message: `正在安装${displayName}...`,
        log: `    ✗ ${errorMsg}`
      })
      throw new Error(errorMsg)
    }
  }

  progressCallback?.({ percentage: 90, message: '下载模型文件...', log: '\n[5/5] 初始化模型...' })
  
  // 4、首次初始化会自动下载模型，并将下载信息发送给页面。
  await new Promise((resolve, reject) => {
    const initScript = 'from paddleocr import PaddleOCR; import warnings; warnings.filterwarnings("ignore"); ocr = PaddleOCR(use_angle_cls=True, lang="ch", use_gpu=False, show_log=False); print("OK")'
    const child = spawn(pythonExec, ['-c', initScript], {
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    
    progressCallback?.({ percentage: 90, message: '下载模型文件...', log: '  正在初始化...' })

    let stdout = ''
    let stderr = ''
    
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString()
      stdout += text
      const lines = text.split('\n').filter(line => line.trim())
      lines.forEach(line => {
        if (line.length > 0) {
          progressCallback?.({ percentage: 90, message: '下载模型文件...', log: `  ${line}` })
        }
      })
    })
    
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString()
      stderr += text
      const lines = text.split('\n').filter(line => line.trim())
      lines.forEach(line => {
        // PaddleOCR的下载进度信息
        if (line.includes('download') || line.includes('model') || line.includes('%')) {
          progressCallback?.({ percentage: 90, message: '下载模型文件...', log: `  ${line}` })
        }
      })
    })

    child.on('close', (code) => {
      if (code === 0 || stdout.includes('OK')) {
        progressCallback?.({ percentage: 95, message: '下载模型文件...', log: '  ✓ 模型初始化完成' })
        resolve()
      } else {
        progressCallback?.({ percentage: 95, message: '下载模型文件...', log: `  ✗ 模型下载失败: ${stderr}` })
        reject(new Error('模型下载失败: ' + stderr))
      }
    })
  })

  progressCallback?.({ percentage: 100, message: '安装完成', log: '\n✓ 全部安装完成！' })
  progressCallback?.({ 
    percentage: 100, 
    message: '安装完成', 
    log: '   现在可以开始使用视频字幕提取功能了！' 
  })
}

/**
 * 提取视频字幕并按需调用 AI 纠错。
 * 处理流程：
 * 1、验证解释器、视频文件和可选的 AI 连接。
 * 2、准备输出目录及临时识别脚本。
 * 3、运行脚本，收集字幕并转发处理进度。
 * 4、按需纠错后保存最终文本，始终清理临时脚本。
 */
async function processVideo(payload, progressCallback) {
  // 1、检查任务输入，在视频处理前验证所需的远程连接。
  const { pythonHome, videoPath, outputDir, intervalSeconds, useAI, apiKey, apiBaseUrl, aiModel } = payload
  
  const pythonExec = resolvePythonExecutable(pythonHome)
  
  if (!pythonExec) {
    throw new Error('未配置有效的 Python 解释器路径')
  }

  if (!fs.existsSync(videoPath)) {
    throw new Error('视频文件不存在')
  }

  // AI连通性测试（在开始视频抽帧之前）
  if (useAI && apiKey) {
    console.log('[Video OCR] 开始AI连通性测试...')
    progressCallback?.({ percentage: 0, message: '正在测试AI连接...' })
    
    try {
      await testAIConnection(apiKey, apiBaseUrl, aiModel)
      console.log('[Video OCR] AI连通性测试通过')
      progressCallback?.({ percentage: 2, message: 'AI连接正常，准备开始处理...' })
    } catch (error) {
      console.error('[Video OCR] AI连通性测试失败:', error.message)
      throw new Error(`AI连接测试失败: ${error.message}`)
    }
  }

  // 2、创建输出目录，并准备本次任务的文件路径与临时脚本。
  const finalOutputDir = outputDir || DEFAULT_OUTPUT_DIR
  if (!fs.existsSync(finalOutputDir)) {
    fs.mkdirSync(finalOutputDir, { recursive: true })
  }

  // 生成输出文件名
  const videoName = path.basename(videoPath, path.extname(videoPath))
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5)
  const outputFileName = `${videoName}_${timestamp}.txt`
  const outputPath = path.join(finalOutputDir, outputFileName)

  // 创建临时Python脚本
  const tempScriptPath = path.join(app.getPath('temp'), `video_ocr_${Date.now()}.py`)
  fs.writeFileSync(tempScriptPath, VIDEO_OCR_SCRIPT, 'utf-8')

  try {
    console.log('[Video OCR] 开始处理视频:', videoPath)
    progressCallback?.({ percentage: 5, message: '正在初始化处理环境...' })

    const pythonHome = path.dirname(pythonExec)
    const env = buildPythonEnv(pythonHome)

    // 3、按脚本约定的标记收集正文、完成状态和阶段进度。
    const { lineCount, ocrResultLines } = await new Promise((resolve, reject) => {
      const args = [
        tempScriptPath,
        videoPath,
        outputPath,
        String(intervalSeconds)
      ]

      console.log('[Video OCR] 执行Python脚本:', pythonExec, args.join(' '))
      progressCallback?.({ 
        percentage: 5, 
        message: '初始化模型...' 
      })

      const child = spawn(pythonExec, args, {
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''
      let lineCount = 0
      let ocrResultLines = []  // 在内存中收集OCR结果
      let isCollectingResult = false

      child.stdout.on('data', (chunk) => {
        const data = chunk.toString()
        stdout += data
        
        const lines = data.split('\n')
        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue
          
          // 开始收集OCR结果
          if (trimmed === 'OCR_RESULT_START') {
            isCollectingResult = true
            console.log('[Video OCR] 开始接收OCR结果（内存）')
            continue
          }
          
          // 结束收集OCR结果
          if (trimmed === 'OCR_RESULT_END') {
            isCollectingResult = false
            lineCount = ocrResultLines.length
            console.log(`[Video OCR] OCR结果接收完成（内存），共${lineCount}行`)
            continue
          }
          
          // 收集OCR结果行
          if (isCollectingResult) {
            ocrResultLines.push(trimmed)
            continue
          }
          
          // 其他日志输出
          console.log('[Video OCR] Python stdout:', trimmed)

          // 解析进度信息
          const progressMatch = trimmed.match(/PROGRESS:(\d+)/)
          if (progressMatch) {
            const pythonPercentage = parseInt(progressMatch[1])
            // Python 的进度映射到 5-90% 区间（0-2% 用于AI测试，90-100% 用于AI纠错）
            const percentage = 5 + Math.floor(pythonPercentage * 0.85)
            console.log(`[Video OCR] 进度更新: ${percentage}%`)
            
            // 根据进度阶段显示不同的消息
            let message = ''
            if (percentage <= 30) {
              message = `正在对视频进行预处理... ${percentage}%`
            } else {
              message = `正在识别字幕... ${percentage}%`
            }
            
            progressCallback?.({ percentage, message })
          }

          // 解析成功信息
          const successMatch = trimmed.match(/SUCCESS:(\d+)/)
          if (successMatch) {
            lineCount = parseInt(successMatch[1])
            console.log(`[Video OCR] 识别完成，共${lineCount}行`)
          }
        }
      })

      let modelInitialized = false
      let lastProgressTime = Date.now()
      
      child.stderr.on('data', (chunk) => {
        const text = chunk.toString()
        stderr += text
        
        // 实时输出stderr日志（PaddleOCR的初始化信息在这里）
        const lines = text.split('\n').filter(line => line.trim())
        lines.forEach(line => {
          console.log('[Video OCR] Python stderr:', line)
          
          const now = Date.now()
          
          // 检测模型初始化开始
          if (!modelInitialized && (
              line.includes('PaddleOCR') || 
              line.includes('init') ||
              line.toLowerCase().includes('loading')
          )) {
            modelInitialized = true
            progressCallback?.({ 
              percentage: 10, 
              message: '正在加载模型...',
              log: line 
            })
            lastProgressTime = now
          }
          
          // 模型加载过程中的详细信息
          if (line.includes('model') || 
              line.includes('download') || 
              line.includes('det_') ||
              line.includes('rec_') ||
              line.includes('cls_')) {
            
            // 节流：每2秒更新一次进度
            if (now - lastProgressTime > 2000) {
              progressCallback?.({ 
                percentage: 15, 
                message: '加载模型组件...',
                log: line 
              })
              lastProgressTime = now
            }
          }
          
          // 检测开始处理视频
          if (line.includes('frame') || line.includes('视频')) {
            progressCallback?.({ 
              percentage: 20, 
              message: '模型加载完成，开始处理...'
            })
          }
        })
      })

      child.on('error', (error) => {
        console.error('[Video OCR] Python进程错误:', error)
        reject(error)
      })

      child.on('close', (code) => {
        console.log(`[Video OCR] Python进程结束，退出码: ${code}`)
        if (code === 0 || stdout.includes('SUCCESS') || ocrResultLines.length > 0) {
          resolve({ lineCount, ocrResultLines })
        } else {
          const errorMatch = stderr.match(/ERROR:(.+)/)
          const errorMsg = errorMatch ? errorMatch[1] : stderr
          console.error('[Video OCR] 处理失败:', errorMsg)
          reject(new Error(errorMsg || '视频处理失败'))
        }
      })
    })

    // 4、在内存中合并识别结果，并在可选纠错完成后写入文件。
    let finalContent = ocrResultLines.join('\n')
    console.log(`[Video OCR] OCR结果在内存中，共${ocrResultLines.length}行`)

    // 根据任务开关与密钥启用 AI 错别字纠正，在内存中处理。
    if (useAI && apiKey) {
      console.log('[Video OCR] 开始AI纠错（内存处理）...')
      progressCallback?.({ percentage: 90, message: '正在进行AI纠错...' })
      const aiConfig = { apiKey, apiBaseUrl, aiModel }
      
      try {
        // 在内存中进行AI纠错
        finalContent = await correctWithAIInMemory(finalContent, aiConfig, progressCallback)
        console.log('[Video OCR] AI纠错完成（内存）')
      } catch (error) {
        console.error('[Video OCR] AI纠错失败:', error.message)
        // AI出错时，不输出任何文本内容（防止暴露中间产物）
        throw new Error(`AI处理失败: ${error.message}`)
      }
    }

    // 只有最终结果才写入文件
    fs.writeFileSync(outputPath, finalContent, 'utf-8')
    console.log(`[Video OCR] 最终结果已保存: ${outputPath}`)

    console.log('[Video OCR] 全部处理完成')
    progressCallback?.({ percentage: 100, message: '处理完成' })

    const lines = finalContent.split('\n').filter(line => line.trim())
    return {
      outputPath: outputPath,
      lineCount: lines.length,
      preview: finalContent  // 显示全部内容，不截断
    }
  } finally {
    // 清理临时文件
    try {
      if (fs.existsSync(tempScriptPath)) {
        fs.unlinkSync(tempScriptPath)
      }
    } catch (e) {
      console.warn('[Video OCR] 清理临时文件失败:', e)
    }
  }
}

/**
 * 分批纠正识别文本并在内存中合并结果。
 * 处理流程：
 * 1、检查密钥，将正文分批并合并过短的末批。
 * 2、限制分组并发，遇到失败批次终止处理。
 * 3、按原批次顺序合并、格式化并返回文本。
 */
async function correctWithAIInMemory(content, config, progressCallback) {
  // 1、校验调用配置并准备正文分批。
  const { apiKey, apiBaseUrl, aiModel } = config
  
  if (!apiKey) {
    throw new Error('未配置API密钥')
  }

  const lines = content.split('\n').filter(line => line.trim())
  
  // 分批处理，每批100行
  const chunkSize = 100
  const chunks = []
  
  for (let i = 0; i < lines.length; i += chunkSize) {
    const remainingLines = lines.length - i
    
    // 尾部优化：如果剩余行数少于30且不是最后一批，则合并到当前批次
    if (remainingLines < chunkSize && remainingLines < 30 && chunks.length > 0) {
      // 将剩余的行合并到上一批
      const lastChunk = chunks[chunks.length - 1]
      chunks[chunks.length - 1] = lastChunk.concat(lines.slice(i))
      break
    } else {
      chunks.push(lines.slice(i, i + chunkSize))
    }
  }

  console.log(`[Video OCR] 开始AI纠错（内存），共${lines.length}行`)
  progressCallback?.({ percentage: 90, message: `正在进行AI纠错...` })

  // 2、通过分组限制并发，并保存每个批次的原始索引。
  const concurrency = 50 // 并发数限制
  const correctedChunks = new Array(chunks.length)
  
  // 分组并发处理
  for (let groupStart = 0; groupStart < chunks.length; groupStart += concurrency) {
    const groupEnd = Math.min(groupStart + concurrency, chunks.length)
    const currentGroup = []
    
    for (let i = groupStart; i < groupEnd; i++) {
      const chunkText = chunks[i].join('\n')
      console.log(`[Video OCR] 开始处理第${i + 1}/${chunks.length}批（内存）...`)
      
      // 创建Promise任务
      const task = callOpenAIAPI(
        apiKey, 
        apiBaseUrl,
        aiModel || 'gpt-4o-mini',
        chunkText
      )
        .then(corrected => {
          console.log(`[Video OCR] 第${i + 1}批完成（内存）`)
          return { index: i, text: corrected, success: true }
        })
        .catch(error => {
          console.error(`[Video OCR] 第${i + 1}批失败:`, error.message)
          // AI出错时不返回任何内容，而是标记为失败
          return { index: i, error: error.message, success: false }
        })
      
      currentGroup.push(task)
    }
    
    // 等待当前组完成
    const results = await Promise.all(currentGroup)
    
    // 检查是否有失败的批次
    const failedBatch = results.find(r => !r.success)
    if (failedBatch) {
      throw new Error(`第${failedBatch.index + 1}批处理失败: ${failedBatch.error}`)
    }
    
    // 按索引放入结果数组
    results.forEach(result => {
      correctedChunks[result.index] = result.text
    })
    
    const aiProgress = 90 + Math.floor((groupEnd / chunks.length) * 9)
    console.log(`[Video OCR] AI纠错进度: ${Math.floor((groupEnd / chunks.length) * 100)}%`)
    progressCallback?.({ 
      percentage: aiProgress, 
      message: `正在进行AI纠错... ${Math.floor((groupEnd / chunks.length) * 100)}%` 
    })
  }
  
  // 3、按索引合并纠正后的文本，在内存中完成最终格式化。
  let correctedContent = correctedChunks.join('\n')
  
  console.log(`[Video OCR] AI纠错完成（内存），开始格式化处理...`)
  
  // 格式化处理：将句子末尾标点符号转换为换行符，并清理多余换行
  correctedContent = formatSubtitleText(correctedContent)
  
  console.log(`[Video OCR] 格式化完成，返回最终内容`)
  progressCallback?.({ percentage: 99, message: '正在进行AI纠错... 99%' })
  return correctedContent
}

/**
 * 格式化字幕文本
 * 处理流程：
 * 1、检查输入并准备句末标点和引号配对表。
 * 2、跟踪引号状态，在引号外的句末标点后补换行。
 * 3、合并连续换行并清理首尾空白。
 */
function formatSubtitleText(text) {
  // 1、非文本输入直接返回，正常文本使用配对表跟踪引号。
  if (!text || typeof text !== 'string') {
    return text
  }
  
  // 定义句子末尾标点符号（中英文）
  const punctuationChars = '。！？；.!?;'
  
  let result = ''
  let inQuote = false
  let quoteStack = []
  
  // 定义引号对（开始引号 -> 结束引号）
  const quoteMap = {
    '\u201c': '\u201d',  // 中文/英文双引号 " "
    '\u2018': '\u2019',  // 中文/英文单引号 ' '
    '\u300c': '\u300d',  // 日文引号「」
    '\u300e': '\u300f',  // 日文书名号『』
    '"': '"',  // 双引号（通用）
    "'": "'"   // 单引号（通用）
  }
  
  // 所有可能的开引号
  const openQuotes = Object.keys(quoteMap)
  // 所有可能的闭引号
  const closeQuotes = Object.values(quoteMap)
  
  // 2、逐字符维护引号栈，保留原标点并按条件补充分行。
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    const nextChar = text[i + 1]
    
    // 检查是否是开引号
    if (openQuotes.includes(char)) {
      inQuote = true
      quoteStack.push(quoteMap[char])
      result += char
      continue
    }
    
    // 检查是否是闭引号
    if (closeQuotes.includes(char)) {
      // 检查是否匹配栈顶的期望闭引号
      if (quoteStack.length > 0 && quoteStack[quoteStack.length - 1] === char) {
        quoteStack.pop()
      }
      
      // 如果栈为空，说明已经闭合
      if (quoteStack.length === 0) {
        inQuote = false
      }
      
      result += char
      continue
    }
    
    // 如果是句子末尾标点符号
    if (punctuationChars.includes(char)) {
      result += char
      
      // 只在引号外的标点符号后添加换行
      // 同时检查下一个字符不是换行符，避免重复添加
      if (!inQuote && nextChar !== '\n' && nextChar !== undefined) {
        result += '\n'
      }
    } else {
      result += char
    }
  }
  
  // 3、清理所有连续的多个换行符为单个换行符。
  result = result.replace(/\n{2,}/g, '\n')
  
  // 去除首尾多余的换行符
  result = result.trim()
  
  console.log('[Video OCR] 格式化处理完成')
  return result
}

/**
 * 使用简短对话请求验证 AI 服务连接。
 * 处理流程：
 * 1、根据自定义地址构造请求。
 * 2、检查状态码与响应结构，区分配置和服务错误。
 * 3、发送请求并处理网络异常和超时。
 */
function testAIConnection(apiKey, baseUrl, model) {
  // 1、通过实际模型请求验证连接和配置。
  console.log('[Video OCR] 开始测试AI连通性...')
  return new Promise((resolve, reject) => {
    const url = buildApiUrl(baseUrl, 'v1/chat/completions')
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? require('https') : require('http')
    
    const postData = JSON.stringify({
      model: model,
      messages: [
        {
          role: 'user',
          content: '你好'
        }
      ],
      temperature: 0.3,
      max_tokens: 50
    })

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 15000 // 15秒超时
    }

    // 2、读取完整响应后验证状态码和对话结果结构。
    const req = httpModule.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          if (res.statusCode === 401) {
            reject(new Error('API密钥无效，请检查您的密钥是否正确'))
            return
          }
          
          if (res.statusCode === 403) {
            reject(new Error('API访问被拒绝，请检查您的权限'))
            return
          }
          
          if (res.statusCode === 404) {
            reject(new Error('API地址错误或模型不存在'))
            return
          }

          if (res.statusCode !== 200) {
            reject(new Error(`API连接失败: HTTP ${res.statusCode}`))
            return
          }

          const response = JSON.parse(data)
          
          if (response.choices && response.choices.length > 0) {
            console.log('[Video OCR] AI连通性测试成功')
            resolve(true)
          } else {
            reject(new Error('API返回格式异常'))
          }
        } catch (error) {
          reject(new Error(`API响应解析失败: ${error.message}`))
        }
      })
    })

    // 3、统一转交网络错误，并在超时后销毁请求。
    req.on('error', (error) => {
      reject(new Error(`网络连接失败: ${error.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('连接超时，请检查网络或API地址'))
    })

    req.write(postData)
    req.end()
  })
}

/**
 * 调用兼容 OpenAI 的接口纠正一批字幕。
 * 处理流程：
 * 1、构造自定义服务地址和字幕纠错请求。
 * 2、读取响应并提取第一条回答文本。
 * 3、发送请求并处理网络错误与超时。
 */
function callOpenAIAPI(apiKey, baseUrl, model, text) {
  // 1、保持提示词与正文分离，构造单批纠错请求。
  return new Promise((resolve, reject) => {
    // 解析URL
    const url = buildApiUrl(baseUrl, 'v1/chat/completions')
    const isHttps = url.protocol === 'https:'
    const httpModule = isHttps ? require('https') : require('http')
    
    const systemPrompt = `# 这是一段OCR识别的结果，请帮助我完成以下文本处理任务。

# 最重要的事情：
1、如果语义不通顺，可能是OCR识别错误地将水印和视频的名称标题混入了（特征是多个行内同一个名词重复出现，导致语义上的不通顺），请移除作者名称水印、封面标题、视频名称标题或者识别错误的一些特殊符号；
2、不要添加文案中没有的内容，不要二次创作，只需要进行文本的预处理即可；
3、经常有一些重复行，你需要精简移除重复行（这里的重复是指语义上的重复，即使文字内容不完全一致，但是本质上是同一句话也要进行处理）

# 任务：
1、进行错别字纠正；
2、删除其中的广告（如：开启评论 送礼物 看视频免30分钟广告>）
3、删除语义上重复的行和内容；
4、删除OCR识别到的错误的水印、封面文本、无意义符号；
5、删除表示章节标题的行，只保留原文内容（如：第一章，第1章等等）；
6、要求你不要在原文的基础上进行创造（即不要添加其他原文没有的信息）, 而是仅仅进行格式整理、分镜、简单的纠错；
7、不要输出任何其他文本，不要使用任何特殊的格式，完成我的任务并输出修正后的文本结果即可；

# 正确案例：
我的校花青梅是一个外冷内热的反差女
追了她七年
婚后她才承认对我一见钟情
却还偷偷享受着我追她的过程

# 请开始进行文案处理。原文：`
    
    const postData = JSON.stringify({
      model: model,
      messages: [
        {
          role: 'system',
          content: systemPrompt
        },
        {
          role: 'user',
          content: text
        }
      ],
      temperature: 0.3,
      max_tokens: 4000
    })

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 60000 // 60秒超时
    }

    const req = httpModule.request(options, (res) => {
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          if (res.statusCode !== 200) {
            reject(new Error(`API返回错误: ${res.statusCode} - ${data}`))
            return
          }

          const response = JSON.parse(data)
          
          if (response.choices && response.choices.length > 0) {
            const correctedText = response.choices[0].message.content.trim()
            resolve(correctedText)
          } else {
            reject(new Error('API返回格式错误'))
          }
        } catch (error) {
          reject(new Error(`解析响应失败: ${error.message}`))
        }
      })
    })

    req.on('error', (error) => {
      reject(new Error(`请求失败: ${error.message}`))
    })

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('请求超时'))
    })

    req.write(postData)
    req.end()
  })
}

// ==================== IPC 注册 ====================

/**
 * 注册字幕识别的环境管理与视频处理接口。
 * 处理流程：
 * 1、注册环境检查、清理和安装处理器。
 * 2、注册视频任务，并把长任务进度发送给发起页面。
 */
export function registerVideoOcrServiceHandlers() {
  // 1、为环境操作提供统一的成功与失败响应。
  ipcMain.handle('video-ocr:check-environment', async (_event, pythonHome) => {
    try {
      const envCheck = await checkEnvironment(pythonHome)
      return {
        success: true,
        data: envCheck
      }
    } catch (error) {
      console.error('[Video OCR] 检查环境失败:', error)
      return {
        success: false,
        message: error.message
      }
    }
  })

  ipcMain.handle('video-ocr:clean-environment', async (event, pythonHome) => {
    try {
      let lastProgress = { percentage: 0, message: '', log: '' }
      
      /**
       * 转发环境清理进度。
       * 处理流程：
       * 1、保存最新进度并发送给发起清理的页面。
       */
      const progressCallback = (progress) => {
        // 1、同步当前进度与页面展示数据。
        lastProgress = progress
        // 发送进度和日志到渲染进程
        event.sender.send('video-ocr:progress', progress)
      }

      await cleanEnvironment(pythonHome, progressCallback)
      
      return {
        success: true,
        message: '环境清理成功'
      }
    } catch (error) {
      console.error('[Video OCR] 清理环境失败:', error)
      return {
        success: false,
        message: error.message
      }
    }
  })

  ipcMain.handle('video-ocr:install-environment', async (event, pythonHome, useMirror) => {
    try {
      let lastProgress = { percentage: 0, message: '', log: '' }
      
      /**
       * 转发环境安装进度。
       * 处理流程：
       * 1、保存最新进度并发送给发起安装的页面。
       */
      const progressCallback = (progress) => {
        // 1、向当前任务页面同步安装进度和日志。
        lastProgress = progress
        // 发送进度和日志到渲染进程
        event.sender.send('video-ocr:progress', progress)
      }

      await installEnvironment(pythonHome, useMirror !== false, progressCallback)
      
      return {
        success: true,
        message: '环境安装成功'
      }
    } catch (error) {
      console.error('[Video OCR] 安装环境失败:', error)
      return {
        success: false,
        message: error.message
      }
    }
  })

  // 2、处理视频任务，并沿原调用窗口返回进度。
  ipcMain.handle('video-ocr:process-video', async (event, payload) => {
    try {
      let lastProgress = { percentage: 0, message: '' }
      
      /**
       * 转发视频字幕提取进度。
       * 处理流程：
       * 1、保存最新阶段并发送给任务发起页面。
       */
      const progressCallback = (progress) => {
        // 1、同步视频处理和可选纠错阶段的进度。
        lastProgress = progress
        // 发送进度到渲染进程
        event.sender.send('video-ocr:progress', progress)
      }

      const result = await processVideo(payload, progressCallback)
      
      return {
        success: true,
        data: result
      }
    } catch (error) {
      console.error('[Video OCR] 处理视频失败:', error)
      return {
        success: false,
        message: error.message
      }
    }
  })

  console.log('[Video OCR] IPC 处理器已注册')
}

/**
 * 注销字幕识别服务接口。
 * 处理流程：
 * 1、移除本模块的环境管理和视频处理通道。
 */
export function unregisterVideoOcrServiceHandlers() {
  // 1、与注册入口保持一致，清理全部处理器。
  ipcMain.removeHandler('video-ocr:check-environment')
  ipcMain.removeHandler('video-ocr:clean-environment')
  ipcMain.removeHandler('video-ocr:install-environment')
  ipcMain.removeHandler('video-ocr:process-video')
  console.log('[Video OCR] IPC 处理器已移除')
}
