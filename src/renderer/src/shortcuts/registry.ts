/**
 * 快捷键动作注册表。
 * 每个动作有唯一 id、所属类别（决定冲突检测的可达域）、描述、默认绑定。
 * 绑定采用 Electron 风格 accelerator 字符串，如 "Ctrl+Shift+F"、"F"、"ArrowLeft"。
 *
 * 冲突检测规则：两个动作冲突当且仅当它们可能同时可达。
 *  - 全局动作始终可达；
 *  - 照片网格动作在 viewMode=photos 且无全屏预览时可达；
 *  - 全屏预览动作在预览打开时可达。
 * 等价：A、B 同绑定，若 A.category===B.category 或任一为"全局" → 冲突。
 * 即：全局绑定全局唯一；同类别内唯一；网格与预览可共用同绑定（如 F）。
 */

export type ShortcutCategory = '全局' | '照片网格' | '全屏预览'

export interface ShortcutAction {
  id: string
  category: ShortcutCategory
  description: string
  /** 默认绑定（accelerator 字符串）；'' 表示默认无绑定 */
  defaultBinding: string
}

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  // ── 全局 ──
  { id: 'search.focus', category: '全局', description: '聚焦搜索框', defaultBinding: 'Ctrl+F' },
  { id: 'view.rolls', category: '全局', description: '切换到卷视图', defaultBinding: '1' },
  { id: 'view.photos', category: '全局', description: '切换到照片视图', defaultBinding: '2' },
  { id: 'view.timeline', category: '全局', description: '切换到时间线视图', defaultBinding: '3' },
  { id: 'thumb.smaller', category: '全局', description: '缩小缩略图', defaultBinding: '[' },
  { id: 'thumb.larger', category: '全局', description: '放大缩略图', defaultBinding: ']' },
  { id: 'import.open', category: '全局', description: '打开导入对话框', defaultBinding: 'Ctrl+I' },
  { id: 'export.selected', category: '全局', description: '导出选中照片', defaultBinding: 'Ctrl+E' },
  { id: 'selectAll', category: '全局', description: '全选当前页', defaultBinding: 'Ctrl+A' },
  { id: 'deselectAll', category: '全局', description: '取消选中', defaultBinding: 'Ctrl+D' },
  { id: 'attrs.copy', category: '全局', description: '复制属性', defaultBinding: 'Ctrl+Shift+C' },
  { id: 'attrs.paste', category: '全局', description: '粘贴属性', defaultBinding: 'Ctrl+Shift+V' },
  { id: 'shortcuts.help', category: '全局', description: '快捷键帮助', defaultBinding: '?' },
  { id: 'trash.open', category: '全局', description: '打开回收站', defaultBinding: '' },

  // ── 照片网格（viewMode=photos 且无预览时） ──
  { id: 'grid.up', category: '照片网格', description: '焦点上移', defaultBinding: 'ArrowUp' },
  { id: 'grid.down', category: '照片网格', description: '焦点下移', defaultBinding: 'ArrowDown' },
  { id: 'grid.left', category: '照片网格', description: '焦点左移', defaultBinding: 'ArrowLeft' },
  { id: 'grid.right', category: '照片网格', description: '焦点右移', defaultBinding: 'ArrowRight' },
  { id: 'grid.open', category: '照片网格', description: '打开全屏预览', defaultBinding: 'Enter' },
  { id: 'grid.toggleSelect', category: '照片网格', description: '切换选中', defaultBinding: 'Space' },
  { id: 'grid.star', category: '照片网格', description: '收藏/取消收藏', defaultBinding: 'F' },
  { id: 'grid.rotate', category: '照片网格', description: '顺时针旋转 90°', defaultBinding: 'R' },
  { id: 'grid.delete', category: '照片网格', description: '移入回收站', defaultBinding: 'Delete' },
  { id: 'grid.moveToSubLib', category: '照片网格', description: '移动到子库', defaultBinding: 'M' },

  // ── 全屏预览（预览打开时） ──
  { id: 'viewer.prev', category: '全屏预览', description: '上一张', defaultBinding: 'ArrowLeft' },
  { id: 'viewer.next', category: '全屏预览', description: '下一张', defaultBinding: 'ArrowRight' },
  { id: 'viewer.star', category: '全屏预览', description: '收藏/取消收藏', defaultBinding: 'F' },
  { id: 'viewer.rotate', category: '全屏预览', description: '顺时针旋转 90°', defaultBinding: 'R' },
  { id: 'viewer.export', category: '全屏预览', description: '导出当前', defaultBinding: 'E' },
  { id: 'viewer.toggleInfo', category: '全屏预览', description: '切换信息面板', defaultBinding: 'I' },
  { id: 'viewer.zoomIn', category: '全屏预览', description: '放大', defaultBinding: '+' },
  { id: 'viewer.zoomOut', category: '全屏预览', description: '缩小', defaultBinding: '-' },
  { id: 'viewer.zoomReset', category: '全屏预览', description: '重置缩放', defaultBinding: '0' },
  { id: 'viewer.first', category: '全屏预览', description: '跳到首张', defaultBinding: 'Home' },
  { id: 'viewer.last', category: '全屏预览', description: '跳到末张', defaultBinding: 'End' },
  { id: 'viewer.close', category: '全屏预览', description: '关闭预览', defaultBinding: 'Escape' },
]

export const DEFAULT_BINDINGS: Record<string, string> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a.defaultBinding])
)

export const ACTION_BY_ID: Record<string, ShortcutAction> = Object.fromEntries(
  SHORTCUT_ACTIONS.map((a) => [a.id, a])
)

/** 判定两个类别是否可能同时可达（用于冲突检测） */
export function categoriesConflict(a: ShortcutCategory, b: ShortcutCategory): boolean {
  if (a === b) return true
  if (a === '全局' || b === '全局') return true
  return false
}

/**
 * 检测将 actionId 绑定为 binding 是否与其它动作冲突。
 * 返回冲突的动作描述数组（空表示无冲突）。
 */
export function findConflicts(
  bindings: Record<string, string>,
  actionId: string,
  binding: string
): string[] {
  const normalized = binding.trim()
  if (!normalized) return []
  const targetAction = ACTION_BY_ID[actionId]
  if (!targetAction) return []
  const conflicts: string[] = []
  for (const [otherId, otherBinding] of Object.entries(bindings)) {
    if (otherId === actionId) continue
    if (!otherBinding) continue
    if (normalizeEq(otherBinding, normalized)) {
      const otherAction = ACTION_BY_ID[otherId]
      if (otherAction && categoriesConflict(targetAction.category, otherAction.category)) {
        conflicts.push(otherAction.description)
      }
    }
  }
  return conflicts
}

/** 绑定相等比较（忽略大小写、空格） */
function normalizeEq(a: string, b: string): boolean {
  return a.replace(/\s+/g, '').toLowerCase() === b.replace(/\s+/g, '').toLowerCase()
}
