/** PSD客户端：保留原公开接口，将解析交给可终止队列，其余纯算法复用同一实现。 */
import { parsePSDInWorker } from '../psd-worker-queue.mjs';
export { renderPSDLayers, detectComponents, validatePSDFile, getPSDInfo } from './psd-engine.mjs';

/**
 * 在工作线程中解析PSD。
 * 处理流程：
 * 1、将输入、原选项和超时交给单活动队列，不转移调用方缓冲区。
 */
async function parsePSD(fileBuffer, options = {}, timeout = 30000, signal) {
    // 1、取消信号仅控制任务生命周期，不加入返回的解析选项。
    return parsePSDInWorker(fileBuffer, options, timeout, signal);
}

export { parsePSD };
