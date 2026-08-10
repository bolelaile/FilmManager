import { create } from 'zustand'
import type { FilterState } from '../types'

const defaultFilter: FilterState = {
  filters: {},
  dateField: 'imported_at',
  sortBy: 'imported_at',
  sortOrder: 'desc'
}

interface FilterSlice {
  filter: FilterState
  setFilter: (f: Partial<FilterState>) => void
  resetFilter: () => void

  selectedIds: Set<number>
  toggleSelect: (id: number) => void
  selectAll: (ids: number[]) => void
  clearSelection: () => void
}

export const useFilterStore = create<FilterSlice>((set) => ({
  filter: defaultFilter,
  setFilter: (f) => set((s) => ({ filter: { ...s.filter, ...f } })),
  resetFilter: () => set({ filter: defaultFilter }),

  selectedIds: new Set(),
  toggleSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds)
      next.has(id) ? next.delete(id) : next.add(id)
      return { selectedIds: next }
    }),
  selectAll: (ids) => set({ selectedIds: new Set(ids) }),
  clearSelection: () => set({ selectedIds: new Set() })
}))
