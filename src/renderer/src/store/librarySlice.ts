import { create } from 'zustand'
import type { AttributeType, SubLibrary, IccProfile } from '../types'

interface LibrarySlice {
  attrTypes: AttributeType[]
  setAttrTypes: (types: AttributeType[]) => void

  filmIconCache: Record<string, string>
  setFilmIconCache: (cache: Record<string, string>) => void
  mergeFilmIconCache: (batch: Record<string, string>) => void

  subLibraries: SubLibrary[]
  setSubLibraries: (libs: SubLibrary[]) => void

  iccProfiles: IccProfile[]
  setIccProfiles: (p: IccProfile[]) => void

  activeProfile: IccProfile | null
  setActiveProfile: (p: IccProfile | null) => void

  importProgress: { total: number; imported: number; skipped: number } | null
  setImportProgress: (p: { total: number; imported: number; skipped: number } | null) => void
}

export const useLibraryStore = create<LibrarySlice>((set) => ({
  attrTypes: [],
  setAttrTypes: (types) => set({ attrTypes: types }),

  filmIconCache: {},
  setFilmIconCache: (cache) => set({ filmIconCache: cache }),
  mergeFilmIconCache: (batch) => set((s) => ({ filmIconCache: { ...s.filmIconCache, ...batch } })),

  subLibraries: [],
  setSubLibraries: (libs) => set({ subLibraries: libs }),

  iccProfiles: [],
  setIccProfiles: (p) => set({ iccProfiles: p }),

  activeProfile: null,
  setActiveProfile: (p) => set({ activeProfile: p }),

  importProgress: null,
  setImportProgress: (p) => set({ importProgress: p })
}))
