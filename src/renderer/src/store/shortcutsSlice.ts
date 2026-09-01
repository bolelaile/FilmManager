/**
 * 快捷键绑定 store。
 * bindings: actionId → accelerator 字符串（与 DEFAULT_BINDINGS 合并，未自定义的用默认）。
 * 启动时从 db_meta 加载（app:getShortcuts），变更时持久化（app:setShortcuts）。
 */
import { create } from 'zustand'
import { DEFAULT_BINDINGS } from '../shortcuts/registry'
import { normalizeBinding } from '../shortcuts/accelerator'

interface ShortcutsState {
  bindings: Record<string, string>
  loaded: boolean
  loadBindings: () => Promise<void>
  setBinding: (id: string, binding: string) => void
  clearBinding: (id: string) => void
  resetAll: () => Promise<void>
}

/** 合并持久化绑定与默认（仅覆盖已自定义的） */
function mergeWithDefaults(stored: Record<string, string> | null): Record<string, string> {
  const merged: Record<string, string> = { ...DEFAULT_BINDINGS }
  if (stored) {
    for (const [id, b] of Object.entries(stored)) {
      // 空字符串表示显式清除绑定（覆盖默认）
      merged[id] = b === '' ? '' : normalizeBinding(b)
    }
  }
  return merged
}

export const useShortcutsStore = create<ShortcutsState>((set, get) => ({
  bindings: { ...DEFAULT_BINDINGS },
  loaded: false,
  loadBindings: async () => {
    try {
      const stored = await window.api.app.getShortcuts() as Record<string, string> | null
      set({ bindings: mergeWithDefaults(stored), loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  setBinding: (id, binding) => {
    const normalized = binding ? normalizeBinding(binding) : ''
    const next = { ...get().bindings, [id]: normalized }
    set({ bindings: next })
    // 持久化：仅存非默认项 + 显式清除项，减小体积
    const toStore: Record<string, string> = {}
    for (const [aid, b] of Object.entries(next)) {
      if (DEFAULT_BINDINGS[aid] !== b) toStore[aid] = b
    }
    void window.api.app.setShortcuts(toStore)
  },
  clearBinding: (id) => get().setBinding(id, ''),
  resetAll: async () => {
    set({ bindings: { ...DEFAULT_BINDINGS } })
    await window.api.app.setShortcuts({})
  },
}))
