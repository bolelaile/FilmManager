/**
 * Accelerator 工具：KeyboardEvent ↔ 绑定字符串 互转、规范化、人类可读格式。
 * 绑定格式：修饰键按 [Ctrl, Cmd, Alt, Shift] 固定顺序 + 主键，如 "Ctrl+Shift+F"、"ArrowLeft"。
 * metaKey→Cmd（mac），ctrlKey→Ctrl。
 */

const MOD_ORDER = ['Ctrl', 'Cmd', 'Alt', 'Shift'] as const

/** 主键规范化映射 */
function normalizeKey(key: string): string {
  if (key === ' ') return 'Space'
  if (key.length === 1) return key.toUpperCase()
  // 方向键 / 功能键保持原样（首字母大写已由 KeyboardEvent.key 提供，如 "ArrowLeft"）
  return key
}

/** 将 KeyboardEvent 转为 accelerator 字符串；纯修饰键按下返回 null */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = e.key
  // 纯修饰键不构成绑定
  if (['Control', 'Meta', 'Alt', 'Shift'].includes(key)) return null
  const parts: string[] = []
  if (e.ctrlKey) parts.push('Ctrl')
  if (e.metaKey) parts.push('Cmd')
  if (e.altKey) parts.push('Alt')
  // 仅对字母键与多字符功能键（ArrowLeft/F1 等）追加 Shift；
  // 对单字符符号键（如 '?'=Shift+'/ 、'+'=Shift+'='）不追加——Shift 已隐含在字符中，
  // 否则 'Shift+?' 与默认绑定 '?' 不匹配。
  const isLetter = /^[a-z]$/i.test(key)
  if (e.shiftKey && (key.length > 1 || isLetter)) parts.push('Shift')
  parts.push(normalizeKey(key))
  return parts.join('+')
}

/** 规范化绑定字符串（解析再序列化，用于比较与持久化） */
export function normalizeBinding(s: string): string {
  const trimmed = s.trim()
  if (!trimmed) return ''
  const tokens = trimmed.split('+')
  const mods: string[] = []
  let main = ''
  for (const raw of tokens) {
    const t = raw.trim()
    if (!t) continue
    const lower = t.toLowerCase()
    if (lower === 'ctrl' || lower === 'control') mods.push('Ctrl')
    else if (lower === 'cmd' || lower === 'meta' || lower === 'command') mods.push('Cmd')
    else if (lower === 'alt' || lower === 'option') mods.push('Alt')
    else if (lower === 'shift') mods.push('Shift')
    else main = main ? `${main}+${t}` : normalizeKey(t)
  }
  const ordered = MOD_ORDER.filter((m) => mods.includes(m))
  return [...ordered, main].filter(Boolean).join('+')
}

/** 人类可读展示 */
export function formatBinding(s: string): string {
  const n = normalizeBinding(s)
  if (!n) return '无'
  return n.replace(/Ctrl/g, 'Ctrl').replace(/Cmd/g, '⌘').replace(/Alt/g, 'Alt').replace(/Shift/g, 'Shift')
}
