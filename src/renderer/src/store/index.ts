import { create } from 'zustand'
import type { AttributeType, FilterState, Photo, SubLibrary, IccProfile } from '../types'

interface AppStore {
  // 属性数据
  attrTypes: AttributeType[]
  setAttrTypes: (types: AttributeType[]) => void

  // 胶片图标缓存（iconKey -> dataURL）
  filmIconCache: Record<string, string>
  setFilmIconCache: (cache: Record<string, string>) => void
  mergeFilmIconCache: (batch: Record<string, string>) => void

  // 子库
  subLibraries: SubLibrary[]
  setSubLibraries: (libs: SubLibrary[]) => void

  // 筛选状态
  filter: FilterState
  setFilter: (f: Partial<FilterState>) => void
  resetFilter: () => void

  // 选中状态
  selectedIds: Set<number>
  toggleSelect: (id: number) => void
  selectAll: (ids: number[]) => void
  clearSelection: () => void

  // 查看模式
  thumbnailSize: 'small' | 'medium' | 'large'
  setThumbnailSize: (s: 'small' | 'medium' | 'large') => void

  // 全屏预览
  viewerPhoto: Photo | null
  setViewerPhoto: (p: Photo | null) => void
  viewerPhotos: Photo[]
  setViewerPhotos: (ps: Photo[]) => void
  viewerIndex: number
  setViewerIndex: (i: number) => void
  closeViewer: () => void

  // ICC 配置文件
  iccProfiles: IccProfile[]
  setIccProfiles: (p: IccProfile[]) => void
  activeProfile: IccProfile | null
  setActiveProfile: (p: IccProfile | null) => void

  // 导入进度
  importProgress: { total: number; imported: number; skipped: number } | null
  setImportProgress: (p: { total: number; imported: number; skipped: number } | null) => void

  // UI 状态
  settingsOpen: boolean
  setSettingsOpen: (v: boolean) => void
  detailPhotoId: number | null
  setDetailPhotoId: (id: number | null) => void
}

const defaultFilter: FilterState = {
  filters: {},
  sortBy: 'imported_at',
  sortOrder: 'desc'
}

export const useStore = create<AppStore>((set) => ({
  attrTypes: [],
  setAttrTypes: (types) => set({ attrTypes: types }),

  filmIconCache: {},
  setFilmIconCache: (cache) => set({ filmIconCache: cache }),
  mergeFilmIconCache: (batch) => set((s) => ({ filmIconCache: { ...s.filmIconCache, ...batch } })),

  subLibraries: [],
  setSubLibraries: (libs) => set({ subLibraries: libs }),

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
  clearSelection: () => set({ selectedIds: new Set() }),

  thumbnailSize: 'medium',
  setThumbnailSize: (s) => set({ thumbnailSize: s }),

  viewerPhoto: null,
  setViewerPhoto: (p) => set({ viewerPhoto: p }),
  viewerPhotos: [],
  setViewerPhotos: (ps) => set({ viewerPhotos: ps }),
  viewerIndex: 0,
  setViewerIndex: (i) => set({ viewerIndex: i }),
  closeViewer: () => set({ viewerPhoto: null, viewerPhotos: [], viewerIndex: 0 }),

  iccProfiles: [],
  setIccProfiles: (p) => set({ iccProfiles: p }),
  activeProfile: null,
  setActiveProfile: (p) => set({ activeProfile: p }),

  importProgress: null,
  setImportProgress: (p) => set({ importProgress: p }),

  settingsOpen: false,
  setSettingsOpen: (v) => set({ settingsOpen: v }),
  detailPhotoId: null,
  setDetailPhotoId: (id) => set({ detailPhotoId: id })
}))
