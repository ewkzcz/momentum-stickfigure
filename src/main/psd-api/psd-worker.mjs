/** PSD工作线程入口：仅接收字节和选项，执行完整原解析算法并返回可克隆结果。 */
import { parentPort, workerData } from 'node:worker_threads'
import { parsePSD } from './psd-engine.mjs'

// 1、原解析器的同步工作由主进程计时并终止，此处保留其默认解析及错误语义。
try {
  const result = await parsePSD(workerData.fileBuffer, workerData.options)
  parentPort.postMessage({ success: true, result })
} catch (error) {
  // 2、显式传递原错误消息，不重复叠加解析失败前缀。
  parentPort.postMessage({ success: false, error: error.message })
} finally {
  // 3、单次任务完成后关闭消息端口，主进程还会确认线程exit。
  parentPort.close()
}
