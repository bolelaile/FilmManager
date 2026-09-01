/**
 * 通用快捷键监听 hook。
 * 给定一组 actionId 与对应 handler，读取 useShortcutsStore 中的绑定，
 * 在 active 时监听 window keydown 并分发。
 *
 - 通过 ref 持有最新 handlers，避免每次渲染重绑监听（handlers 常依赖 selectedIds/photos 等易变状态）。
 * 输入框聚焦时跳过（避免影响输入）。
 */
import { useEffect, useRef } from 'react'
import { useShortcutsStore } from '../store/shortcutsSlice'
import { eventToAccelerator, normalizeBinding } from '../shortcuts/accelerator'

export function useShortcutListener(
  actionIds: string[],
  handlers: Record<string, (() => void) | undefined>,
  active: boolean,
  skipWhenModalOpen = false
): void {
  const bindings = useShortcutsStore((s) => s.bindings)
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers
  const actionKey = actionIds.join(',')

  useEffect(() => {
    if (!active) return
    // 绑定 → actionId 反查（仅本组动作）
    const lookup = new Map<string, string>()
    for (const id of actionIds) {
      const b = bindings[id]
      if (b) lookup.set(normalizeBinding(b).toLowerCase(), id)
    }
    if (lookup.size === 0) return

    const onKey = (e: KeyboardEvent) => {
      const ae = document.activeElement as HTMLElement | null
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return
      // 任一 antd Modal 打开时跳过全局/网格快捷键（避免在弹窗后误操作照片）。
      // 全屏预览自身的快捷键不设此项（预览本身即 Modal，但此时仅预览监听激活）。
      if (skipWhenModalOpen && document.querySelector('.ant-modal-content')) return
      const acc = eventToAccelerator(e)
      if (!acc) return
      const id = lookup.get(normalizeBinding(acc).toLowerCase())
      if (id) {
        const h = handlersRef.current[id]
        if (h) {
          e.preventDefault()
          h()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, bindings, actionKey, skipWhenModalOpen])
}
