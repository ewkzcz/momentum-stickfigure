/** 生成历史记录：保存、查询、改名、收藏、置顶、删除；新增记录时通知所有面板刷新。 */
import { ref, reactive, watch } from 'vue'

const version = ref(0)

/**
 * 保存一条记录（各生成入口调用）。
 * 处理流程：
 * 1、交给主进程落盘，失败只记录日志，不影响生成结果展示。
 * 2、成功后递增版本号，打开的历史面板自动刷新。
 */
export async function saveHistory(record) {
  // 1、落盘。
  try {
    const result = await window.creativeApi.addHistory({ record: JSON.parse(JSON.stringify(record)) })
    if (!result?.success) console.warn('保存生成记录失败:', result?.message)
    // 2、通知刷新。
    else version.value += 1
  } catch (error) {
    console.warn('保存生成记录失败:', error)
  }
}

/** 历史面板状态；处理流程：1、按类型维护筛选条件、列表和选中项，2、提供各项管理操作。 */
export function useGenerationHistory(kind, message) {
  const query = reactive({ keyword: '', mode: '', favoriteOnly: false })
  const records = ref([])
  const selected = ref(new Set())
  const loading = ref(false)

  /** 刷新列表；处理流程：1、按筛选条件查询，2、清理已不存在的选中项。 */
  const refresh = async () => {
    // 1、查询。
    loading.value = true
    try {
      const result = await window.creativeApi.listHistory({ kind, keyword: query.keyword || undefined, mode: query.mode || undefined, favoriteOnly: query.favoriteOnly })
      if (!result?.success) {
        message.error(`读取生成记录失败：${result?.message || '未知错误'}`)
        return
      }
      records.value = result.data
      // 2、保留仍存在的选中项。
      const ids = new Set(records.value.map((item) => item.id))
      selected.value = new Set([...selected.value].filter((id) => ids.has(id)))
    } finally {
      loading.value = false
    }
  }

  /** 修改记录；处理流程：1、提交修改，2、成功后刷新。 */
  const update = async (id, patch) => {
    // 1、改名、收藏、置顶共用。
    const result = await window.creativeApi.updateHistory({ id, patch })
    if (!result?.success) message.error(`修改失败：${result?.message || '未知错误'}`)
    else await refresh()
  }

  /** 删除记录（单条或批量）；处理流程：1、提交删除，2、提示数量并刷新。 */
  const remove = async (ids) => {
    // 1、删除原图与索引。
    if (!ids.length) return
    const result = await window.creativeApi.deleteHistory({ ids })
    if (!result?.success) {
      message.error(`删除失败：${result?.message || '未知错误'}`)
      return
    }
    // 2、刷新。
    message.success(`已删除 ${result.data.removed} 条记录`)
    await refresh()
  }

  /** 切换选中；处理流程：1、用新集合替换，触发界面更新。 */
  const toggleSelect = (id) => {
    // 1、集合不可变更新。
    const next = new Set(selected.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selected.value = next
  }

  /** 全选/取消全选当前列表；处理流程：1、已全选时清空，否则选中全部。 */
  const toggleSelectAll = () => {
    // 1、只针对当前筛选结果。
    selected.value = selected.value.size === records.value.length ? new Set() : new Set(records.value.map((item) => item.id))
  }

  /** 读取原图或视频地址；处理流程：1、按记录 ID 和序号向主进程获取。 */
  const readMedia = async (id, index) => {
    // 1、失败返回 null。
    const result = await window.creativeApi.readHistoryMedia({ id, index })
    return result?.success ? result.data : null
  }

  // 筛选条件变化或有新记录时刷新。
  watch(() => [query.mode, query.favoriteOnly, version.value], refresh)

  return { query, records, selected, loading, refresh, update, remove, toggleSelect, toggleSelectAll, readMedia }
}
