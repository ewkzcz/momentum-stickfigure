/** 渲染性能日志：累计操作耗时和事件次数，并按阈值或采样频率输出本地日志。 */
import log from 'electron-log/renderer'

const isProduction = import.meta?.env?.MODE === 'production'
const defaultDurationThreshold = 16 // ms
const logger = log.scope ? log.scope('renderer-perf') : log

/**
 * 获取计时基准。
 * 处理流程：
 * 1、优先使用高精度时钟，不可用时回退到系统时间。
 */
const now = () => {
  // 1、同一次计时使用当前环境可用的时钟。
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now()
  }
  return Date.now()
}

/**
 * 创建一个性能日志记录器，用于在渲染进程中采集关键耗时
 * 日志通过 electron-log 写入，生产环境同样可见
 * 处理流程：
 * 1、初始化命名空间、统计容器和耗时阈值。
 * 2、返回计时、直接记录耗时和事件采样接口。
 */
export function createPerformanceLogger(namespace = 'app', options = {}) {
  // 1、每个记录器独立维护累计数据和日志阈值。
  const nsLogger = logger.scope ? logger.scope(namespace) : logger
  const metrics = new Map()
  const events = new Map()
  const threshold = options.threshold ?? defaultDurationThreshold

  /**
   * 累计一次耗时并按规则输出。
   * 处理流程：
   * 1、更新次数、总耗时和最大耗时。
   * 2、超过阈值或达到开发环境采样次数时记录统计结果。
   */
  const recordDuration = (label, duration, meta = {}) => {
    // 1、先累计全部调用，未输出的样本也参与平均值。
    const key = `${namespace}:${label}`
    const stat = metrics.get(key) || { count: 0, total: 0, max: 0 }
    stat.count++
    stat.total += duration
    stat.max = Math.max(stat.max, duration)
    metrics.set(key, stat)

    // 2、慢操作直接记录，普通操作仅在开发环境按次数采样。
    const avg = stat.total / stat.count
    const shouldLog =
      duration >= (meta.threshold ?? threshold) ||
      (!isProduction && stat.count % (meta.sampleEvery ?? 10) === 0)

    if (shouldLog) {
      nsLogger.info(`[Perf] ${label}`, {
        duration: Number(duration.toFixed(2)),
        avg: Number(avg.toFixed(2)),
        max: Number(stat.max.toFixed(2)),
        count: stat.count,
        ...meta
      })
    }
  }

  // 2、对外暴露计时与事件统计方法，共用上述累计容器。
  return {
    /**
     * 启动一个计时器，调用 end() 记录耗时
     * 处理流程：
     * 1、捕获起始时间并返回持有该时间的结束方法。
     */
    start(label, startOptions = {}) {
      // 1、将起点保存在本次调用的闭包中。
      const startedAt = now()
      return {
        /**
         * 结束本次计时。
         * 处理流程：
         * 1、计算耗时，合并结束参数并写入累计统计。
         */
        end(meta = {}) {
          // 1、结束参数覆盖启动参数，方便补充操作结果。
          const duration = now() - startedAt
          recordDuration(label, duration, { ...startOptions, ...meta })
        }
      }
    },
    /**
     * 直接记录一个耗时（无需 start/end）
     * 处理流程：
     * 1、将外部测量的耗时交给统一统计入口。
     */
    trace(label, duration, meta = {}) {
      // 1、复用同一套阈值和累计规则。
      recordDuration(label, duration, meta)
    },
    /**
     * 记录一次事件出现次数
     * 处理流程：
     * 1、递增指定事件的出现次数。
     * 2、强制输出或达到采样间隔时写入日志。
     */
    logEvent(label, meta = {}, eventOptions = {}) {
      // 1、按命名空间和标签隔离不同事件的计数。
      const key = `${namespace}:${label}`
      const stat = events.get(key) || { count: 0 }
      stat.count++
      events.set(key, stat)

      // 2、生产环境采用较低输出频率，调用方可覆盖或强制记录。
      const sampleEvery =
        eventOptions.sampleEvery ?? (isProduction ? 20 : 5)
      if (eventOptions.force || stat.count % sampleEvery === 0) {
        nsLogger.info(`[Perf] ${label}`, {
          count: stat.count,
          ...meta
        })
      }
    }
  }
}
